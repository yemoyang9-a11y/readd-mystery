import { useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import AuthScreen, { ErrorBox, PRIMARY_BUTTON } from '../components/auth/AuthScreen';
import ConsentList, { type ConsentListHandle } from '../components/auth/ConsentList';
import { agreeConsents, fetchMe } from '../services/authService';
import { GUIDE_PATH, LOGIN_PATH, safeNextPath } from '../utils/authRedirect';
import { EMPTY_CONSENTS, missingConsents, type ConsentChoice } from '../utils/consents';
import { clearAuthToken, getAuthToken } from '../utils/storage';

const CONSENT_MESSAGE = '필수 약관에 모두 동의해 주세요';

/**
 * 약관 동의 화면 (대표 지시 2026-11-18).
 *
 * 카카오·구글로 처음 로그인했거나, 약관 동의 기록이 생기기 전에 가입한 계정이 거친다.
 * 카카오싱크(카카오 화면 안에서 서비스 약관 받기)를 쓰지 않는 서비스가 로그인 뒤 자체 약관 화면을
 * 띄우는 방식이다 — 조사: docs/context/research-2026-11-18-signup-fields.md 4장.
 * 동의하면 가려던 곳(next)으로, 첫 안내 전이면 첫 안내를 거쳐 간다. 닫으면 로그아웃하고 홈으로 간다.
 */
export default function Consent() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const [signedIn] = useState(() => Boolean(getAuthToken()));
  const [consents, setConsents] = useState<ConsentChoice>(EMPTY_CONSENTS);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<ConsentListHandle>(null);

  if (!signedIn) return <Navigate to={LOGIN_PATH} replace />;

  function change(value: ConsentChoice) {
    setConsents(value);
    if (invalid && missingConsents(value).length === 0) {
      setInvalid(false);
      setError(null);
    }
  }

  function close() {
    // 동의하지 않으면 가입을 마치지 않은 것이다 — 로그인 상태로 두지 않는다
    clearAuthToken('logout');
    navigate('/', { replace: true });
  }

  async function submit() {
    if (busy) return;
    const missing = missingConsents(consents);
    if (missing.length > 0) {
      setInvalid(true);
      setError(CONSENT_MESSAGE);
      listRef.current?.focus(missing[0]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await agreeConsents(consents);
    } catch {
      setError('저장하지 못했어요. 다시 해 주세요');
      setBusy(false);
      return;
    }
    const me = await fetchMe().catch(() => null);
    navigate(me?.onboarded === false ? GUIDE_PATH : next, { replace: true, state: { next } });
  }

  return (
    <AuthScreen testId="consent-screen" label="Case file · Consent" onClose={close} wordmarkAs="p">
      <div className="mt-8 rounded-[14px] border border-[#35292c] bg-[#1e1618] p-5 shadow-[0_24px_48px_rgba(0,0,0,0.45)]">
        <h1 className="m-0 font-dashSerif text-[20px] font-bold text-white">약관 동의</h1>
        <div className="mt-4">
          <ConsentList ref={listRef} value={consents} onChange={change} invalid={invalid} disabled={busy} />
        </div>
        {error ? <ErrorBox className="mt-4">{error}</ErrorBox> : null}
        <button type="button" onClick={() => void submit()} disabled={busy} className={`mt-4 ${PRIMARY_BUTTON}`}>
          {busy ? '저장하는 중' : '동의하고 시작하기'}
        </button>
      </div>
    </AuthScreen>
  );
}
