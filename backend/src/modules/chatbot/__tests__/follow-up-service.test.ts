import { handleQuery, type ChatExtras } from '../service';
import * as repo from '../repository';
import { vectorSearch } from '../vector-search';
import { stream as llmStream } from '../../llm-gateway/gateway';

jest.mock('../repository');
jest.mock('../vector-search');
jest.mock('../../llm-gateway/gateway', () => ({ stream: jest.fn() }));

const BOOK_ID = 'gasangbeomin';
const DEVICE_ID = 'reader-A';
const QUERY = '장갑은 어디서 나왔어?';

function streamInChunks(text: string, size = 4): void {
  const mock = llmStream as jest.Mock;
  mock.mockReset();
  mock.mockImplementation(async function* () {
    for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
  });
}

async function run(K: number): Promise<{ out: string; extras: ChatExtras }> {
  const extras: ChatExtras = {};
  let out = '';
  for await (const chunk of handleQuery(
    BOOK_ID,
    QUERY,
    K,
    DEVICE_ID,
    undefined,
    undefined,
    undefined,
    false,
    { extras }
  ))
    out += chunk;
  return { out, extras };
}

describe('NFR-AI-005 🚦: 이어 묻기 질문과 근거 문장은 같은 답변 호출에서 나온다', () => {
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
      { page_no: 12, content: '그는 천천히 장갑을 벗었다. 비가 왔다.', distance: 0.1 },
    ]);
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    logSpy.mockRestore();
  });

  const ANSWER = '장갑은 p.12에서 벗는 장면으로 나와요.';

  test('표식 이후 글은 delta에 섞이지 않고, 안전한 질문 둘은 extras로 나간다 (positive)', async () => {
    streamInChunks(`${ANSWER}\n\n[다음 질문]\n그 장갑은 누구 거야?\n비는 언제부터 왔어?`);
    const { out, extras } = await run(40);
    expect(out).toBe(ANSWER);
    expect(out).not.toContain('다음 질문');
    expect(out).not.toContain('누구 거야');
    expect(extras.followUps).toEqual(['그 장갑은 누구 거야?', '비는 언제부터 왔어?']);
  });

  test('질문 하나가 범인 지목이면 follow_ups는 아예 없다 (negative)', async () => {
    streamInChunks(`${ANSWER}\n\n[다음 질문]\n그 장갑은 누구 거야?\n범인이 누구야?`);
    const { out, extras } = await run(40);
    expect(out).toBe(ANSWER);
    expect(extras.followUps).toBeUndefined();
  });

  test('질문 하나가 독자 가설 판정을 구하면 follow_ups는 아예 없다 (negative)', async () => {
    streamInChunks(`${ANSWER}\n\n[다음 질문]\n그 장갑은 누구 거야?\n내 추리가 맞아?`);
    const { extras } = await run(40);
    expect(extras.followUps).toBeUndefined();
  });

  test('질문이 출력 검사(기준점 초과 쪽 표기)에 걸리면 follow_ups는 없다 (negative)', async () => {
    streamInChunks(`${ANSWER}\n\n[다음 질문]\n그 장갑은 누구 거야?\np.130은 뭐야?`);
    const { extras } = await run(40);
    expect(extras.followUps).toBeUndefined();
  });

  test('표식이 없으면 follow_ups 재료는 없고, 근거 문장은 표식과 무관하게 나간다', async () => {
    streamInChunks(ANSWER);
    const { out, extras } = await run(40);
    expect(out).toBe(ANSWER);
    expect(extras.followUps).toBeUndefined();
    expect(extras.evidence).toEqual([{ page: 12, text: '그는 천천히 장갑을 벗었다.' }]);
  });

  test('표식이 없어도 기준점 밖 쪽의 근거 문장은 0건이다 (negative 쌍)', async () => {
    streamInChunks(ANSWER);
    const { extras } = await run(11);
    expect(extras.evidence).toBeUndefined();
  });

  const FOLLOW_UPS = '\n\n[다음 질문]\n그 장갑은 누구 거야?\n비는 언제부터 왔어?';

  test('근거 문장: 답에 나온 p.12(K=40 이하)는 원문 부분 문자열로 나간다 (positive)', async () => {
    streamInChunks(ANSWER + FOLLOW_UPS);
    const { extras } = await run(40);
    expect(extras.evidence).toEqual([{ page: 12, text: '그는 천천히 장갑을 벗었다.' }]);
  });

  test('근거 문장: 기준점이 12 미만이면 같은 질문에서도 항목 0건 (negative 쌍)', async () => {
    streamInChunks(ANSWER + FOLLOW_UPS);
    const { extras } = await run(11);
    expect(extras.evidence).toBeUndefined();
  });

  test('근거 문장: 답변이 막혀 고정 답변으로 끝나면 두 재료 모두 없다', async () => {
    streamInChunks(
      '범인은 김철수입니다. p.12\n\n[다음 질문]\n그 장갑은 누구 거야?\n비는 언제부터 왔어?'
    );
    const { extras } = await run(40);
    expect(extras.evidence).toBeUndefined();
    expect(extras.followUps).toBeUndefined();
  });
});
