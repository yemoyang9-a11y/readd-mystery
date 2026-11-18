import { AxiosError, type AxiosResponse } from 'axios';
import { verifyStoredSession } from './sessionCheck';
import { fetchMe } from './authService';
import { AUTH_TOKEN_CLEARED_EVENT, getAuthToken, setAuthToken } from '../utils/storage';

vi.mock('./authService', () => ({ fetchMe: vi.fn() }));
// 실 서버 경로를 본다 — mock 모드는 sessionCheck.mock.test.ts
vi.mock('../utils/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/constants')>()),
  USE_MOCK: false,
}));

function httpError(status?: number): AxiosError {
  return new AxiosError(
    'failed',
    status ? 'ERR_BAD_REQUEST' : 'ERR_NETWORK',
    undefined,
    null,
    status ? ({ status } as AxiosResponse) : undefined
  );
}

let seq = 0;
/** 토큰마다 한 번만 확인하므로 시험마다 다른 토큰을 쓴다 */
function freshToken(): string {
  seq += 1;
  return `session-${seq}`;
}

/** E2E #89 — 앱을 열 때 저장된 토큰이 아직 살아 있는 계정의 것인지 한 번 확인한다 */
describe('verifyStoredSession', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchMe).mockReset();
  });

  test('토큰이 없으면 서버를 부르지 않는다', async () => {
    await verifyStoredSession();
    expect(fetchMe).not.toHaveBeenCalled();
  });

  test('서버가 401로 답하면(지워진 계정·만료된 토큰) 토큰을 지우고 관문에 알린다', async () => {
    setAuthToken(freshToken());
    vi.mocked(fetchMe).mockRejectedValue(httpError(401));
    const cleared = vi.fn();
    window.addEventListener(AUTH_TOKEN_CLEARED_EVENT, cleared);

    await verifyStoredSession();

    window.removeEventListener(AUTH_TOKEN_CLEARED_EVENT, cleared);
    expect(getAuthToken()).toBeNull();
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  test('계정이 살아 있으면 토큰을 그대로 둔다', async () => {
    const token = freshToken();
    setAuthToken(token);
    vi.mocked(fetchMe).mockResolvedValue({ display_name: '독자', providers: ['email'] });

    await verifyStoredSession();

    expect(getAuthToken()).toBe(token);
  });

  test('네트워크 오류로는 로그아웃시키지 않는다', async () => {
    const token = freshToken();
    setAuthToken(token);
    vi.mocked(fetchMe).mockRejectedValue(httpError());

    await verifyStoredSession();

    expect(getAuthToken()).toBe(token);
  });

  test('서버 오류(500)로도 로그아웃시키지 않는다', async () => {
    const token = freshToken();
    setAuthToken(token);
    vi.mocked(fetchMe).mockRejectedValue(httpError(500));

    await verifyStoredSession();

    expect(getAuthToken()).toBe(token);
  });

  test('같은 토큰은 한 번만 확인한다 — 화면을 옮길 때마다 묻지 않는다', async () => {
    setAuthToken(freshToken());
    vi.mocked(fetchMe).mockResolvedValue({ display_name: '독자', providers: ['email'] });

    await Promise.all([verifyStoredSession(), verifyStoredSession()]);
    await verifyStoredSession();

    expect(fetchMe).toHaveBeenCalledTimes(1);
  });

  test('확인하는 사이 다른 토큰으로 바뀌었으면(다시 로그인) 새 토큰을 지우지 않는다', async () => {
    setAuthToken(freshToken());
    const next = freshToken();
    vi.mocked(fetchMe).mockImplementation(async () => {
      setAuthToken(next);
      throw httpError(401);
    });

    await verifyStoredSession();

    expect(getAuthToken()).toBe(next);
  });
});
