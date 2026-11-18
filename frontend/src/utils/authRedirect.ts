import { BOOK_ROUTES } from './routes';

/**
 * 로그인 시점 (대표 지시 2026-11-18 — "처음부터 로그인 창 띄우지 말고 작품을 보려거나 MY 페이지에서
 * 로그인하려고 할 때 로그인창 띄우고"). 조사: docs/context/research-2026-11-18-signup-fields.md 3장.
 *
 * 홈·검색·서재·작품 소개·커뮤니티 허브·MY·이용 가이드는 비회원도 연다. 아래 경로(작품을 여는 화면)만
 * 세션 토큰이 없으면 /login 으로 보내고, 가려던 주소는 `?next=` 로 넘겨 로그인 뒤 돌아온다.
 * MY 의 "로그인 / 회원가입" 버튼은 직접 /login?next=/my 로 간다.
 */
export const LOGIN_PATH = '/login';
export const GUIDE_PATH = '/guide';
/** 카카오·구글 첫 로그인 뒤(또는 동의 기록이 없는 옛 계정) 약관 동의 화면 */
export const CONSENT_PATH = '/consent';

/** 세션이 있어야 여는 경로 — 작품을 여는 화면(브리핑·읽기·완독자 이야기방) */
export const LOGIN_REQUIRED_ROUTES: readonly string[] = [
  BOOK_ROUTES.briefing,
  BOOK_ROUTES.reader,
  BOOK_ROUTES.community,
];

export function requiresLogin(routePath: string | undefined): boolean {
  return routePath !== undefined && LOGIN_REQUIRED_ROUTES.includes(routePath);
}

export function loginPathFor(next: string): string {
  const safe = safeNextPath(next);
  return safe === '/' ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(safe)}`;
}

export function consentPathFor(next: string): string {
  const safe = safeNextPath(next);
  return safe === '/' ? CONSENT_PATH : `${CONSENT_PATH}?next=${encodeURIComponent(safe)}`;
}

function isPath(raw: string, path: string): boolean {
  return raw === path || raw.startsWith(`${path}?`) || raw.startsWith(`${path}/`);
}

/** 같은 사이트 안의 경로만 돌려받는다. 바깥 주소·로그인·동의 화면 자신은 홈으로 바꾼다 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (isPath(raw, LOGIN_PATH) || isPath(raw, CONSENT_PATH)) return '/';
  return raw;
}

/**
 * 카카오·구글 로그인은 다른 사이트를 다녀오므로 가려던 주소를 이 탭(sessionStorage)에 남긴다.
 * 돌아오면(/auth/callback) 한 번 읽고 지운다. 읽은 값도 safeNextPath 로 다시 검사한다.
 */
export const LOGIN_NEXT_STORAGE_KEY = 'readd.login_next';

export function rememberLoginNext(next: string): void {
  try {
    const safe = safeNextPath(next);
    if (safe === '/') window.sessionStorage.removeItem(LOGIN_NEXT_STORAGE_KEY);
    else window.sessionStorage.setItem(LOGIN_NEXT_STORAGE_KEY, safe);
  } catch {
    // 저장소를 못 쓰면 로그인 뒤 홈으로 간다
  }
}

export function takeLoginNext(): string {
  try {
    const raw = window.sessionStorage.getItem(LOGIN_NEXT_STORAGE_KEY);
    window.sessionStorage.removeItem(LOGIN_NEXT_STORAGE_KEY);
    return safeNextPath(raw);
  } catch {
    return '/';
  }
}
