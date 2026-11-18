/**
 * 로그인 관문 경로 (2026-11-18 대표 지시 — 처음 접속하면 로그인·회원가입 창).
 *
 * 세션 토큰이 없으면 아래 공개 경로를 뺀 모든 화면이 /login 으로 간다. 가려던 주소는
 * `?next=` 로 넘겨서 로그인 뒤 그 주소로 돌아온다.
 */
export const LOGIN_PATH = '/login';
export const GUIDE_PATH = '/guide';

/** 세션 없이 열 수 있는 최상위 경로. /admin 은 관리자 토큰을 따로 쓴다 */
export const PUBLIC_ROUTE_PATHS: readonly string[] = [LOGIN_PATH, '/auth/callback', '/admin'];

export function loginPathFor(next: string): string {
  const safe = safeNextPath(next);
  return safe === '/' ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(safe)}`;
}

/** 같은 사이트 안의 경로만 돌려받는다. 바깥 주소·로그인 화면 자신은 홈으로 바꾼다 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (raw === LOGIN_PATH || raw.startsWith(`${LOGIN_PATH}?`) || raw.startsWith(`${LOGIN_PATH}/`)) return '/';
  return raw;
}
