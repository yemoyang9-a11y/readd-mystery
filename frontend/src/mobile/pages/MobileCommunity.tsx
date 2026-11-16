import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBackToBook } from '../../hooks/useBackToBook';
import {
  classifyCommunityError,
  fetchCommunityPosts,
  type CommunityFailure,
} from '../../services/communityService';
import type { CommunityKind, CommunityPost } from '../../types';
import { BOOK_ROUTES } from '../../utils/routes';
import CommunityCompose from '../community/CommunityCompose';
import CommunityPostView, { KindTag } from '../community/CommunityPostView';
import { KIND_LABEL, relativeTime } from '../community/communityFormat';

type Status = 'loading' | 'ready' | 'locked' | 'error';
type Filter = CommunityKind | null;

const FILTERS: { value: Filter; label: string }[] = [
  { value: null, label: '전체' },
  { value: 'theory', label: KIND_LABEL.theory },
  { value: 'review', label: KIND_LABEL.review },
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

function CommunityScreen({ bookId }: { bookId: string }) {
  const navigate = useNavigate();
  const backToBook = useBackToBook(bookId);
  const [status, setStatus] = useState<Status>('loading');
  const [filter, setFilter] = useState<Filter>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const writeButtonRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef(0);

  const handleFailure = useCallback((failure: CommunityFailure) => {
    if (failure === 'locked') setStatus('locked');
  }, []);

  const loadFirstPage = useCallback(() => {
    const request = (requestRef.current += 1);
    setStatus('loading');
    fetchCommunityPosts(bookId, filter, null)
      .then((page) => {
        if (request !== requestRef.current) return;
        setPosts(page.posts);
        setNextCursor(page.next_cursor);
        setStatus('ready');
      })
      .catch((cause) => {
        if (request !== requestRef.current) return;
        setStatus(classifyCommunityError(cause) === 'locked' ? 'locked' : 'error');
      });
  }, [bookId, filter]);

  useEffect(loadFirstPage, [loadFirstPage]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchCommunityPosts(bookId, filter, nextCursor);
      setPosts((prev) => [...prev, ...page.posts]);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      handleFailure(classifyCommunityError(cause));
    } finally {
      setLoadingMore(false);
    }
  }

  const detailOpen = openPostId !== null && status === 'ready';

  function goBack() {
    if (detailOpen) {
      setOpenPostId(null);
      loadFirstPage();
      return;
    }
    backToBook();
  }

  return (
    <div
      data-testid="mobile-community"
      className="min-h-[100dvh] bg-[#0d0a0b] font-dashSans text-[#ece6e0]"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'calc(84px + max(12px, var(--safe-bottom)))',
      }}
    >
      <header className="flex items-center gap-3 px-4 pb-3 pt-2">
        <button
          type="button"
          onClick={goBack}
          aria-label={detailOpen ? '목록으로' : '돌아가기'}
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#35292c] bg-[#1e1618] text-[#ece6e0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4475f]"
        >
          <BackIcon />
        </button>
        <div className="min-w-0">
          <h1 className="m-0 font-dashSerif text-[20px] font-bold">완독자 이야기</h1>
          <p className="m-0 mt-0.5 text-[12px] text-[#a89e9a]">결말 스포일러가 포함돼 있어요</p>
        </div>
      </header>

      {status === 'locked' ? (
        <div
          role="alert"
          className="mx-4 mt-10 flex flex-col items-center gap-5 rounded-[16px] border border-[#35292c] bg-[#1e1618] px-6 py-10 text-center"
        >
          <p className="m-0 break-keep text-[16px] font-bold">끝까지 읽은 독자만 들어올 수 있어요</p>
          <button
            type="button"
            data-track="community-locked-continue"
            onClick={() => navigate(BOOK_ROUTES.reader.replace(':bookId', bookId), { replace: true })}
            className="min-h-11 rounded-full bg-[#8f1d35] px-7 text-[15px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
          >
            이어서 읽기
          </button>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <p role="alert" className="m-0 text-[14px] text-[#a89e9a]">
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

      {detailOpen && openPostId ? (
        <CommunityPostView
          bookId={bookId}
          postId={openPostId}
          onFailure={handleFailure}
          onRemoved={() => {
            setOpenPostId(null);
            loadFirstPage();
          }}
        />
      ) : null}

      {status !== 'locked' && status !== 'error' && !detailOpen ? (
        <>
          <div role="group" aria-label="글 종류 필터" className="flex gap-2 overflow-x-auto px-4 pb-3">
            {FILTERS.map((item) => (
              <button
                key={item.label}
                type="button"
                aria-pressed={filter === item.value}
                data-track={`community-filter-${item.value ?? 'all'}`}
                onClick={() => setFilter(item.value)}
                className={`min-h-11 shrink-0 rounded-full border px-4 text-[14px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4475f] ${
                  filter === item.value
                    ? 'border-[#c4475f] bg-[#1e1618] text-[#e58a9b]'
                    : 'border-[#35292c] text-[#a89e9a]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {status === 'loading' ? (
            <p role="status" className="m-0 px-5 py-12 text-center text-[14px] text-[#a89e9a]">
              불러오는 중
            </p>
          ) : null}

          {status === 'ready' && posts.length === 0 ? (
            <p className="m-0 px-5 py-12 text-center text-[14px] text-[#a89e9a]">
              아직 글이 없어요. 첫 이야기를 남겨 보세요.
            </p>
          ) : null}

          {status === 'ready' ? (
            <ul className="m-0 flex list-none flex-col gap-3 px-4">
              {posts.map((post) => (
                <li key={post.post_id}>
                  <button
                    type="button"
                    data-track="community-post-open"
                    onClick={() => setOpenPostId(post.post_id)}
                    className="block min-h-11 w-full rounded-[14px] bg-[#fbfaf9] p-4 text-left text-[#1a1415] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4475f]"
                  >
                    <span className="flex items-center gap-2">
                      {post.deleted ? null : <KindTag kind={post.kind} />}
                      <span className="text-[13px] font-bold">{post.nickname}</span>
                      <span className="text-[12px] text-[#6f6466]">{relativeTime(post.created_at)}</span>
                    </span>
                    <span
                      data-no-track
                      className={`mt-2 line-clamp-3 block whitespace-pre-wrap break-words text-[15px] leading-[1.65] ${
                        post.deleted ? 'text-[#6f6466]' : ''
                      }`}
                    >
                      {post.body}
                    </span>
                    <span className="mt-2 block text-[12px] text-[#6f6466]">댓글 {post.comment_count}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {status === 'ready' && nextCursor ? (
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

      {status === 'ready' && !detailOpen ? (
        <div
          className="fixed inset-x-0 bottom-0 z-10 border-t border-[#35292c] bg-[#0d0a0b] px-4 pt-3"
          style={{ paddingBottom: 'max(12px, var(--safe-bottom))' }}
        >
          <button
            ref={writeButtonRef}
            type="button"
            data-track="community-write"
            onClick={() => setComposing(true)}
            className="h-12 w-full rounded-full bg-[#8f1d35] text-[15px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0a0b]"
          >
            글쓰기
          </button>
        </div>
      ) : null}

      {composing ? (
        <CommunityCompose
          bookId={bookId}
          initialKind={filter ?? 'theory'}
          returnFocusRef={writeButtonRef}
          onClose={() => setComposing(false)}
          onPosted={() => {
            setComposing(false);
            loadFirstPage();
          }}
          onFailure={(failure) => {
            setComposing(false);
            handleFailure(failure);
          }}
        />
      ) : null}
    </div>
  );
}
