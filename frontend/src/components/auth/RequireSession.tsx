import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LOGIN_PATH, loginPathFor } from '../../utils/authRedirect';
import { verifyStoredSession } from '../../services/sessionCheck';
import { AUTH_TOKEN_CLEARED_EVENT, getAuthToken, type AuthClearReason } from '../../utils/storage';

type Gate = 'session' | 'none' | 'loggedOut';

function clearReason(event: Event): AuthClearReason | undefined {
  return event instanceof CustomEvent ? (event.detail as { reason?: AuthClearReason } | null)?.reason : undefined;
}

/**
 * 로그인 관문 (2026-11-18 대표 지시).
 *
 * 저장된 세션 토큰이 없으면 화면을 그리지 않고 /login 으로 보낸다. 서버가 401 로 토큰을
 * 지우면(AUTH_TOKEN_CLEARED_EVENT) 그 자리에서 다시 관문을 타고, 가려던 주소를 `?next=` 로
 * 남긴다. 독자가 직접 로그아웃했으면(E2E #81) next 없이 /login 으로 보낸다 — 다시 로그인하면
 * 홈에서 새로 시작한다.
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

  if (gate === 'loggedOut') return <Navigate to={LOGIN_PATH} replace />;
  if (gate === 'none') {
    return <Navigate to={loginPathFor(`${location.pathname}${location.search}${location.hash}`)} replace />;
  }
  return <>{children}</>;
}
