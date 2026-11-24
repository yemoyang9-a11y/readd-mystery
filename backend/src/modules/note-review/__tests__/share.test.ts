import type { ReviewCard } from '../../community/repository';
import type { ReviewScope } from '../../reading-state/cutoff.service';
import type { NoteReviewRepository, StoredReview } from '../repository';
import { createNoteReviewService, DEFAULT_SHARE_BODY } from '../service';
import type { ReviewResult } from '../types';

const R = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bk';

const result: ReviewResult = {
  version: 1,
  truth_summary: '진상은 비밀이에요.',
  reveal_page: 95,
  notes: [
    {
      note_id: 'h1',
      page_no: 10,
      kind: 'hypothesis',
      chosen_as_hypothesis: false,
      body: '범인은 집사',
      verdict: 'hit',
      explanation: '맞아요.',
      evidence_page: 95,
    },
    {
      note_id: 'c1',
      page_no: 20,
      kind: 'clue',
      chosen_as_hypothesis: false,
      body: '젖은 장갑',
      verdict: 'key',
      explanation: '핵심이에요.',
      evidence_page: 60,
    },
    {
      note_id: 'h2',
      page_no: 30,
      kind: 'hypothesis',
      chosen_as_hypothesis: false,
      body: '정원사',
      verdict: 'pending',
      explanation: null,
      evidence_page: null,
    },
  ],
  counts: {
    hypothesis: { hit: 1, partial: 0, miss: 0, total: 1 },
    clue: { key: 1, related: 0, unrelated: 0, total: 1 },
    pending: 1,
  },
  title: '명탐정',
  early_pages: 85,
  timing_verified: true,
  excluded_count: 0,
  graded_at: '2026-11-24T00:00:00.000Z',
};

function setup(opts: { open?: boolean; stored?: StoredReview | null; recent?: number } = {}) {
  const posts: { body: string; card: ReviewCard }[] = [];
  const calls = { community: 0 };
  const reviews: NoteReviewRepository = {
    find: async () =>
      opts.stored === undefined
        ? { status: 'done', result, attempts: 1, last_error: null }
        : opts.stored,
    claim: async () => 'busy',
    complete: async () => undefined,
    fail: async () => undefined,
  };
  const scope: ReviewScope =
    opts.open === false ? { open: false } : { open: true, bound: 100, reached_end_at: null };
  const service = createNoteReviewService({
    scope: { getReviewScope: async () => scope },
    notes: { listForReview: async () => [] },
    reviews,
    evidence: {
      load: async () => {
        throw new Error('공유는 근거를 읽지 않는다');
      },
    },
    llm: async () => {
      throw new Error('공유는 AI를 부르지 않는다');
    },
    model: 'm',
    log: () => undefined,
    community: {
      countRecentPosts: async () => {
        calls.community += 1;
        return opts.recent ?? 0;
      },
      findMyReviewPost: async () => {
        calls.community += 1;
        return posts.length > 0 ? 'p1' : null;
      },
      createReviewPost: async (_b, _r, body, card) => {
        calls.community += 1;
        posts.push({ body, card });
        return {
          seq: 1,
          post_id: 'p1',
          reader_id: R,
          body,
          author_name: null,
          created_at: '',
          deleted: false,
          comment_count: 0,
        };
      },
    },
  });
  return { service, posts, calls };
}

describe('결과지 공유 (대표 결정 9~11번)', () => {
  test('FR-QNA-004: 끝까지 가지 않은 독자는 공유할 수 없다 — 커뮤니티 저장소를 부르지 않는다', async () => {
    const t = setup({ open: false });
    expect(await t.service.share(R, B, ['h1'], null)).toEqual({ ok: false, reason: 'locked' });
    expect(t.calls.community).toBe(0);
  });

  test('요약 카드 + 고른 노트만 올라가고 진상 요약은 들어가지 않는다 (positive 쌍)', async () => {
    const t = setup();
    expect(await t.service.share(R, B, ['h1'], '집사가 수상했어요')).toEqual({
      ok: true,
      post_id: 'p1',
    });
    const [post] = t.posts;
    expect(post.body).toBe('집사가 수상했어요');
    expect(post.card).toMatchObject({
      title: '명탐정',
      early_pages: 85,
      message: '집사가 수상했어요',
    });
    expect(post.card.notes).toEqual([
      {
        kind: 'hypothesis',
        page_no: 10,
        body: '범인은 집사',
        verdict: 'hit',
        explanation: '맞아요.',
        evidence_page: 95,
      },
    ]);
    expect(JSON.stringify(post.card)).not.toContain('진상은 비밀');
    expect(post.card.counts).toEqual({
      hypothesis: result.counts.hypothesis,
      clue: result.counts.clue,
    });
  });

  test('한마디 글 없이 공유하면 글 본문은 정해 둔 말, 카드의 message 는 null', async () => {
    const t = setup();
    await t.service.share(R, B, [], '   ');
    expect(t.posts[0].body).toBe(DEFAULT_SHARE_BODY);
    expect(t.posts[0].card.message).toBeNull();
    expect(t.posts[0].card.notes).toEqual([]);
  });

  test('채점 전이면 공유할 수 없다', async () => {
    for (const stored of [
      null,
      { status: 'failed', result: null, attempts: 1, last_error: 'x' } as StoredReview,
    ]) {
      const t = setup({ stored });
      expect(await t.service.share(R, B, [], null)).toEqual({ ok: false, reason: 'not_graded' });
      expect(t.posts).toEqual([]);
    }
  });

  test('판정 보류 노트·없는 노트는 고를 수 없다', async () => {
    const t = setup();
    expect(await t.service.share(R, B, ['h2'], null)).toEqual({
      ok: false,
      reason: 'invalid_choice',
    });
    expect(await t.service.share(R, B, ['nope'], null)).toEqual({
      ok: false,
      reason: 'invalid_choice',
    });
    expect(t.posts).toEqual([]);
  });

  test('독자·책당 하나 — 이미 공유했으면 그 글 ID와 함께 거절', async () => {
    const t = setup();
    await t.service.share(R, B, ['h1'], null);
    expect(await t.service.share(R, B, ['c1'], null)).toEqual({
      ok: false,
      reason: 'duplicate',
      post_id: 'p1',
    });
    expect(t.posts).toHaveLength(1);
  });

  test('글 쓰기 한도(1시간 10개)를 함께 센다', async () => {
    const t = setup({ recent: 10 });
    expect(await t.service.share(R, B, ['h1'], null)).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
  });

  test('채점 상태는 공유한 글 ID를 함께 준다', async () => {
    const t = setup();
    expect(await t.service.status(R, B)).toMatchObject({ state: 'done', shared_post_id: null });
    await t.service.share(R, B, ['h1'], null);
    expect(await t.service.status(R, B)).toMatchObject({ state: 'done', shared_post_id: 'p1' });
  });
});
