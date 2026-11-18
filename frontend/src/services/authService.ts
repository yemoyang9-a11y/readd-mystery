import { AxiosError, type AxiosResponse } from 'axios';
import { api, ensureDeviceId } from './api';
import { API_BASE_URL, USE_MOCK } from '../utils/constants';
import { clearAuthToken, setAuthToken } from '../utils/storage';

export type AuthProvider = 'google' | 'kakao';

export interface AuthSession {
  token: string;
  display_name: string | null;
}

export interface AuthMe {
  display_name: string | null;
  providers: string[];
  /** 이메일로 가입한 계정만 값이 있다 (2026-11-18) */
  email?: string | null;
  /** 첫 안내(/guide)를 마쳤는지. 옛 서버는 보내지 않는다 */
  onboarded?: boolean;
}

/** 로그인 화면에 보여 줄 방법 — 'email'은 항상, OAuth는 서버에 설정된 것만 */
export type LoginMethod = 'email' | AuthProvider;

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
}

function mockFailure(status: number): AxiosError {
  return new AxiosError('mock', 'ERR_BAD_REQUEST', undefined, null, { status } as AxiosResponse);
}

/** 로그인을 끝내고 돌아올 이 화면의 주소 — GitHub Pages 처럼 하위 경로에 배포돼도 맞게 돌아온다 */
function currentAppBase(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, '');
}

export function buildLoginUrl(provider: AuthProvider): string {
  const params = new URLSearchParams({ device_id: ensureDeviceId(), return_to: currentAppBase() });
  return `${API_BASE_URL}/auth/${provider}/start?${params.toString()}`;
}

export function startLogin(provider: AuthProvider): void {
  window.location.assign(buildLoginUrl(provider));
}

export async function exchangeLoginCode(code: string): Promise<AuthSession> {
  const { data } = await api.post<AuthSession>('/auth/exchange', { code });
  return data;
}

export async function fetchMe(): Promise<AuthMe> {
  if (USE_MOCK) {
    const { mockMeResponse } = await import('../../mocks/server');
    const result = mockMeResponse();
    if (result.status === 200) return result.body;
    throw mockFailure(result.status);
  }
  const { data } = await api.get<AuthMe>('/auth/me');
  return data;
}

export async function deleteAccount(): Promise<void> {
  await api.delete('/auth/me');
}

// 2026-11-18 대표 지시 — 처음 접속하면 로그인·회원가입
export async function fetchProviders(): Promise<LoginMethod[]> {
  if (USE_MOCK) return ['email'];
  try {
    const { data } = await api.get<{ providers: string[] }>('/auth/providers');
    const known = data.providers.filter(
      (p): p is LoginMethod => p === 'email' || p === 'google' || p === 'kakao'
    );
    return known.includes('email') ? known : ['email', ...known];
  } catch {
    return ['email'];
  }
}

/** 가입하고 세션 토큰을 저장한다. 기기 id는 api 클라이언트가 X-Device-Id로 보낸다 */
export async function signup(input: SignupInput): Promise<AuthSession & { is_new: boolean }> {
  let session: AuthSession & { is_new: boolean };
  if (USE_MOCK) {
    const { mockSignupResponse } = await import('../../mocks/server');
    const result = mockSignupResponse(input);
    if (result.status !== 200) throw mockFailure(result.status);
    session = result.body;
  } else {
    const { data } = await api.post<AuthSession & { is_new: boolean }>('/auth/signup', {
      email: input.email,
      password: input.password,
      display_name: input.displayName,
    });
    session = data;
  }
  setAuthToken(session.token);
  return session;
}

/** 로그인하고 세션 토큰을 저장한다 */
export async function login(email: string, password: string): Promise<AuthSession> {
  let session: AuthSession;
  if (USE_MOCK) {
    const { mockLoginResponse } = await import('../../mocks/server');
    const result = mockLoginResponse(email, password);
    if (result.status !== 200) throw mockFailure(result.status);
    session = result.body;
  } else {
    const { data } = await api.post<AuthSession>('/auth/login', { email, password });
    session = data;
  }
  setAuthToken(session.token);
  return session;
}

/** 첫 안내를 마쳤다고 서버에 남긴다. 여러 번 불러도 된다 */
export async function markOnboarded(): Promise<void> {
  if (USE_MOCK) {
    const { mockMarkOnboarded } = await import('../../mocks/server');
    mockMarkOnboarded();
    return;
  }
  await api.post('/auth/me/onboarded');
}

export function logout(): void {
  clearAuthToken();
}
