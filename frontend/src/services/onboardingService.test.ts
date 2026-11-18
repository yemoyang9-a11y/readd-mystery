import { api } from './api';
import { hasOnboardedLocally, markOnboarded, ONBOARDED_STORAGE_KEY } from './onboardingService';

vi.mock('./api', () => ({ api: { post: vi.fn() } }));

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(api.post).mockReset();
});

test('markOnboarded: 기기 표시를 남기고 서버에 가이드 완료를 알린다', async () => {
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  await markOnboarded();
  expect(api.post).toHaveBeenCalledWith('/auth/me/onboarded');
  expect(window.localStorage.getItem(ONBOARDED_STORAGE_KEY)).toBe('1');
  expect(hasOnboardedLocally()).toBe(true);
});

test('markOnboarded: 서버 기록이 실패해도 오류를 던지지 않고 기기 표시는 남는다', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('401'));
  await expect(markOnboarded()).resolves.toBeUndefined();
  expect(hasOnboardedLocally()).toBe(true);
});
