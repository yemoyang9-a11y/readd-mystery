import { createHash, timingSafeEqual } from 'crypto';
import express, { Router, type RequestHandler } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { createRateLimiter, rateLimit } from '../auth/rate-limit';

const MIN_TOKEN_LENGTH = 32;
/** 관리자 비밀번호 최소 길이 — 2026-11-18 대표 지시로 기억할 수 있는 비밀번호를 쓰므로 시도 제한과 함께 둔다 */
export const MIN_ADMIN_PASSWORD_LENGTH = 8;
const ADMIN_AUDIENCE = 'ssabi.admin';
const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function sameSecret(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * 세션 서명 키 = 서버 비밀(AUTH_TOKEN_SECRET) + 비밀번호 지문. 비밀번호를 바꾸면 이전 세션이 모두 무효가 된다.
 * 서버가 여러 대여도 같은 키라 어느 서버에서나 확인된다.
 */
function sessionKey(password: string, secret: string): Uint8Array {
  return createHash('sha256').update(`${secret}\0admin\0`).update(digest(password)).digest();
}

export async function signAdminSession(
  password: string,
  secret: string,
  issuedAt = new Date()
): Promise<string> {
  const iat = Math.floor(issuedAt.getTime() / 1000);
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(ADMIN_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ADMIN_SESSION_SECONDS)
    .sign(sessionKey(password, secret));
}

async function validAdminSession(
  token: string,
  password: string,
  secret: string
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, sessionKey(password, secret), {
      audience: ADMIN_AUDIENCE,
      algorithms: ['HS256'],
    });
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

const defaultPassword = () => process.env.ADMIN_PASSWORD;
const defaultSecret = () => process.env.AUTH_TOKEN_SECRET;

/**
 * POST /admin/login {password} → {token, expires_in}. 관리자 인증보다 앞에 꽂는다.
 * 2026-11-18 대표 지시: 토큰 대신 비밀번호 하나로 들어간다. IP마다 1분 5회 제한(서버 한 대 메모리 기준).
 * FR-ADM-006 🚦
 */
export function adminLoginRouter({
  getPassword = defaultPassword,
  getSecret = defaultSecret,
  attemptsPerMinute = 5,
}: {
  getPassword?: () => string | undefined;
  getSecret?: () => string | undefined;
  attemptsPerMinute?: number;
} = {}): Router {
  const router = Router();
  const limiter = createRateLimiter({ limit: attemptsPerMinute, windowMs: 60_000 });
  router.post('/login', rateLimit(limiter, 'admin-login'), express.json(), async (req, res) => {
    const expected = getPassword();
    const secret = getSecret();
    if (!expected || expected.length < MIN_ADMIN_PASSWORD_LENGTH || !secret) {
      res
        .status(503)
        .json({ error: 'ADMIN_DISABLED', message: 'Admin password is not configured' });
      return;
    }
    const provided = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!provided || !sameSecret(provided, expected)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid admin password' });
      return;
    }
    res.json({
      token: await signAdminSession(expected, secret),
      expires_in: ADMIN_SESSION_SECONDS,
    });
  });
  return router;
}

// FR-ADM-006 🚦 — 관리자 API는 (1) 비밀번호 로그인으로 받은 세션 토큰 또는 (2) 스크립트용 ADMIN_API_TOKEN 만 연다
export function adminAuth(
  getToken: () => string | undefined = () => process.env.ADMIN_API_TOKEN,
  getPassword: () => string | undefined = defaultPassword,
  getSecret: () => string | undefined = defaultSecret
): RequestHandler {
  return (req, res, next) => {
    const apiToken = getToken();
    const password = getPassword();
    const secret = getSecret();
    const tokenEnabled = Boolean(apiToken && apiToken.length >= MIN_TOKEN_LENGTH);
    const passwordEnabled = Boolean(
      password && password.length >= MIN_ADMIN_PASSWORD_LENGTH && secret
    );
    if (!tokenEnabled && !passwordEnabled) {
      res.status(503).json({ error: 'ADMIN_DISABLED', message: 'Admin API is not configured' });
      return;
    }
    const provided = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const deny = () =>
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid admin token' });
    if (!provided) {
      deny();
      return;
    }
    if (tokenEnabled && sameSecret(provided, apiToken!)) {
      next();
      return;
    }
    if (!passwordEnabled) {
      deny();
      return;
    }
    void validAdminSession(provided, password!, secret!).then((ok) => (ok ? next() : deny()));
  };
}
