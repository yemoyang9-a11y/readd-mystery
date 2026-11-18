import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { exchangeLoginCode, fetchMe } from '../services/authService';
import { GUIDE_PATH, LOGIN_PATH, consentPathFor, takeLoginNext } from '../utils/authRedirect';
import { setAuthToken } from '../utils/storage';

/**
 * 카카오·구글 로그인에서 돌아오는 화면.
 *
 * 성공하면 로그인 전에 남긴 가려던 주소(대표 지시 2026-11-18 — 작품을 열려다 로그인했으면 그 작품)로
 * 간다. 약관 동의가 없으면(첫 OAuth 로그인) 동의 화면을, 첫 안내 전이면 첫 안내를 먼저 거친다.
 * 취소·실패: 로그인 화면.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const goToLogin = () => navigate(LOGIN_PATH, { replace: true });
    const code = new URLSearchParams(window.location.hash.slice(1)).get('code');
    if (!code) {
      goToLogin();
      return;
    }

    exchangeLoginCode(code)
      .then(async ({ token }) => {
        setAuthToken(token);
        const next = takeLoginNext();
        const me = await fetchMe().catch(() => null);
        if (me?.consent_required) navigate(consentPathFor(next), { replace: true });
        else navigate(me?.onboarded === false ? GUIDE_PATH : next, { replace: true, state: { next } });
      })
      .catch(goToLogin);
  }, [navigate]);

  return <p>로그인하는 중입니다</p>;
}
