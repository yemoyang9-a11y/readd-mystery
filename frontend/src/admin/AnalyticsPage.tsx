import { useEffect, useState } from 'react';
import type { AnalyticsSummary } from './adminApi';
import { useAdmin } from './AdminLayout';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDate(daysAgo: number): string {
  return new Date(Date.now() + KST_OFFSET_MS - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-card">
      <h2 className="font-serif text-[16px] font-extrabold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function BarList({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-[13px] text-muted">아직 기록이 없습니다</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} className="text-[13px]">
          <div className="flex justify-between gap-4">
            <span className="truncate">{row.label}</span>
            <span className="font-bold tabular-nums">{row.value}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-pill bg-line">
            <div
              className="h-1.5 rounded-pill bg-brief-accent"
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DailyChart({ daily }: { daily: AnalyticsSummary['daily'] }) {
  if (daily.length === 0) return <p className="text-[13px] text-muted">아직 기록이 없습니다</p>;
  const max = Math.max(1, ...daily.map((d) => d.visitors));
  return (
    <div>
      <div className="flex h-40 items-end gap-2" role="img" aria-label="일별 방문자 수">
        {daily.map((d) => (
          <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end">
            <span className="mb-1 text-[12px] font-bold tabular-nums">{d.visitors}</span>
            <div
              className="w-full max-w-[40px] rounded-sm bg-brief-accent"
              style={{ height: `${Math.max(4, (d.visitors / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 border-t border-line pt-2">
        {daily.map((d) => (
          <div key={d.date} className="flex-1 text-center text-[11px] text-muted">
            <div>{d.date.slice(5)}</div>
            <div className="tabular-nums">세션 {d.sessions}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// FR-ADM-005
export default function AnalyticsPage() {
  const { call } = useAdmin();
  const [from, setFrom] = useState(() => kstDate(13));
  const [to, setTo] = useState(() => kstDate(0));
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    call<AnalyticsSummary>(`/analytics/summary?from=${from}&to=${to}`)
      .then((data) => alive && setSummary(data))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [call, from, to]);

  const dateInput = 'rounded-lg border border-line bg-surface px-3 py-2 text-[13px]';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-[24px] font-extrabold">이용 현황</h1>
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <label>
            <span className="sr-only">시작일</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className={dateInput}
            />
          </label>
          <span aria-hidden="true">~</span>
          <label>
            <span className="sr-only">종료일</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className={dateInput}
            />
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-ssabi">
          {error}
        </p>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-card border border-line-subtle bg-surface p-card">
              <p className="text-[13px] text-muted">평균 머문 시간</p>
              <p className="mt-1 font-serif text-[26px] font-extrabold text-ink">
                {formatDuration(summary.avg_session_ms)}
              </p>
            </div>
            <div className="rounded-card border border-line-subtle bg-surface p-card">
              <p className="text-[13px] text-muted">세션 수</p>
              <p className="mt-1 font-serif text-[26px] font-extrabold text-ink">
                {summary.daily.reduce((n, d) => n + d.sessions, 0)}
              </p>
            </div>
            <div className="rounded-card border border-line-subtle bg-surface p-card">
              <p className="text-[13px] text-muted">기록된 날</p>
              <p className="mt-1 font-serif text-[26px] font-extrabold text-ink">
                {summary.daily.length}
              </p>
            </div>
          </div>

          <Panel title="일별 방문자">
            <DailyChart daily={summary.daily} />
          </Panel>

          <div className="grid grid-cols-3 gap-6">
            <Panel title="유입 경로 (세션)">
              <BarList
                rows={summary.referrers.map((r) => ({ label: r.source, value: r.sessions }))}
              />
            </Panel>
            <Panel title="많이 본 화면">
              <BarList rows={summary.top_paths.map((r) => ({ label: r.path, value: r.views }))} />
            </Panel>
            <Panel title="많이 누른 요소">
              <BarList
                rows={summary.top_clicks.map((r) => ({ label: r.target, value: r.count }))}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
