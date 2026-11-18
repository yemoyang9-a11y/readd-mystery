import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { FakeAccountRepository } from '../../../tests/unit/auth/fakes';
import { createAuthRouter } from './auth-router';
import { CONSENT_VERSION } from './consents';
import { AuthService } from './auth.service';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { verifySessionToken } from './session-token';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const CONSENTS = { terms: true, privacy: true, age14: true, marketing: false };
const OAUTH_ENV = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'KAKAO_CLIENT_ID',
  'KAKAO_CLIENT_SECRET',
];

describe('이메일 인증 라우터 — 2026-11-18 대표 지시', () => {
  let server: Server;
  let baseUrl: string;
  let accounts: FakeAccountRepository;
  let limiter: RateLimiter;
  const savedEnv: Record<string, string | undefined> = {};

  async function start(credentialLimiter?: RateLimiter) {
    const app = express();
    app.use(express.json());
    app.use(
      createAuthRouter({
        service: new AuthService(accounts),
        providers: { authorizationUrl: () => 'https://provider.test', exchangeCode: jest.fn() },
        loadConfig: () => ({
          frontendOrigin: 'https://app.test',
          redirectBase: 'https://api.test',
        }),
        credentialLimiter,
      })
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeEach(async () => {
    process.env.AUTH_TOKEN_SECRET = 'test-only-signing-value-aaaaaaaaaaaa';
    for (const name of OAUTH_ENV) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    accounts = new FakeAccountRepository();
    limiter = createRateLimiter({ limit: 1000, windowMs: 60_000 });
    await start(limiter);
  });

  afterEach(async () => {
    delete process.env.AUTH_TOKEN_SECRET;
    for (const name of OAUTH_ENV) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
    await new Promise((resolve) => server.close(resolve));
  });

  function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  function signup(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    return post(
      '/auth/signup',
      {
        email: 'reader@example.com',
        password: 'secret-pass1',
        display_name: '독자',
        consents: CONSENTS,
        ...body,
      },
      { 'X-Device-Id': DEVICE_ID, ...headers }
    );
  }

  describe('POST /auth/signup', () => {
    test('가입하면 201과 토큰·표시 이름·is_new를 주고 기기 id를 독자 id로 쓴다', async () => {
      const response = await signup();
      expect(response.status).toBe(201);
      const body = (await response.json()) as { token: string };
      expect(body).toEqual({ token: expect.any(String), display_name: '독자', is_new: true });
      await expect(verifySessionToken(body.token)).resolves.toMatchObject({ readerId: DEVICE_ID });
    });

    test('대소문자만 다른 같은 이메일은 409 EMAIL_TAKEN이다', async () => {
      await signup();
      const response = await signup({ email: 'Reader@Example.com' });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: 'EMAIL_TAKEN' });
    });

    test.each([
      [{ email: 'nope' }],
      [{ password: 'short1' }],
      [{ password: 'onlyletters' }],
      [{ password: '1234567890' }],
      [{ display_name: '' }],
      [{ display_name: '가'.repeat(21) }],
    ])('잘못된 입력은 400이고 계정을 만들지 않는다 %#', async (override) => {
      const response = await signup(override);
      expect(response.status).toBe(400);
      expect(accounts.accounts).toHaveLength(0);
    });

    test.each([
      [{ privacy: true, age14: true }, ['terms']],
      [{ terms: true, age14: true }, ['privacy']],
      [{ terms: true, privacy: true }, ['age14']],
      [{}, ['terms', 'privacy', 'age14']],
    ])(
      '필수 약관 동의가 빠지면 400 CONSENT_REQUIRED이고 계정을 만들지 않는다 %#',
      async (consents, missing) => {
        const response = await signup({ consents });
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          error: 'CONSENT_REQUIRED',
          missing,
        });
        expect(accounts.accounts).toHaveLength(0);
        expect(accounts.consents).toHaveLength(0);
      }
    );

    test('동의 묶음 없이 보내면 400 CONSENT_REQUIRED다', async () => {
      const response = await post(
        '/auth/signup',
        { email: 'reader@example.com', password: 'secret-pass1', display_name: '독자' },
        { 'X-Device-Id': DEVICE_ID }
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: 'CONSENT_REQUIRED' });
      expect(accounts.accounts).toHaveLength(0);
    });

    test('필수 동의를 모두 하면 201이고 네 종류 동의를 현재 버전·시각과 함께 저장한다', async () => {
      const response = await signup({ consents: { ...CONSENTS, marketing: true } });
      expect(response.status).toBe(201);
      const userId = accounts.accounts[0].user_id;
      expect(
        accounts.consents.map(({ userId: id, kind, agreed }) => ({ id, kind, agreed }))
      ).toEqual([
        { id: userId, kind: 'terms', agreed: true },
        { id: userId, kind: 'privacy', agreed: true },
        { id: userId, kind: 'age14', agreed: true },
        { id: userId, kind: 'marketing', agreed: true },
      ]);
      for (const record of accounts.consents) {
        expect(record.version).toBe(CONSENT_VERSION);
        expect(record.agreedAt).toBeInstanceOf(Date);
      }
    });

    test('마케팅 수신은 선택이다 — 빼고 가입해도 201이고 거절로 남는다', async () => {
      const { marketing: _skip, ...required } = CONSENTS;
      const response = await signup({ consents: required });
      expect(response.status).toBe(201);
      expect(accounts.consents.find((record) => record.kind === 'marketing')?.agreed).toBe(false);
    });
  });

  describe('POST /auth/login', () => {
    test('맞는 이메일·비밀번호면 토큰과 표시 이름을 준다', async () => {
      await signup();
      const response = await post('/auth/login', {
        email: 'READER@example.com',
        password: 'secret-pass1',
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { token: string };
      expect(body).toEqual({ token: expect.any(String), display_name: '독자' });
      await expect(verifySessionToken(body.token)).resolves.toMatchObject({ readerId: DEVICE_ID });
    });

    test('틀린 비밀번호와 없는 이메일은 같은 401 INVALID_CREDENTIALS다', async () => {
      await signup();
      const wrong = await post('/auth/login', {
        email: 'reader@example.com',
        password: 'bad-pass-1',
      });
      const unknown = await post('/auth/login', {
        email: 'nobody@example.com',
        password: 'secret-pass1',
      });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(await wrong.json()).toEqual(await unknown.json());
    });

    test('형식이 맞지 않는 요청은 400이다', async () => {
      const response = await post('/auth/login', { email: 'reader@example.com' });
      expect(response.status).toBe(400);
    });
  });

  describe('시도 횟수 제한', () => {
    test('같은 IP가 분당 한도를 넘으면 429이고 다른 IP는 막지 않는다', async () => {
      await new Promise((resolve) => server.close(resolve));
      await start(createRateLimiter({ limit: 2, windowMs: 60_000 }));
      const attempt = (ip: string) =>
        post('/auth/login', { email: 'a@b.co', password: 'whatever-1' }, { 'Fly-Client-IP': ip });

      expect((await attempt('1.1.1.1')).status).toBe(401);
      expect((await attempt('1.1.1.1')).status).toBe(401);
      const blocked = await attempt('1.1.1.1');
      expect(blocked.status).toBe(429);
      await expect(blocked.json()).resolves.toMatchObject({ error: 'TOO_MANY_REQUESTS' });
      expect((await attempt('2.2.2.2')).status).toBe(401);
    });

    test('기본 한도는 분당 10회다', async () => {
      await new Promise((resolve) => server.close(resolve));
      await start();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        statuses.push(
          (await post('/auth/login', { email: 'a@b.co', password: 'whatever-1' })).status
        );
      }
      expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  });

  describe('GET /auth/providers', () => {
    test('OAuth 설정이 없으면 이메일만 준다', async () => {
      const response = await fetch(`${baseUrl}/auth/providers`);
      await expect(response.json()).resolves.toEqual({ providers: ['email'] });
    });

    test('클라이언트 id와 비밀 값이 모두 있는 제공자만 더한다', async () => {
      process.env.GOOGLE_CLIENT_ID = 'id';
      process.env.GOOGLE_CLIENT_SECRET = 'value';
      process.env.KAKAO_CLIENT_ID = 'id';
      const response = await fetch(`${baseUrl}/auth/providers`);
      await expect(response.json()).resolves.toEqual({ providers: ['email', 'google'] });
    });
  });

  describe('/auth/me 안내 완료', () => {
    async function signedUpToken(): Promise<string> {
      return ((await (await signup()).json()) as { token: string }).token;
    }

    function me(token: string) {
      return fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    }

    test('가입 직후 /auth/me는 이메일과 onboarded=false를 준다', async () => {
      const token = await signedUpToken();
      await expect((await me(token)).json()).resolves.toEqual({
        display_name: '독자',
        providers: ['email'],
        email: 'reader@example.com',
        onboarded: false,
        consent_required: false,
        marketing: false,
      });
    });

    test('POST /auth/me/onboarded는 204이고 여러 번 불러도 같다', async () => {
      const token = await signedUpToken();
      const headers = { Authorization: `Bearer ${token}` };
      expect((await post('/auth/me/onboarded', {}, headers)).status).toBe(204);
      expect((await post('/auth/me/onboarded', {}, headers)).status).toBe(204);
      await expect((await me(token)).json()).resolves.toMatchObject({ onboarded: true });
    });

    test('토큰 없이 안내 완료를 표시하면 401이다', async () => {
      const response = await post('/auth/me/onboarded', {}, { 'X-Device-Id': DEVICE_ID });
      expect(response.status).toBe(401);
    });
  });
});
