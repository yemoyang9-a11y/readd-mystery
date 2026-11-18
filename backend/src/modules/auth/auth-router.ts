import { randomBytes } from 'crypto';
import express, { Request, Response, Router } from 'express';
import { EmailTakenError, type AuthService, type Provider } from './auth.service';
import { parseConsents, type ConsentKind } from './consents';
import { parseLogin, parseSignup } from './credentials';
import type { OAuthProviders } from './oauth-providers';
import { createRateLimiter, rateLimit, type RateLimiter } from './rate-limit';
import { attachReaderIdentity, getSession, UUID_PATTERN } from './reader-id.middleware';
import { signLoginState, verifyLoginState } from './session-token';

const NONCE_COOKIE = 'ssabi_login_nonce';
const NONCE_COOKIE_PATH = '/auth';
const NONCE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
const CREDENTIAL_ATTEMPTS_PER_MINUTE = 10;

/** OAuth 제공자는 클라이언트 id와 비밀 값이 둘 다 있을 때만 쓸 수 있다 */
const OAUTH_ENV: Record<Provider, [string, string]> = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  kakao: ['KAKAO_CLIENT_ID', 'KAKAO_CLIENT_SECRET'],
};

export function availableLoginMethods(env: NodeJS.ProcessEnv = process.env): string[] {
  const oauth = (Object.keys(OAUTH_ENV) as Provider[]).filter((provider) =>
    OAUTH_ENV[provider].every((name) => Boolean(env[name]))
  );
  return ['email', ...oauth];
}

function deviceIdFrom(req: Request): string | null {
  const header = req.headers['x-device-id'];
  return typeof header === 'string' && UUID_PATTERN.test(header) ? header : null;
}

export interface AuthConfig {
  frontendOrigin: string;
  redirectBase: string;
  /** 로그인 뒤 돌아갈 수 있는 화면 오리진(CORS_ORIGIN 과 같은 목록). FRONTEND_ORIGIN 은 늘 허용 */
  allowedReturnOrigins?: string[];
}

/**
 * 로그인을 시작한 화면 주소를 확인한다(2026-11-18 — 카카오 로그인 뒤 옛 배포 주소로 가던 문제).
 * 허용된 오리진의 http(s) 주소만, 계정 정보·쿼리·해시 없이 오리진 + 경로로 줄여 돌려준다.
 * 허용되지 않으면 null — 다른 사이트로 1회용 코드를 보내지 않는다.
 */
function parseReturnTo(value: string, config: AuthConfig): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const allowed = new Set(
    [config.frontendOrigin, ...(config.allowedReturnOrigins ?? [])].map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return o;
      }
    })
  );
  if (!allowed.has(url.origin)) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function parseProvider(value: string): Provider | null {
  return value === 'google' || value === 'kakao' ? value : null;
}

function callbackUri(redirectBase: string, provider: Provider): string {
  return `${redirectBase}/auth/${provider}/callback`;
}

function readCookie(req: Request, name: string): string | undefined {
  const entry = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return entry?.slice(name.length + 1);
}

function sendInternalError(res: Response) {
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
}

// 대표 지시 2026-11-18 — 필수 약관 동의가 빠지면 무엇이 빠졌는지 알려 준다
function sendConsentRequired(res: Response, missing: ConsentKind[]) {
  return res
    .status(400)
    .json({ error: 'CONSENT_REQUIRED', message: 'Required consents missing', missing });
}

function sendUnauthorized(res: Response) {
  return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Login required' });
}

function sendProviderNotFound(res: Response) {
  return res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown login provider' });
}

