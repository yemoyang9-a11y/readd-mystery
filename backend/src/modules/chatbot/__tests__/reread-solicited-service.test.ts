import { handleQuery } from '../service';
import * as repo from '../repository';
import { vectorSearch } from '../vector-search';
import { stream as llmStream } from '../../llm-gateway/gateway';
import { HARNESS_FIXED_ANSWER } from '../harness/messages';

jest.mock('../repository');
jest.mock('../vector-search');
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

/**
 * NFR-AI-005, 대표 결정 2026-11-17 — 서비스 경로 전체에서 다시 보기 권유가 위치 요청에만 나가는지.
 * 묻지 않은 권유: 위반 문장에서 끊고 고정 답변(guarded·outside 모두, 대표 결정 2026-11-19 — 재생성 없음).
 */

const BOOK_ID = 'gasangbeomin';
const DEVICE_ID = 'reader-A';
const UNASKED = '장갑은 누가 벗었어?';
const ASKED = '장갑 나온 데가 몇 쪽이야?';
const OUTSIDE_QUERY = '김내성의 다른 작품도 알려줘';

function answers(...texts: string[]): void {
  const mock = llmStream as jest.Mock;
  mock.mockReset();
  texts.forEach((text) =>
    mock.mockImplementationOnce(async function* () {
      for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7);
    })
  );
}

async function runChunks(query: string): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of handleQuery(BOOK_ID, query, 40, DEVICE_ID)) chunks.push(chunk);
  return chunks;
}

const REREAD_ANSWERS = [
  '12쪽을 다시 읽어 보세요.',
  '15쪽에 그 장면이 있어요, 다시 보세요.',
  '그 장면은 12쪽에 나와요. 다시 읽어 보세요.',
  '12쪽을 확인해 보세요.',
];

describe('다시 보기 권유는 장면 위치를 물었을 때만 나간다 (NFR-AI-005, 대표 결정 2026-11-17)', () => {
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

  function harnessLog(): { intent: string; violations: string[][]; fixed_answer: boolean } {
    const line = logSpy.mock.calls.find((call) => call[0] === '[Chatbot] Query log');
    return JSON.parse(line![1]).harness;
  }

  test.each(REREAD_ANSWERS)(
    'NFR-AI-005: 묻지 않았는데 "%s"가 나오면 권유 문장은 독자에게 0건, 고정 답변으로 맺는다',
    async (answer) => {
      answers(answer, answer);
      const chunks = await runChunks(UNASKED);
      expect(chunks.filter((c) => /다시|확인해/u.test(c))).toHaveLength(0);
      expect(chunks.join('').endsWith(HARNESS_FIXED_ANSWER)).toBe(true);
      // 재생성 없음 (대표 결정 2026-11-19)
      expect(llmStream).toHaveBeenCalledTimes(1);
      expect(harnessLog()).toMatchObject({
        intent: 'fact',
        violations: [['steering_hint']],
        fixed_answer: true,
      });
    }
  );

  test('NFR-AI-005: 권유만 있는 답은 모델 글 0자, 고정 답변만 나간다', async () => {
    answers('다시 읽어 보세요.', '호출되면 안 된다');
    expect(await runChunks(UNASKED)).toEqual([HARNESS_FIXED_ANSWER]);
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test.each(REREAD_ANSWERS)(
    'NFR-AI-005: 장면 위치를 물으면 "%s"는 재생성 없이 그대로 나간다 (positive 쌍)',
    async (answer) => {
      answers(answer);
      expect((await runChunks(ASKED)).join('')).toBe(answer);
      expect(llmStream).toHaveBeenCalledTimes(1);
      expect(harnessLog()).toMatchObject({ intent: 'fact', violations: [[]], fixed_answer: false });
    }
  );

  test.each([UNASKED, ASKED])(
    'NFR-AI-005: 쪽수를 출처로 붙인 사실 서술은 "%s" 질문에서 그대로 나간다',
    async (query) => {
      answers('12쪽에서 그는 장갑을 벗었어요.');
      expect((await runChunks(query)).join('')).toBe('12쪽에서 그는 장갑을 벗었어요.');
      expect(llmStream).toHaveBeenCalledTimes(1);
    }
  );

  test('NFR-AI-005: outside 문장 단위 경로도 같은 규칙 — 묻지 않은 다시 보기 권유 문장은 0건 나간다', async () => {
    const first = '김내성은 1930년대에 활동한 작가예요. ';
    answers(`${first}다시 읽어 보세요. 다른 작품도 있어요.`);
    const chunks = await runChunks(OUTSIDE_QUERY);
    expect(chunks.filter((c) => c.includes('다시'))).toHaveLength(0);
    expect(chunks.join('')).toBe(`${first}\n\n${HARNESS_FIXED_ANSWER}`);
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(harnessLog()).toMatchObject({ intent: 'outside', violations: [['steering_hint']] });
  });

  test('NFR-AI-005: outside 경로에서 쪽수 인용 사실 서술은 그대로 나간다 (positive 쌍)', async () => {
    const text = '김내성은 1930년대에 활동한 작가예요. 12쪽에서 그는 장갑을 벗었어요.';
    answers(text);
    expect((await runChunks(OUTSIDE_QUERY)).join('')).toBe(text);
    expect(harnessLog()).toMatchObject({ intent: 'outside', violations: [[]] });
  });
});
