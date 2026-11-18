import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import AuthScreen, { ErrorBox, PRIMARY_BUTTON, closeTarget } from '../components/auth/AuthScreen';
import ConsentList, { type ConsentListHandle } from '../components/auth/ConsentList';
import {
  fetchMe,
  fetchProviders,
  login,
  signup,
  startLogin,
  type AuthProvider,
  type LoginMethod,
} from '../services/authService';
import { EMPTY_CONSENTS, missingConsents, type ConsentChoice } from '../utils/consents';
import { GUIDE_PATH, consentPathFor, rememberLoginNext, safeNextPath } from '../utils/authRedirect';
import { getAuthToken } from '../utils/storage';

type Mode = 'login' | 'signup';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const DISPLAY_NAME_MAX_LENGTH = 20;
const CONSENT_MESSAGE = '필수 약관에 모두 동의해 주세요';

// 미스터리 브랜딩(2026-11-18 대표 지시) — data-night 토큰. 조사: docs/context/research-2026-11-18-new-screens.md 1장
const FIELD =
  'block min-h-12 w-full rounded-[10px] border border-[#35292c] bg-[#0d0a0b] px-3.5 text-[16px] text-[#ece6e0] outline-none transition-colors placeholder:text-[#8a7f81] focus:border-[#c4475f] aria-[invalid=true]:border-[#c4475f] focus-visible:ring-2 focus-visible:ring-[#c4475f]/35 disabled:opacity-60';
const LABEL = 'mb-1.5 block text-[13px] font-bold tracking-[0.02em] text-[#ece6e0]';
const OUTLINE_BUTTON =
  'inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[#35292c] bg-transparent px-4 text-[15px] font-bold text-[#ece6e0] transition-colors active:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]';

const PROVIDER_LABEL: Record<AuthProvider, string> = {
  google: '구글로 계속하기',
  kakao: '카카오로 계속하기',
};

/**
 * 가입 비밀번호 규칙 — 8자 이상, 영문·숫자 포함. 서버 credentials.ts 와 같다.
 * 조사(예스24 8~20자 조합, Amazon 6자)의 중간값: research-2026-11-18-signup-fields.md 4장.
 */
