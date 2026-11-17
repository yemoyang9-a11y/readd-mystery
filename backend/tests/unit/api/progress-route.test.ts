/**
 * POST /books/:bookId/progress · /progress/confirm — 차례 읽기 기준점 입력 (2026-11-17 대표 결정 A + C안)
 *
 * 클라이언트가 보낼 수 있는 것은 이동 사실(page, seq, from_page)과 선택(claim, choice)뿐이다.
 * 기준점 숫자는 받지 않는다 (절대 규칙 8번, FR-PRG-003 🚦).
 */

import { InvalidProgressError } from '../../../src/modules/reading-state/progress.service';

const mockState = {
  findReadiness: jest.fn(),
  acceptProgressEvent: jest.fn(),
  confirmFrontier: jest.fn(),
  touchActivity: jest.fn(),
  getCutoffSnapshot: jest.fn(),
};

jest.mock('../../../src/config/database', () => ({ pool: {} }));
jest.mock('../../../src/modules/reading-state/composition', () => ({
  createReadingStateServices: () => ({
    progressService: {
      acceptProgressEvent: mockState.acceptProgressEvent,
      confirmFrontier: mockState.confirmFrontier,
    },
    sessionService: { touchActivity: mockState.touchActivity },
    cutoffService: { getCutoffSnapshot: mockState.getCutoffSnapshot },
  }),
}));
jest.mock('../../../src/modules/content/composition', () => ({
  createContentServices: () => ({ content: { findReadiness: mockState.findReadiness } }),
}));
jest.mock('../../../src/modules/ssabi/composition', () => ({ createSsabiServices: () => ({}) }));
jest.mock('../../../src/modules/chatbot/conversation-service');
jest.mock('../../../src/modules/chatbot/service', () => ({ handleQuery: jest.fn() }));
jest.mock('../../../src/modules/llm-gateway/rate-limiter', () => ({ checkRateLimit: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const router = require('../../../src/api/routes').default;

const CONFIRM = { current_page: null, furthest_page: 200 };
const SNAPSHOT = { current_page: 30, cutoff: 30, furthest_page: 200, frontier_confirm: CONFIRM };

async function post(path: string, body: Record<string, unknown>) {
  const route = (router as any).stack.find(
    (layer: any) => layer.route?.path === path && layer.route.methods.post
  ).route;
  const response = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
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
  mockState.getCutoffSnapshot.mockResolvedValue(SNAPSHOT);
});

describe('POST /books/:bookId/progress', () => {
  test('도서 범위를 벗어난 진도는 500 대신 400으로 응답한다', async () => {
    mockState.acceptProgressEvent.mockRejectedValueOnce(new InvalidProgressError('도서의 마지막 쪽을 넘을 수 없습니다'));
    const res = await post('/books/:bookId/progress', { page: 999999, seq: 4, claim: 'read_through' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockState.touchActivity).not.toHaveBeenCalled();
    expect(mockState.getCutoffSnapshot).not.toHaveBeenCalled();
  });
  test('FR-PRG-003: from_page·claim 을 그대로 넘기고, 응답에 기준점과 확인 카드를 싣는다', async () => {
    const res = await post('/books/:bookId/progress', {
      page: 200,
      seq: 3,
      from_page: 30,
      claim: 'read_through',
    });
    expect(mockState.acceptProgressEvent).toHaveBeenCalledWith(
      'reader',
      'book',
      { page: 200, seq: 3, from_page: 30, claim: 'read_through' },
      null
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, applied_cutoff: 30, confirm: CONFIRM });
  });

  test('FR-PRG-003: from_page·claim 이 없으면 null 로 넘긴다', async () => {
    await post('/books/:bookId/progress', { page: 31, seq: 4 });
    expect(mockState.acceptProgressEvent).toHaveBeenCalledWith(
      'reader',
      'book',
      { page: 31, seq: 4, from_page: null, claim: null },
      null
    );
  });

  test('절대 규칙 8: 본문에 cutoff 를 실어도 진도 수용에 넘어가지 않는다', async () => {
    await post('/books/:bookId/progress', { page: 31, seq: 4, cutoff: 300, max_page: 300 });
    const event = mockState.acceptProgressEvent.mock.calls[0][2];
    expect(Object.keys(event).sort()).toEqual(['claim', 'from_page', 'page', 'seq']);
  });

  test.each([
    [{ page: 31, seq: 4, from_page: '30' }],
    [{ page: 31, seq: 4, from_page: 0 }],
    [{ page: 31, seq: 4, from_page: 2.5 }],
    [{ page: 31, seq: 4, claim: 'read_all' }],
    [{ page: 31, seq: 4, claim: 300 }],
  ])('잘못된 from_page·claim 은 400 이고 진도를 저장하지 않는다 %j', async (body) => {
    const res = await post('/books/:bookId/progress', body);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockState.acceptProgressEvent).not.toHaveBeenCalled();
  });
});

describe('POST /books/:bookId/progress/confirm', () => {
  test.each(['keep', 'current', 'furthest'])(
    'FR-PRG-003: choice=%s 를 서버에 넘기고 새 스냅샷으로 응답한다',
    async (choice) => {
      const res = await post('/books/:bookId/progress/confirm', { choice });
      expect(mockState.confirmFrontier).toHaveBeenCalledWith('reader', 'book', choice);
      expect(mockState.touchActivity).toHaveBeenCalledWith('reader', 'book');
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        applied_cutoff: 30,
        confirm: CONFIRM,
      });
    }
  );

  test.each([[{}], [{ choice: 200 }], [{ choice: 'page' }], [{ choice: 'furthest', page: 300 }]])(
    '절대 규칙 8: 선택지 id 외의 입력은 400 이거나 무시된다 %j',
    async (body) => {
      const res = await post('/books/:bookId/progress/confirm', body);
      if ((body as { choice?: unknown }).choice === 'furthest') {
        expect(mockState.confirmFrontier).toHaveBeenCalledWith('reader', 'book', 'furthest');
      } else {
        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockState.confirmFrontier).not.toHaveBeenCalled();
      }
    }
  );
});

export {};
