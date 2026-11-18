import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { loginPathFor } from '../../utils/authRedirect';
import { verifyStoredSession } from '../../services/sessionCheck';
import { AUTH_TOKEN_CLEARED_EVENT, getAuthToken, type AuthClearReason } from '../../utils/storage';

type Gate = 'session' | 'none' | 'loggedOut';

function clearReason(event: Event): AuthClearReason | undefined {
  return event instanceof CustomEvent ? (event.detail as { reason?: AuthClearReason } | null)?.reason : undefined;
}

/**
 * 작품을 여는 화면의 로그인 관문 (대표 지시 2026-11-18 — "작품을 보려거나 MY 페이지에서 로그인하려고
 * 할 때 로그인창"). App 이 utils/authRedirect 의 LOGIN_REQUIRED_ROUTES(브리핑·읽기·책 이야기방)에만 씌운다.
 *
 * 저장된 세션 토큰이 없으면 화면을 그리지 않고 /login 으로 보내며 가려던 주소를 `?next=` 로 남긴다.
 * 서버가 401 로 토큰을 지우면(AUTH_TOKEN_CLEARED_EVENT) 그 자리에서 다시 관문을 탄다. 독자가 직접
 * 로그아웃했으면(다른 탭 포함) 로그인 창을 억지로 띄우지 않고 홈으로 보낸다.
 *
 * 토큰이 있으면 화면을 바로 그리고, 그 토큰이 아직 살아 있는 계정의 것인지는 한 번만 뒤에서
 * 확인한다(E2E #89, services/sessionCheck).
 */
export default function RequireSession({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [gate, setGate] = useState<Gate>(() => (getAuthToken() ? 'session' : 'none'));

  useEffect(() => {
    const sync = () => setGate(getAuthToken() ? 'session' : 'none');
    const onCleared = (event: Event) => {
      if (getAuthToken()) return setGate('session');
      setGate(clearReason(event) === 'logout' ? 'loggedOut' : 'none');
    };
    sync();
    window.addEventListener(AUTH_TOKEN_CLEARED_EVENT, onCleared);
    window.addEventListener('storage', sync);
    if (getAuthToken()) void verifyStoredSession();
    return () => {
      window.removeEventListener(AUTH_TOKEN_CLEARED_EVENT, onCleared);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (gate === 'loggedOut') return <Navigate to="/" replace />;
  if (gate === 'none') {
    return <Navigate to={loginPathFor(`${location.pathname}${location.search}${location.hash}`)} replace />;
  }
  return <>{children}</>;
}
