import { handleQuery } from '../service';
import * as repo from '../repository';
import { vectorSearch } from '../vector-search';
import { stream as llmStream } from '../../llm-gateway/gateway';
import { HARNESS_FIXED_ANSWER } from '../harness/messages';

jest.mock('../repository');
jest.mock('../vector-search');
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

const BOOK_ID = 'gasangbeomin';
const DEVICE_ID = 'reader-A';
const OUTSIDE_QUERY = '김내성의 다른 작품도 알려줘';

function streamInChunks(text: string, size = 7): void {
  const mock = llmStream as jest.Mock;
  mock.mockReset();
  mock.mockImplementationOnce(async function* () {
    for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
  });
}

async function runChunks(K = 40, query = OUTSIDE_QUERY): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of handleQuery(BOOK_ID, query, K, DEVICE_ID)) chunks.push(chunk);
  return chunks;
}

describe('작품 밖 질문(outside) — 문장 단위로 검사한 뒤에만 내보낸다 (NFR-AI-005, FR-QNA-004 🚦)', () => {
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

  function harnessLog(): {
    intent: string;
    violations: string[][];
    regenerated: boolean;
    fixed_answer: boolean;
  } {
    const line = logSpy.mock.calls.find((call) => call[0] === '[Chatbot] Query log');
    return JSON.parse(line![1]).harness;
  }

  test('NFR-AI-005: outside 답변 중간의 범인 지목 문장은 독자에게 0건 나가고 고정 답변이 나간다', async () => {
    const first = '김내성은 1930년대에 활동한 작가예요. ';
    streamInChunks(`${first}이 작품의 범인은 나용귀입니다. 다른 작품도 추천해 드릴게요.`);
    const chunks = await runChunks();
    const out = chunks.join('');

    expect(chunks.filter((chunk) => /나용귀|범인/u.test(chunk))).toHaveLength(0);
    expect(out).not.toContain('추천');
    expect(out).toBe(`${first}\n\n${HARNESS_FIXED_ANSWER}`);
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(harnessLog()).toEqual({
      intent: 'outside',
      violations: [['verdict_phrase']],
      regenerated: false,
      fixed_answer: true,
    });
  });

  test('NFR-AI-005: 깨끗한 outside 답변은 전부, 순서대로, 여러 번에 나눠 나간다 (positive 쌍)', async () => {
    const sentences = [
      '김내성은 1930년대에 활동한 작가예요. ',
      '탐정 소설을 여러 편 남겼어요!\n',
      '다른 작품은 도서관에서 찾아보실 수 있어요? ',
      '끝맺음 없는 꼬리',
    ];
    streamInChunks(sentences.join(''), 1000);
    expect(await runChunks()).toEqual(sentences);

    streamInChunks(sentences.join(''), 7);
    const chunks = await runChunks();
    expect(chunks.join('')).toBe(sentences.join(''));
    expect(chunks.length).toBeGreaterThanOrEqual(sentences.length);
    expect(harnessLog()).toEqual({
      intent: 'outside',
      violations: [[]],
      regenerated: false,
      fixed_answer: false,
    });
  });

  test('NFR-AI-005: 첫 문장이 판정 표현이면 고정 답변만 나간다', async () => {
    streamInChunks('말씀하신 추리가 맞아요, 나용귀가 범인일 가능성이 높아요. 다른 책도 있어요.');
    expect(await runChunks()).toEqual([HARNESS_FIXED_ANSWER]);
  });

  test('NFR-AI-005: 문장 끝 표시 없이 끝난 꼬리의 범인 지목도 0건 나간다', async () => {
    const first = '그 영화는 저도 잘 몰라요.\n';
    streamInChunks(`${first}그런데 범인은 나용귀예요`);
    const out = (await runChunks()).join('');
    expect(out).toBe(`${first}\n\n${HARNESS_FIXED_ANSWER}`);
    expect(out).not.toContain('나용귀');
  });

  test('NFR-AI-005: 판정 표현이 청크 경계에 걸쳐 와도 0건 나간다', async () => {
    streamInChunks('The culprit is Na Yong-gwi. Enjoy the movie.', 5);
    const out = (await runChunks()).join('');
    expect(out).toBe(HARNESS_FIXED_ANSWER);
  });

  test('FR-QNA-004: K=40에서 95쪽을 가리키는 outside 문장은 0건 나간다', async () => {
    const first = '영화 이야기는 제가 잘 몰라요. ';
    streamInChunks(`${first}그 장면은 95쪽에 나와요. 다시 읽어 보세요.`);
    const chunks = await runChunks(40);
    expect(chunks.filter((chunk) => chunk.includes('95'))).toHaveLength(0);
    expect(chunks.join('')).toBe(`${first}\n\n${HARNESS_FIXED_ANSWER}`);
    expect(harnessLog().violations).toEqual([['page_beyond_cutoff']]);
  });

  test('FR-QNA-004: K=130에서는 같은 답변이 그대로 나간다 (positive 쌍)', async () => {
    // 대표 결정 2026-11-17: 묻지 않은 "다시 읽어 보세요"는 이제 steering_hint라, 쪽수 상한만 보는
    // 이 쌍에서는 사실 서술 문장으로 바꿨다
    const text = '영화 이야기는 제가 잘 몰라요. 그 장면은 95쪽에 나와요. 거기서 그는 장갑을 벗어요.';
    streamInChunks(text);
    const chunks = await runChunks(130);
    expect(chunks.join('')).toBe(text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(harnessLog().violations).toEqual([[]]);
  });

  test('FR-QNA-004: 소수점·쪽 표기의 마침표에서는 문장을 끊지 않는다', async () => {
    const text = '평점은 3.5점이에요. p.12를 보세요.';
    streamInChunks(text, 1000);
    expect(await runChunks()).toEqual(['평점은 3.5점이에요. ', 'p.12를 보세요.']);
  });
});
