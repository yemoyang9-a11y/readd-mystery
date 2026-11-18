import { useEffect, useId, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { CaseLabel } from '../mobile/components/CaseMotifs';
import {
  fetchMe,
  fetchProviders,
  login,
  signup,
  startLogin,
  type AuthProvider,
  type LoginMethod,
} from '../services/authService';
import { GUIDE_PATH, safeNextPath } from '../utils/authRedirect';
import { getAuthToken } from '../utils/storage';

type Mode = 'login' | 'signup';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const DISPLAY_NAME_MAX_LENGTH = 20;

// 미스터리 브랜딩(2026-11-18 대표 지시) — data-night 토큰. 조사: docs/context/research-2026-11-18-new-screens.md 1장
const FIELD =
  'block min-h-12 w-full rounded-[10px] border border-[#35292c] bg-[#0d0a0b] px-3.5 text-[16px] text-[#ece6e0] outline-none transition-colors placeholder:text-[#8a7f81] focus:border-[#c4475f] focus-visible:ring-2 focus-visible:ring-[#c4475f]/35 disabled:opacity-60';
const LABEL = 'mb-1.5 block text-[13px] font-bold tracking-[0.02em] text-[#ece6e0]';
const OUTLINE_BUTTON =
  'inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[#35292c] bg-transparent px-4 text-[15px] font-bold text-[#ece6e0] transition-colors active:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]';

const PROVIDER_LABEL: Record<AuthProvider, string> = {
  google: '구글로 계속하기',
  kakao: '카카오로 계속하기',
};

function errorMessage(error: unknown, mode: Mode): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 409) return '이미 가입된 이메일이에요';
    if (status === 401) return '이메일 또는 비밀번호가 맞지 않아요';
    if (status === 429) return '시도가 너무 많아요. 잠시 후 다시 해 주세요';
    if (status === 400) return '입력한 내용을 다시 확인해 주세요';
    if (status === undefined) return '연결하지 못했어요. 잠시 후 다시 해 주세요';
  }
  return mode === 'signup' ? '가입하지 못했어요. 다시 해 주세요' : '로그인하지 못했어요. 다시 해 주세요';
}

