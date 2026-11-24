import type { ReviewNoteRow, ReviewNotesReader } from '../../notes/repository';
import type { ReviewScope } from '../../reading-state/cutoff.service';
import type { ReviewEvidence } from '../grading';
import type { NoteReviewRepository, ReviewClaimMeta, StoredReview } from '../repository';
import { createNoteReviewService, selectBeforeEnding } from '../service';
import type { ReviewResult } from '../types';

const R = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bk';
const END = '2026-11-20T00:00:00.000Z';
const BEFORE = '2026-11-10T00:00:00.000Z';
const AFTER = '2026-11-21T00:00:00.000Z';

function note(
  id: string,
  page: number,
  kind: ReviewNoteRow['kind'],
  body: string,
  at = BEFORE,
  edited = at
): ReviewNoteRow {
  return { note_id: id, page_no: page, kind, body, created_at: at, body_updated_at: edited };
}

class FakeReviews implements NoteReviewRepository {
  row: (StoredReview & { meta?: ReviewClaimMeta }) | null = null;
  async find() {
    return this.row ? { ...this.row } : null;
  }
  async claim(_r: string, _b: string, meta: ReviewClaimMeta) {
    if (this.row?.status === 'done') return 'done' as const;
    if (this.row?.status === 'pending') return 'busy' as const;
    this.row = {
      status: 'pending',
      result: null,
      attempts: (this.row?.attempts ?? 0) + 1,
      last_error: null,
      meta,
    };
    return 'claimed' as const;
  }
  async complete(_r: string, _b: string, result: ReviewResult) {
    this.row = { ...this.row!, status: 'done', result };
  }
  async fail(_r: string, _b: string, error: string) {
    this.row = { ...this.row!, status: 'failed', result: null, last_error: error };
  }
}

const EVIDENCE: ReviewEvidence = {
  title: '가상범인',
  author: '김내성',
  summaries: [{ chapter_no: 1, title: '1장', start_page: 1, end_page: 100, content: '요약' }],
  events: [],
  characters: [],
  character_notes: [],
};

function setup(
  opts: {
    open?: boolean;
    reachedEndAt?: string | null;
    rows?: ReviewNoteRow[];
    replies?: (string | Error)[];
  } = {}
) {
  const calls = { scope: 0, notes: 0, evidence: [] as number[], llm: [] as string[] };
  const scope: ReviewScope =
    opts.open === false
      ? { open: false }
      : {
          open: true,
          bound: 100,
          reached_end_at: opts.reachedEndAt === undefined ? END : opts.reachedEndAt,
        };
  const notes: ReviewNotesReader = {
    async listForReview(_r, _b, bound) {
      calls.notes += 1;
      return (opts.rows ?? []).filter((r) => r.page_no <= bound);
    },
  };
  const reviews = new FakeReviews();
  const replies = [...(opts.replies ?? [])];
  const logs: any[] = [];
  const service = createNoteReviewService({
    scope: {
      async getReviewScope() {
        calls.scope += 1;
        return scope;
      },
    },
    notes,
    reviews,
    evidence: {
      async load(_b, bound) {
        calls.evidence.push(bound);
        return EVIDENCE;
      },
    },
    llm: async (prompt) => {
      calls.llm.push(prompt);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('no reply');
      return next;
    },
    model: 'test-model',
    now: () => new Date('2026-11-24T00:00:00.000Z'),
    log: (record) => logs.push(record),
  });
  return { service, calls, reviews, logs };
}

function reply(notes: object[], extra: object = {}) {
  return JSON.stringify({ truth_summary: '범인은 집사였어요.', reveal_page: 95, notes, ...extra });
}

describe('추리 채점 — 관문 (FR-QNA-004 🚦)', () => {
  test('FR-QNA-004: 끝까지 가지 않은 독자는 잠김 — 노트·근거·AI를 하나도 부르지 않는다', async () => {
    const t = setup({ open: false, rows: [note('h1', 10, 'hypothesis', '집사')] });
    expect(await t.service.status(R, B)).toEqual({ state: 'locked' });
    expect(await t.service.grade(R, B, [])).toEqual({ ok: false, reason: 'locked' });
    expect(t.calls.notes).toBe(0);
    expect(t.calls.evidence).toEqual([]);
    expect(t.calls.llm).toEqual([]);
    expect(t.reviews.row).toBeNull();
  });

  test('FR-QNA-004: 끝까지 간 독자는 열린다 (positive 쌍) — 대상 개수를 보여 준다', async () => {
    const t = setup({
      rows: [
        note('h1', 10, 'hypothesis', '집사'),
        note('c1', 20, 'clue', '장갑'),
        note('m1', 30, null, '메모'),
      ],
    });
    const view = await t.service.status(R, B);
    expect(view).toMatchObject({
      state: 'ready',
      targets: { hypothesis: 1, clue: 1 },
      timing_verified: true,
    });
    if (view.state === 'ready') expect(view.candidates.map((c) => c.note_id)).toEqual(['m1']);
  });
});

