import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { AdminApiError, type Decision, type MissingItem, type ReviewView } from './adminApi';
import { useAdmin } from './AdminLayout';

const TYPE_LABEL: Record<string, string> = {
  chapter_summary: '장 요약',
  chapter_key_point: '장 핵심 한 줄',
  character: '인물',
  alias: '별칭',
  character_note: '인물 노트',
  relationship: '관계',
  term: '용어',
  event: '사건',
  background: '배경지식',
  intro: '책 소개',
};
const ALL_TYPES = Object.keys(TYPE_LABEL);

const CHECK_LABEL: Record<string, string> = {
  confirmed: '확인됨',
  needs_review: '확인 필요',
  held: '보류',
};
const CHECK_STYLE: Record<string, string> = {
  confirmed: 'bg-brief-accent-soft text-brief-accent',
  needs_review: 'bg-ssabi-soft text-ssabi',
  held: 'bg-line text-muted',
};

const GHOST =
  'rounded-pill border border-line-subtle bg-surface px-3 py-1 text-[12px] text-faint disabled:opacity-40';

function Section({
  title,
  type,
  pending,
  busy,
  onApproveAll,
  children,
}: {
  title: string;
  type?: string;
  pending?: number;
  busy: boolean;
  onApproveAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-card" aria-label={title}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-serif text-[16px] font-extrabold">
          {title}
          {type !== undefined && pending !== undefined && (
            <span
              className={`ml-3 text-[12px] font-normal ${pending > 0 ? 'text-ssabi' : 'text-brief-accent'}`}
            >
              {pending > 0 ? `검수 대기 ${pending}건` : '검수 완료'}
            </span>
          )}
        </h2>
        {onApproveAll && (
          <button type="button" disabled={busy} onClick={onApproveAll} className={GHOST}>
            {title} 전체 승인
          </button>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ItemActions({
  busy,
  rejectable = true,
  onDecide,
}: {
  busy: boolean;
  rejectable?: boolean;
  onDecide: (verdict: Decision['verdict']) => void;
}) {
  return (
    <div className="flex shrink-0 gap-2">
      <button type="button" disabled={busy} onClick={() => onDecide('approve')} className={GHOST}>
        승인
      </button>
      {rejectable && (
        <button type="button" disabled={busy} onClick={() => onDecide('reject')} className={GHOST}>
          거절
        </button>
      )}
    </div>
  );
}

function PendingDot({ pending }: { pending: boolean }) {
  return (
    <span className={`text-[12px] ${pending ? 'text-ssabi' : 'text-brief-accent'}`}>
      {pending ? '대기' : '완료'}
    </span>
  );
}

// FR-ADM-005 🚦
export default function ReviewPage() {
  const { call } = useAdmin();
  const { bookId = '' } = useParams();
  const [view, setView] = useState<ReviewView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await call<ReviewView>(`/books/${bookId}/review`));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '검수 정보를 불러오지 못했습니다');
    }
  }, [call, bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(decisions: Decision[]) {
    setBusy(true);
    setNotice(null);
    try {
      await call(`/books/${bookId}/review`, { method: 'POST', json: { decisions } });
      setMissing(null);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '반영하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  async function approveFinal() {
    setBusy(true);
    setNotice(null);
    setMissing(null);
    try {
      await call(`/books/${bookId}/approve`, { method: 'POST' });
      setNotice('승인했습니다. 이 책이 공개되었습니다.');
      await load();
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'REVIEW_INCOMPLETE') {
        setMissing(Array.isArray(err.body.missing) ? err.body.missing.filter(
          (item): item is MissingItem => item !== null && typeof item === 'object' &&
            typeof item.target_type === 'string' && typeof item.target_id === 'string' &&
            Array.isArray(item.missing_criteria) && item.missing_criteria.every((value: unknown) => typeof value === 'string')
        ) : []);
        setNotice('검수가 끝나지 않아 승인하지 못했습니다.');
      } else {
        setNotice(err instanceof Error ? err.message : '승인하지 못했습니다');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="text-[13px] text-ssabi">
        {loadError}
      </p>
    );
  }
  if (!view) return <p className="text-[13px] text-muted">불러오는 중</p>;

  const pendingKeys = new Set(view.review.missing.map((m) => `${m.target_type}::${m.target_id}`));
  const isPending = (type: string, id: string) => pendingKeys.has(`${type}::${id}`);
  const pendingCount = (type: string) =>
    view.review.missing.filter((m) => m.target_type === type).length;
  const approveAll = (...types: string[]) =>
    void decide(
      types.map((t) => ({ target_type: t, target_id: '*', verdict: 'approve' as const }))
    );
  const one = (type: string, id: string, verdict: Decision['verdict']) =>
    void decide([{ target_type: type, target_id: id, verdict }]);

  const reviewable = view.job.status === 'review_ready';
  const aliasCount = view.characters.reduce((n, c) => n + c.aliases.length, 0);
  // 결정 31 — 배치가 만든 핵심 한 줄이 있는 장만 검수한다 (거절하면 장 요약 첫 문장으로 돌아간다)
  const keyPoints = view.chapter_summaries.filter((s) => s.key_point);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/books" className="text-[13px] text-muted">
          ← 도서 관리
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-[24px] font-extrabold">{view.book.title} 검수</h1>
            <p className="mt-1 text-[13px] text-muted">
              {view.book.author} · 총 {view.book.total_pages}쪽 · 작업 상태 {view.job.status} · 공개
              상태 {view.book.publish_status}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !reviewable}
              onClick={() => approveAll(...ALL_TYPES)}
              className={GHOST}
            >
              모든 항목 승인
            </button>
            <button
              type="button"
              disabled={busy || !reviewable}
              onClick={() => void approveFinal()}
              className="rounded-lg bg-ink px-5 py-2.5 text-[13px] font-bold text-white transition-opacity disabled:opacity-40"
            >
              최종 승인
            </button>
          </div>
        </div>
      </div>

      {(notice || missing) && (
        <div role="alert" className="rounded-card border border-line bg-surface p-card text-[13px]">
          {notice && <p className="font-bold text-ssabi">{notice}</p>}
          {missing && (
            <>
              <p className="mt-2 text-muted">아직 승인하지 않은 항목 {missing.length}건</p>
              <ul className="mt-2 space-y-1" aria-label="미검수 항목">
                {missing.map((m) => (
                  <li key={`${m.target_type}::${m.target_id}`}>
                    {TYPE_LABEL[m.target_type] ?? m.target_type} · {m.target_id}
                    <span className="text-muted"> ({m.missing_criteria.join(', ')})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <Section title="본문 미리보기" busy={busy}>
        <ul className="space-y-2 text-[13px]">
          {view.pages_preview.map((p) => (
            <li key={p.page_no} className="flex gap-3">
              <span className="w-12 shrink-0 text-muted tabular-nums">{p.page_no}쪽</span>
              <span className="font-serif">{p.excerpt}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="인물"
        type="character"
        pending={pendingCount('character')}
        busy={busy || !reviewable}
        onApproveAll={() => approveAll('character')}
      >
        <ul className="divide-y divide-line-subtle text-[13px]">
          {view.characters.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p>
                  <span className="font-bold">{c.name}</span>{' '}
                  <span className="text-muted">첫 등장 {c.first_appearance_page}쪽</span>{' '}
                  <PendingDot pending={isPending('character', c.id)} />
                </p>
                {c.aliases.length > 0 && (
                  <p className="mt-1 text-muted">
                    별칭: {c.aliases.map((a) => a.alias).join(', ')}
                  </p>
                )}
                {c.notes.map((n) => (
                  <p key={n.id} className="mt-1 text-muted">
                    {n.note} ({n.source_page}쪽)
                  </p>
                ))}
              </div>
              <ItemActions busy={busy || !reviewable} onDecide={(v) => one('character', c.id, v)} />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || !reviewable}
            onClick={() => approveAll('alias')}
            className={GHOST}
          >
            별칭 {aliasCount}개 전체 승인
          </button>
          <button
            type="button"
            disabled={busy || !reviewable}
            onClick={() => approveAll('character_note')}
            className={GHOST}
          >
            인물 노트 전체 승인
          </button>
        </div>
      </Section>

      <Section
        title="관계"
        type="relationship"
        pending={pendingCount('relationship')}
        busy={busy || !reviewable}
        onApproveAll={() => approveAll('relationship')}
      >
        <ul className="divide-y divide-line-subtle text-[13px]">
          {view.relationships.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">
                    {r.from} → {r.to}
                  </span>
                  <span>{r.label}</span>
                  <span className="text-muted">확립 {r.established_page}쪽</span>
                  <span
                    className={`rounded-pill px-2.5 py-0.5 text-[12px] ${CHECK_STYLE[r.check] ?? 'bg-line text-muted'}`}
                  >
                    {CHECK_LABEL[r.check] ?? r.check}
                  </span>
                  <PendingDot pending={isPending('relationship', r.id)} />
                </p>
                {r.quote && (
                  <blockquote className="mt-1.5 border-l-2 border-line pl-3 font-serif text-muted">
                    “{r.quote}”{r.quote_page !== null && <span> — {r.quote_page}쪽</span>}
                  </blockquote>
                )}
                {r.reasons.length > 0 && (
                  <p className="mt-1.5 text-[12px] text-ssabi">사유: {r.reasons.join(', ')}</p>
                )}
              </div>
              <ItemActions
                busy={busy || !reviewable}
                onDecide={(v) => one('relationship', r.id, v)}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="장 요약"
        type="chapter_summary"
        pending={pendingCount('chapter_summary')}
        busy={busy || !reviewable}
        onApproveAll={() => approveAll('chapter_summary')}
      >
        <ul className="space-y-3 text-[13px]">
          {view.chapter_summaries.map((s) => (
            <li key={s.chapter_no} className="flex items-start justify-between gap-4">
              <p>
                <span className="font-bold">{s.chapter_no}장</span> {s.summary}{' '}
                <PendingDot pending={isPending('chapter_summary', String(s.chapter_no))} />
              </p>
              <ItemActions
                busy={busy || !reviewable}
                rejectable={false}
                onDecide={(v) => one('chapter_summary', String(s.chapter_no), v)}
              />
            </li>
          ))}
        </ul>
      </Section>

      {keyPoints.length > 0 && (
        <Section
          title="장 핵심 한 줄"
          type="chapter_key_point"
          pending={pendingCount('chapter_key_point')}
          busy={busy || !reviewable}
          onApproveAll={() => approveAll('chapter_key_point')}
        >
          <ul className="space-y-3 text-[13px]">
            {keyPoints.map((s) => (
              <li key={s.chapter_no} className="flex items-start justify-between gap-4">
                <p>
                  <span className="font-bold">{s.chapter_no}장</span> {s.key_point}{' '}
                  <PendingDot pending={isPending('chapter_key_point', String(s.chapter_no))} />
                </p>
                <ItemActions
                  busy={busy || !reviewable}
                  onDecide={(v) => one('chapter_key_point', String(s.chapter_no), v)}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="용어"
        type="term"
        pending={pendingCount('term')}
        busy={busy || !reviewable}
        onApproveAll={() => approveAll('term')}
      >
        <ul className="space-y-3 text-[13px]">
          {view.terms.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-4">
              <p>
                <span className="font-bold">{t.term}</span> {t.definition}{' '}
                <span className="text-muted">({t.first_appearance_page}쪽)</span>{' '}
                <PendingDot pending={isPending('term', t.id)} />
              </p>
              <ItemActions busy={busy || !reviewable} onDecide={(v) => one('term', t.id, v)} />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="사건"
        type="event"
        pending={pendingCount('event')}
        busy={busy || !reviewable}
        onApproveAll={() => approveAll('event')}
      >
        <ul className="space-y-3 text-[13px]">
          {view.events.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-4">
              <p>
                <span className="font-bold">{e.event}</span> {e.description}{' '}
                <span className="text-muted">({e.occurrence_page}쪽)</span>{' '}
                <PendingDot pending={isPending('event', e.id)} />
              </p>
              <ItemActions busy={busy || !reviewable} onDecide={(v) => one('event', e.id, v)} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="배경지식·책 소개" busy={busy || !reviewable}>
        <ul className="space-y-3 text-[13px]">
          {view.background_and_intro.map((b) => (
            <li key={b.kind} className="flex items-start justify-between gap-4">
              <p>
                <span className="font-bold">{TYPE_LABEL[b.kind] ?? b.kind}</span> {b.content}{' '}
                <PendingDot pending={isPending(b.kind, b.kind)} />
              </p>
              <ItemActions
                busy={busy || !reviewable}
                rejectable={false}
                onDecide={(v) => one(b.kind, b.kind, v)}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="보류 항목" busy={busy}>
        <p className="text-[13px]">
          보류 {view.held.length}건 · 보류 후보{' '}
          {view.held_candidates.reduce((n, c) => n + c.count, 0)}건
        </p>
        {view.held.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[13px]" aria-label="보류 항목 목록">
            {view.held.map((h, i) => (
              <li key={`${h.target_type}-${h.label}-${i}`}>
                <span className="text-muted">{TYPE_LABEL[h.target_type] ?? h.target_type}</span>{' '}
                {h.label}
                <span className="text-ssabi"> ({h.reasons.join(', ')})</span>
              </li>
            ))}
          </ul>
        )}
        {view.held_candidates.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[13px]" aria-label="보류 후보 목록">
            {view.held_candidates.map((c) => (
              <li key={`${c.kind}::${c.reason}`}>
                {c.kind} · {c.reason} <span className="font-bold tabular-nums">{c.count}건</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {view.integrity !== null && (
        <details className="rounded-card border border-line bg-surface p-card text-[13px]">
          <summary className="cursor-pointer font-bold">정합성 검사 결과</summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[12px] text-muted">
            {JSON.stringify(view.integrity, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