function validate(mode: Mode, email: string, password: string, displayName: string): string | null {
  if (!EMAIL_PATTERN.test(email.trim())) return '이메일 형식을 확인해 주세요';
  if (mode === 'signup') {
    if (password.length < PASSWORD_MIN_LENGTH) return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 해요`;
    const nameLength = [...displayName.trim()].length;
    if (nameLength < 1 || nameLength > DISPLAY_NAME_MAX_LENGTH) {
      return `닉네임은 1~${DISPLAY_NAME_MAX_LENGTH}자로 정해 주세요`;
    }
  }
  return null;
}

/**
 * 로그인·회원가입 (2026-11-18 대표 지시 — 처음 접속하면 로그인·회원가입 창).
 *
 * 성공하면 가려던 주소(?next=)로 돌아간다. 새로 가입했거나 첫 안내를 마치지 않은 계정
 * (/auth/me 의 onboarded === false)은 첫 안내(/guide)로 보낸다.
 */
export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const ids = { email: useId(), password: useId(), name: useId() };

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [methods, setMethods] = useState<LoginMethod[]>(['email']);
  const [alreadySignedIn] = useState(() => Boolean(getAuthToken()));

  useEffect(() => {
    let active = true;
    fetchProviders().then((list) => {
      if (active) setMethods(list);
    });
    return () => {
      active = false;
    };
  }, []);

  if (alreadySignedIn) return <Navigate to={next} replace />;

  const oauth = methods.filter((m): m is AuthProvider => m === 'google' || m === 'kakao');
  const filled = email.trim() !== '' && password !== '' && (mode === 'login' || displayName.trim() !== '');

  function switchMode(target: Mode) {
    setMode(target);
    setError(null);
  }

  async function finishLogin() {
    // 첫 안내를 마쳤는지 모르면(옛 서버, 조회 실패) 가려던 곳으로 간다
    const me = await fetchMe().catch(() => null);
    navigate(me?.onboarded === false ? GUIDE_PATH : next, { replace: true, state: { next } });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const invalid = validate(mode, email, password, displayName);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await signup({ email: email.trim(), password, displayName: displayName.trim() });
        navigate(GUIDE_PATH, { replace: true, state: { next } });
      } else {
        await login(email.trim(), password);
        await finishLogin();
      }
    } catch (failure) {
      setError(errorMessage(failure, mode));
      setBusy(false);
    }
  }

  // 서류철 탭 — 고른 탭은 아래 카드와 같은 색으로 이어 붙는다
  const tabClass = (active: boolean) =>
    `relative min-h-11 rounded-t-[10px] border border-b-0 px-5 text-[15px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#e58a9b] ${
      active
        ? 'z-[1] -mb-px border-[#35292c] bg-[#1e1618] pb-px text-[#ece6e0]'
        : 'border-transparent text-[#a89e9a]'
    }`;

  return (
    <div
      data-night
      data-testid="login-screen"
      className="min-h-[100dvh] bg-[#0d0a0b] font-dashSans text-[#ece6e0]"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
        background: 'radial-gradient(130% 55% at 50% 0%, #2c1219 0%, #170d10 48%, #0d0a0b 100%)',
      }}
    >
      <div className="mx-auto flex w-full max-w-[420px] flex-col px-5 pb-10 pt-[9vh]">
        <CaseLabel>Case file · Reader</CaseLabel>
        <h1 className="m-0 mt-3 font-dashSans text-[36px] font-bold leading-none tracking-[0.04em] text-white">RE:ADD</h1>
        <div role="tablist" aria-label="로그인 방식" className="mt-10 flex gap-1 pl-2">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            onClick={() => switchMode('login')}
            className={tabClass(mode === 'login')}
          >
            로그인
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            onClick={() => switchMode('signup')}
            className={tabClass(mode === 'signup')}
          >
            회원가입
          </button>
        </div>

        <div className="rounded-[14px] border border-[#35292c] bg-[#1e1618] p-5 shadow-[0_24px_48px_rgba(0,0,0,0.45)]">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div>
            <label htmlFor={ids.email} className={LABEL}>
              이메일
            </label>
            <input
              id={ids.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor={ids.password} className={LABEL}>
              비밀번호
            </label>
            <div className="relative">
              <input
                id={ids.password}
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                className={`${FIELD} pr-16`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-pressed={showPassword}
                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                className="absolute inset-y-0 right-1 my-auto h-10 rounded-full px-3 text-[14px] font-bold text-[#e58a9b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
              >
                {showPassword ? '숨기기' : '보기'}
              </button>
            </div>
          </div>

          {mode === 'signup' ? (
            <div>
              <label htmlFor={ids.name} className={LABEL}>
                닉네임
              </label>
              <input
                id={ids.name}
                type="text"
                autoComplete="nickname"
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                value={displayName}
                disabled={busy}
                onChange={(event) => setDisplayName(event.target.value)}
                className={FIELD}
              />
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="m-0 flex items-start gap-2 break-keep rounded-[10px] border border-[#c4475f]/50 bg-[#2d161d] px-3 py-2.5 text-[14px] font-bold text-[#f0b3be]"
            >
              <span aria-hidden="true" className="font-dashMono text-[#e58a9b]">!</span>
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || !filled}
            className="mt-1 min-h-12 w-full rounded-full bg-[#8f1d35] text-[16px] font-bold text-white transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1618] disabled:bg-[#4a2630] disabled:text-[#c9b7ba]"
          >
            {busy ? (mode === 'signup' ? '가입하는 중' : '로그인하는 중') : mode === 'signup' ? '가입하기' : '로그인'}
          </button>
        </form>
        </div>

        {oauth.length > 0 ? (
          <div className="mt-8">
            <div className="flex items-center gap-3 font-dashMono text-[12px] tracking-[0.12em] text-[#a89e9a]" aria-hidden="true">
              <span className="h-px flex-1 bg-[#35292c]" />
              또는
              <span className="h-px flex-1 bg-[#35292c]" />
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {oauth.map((provider) => (
                <button key={provider} type="button" onClick={() => startLogin(provider)} className={OUTLINE_BUTTON}>
                  {PROVIDER_LABEL[provider]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
