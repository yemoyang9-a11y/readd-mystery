import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useBackToBook } from '../../hooks/useBackToBook';
import { useCatalog } from '../../hooks/useCatalog';
import {
  classifyCommunityError,
  createCommunityComment,
  createCommunityPost,
  fetchCommunityPosts,
  type CommunityFailure,
} from '../../services/communityService';
import type { CommunityPost, CommunitySort } from '../../types';
import { BOOK_ROUTES } from '../../utils/routes';
import CommentComposer from '../community/CommentComposer';
import CommentThread, { type ReplyTarget } from '../community/CommentThread';
import { useVisualViewport } from '../useVisualViewport';

type Status = 'loading' | 'ready' | 'locked' | 'error';

const SORTS: { value: CommunitySort; label: string }[] = [
  { value: 'new', label: '최신순' },
  { value: 'popular', label: '인기순' },
];

function BackIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 4.8 6.5 8 9.5 11.2" />
    </svg>
  );
}

// COMMUNITY
export default function MobileCommunity() {
  const { bookId = '' } = useParams();
  return <CommunityScreen key={bookId} bookId={bookId} />;
}

/**
 * 책 이야기방 본체 — T19(2026-11-20 대표 승인 시안 3): 인스타그램 배치의 댓글·답글, RE:ADD 밤 화면.
 * 휴대폰은 화면 전체, PC 는 위 줄 메뉴 아래 가운데 단(desktop)에 그린다.
 * 열림·잠김은 서버가 정한다 — 잠긴 독자는 댓글·댓글 수 없이 잠김 안내만 본다 (FR-BRF-005 🚦, FR-SPL-005 🚦).
 */
