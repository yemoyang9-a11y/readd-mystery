import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { createAnalyticsIngestRouter } from '../ingest-router';
import type { AnalyticsEvent, EventStore } from '../event-store';

const DEVICE = '11111111-1111-4111-8111-111111111111';
const NOW = Date.UTC(2026, 10, 16, 3, 0, 0);

class FakeStore implements EventStore {
  saved: { deviceId: string; events: AnalyticsEvent[] }[] = [];
  async insertEvents(deviceId: string, events: AnalyticsEvent[]) {
    this.saved.push({ deviceId, events });
  }
  async aggregate() {
    return { visitors: [], sessions: [], top_paths: [], top_clicks: [] };
  }
}

function pageView(overrides: Record<string, unknown> = {}) {
  return { type: 'page_view', path: '/books/bk-1', at: NOW, ...overrides };
}

describe('analytics ingest router', () => {
  let server: Server;
  let baseUrl: string;
  let store: FakeStore;

  beforeEach(async () => {
    store = new FakeStore();
    const app = express();
    app.use(createAnalyticsIngestRouter({ store, now: () => NOW }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function post(body: unknown, headers: Record<string, string> = { 'X-Device-Id': DEVICE }) {
    return fetch(`${baseUrl}/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  test('FR-ADM-005: 이벤트 50개는 204, 51개는 400이고 저장 0건', async () => {
    const fifty = await post({ events: Array.from({ length: 50 }, () => pageView()) });
    expect(fifty.status).toBe(204);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].events).toHaveLength(50);

    store.saved.length = 0;
    const fiftyOne = await post({ events: Array.from({ length: 51 }, () => pageView()) });
    expect(fiftyOne.status).toBe(400);
    expect(store.saved).toHaveLength(0);
  });

  test('FR-ADM-005: 기기 ID 헤더 없음·형식 오류 → 400, 저장 0건', async () => {
    const missing = await post({ events: [pageView()] }, {});
    const malformed = await post({ events: [pageView()] }, { 'X-Device-Id': 'not-a-uuid' });
    expect([missing.status, malformed.status]).toEqual([400, 400]);
    expect(store.saved).toHaveLength(0);
  });

  test('FR-ADM-005: 헤더를 못 쓰는 sendBeacon 요청은 본문 device_id로 식별한다', async () => {
    const res = await post({ device_id: DEVICE, events: [pageView()] }, {});
    expect(res.status).toBe(204);
    expect(store.saved[0].deviceId).toBe(DEVICE);
  });

  test('FR-ADM-005: sendBeacon의 text/plain JSON 본문도 받는다', async () => {
    const res = await fetch(`${baseUrl}/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ device_id: DEVICE, events: [pageView()] }),
    });
    expect(res.status).toBe(204);
  });

  test('FR-ADM-005: 개인정보가 될 수 있는 알 수 없는 필드는 400', async () => {
    const res = await post({ events: [pageView({ email: 'a@b.c' })] });
    expect(res.status).toBe(400);
    expect(store.saved).toHaveLength(0);
  });

  test.each([
    ['알 수 없는 type', pageView({ type: 'scroll' })],
    ['path 누락', { type: 'page_view', at: NOW }],
    ['path가 /로 시작하지 않음', pageView({ path: 'books' })],
    ['at이 숫자가 아님', pageView({ at: 'yesterday' })],
    ['duration_ms 음수', { type: 'session_end', path: '/', at: NOW, duration_ms: -1 }],
    ['target 길이 초과', { type: 'click', path: '/', at: NOW, target: 'x'.repeat(81) }],
    ['at이 미래', pageView({ at: NOW + 3_600_000 })],
  ])('FR-ADM-005: %s → 400', async (_name, event) => {
    const res = await post({ events: [event] });
    expect(res.status).toBe(400);
    expect(store.saved).toHaveLength(0);
  });

  test('FR-ADM-005: events가 비었거나 배열이 아니면 400', async () => {
    expect((await post({ events: [] })).status).toBe(400);
    expect((await post({ events: 'x' })).status).toBe(400);
  });

  test('FR-ADM-005: 경로의 쿼리 문자열은 저장하지 않는다', async () => {
    await post({ events: [pageView({ path: '/books/bk-1?token=abc#x' })] });
    expect(store.saved[0].events[0].path).toBe('/books/bk-1');
  });

  test('FR-ADM-005: 정상 이벤트는 모든 필드를 그대로 저장한다', async () => {
    const event = {
      type: 'page_view',
      path: '/',
      referrer: 'https://news.example.com/a',
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'nov',
      at: NOW,
    };
    await post({ events: [event] });
    expect(store.saved[0].events[0]).toMatchObject(event);
  });
});
