import type { AnalyticsAggregates, EventStore } from './event-store';

export { SESSION_GAP_MINUTES } from './event-store';
export const MAX_RANGE_DAYS = 90;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AnalyticsSummary {
  daily: { date: string; visitors: number; sessions: number }[];
  referrers: { source: string; sessions: number }[];
  top_paths: { path: string; views: number }[];
  top_clicks: { target: string; count: number }[];
  avg_session_ms: number;
}

export interface ReportService {
  summarize(fromDate: string, toDate: string): Promise<AnalyticsSummary>;
}

// FR-ADM-005
export function shapeSummary(rows: AnalyticsAggregates): AnalyticsSummary {
  const sessionsByDate = new Map<string, number>();
  const sessionsBySource = new Map<string, number>();
  let sessionCount = 0;
  let totalMs = 0;
  for (const row of rows.sessions) {
    sessionsByDate.set(row.date, (sessionsByDate.get(row.date) ?? 0) + row.sessions);
    sessionsBySource.set(row.source, (sessionsBySource.get(row.source) ?? 0) + row.sessions);
    sessionCount += row.sessions;
    totalMs += row.duration_ms;
  }
  const visitorsByDate = new Map(rows.visitors.map((v) => [v.date, v.visitors]));
  const dates = [...new Set([...visitorsByDate.keys(), ...sessionsByDate.keys()])].sort();

  return {
    daily: dates.map((date) => ({
      date,
      visitors: visitorsByDate.get(date) ?? 0,
      sessions: sessionsByDate.get(date) ?? 0,
    })),
    referrers: [...sessionsBySource.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([source, sessions]) => ({ source, sessions })),
    top_paths: rows.top_paths,
    top_clicks: rows.top_clicks,
    avg_session_ms: sessionCount === 0 ? 0 : Math.round(totalMs / sessionCount),
  };
}

const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`) - KST_OFFSET_MS;

export function rangeDays(fromDate: string, toDate: string): number {
  return Math.round((dayStart(toDate) - dayStart(fromDate)) / DAY_MS) + 1;
}

export function dateRangeMs(fromDate: string, toDate: string): { from: number; to: number } {
  return { from: dayStart(fromDate), to: dayStart(toDate) + DAY_MS };
}

export function createReportService(store: EventStore): ReportService {
  return {
    async summarize(fromDate, toDate) {
      const { from, to } = dateRangeMs(fromDate, toDate);
      return shapeSummary(await store.aggregate(from, to));
    },
  };
}
