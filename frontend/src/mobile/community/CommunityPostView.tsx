import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CommunityComment, CommunityPost, CommunityReportTarget } from '../../types';
import {
  classifyCommunityError,
  createCommunityComment,
  deleteCommunityComment,
  deleteCommunityPost,
  fetchCommunityPost,
  reportCommunityTarget,
} from '../../services/communityService';
import { DeleteDialog, ReportDialog } from './CommunityConfirmDialogs';
import { KIND_LABEL, relativeTime } from './communityFormat';
import LikeButton from './LikeButton';

const MAX_COMMENT_LENGTH = 1000;

type Target = { type: CommunityReportTarget; id: string };

export function KindTag({ kind }: { kind: CommunityPost['kind'] }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-[4px] border px-2 text-[12px] font-bold tracking-[0.06em] ${
        kind === 'theory' ? 'border-[#c4475f]/60 bg-[#2d161d] text-[#e58a9b]' : 'border-[#4a3f41] bg-[#2a2224] text-[#d8cfca]'
      }`}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

function ItemMenu({ label, onReport }: { label: string; onReport: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${label} 더보기`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="flex size-11 items-center justify-center rounded-full text-[#a89e9a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
      >
        <span aria-hidden="true" className="text-[20px] leading-none">
          ⋯
        </span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-11 z-10 min-w-[120px] rounded-[12px] border border-[#35292c] bg-transparent py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            data-track="community-report-open"
            onClick={() => {
              setOpen(false);
              onReport();
            }}
            className="flex min-h-11 w-full items-center px-4 text-left text-[14px] text-[#ece6e0] focus-visible:bg-[#2d161d] focus-visible:outline-none"
          >
            신고하기
          </button>
        </div>
      ) : null}
    </div>
  );
}

