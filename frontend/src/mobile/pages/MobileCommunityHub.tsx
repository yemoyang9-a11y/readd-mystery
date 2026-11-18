import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCommunityHub } from '../../services/communityService';
import type { CommunityHubBook } from '../../types';
import { resolveCoverUrl } from '../../utils/coverOverrides';
import { BOOK_ROUTES, briefingPath } from '../../utils/routes';
import { withBase } from '../../utils/assetUrl';

type Status = 'loading' | 'ready' | 'error';

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

function HubCard({ book }: { book: CommunityHubBook }) {
  const coverUrl = resolveCoverUrl(book.book_id, book.cover_url);
  const open = book.access === 'open';
  return (
    <Link
      to={open ? BOOK_ROUTES.community.replace(':bookId', book.book_id) : briefingPath(book.book_id)}
      state={open ? undefined : { fromHome: true }}
      data-track={open ? 'hub-community-open' : 'hub-community-locked'}
      data-testid={`hub-book-${book.book_id}`}
      aria-label={open ? `${book.title} 이야기방, 글 ${book.post_count}개` : `${book.title}, 끝까지 읽으면 열려요`}
      className="flex items-center gap-3.5 rounded-dash-card border border-dash-line bg-dash-card p-3 pr-4 transition-colors active:bg-dash-ink/10"
    >
      {/* 표지가 없으면 지어내지 않고 제목을 명조로 조판한다 (DESIGN.md) — 홈 이어 읽기 카드와 같은 방식 */}
      <span className={`h-[62px] w-11 shrink-0 overflow-hidden rounded-[6px] ${open ? '' : 'opacity-55'}`}>
        {coverUrl ? (
          <img src={withBase(coverUrl)} alt="" className="size-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-full items-center justify-center rounded-[6px] border border-dash-line bg-brief-card px-1 text-center font-dashSerif text-[10px] font-bold leading-tight text-brief-ink [overflow-wrap:anywhere]"
          >
            {book.title}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-dashSerif text-[17px] font-bold leading-snug text-dash-ink">{book.title}</b>
        <span className="mt-0.5 block truncate text-[13px] text-dash-muted">{book.author}</span>
      </span>
      {open ? (
        <span className="flex shrink-0 items-center gap-1 text-[14px] font-bold text-[#e58a9b]">
          글 {book.post_count}
          <span aria-hidden="true" className="text-[18px] font-semibold">
            ›
          </span>
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-dash-muted">
          <LockIcon />
          완독 후
        </span>
      )}
    </Link>
  );
}

/**
 * 커뮤니티 허브 (2026-11-18 대표 지시 "커뮤니티도 형성해줘")
 *
 * 열림·잠김은 서버가 도서마다 기준점 결정기로 정해 access 로 준다. 잠긴 도서는 서버가 글 수를
 * 보내지 않으므로 이 화면에도 글 수·제목·글 내용이 없다 (대표 결정 2026-11-17 ④, FR-BRF-005 🚦).
 * 조회에 실패하면 목록을 그리지 않는다 (FR-SPL-005 🚦 실패 = 미노출).
 */
// COMMUNITY
export default function MobileCommunityHub() {
  const [status, setStatus] = useState<Status>('loading');
  const [books, setBooks] = useState<CommunityHubBook[]>([]);

  const load = useCallback(() => {
    let active = true;
    setStatus('loading');
    fetchCommunityHub()
      .then((response) => {
        if (!active) return;
        setBooks(response.books);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(load, [load]);

  const opened = books.filter((book) => book.access === 'open');
  const locked = books.filter((book) => book.access === 'locked');

  return (
    <div data-testid="community-hub" className="mx-auto w-full max-w-[560px] px-4 py-5 font-dashSans text-dash-ink">
      <h1 className="m-0 font-dashSerif text-[24px] font-bold">커뮤니티</h1>

      {status === 'loading' ? (
        <p role="status" className="m-0 py-16 text-center text-[14px] text-dash-muted">
          불러오는 중
        </p>
      ) : null}

      {status === 'error' ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p role="alert" className="m-0 text-[14px] text-dash-muted">
            커뮤니티를 불러오지 못했어요
          </p>
          <button
            type="button"
            onClick={load}
            className="min-h-11 rounded-full border border-dash-line px-6 text-[15px] font-bold text-dash-ink"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {status === 'ready' && books.length === 0 ? (
        <p className="m-0 py-16 text-center text-[14px] text-dash-muted">공개된 책이 아직 없어요</p>
      ) : null}

      {status === 'ready' && opened.length > 0 ? (
        <section aria-labelledby="hub-open" className="mt-5">
          <h2 id="hub-open" className="m-0 mb-2.5 text-[14px] font-bold text-dash-ink">
            완독한 책
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {opened.map((book) => (
              <li key={book.book_id}>
                <HubCard book={book} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {status === 'ready' && locked.length > 0 ? (
        <section aria-labelledby="hub-locked" className="mt-7">
          <h2 id="hub-locked" className="m-0 mb-2.5 text-[14px] font-bold text-dash-ink">
            끝까지 읽으면 열려요
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {locked.map((book) => (
              <li key={book.book_id}>
                <HubCard book={book} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
