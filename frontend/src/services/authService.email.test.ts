import { fetchProviders, login, logout, markOnboarded, signup } from './authService';
import { api } from './api';
import { setMockMember } from '../../mocks/server';
import { getAuthToken, setAuthToken } from '../utils/storage';

const flags = vi.hoisted(() => ({ useMock: false }));

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() }, ensureDeviceId: () => 'device' }));
vi.mock('../utils/constants', async (original) => ({
  ...(await original<typeof import('../utils/constants')>()),
  get USE_MOCK() {
    return flags.useMock;
  },
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  flags.useMock = false;
  setMockMember(false);
  localStorage.clear();
});

describe('이메일 로그인 서비스 — 2026-11-18 대표 지시', () => {
  test('signup은 POST /auth/signup에 display_name으로 보내고 토큰을 저장한다', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { token: 'jwt-1', display_name: '독자', is_new: true } });
    await expect(signup({ email: 'a@b.co', password: 'secret-pass', displayName: '독자' })).resolves.toMatchObject({
      is_new: true,
    });
    expect(vi.mocked(api.post).mock.calls[0]).toEqual([
      '/auth/signup',
      { email: 'a@b.co', password: 'secret-pass', display_name: '독자' },
    ]);
    expect(getAuthToken()).toBe('jwt-1');
  });

  test('login은 POST /auth/login 뒤 토큰을 저장하고, 실패하면 저장하지 않는다', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { token: 'jwt-2', display_name: null } });
    await login('a@b.co', 'secret-pass');
    expect(vi.mocked(api.post).mock.calls[0]).toEqual(['/auth/login', { email: 'a@b.co', password: 'secret-pass' }]);
    expect(getAuthToken()).toBe('jwt-2');

    localStorage.clear();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('401'));
    await expect(login('a@b.co', 'wrong-pass')).rejects.toThrow();
    expect(getAuthToken()).toBeNull();
  });

  test('markOnboarded는 POST /auth/me/onboarded를 한 번 보낸다', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: undefined });
    await markOnboarded();
    expect(vi.mocked(api.post).mock.calls).toEqual([['/auth/me/onboarded']]);
  });

  test('fetchProviders는 서버 목록을 쓰고, 실패하면 이메일만 준다', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { providers: ['email', 'google', 'naver'] } });
    await expect(fetchProviders()).resolves.toEqual(['email', 'google']);
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network'));
    await expect(fetchProviders()).resolves.toEqual(['email']);
  });

  test('logout은 저장된 토큰을 지운다', () => {
    setAuthToken('jwt');
    logout();
    expect(getAuthToken()).toBeNull();
  });

  test('USE_MOCK=true면 네트워크 없이 8자 이상 비밀번호로 가입·로그인된다', async () => {
    flags.useMock = true;
    await expect(signup({ email: 'a@b.co', password: 'secret-pass', displayName: '독자' })).resolves.toMatchObject({
      display_name: '독자',
      is_new: true,
    });
    await expect(login('a@b.co', 'short')).rejects.toMatchObject({ response: { status: 401 } });
    await expect(login('a@b.co', 'secret-pass')).resolves.toMatchObject({ display_name: '독자' });
    await markOnboarded();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });
});
