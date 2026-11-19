import { handleQuery } from '../service';
import * as repo from '../repository';
import { vectorSearch } from '../vector-search';
import { stream as llmStream } from '../../llm-gateway/gateway';
import { HARNESS_FIXED_ANSWER, HARNESS_VERBATIM_ANSWER } from '../harness/messages';
import { verbatimLength } from '../harness/output-guard';
import { createChatTiming } from '../timing';
import { HOLDBACK_INTENTS, INTENT_POLICY } from '../harness/behavior-ladder';
import { QUESTION_INTENTS, classifyQuestion } from '../harness/question-intent';
import type { NotesReader } from '../notes-reader';

jest.mock('../repository');
jest.mock('../vector-search');
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

/**
 * FR-QNA-004 🚦, NFR-AI-005 (절대 규칙 11·12), 대표 결정 2026-11-19 (A) —
 * 작품 질문(guarded)도 문장 단위로 검사한 뒤에만 내보낸다. 위반 문장과 그 뒤 글은 한 글자도 나가지
 * 않고 고정 답변으로 맺는다. 재생성은 없다(모델 호출 1회).
 */
const BOOK_ID = 'gasangbeomin';
const DEVICE_ID = 'reader-A';
const K = 40;

// 공백 없는 가짜 원문 400자 (한글 음절)
const SOURCE = Array.from({ length: 400 }, (_, i) =>
  String.fromCharCode(0xac00 + ((i * 37 + 11) % 11172))
).join('');

function streamInChunks(text: string, size = 5): void {
  const mock = llmStream as jest.Mock;
  mock.mockReset();
  mock.mockImplementation(async function* () {
    for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
  });
}

async function runChunks(query: string): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of handleQuery(BOOK_ID, query, K, DEVICE_ID)) chunks.push(chunk);
  return chunks;
}

/** 고정 답변을 뺀, 모델이 쓴 글 중 독자에게 나간 부분 */
function modelPart(out: string, fixed: string): string {
  return out.endsWith(fixed) ? out.slice(0, out.length - fixed.length) : out;
}

