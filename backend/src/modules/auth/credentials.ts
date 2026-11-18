// 2026-11-18 대표 지시 — 이메일 회원가입·로그인 입력 검사.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
export const DISPLAY_NAME_MAX_LENGTH = 20;
const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = normalizeEmail(value);
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * 가입 비밀번호 규칙 — 8자 이상, 영문과 숫자를 모두 포함 (대표 지시 2026-11-18, 플랫폼 조사:
 * docs/context/research-2026-11-18-signup-fields.md 4장). 로그인에는 적용하지 않는다 —
 * 규칙이 생기기 전에 가입한 계정도 그대로 로그인한다.
 */
function validPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH &&
    /[A-Za-z]/.test(value) &&
    /[0-9]/.test(value)
  );
}

export function parseSignup(body: unknown): Parsed<SignupInput> {
  const input = (body ?? {}) as Record<string, unknown>;
  const email = parseEmail(input.email);
  if (!email) return { ok: false, message: 'invalid email' };
  if (!validPassword(input.password)) {
    return {
      ok: false,
      message: `password must be ${PASSWORD_MIN_LENGTH}+ characters with letters and digits`,
    };
  }
  const displayName = typeof input.display_name === 'string' ? input.display_name.trim() : '';
  const nameLength = [...displayName].length;
  if (nameLength < 1 || nameLength > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, message: `display_name must be 1-${DISPLAY_NAME_MAX_LENGTH} characters` };
  }
  return { ok: true, value: { email, password: input.password, displayName } };
}

export function parseLogin(body: unknown): Parsed<LoginInput> {
  const input = (body ?? {}) as Record<string, unknown>;
  const email = parseEmail(input.email);
  const password = input.password;
  if (!email || typeof password !== 'string' || password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: 'email and password are required' };
  }
  return { ok: true, value: { email, password } };
}
