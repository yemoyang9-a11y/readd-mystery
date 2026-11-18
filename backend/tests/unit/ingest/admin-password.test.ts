/**
 * 관리자 비밀번호 로그인 — 2026-11-18 대표 지시 ("비밀번호 하나 정해서 비번 치면 들어가게")
 *
 * FR-ADM-006 🚦: 관리자 API는 인증 없이 0건. 비밀번호가 맞을 때만 세션 토큰을 주고,
 * 그 토큰 또는 기존 ADMIN_API_TOKEN 만 관리자 API를 연다.
 */
import express from 'express';
import type { AddressInfo } from 'net';
import {
  adminAuth,
  adminLoginRouter,
  signAdminSession,
} from '../../../src/modules/ingest/admin-auth';

const SECRET = 'x'.repeat(40);
const PASSWORD = 'mystery-2026';
const API_TOKEN = 'a'.repeat(40);

async function serve(env: { password?: string; apiToken?: string; limit?: number }) {
  const app = express();
  app.use(
    '/admin',
    adminLoginRouter({
      getPassword: () => env.password,
      getSecret: () => SECRET,
      attemptsPerMinute: env.limit ?? 5,
    })
  );
  app.use(
    '/admin',
    adminAuth(
      () => env.apiToken,
      () => env.password,
      () => SECRET
    ),
    (_req, res) => {
      res.json({ ok: true });
    }
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

const login = (base: string, password: string) =>
  fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
const jobs = (base: string, token?: string) =>
  fetch(`${base}/jobs`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe('FR-ADM-006 🚦 관리자 비밀번호 로그인', () => {
  test('틀린 비밀번호 → 401, 토큰 0건 / 맞는 비밀번호 → 토큰, 그 토큰으로 관리자 API 열림', async () => {
    const s = await serve({ password: PASSWORD });
    try {
      const wrong = await login(s.base, 'nope-nope');
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).not.toHaveProperty('token');

      const ok = await login(s.base, PASSWORD);
      expect(ok.status).toBe(200);
      const { token } = (await ok.json()) as { token: string };
      expect((await jobs(s.base, token)).status).toBe(200);
    } finally {
      await s.close();
    }
  });

  test('인증 없음·위조 토큰·다른 비밀번호로 만든 토큰 → 관리자 API 401 (0건)', async () => {
    const s = await serve({ password: PASSWORD });
    try {
      expect((await jobs(s.base)).status).toBe(401);
      expect((await jobs(s.base, 'forged.token.value')).status).toBe(401);
      const otherPassword = await signAdminSession('another-password', SECRET);
      expect((await jobs(s.base, otherPassword)).status).toBe(401);
    } finally {
      await s.close();
    }
  });

  test('만료된 세션 토큰 → 401', async () => {
    const s = await serve({ password: PASSWORD });
    try {
      const expired = await signAdminSession(
        PASSWORD,
        SECRET,
        new Date(Date.now() - 13 * 60 * 60 * 1000)
      );
      expect((await jobs(s.base, expired)).status).toBe(401);
    } finally {
      await s.close();
    }
  });

  test('비밀번호를 바꾸면 이전 비밀번호로 받은 토큰은 401 — 바꾸는 즉시 기존 접속을 끊는다', async () => {
    const env = { password: PASSWORD } as { password?: string };
    const s = await serve(env);
    try {
      const { token } = (await (await login(s.base, PASSWORD)).json()) as { token: string };
      env.password = 'changed-password-1';
      expect((await jobs(s.base, token)).status).toBe(401);
    } finally {
      await s.close();
    }
  });

  test('시도 제한: 1분에 limit 번을 넘기면 맞는 비밀번호도 429', async () => {
    const s = await serve({ password: PASSWORD, limit: 2 });
    try {
      expect((await login(s.base, 'x1-wrong')).status).toBe(401);
      expect((await login(s.base, 'x2-wrong')).status).toBe(401);
      expect((await login(s.base, PASSWORD)).status).toBe(429);
    } finally {
      await s.close();
    }
  });

  test('비밀번호가 설정되지 않았거나 8자 미만이면 로그인 503, 관리자 API는 열리지 않는다', async () => {
    for (const password of [undefined, 'short']) {
      const s = await serve({ password });
      try {
        expect((await login(s.base, password ?? '')).status).toBe(503);
        expect((await jobs(s.base)).status).not.toBe(200);
      } finally {
        await s.close();
      }
    }
  });

  test('positive — 기존 ADMIN_API_TOKEN(스크립트용)은 그대로 쓸 수 있다', async () => {
    const s = await serve({ password: PASSWORD, apiToken: API_TOKEN });
    try {
      expect((await jobs(s.base, API_TOKEN)).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});