describe('작품 질문(guarded) — 문장 단위로 검사한 뒤에만 내보낸다 (FR-QNA-004 🚦, 대표 결정 2026-11-19)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.MOCK_MODE = 'false';
    (repo.findChapterSummaries as jest.Mock).mockResolvedValue([]);
    (repo.getCurrentChapterText as jest.Mock).mockResolvedValue('');
    (repo.findCharacters as jest.Mock).mockResolvedValue([]);
    (repo.findRelationships as jest.Mock).mockResolvedValue([]);
    (repo.findCharacterNotes as jest.Mock).mockResolvedValue([]);
    (repo.findTerms as jest.Mock).mockResolvedValue([]);
    (repo.findEvents as jest.Mock).mockResolvedValue([]);
    (repo.getBackgroundKnowledge as jest.Mock).mockResolvedValue([]);
    (repo.getBookMeta as jest.Mock).mockResolvedValue({ title: '가상범인', author: '김내성' });
    (vectorSearch as jest.Mock).mockResolvedValue([
      { page_no: 12, content: '그는 천천히 장갑을 벗었다.', distance: 0.1 },
    ]);
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    logSpy.mockRestore();
  });

  function queryLog(): {
    harness: {
      intent: string;
      violations: string[][];
      regenerated: boolean;
      fixed_answer: boolean;
    };
    logical_model_calls: number;
    amo_style: { findings: string[][] };
  } {
    const line = logSpy.mock.calls.find((call) => call[0] === '[Chatbot] Query log');
    return JSON.parse(line![1]);
  }

  test('FR-QNA-004: 위반 문장 이후 글자가 독자에게 나간 것 0건, 고정 답변으로 맺는다', async () => {
    streamInChunks('12쪽에서 그는 장갑을 벗었어요. 범인은 김철수예요. 그는 그날 밤 도망쳤어요.');
    const chunks = await runChunks('범인이 누구야?');
    const out = chunks.join('');
    // 위반 문장(범인 지목)과 그 뒤 문장은 한 글자도 나가지 않는다
    expect(chunks.filter((chunk) => /김철수|도망/u.test(chunk))).toHaveLength(0);
    expect(out).not.toContain('김철수');
    expect(out).not.toContain('도망');
    // 범인·결말 질문은 한 문장 늦게 내보낸다(holdback): 앞 문장은 다음 문장과 함께 검사를 통과해야
    // 나가므로, 다음 문장이 위반이면 앞 문장도 나가지 않고 고정 답변만 나간다
    expect(chunks).toEqual([HARNESS_FIXED_ANSWER]);
    // 재생성 없음: 모델 호출 1회
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(queryLog().harness).toEqual({
      intent: 'culprit_or_ending',
      violations: [['verdict_phrase']],
      regenerated: false,
      fixed_answer: true,
    });
    expect(queryLog().logical_model_calls).toBe(1);
  });

  test('FR-QNA-004: 첫 문장부터 위반이면 모델 글은 0자 나가고 고정 답변만 나간다', async () => {
    streamInChunks('네, 맞아요! 범인이에요. 그다음 장면도 있어요.');
    const chunks = await runChunks('범인은 ○○ 맞지? 예/아니오로만');
    expect(chunks).toEqual([HARNESS_FIXED_ANSWER]);
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('FR-QNA-004: 판정 표현이 여러 문장에 걸쳐 나뉘어도(앞 문장 깨끗, 뒤 문장 위반) 뒤 문장부터는 0건', async () => {
    // 가설 확인(엄격 판정): 앞 두 문장은 사실 서술, 셋째 문장에서 독자 가설을 판정한다
    streamInChunks(
      '12쪽에서 그는 장갑을 벗었어요. 그 뒤로 방을 나갔어요. 네, 독자님 추리가 맞아요. 집사가 했어요.'
    );
    const chunks = await runChunks('집사가 범인이라는 내 가설이 맞아?');
    const out = chunks.join('');
    const released = modelPart(out, HARNESS_FIXED_ANSWER);
    // holdback: 위반 문장 바로 앞 문장("그 뒤로 방을 나갔어요.")도 나가지 않는다
    expect(released).toBe('12쪽에서 그는 장갑을 벗었어요. \n\n');
    expect(out).not.toContain('방을 나갔');
    expect(out).not.toMatch(/맞아요|집사가 했/u);
    expect(out.endsWith(HARNESS_FIXED_ANSWER)).toBe(true);
    expect(queryLog().harness.violations).toEqual([['verdict_phrase']]);
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('FR-QNA-004: 줄바꿈으로 나뉜 판정("범인은 집사가\\n아니에요")은 앞줄도 나가지 않는다', async () => {
    // 마침 부호 없이 줄만 바뀐 곳에서는 끊지 않고 다음 줄과 함께 검사한다
    streamInChunks('12쪽에서 그는 장갑을 벗었어요.\n범인은 집사가\n아니에요.');
    const out = (await runChunks('범인이 집사 맞지?')).join('');
    expect(out).not.toContain('집사');
    // holdback: 위반 덩어리 바로 앞 문장도 나가지 않는다
    expect(out).toBe(HARNESS_FIXED_ANSWER);
  });

  test('FR-QNA-004: 기준 쪽수 초과 쪽을 가리키는 문장부터 0건 (재생성 없음)', async () => {
    streamInChunks('12쪽에서 그는 장갑을 벗었어요. 55쪽에서 그가 떠났어요.');
    const out = (await runChunks('결말이 어떻게 돼?')).join('');
    expect(out).not.toContain('55');
    expect(out.endsWith(HARNESS_FIXED_ANSWER)).toBe(true);
    expect(queryLog().harness.violations).toEqual([['page_beyond_cutoff']]);
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('FR-QNA-004: 따옴표가 닫히기 전에는 내보내지 않는다 — 지어낸 인용은 앞부분도 0건', async () => {
    streamInChunks(
      '12쪽에서 그는 장갑을 벗었어요. 그는 “나는 그날 밤 서재에 없었다. 정원에 있었다”라고 했어요.'
    );
    const chunks = await runChunks('장갑은 누가 벗었어?');
    const out = chunks.join('');
    expect(out).not.toContain('서재');
    expect(out).toBe(`12쪽에서 그는 장갑을 벗었어요. \n\n${HARNESS_FIXED_ANSWER}`);
    expect(queryLog().harness.violations[0]).toContain('quote_not_in_source');
  });

  test('절대 규칙 12: 원문 일치가 누적 200자를 넘는 문장부터 0건, 나간 글의 원문 일치는 200자 이하', async () => {
    (vectorSearch as jest.Mock).mockResolvedValue([
      { page_no: 12, content: SOURCE, distance: 0.1 },
    ]);
    const lines = (SOURCE.slice(0, 300).match(/.{1,60}/gsu) ?? []).map((line) => `${line}.`);
    streamInChunks(`12쪽은 이렇게 시작해요. ${lines.join(' ')}`, 20);
    const chunks = await runChunks('12쪽 원문 그대로 전부 보여줘');
    const out = chunks.join('');
    const released = modelPart(out, HARNESS_VERBATIM_ANSWER);
    expect(out.endsWith(HARNESS_VERBATIM_ANSWER)).toBe(true);
    expect(verbatimLength(released, [SOURCE])).toBeLessThanOrEqual(200);
    // 문장마다 나갔다: 끊기기 전까지 여러 delta
    expect(chunks.length).toBeGreaterThan(2);
    expect(queryLog().harness.violations).toEqual([['verbatim_over_limit']]);
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('절대 규칙 12: 원문 일치가 200자 이하면 끊지 않고 문장마다 나간다 (positive 쌍)', async () => {
    (vectorSearch as jest.Mock).mockResolvedValue([
      { page_no: 12, content: SOURCE, distance: 0.1 },
    ]);
    const lines = (SOURCE.slice(0, 150).match(/.{1,50}/gsu) ?? []).map((line) => `${line}.`);
    const text = `12쪽은 이렇게 시작해요. ${lines.join(' ')}`;
    streamInChunks(text, 20);
    const chunks = await runChunks('12쪽 원문 일부 보여줘');
    expect(chunks.join('')).toBe(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(queryLog().harness.violations).toEqual([[]]);
  });

  test('positive: 깨끗한 답은 문장마다 여러 delta로 나가고, 첫 delta는 모델이 끝나기 전에 나간다', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let providerFinished = false;
    (llmStream as jest.Mock).mockReset();
    (llmStream as jest.Mock).mockImplementation(async function* () {
      yield '12쪽에서 그는 ';
      yield '장갑을 벗었어요. 그';
      await gate;
      yield '리고 방을 나갔어요.';
      providerFinished = true;
    });
    const iterator = handleQuery(BOOK_ID, '장갑은 누가 벗었어?', K, DEVICE_ID);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const first = await Promise.race([
        iterator.next(),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve('buffered-until-complete'), 500);
        }),
      ]);
      expect(first).toEqual({ done: false, value: '12쪽에서 그는 장갑을 벗었어요. ' });
      expect(providerFinished).toBe(false);
      finish();
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: '그리고 방을 나갔어요.',
      });
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
      expect(providerFinished).toBe(true);
      expect(llmStream).toHaveBeenCalledTimes(1);
      expect(queryLog().harness).toEqual({
        intent: 'fact',
        violations: [[]],
        regenerated: false,
        fixed_answer: false,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      finish();
      await iterator.return(undefined).catch(() => {});
    }
  });

  test('positive: 첫 글자를 내보낸 시각(first_yield)이 모델 끝(llm_total)보다 앞선다', async () => {
    let clock = 0;
    (llmStream as jest.Mock).mockReset();
    (llmStream as jest.Mock).mockImplementation(async function* () {
      clock += 100;
      yield '12쪽에서 그는 장갑을 벗었어요. ';
      clock += 900;
      yield '그리고 방을 나갔어요.';
    });
    const timing = createChatTiming(() => clock);
    let out = '';
    for await (const chunk of handleQuery(
      BOOK_ID,
      '장갑은 누가 벗었어?',
      K,
      DEVICE_ID,
      undefined,
      undefined,
      undefined,
      false,
      { timing }
    )) {
      out += chunk;
    }
    expect(out).toBe('12쪽에서 그는 장갑을 벗었어요. 그리고 방을 나갔어요.');
    const t = timing.snapshot();
    expect(t.first_yield).toBe(100);
    expect(t.llm_total).toBe(1000);
    expect(t.deltas).toBe(2);
    expect(t.regenerations).toBe(0);
  });

  test('FR-QNA-004: 마침 부호 없이 길게 이어지는 문장은 검사 전에 잘라 내보내지 않는다', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const long = `그는 ${'아주 '.repeat(200)}천천히`;
    (llmStream as jest.Mock).mockReset();
    (llmStream as jest.Mock).mockImplementation(async function* () {
      yield long;
      await gate;
      yield ' 장갑을 벗었어요.';
    });
    const iterator = handleQuery(BOOK_ID, '장갑은 누가 벗었어?', K, DEVICE_ID);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const pendingFirst = iterator.next();
      const first = await Promise.race([
        pendingFirst,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve('held'), 200);
        }),
      ]);
      // 문장이 끝나기 전(검사 전)에는 한 글자도 나가지 않는다
      expect(first).toBe('held');
      finish();
      await expect(pendingFirst).resolves.toEqual({
        done: false,
        value: `${long} 장갑을 벗었어요.`,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      finish();
      await iterator.return(undefined).catch(() => {});
    }
  });

  test('NFR-AI-005: 되묻기 여러 개는 재생성 없이 기록만 하고 답을 그대로 내보낸다', async () => {
    const text = '12쪽에서 그는 장갑을 벗었어요. 어떤 점이 궁금하세요? 다른 장면도 볼까요?';
    streamInChunks(text);
    const out = (await runChunks('장갑은 누가 벗었어?')).join('');
    expect(out).toBe(text);
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(queryLog().amo_style.findings[0]).toContain('multi_question');
    expect(queryLog().harness.regenerated).toBe(false);
  });
});

