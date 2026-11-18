import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { exchangeLoginCode, fetchMe } from '../services/authService';
import { setAuthToken } from '../utils/storage';

/**
 * 카카오·구글 로그인에서 돌아오는 화면 (2026-11-18 — 첫 접속 로그인 관문 이후).
 * 성공: 가이드를 아직 안 본 독자는 /guide, 본 독자는 홈. 취소·실패: 로그인 화면.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const goToLogin = () => navigate('/login', { replace: true });
    const code = new URLSearchParams(window.location.hash.slice(1)).get('code');
    if (!code) {
      goToLogin();
      return;
    }

    exchangeLoginCode(code)
      .then(async ({ token }) => {
        setAuthToken(token);
        const me = await fetchMe().catch(() => null);
        navigate(me?.onboarded === false ? '/guide' : '/', { replace: true });
      })
      .catch(goToLogin);
  }, [navigate]);

  return <p>로그인하는 중입니다</p>;
}
