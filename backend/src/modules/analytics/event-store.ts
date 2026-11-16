export type AnalyticsEventType = 'page_view' | 'click' | 'session_end';

export interface AnalyticsEvent {
  type: AnalyticsEventType;
  path: string;
  at: number;
  target?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  duration_ms?: number;
}

export interface AnalyticsAggregates {
  visitors: { date: string; visitors: number }[];
  sessions: { date: string; source: string; sessions: number; duration_ms: number }[];
  top_paths: { path: string; views: number }[];
  top_clicks: { target: string; count: number }[];
}

export interface EventStore {
  insertEvents(deviceId: string, events: AnalyticsEvent[]): Promise<void>;
  aggregate(fromMs: number, toMs: number): Promise<AnalyticsAggregates>;
}

export const SESSION_GAP_MINUTES = 30;
export const TOP_LIMIT = 10;
const DAY = "to_char(%s AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')";
const RANGE = 'at >= $1 AND at < $2';

// FR-ADM-005
export const VISITORS_SQL = `
  SELECT ${DAY.replace('%s', 'at')} AS date, count(DISTINCT device_id)::int AS visitors
    FROM analytics_event WHERE ${RANGE} GROUP BY 1 ORDER BY 1`;

// FR-ADM-005
export const SESSIONS_SQL = `
  WITH marked AS (
    SELECT device_id, at,
           COALESCE(NULLIF(btrim(utm_source), ''),
                    lower(substring(referrer FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#]+)'))) AS src,
           CASE WHEN lag(at) OVER w IS NULL OR at - lag(at) OVER w > interval '${SESSION_GAP_MINUTES} minutes'
                THEN 1 ELSE 0 END AS starts
      FROM analytics_event WHERE ${RANGE}
    WINDOW w AS (PARTITION BY device_id ORDER BY at)
  ), numbered AS (
    SELECT *, sum(starts) OVER (PARTITION BY device_id ORDER BY at ROWS UNBOUNDED PRECEDING) AS session_no
      FROM marked
  ), sessions AS (
    SELECT min(at) AS start_at, max(at) AS end_at,
           (array_agg(src ORDER BY at) FILTER (WHERE src IS NOT NULL))[1] AS src
      FROM numbered GROUP BY device_id, session_no
  )
  SELECT ${DAY.replace('%s', 'start_at')} AS date, COALESCE(src, 'direct') AS source,
         count(*)::int AS sessions,
         COALESCE(sum(extract(epoch FROM end_at - start_at) * 1000), 0)::float8 AS duration_ms
    FROM sessions GROUP BY 1, 2 ORDER BY 1, 2`;

export const PATHS_SQL = `
  SELECT path, count(*)::int AS views FROM analytics_event
   WHERE ${RANGE} AND type = 'page_view' GROUP BY path ORDER BY views DESC, path LIMIT ${TOP_LIMIT}`;

export const CLICKS_SQL = `
  SELECT target, count(*)::int AS count FROM analytics_event
   WHERE ${RANGE} AND type = 'click' AND target IS NOT NULL GROUP BY target ORDER BY count DESC, target LIMIT ${TOP_LIMIT}`;

interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const COLUMNS = [
  'device_id',
  'type',
  'path',
  'target',
  'referrer',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'duration_ms',
  'at',
] as const;

export function createPgEventStore(db: QueryClient): EventStore {
  return {
    async insertEvents(deviceId, events) {
      const params: unknown[] = [];
      const rows = events.map((e) => {
        params.push(
          deviceId,
          e.type,
          e.path,
          e.target ?? null,
          e.referrer ?? null,
          e.utm_source ?? null,
          e.utm_medium ?? null,
          e.utm_campaign ?? null,
          e.duration_ms ?? null,
          new Date(e.at).toISOString()
        );
        const base = params.length - COLUMNS.length;
        return `(${COLUMNS.map((_, i) => `$${base + i + 1}`).join(', ')})`;
      });
      await db.query(
        `INSERT INTO analytics_event (${COLUMNS.join(', ')}) VALUES ${rows.join(', ')}`,
        params
      );
    },

    async aggregate(fromMs, toMs) {
      const params = [new Date(fromMs).toISOString(), new Date(toMs).toISOString()];
      const [visitors, sessions, paths, clicks] = await Promise.all(
        [VISITORS_SQL, SESSIONS_SQL, PATHS_SQL, CLICKS_SQL].map((sql) => db.query(sql, params))
      );
      return {
        visitors: visitors.rows,
        sessions: sessions.rows,
        top_paths: paths.rows,
        top_clicks: clicks.rows,
      };
    },
  };
}
