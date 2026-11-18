import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { loginPathFor } from '../../utils/authRedirect';
import { AUTH_TOKEN_CLEARED_EVENT, getAuthToken } from '../../utils/storage';

/**
 * 로그인 관문 (2026-11-18 대표 지시).
 *
 * 저장된 세션 토큰이 없으면 화면을 그리지 않고 /login 으로 보낸다. 로그아웃하거나 서버가
 * 401 로 토큰을 지우면(AUTH_TOKEN_CLEARED_EVENT) 그 자리에서 다시 관문을 탄다.
 * 토큰이 있는지만 본다 — 토큰이 맞는지는 서버가 요청마다 확인한다.
 */
export default function RequireSession({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [hasSession, setHasSession] = useState(() => Boolean(getAuthToken()));

  useEffect(() => {
    const sync = () => setHasSession(Boolean(getAuthToken()));
    sync();
    window.addEventListener(AUTH_TOKEN_CLEARED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(AUTH_TOKEN_CLEARED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (!hasSession) {
    return <Navigate to={loginPathFor(`${location.pathname}${location.search}${location.hash}`)} replace />;
  }
  return <>{children}</>;
}
