import { verifyStoredSession } from './sessionCheck';
import { getAuthToken, setAuthToken } from '../utils/storage';

/**
 * E2E #89 — mock 모드(VITE_USE_MOCK=true, vitest 기본값)에는 지울 서버 계정이 없다.
 * 대역이 발급하지 않은 토큰(시험 고정값 등)도 그대로 둬서 mock 모드가 계속 돌아간다.
 */
test('mock 모드에서는 저장된 토큰을 지우지 않는다', async () => {
  localStorage.clear();
  setAuthToken('test-session-token');

  await verifyStoredSession();

  expect(getAuthToken()).toBe('test-session-token');
});
