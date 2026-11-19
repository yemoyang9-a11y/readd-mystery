/**
 * 대표 지시 2026-11-18 — 독자가 "내 노트 보여?"라고 물으면 고정 거절 대신 노트를 근거로 답한다.
 * 노트는 기준 쪽수(K) 이하만 넣는다(FR-SPL-002 🚦). K 이하 노트가 없으면 "노트가 안 보인다"가 아니라
 * K쪽까지 적은 노트만 볼 수 있다고 그대로 말한다(모델 호출 없음). K 초과 노트는 읽지도 세지도 않는다
 * (절대 규칙 7 — 이 경로는 K 이하 조회 결과만 본다).
 */
import { handleQuery } from '../service';
import * as repo from '../repository';
import { vectorSearch } from '../vector-search';
import { stream as llmStream } from '../../llm-gateway/gateway';
import { HARNESS_FIXED_ANSWER, readerNotesEmptyAnswer } from '../harness/messages';
import type { NotesReader, ReaderNote } from '../notes-reader';

jest.mock('../repository');
jest.mock('../vector-search');
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

const BOOK_ID = 'bk-95898cdf13';
const DEVICE_ID = 'reader-A';
const NOTE: ReaderNote = {
  page_no: 2,
  kind: 'hypothesis',
  body: '누가 범인일까 연극을 계획한 사람?',
  created_at: '2026-11-18T08:00:00.000Z',
};

/** 실제 저장소(pg-repository listNotes)처럼 page_no <= cutoff 만 돌려준다 */
function readerWith(notes: ReaderNote[]): NotesReader & { listNotes: jest.Mock } {
  return {
    listNotes: jest.fn(async (_reader: string, _book: string, cutoff: number) =>
      notes.filter((note) => note.page_no >= 1 && note.page_no <= cutoff)
    ),
  };
}

async function run(query: string, K: number, notesReader: NotesReader): Promise<string> {
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
    { notesReader }
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
      yield text;
    })
  );
}

