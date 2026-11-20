import { useCallback, useEffect, useState } from 'react';
import type { ModerationItem } from './adminApi';
import { useAdmin } from './AdminLayout';

const EXCERPT_LENGTH = 80;
const TYPE_LABEL: Record<ModerationItem['target_type'], string> = { post: '댓글', comment: '답글' };

function excerpt(body: string | null): string {
  if (!body) return '';
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH)}…` : flat;
}

function status(item: ModerationItem): { label: string; style: string } {
  if (item.deleted) return { label: '삭제됨', style: 'bg-line text-muted' };
  if (item.hidden) return { label: '숨김', style: 'bg-ssabi-soft text-ssabi' };
  return { label: '표시', style: 'bg-brief-accent-soft text-brief-accent' };
}

function targetPath(item: ModerationItem): string {
  return `/community/${item.target_type}s/${item.target_id}`;
}

/**
 * 커뮤니티 신고 관리 — 대표 결정 2026-11-17 ("관리자 화면 + 신고 3건 자동 숨김").
 * 서로 다른 독자 3명이 신고하면 서버가 자동으로 숨기고, 여기서 복구하거나 삭제한다.
 * 복구는 숨김을 풀고 "검토함"으로 남긴다 — 그 뒤 새 신고자 3명이 모이면 다시 숨겨진다.
 * FR-ADM-006 🚦 — 호출은 모두 AdminLayout의 관리자 토큰으로 나간다.
 */
export default function CommunityReportsPage() {
  const { call } = useAdmin();
  const [items, setItems] = useState<ModerationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await call<{ items: ModerationItem[] }>('/community/moderation');
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '신고 목록을 불러오지 못했습니다');
    }
  }, [call]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(item: ModerationItem, action: 'restore' | 'delete') {
    const kind = TYPE_LABEL[item.target_type];
    const question =
      action === 'restore'
        ? `이 ${kind}을 복구할까요? 독자에게 다시 보입니다.`
        : `이 ${kind}을 삭제할까요? 되돌릴 수 없습니다.`;
    if (!window.confirm(question)) return;
    setBusy(item.target_id);
    try {
      if (action === 'restore') {
        await call(`${targetPath(item)}/restore`, { method: 'POST' });
      } else {
        await call(targetPath(item), { method: 'DELETE' });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리하지 못했습니다');
    } finally {
      setBusy(null);
    }
    await refresh();
  }

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-[24px] font-extrabold">커뮤니티 신고</h1>
      <section className="rounded-card border border-line bg-surface p-card">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-[16px] font-extrabold">신고된 글·댓글</h2>
          <span className="text-[12px] text-muted">
            서로 다른 독자 3명이 신고하면 자동으로 숨겨집니다
          </span>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-ssabi">
            {error}
          </p>
        )}
        {items === null ? (
          <p className="mt-4 text-[13px] text-muted">불러오는 중</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted">신고된 글이 없습니다</p>
        ) : (
          <table className="mt-4 w-full text-left text-[13px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">도서</th>
                <th className="py-2 font-normal">종류</th>
                <th className="py-2 font-normal">내용</th>
                <th className="py-2 font-normal">신고</th>
                <th className="py-2 font-normal">사유</th>
                <th className="py-2 font-normal">상태</th>
                <th className="py-2 font-normal">최근 신고</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const s = status(item);
                return (
                  <tr
                    key={`${item.target_type}:${item.target_id}`}
                    className="border-b border-line-subtle align-top"
                  >
                    <td className="py-3 pr-3 font-bold">{item.book_title ?? item.book_id}</td>
                    <td className="py-3 pr-3">{TYPE_LABEL[item.target_type]}</td>
                    <td className="max-w-[280px] break-words py-3 pr-3">{excerpt(item.body)}</td>
                    <td className="whitespace-nowrap py-3 pr-3">
                      {item.report_count}명
                      {item.reviewed_at && (
                        <span className="block text-[12px] text-muted">
                          검토 후 {item.reports_since_review}명
                        </span>
                      )}
                    </td>
                    <td className="max-w-[200px] break-words py-3 pr-3 text-muted">
                      {item.reasons.join(' · ')}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3">
                      <span className={`rounded-pill px-2.5 py-1 text-[12px] ${s.style}`}>
                        {s.label}
                      </span>
                      {item.reviewed_at && (
                        <span className="ml-1.5 text-[12px] text-muted">검토함</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-muted">
                      {new Date(item.last_reported_at).toLocaleString('ko-KR')}
                    </td>
                    <td className="whitespace-nowrap py-3 text-right">
                      {item.hidden && !item.deleted && (
                        <button
                          type="button"
                          disabled={busy === item.target_id}
                          onClick={() => void act(item, 'restore')}
                          className="rounded-pill border border-line-subtle bg-surface px-4 py-1.5 text-faint disabled:opacity-40"
                        >
                          복구
                        </button>
                      )}
                      {!item.deleted && (
                        <button
                          type="button"
                          disabled={busy === item.target_id}
                          onClick={() => void act(item, 'delete')}
                          className="ml-2 rounded-pill border border-line-subtle bg-surface px-4 py-1.5 text-ssabi disabled:opacity-40"
                        >
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
