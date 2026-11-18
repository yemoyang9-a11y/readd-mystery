/**
 * POST /books/:bookId/chat 에 동봉된 진도 (page, seq, from_page) — 대표 지시 2026-11-18
 *
 * 챗봇 요청은 "쪽을 넘기자마자 물어도 그 쪽이 반영되게" 진도를 함께 싣는다(3.3절). 2026-11-17부터
 * 기준점은 차례 넘김(from_page + 1 = page)으로만 오르는데, 챗봇 요청이 from_page 를 버려서 진도 POST 가
 * 늦거나 실패한 쪽은 질문해도 기준점에 들어가지 않았다(2쪽에서 노트를 쓰고 물었는데 기준점 1).
 * from_page 는 이동 사실일 뿐 기준점 숫자가 아니다 (절대 규칙 8번, FR-PRG-003 🚦).
 */

const mockState = {
  findReadiness: jest.fn(),
  acceptProgressEvent: jest.fn(),
  touchActivity: jest.fn(),
  getCutoffSnapshot: jest.fn(),
  handleQuery: jest.fn(),
  checkRateLimit: jest.fn(),
};

jest.mock('../../../src/config/database', () => ({ pool: {} }));
jest.mock('../../../src/modules/reading-state/composition', () => ({
  createReadingStateServices: () => ({
    progressService: { acceptProgressEvent: mockState.acceptProgressEvent },
    sessionService: { touchActivity: mockState.touchActivity },
    cutoffService: { getCutoffSnapshot: mockState.getCutoffSnapshot },
  }),
}));
jest.mock('../../../src/modules/content/composition', () => ({
  createContentServices: () => ({
    content: { findReadiness: mockState.findReadiness },
    pageService: { getPage: jest.fn(async () => null) },
  }),
}));
jest.mock('../../../src/modules/ssabi/composition', () => ({ createSsabiServices: () => ({}) }));
jest.mock('../../../src/modules/chatbot/conversation-service', () => ({
  resolveConversation: jest.fn(async () => ({ conversationId: 7 })),
  parseConversationId: jest.fn(() => undefined),
}));
jest.mock('../../../src/modules/chatbot/service', () => ({
  handleQuery: (...args: unknown[]) => mockState.handleQuery(...args),
}));
jest.mock('../../../src/modules/llm-gateway/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockState.checkRateLimit(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const router = require('../../../src/api/routes').default;

async function postChat(body: Record<string, unknown>) {
  const route = (router as any).stack.find(
    (layer: any) => layer.route?.path === '/books/:bookId/chat' && layer.route.methods.post
  ).route;
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  await route.stack[0].handle(
    { params: { bookId: 'book' }, headers: { 'x-device-id': 'reader' }, query: {}, body },
    response
  );
  return response;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.findReadiness.mockResolvedValue(true);
  mockState.checkRateLimit.mockReturnValue({ allowed: true });
  mockState.getCutoffSnapshot.mockResolvedValue({
    current_page: 2,
    cutoff: 2,
    is_complete: false,
  });
  mockState.handleQuery.mockImplementation(async function* () {
    yield '답';
  });
});

describe('POST /books/:bookId/chat — 동봉 진도', () => {
  test('FR-PRG-003 🚦: from_page 를 진도 수용에 그대로 넘긴다 (차례 넘김 직후 질문)', async () => {
    await postChat({ query: '내 노트 보여?', page: 2, seq: 5, from_page: 1 });
    expect(mockState.acceptProgressEvent).toHaveBeenCalledWith(
      'reader',
      'book',
      { page: 2, seq: 5, from_page: 1 },
      null
    );
    // 진도를 먼저 반영한 뒤 기준점을 읽는다
    expect(mockState.acceptProgressEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mockState.getCutoffSnapshot.mock.invocationCallOrder[0]
    );
    // 챗봇은 서버 스냅샷의 기준점만 받는다
    expect(mockState.handleQuery.mock.calls[0][2]).toBe(2);
  });

  test('FR-PRG-003 🚦: from_page 가 없으면 이동 사실 없이 넘긴다 (기존 클라이언트)', async () => {
    await postChat({ query: '장갑은 누구 거야?', page: 2, seq: 5 });
    expect(mockState.acceptProgressEvent).toHaveBeenCalledWith(
      'reader',
      'book',
      { page: 2, seq: 5 },
      null
    );
  });

  test('절대 규칙 8: 본문의 cutoff·claim 은 진도 수용에 넘어가지 않는다', async () => {
    await postChat({
      query: '장갑은 누구 거야?',
      page: 2,
      seq: 5,
      from_page: 1,
      cutoff: 300,
      claim: 'read_through',
    });
    const event = mockState.acceptProgressEvent.mock.calls[0][2];
    expect(event).toEqual({ page: 2, seq: 5, from_page: 1 });
  });

  test.each([[{ from_page: '1' }], [{ from_page: 0 }], [{ from_page: 1.5 }]])(
    '잘못된 from_page 는 400 이고 진도를 저장하지 않고 챗봇을 부르지 않는다 %j',
    async (extra) => {
      const res = await postChat({ query: '장갑?', page: 2, seq: 5, ...extra });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockState.acceptProgressEvent).not.toHaveBeenCalled();
      expect(mockState.handleQuery).not.toHaveBeenCalled();
    }
  );
});

export {};