describe('추리 채점 — 한 번만, 고정 규칙', () => {
  test('FR-SPL-002: 근거 조회 상한은 기준점 결정기가 준 책 끝 쪽(100)', async () => {
    const t = setup({
      rows: [note('h1', 10, 'hypothesis', '범인은 집사')],
      replies: [reply([{ ref: 'n1', verdict: 'hit', explanation: '맞아요.', evidence_page: 95 }])],
    });
    await t.service.grade(R, B, []);
    expect(t.calls.evidence).toEqual([100]);
  });

  test('가설·단서를 세 단계로 판정하고 개수·칭호·결말 N쪽 전을 고정 규칙으로 낸다', async () => {
    const t = setup({
      rows: [
        note('h1', 10, 'hypothesis', '범인은 집사'),
        note('h2', 40, 'hypothesis', '동기는 돈'),
        note('c1', 20, 'clue', '젖은 장갑'),
      ],
      replies: [
        reply([
          { ref: 'n1', verdict: 'hit', explanation: '범인을 맞혔어요.', evidence_page: 95 },
          { ref: 'n2', verdict: 'miss', explanation: '동기는 복수였어요.', evidence_page: 97 },
          { ref: 'n3', verdict: 'key', explanation: '장갑이 결정적이었어요.', evidence_page: 60 },
        ]),
      ],
    });
    const out = await t.service.grade(R, B, []);
    if (!out.ok) throw new Error(out.reason);
    expect(out.result.counts).toEqual({
      hypothesis: { hit: 1, partial: 0, miss: 1, total: 2 },
      clue: { key: 1, related: 0, unrelated: 0, total: 1 },
      pending: 0,
    });
    expect(out.result.title).toBe('명탐정');
    expect(out.result.early_pages).toBe(85);
    expect(out.result.timing_verified).toBe(true);
    expect(t.reviews.row?.status).toBe('done');
    expect(t.reviews.row?.meta).toMatchObject({
      bound_page: 100,
      eligible_count: 3,
      model: 'test-model',
    });
  });

  test('성공한 결과는 최종 — 다시 눌러도 AI를 부르지 않고 저장 결과를 준다', async () => {
    const t = setup({
      rows: [note('h1', 10, 'hypothesis', '집사')],
      replies: [
        reply([
          { ref: 'n1', verdict: 'partial', explanation: '반쯤 맞았어요.', evidence_page: null },
        ]),
      ],
    });
    const first = await t.service.grade(R, B, []);
    const second = await t.service.grade(R, B, []);
    expect(second).toEqual(first);
    expect(t.calls.llm).toHaveLength(1);
    expect(await t.service.status(R, B)).toMatchObject({ state: 'done' });
  });

  test('응답에서 빠진 노트는 판정 보류 — 개수에서 뺀다', async () => {
    const t = setup({
      rows: [note('h1', 10, 'hypothesis', '집사'), note('h2', 20, 'hypothesis', '정원사')],
      replies: [
        reply([{ ref: 'n1', verdict: 'miss', explanation: '아니었어요.', evidence_page: 95 }]),
      ],
    });
    const out = await t.service.grade(R, B, []);
    if (!out.ok) throw new Error(out.reason);
    expect(out.result.notes.find((n) => n.note_id === 'h2')).toMatchObject({
      verdict: 'pending',
      explanation: null,
    });
    expect(out.result.counts.hypothesis.total).toBe(1);
    expect(out.result.counts.pending).toBe(1);
    expect(out.result.title).toBe('견습 탐정');
  });
});

describe('추리 채점 — 결말 전 노트만 (대표 결정 8번)', () => {
  test('끝에 닿은 뒤 쓰거나 본문을 고친 노트는 빼고, 뺀 수를 남긴다', async () => {
    const t = setup({
      rows: [
        note('h1', 10, 'hypothesis', '결말 전'),
        note('h2', 20, 'hypothesis', '결말 뒤에 씀', AFTER),
        note('h3', 30, 'hypothesis', '결말 뒤에 고침', BEFORE, AFTER),
      ],
      replies: [reply([{ ref: 'n1', verdict: 'hit', explanation: '맞아요.', evidence_page: 95 }])],
    });
    const out = await t.service.grade(R, B, []);
    if (!out.ok) throw new Error(out.reason);
    expect(out.result.notes.map((n) => n.note_id)).toEqual(['h1']);
    expect(out.result.excluded_count).toBe(2);
    expect(t.calls.llm[0]).not.toContain('결말 뒤');
  });

  test('시각을 모르는 기존 독자는 모든 노트를 넣고 "확인 안 됨" — 결말 N쪽 전은 내지 않는다', async () => {
    const t = setup({
      reachedEndAt: null,
      rows: [note('h1', 10, 'hypothesis', '집사', AFTER)],
      replies: [reply([{ ref: 'n1', verdict: 'hit', explanation: '맞아요.', evidence_page: 95 }])],
    });
    const out = await t.service.grade(R, B, []);
    if (!out.ok) throw new Error(out.reason);
    expect(out.result.timing_verified).toBe(false);
    expect(out.result.early_pages).toBeNull();
    expect(out.result.notes).toHaveLength(1);
  });

  test('selectBeforeEnding — 시각과 같은 순간에 쓴 노트도 뺀다(결말을 본 순간)', () => {
    expect(selectBeforeEnding([note('x', 1, 'clue', 'a', END)], END).eligible).toEqual([]);
  });
});

