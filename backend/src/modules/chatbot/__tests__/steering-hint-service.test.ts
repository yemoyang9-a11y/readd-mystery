import { handleQuery } from '../service';
import * as repo from '../repository';
import { vectorSearch } from '../vector-search';
import { stream as llmStream } from '../../llm-gateway/gateway';
import { HARNESS_FIXED_ANSWER } from '../harness/messages';
import type { NotesReader } from '../notes-reader';

jest.mock('../repository');
jest.mock('../vector-search');
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

const BOOK_ID = 'gasangbeomin';
const DEVICE_ID = 'reader-A';

function answers(...texts: string[]): void {
  const mock = llmStream as jest.Mock;
  mock.mockReset();
  texts.forEach((text) =>
    mock.mockImplementationOnce(async function* () {
      for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7);
    })
  );
}

async function runChunks(query: string, K = 40, notesReader?: NotesReader): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of handleQuery(
    BOOK_ID,
    query,
    K,
    DEVICE_ID,
    undefined,
    undefined,
    undefined,
    false,
    notesReader ? { notesReader } : undefined
  )) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('암시형 답변은 재생성 1회 뒤 고정 답변으로 바뀐다 (NFR-AI-005, FR-QNA-004 🚦)', () => {
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

  test('NFR-AI-005: 암시 답이 두 번 나오면 독자에게 0건 나가고 고정 답변만 나간다', async () => {
    answers('그 장면을 다시 보세요.', '장갑에 주목해 보세요. 중요한 단서예요.');
    const chunks = await runChunks('내 가설이 맞는지 확인해줘');
    expect(chunks).toEqual([HARNESS_FIXED_ANSWER]);
    expect(llmStream).toHaveBeenCalledTimes(2);
    expect(harnessLog()).toMatchObject({
      intent: 'verify_hypothesis',
      violations: [['steering_hint'], ['steering_hint']],
      fixed_answer: true,
    });
    // 재생성 요청에는 암시 금지 지침이 붙는다
    const retryPrompt = (llmStream as jest.Mock).mock.calls[1][1] as string;
    expect(retryPrompt).toContain('## 암시 금지 지침');
    expect((llmStream as jest.Mock).mock.calls[0][1]).not.toContain('## 암시 금지 지침');
  });

  test('NFR-AI-005: 첫 답이 칭찬 확인이고 재생성이 중립이면 재생성 답만 나간다 (positive 쌍)', async () => {
    answers('거의 맞았어요!', '12쪽에서 그가 장갑을 벗는 장면이 나와요.');
    const chunks = await runChunks('내 가설이 맞는지 확인해줘');
    expect(chunks).toEqual(['12쪽에서 그가 장갑을 벗는 장면이 나와요.']);
    expect(harnessLog().violations).toEqual([['steering_hint'], []]);
    expect(harnessLog().fixed_answer).toBe(false);
  });

  test('NFR-AI-005: 사실 질문으로 분류돼도 암시 답은 0건 나간다', async () => {
    answers('그 인물의 말투를 눈여겨보세요.', '그 대사를 놓치지 마세요.');
    expect(await runChunks('장갑은 누구 거야?')).toEqual([HARNESS_FIXED_ANSWER]);
    expect(harnessLog().intent).toBe('fact');
  });

  test('NFR-AI-005: 읽은 범위의 사실을 옮긴 답은 한 번에 그대로 나간다 (positive 쌍)', async () => {
    answers('12쪽에서 그는 장갑을 벗었어요.');
    expect(await runChunks('장갑은 누구 거야?')).toEqual(['12쪽에서 그는 장갑을 벗었어요.']);
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('NFR-AI-005: outside 답변 중간의 암시 문장은 0건 나가고 고정 답변으로 맺는다', async () => {
    const first = '김내성은 1930년대에 활동한 작가예요. ';
    answers(`${first}그런데 12쪽의 장갑이 중요한 단서예요. 다른 작품도 있어요.`);
    const chunks = await runChunks('김내성의 다른 작품도 알려줘');
    expect(chunks.filter((chunk) => /단서|장갑/u.test(chunk))).toHaveLength(0);
    expect(chunks.join('')).toBe(`${first}\n\n${HARNESS_FIXED_ANSWER}`);
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(harnessLog().violations).toEqual([['steering_hint']]);
  });

  test('NFR-AI-005: 암시가 없는 outside 답변은 전부 나간다 (positive 쌍)', async () => {
    const text = '김내성은 1930년대에 활동한 작가예요. 탐정 소설을 여러 편 남겼어요.';
    answers(text);
    expect((await runChunks('김내성의 다른 작품도 알려줘')).join('')).toBe(text);
    expect(harnessLog().violations).toEqual([[]]);
  });

  const noteBody = '장갑이 중요한 단서 같다';
  const notesAt = (page: number): NotesReader => ({
    // FR-SPL-002 🚦: 조회 계층과 같이 cutoff 이하 노트만 돌려준다
    listNotes: async (_reader, _book, cutoff) =>
      [{ page_no: page, kind: 'clue' as const, body: noteBody }].filter((n) => n.page_no <= cutoff),
  });
  const quoting = `12쪽 노트에 "${noteBody}"라고 적으셨어요.`;

  test('NFR-AI-005: 독자가 K 이하 쪽에 쓴 노트를 따옴표로 옮긴 답은 그대로 나간다 (positive 쌍)', async () => {
    answers(quoting);
    expect(await runChunks('내가 적은 노트 보여줘', 40, notesAt(12))).toEqual([quoting]);
    expect(harnessLog().violations).toEqual([[]]);
  });

  test('NFR-AI-005: 독자 노트에 없는 같은 문장은 0건 나간다', async () => {
    answers(quoting, quoting);
    expect(await runChunks('내가 적은 노트 보여줘', 40)).toEqual([HARNESS_FIXED_ANSWER]);
    expect(harnessLog().violations[1]).toContain('steering_hint');
  });
});
