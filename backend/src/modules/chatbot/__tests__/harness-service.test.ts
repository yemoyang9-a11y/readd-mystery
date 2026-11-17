import { handleQuery } from '../service';
import * as repo from '../repository';
import { vectorSearch } from '../vector-search';
import { stream as llmStream } from '../../llm-gateway/gateway';
import { HARNESS_FIXED_ANSWER, HARNESS_PREDICTION_ANSWER } from '../harness/messages';
import { buildNotesSection } from '../harness/notes-section';
import type { NotesReader } from '../notes-reader';

jest.mock('../repository');
jest.mock('../vector-search');
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

const BOOK_ID = 'gasangbeomin';
const DEVICE_ID = 'reader-A';
const K = 40;

async function run(query: string, notesReader?: NotesReader): Promise<string> {
  let out = '';
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
    out += chunk;
  }
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

describe('챗봇 하네스 (FR-QNA-004 🚦, NFR-AI-005)', () => {
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

  function harnessLog(): { intent: string; violations: string[][]; regenerated: boolean; fixed_answer: boolean } {
    const line = logSpy.mock.calls.find((call) => call[0] === '[Chatbot] Query log');
    return JSON.parse(line![1]).harness;
  }

  test('FR-QNA-004: 판정 단어가 두 번 나오면 고정 답변이며 근거 범위는 같은 cutoff', async () => {
    answers('네, 맞아요! 범인이에요.', '정답이에요.');
    const out = await run('범인은 ○○ 맞지? 예/아니오로만');
    expect(out).toBe(HARNESS_FIXED_ANSWER);
    expect(llmStream).toHaveBeenCalledTimes(2);
    expect((vectorSearch as jest.Mock).mock.calls.every((call) => call[2] === K)).toBe(true);
    expect(harnessLog()).toEqual({
      intent: 'culprit_or_ending',
      violations: [['verdict_phrase'], ['verdict_phrase']],
      regenerated: true,
      fixed_answer: true,
    });
  });

  test('FR-QNA-004: 첫 답이 위반이고 재생성이 깨끗하면 재생성 답만 나간다 (positive 쌍)', async () => {
    answers('정답이에요.', '12쪽에서 그가 장갑을 벗는 장면이 나와요.');
    const out = await run('내 가설이 맞는지 확인해줘');
    expect(out).toBe('12쪽에서 그가 장갑을 벗는 장면이 나와요.');
    expect(llmStream).toHaveBeenCalledTimes(2);
    expect(harnessLog().fixed_answer).toBe(false);
    expect(harnessLog().violations).toEqual([['verdict_phrase'], []]);
  });

  test('FR-QNA-004: cutoff 초과 쪽수는 재생성 후에도 남으면 고정 답변', async () => {
    answers('범위 밖 55쪽을 보세요.', '55쪽을 보세요.');
    const out = await run('결말이 어떻게 돼?');
    expect(out).toBe(HARNESS_FIXED_ANSWER);
    expect(harnessLog().violations).toEqual([['page_beyond_cutoff'], ['page_beyond_cutoff']]);
  });

  test('FR-QNA-004: 위반 없는 답변은 한 번만 생성한다', async () => {
    answers('12쪽에 장갑 장면이 있어요.');
    expect(await run('범인 단서를 찾아줘')).toBe('12쪽에 장갑 장면이 있어요.');
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('NFR-AI-005: 예측 요청은 모델 호출 없이 고정 답변', async () => {
    answers('호출되면 안 된다');
    expect(await run('앞으로 어떻게 될까?')).toBe(HARNESS_PREDICTION_ANSWER);
    expect(llmStream).not.toHaveBeenCalled();
  });

  test('FR-QNA-004: 작품 밖 질문만 문장 단위로 검사하며 스트리밍한다', async () => {
    answers('날씨는 제가 알 수 없어요. 대신 책 이야기를 해요.');
    const chunks: string[] = [];
    for await (const chunk of handleQuery(BOOK_ID, '오늘 날씨 어때?', K, DEVICE_ID)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(1);
    expect(harnessLog().intent).toBe('outside');
  });

  test('FR-QNA-004: fact로 분류된 답변도 검사 전에는 나가지 않고, 판정 표현이면 고정 답변으로 대체된다', async () => {
    answers('부인이 범인일 가능성이 높아 보여요.', '네, 그렇게 보셔도 무리가 없어요.');
    const chunks: string[] = [];
    for await (const chunk of handleQuery(BOOK_ID, '장갑은 누구 거야?', K, DEVICE_ID)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([HARNESS_FIXED_ANSWER]);
    expect(harnessLog().intent).toBe('fact');
    expect(harnessLog().fixed_answer).toBe(true);
  });

  test('FR-QNA-004: fact로 분류된 깨끗한 답변은 검사 후 그대로 나간다 (positive 쌍)', async () => {
    answers('장갑은 12쪽에 나와요.');
    expect(await run('장갑은 어디 나와?')).toBe('장갑은 12쪽에 나와요.');
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('FR-QNA-004: 노트는 같은 reader의 것만 들어가며 cutoff 초과 쪽 노트는 빠진다', async () => {
    const notesReader: NotesReader = {
      listNotes: jest.fn(async (readerId: string) =>
        readerId === DEVICE_ID
          ? [
              { page_no: 12, kind: 'hypothesis' as const, body: '내 메모 하나' },
              { page_no: 90, kind: 'clue' as const, body: '범위 밖 메모' },
            ]
          : [{ page_no: 5, kind: 'clue' as const, body: '남의 메모' }]
      ),
    };
    answers('12쪽을 다시 읽어 보세요.');
    await run('내 가설이 맞는지 확인해줘', notesReader);
    // FR-SPL-002: 노트 조회에도 같은 cutoff가 인자로 간다
    expect(notesReader.listNotes).toHaveBeenCalledWith(DEVICE_ID, BOOK_ID, K);
    const prompt = (llmStream as jest.Mock).mock.calls[0][1] as string;
    expect(prompt).toContain('내 메모 하나');
    expect(prompt).not.toContain('범위 밖 메모');
    expect(prompt).not.toContain('남의 메모');
  });

  test('FR-SPL-002: 노트가 20개를 넘어도 질문과 낱말이 겹치는 노트와 가장 최근 노트가 프롬프트에 들어간다', async () => {
    const stamp = (minute: number) => new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString();
    const notesReader: NotesReader = {
      listNotes: async () => [
        { page_no: 1, kind: 'clue' as const, body: '장갑 안쪽에 얼룩', created_at: stamp(0) },
        ...Array.from({ length: 29 }, (_, i) => ({
          page_no: i + 2,
          kind: 'clue' as const,
          body: `메모 ${i + 2}번`,
          created_at: stamp(i + 1),
        })),
      ],
    };
    answers('12쪽에 나와요.');
    await run('장갑은 어디 나와?', notesReader);
    const prompt = (llmStream as jest.Mock).mock.calls[0][1] as string;
    expect(prompt).toContain('장갑 안쪽에 얼룩');
    expect(prompt).toContain('"메모 30번"');
    expect(prompt.split('\n').filter((line) => line.startsWith('- p.'))).toHaveLength(20);
  });

  test('FR-SPL-002: buildNotesSection은 cutoff 인자를 받아 초과 노트를 거른다', () => {
    const notes = [
      { page_no: 3, kind: 'clue' as const, body: 'a' },
      { page_no: 41, kind: 'clue' as const, body: 'b' },
    ];
    expect(buildNotesSection(notes, 40)).toContain('p.3');
    expect(buildNotesSection(notes, 40)).not.toContain('p.41');
    expect(buildNotesSection(notes, 0)).toBe('');
  });
});
