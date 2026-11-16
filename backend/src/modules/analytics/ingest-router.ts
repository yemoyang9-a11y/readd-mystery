import express, { Router } from 'express';
import { UUID_PATTERN } from '../auth/reader-id.middleware';
import type { AnalyticsEvent, AnalyticsEventType, EventStore } from './event-store';

const MAX_EVENTS = 50;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const TYPES: AnalyticsEventType[] = ['page_view', 'click', 'session_end'];
const TEXT_LIMITS = {
  target: 80,
  referrer: 300,
  utm_source: 100,
  utm_medium: 100,
  utm_campaign: 100,
} as const;
const ALLOWED_KEYS = new Set(['type', 'path', 'at', 'duration_ms', ...Object.keys(TEXT_LIMITS)]);

function parseEvent(raw: any, now: number): AnalyticsEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.keys(raw).some((k) => !ALLOWED_KEYS.has(k))) return null;
  if (!TYPES.includes(raw.type)) return null;
  if (typeof raw.path !== 'string' || !raw.path.startsWith('/') || raw.path.length > 200)
    return null;
  if (!Number.isSafeInteger(raw.at) || raw.at <= 0 || raw.at > now + MAX_FUTURE_MS) return null;

  const event: AnalyticsEvent = {
    type: raw.type,
    path: raw.path.split(/[?#]/)[0],
    at: raw.at,
  };
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > limit) return null;
    (event as any)[key] = value;
  }
  if (raw.duration_ms !== undefined) {
    if (
      !Number.isSafeInteger(raw.duration_ms) ||
      raw.duration_ms < 0 ||
      raw.duration_ms > MAX_DURATION_MS
    )
      return null;
    event.duration_ms = raw.duration_ms;
  }
  return event;
}

// FR-ADM-005
export function createAnalyticsIngestRouter(deps: {
  store: Pick<EventStore, 'insertEvents'>;
  now?: () => number;
}): Router {
  const now = deps.now ?? Date.now;
  const router = Router();

  router.post(
    '/analytics/events',
    express.json({ limit: '100kb', type: ['application/json', 'text/plain'] }),
    async (req, res, next) => {
      try {
        const body = req.body ?? {};
        const header = req.headers['x-device-id'];
        const deviceId = typeof header === 'string' ? header : body.device_id;
        if (typeof deviceId !== 'string' || !UUID_PATTERN.test(deviceId)) {
          return res.status(400).json({ error: 'BAD_REQUEST', message: 'device id is required' });
        }
        if (
          !Array.isArray(body.events) ||
          body.events.length < 1 ||
          body.events.length > MAX_EVENTS
        ) {
          return res
            .status(400)
            .json({ error: 'BAD_REQUEST', message: `events must have 1-${MAX_EVENTS} items` });
        }
        const at = now();
        const events = body.events.map((raw: unknown) => parseEvent(raw, at));
        if (events.some((e: AnalyticsEvent | null) => e === null)) {
          return res.status(400).json({ error: 'BAD_REQUEST', message: 'invalid event' });
        }
        await deps.store.insertEvents(deviceId, events);
        return res.status(204).end();
      } catch (err) {
        return next(err);
      }
    }
  );

  return router;
}
