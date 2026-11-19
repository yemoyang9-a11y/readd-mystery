import { handleQuery } from '../service';
import * as repo from '../repository';
import { vectorSearch } from '../vector-search';
import { stream as llmStream } from '../../llm-gateway/gateway';
import { HARNESS_FIXED_ANSWER } from '../harness/messages';
import { AMO_STYLE_RETRY_NOTICE } from '../harness/amo-style';

jest.mock('../repository');
jest.mock('../vector-search');
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

/**
 * NFR-AI-005, 대표 지시 2026-11-18 — 아모 말투·형식 검사가 응답 경로에 붙는지.
 * 판정·암시·쪽수 검사(기존 시험)는 그대로다. 대표 결정 2026-11-19 (A)로 작품 질문도 문장 단위로
 * 검사하며 내보내므로 재생성이 없다 — 되묻기 여러 개도 기록만 한다.
 */
const K = 40;

async function run(query: string): Promise<{ out: string; chunks: string[] }> {
  const chunks: string[] = [];
  for await (const chunk of handleQuery('gasangbeomin', query, K, 'reader-A')) chunks.push(chunk);
  return { out: chunks.join(''), chunks };
}

function answers(...texts: string[]): void {
  const mock = llmStream as jest.Mock;
  mock.mockReset();
  texts.forEach((text) =>
    mock.mockImplementationOnce(async function* () {
      yield text.slice(0, 4);
      yield text.slice(4);
    })
  );
}

describe('아모 말투·형식 검사 경로 (NFR-AI-005)', () => {
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
    harness: { violations: string[][]; regenerated: boolean; fixed_answer: boolean };
    amo_style: { findings: string[][] };
    logical_model_calls: number;
  } {
    const line = logSpy.mock.calls.find((call) => call[0] === '[Chatbot] Query log');
    return JSON.parse(line![1]);
  }

  function promptOf(call: number): string {
    return (llmStream as jest.Mock).mock.calls[call][1] as string;
  }

  test('NFR-AI-005: 되묻기가 두 개여도 재생성 없이 기록만 하고 그 답이 문장마다 나간다 (정상 답을 막지 않는다)', async () => {
    const text = '12쪽에서 그는 장갑을 벗었어요. 어떤 점이 궁금하세요? 다른 장면도 볼까요?';
    answers(text);
    const { out, chunks } = await run('장갑은 누가 벗었어?');
    expect(out).toBe(text);
    expect(out).not.toContain(HARNESS_FIXED_ANSWER);
    expect(chunks.length).toBeGreaterThan(1);
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(promptOf(0)).not.toContain(AMO_STYLE_RETRY_NOTICE);
    const log = queryLog();
    expect(log.harness.regenerated).toBe(false);
    expect(log.harness.fixed_answer).toBe(false);
    expect(log.amo_style.findings[0]).toContain('multi_question');
    expect(log.logical_model_calls).toBe(1);
  });

  test('NFR-AI-005: 되묻기가 하나면 재생성하지 않는다 (positive 쌍)', async () => {
    answers('12쪽에서 그는 장갑을 벗었어요. 어떤 점이 궁금하세요?');
    const { out } = await run('장갑은 누가 벗었어?');
    expect(out).toBe('12쪽에서 그는 장갑을 벗었어요. 어떤 점이 궁금하세요?');
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(queryLog().harness.regenerated).toBe(false);
  });

  test('NFR-AI-005: 되묻기 뒤에 판정 표현이 나오면 그 문장부터 0건, 고정 답변으로 맺는다', async () => {
    answers('12쪽이에요. 궁금하세요? 네, 맞아요. 범인이에요.');
    const { out, chunks } = await run('범인이 장갑 벗은 사람 맞지?');
    expect(chunks.filter((chunk) => /맞아요|범인이에요/u.test(chunk))).toHaveLength(0);
    // FR-QNA-004 🚦 holdback: 판정 위험 질문은 위반 문장 바로 앞 문장("궁금하세요?")도 나가지 않는다
    expect(out).toBe(`12쪽이에요. \n\n${HARNESS_FIXED_ANSWER}`);
    expect(queryLog().harness.fixed_answer).toBe(true);
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('NFR-AI-005: 청하지 않은 제목·글머리표·이모지는 지우고 내용은 남긴다', async () => {
    answers('## 정리 😊\n- 12쪽에서 그는 장갑을 벗었어요.');
    const { out } = await run('장갑은 누가 벗었어?');
    expect(out).toBe('정리\n12쪽에서 그는 장갑을 벗었어요.');
    expect(queryLog().amo_style.findings[0]).toEqual(
      expect.arrayContaining(['stripped_markdown', 'stripped_emoji'])
    );
  });

  test('NFR-AI-005: 목록을 청했으면 글머리표가 그대로 나간다 (positive 쌍)', async () => {
    answers('- 12쪽: 장갑을 벗음\n- 12쪽: 천천히 움직임');
    const { out } = await run('장갑 장면을 목록으로 정리해줘');
    expect(out).toBe('- 12쪽: 장갑을 벗음\n- 12쪽: 천천히 움직임');
  });

  test('NFR-AI-005: 출력 검사는 정리한 뒤의 글(화면에 보이는 글)로 본다', async () => {
    answers('범인**은** 김철수입니다.');
    expect((await run('범인 누구야?')).out).toBe(HARNESS_FIXED_ANSWER);
    expect(queryLog().harness.violations).toEqual([['verdict_phrase']]);
    answers('범인은🙂 김철수예요.');
    logSpy.mockClear();
    const { out } = await run('범인 누구야?');
    expect(out).toBe(HARNESS_FIXED_ANSWER);
    expect(out).not.toContain('김철수');
    expect(queryLog().harness.violations).toEqual([['verdict_phrase']]);
  });

  test('NFR-AI-005: 반말·길이 초과는 기록만 하고 답을 그대로 내보낸다', async () => {
    const text = '12쪽에서 그는 장갑을 벗었어. 천천히 벗었지. 그게 다야.';
    answers(text);
    const { out } = await run('장갑은 누가 벗었어?');
    expect(out).toBe(text);
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(queryLog().amo_style.findings[0]).toContain('register_banmal');
  });

  test('NFR-AI-005: 작품 밖 질문(문장 단위 경로)도 이모지를 지우고 내보낸다', async () => {
    answers('오늘 날씨는 제가 알 수 없어요 😊 대신 책 이야기를 해요.');
    const { out, chunks } = await run('오늘 날씨 어때?');
    expect(out).toBe('오늘 날씨는 제가 알 수 없어요 대신 책 이야기를 해요.');
    expect(chunks.join('')).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('NFR-AI-005: 작품 밖 질문의 되묻기 여러 개는 재생성 없이 기록만 한다', async () => {
    answers('날씨는 제가 알 수 없어요. 책은 어떠세요? 어디까지 읽으셨어요?');
    const { out } = await run('오늘 날씨 어때?');
    expect(out).toBe('날씨는 제가 알 수 없어요. 책은 어떠세요? 어디까지 읽으셨어요?');
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(queryLog().amo_style.findings[0]).toContain('multi_question');
  });

  test('NFR-AI-005: 질문마다 유형별 형식 지침이 프롬프트에 붙는다', async () => {
    answers('12쪽에서 그는 장갑을 벗었어요.');
    await run('장갑은 누가 벗었어?');
    expect(promptOf(0)).toContain('## 답변 형식 (이번 질문)');
    expect(promptOf(0).indexOf('## 답변 형식')).toBeLessThan(promptOf(0).indexOf('# 사용자 질문'));
  });
});
