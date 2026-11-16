import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_ROUTES } from '../utils/routes';

// FR-BRW-003
export function useBackToHome(): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const fromHome = (state as { fromHome?: unknown } | null)?.fromHome === true;

  return useCallback(() => {
    if (fromHome) {
      navigate(-1);
      return;
    }
    navigate(APP_ROUTES.home, { replace: true });
  }, [navigate, fromHome]);
}
