import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createPgEventStore } from '../event-store';
import { createReportService, shapeSummary } from '../report-service';

describe('analytics summary shaping', () => {
  const summary = shapeSummary({
    visitors: [
      { date: '2026-11-16', visitors: 2 },
      { date: '2026-11-17', visitors: 1 },
    ],
    sessions: [
      { date: '2026-11-16', source: 'news.example.com', sessions: 1, duration_ms: 240_000 },
      { date: '2026-11-16', source: 'direct', sessions: 1, duration_ms: 0 },
      { date: '2026-11-16', source: 'newsletter', sessions: 1, duration_ms: 600_000 },
      { date: '2026-11-17', source: 'direct', sessions: 1, duration_ms: 120_000 },
    ],
    top_paths: [{ path: '/', views: 2 }],
    top_clicks: [{ target: '이어 읽기', count: 2 }],
  });

  test('FR-ADM-005: 일별 방문자와 세션 수', () => {
    expect(summary.daily).toEqual([
      { date: '2026-11-16', visitors: 2, sessions: 3 },
      { date: '2026-11-17', visitors: 1, sessions: 1 },
    ]);
  });

  test('FR-ADM-005: 유입 경로별 세션 수는 날짜를 합쳐 내림차순', () => {
    expect(summary.referrers).toEqual([
      { source: 'direct', sessions: 2 },
      { source: 'news.example.com', sessions: 1 },
      { source: 'newsletter', sessions: 1 },
    ]);
  });

  test('FR-ADM-005: 평균 머문 시간은 세션 지속 시간의 평균', () => {
    expect(summary.avg_session_ms).toBe(240_000);
    expect(summary.top_paths).toEqual([{ path: '/', views: 2 }]);
    expect(summary.top_clicks).toEqual([{ target: '이어 읽기', count: 2 }]);
  });

  test('FR-ADM-005: 기록이 없으면 빈 집계와 평균 0', () => {
    expect(shapeSummary({ visitors: [], sessions: [], top_paths: [], top_clicks: [] })).toEqual({
      daily: [],
      referrers: [],
      top_paths: [],
      top_clicks: [],
      avg_session_ms: 0,
    });
  });
});

const TEST_DB = process.env.ANALYTICS_TEST_DATABASE_URL;
const sqlDescribe = TEST_DB ? describe : describe.skip;

sqlDescribe('analytics SQL aggregation (ANALYTICS_TEST_DATABASE_URL)', () => {
  const MIN = 60_000;
  const KST_MIDNIGHT = Date.UTC(2031, 0, 1, 0, 0, 0) - 9 * 60 * MIN;
  let pool: Pool;
  const [A, B, C] = [randomUUID(), randomUUID(), randomUUID()];

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB });
    await pool.query('DELETE FROM analytics_event WHERE at >= $1', [
      new Date(KST_MIDNIGHT).toISOString(),
    ]);
    const D1 = KST_MIDNIGHT + 600 * MIN;
    const D2 = D1 + 24 * 60 * MIN;
    const rows: [string, string, string, string | null, string | null, string | null, number][] = [
      [A, 'page_view', '/', null, 'https://news.example.com/post/1', null, D1],
      [A, 'click', '/', '이어 읽기', null, null, D1 + MIN],
      [A, 'session_end', '/', null, null, null, D1 + 4 * MIN],
      [A, 'page_view', '/books/bk-1', null, null, null, D1 + 35 * MIN],
      [B, 'page_view', '/', null, 'https://mail.example.com/', 'newsletter', D1 + 2 * MIN],
      [B, 'click', '/', '이어 읽기', null, null, D1 + 12 * MIN],
      [C, 'page_view', '/search', null, null, null, D2],
      [C, 'click', '/search', '검색', null, null, D2 + 2 * MIN],
    ];
    for (const [device, type, path, target, referrer, utm, at] of rows) {
      await pool.query(
        `INSERT INTO analytics_event (device_id, type, path, target, referrer, utm_source, at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [device, type, path, target, referrer, utm, new Date(at).toISOString()]
      );
    }
  });

  afterAll(async () => {
    await pool.query('DELETE FROM analytics_event WHERE at >= $1', [
      new Date(KST_MIDNIGHT).toISOString(),
    ]);
    await pool.end();
  });

  test('FR-ADM-005: 30분 넘게 끊기면 새 세션, 유입은 UTM 우선·없으면 direct, 평균은 첫~끝 간격', async () => {
    const summary = await createReportService(createPgEventStore(pool)).summarize(
      '2031-01-01',
      '2031-01-02'
    );
    expect(summary.daily).toEqual([
      { date: '2031-01-01', visitors: 2, sessions: 3 },
      { date: '2031-01-02', visitors: 1, sessions: 1 },
    ]);
    expect(summary.referrers).toEqual([
      { source: 'direct', sessions: 2 },
      { source: 'news.example.com', sessions: 1 },
      { source: 'newsletter', sessions: 1 },
    ]);
    expect(summary.top_paths[0]).toEqual({ path: '/', views: 2 });
    expect(summary.top_clicks[0]).toEqual({ target: '이어 읽기', count: 2 });
    expect(summary.avg_session_ms).toBe(4 * MIN);
  });
});
