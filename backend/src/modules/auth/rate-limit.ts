import type { Request, RequestHandler } from 'express';

// 2026-11-18 대표 지시 — 로그인·회원가입 시도를 IP마다 제한한다. 서버 한 대 기준의 메모리 창이다.
export interface RateLimiter {
  /** 이번 시도가 허용되면 true */
  hit(key: string): boolean;
}

export function createRateLimiter({
  limit,
  windowMs,
  now = () => Date.now(),
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return {
    hit(key) {
      const at = now();
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (at - w.startedAt >= windowMs) windows.delete(k);
      }
      const current = windows.get(key);
      if (!current || at - current.startedAt >= windowMs) {
        windows.set(key, { startedAt: at, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    },
  };
}

/** Fly.io 프록시 뒤에서는 req.ip가 프록시 주소라 Fly-Client-IP를 먼저 본다 */
export function clientIp(req: Request): string {
  const fly = req.headers['fly-client-ip'];
  if (typeof fly === 'string' && fly.length > 0) return fly;
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function rateLimit(limiter: RateLimiter, scope: string): RequestHandler {
  return (req, res, next) => {
    if (limiter.hit(`${scope}:${clientIp(req)}`)) {
      next();
      return;
    }
    res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many attempts' });
  };
}
