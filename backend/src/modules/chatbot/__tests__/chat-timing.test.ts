import { handleQuery } from '../service';
import { assembleContext } from '../context-assembly';
import { getConversationContext, recordTurns } from '../conversation-service';
import * as repo from '../repository';
import { embedQuery } from '../../llm-gateway/embedding';
import { stream as llmStream } from '../../llm-gateway/gateway';
import { COUNTERS, DURATION_STAGES, ELAPSED_MARKS, createChatTiming } from '../timing';
import type { NotesReader } from '../notes-reader';

jest.mock('../context-assembly', () => ({
  assembleContext: jest.fn(),
  buildStableContextParts: () => ['bounded evidence', ''],
}));
jest.mock('../conversation-service', () => ({
  getConversationContext: jest.fn(),
  recordTurns: jest.fn(),
}));
jest.mock('../repository', () => ({
  lexicalSearch: jest.fn(),
  vectorSearch: jest.fn(),
  findAdjacentPages: jest.fn(),
}));
jest.mock('../../llm-gateway/embedding', () => ({
  embedQuery: jest.fn(),
  EMBEDDING_DIM: 1024,
  EMBEDDING_MODEL: 'test',
}));
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

/**
 * NFR-PERF-008, 대표 결정 2026-11-19 (E) — 챗봇 요청 하나의 단계별 시간.
 * 가짜 시계: 각 가짜 의존성이 "걸린 시간"만큼 시계를 앞으로 민다.
 */
const K = 40;
const QUERY = '장갑은 누가 벗었어?';
const ANSWER_1 = '12쪽에서 그는 장갑을 벗었어요. ';
const ANSWER_2 = '천천히 벗었어요.';

let clock = 0;
const advance = (ms: number) => {
  clock += ms;
};
const fakeNow = () => clock;

const notesReader: NotesReader = {
  listNotes: jest.fn(async () => {
    advance(7);
    return [];
  }),
};

function timingLog(logSpy: jest.SpyInstance): {
  book_id: string;
  cutoff_page: number;
  path: string;
  outcome: string;
  timings_ms: Record<string, number>;
} {
  const line = logSpy.mock.calls.find((call) => call[0] === '[Chatbot Timing]');
  expect(line).toBeDefined();
  return JSON.parse(line![1]);
}

describe('챗봇 단계별 시간 측정 (NFR-PERF-008, 대표 결정 2026-11-19 E)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    clock = 0;
    process.env.MOCK_MODE = 'false';
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    (assembleContext as jest.Mock).mockImplementation(async () => {
      advance(30);
      return {
        chapter_summaries: [],
        current_chapter_text: '',
        background: '',
        entities: { characters: [], relationships: [], character_notes: [], terms: [], events: [] },
      };
    });
    (getConversationContext as jest.Mock).mockImplementation(async () => {
      advance(20);
      return [];
    });
    (recordTurns as jest.Mock).mockImplementation(async () => {
      advance(5);
    });
    (repo.lexicalSearch as jest.Mock).mockImplementation(async () => {
      advance(3);
      return [{ page_no: 12, content: '그는 천천히 장갑을 벗었다.', distance: 1 }];
    });
    (embedQuery as jest.Mock).mockImplementation(async () => {
      advance(40);
      return [0.1];
    });
    (repo.vectorSearch as jest.Mock).mockImplementation(async () => {
      advance(4);
      return [];
    });
    (repo.findAdjacentPages as jest.Mock).mockResolvedValue([]);
    (llmStream as jest.Mock).mockImplementation(async function* () {
      advance(100);
      yield ANSWER_1;
      advance(200);
      yield ANSWER_2;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    logSpy.mockRestore();
  });

  async function ask(timing = createChatTiming(fakeNow)): Promise<string> {
    let out = '';
    for await (const chunk of handleQuery(
      'gasangbeomin',
      QUERY,
      K,
      'reader-A',
      7,
      undefined,
      undefined,
      false,
      { notesReader, timing }
    )) {
      out += chunk;
    }
    return out;
  }

  test('NFR-PERF-008: 모델 경로 요청은 모든 단계의 시간을 남긴다', async () => {
    const timing = createChatTiming(fakeNow);
    // 라우트 단계(기준점 스냅샷 등)는 라우트가 같은 측정기에 먼저 기록한다
    timing.add('snapshot', 11);
    const out = await ask(timing);
    expect(out).toBe(ANSWER_1 + ANSWER_2);

    const t = timing.snapshot();
    expect(t).toEqual(
      expect.objectContaining({
        snapshot: 11,
        context: 30,
        history: 20,
        embedding: 40,
        vector_search: 47,
        notes: 7,
        llm_first_token_wait: 100,
        llm_total: 300,
        record: 5,
        model_calls: 1,
        regenerations: 0,
      })
    );
    for (const stage of [
      'prompt',
      'guard',
      'llm_first_token',
      'first_yield',
      'total',
      'deltas',
    ] as const) {
      expect(typeof t[stage]).toBe('number');
    }
    // 요청 시작 → 첫 토큰 = 앞 단계(30+20+47+7) + 첫 토큰 대기 100
    expect(t.llm_first_token).toBe(204);
    // 전체 = 앞 단계 104 + 모델 300 + 대화 기록 저장 5
    expect(t.total).toBe(409);
    expect(t.first_yield!).toBeGreaterThanOrEqual(t.llm_first_token!);
    expect(t.first_yield!).toBeLessThanOrEqual(t.total!);
  });

  test('NFR-PERF-008: [Chatbot Timing] 한 줄에는 단계 이름과 숫자만 있고 질문·답·근거 내용은 없다', async () => {
    await ask();
    const log = timingLog(logSpy);
    expect(log).toEqual(
      expect.objectContaining({
        book_id: 'gasangbeomin',
        cutoff_page: K,
        path: 'guarded',
        outcome: 'ok',
      })
    );
    const allowed = new Set<string>([...DURATION_STAGES, ...ELAPSED_MARKS, ...COUNTERS]);
    for (const [name, value] of Object.entries(log.timings_ms)) {
      expect(allowed.has(name)).toBe(true);
      expect(Number.isInteger(value)).toBe(true);
    }
    const raw = logSpy.mock.calls.find((call) => call[0] === '[Chatbot Timing]')![1] as string;
    expect(raw).not.toContain('장갑');
    expect(raw).not.toContain(QUERY);
  });

  test('NFR-PERF-008: 측정기를 넘기지 않아도(라우트 밖 호출) 시간 기록이 남는다', async () => {
    let out = '';
    for await (const chunk of handleQuery('gasangbeomin', QUERY, K, 'reader-A')) out += chunk;
    expect(out).toBe(ANSWER_1 + ANSWER_2);
    const log = timingLog(logSpy);
    expect(log.timings_ms.model_calls).toBe(1);
    expect(typeof log.timings_ms.total).toBe('number');
  });

  test('NFR-PERF-008: 모델이 실패해도 시간 기록은 outcome=error로 남는다', async () => {
    (llmStream as jest.Mock).mockImplementation(async function* () {
      advance(50);
      throw new Error('provider down');
      yield '';
    });
    jest.spyOn(console, 'error').mockImplementation();
    await expect(ask()).rejects.toThrow('provider down');
    expect(timingLog(logSpy).outcome).toBe('error');
    expect(timingLog(logSpy).timings_ms.llm_total).toBe(50);
  });
});