export function CommunityScreen({
  bookId,
  desktop = false,
}: {
  bookId: string;
  desktop?: boolean;
}) {
  const navigate = useNavigate();
  const backToBook = useBackToBook(bookId);
  const { books } = useCatalog();
  const { displayName } = useAuth();
  const viewport = useVisualViewport();
  // NFR-USE
  const keyboardInset = viewport.keyboardOpen
    ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    : 0;
  const title = books.find((book) => book.book_id === bookId)?.title ?? '';
  const [status, setStatus] = useState<Status>('loading');
  const [sort, setSort] = useState<CommunitySort>('new');
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});
  const [composerError, setComposerError] = useState<string | null>(null);
  const [dockHeight, setDockHeight] = useState<number | null>(null);
  const requestRef = useRef(0);
  const dockRef = useRef<HTMLDivElement | null>(null);

  const handleFailure = useCallback((failure: CommunityFailure) => {
    if (failure === 'locked') setStatus('locked');
  }, []);

  const loadFirstPage = useCallback(() => {
    const request = (requestRef.current += 1);
    setStatus('loading');
    setReplyTarget(null);
    setComposerError(null);
    fetchCommunityPosts(bookId, null, sort)
      .then((page) => {
        if (request !== requestRef.current) return;
        setPosts(page.posts);
        setNextCursor(page.next_cursor);
        setTotalCount(page.total_count ?? null);
        setStatus('ready');
      })
      .catch((cause) => {
        if (request !== requestRef.current) return;
        setStatus(classifyCommunityError(cause) === 'locked' ? 'locked' : 'error');
      });
  }, [bookId, sort]);

  useEffect(loadFirstPage, [loadFirstPage]);

  const ready = status === 'ready';

  useEffect(() => {
    const dock = dockRef.current;
    if (!ready || desktop || !dock || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() =>
      setDockHeight(Math.ceil(dock.getBoundingClientRect().height))
    );
    observer.observe(dock);
    return () => observer.disconnect();
  }, [ready, desktop]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const request = requestRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchCommunityPosts(bookId, nextCursor, sort);
      if (request !== requestRef.current) return;
      setPosts((prev) => {
        const seen = new Set(prev.map((item) => item.post_id));
        return [...prev, ...page.posts.filter((item) => !seen.has(item.post_id))];
      });
      setNextCursor(page.next_cursor);
    } catch (cause) {
      handleFailure(classifyCommunityError(cause));
    } finally {
      setLoadingMore(false);
    }
  }

  function refreshThread(postId: string) {
    setRefreshKeys((prev) => ({ ...prev, [postId]: (prev[postId] ?? 0) + 1 }));
  }

  async function submit(body: string): Promise<boolean> {
    const target = replyTarget;
    setComposerError(null);
    try {
      if (!target) {
        const created = await createCommunityPost(bookId, body);
        setPosts((prev) => [created, ...prev]);
        setTotalCount((prev) => (prev === null ? null : prev + 1));
        return true;
      }
      await createCommunityComment(bookId, target.postId, body, target.commentId ?? undefined);
      setReplyTarget(null);
      refreshThread(target.postId);
      return true;
    } catch (cause) {
      const failure = classifyCommunityError(cause);
      if (failure === 'locked') {
        handleFailure(failure);
      } else if (failure === 'not_found' && target) {
        setReplyTarget(null);
        refreshThread(target.postId);
        setComposerError('답글을 달 댓글이 지워졌어요.');
      } else if (failure === 'rate_limited') {
        setComposerError(
          target
            ? '답글은 1시간에 30개까지 남길 수 있어요.'
            : '댓글은 1시간에 10개까지 남길 수 있어요. 잠시 후 다시 시도해 주세요.'
        );
      } else {
        setComposerError('올리지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      return false;
    }
  }

  return (
    <div
      data-testid={desktop ? 'book-community' : 'mobile-community'}
      className={`bg-[#0d0a0b] bg-[radial-gradient(120%_420px_at_50%_-120px,#2a1418_0%,transparent_70%)] bg-no-repeat font-dashSans text-[#ece6e0] ${
        desktop ? 'mx-auto min-h-full max-w-[640px] pb-10' : 'min-h-[100dvh]'
      }`}
      style={
        desktop
          ? undefined
          : {
              paddingTop: 'var(--safe-top)',
              paddingBottom: !ready
                ? undefined
                : dockHeight !== null
                  ? `${dockHeight + 16}px`
                  : 'calc(84px + max(12px, var(--safe-bottom)))',
            }
      }
    >
      <header className="grid grid-cols-[44px_1fr_44px] items-center px-3.5 pt-3.5">
        <button
          type="button"
          onClick={backToBook}
          aria-label="돌아가기"
          className="flex size-10 items-center justify-center rounded-full border border-[#35292c] bg-[#1e1618] text-[#ece6e0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4475f]"
        >
          <BackIcon />
        </button>
        <div className="grid text-center leading-tight">
          <span className="text-[12px] font-bold tracking-[0.04em] text-[#e58a9b]">
            다 읽은 독자 이야기
          </span>
          <h1 className="m-0 font-dashSerif text-[19px] font-black">{title}</h1>
        </div>
        <span />
      </header>

      {status === 'locked' ? (
        <div
          role="alert"
          className="mx-4 mt-10 flex flex-col items-center gap-5 rounded-[16px] border border-[#35292c] bg-[#1e1618] px-6 py-10 text-center"
        >
          <p className="m-0 break-keep text-[16px] font-bold">끝까지 읽으면 열려요</p>
          <button
            type="button"
            data-track="community-locked-continue"
            onClick={() =>
              navigate(BOOK_ROUTES.reader.replace(':bookId', bookId), { replace: true })
            }
            className="min-h-11 rounded-full bg-[#8f1d35] px-7 text-[15px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
          >
            이어 읽기
          </button>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <p role="alert" className="m-0 text-[15px] text-[#ece6e0]">
            이야기를 불러오지 못했어요
          </p>
          <button
            type="button"
            onClick={loadFirstPage}
            className="min-h-11 rounded-full bg-[#8f1d35] px-6 text-[15px] font-bold text-white"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {status === 'loading' || ready ? (
        <>
          <div className="flex items-end justify-between px-4 pb-3 pt-[18px]">
            <p className="m-0 font-dashSerif text-[30px] font-black leading-none">
              {ready ? (totalCount ?? posts.length) : ''}
              <span className="ml-1.5 font-dashSans text-[15px] font-bold text-[#b5aaa6]">
                개의 댓글
              </span>
            </p>
            <div
              role="group"
              aria-label="댓글 순서"
              className="inline-flex rounded-full border border-[#35292c] bg-[#160f11] p-[3px]"
            >
              {SORTS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={sort === item.value}
                  data-track={`community-sort-${item.value}`}
                  onClick={() => setSort(item.value)}
                  className={`min-h-8 rounded-full px-[13px] text-[14px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] motion-reduce:transition-none ${
                    sort === item.value ? 'bg-[#8f1d35] text-white' : 'text-[#b5aaa6]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mx-4 h-px bg-[linear-gradient(90deg,#c4475f,#35292c_40%,#35292c)]" />
          {ready ? (
            <div className="px-4 pt-3">
              {/* 대표 결정 2026-11-24 — 내 추리 채점·결과지 공유로. 관문은 채점 화면이 서버에 다시 묻는다 */}
              <button
                type="button"
                data-track="community-review"
                onClick={() => navigate(BOOK_ROUTES.review.replace(':bookId', bookId))}
                className="flex min-h-11 w-full items-center justify-between rounded-[12px] border border-[#35292c] bg-[#1e1618] px-4 text-[15px] font-bold text-[#ece6e0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
              >
                <span>내 추리 채점하고 결과지 공유하기</span>
                <span aria-hidden="true" className="text-[17px] text-[#e58a9b]">›</span>
              </button>
            </div>
          ) : null}

          {status === 'loading' ? (
            <p role="status" className="m-0 px-5 py-12 text-center text-[14px] text-[#b5aaa6]">
              불러오는 중
            </p>
          ) : null}

          {ready && posts.length === 0 ? (
            <div
              data-testid="community-empty"
              className="grid place-content-center gap-2 px-7 py-20 text-center"
            >
              <span
                aria-hidden="true"
                className="font-dashSerif text-[44px] leading-none text-[#c4475f]"
              >
                “
              </span>
              <p className="m-0 font-dashSerif text-[22px] font-black leading-[1.4]">
                아직 아무도
                <br />
                이야기를 꺼내지 않았어요
              </p>
              <p className="m-0 text-[15px] text-[#b5aaa6]">다 읽은 소감을 처음으로 남겨 주세요.</p>
            </div>
          ) : null}

          {ready ? (
            <ul className="m-0 p-0 pt-1">
              {posts.map((item) => (
                <CommentThread
                  key={item.post_id}
                  bookId={bookId}
                  post={item}
                  refreshKey={refreshKeys[item.post_id] ?? 0}
                  highlightCommentId={
                    replyTarget?.postId === item.post_id
                      ? (replyTarget.commentId ?? item.post_id)
                      : null
                  }
                  onReply={setReplyTarget}
                  onChanged={loadFirstPage}
                  onFailure={handleFailure}
                />
              ))}
            </ul>
          ) : null}

          {ready && nextCursor ? (
            <div className="px-4 pt-4">
              <button
                type="button"
                data-track="community-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="min-h-11 w-full rounded-full border border-[#35292c] bg-[#1e1618] text-[14px] font-bold text-[#ece6e0] disabled:opacity-40"
              >
                {loadingMore ? '불러오는 중' : '더 보기'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {ready ? (
        <div
          ref={dockRef}
          data-testid="comment-composer-dock"
          className={desktop ? 'sticky bottom-0 z-10 mt-4' : 'fixed inset-x-0 z-10'}
          style={
            desktop
              ? undefined
              : {
                  bottom: `${keyboardInset}px`,
                  paddingBottom: keyboardInset > 0 ? undefined : 'var(--safe-bottom)',
                }
          }
        >
          <CommentComposer
            replyTarget={replyTarget}
            myName={displayName}
            error={composerError}
            onCancelReply={() => setReplyTarget(null)}
            onSubmit={submit}
          />
        </div>
      ) : null}
    </div>
  );
}
