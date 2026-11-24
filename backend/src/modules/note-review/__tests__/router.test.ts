import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { createCutoffService } from '../../reading-state/cutoff.service';
import { createProgressService } from '../../reading-state/progress.service';
import type { ReviewNoteRow } from '../../notes/repository';
import { makeSeededFakes } from '../../../../tests/unit/reading-state/fakes';
import type { NoteReviewRepository, StoredReview } from '../repository';
import { createNoteReviewRouter } from '../router';
import { createNoteReviewService } from '../service';

const A = '11111111-1111-4111-8111-111111111111';
const OPEN = 'bk-open';
const DRAFT = 'bk-draft';
const H = '33333333-3333-4333-8333-333333333333';

class MemoryReviews implements NoteReviewRepository {
  row: StoredReview | null = null;
  async find() {
    return this.row;
  }
  async claim() {
    if (this.row?.status === 'done') return 'done' as const;
    if (this.row?.status === 'pending') return 'busy' as const;
    this.row = {
      status: 'pending',
      result: null,
      attempts: (this.row?.attempts ?? 0) + 1,
      last_error: null,
    };
    return { token: 't' };
  }
  async complete(_r: string, _b: string, _t: string, result: any) {
    this.row = { ...this.row!, status: 'done', result };
    return true;
  }
  async fail(_r: string, _b: string, _t: string, error: string) {
    this.row = { ...this.row!, status: 'failed', result: null, last_error: error };
  }
}

