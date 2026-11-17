import { handleQuery } from '../service';
import * as repo from '../repository';
import { vectorSearch } from '../vector-search';
import { stream as llmStream } from '../../llm-gateway/gateway';
import { HARNESS_VERBATIM_ANSWER } from '../harness/messages';
import { verbatimLength } from '../harness/output-guard';

jest.mock('../repository');
jest.mock('../vector-search');
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

const BOOK_ID = 'gasangbeomin';
const DEVICE_ID = 'reader-A';
const K = 40;

// 공백 없는 가짜 원문 400자 (한글 음절)
const SOURCE = Array.from({ length: 400 }, (_, i) =>
  String.fromCharCode(0xac00 + ((i * 37 + 11) % 11172))
).join('');

async function run(query: string): Promise<string> {
  let out = '';
  for await (const chunk of handleQuery(BOOK_ID, query, K, DEVICE_ID)) out += chunk;
  return out;
}

function answers(...texts: string[]): void {
  const mock = llmStream as jest.Mock;
  mock.mockReset();
  texts.forEach((text) =>
    mock.mockImplementationOnce(async function* () {
      yield text.slice(0, 3);
      yield text.slice(3);
    })
  );
}

describe('원문 출력 상한 — 챗봇 응답 (답변당 합계 200자)', () => {
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
      { page_no: 12, content: SOURCE, distance: 0.1 },
    ]);
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    logSpy.mockRestore();
  });

  function harnessLog(): { violations: string[][]; regenerated: boolean; fixed_answer: boolean } {
    const line = logSpy.mock.calls.find((call) => call[0] === '[Chatbot] Query log');
    return JSON.parse(line![1]).harness;
  }

  test('원문을 두 번 연속 200자 넘게 옮기면 원문 상한 안내로 대체되고 로그에 남는다', async () => {
    answers(SOURCE.slice(0, 300), SOURCE.slice(50, 350));
    const out = await run('12쪽 원문 그대로 전부 보여줘');
    expect(out).toBe(HARNESS_VERBATIM_ANSWER);
    expect(out).not.toContain(SOURCE.slice(0, 20));
    expect(llmStream).toHaveBeenCalledTimes(2);
    expect(harnessLog()).toEqual(
      expect.objectContaining({
        violations: [['verbatim_over_limit'], ['verbatim_over_limit']],
        regenerated: true,
        fixed_answer: true,
      })
    );
  });

  test('재생성 지시에 원문 상한이 들어가고, 재생성 답이 상한 안이면 그 답이 나간다 (positive 쌍)', async () => {
    const short = `12쪽의 그 장면은 이렇게 시작해요. ${SOURCE.slice(0, 60)}`;
    answers(SOURCE.slice(0, 300), short);
    const out = await run('12쪽 원문 그대로 전부 보여줘');
    expect(out).toBe(short);
    const retryPrompt = (llmStream as jest.Mock).mock.calls[1][1] as string;
    expect(retryPrompt).toContain('200자');
    expect(harnessLog().violations).toEqual([['verbatim_over_limit'], []]);
  });

  test('현재 장 원문에서 옮긴 것도 센다', async () => {
    (vectorSearch as jest.Mock).mockResolvedValue([]);
    (repo.getCurrentChapterText as jest.Mock).mockResolvedValue(`[p.30]\n${SOURCE}`);
    answers(SOURCE.slice(0, 260), SOURCE.slice(0, 260));
    expect(await run('이번 장 처음부터 그대로 적어줘')).toBe(HARNESS_VERBATIM_ANSWER);
  });

  describe('작품 밖 질문(outside) — 스트리밍하면서 원문 200자에서 끊는다', () => {
    function streamInChunks(text: string, size = 20): void {
      const mock = llmStream as jest.Mock;
      mock.mockReset();
      mock.mockImplementationOnce(async function* () {
        for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
      });
    }

    async function runChunks(query: string): Promise<string[]> {
      const chunks: string[] = [];
      for await (const chunk of handleQuery(BOOK_ID, query, K, DEVICE_ID)) chunks.push(chunk);
      return chunks;
    }

    test('FR-QNA-004: outside 답변도 원문 일치가 200자를 넘는 순간 끊겨 나간 텍스트의 원문 일치는 0건 초과 없음', async () => {
      streamInChunks(SOURCE.slice(0, 300));
      const chunks = await runChunks('이 쪽 번역해줘');
      const out = chunks.join('');
      const copied = out.endsWith(HARNESS_VERBATIM_ANSWER)
        ? out.slice(0, out.length - HARNESS_VERBATIM_ANSWER.length)
        : out;
      expect(out.endsWith(HARNESS_VERBATIM_ANSWER)).toBe(true);
      expect(verbatimLength(copied, [SOURCE])).toBeLessThanOrEqual(200);
      expect(out).not.toContain(SOURCE.slice(0, 260));
      // 스트리밍은 유지된다: 끊기기 전까지 여러 청크로 나간다
      expect(chunks.length).toBeGreaterThan(2);
      expect(llmStream).toHaveBeenCalledTimes(1);
      expect(JSON.parse(logSpy.mock.calls.find((c) => c[0] === '[Chatbot] Query log')![1]).harness)
        .toEqual(expect.objectContaining({ intent: 'outside', violations: [['verbatim_over_limit']] }));
    });

    test('FR-QNA-004: outside 답변이 원문 200자 이하면 끊지 않고 그대로 스트리밍한다 (positive 쌍)', async () => {
      const text = `번역은 제가 해 드릴 수 없어요. ${SOURCE.slice(0, 150)}`;
      streamInChunks(text);
      const chunks = await runChunks('이 쪽 번역해줘');
      expect(chunks.join('')).toBe(text);
      expect(chunks.length).toBeGreaterThan(2);
      expect(
        JSON.parse(logSpy.mock.calls.find((c) => c[0] === '[Chatbot] Query log')![1]).harness
          .violations
      ).toEqual([[]]);
    });

    test('FR-QNA-004: 현재 장 원문에서 옮긴 outside 답변도 200자에서 끊긴다', async () => {
      (vectorSearch as jest.Mock).mockResolvedValue([]);
      (repo.getCurrentChapterText as jest.Mock).mockResolvedValue(`[p.30]\n${SOURCE}`);
      streamInChunks(SOURCE.slice(0, 300));
      const out = (await runChunks('이번 장 번역해줘')).join('');
      expect(out.endsWith(HARNESS_VERBATIM_ANSWER)).toBe(true);
      expect(out).not.toContain(SOURCE.slice(0, 260));
    });
  });
});