// COMMUNITY
export default function CommunityPostView({
  bookId,
  postId,
  onRemoved,
  desktop = false,
}: {
  bookId: string;
  postId: string;
  onRemoved: () => void;
  /** PC 가운데 단(E2E #86) — 댓글 입력줄을 화면 폭 대신 단 폭에 붙인다 */
  desktop?: boolean;
}) {
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [reporting, setReporting] = useState<Target | null>(null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const draftId = useId();

  const load = useCallback(() => {
    setLoadFailed(false);
    fetchCommunityPost(bookId, postId)
      .then((detail) => {
        setPost(detail.post);
        setComments(detail.comments);
      })
      .catch((cause) => {
        if (classifyCommunityError(cause) === 'not_found') onRemoved();
        else setLoadFailed(true);
      });
  }, [bookId, postId, onRemoved]);

  useEffect(load, [load]);

  function remember() {
    focusReturn.current = document.activeElement as HTMLElement | null;
  }

  async function submitComment() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setNotice(null);
    try {
      await createCommunityComment(bookId, postId, body);
      setDraft('');
      load();
    } catch (cause) {
      const failure = classifyCommunityError(cause);
      if (failure === 'not_found') onRemoved();
      else
        setNotice(
          failure === 'rate_limited'
            ? '댓글은 1시간에 30개까지 남길 수 있어요.'
            : '댓글을 남기지 못했어요. 잠시 후 다시 시도해 주세요.'
        );
    } finally {
      setSending(false);
    }
  }

  async function confirmDelete() {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    try {
      if (target.type === 'post') {
        await deleteCommunityPost(bookId, target.id);
        onRemoved();
      } else {
        await deleteCommunityComment(bookId, target.id);
        load();
      }
    } catch {
      setNotice('삭제하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  async function submitReport(reason: string): Promise<boolean> {
    if (!reporting) return false;
    try {
      await reportCommunityTarget(bookId, reporting.type, reporting.id, reason);
      setReporting(null);
      setNotice('신고가 접수됐어요.');
      return true;
    } catch {
      return false;
    }
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <p role="alert" className="m-0 text-[14px] text-[#a89e9a]">
          글을 불러오지 못했어요
        </p>
        <button
          type="button"
          onClick={load}
          className="min-h-11 rounded-full bg-[#8f1d35] px-6 text-[15px] font-bold text-white"
        >
          다시 시도
        </button>
      </div>
    );
  }
  if (!post) {
    return (
      <p role="status" className="m-0 px-5 py-16 text-center text-[14px] text-[#a89e9a]">
        불러오는 중
      </p>
    );
  }

  return (
    <>
      <article
        aria-label="게시글"
        className="mx-4 rounded-[14px] border border-[#35292c] bg-[#1e1618] p-4 text-[#ece6e0]"
      >
        <header className="flex items-center gap-2">
          {post.deleted ? null : <KindTag kind={post.kind} />}
          <span className="text-[13px] font-bold">{post.nickname}</span>
          <span className="text-[12px] text-[#a89e9a]">{relativeTime(post.created_at)}</span>
          <span className="flex-1" />
          {post.is_mine ? (
            <button
              type="button"
              onClick={() => {
                remember();
                setDeleting({ type: 'post', id: post.post_id });
              }}
              className="min-h-11 px-3 text-[13px] font-bold text-[#e58a9b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
            >
              삭제
            </button>
          ) : post.deleted ? null : (
            <ItemMenu
              label="게시글"
              onReport={() => {
                remember();
                setReporting({ type: 'post', id: post.post_id });
              }}
            />
          )}
        </header>
        <p
          data-no-track
          className={`m-0 mt-3 whitespace-pre-wrap break-words text-[16px] leading-[1.75] ${
            post.deleted ? 'text-[#a89e9a]' : ''
          }`}
        >
          {post.body}
        </p>
        {post.deleted ? null : (
          <div className="-mb-2 -ml-3 mt-2 flex">
            <LikeButton
              tone="detail"
              bookId={bookId}
              postId={post.post_id}
              state={{ like_count: post.like_count, liked_by_me: post.liked_by_me }}
              onChange={(next) => setPost((prev) => (prev ? { ...prev, ...next } : prev))}
              onFailure={(failure) => {
                if (failure === 'not_found') onRemoved();
              }}
            />
          </div>
        )}
      </article>

      <h3 className="m-0 px-5 pb-2 pt-6 text-[14px] font-bold text-[#a89e9a]">댓글 {comments.length}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 px-4 pb-4">
        {comments.map((comment) => (
          <li
            key={comment.comment_id}
            className="rounded-[12px] border border-[#35292c] bg-[#1e1618] px-4 py-3 text-[#ece6e0]"
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold">{comment.nickname}</span>
              <span className="text-[12px] text-[#a89e9a]">{relativeTime(comment.created_at)}</span>
              <span className="flex-1" />
              {comment.is_mine ? (
                <button
                  type="button"
                  onClick={() => {
                    remember();
                    setDeleting({ type: 'comment', id: comment.comment_id });
                  }}
                  className="min-h-11 px-3 text-[13px] font-bold text-[#e58a9b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
                >
                  삭제
                </button>
              ) : (
                <ItemMenu
                  label="댓글"
                  onReport={() => {
                    remember();
                    setReporting({ type: 'comment', id: comment.comment_id });
                  }}
                />
              )}
            </div>
            <p data-no-track className="m-0 mt-1 whitespace-pre-wrap break-words text-[15px] leading-[1.65]">{comment.body}</p>
          </li>
        ))}
      </ul>

      {notice ? (
        <p role="status" className="m-0 px-5 pb-4 text-[13px] text-[#e58a9b]">
          {notice}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submitComment();
        }}
        className={`${desktop ? 'sticky' : 'fixed inset-x-0'} bottom-0 z-10 flex items-end gap-2 border-t border-[#35292c] bg-[#0d0a0b] px-4 pt-3`}
        style={{ paddingBottom: desktop ? '12px' : 'max(12px, var(--safe-bottom))' }}
      >
        <label htmlFor={draftId} className="sr-only">
          댓글 입력
        </label>
        <textarea
          id={draftId}
          value={draft}
          rows={1}
          maxLength={MAX_COMMENT_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="댓글을 남겨 보세요"
          className="max-h-28 min-h-11 flex-1 resize-none rounded-[12px] border border-[#35292c] bg-[#1e1618] px-3 py-[10px] text-[16px] leading-6 text-[#ece6e0] outline-none placeholder:text-[#8a7f81] focus-visible:ring-2 focus-visible:ring-[#c4475f]"
        />
        <button
          type="submit"
          data-track="community-comment"
          disabled={!draft.trim() || sending}
          className="min-h-11 shrink-0 rounded-full bg-[#8f1d35] px-5 text-[15px] font-bold text-white disabled:opacity-40"
        >
          등록
        </button>
      </form>

      {deleting ? (
        <DeleteDialog
          label={deleting.type === 'post' ? '글' : '댓글'}
          returnFocusRef={focusReturn}
          onClose={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
      {reporting ? (
        <ReportDialog returnFocusRef={focusReturn} onClose={() => setReporting(null)} onSubmit={submitReport} />
      ) : null}
    </>
  );
}