const PASSWORD_RULES: readonly { label: string; test: (value: string) => boolean }[] = [
  { label: '8자 이상', test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { label: '영문', test: (v) => /[A-Za-z]/.test(v) },
  { label: '숫자', test: (v) => /[0-9]/.test(v) },
];

function isConsentError(error: unknown): boolean {
  return (
    isAxiosError(error) &&
    error.response?.status === 400 &&
    (error.response.data as { error?: string } | undefined)?.error === 'CONSENT_REQUIRED'
  );
}

function errorMessage(error: unknown, mode: Mode): string {
  if (isConsentError(error)) return CONSENT_MESSAGE;
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

type Field = 'email' | 'password' | 'confirm' | 'name';
type FieldErrors = Partial<Record<Field, string>>;
/** 화면 위에서 아래 순서 — 처음 틀린 칸으로 초점을 옮길 때 쓴다 */
const FIELD_ORDER: readonly Field[] = ['email', 'password', 'confirm', 'name'];

interface Values {
  email: string;
  password: string;
  confirm: string;
  displayName: string;
}

/** E2E #3 — 빈칸·잘못된 값을 칸마다 알린다. 버튼은 막지 않는다 */
function validate(mode: Mode, { email, password, confirm, displayName }: Values): FieldErrors {
  const errors: FieldErrors = {};
  const trimmedEmail = email.trim();
  if (trimmedEmail === '') errors.email = '이메일을 입력해 주세요';
  else if (!EMAIL_PATTERN.test(trimmedEmail)) errors.email = '올바른 이메일 형식이 아니에요';
  if (mode === 'signup') {
    if (password.length < PASSWORD_MIN_LENGTH) errors.password = `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이에요`;
    else if (!PASSWORD_RULES.every((rule) => rule.test(password))) errors.password = '영문과 숫자를 모두 넣어 주세요';
    if (confirm === '') errors.confirm = '비밀번호를 한 번 더 입력해 주세요';
    else if (confirm !== password) errors.confirm = '비밀번호가 일치하지 않아요';
    const nameLength = [...displayName.trim()].length;
    if (nameLength < 1) errors.name = '닉네임을 입력해 주세요';
    else if (nameLength > DISPLAY_NAME_MAX_LENGTH) errors.name = `닉네임은 ${DISPLAY_NAME_MAX_LENGTH}자까지예요`;
  } else if (password === '') {
    errors.password = '비밀번호를 입력해 주세요';
  }
  return errors;
}

function RuleCheck({ met }: { met: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {met ? <path d="M2.5 6.2l2.3 2.3 4.7-5" /> : <circle cx="6" cy="6" r="1.6" fill="currentColor" stroke="none" />}
    </svg>
  );
}

/**
 * 로그인·회원가입 (대표 지시 2026-11-18).
 *
 * 처음부터 띄우지 않는다 — 작품을 열 때(관문, RequireSession)와 MY 의 로그인/회원가입 버튼에서만 온다.
 * 위 왼쪽 닫기로 들어오기 전 화면에 돌아간다. 성공하면 가려던 주소(?next=)로 돌아간다. 새로 가입했거나
 * 첫 안내를 마치지 않은 계정은 첫 안내(/guide)를 거쳐 next 로 간다. 약관 동의가 없는 옛 계정은
 * 동의 화면(/consent)을 먼저 거친다. 가입 항목: docs/context/research-2026-11-18-signup-fields.md 4장.
 */
export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const ids = { email: useId(), password: useId(), confirm: useId(), name: useId(), rules: useId() };

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [consents, setConsents] = useState<ConsentChoice>(EMPTY_CONSENTS);
  const [consentError, setConsentError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldRefs = {
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
  };
  const consentRef = useRef<ConsentListHandle>(null);
  const errorIds = { email: useId(), password: useId(), confirm: useId(), name: useId() };
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

  function switchMode(target: Mode) {
    setMode(target);
    setError(null);
    setFieldErrors({});
    setConsentError(false);
  }

  /** 고친 칸의 알림만 지운다 */
  function clearFieldError(field: Field) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const rest = { ...current };
      delete rest[field];
      return rest;
    });
  }

  /** 칸 알림을 aria-invalid·aria-describedby 로 잇는다 */
  function fieldA11y(field: Field) {
    return fieldErrors[field]
      ? { 'aria-invalid': true as const, 'aria-describedby': errorIds[field] }
      : {};
  }

  function changeConsents(value: ConsentChoice) {
    setConsents(value);
    if (consentError && missingConsents(value).length === 0) {
      setConsentError(false);
      setError((current) => (current === CONSENT_MESSAGE ? null : current));
    }
  }

  function close() {
    const target = closeTarget();
    if (target === -1) navigate(-1);
    else navigate(target, { replace: true });
  }

  async function finishLogin() {
    // 첫 안내를 마쳤는지 모르면(옛 서버, 조회 실패) 가려던 곳으로 간다
    const me = await fetchMe().catch(() => null);
    if (me?.consent_required) navigate(consentPathFor(next), { replace: true });
    else navigate(me?.onboarded === false ? GUIDE_PATH : next, { replace: true, state: { next } });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const invalid = validate(mode, { email, password, confirm, displayName });
    const firstInvalid = FIELD_ORDER.find((field) => invalid[field]);
    setFieldErrors(invalid);
    if (firstInvalid) {
      setError(null);
      fieldRefs[firstInvalid].current?.focus();
      return;
    }
    if (mode === 'signup') {
      const missing = missingConsents(consents);
      if (missing.length > 0) {
        setConsentError(true);
        setError(CONSENT_MESSAGE);
        consentRef.current?.focus(missing[0]);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await signup({ email: email.trim(), password, displayName: displayName.trim(), consents });
        navigate(GUIDE_PATH, { replace: true, state: { next } });
      } else {
        await login(email.trim(), password);
        await finishLogin();
      }
    } catch (failure) {
      if (isConsentError(failure)) setConsentError(true);
      setError(errorMessage(failure, mode));
      setBusy(false);
    }
  }

  function continueWith(provider: AuthProvider) {
    // 다른 사이트를 다녀오므로 가려던 주소를 이 탭에 남긴다 — /auth/callback 이 꺼내 쓴다
    rememberLoginNext(next);
    startLogin(provider);
  }

  // 서류철 탭 — 고른 탭은 아래 카드와 같은 색으로 이어 붙는다
  const tabClass = (active: boolean) =>
    `relative min-h-11 rounded-t-[10px] border border-b-0 px-5 text-[15px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#e58a9b] ${
      active
        ? 'z-[1] -mb-px border-[#35292c] bg-[#1e1618] pb-px text-[#ece6e0]'
        : 'border-transparent text-[#a89e9a]'
    }`;

  return (
    <AuthScreen testId="login-screen" label="Case file · Reader" onClose={close}>
      <div role="tablist" aria-label="로그인 방식" className="mt-8 flex gap-1 pl-2">
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
              autoComplete={mode === 'signup' ? 'email' : 'username'}
              autoCapitalize="none"
              spellCheck={false}
              ref={fieldRefs.email}
              value={email}
              disabled={busy}
              onChange={(event) => {
                setEmail(event.target.value);
                clearFieldError('email');
              }}
              placeholder="name@example.com"
              className={FIELD}
              {...fieldA11y('email')}
            />
            {fieldErrors.email ? <ErrorBox id={errorIds.email} className="mt-2">{fieldErrors.email}</ErrorBox> : null}
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
                ref={fieldRefs.password}
                value={password}
                disabled={busy}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFieldError('password');
                }}
                className={`${FIELD} pr-16`}
                {...fieldA11y('password')}
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
            {mode === 'signup' ? (
              <ul id={ids.rules} aria-label="비밀번호 규칙" className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(password);
                  return (
                    <li
                      key={rule.label}
                      data-met={met}
                      className={`inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-[13px] font-bold transition-colors ${
                        met ? 'border-[#c4475f] bg-[#2d161d] text-[#f0b3be]' : 'border-[#35292c] text-[#c9bfbb]'
                      }`}
                    >
                      <RuleCheck met={met} />
                      {rule.label}
                      <span className="sr-only">{met ? ' 충족' : ' 미충족'}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {fieldErrors.password ? (
              <ErrorBox id={errorIds.password} className="mt-2">{fieldErrors.password}</ErrorBox>
            ) : null}
          </div>

          {mode === 'signup' ? (
            <>
              <div>
                <label htmlFor={ids.confirm} className={LABEL}>
                  비밀번호 확인
                </label>
                <input
                  id={ids.confirm}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  ref={fieldRefs.confirm}
                  value={confirm}
                  disabled={busy}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    clearFieldError('confirm');
                  }}
                  className={FIELD}
                  {...fieldA11y('confirm')}
                />
                {fieldErrors.confirm ? (
                  <ErrorBox id={errorIds.confirm} className="mt-2">{fieldErrors.confirm}</ErrorBox>
                ) : null}
              </div>

              <div>
                <label htmlFor={ids.name} className={LABEL}>
                  닉네임
                </label>
                <input
                  id={ids.name}
                  type="text"
                  autoComplete="nickname"
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  ref={fieldRefs.name}
                  value={displayName}
                  disabled={busy}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    clearFieldError('name');
                  }}
                  className={FIELD}
                  {...fieldA11y('name')}
                />
                {fieldErrors.name ? <ErrorBox id={errorIds.name} className="mt-2">{fieldErrors.name}</ErrorBox> : null}
              </div>

              <div className="mt-1">
                <ConsentList
                  ref={consentRef}
                  value={consents}
                  onChange={changeConsents}
                  invalid={consentError}
                  disabled={busy}
                />
              </div>
            </>
          ) : null}

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          <button type="submit" disabled={busy} className={`mt-1 ${PRIMARY_BUTTON}`}>
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
              <button key={provider} type="button" onClick={() => continueWith(provider)} className={OUTLINE_BUTTON}>
                {PROVIDER_LABEL[provider]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </AuthScreen>
  );
}
