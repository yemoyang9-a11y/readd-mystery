import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { createAdminRouter } from '../../ingest/admin-router';
import { MemoryJobRepository } from '../../ingest/__tests__/fakes';
import type { ReviewService } from '../../ingest/review-service';
import { createReportService } from '../report-service';
import type { EventStore } from '../event-store';

const TOKEN = 'a'.repeat(40);

describe('admin analytics summary', () => {
  let server: Server;
  let baseUrl: string;
  let ranges: { from: number; to: number }[];

  beforeEach(async () => {
    ranges = [];
    const store: EventStore = {
      async insertEvents() {},
      async aggregate(from, to) {
        ranges.push({ from, to });
        return {
          visitors: [{ date: '2026-11-16', visitors: 1 }],
          sessions: [{ date: '2026-11-16', source: 'x.example.com', sessions: 1, duration_ms: 0 }],
          top_paths: [],
          top_clicks: [],
        };
      },
    };
    const app = express();
    app.use(
      '/admin',
      createAdminRouter({
        jobs: new MemoryJobRepository(),
        runner: { startJob: jest.fn(), retryJob: jest.fn() },
        review: {} as ReviewService,
        uploadDir: '/tmp',
        analytics: createReportService(store),
        getToken: () => TOKEN,
      })
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const get = (q: string, auth = true) =>
    fetch(`${baseUrl}/admin/analytics/summary${q}`, {
      headers: auth ? { Authorization: `Bearer ${TOKEN}` } : {},
    });

  test('FR-ADM-006: 관리자 토큰 없이 이용 현황 조회 → 401, 저장소 조회 0회', async () => {
    const res = await get('?from=2026-11-01&to=2026-11-16', false);
    expect(res.status).toBe(401);
    expect(ranges).toHaveLength(0);
  });

  test('FR-ADM-005: from~to(KST 날짜, to 포함)로 요약을 돌려준다', async () => {
    const res = await get('?from=2026-11-01&to=2026-11-16');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ['avg_session_ms', 'daily', 'referrers', 'top_clicks', 'top_paths'].sort()
    );
    expect(body.referrers).toEqual([{ source: 'x.example.com', sessions: 1 }]);
    expect(ranges[0].from).toBe(Date.UTC(2026, 9, 31, 15, 0, 0));
    expect(ranges[0].to).toBe(Date.UTC(2026, 10, 16, 15, 0, 0));
  });

  test('FR-ADM-005: 범위는 90일까지, 91일이면 400이고 저장소 조회 0회', async () => {
    expect((await get('?from=2026-08-18&to=2026-11-15')).status).toBe(200);
    ranges.length = 0;
    const res = await get('?from=2026-08-17&to=2026-11-15');
    expect(res.status).toBe(400);
    expect(ranges).toHaveLength(0);
  });

  test('FR-ADM-005: 날짜 형식 오류나 from > to 는 400', async () => {
    expect((await get('?from=nov&to=2026-11-16')).status).toBe(400);
    expect((await get('?from=2026-11-16&to=2026-11-01')).status).toBe(400);
  });
});
