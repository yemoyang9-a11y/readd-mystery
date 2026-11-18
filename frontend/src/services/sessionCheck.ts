import { isAxiosError } from 'axios';
import { fetchMe } from './authService';
import { USE_MOCK } from '../utils/constants';
import { clearAuthToken, getAuthToken } from '../utils/storage';

/** 이미 확인했거나 확인 중인 토큰 — 화면을 옮길 때마다 다시 묻지 않는다 */
let checkedToken: string | null = null;
let pending: Promise<void> | null = null;

/**
 * 저장된 세션 토큰이 아직 살아 있는 계정의 것인지 앱을 열 때 한 번 확인한다 (E2E #89).
 *
 * 계정이 지워졌거나 토큰이 만료·위조돼 서버가 401 로 답하면 토큰을 지운다. 그러면 관문
 * (RequireSession)이 AUTH_TOKEN_CLEARED_EVENT 를 받아 /login 으로 보낸다. 네트워크 오류·
 * 서버 오류로는 로그아웃시키지 않는다 — 계정이 없다는 증거가 아니다.
 *
 * 화면은 막지 않는다. 관문은 확인을 기다리지 않고 바로 그린다.
 * mock 모드에는 지울 서버 계정이 없으므로 확인하지 않는다.
 */
export function verifyStoredSession(): Promise<void> {
  if (USE_MOCK) return Promise.resolve();
  const token = getAuthToken();
  if (!token) return Promise.resolve();
  if (token === checkedToken) return pending ?? Promise.resolve();
  checkedToken = token;
  pending = fetchMe()
    .then(() => undefined)
    .catch((error: unknown) => {
      // 확인하는 사이 다시 로그인했으면 새 토큰은 건드리지 않는다
      if (isAxiosError(error) && error.response?.status === 401 && getAuthToken() === token) {
        clearAuthToken('expired');
      }
    });
  return pending;
}