export function createAuthRouter({
  service,
  providers,
  loadConfig,
  credentialLimiter = createRateLimiter({
    limit: CREDENTIAL_ATTEMPTS_PER_MINUTE,
    windowMs: 60_000,
  }),
}: {
  service: AuthService;
  providers: OAuthProviders;
  loadConfig: () => AuthConfig;
  credentialLimiter?: RateLimiter;
}): Router {
  const router = express.Router();

  // 2026-11-18 대표 지시 — 로그인 화면이 보여 줄 방법. 이메일은 항상 쓸 수 있다
  router.get('/auth/providers', (_req: Request, res: Response) => {
    res.json({ providers: availableLoginMethods() });
  });

  router.post(
    '/auth/signup',
    rateLimit(credentialLimiter, 'credentials'),
    async (req: Request, res: Response) => {
      const parsed = parseSignup(req.body);
      if (!parsed.ok)
        return res.status(400).json({ error: 'BAD_REQUEST', message: parsed.message });
      const consents = parseConsents(req.body?.consents);
      if (!consents.ok) return sendConsentRequired(res, consents.missing);

      try {
        // 로그인 전 기기의 독서 기록을 이어 쓴다 — OAuth 첫 로그인과 같은 규칙
        const session = await service.signupWithPassword(
          parsed.value,
          deviceIdFrom(req),
          consents.value
        );
        return res.status(201).json(session);
      } catch (error) {
        if (error instanceof EmailTakenError) {
          return res
            .status(409)
            .json({ error: 'EMAIL_TAKEN', message: 'Email already registered' });
        }
        console.error('[API] auth signup error', { error });
        return sendInternalError(res);
      }
    }
  );

  router.post(
    '/auth/login',
    rateLimit(credentialLimiter, 'credentials'),
    async (req: Request, res: Response) => {
      const parsed = parseLogin(req.body);
      if (!parsed.ok)
        return res.status(400).json({ error: 'BAD_REQUEST', message: parsed.message });

      try {
        const session = await service.loginWithPassword(parsed.value);
        if (!session) {
          return res
            .status(401)
            .json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
        }
        return res.json(session);
      } catch (error) {
        console.error('[API] auth login error', { error });
        return sendInternalError(res);
      }
    }
  );

  router.get('/auth/:provider/start', async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    if (!provider) return sendProviderNotFound(res);

    const deviceId = req.query.device_id;
    if (typeof deviceId !== 'string' || !UUID_PATTERN.test(deviceId)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'invalid device_id' });
    }

    try {
      const config = loadConfig();
      const { redirectBase } = config;
      let returnTo: string | undefined;
      if (typeof req.query.return_to === 'string') {
        const parsed = parseReturnTo(req.query.return_to, config);
        if (!parsed) {
          return res.status(400).json({ error: 'BAD_REQUEST', message: 'invalid return_to' });
        }
        returnTo = parsed;
      }
      const nonce = randomBytes(16).toString('base64url');
      const state = await signLoginState({ provider, deviceId, nonce, returnTo });
      res.cookie(NONCE_COOKIE, nonce, {
        httpOnly: true,
        sameSite: 'lax',
        secure: redirectBase.startsWith('https://'),
        path: NONCE_COOKIE_PATH,
        maxAge: NONCE_COOKIE_MAX_AGE_MS,
      });
      return res.redirect(
        302,
        providers.authorizationUrl(provider, state, callbackUri(redirectBase, provider))
      );
    } catch (error) {
      console.error('[API] auth start error', { provider, error });
      return sendInternalError(res);
    }
  });

  router.get('/auth/:provider/callback', async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    if (!provider) return sendProviderNotFound(res);

    const state =
      typeof req.query.state === 'string' ? await verifyLoginState(req.query.state) : null;
    const nonce = readCookie(req, NONCE_COOKIE);
    if (!state || state.provider !== provider || !nonce || nonce !== state.nonce) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'invalid state' });
    }

    try {
      const { frontendOrigin, redirectBase } = loadConfig();
      const callbackPage = `${state.returnTo ?? frontendOrigin}/auth/callback`;
      const cancelledPage = `${callbackPage}#error=cancelled`;
      res.clearCookie(NONCE_COOKIE, { path: NONCE_COOKIE_PATH });

      const providerCode = req.query.code;
      if (req.query.error !== undefined || typeof providerCode !== 'string') {
        return res.redirect(302, cancelledPage);
      }

      try {
        const profile = await providers.exchangeCode(
          provider,
          providerCode,
          callbackUri(redirectBase, provider)
        );
        const account = await service.completeLogin(provider, profile, state.deviceId);
        const loginCode = await service.issueLoginCode(account.user_id);
        return res.redirect(302, `${callbackPage}#code=${encodeURIComponent(loginCode)}`);
      } catch (error) {
        console.error('[API] auth callback error', { provider, error });
        return res.redirect(302, cancelledPage);
      }
    } catch (error) {
      console.error('[API] auth callback config error', { provider, error });
      return sendInternalError(res);
    }
  });

  router.post('/auth/exchange', async (req: Request, res: Response) => {
    const code: unknown = req.body?.code;
    if (typeof code !== 'string') {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'code is required' });
    }

    try {
      const session = await service.redeemLoginCode(code);
      if (!session) {
        return res.status(400).json({ error: 'INVALID_CODE', message: 'Invalid login code' });
      }
      return res.json(session);
    } catch (error) {
      console.error('[API] auth exchange error', { error });
      return sendInternalError(res);
    }
  });

  router.get('/auth/me', attachReaderIdentity(), async (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) return sendUnauthorized(res);

    try {
      const me = await service.getMe(session.userId);
      return me ? res.json(me) : sendUnauthorized(res);
    } catch (error) {
      console.error('[API] auth me error', { error });
      return sendInternalError(res);
    }
  });

  // 대표 지시 2026-11-18 — 카카오·구글 첫 로그인(또는 이 변경 전 가입 계정)의 약관 동의
  router.post('/auth/me/consents', attachReaderIdentity(), async (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) return sendUnauthorized(res);
    const consents = parseConsents(req.body?.consents);
    if (!consents.ok) return sendConsentRequired(res, consents.missing);

    try {
      await service.agreeConsents(session.userId, consents.value);
      return res.status(204).send();
    } catch (error) {
      console.error('[API] auth consents error', { error });
      return sendInternalError(res);
    }
  });

  router.post('/auth/me/onboarded', attachReaderIdentity(), async (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) return sendUnauthorized(res);

    try {
      await service.markOnboarded(session.userId);
      return res.status(204).send();
    } catch (error) {
      console.error('[API] auth onboarded error', { error });
      return sendInternalError(res);
    }
  });

  router.delete('/auth/me', attachReaderIdentity(), async (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) return sendUnauthorized(res);

    try {
      await service.withdraw(session.userId, session.readerId);
      return res.status(204).send();
    } catch (error) {
      console.error('[API] auth withdraw error', { error });
      return sendInternalError(res);
    }
  });

  return router;
}
