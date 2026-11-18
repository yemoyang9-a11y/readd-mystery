import { askChatbot } from './chatbotService';

vi.mock('../utils/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/constants')>()),
  USE_MOCK: false,
  API_BASE_URL: '/api',
}));

/**
 * 대표 지시 2026-11-18 — 챗봇 요청에 동봉하는 진도에 직전 화면 쪽(from_page)을 싣는다. 진도 POST 가 늦거나
 * 실패해도 질문할 때 차례 넘김이 서버에 닿는다. 기준점 숫자는 보내지 않는다 (절대 규칙 2·8번, FR-PRG-003 🚦).
 */
describe('askChatbot — 동봉 진도 (FR-PRG-003 🚦)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sentBody(...args: Parameters<typeof askChatbot>) {
    for await (const frame of askChatbot(...args)) void frame;
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  it('FR-PRG-003: 직전 화면 쪽이 있으면 from_page 로 싣는다', async () => {
    const body = await sentBody('book', '내 노트 보여?', 2, 7, undefined, undefined, 1);
    expect(body).toMatchObject({ query: '내 노트 보여?', page: 2, seq: 7, from_page: 1 });
  });

  it('FR-PRG-003: 직전 화면 쪽이 없으면 from_page 를 싣지 않는다', async () => {
    const body = await sentBody('book', '장갑은 누구 거야?', 2, 7, undefined, undefined, null);
    expect(body).not.toHaveProperty('from_page');
  });

  it('절대 규칙 8: 기준점 숫자를 싣지 않는다', async () => {
    const body = await sentBody('book', '장갑?', 2, 7, 3, undefined, 1);
    expect(Object.keys(body).sort()).toEqual(['conversationId', 'from_page', 'page', 'query', 'seq']);
  });
});
