import { useEffect, useId, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { ReaddMark } from '../components/Layout/Header';
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

const FIELD =
  'block min-h-12 w-full rounded-dash-card border border-dash-line bg-dash-card px-3.5 text-[16px] text-dash-ink outline-none placeholder:text-dash-muted focus:border-brief-accent';
const LABEL = 'mb-1.5 block text-[14px] font-bold text-dash-ink';
const OUTLINE_BUTTON =
  'inline-flex min-h-12 w-full items-center justify-center rounded-full border border-dash-line bg-dash-card px-4 text-[15px] font-bold text-dash-ink transition-colors active:bg-dash-ink/10';

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

  const tabClass = (active: boolean) =>
    `min-h-10 flex-1 rounded-full text-[15px] font-bold transition-colors ${
      active ? 'bg-dash-card text-dash-ink shadow-dash-soft' : 'text-dash-muted'
    }`;

  return (
    <div
      className="min-h-[100dvh] bg-dash-paper font-dashSans text-dash-ink"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="mx-auto flex w-full max-w-[420px] flex-col px-5 pb-10 pt-[12vh]">
        <h1 className="text-center font-dashMono text-[34px] font-medium tracking-[-1.5px]">
          <span className="sr-only">RE:ADD</span>
          <span aria-hidden="true">
            RE<ReaddMark />
            ADD
          </span>
        </h1>

        <div role="tablist" aria-label="로그인 방식" className="mt-10 flex gap-1 rounded-full bg-dash-line/70 p-1">
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

        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
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
                className="absolute inset-y-0 right-1 my-auto h-10 rounded-full px-3 text-[14px] font-bold text-dash-ink"
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
            <p role="alert" className="m-0 break-keep text-[14px] font-bold text-brief-accent">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || !filled}
            className="mt-1 min-h-12 w-full rounded-full bg-brief-accent text-[16px] font-bold text-brief-on-accent transition-opacity disabled:opacity-40"
          >
            {busy ? (mode === 'signup' ? '가입하는 중' : '로그인하는 중') : mode === 'signup' ? '가입하기' : '로그인'}
          </button>
        </form>

        {oauth.length > 0 ? (
          <div className="mt-8">
            <div className="flex items-center gap-3 text-[13px] text-dash-ink" aria-hidden="true">
              <span className="h-px flex-1 bg-dash-line" />
              또는
              <span className="h-px flex-1 bg-dash-line" />
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