describe('추리 채점 — 대상이 없을 때와 고르기 (대표 결정 3·12번)', () => {
  test('가설·단서가 없으면 AI를 부르지 않는다', async () => {
    const t = setup({ rows: [note('m1', 10, null, '메모')] });
    expect(await t.service.grade(R, B, [])).toEqual({ ok: false, reason: 'no_targets' });
    expect(t.calls.llm).toEqual([]);
    expect(t.reviews.row).toBeNull();
  });

  test('고른 일반 메모는 가설로 채점하고 고른 표시를 남긴다 — 노트 원본 종류는 건드리지 않는다', async () => {
    const t = setup({
      rows: [note('m1', 10, null, '집사가 수상해')],
      replies: [reply([{ ref: 'n1', verdict: 'hit', explanation: '맞아요.', evidence_page: 95 }])],
    });
    const out = await t.service.grade(R, B, ['m1']);
    if (!out.ok) throw new Error(out.reason);
    expect(out.result.notes[0]).toMatchObject({
      kind: 'hypothesis',
      chosen_as_hypothesis: true,
      verdict: 'hit',
    });
  });

  test('고를 수 없는 노트(단서·결말 뒤 메모·없는 ID)를 보내면 거절한다', async () => {
    const rows = [note('c1', 10, 'clue', '장갑'), note('m2', 20, null, '뒤', AFTER)];
    for (const id of ['c1', 'm2', 'nope']) {
      const t = setup({ rows });
      expect(await t.service.grade(R, B, [id])).toEqual({ ok: false, reason: 'invalid_choice' });
      expect(t.calls.llm).toEqual([]);
    }
  });
});

describe('추리 채점 — 실패 처리 (R11, 대표 결정 12번)', () => {
  test('형식이 틀리면 1회 다시 만들고, 두 번째가 맞으면 성공', async () => {
    const t = setup({
      rows: [note('h1', 10, 'hypothesis', '집사')],
      replies: [
        '이건 JSON이 아님',
        reply([{ ref: 'n1', verdict: 'miss', explanation: '아니었어요.', evidence_page: 95 }]),
      ],
    });
    const out = await t.service.grade(R, B, []);
    expect(out.ok).toBe(true);
    expect(t.calls.llm).toHaveLength(2);
  });

  test('두 번 다 틀리면 실패 — 결과를 저장하지 않고 다시 누를 수 있다', async () => {
    const t = setup({
      rows: [note('h1', 10, 'hypothesis', '집사')],
      replies: [
        '{}',
        reply([], { reveal_page: 9999 }),
        reply([{ ref: 'n1', verdict: 'hit', explanation: '맞아요.', evidence_page: 95 }]),
      ],
    });
    expect(await t.service.grade(R, B, [])).toEqual({ ok: false, reason: 'failed' });
    expect(t.reviews.row).toMatchObject({
      status: 'failed',
      result: null,
      last_error: 'invalid_response',
    });
    expect(await t.service.status(R, B)).toMatchObject({ state: 'ready', last_failed: true });
    const retry = await t.service.grade(R, B, []);
    expect(retry.ok).toBe(true);
    expect(t.reviews.row?.attempts).toBe(2);
  });

  test('AI 호출이 실패하면 1회로 치지 않는다 — 결과 없음, 기록은 실패', async () => {
    const t = setup({
      rows: [note('h1', 10, 'hypothesis', '집사')],
      replies: [new Error('timeout')],
    });
    expect(await t.service.grade(R, B, [])).toEqual({ ok: false, reason: 'failed' });
    expect(t.reviews.row).toMatchObject({ status: 'failed', result: null });
    expect(t.logs.at(-1)).toMatchObject({ outcome: 'failed', model: 'test-model' });
  });

  test('다른 요청이 채점 중이면 busy — AI를 두 번 부르지 않는다', async () => {
    const t = setup({ rows: [note('h1', 10, 'hypothesis', '집사')] });
    t.reviews.row = { status: 'pending', result: null, attempts: 1, last_error: null };
    expect(await t.service.grade(R, B, [])).toEqual({ ok: false, reason: 'busy' });
    expect(t.calls.llm).toEqual([]);
  });

  test('성공하면 로그 레코드에 모델·호출 수·범위가 남는다', async () => {
    const t = setup({
      rows: [note('h1', 10, 'hypothesis', '집사')],
      replies: [reply([{ ref: 'n1', verdict: 'hit', explanation: '맞아요.', evidence_page: 95 }])],
    });
    await t.service.grade(R, B, []);
    expect(t.logs.at(-1)).toMatchObject({
      outcome: 'done',
      model: 'test-model',
      bound_page: 100,
      llm_calls: 1,
      graded: 1,
    });
  });
});