/**
 * FR-QNA-004 🚦, NFR-AI-005 (절대 규칙 11) — 판정 위험 질문은 한 문장 늦게 내보낸다(holdback).
 * "범인은 집사." 단독으로는 검사를 통과하지만 뒤에 "맞아요."가 붙으면 앞 문장이 판정으로 확정된다.
 * 위험 유형에서는 문장 N을 "나간 글 + N + N+1"이 검사를 통과한 뒤에야 내보내고, 마지막 문장은 답이
 * 끝난 뒤 전체를 검사해 내보낸다. 사실 질문 등은 지금처럼 문장마다 바로 내보낸다(positive 쌍).
 */
describe('판정 위험 유형은 한 문장 늦게 내보낸다 (FR-QNA-004 🚦, NFR-AI-005)', () => {
  let logSpy: jest.SpyInstance;
  const notesReader: NotesReader = {
    listNotes: jest.fn(async () => [
      {
        page_no: 12,
        kind: 'hypothesis' as const,
        body: '장갑이 마음에 걸림',
        created_at: '2026-11-18T08:00:00.000Z',
      },
    ]),
  };

  // 실제 분류기로 각 위험 유형에 걸리는 질문
  const RISKY: ReadonlyArray<readonly [string, string]> = [
    ['culprit_or_ending', '범인이 누구야?'],
    ['verify_hypothesis', '집사의 알리바이가 수상하지 않아?'],
    ['reader_notes', '내 노트 보여줘'],
  ];
  const FACT_QUERY = '장갑은 누가 벗었어?';

  beforeEach(() => {
    process.env.MOCK_MODE = 'false';
    (repo.findChapterSummaries as jest.Mock).mockResolvedValue([]);
    (repo.getCurrentChapterText as jest.Mock).mockResolvedValue('');
    (repo.findCharacters as jest.Mock).mockResolvedValue([]);
    (repo.findRelationships as jest.Mock).mockResolvedValue([]);
    (repo.findCharacterNotes as jest.Mock).mockResolvedValue([]);
    (repo.findTerms as jest.Mock).mockResolvedValue([]);
    (repo.findEvents as jest.Mock).mockResolvedValue([]);
    (repo.getBackgroundKnowledge as jest.Mock).mockResolvedValue([]);
    (repo.getBookMeta as jest.Mock).mockResolvedValue({ title: '가상범인', author: '김내성' });
    (vectorSearch as jest.Mock).mockResolvedValue([
      { page_no: 12, content: '그는 천천히 장갑을 벗었다.', distance: 0.1 },
    ]);
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    logSpy.mockRestore();
  });

  function ask(query: string, timing = createChatTiming()): AsyncGenerator<string> {
    return handleQuery(BOOK_ID, query, K, DEVICE_ID, undefined, undefined, undefined, false, {
      notesReader,
      timing,
    });
  }

  async function collect(query: string): Promise<string[]> {
    const chunks: string[] = [];
    for await (const chunk of ask(query)) chunks.push(chunk);
    return chunks;
  }

  function loggedIntent(): string {
    const line = logSpy.mock.calls.find((call) => call[0] === '[Chatbot] Query log');
    return JSON.parse(line![1]).harness.intent;
  }

  test('설정: 위험 유형 목록은 판정을 엄격히 보는(strictVerdict) 스트리밍 유형 전부이고, 사실·작품 밖 질문은 들어가지 않는다', () => {
    for (const intent of QUESTION_INTENTS) {
      const policy = INTENT_POLICY[intent];
      if (policy.strictVerdict && policy.response !== 'fixed') {
        expect(HOLDBACK_INTENTS.has(intent)).toBe(true);
      }
    }
    expect(HOLDBACK_INTENTS.has('fact')).toBe(false);
    expect(HOLDBACK_INTENTS.has('outside')).toBe(false);
    for (const [intent, query] of RISKY) expect(classifyQuestion(query)).toBe(intent);
    expect(classifyQuestion(FACT_QUERY)).toBe('fact');
  });

  test.each(RISKY)(
    'FR-QNA-004: 뒤 문장("맞아요.")이 앞 문장("범인은 집사.")을 판정으로 확정하면 앞 문장이 독자에게 나간 것 0건 — %s',
    async (intent, query) => {
      streamInChunks('범인은 집사. 맞아요. 그날 밤 그는 도망쳤어요.');
      const chunks = await collect(query);
      expect(loggedIntent()).toBe(intent);
      expect(chunks.filter((chunk) => /집사|맞아요|도망/u.test(chunk))).toHaveLength(0);
      expect(chunks).toEqual([HARNESS_FIXED_ANSWER]);
      expect(llmStream).toHaveBeenCalledTimes(1);
    }
  );

  test.each(RISKY)(
    'FR-QNA-004: 앞 문장들이 이미 나간 뒤에도 위반 문장 바로 앞 문장은 0건 — %s',
    async (_intent, query) => {
      streamInChunks('12쪽에서 그는 장갑을 벗었어요. 범인은 집사. 맞아요.');
      const out = (await collect(query)).join('');
      expect(out).not.toContain('집사');
      expect(out).toBe(`12쪽에서 그는 장갑을 벗었어요. \n\n${HARNESS_FIXED_ANSWER}`);
    }
  );

  test.each(RISKY)(
    'positive: 깨끗한 2문장 답은 위험 유형에서도 모두 나간다 — %s',
    async (_intent, query) => {
      const text = '12쪽에서 그는 장갑을 벗었어요. 그리고 방을 나갔어요.';
      streamInChunks(text);
      const chunks = await collect(query);
      expect(chunks.join('')).toBe(text);
      expect(chunks).toEqual(['12쪽에서 그는 장갑을 벗었어요. ', '그리고 방을 나갔어요.']);
    }
  );

  /** 첫 문장 뒤에서 모델을 멈춰 두고, 그동안 첫 문장이 나가는지 본다 */
  async function firstBeforeSecond(query: string): Promise<unknown> {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    (llmStream as jest.Mock).mockReset();
    (llmStream as jest.Mock).mockImplementation(async function* () {
      yield '12쪽에서 그는 장갑을 벗었어요. ';
      await gate;
      yield '그리고 방을 나갔어요.';
    });
    const iterator = ask(query);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const pendingFirst = iterator.next();
      const first = await Promise.race([
        pendingFirst,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve('held'), 200);
        }),
      ]);
      finish();
      const rest: string[] = [];
      if (first === 'held') {
        const r = await pendingFirst;
        if (!r.done) rest.push(r.value);
      }
      for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) rest.push(chunk);
      return { first, rest };
    } finally {
      if (timeout) clearTimeout(timeout);
      finish();
      await iterator.return(undefined).catch(() => {});
    }
  }

  test('positive: 사실 질문은 첫 문장이 둘째 문장이 오기 전에 나간다', async () => {
    const { first, rest } = (await firstBeforeSecond(FACT_QUERY)) as {
      first: unknown;
      rest: string[];
    };
    expect(first).toEqual({ done: false, value: '12쪽에서 그는 장갑을 벗었어요. ' });
    expect(rest).toEqual(['그리고 방을 나갔어요.']);
  });

  test.each(RISKY)(
    'FR-QNA-004: 위험 유형은 둘째 문장이 와서 함께 검사하기 전에는 첫 문장이 0자 나간다 — %s',
    async (_intent, query) => {
      const { first, rest } = (await firstBeforeSecond(query)) as {
        first: unknown;
        rest: string[];
      };
      expect(first).toBe('held');
      expect(rest).toEqual(['12쪽에서 그는 장갑을 벗었어요. ', '그리고 방을 나갔어요.']);
    }
  );

  async function timed(query: string): Promise<Record<string, number | undefined>> {
    let clock = 0;
    (llmStream as jest.Mock).mockReset();
    (llmStream as jest.Mock).mockImplementation(async function* () {
      clock += 100;
      yield '12쪽에서 그는 장갑을 벗었어요. ';
      clock += 900;
      yield '그리고 방을 나갔어요. ';
      clock += 500;
      yield '장갑은 탁자에 두었어요.';
    });
    const timing = createChatTiming(() => clock);
    for await (const _chunk of ask(query, timing)) void _chunk;
    return timing.snapshot();
  }

  test('NFR-PERF-008: 첫 문장이 검사 가능해진 시각(first_sentence_ready)과 보낸 시각(first_yield)을 함께 남긴다 — 사실 질문은 같다', async () => {
    const t = await timed(FACT_QUERY);
    expect(t.first_sentence_ready).toBe(100);
    expect(t.first_yield).toBe(100);
  });

  test('NFR-PERF-008: 위험 유형은 holdback으로 늦어진 시간(first_yield − first_sentence_ready)이 둘째 문장 도착까지다', async () => {
    const t = await timed('범인이 누구야?');
    expect(t.first_sentence_ready).toBe(100);
    expect(t.first_yield).toBe(1000);
  });
});
