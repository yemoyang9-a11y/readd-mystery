import { API_BASE_URL, USE_MOCK } from '../utils/constants';
import { ensureDeviceId } from './api';

const MAX_BATCH = 50;
const FLUSH_AT = 10;
const FLUSH_INTERVAL_MS = 5000;
const MAX_LABEL_LENGTH = 40;
const ADMIN_PREFIX = '/admin';
const TRACKED = '[data-track]';

export interface TrackedEvent {
  type: 'page_view' | 'click' | 'session_end';
  path: string;
  at: number;
  target?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  duration_ms?: number;
}

export function isAdminPath(path: string): boolean {
  return path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`);
}

// FR-ADM-005
export function clickLabel(start: EventTarget | null): string | null {
  if (!(start instanceof Element)) return null;
  const el = start.closest(TRACKED);
  if (!el || el.closest('[data-no-track]')) return null;
  const label = el.getAttribute('data-track')?.trim();
  return label && label.length <= MAX_LABEL_LENGTH ? label : null;
}

export interface CollectorDeps {
  deviceId: () => string;
  send: (body: string) => void;
  beacon: (body: string) => boolean;
  now?: () => number;
  referrer?: () => string;
  search?: () => string;
  origin?: () => string;
}

// FR-ADM-005
export function createCollector(deps: CollectorDeps) {
  const now = deps.now ?? Date.now;
  let queue: TrackedEvent[] = [];
  let firstViewSent = false;
  let visibleSince = now();
  let ended = false;

  function body(events: TrackedEvent[]): string {
    return JSON.stringify({ device_id: deps.deviceId(), events });
  }

  function flush(useBeacon = false): void {
    if (queue.length === 0) return;
    const batches: TrackedEvent[][] = [];
    for (let i = 0; i < queue.length; i += MAX_BATCH) batches.push(queue.slice(i, i + MAX_BATCH));
    queue = [];
    for (const batch of batches) {
      try {
        const payload = body(batch);
        if (!(useBeacon && deps.beacon(payload))) deps.send(payload);
      } catch {}
    }
  }

  function push(event: TrackedEvent): void {
    if (isAdminPath(event.path)) return;
    queue.push(event);
    if (queue.length >= FLUSH_AT) flush();
  }

  return {
    pageView(path: string): void {
      const event: TrackedEvent = { type: 'page_view', path, at: now() };
      if (!firstViewSent) {
        firstViewSent = true;
        const origin = deps.origin?.() ?? '';
        const referrer = deps.referrer?.() ?? '';
        if (referrer && !(origin && referrer.startsWith(origin)))
          event.referrer = referrer.slice(0, 300);
        const params = new URLSearchParams(deps.search?.() ?? '');
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign'] as const) {
          const value = params.get(key);
          if (value) event[key] = value.slice(0, 100);
        }
      }
      push(event);
    },
    click(path: string, target: string): void {
      push({ type: 'click', path, at: now(), target });
    },
    sessionEnd(path: string): void {
      if (ended) return;
      ended = true;
      const at = now();
      push({ type: 'session_end', path, at, duration_ms: Math.max(0, at - visibleSince) });
      flush(true);
    },
    resume(): void {
      ended = false;
      visibleSince = now();
    },
    flush,
    pending: () => queue.length,
  };
}

interface RouterLike {
  state: { location: { pathname: string } };
  subscribe: (fn: (state: { location: { pathname: string } }) => void) => () => void;
}

// FR-ADM-005
export function initAnalytics(router: RouterLike): () => void {
  if (USE_MOCK || typeof window === 'undefined') return () => undefined;

  const endpoint = `${API_BASE_URL}/analytics/events`;
  const collector = createCollector({
    deviceId: ensureDeviceId,
    send: (payload) => {
      fetch(endpoint, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': ensureDeviceId() },
        body: payload,
      }).catch(() => undefined);
    },
    beacon: (payload) =>
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(endpoint, new Blob([payload], { type: 'text/plain' })),
    referrer: () => document.referrer,
    search: () => window.location.search,
    origin: () => window.location.origin,
  });

  let lastPath: string | null = null;
  const onLocation = (pathname: string) => {
    if (pathname === lastPath) return;
    lastPath = pathname;
    collector.pageView(pathname);
  };
  onLocation(router.state.location.pathname);
  const unsubscribe = router.subscribe((state) => onLocation(state.location.pathname));

  const onClick = (event: MouseEvent) => {
    const label = clickLabel(event.target);
    if (label) collector.click(window.location.pathname, label);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') collector.sessionEnd(window.location.pathname);
    else collector.resume();
  };
  const onPageHide = () => collector.sessionEnd(window.location.pathname);

  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  const timer = window.setInterval(() => collector.flush(), FLUSH_INTERVAL_MS);

  return () => {
    unsubscribe();
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.clearInterval(timer);
  };
}