describe('챗봇이 독자 노트 질문에 답한다 (대표 지시 2026-11-18, NFR-AI-005, FR-SPL-002 🚦)', () => {
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
      { page_no: 2, content: '유불란은 그날 밤 극장에서 연극을 보고 있었다.', distance: 0.1 },
    ]);
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    logSpy.mockRestore();
  });

  function queryLog(): {
    cutoff_page: number;
    model: string;
    harness: { intent: string; violations: string[][]; fixed_answer: boolean };
  } {
    const line = logSpy.mock.calls.find((call) => call[0] === '[Chatbot] Query log');
    return JSON.parse(line![1]);
  }

  test('NFR-AI-005: "내 노트 보여?"는 노트를 넣어 답하고, 노트를 그대로 옮긴 답은 고정 거절로 바뀌지 않는다', async () => {
    const notesReader = readerWith([NOTE]);
    const reply = `네, 보여요. 2쪽에 가설로 “${NOTE.body}”라고 적어 두셨어요.`;
    answers(reply);
    const out = await run('내 노트 보여?', 2, notesReader);

    expect(out).toBe(reply);
    expect(out).not.toBe(HARNESS_FIXED_ANSWER);
    expect(llmStream).toHaveBeenCalledTimes(1);
    // FR-SPL-002 🚦 — 노트 조회는 같은 스냅샷의 K를 인자로 받는다 (한 번만 조회)
    expect(notesReader.listNotes).toHaveBeenCalledTimes(1);
    expect(notesReader.listNotes).toHaveBeenCalledWith(DEVICE_ID, BOOK_ID, 2);
    const prompt = (llmStream as jest.Mock).mock.calls[0][1] as string;
    expect(prompt).toContain(NOTE.body);
    expect(prompt).toContain('독자 노트 요청');
    expect(prompt).toContain('2쪽까지');
    expect(queryLog().harness).toMatchObject({
      intent: 'reader_notes',
      violations: [[]],
      fixed_answer: false,
    });
  });

  // 대표 결정 2026-11-19 (A): 문장 단위로 검사하며 내보내고 재생성하지 않는다
  test('FR-QNA-004: 노트 질문이어도 따옴표 밖에서 가설을 판정하면 고정 답변 (0건 통과, 재생성 없음)', async () => {
    answers(`“${NOTE.body}”라고 적으셨는데, 맞아요.`, '호출되면 안 된다');
    const out = await run('내 노트 보여?', 2, readerWith([NOTE]));
    expect(out).toBe(HARNESS_FIXED_ANSWER);
    expect(llmStream).toHaveBeenCalledTimes(1);
    expect(queryLog().harness).toMatchObject({
      intent: 'reader_notes',
      violations: [['verdict_phrase']],
      fixed_answer: true,
    });
  });

  test('FR-QNA-004: 범인 확인 요청은 노트 유형이 아니며 판정 답은 0건 통과한다 (negative 쌍)', async () => {
    answers('네, 맞아요. 연극을 계획한 사람이 범인이에요.', '정답이에요.');
    const out = await run('범인 연극을 계획한 사람 맞지?', 2, readerWith([NOTE]));
    expect(out).toBe(HARNESS_FIXED_ANSWER);
    expect(queryLog().harness.intent).toBe('culprit_or_ending');
  });

  test('FR-SPL-002 🚦: K 이하 노트가 없으면 모델을 부르지 않고, 노트가 안 보인다고 하지 않는다', async () => {
    const notesReader = readerWith([NOTE]); // 노트는 2쪽, 기준 쪽수는 1
    answers('호출되면 안 된다');
    const out = await run('내 노트 보여?', 1, notesReader);

    expect(llmStream).not.toHaveBeenCalled();
    expect(notesReader.listNotes).toHaveBeenCalledWith(DEVICE_ID, BOOK_ID, 1);
    expect(out).toBe(readerNotesEmptyAnswer(1));
    expect(out).toContain('1쪽까지');
    expect(out).not.toMatch(/안\s*보|보이지\s*않/u);
    // 절대 규칙 7 — K 초과 노트의 내용·개수를 답에 싣지 않는다
    expect(out).not.toContain(NOTE.body);
    expect(out).not.toContain('2쪽');
    const log = queryLog();
    expect(log.cutoff_page).toBe(1);
    expect(log.model).toBe('canned:harness-reader-notes-empty');
    expect(log.harness).toMatchObject({ intent: 'reader_notes', fixed_answer: true });
  });

  test('FR-SPL-002 🚦: 기준 쪽수가 2쪽으로 오르면 같은 노트가 들어간다 (positive 쌍)', async () => {
    answers(`2쪽에 “${NOTE.body}”라고 적어 두셨어요.`);
    const out = await run('내 노트 보여?', 2, readerWith([NOTE]));
    expect(out).toContain(NOTE.body);
    expect(llmStream).toHaveBeenCalledTimes(1);
  });

  test('FR-SPL-005 🚦: 노트 조회가 실패하면 "노트가 없다"고 답하지 않고 실패로 끝난다', async () => {
    const notesReader: NotesReader = {
      listNotes: jest.fn(async () => {
        throw new Error('db down');
      }),
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    answers('호출되면 안 된다');
    await expect(run('내 노트 보여?', 2, notesReader)).rejects.toThrow();
    expect(llmStream).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('FR-SPL-002 🚦: 노트를 언급한 다른 질문에서 K 이하 노트가 없으면 범위를 알리는 안내만 넣는다', async () => {
    answers('1쪽까지 적으신 노트는 아직 없어요.');
    await run('내 노트에 쓴 가설 맞아?', 1, readerWith([NOTE]));
    const prompt = (llmStream as jest.Mock).mock.calls[0][1] as string;
    expect(prompt).toContain('1쪽까지 적은 노트는 없습니다');
    expect(prompt).not.toContain(NOTE.body);
    expect(queryLog().harness.intent).toBe('verify_hypothesis');
  });
});
