import router from '../../../src/api/routes';
import { createReadingStateServices } from '../../../src/modules/reading-state/composition';
import { createContentServices } from '../../../src/modules/content/composition';
import { createSsabiServices } from '../../../src/modules/ssabi/composition';

jest.mock('../../../src/config/database', () => ({ pool: {} }));
jest.mock('../../../src/modules/reading-state/composition', () => ({
  createReadingStateServices: jest.fn(() => ({
    cutoffService: { getCutoffSnapshot: jest.fn() },
    sessionService: { touchActivity: jest.fn() },
    progressService: { acceptProgressEvent: jest.fn() },
  })),
}));
jest.mock('../../../src/modules/content/composition', () => ({
  createContentServices: jest.fn(() => ({ content: { findReadiness: jest.fn() } })),
}));
jest.mock('../../../src/modules/ssabi/composition', () => ({
  createSsabiServices: jest.fn(() => ({ timeline: { getTimeline: jest.fn() } })),
}));
jest.mock('../../../src/modules/chatbot/conversation-service');
jest.mock('../../../src/modules/chatbot/service', () => ({ handleQuery: jest.fn() }));
jest.mock('../../../src/modules/llm-gateway/rate-limiter', () => ({ checkRateLimit: jest.fn() }));

const reading = (createReadingStateServices as jest.Mock).mock.results[0].value;
const getCutoffSnapshot = reading.cutoffService.getCutoffSnapshot;
const acceptProgressEvent = reading.progressService.acceptProgressEvent;
const findReadiness = (createContentServices as jest.Mock).mock.results[0].value.content
  .findReadiness;
const getTimeline = (createSsabiServices as jest.Mock).mock.results[0].value.timeline.getTimeline;

const TIMELINE = {
  chapters: [{ chapter_no: 1, title: '장', start_page: 1, end_page: 9 }],
  events: [{ id: 'e1', event: '사건', description: '쉬운 문장', occurrence_page: 4 }],
};

async function request(overrides: Record<string, unknown> = {}) {
  const route = (router as any).stack.find(
    (layer: any) => layer.route?.path === '/books/:bookId/ssabi/timeline' && layer.route.methods.get
  ).route;
  const response = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  await route.stack[0].handle(
    { params: { bookId: 'book' }, headers: { 'x-device-id': 'reader' }, query: {}, ...overrides },
    response
  );
  return response;
}

beforeEach(() => {
  jest.clearAllMocks();
  findReadiness.mockResolvedValue(true);
  getCutoffSnapshot.mockResolvedValue({ cutoff: 40 });
  getTimeline.mockResolvedValue(TIMELINE);
});

describe('GET /books/:bookId/ssabi/timeline', () => {
  test('FR-SPL-002: 스냅샷 기준점 40이면 그 값으로 조회하고 applied_cutoff 40을 준다', async () => {
    const response = await request();

    expect(getCutoffSnapshot).toHaveBeenCalledWith('reader', 'book');
    expect(getTimeline).toHaveBeenCalledWith('book', 40);
    expect(response.json).toHaveBeenCalledWith({ ...TIMELINE, applied_cutoff: 40 });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  test('FR-PRG-003: 동봉된 page와 seq는 진도 이벤트로 먼저 반영한 뒤 스냅샷을 뜬다', async () => {
    await request({ query: { page: '13', seq: '7' } });

    expect(acceptProgressEvent).toHaveBeenCalledWith('reader', 'book', { page: 13, seq: 7 }, null);
    expect(acceptProgressEvent.mock.invocationCallOrder[0]).toBeLessThan(
      getCutoffSnapshot.mock.invocationCallOrder[0]
    );
  });

  test('절대 규칙 8: ?cutoff=999 같은 클라이언트 기준점은 무시한다', async () => {
    const response = await request({ query: { cutoff: '999', K: '999' }, body: { cutoff: 999 } });

    expect(getTimeline).toHaveBeenCalledWith('book', 40);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ applied_cutoff: 40 }));
  });

  test('FR-SPL-002: 응답에는 독자용 description만 있고 원래 description 문자열이 없다', async () => {
    const response = await request();

    const body = JSON.stringify(response.json.mock.calls[0][0]);
    expect(body).toContain('쉬운 문장');
    expect(body).not.toContain('ORIGINAL');
  });

  test('FR-BRW-002: 준비되지 않은 책은 403이고 조회하지 않는다', async () => {
    findReadiness.mockResolvedValue(false);

    const response = await request();

    expect(response.status).toHaveBeenCalledWith(403);
    expect(getTimeline).not.toHaveBeenCalled();
  });

  test('X-Device-Id가 없으면 400이고 조회하지 않는다', async () => {
    const response = await request({ headers: {} });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(getTimeline).not.toHaveBeenCalled();
  });

  test('FR-SPL-002: 조회 실패는 500이고 데이터를 싣지 않는다', async () => {
    getTimeline.mockRejectedValue(new Error('db'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await request();

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'INTERNAL_ERROR' })
    );
  });
});