describe('추리 채점 API', () => {
  let server: Server;
  let baseUrl: string;
  let llmCalls: number;
  let replies: string[];
  let notes: ReviewNoteRow[];
  let reviews: MemoryReviews;
  let go: (page: number, from?: number | null) => Promise<void>;
  let shared: { body: string; card: any }[];

  beforeEach(async () => {
    const { positions, books } = makeSeededFakes();
    books.set(OPEN, {
      total_pages: 100,
      chapters: [{ chapter_no: 1, title: '1장', start_page: 1, end_page: 100 }],
    });
    const progress = createProgressService({ positions, books });
    let seq = 0;
    go = (page, from = null) =>
      progress.acceptProgressEvent(A, OPEN, { page, seq: ++seq, from_page: from });
    llmCalls = 0;
    replies = [];
    notes = [];
    reviews = new MemoryReviews();
    shared = [];
    const service = createNoteReviewService({
      scope: createCutoffService({ positions, books }),
      notes: { listForReview: async (_r, _b, bound) => notes.filter((n) => n.page_no <= bound) },
      reviews,
      evidence: {
        load: async () => ({
          title: '',
          author: '',
          summaries: [],
          events: [],
          characters: [],
          character_notes: [],
        }),
      },
      llm: async () => {
        llmCalls += 1;
        return replies.shift() ?? 'not json';
      },
      model: 'm',
      log: () => undefined,
      community: {
        countRecentPosts: async () => 0,
        findMyReviewPost: async () => (shared.length > 0 ? 'p1' : null),
        createReviewPost: async (_b, _r, body, card) => {
          shared.push({ body, card });
          return {
            seq: 1,
            post_id: 'p1',
            reader_id: A,
            body,
            author_name: null,
            created_at: '',
            deleted: false,
            comment_count: 0,
          };
        },
      },
    });
    const app = express();
    app.use(
      createNoteReviewRouter({
        service,
        content: {
          findReadiness: async (id: string) => (id === OPEN ? true : id === DRAFT ? false : null),
        },
      })
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function call(method: string, book: string, reader: string | null, body?: unknown, sub = '') {
    return fetch(`${baseUrl}/books/${book}/review${sub}`, {
      method,
      headers: { 'content-type': 'application/json', ...(reader ? { 'x-device-id': reader } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const hypothesis = (): ReviewNoteRow => ({
    note_id: H,
    page_no: 10,
    kind: 'hypothesis',
    body: '집사',
    created_at: '2000-01-01T00:00:00.000Z',
    content_updated_at: '2000-01-01T00:00:00.000Z',
  });
  const ok = JSON.stringify({
    truth_summary: '진상',
    reveal_page: 90,
    notes: [{ ref: 'n1', verdict: 'hit', explanation: '맞아요.', evidence_page: 90 }],
  });

  test('R12: 미공개·싸비 미완비·없는 도서는 404', async () => {
    for (const book of [DRAFT, 'bk-missing']) {
      expect((await call('GET', book, A)).status).toBe(404);
      expect((await call('POST', book, A, {})).status).toBe(404);
    }
    expect(llmCalls).toBe(0);
  });

  test('독자 식별이 없거나 고른 메모 목록이 잘못되면 400', async () => {
    expect((await call('GET', OPEN, null)).status).toBe(400);
    expect((await call('POST', OPEN, A, { as_hypothesis: 'x' })).status).toBe(400);
    expect((await call('POST', OPEN, A, { as_hypothesis: ['not-a-uuid'] })).status).toBe(400);
  });

  test('FR-QNA-004: 40쪽까지만 간 독자는 403 — AI를 부르지 않는다', async () => {
    notes = [hypothesis()];
    replies = [ok];
    await go(1);
    await go(40, 1);
    expect((await call('GET', OPEN, A)).status).toBe(403);
    expect((await call('POST', OPEN, A, {})).status).toBe(403);
    expect(llmCalls).toBe(0);
    expect(reviews.row).toBeNull();
  });

  test('FR-QNA-004: 마지막 쪽을 펼친 독자는 채점된다 (positive 쌍) — 두 번째는 저장 결과', async () => {
    notes = [hypothesis()];
    replies = [ok];
    await go(1);
    await go(100, 1);
    const view = await (await call('GET', OPEN, A)).json();
    expect(view).toMatchObject({ state: 'ready', targets: { hypothesis: 1, clue: 0 } });
    const first = await call('POST', OPEN, A, {});
    expect(first.status).toBe(200);
    const body: any = await first.json();
    expect(body.result.title).toBe('명탐정');
    expect((await call('POST', OPEN, A, {})).status).toBe(200);
    expect(llmCalls).toBe(1);
  });

  test('절대 규칙 8번: 클라이언트가 쪽·범위·완독을 실어 보내도 관문은 서버 저장값으로만 정한다', async () => {
    notes = [hypothesis()];
    replies = [ok];
    await go(1);
    const res = await call('POST', OPEN, A, {
      page: 100,
      bound: 100,
      is_complete: true,
      reached_end: true,
    });
    expect(res.status).toBe(403);
    expect(llmCalls).toBe(0);
  });

  test('대상 노트가 없으면 422, 형식이 계속 틀리면 503 — 결과는 남지 않는다', async () => {
    await go(1);
    await go(100, 1);
    expect((await call('POST', OPEN, A, {})).status).toBe(422);
    notes = [hypothesis()];
    replies = ['x', 'y'];
    expect((await call('POST', OPEN, A, {})).status).toBe(503);
    expect(reviews.row?.result ?? null).toBeNull();
  });

  test('다른 요청이 채점 중이면 409', async () => {
    notes = [hypothesis()];
    await go(1);
    await go(100, 1);
    reviews.row = { status: 'pending', result: null, attempts: 1, last_error: null };
    expect((await call('POST', OPEN, A, {})).status).toBe(409);
  });

  test('결과지 공유: 잠김 403, 채점 전 409, 성공 201, 두 번째 409(글 ID), 잘못된 입력 400', async () => {
    notes = [hypothesis()];
    replies = [ok];
    await go(1);
    expect((await call('POST', OPEN, A, { note_ids: [H] }, '/share')).status).toBe(403);
    await go(100, 1);
    expect((await call('POST', OPEN, A, { note_ids: [H] }, '/share')).status).toBe(409);
    await call('POST', OPEN, A, {});
    expect((await call('POST', OPEN, A, { note_ids: 'x' }, '/share')).status).toBe(400);
    expect(
      (await call('POST', OPEN, A, { note_ids: [], message: 'x'.repeat(2001) }, '/share')).status
    ).toBe(400);
    const res = await call('POST', OPEN, A, { note_ids: [H], message: '맞혔다' }, '/share');
    expect(res.status).toBe(201);
    expect(shared[0].card.notes).toHaveLength(1);
    const again = await call('POST', OPEN, A, { note_ids: [H] }, '/share');
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'ALREADY_SHARED', post_id: 'p1' });
    expect(llmCalls).toBe(1);
  });
});
