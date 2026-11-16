import { createHash, timingSafeEqual } from 'crypto';
import type { RequestHandler } from 'express';

const MIN_TOKEN_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

// FR-ADM-006 🚦
export function adminAuth(
  getToken: () => string | undefined = () => process.env.ADMIN_API_TOKEN
): RequestHandler {
  return (req, res, next) => {
    const expected = getToken();
    if (!expected || expected.length < MIN_TOKEN_LENGTH) {
      res.status(503).json({ error: 'ADMIN_DISABLED', message: 'Admin API is not configured' });
      return;
    }
    const provided = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!provided || !timingSafeEqual(digest(provided), digest(expected))) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid admin token' });
      return;
    }
    next();
  };
}
