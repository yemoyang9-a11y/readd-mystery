import { confirmFrontier, sendProgress } from './progressService';
import { api } from './api';
import { resetSeq } from '../utils/seq';

vi.mock('./api', () => ({ api: { post: vi.fn() } }));
vi.mock('../utils/constants', () => ({ USE_MOCK: false }));

const OK = { success: true, applied_cutoff: 30, confirm: null };

beforeEach(() => {
  resetSeq();
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: OK });
});

describe('sendProgress — 읽은 범위 판정 재료 (FR-PRG-003 🚦)', () => {
  test('FR-PRG-003: 직전 화면 쪽이 없으면 from_page를 싣지 않는다', async () => {
    await sendProgress('takryu', 1);
    await sendProgress('takryu', 2, { fromPage: null });

    const bodies = vi.mocked(api.post).mock.calls.map(([, body]) => body);
    expect(bodies[0]).toEqual({ page: 1, seq: 1 });
    expect(bodies[1]).toEqual({ page: 2, seq: 2 });
    expect(bodies[0]).not.toHaveProperty('from_page');
    expect(bodies[1]).not.toHaveProperty('from_page');
  });

  test('FR-PRG-003: 직전 화면 쪽이 있으면 from_page로 그대로 싣는다 (계산하지 않는다)', async () => {
    await sendProgress('takryu', 31, { fromPage: 30 });

    expect(api.post).toHaveBeenCalledWith('/books/takryu/progress', { page: 31, seq: 1, from_page: 30 });
  });

  test('FR-PRG-003: claim은 read_through를 넘긴 이벤트에만 싣는다', async () => {
    await sendProgress('takryu', 200, { fromPage: 40, claim: 'read_through' });
    await sendProgress('takryu', 201, { fromPage: 200 });

    const bodies = vi.mocked(api.post).mock.calls.map(([, body]) => body);
    expect(bodies[0]).toEqual({ page: 200, seq: 1, from_page: 40, claim: 'read_through' });
    expect(bodies[1]).toEqual({ page: 201, seq: 2, from_page: 200 });
    expect(bodies[1]).not.toHaveProperty('claim');
  });

  test('절대 규칙 8번: 진도 요청 본문에 기준점 필드를 싣지 않는다', async () => {
    await sendProgress('takryu', 200, { fromPage: 40, claim: 'read_through' });

    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['claim', 'from_page', 'page', 'seq']);
  });

  test('FR-PRG-003: 응답의 applied_cutoff와 confirm을 그대로 돌려준다', async () => {
    const confirm = { current_page: 120, furthest_page: 200 };
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true, applied_cutoff: 40, confirm } });

    await expect(sendProgress('takryu', 120, { fromPage: 119 })).resolves.toEqual({
      success: true,
      applied_cutoff: 40,
      confirm,
    });
  });

  test('FR-SPL-005: 실패하거나 applied_cutoff가 없으면 null — 넘김은 막지 않는다', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('network'));
    await expect(sendProgress('takryu', 3)).resolves.toBeNull();

    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: false } });
    await expect(sendProgress('takryu', 4)).resolves.toBeNull();
  });

  test('FR-SPL-005: confirm 필드가 빠진 응답은 확인 요청 없음(null)으로 읽는다', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true, applied_cutoff: 5 } });

    await expect(sendProgress('takryu', 5)).resolves.toEqual({ success: true, applied_cutoff: 5, confirm: null });
  });
});

describe('confirmFrontier — 넘겨 본 쪽 확인 답 (FR-PRG-003 🚦)', () => {
  test.each(['keep', 'current', 'furthest'] as const)('FR-PRG-003: choice=%s 만 보낸다', async (choice) => {
    await confirmFrontier('takryu', choice);

    expect(api.post).toHaveBeenCalledWith('/books/takryu/progress/confirm', { choice });
  });

  test('FR-PRG-003: 응답을 그대로 돌려준다', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true, applied_cutoff: 200, confirm: null } });

    await expect(confirmFrontier('takryu', 'furthest')).resolves.toEqual({
      success: true,
      applied_cutoff: 200,
      confirm: null,
    });
  });

  test('FR-SPL-005: 실패하면 null — 호출자가 확인 카드를 그대로 둔다', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('network'));

    await expect(confirmFrontier('takryu', 'keep')).resolves.toBeNull();
  });
});
