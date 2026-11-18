import { useCallback, useEffect, useState } from 'react';
import { deleteAccount, fetchMe, startLogin, type AuthProvider } from '../services/authService';
import { AUTH_TOKEN_CLEARED_EVENT, clearAuthToken, getAuthToken } from '../utils/storage';

type AuthStatus = 'guest' | 'member' | 'loading';

interface AuthState {
  status: AuthStatus;
  displayName: string | null;
}

const GUEST: AuthState = { status: 'guest', displayName: null };

export function useAuth() {
  const [state, setState] = useState<AuthState>(() =>
    getAuthToken() ? { status: 'loading', displayName: null } : GUEST
  );

  useEffect(() => {
    const becomeGuest = () => setState(GUEST);
    window.addEventListener(AUTH_TOKEN_CLEARED_EVENT, becomeGuest);
    return () => window.removeEventListener(AUTH_TOKEN_CLEARED_EVENT, becomeGuest);
  }, []);

  useEffect(() => {
    if (!getAuthToken()) return;
    let active = true;
    fetchMe()
      .then((me) => {
        if (active && getAuthToken()) {
          setState({ status: 'member', displayName: me.display_name });
        }
      })
      .catch(() => {
        if (active) setState(getAuthToken() ? { status: 'member', displayName: null } : GUEST);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback((provider: AuthProvider) => startLogin(provider), []);
  // E2E #81 — 직접 로그아웃·탈퇴는 'logout' 으로 지워 관문이 next 없이 /login 으로 보낸다
  const logout = useCallback(() => clearAuthToken('logout'), []);
  const withdraw = useCallback(async () => {
    await deleteAccount();
    clearAuthToken('logout');
  }, []);

  return { ...state, login, logout, withdraw };
}
