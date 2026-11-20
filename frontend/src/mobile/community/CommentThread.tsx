import { useEffect, useRef, useState } from 'react';
import type { CommunityComment, CommunityPost, CommunityReportTarget } from '../../types';
import {
  classifyCommunityError,
  deleteCommunityComment,
  deleteCommunityPost,
  fetchCommunityPost,
  likeCommunityComment,
  likeCommunityPost,
  reportCommunityTarget,
  unlikeCommunityComment,
  unlikeCommunityPost,
  type CommunityFailure,
} from '../../services/communityService';
import CommentRow from './CommentRow';
import { DeleteDialog, ReportDialog } from './CommunityConfirmDialogs';

export type ReplyTarget = { postId: string; commentId: string | null; nickname: string };

type Target = { type: CommunityReportTarget; id: string };

export default function CommentThread({
  bookId,
  post,
  refreshKey,
  highlightCommentId = null,
  onReply,
  onChanged,
  onFailure = () => undefined,
}: {
  bookId: string;
  post: CommunityPost;
  /** 바뀌면 답글을 펼친 채 다시 받는다 — 이 댓글에 답글을 게시한 직후 */
  refreshKey: number;
  /** 지금 답글을 다는 대상(댓글 자신이면 post_id) */
  highlightCommentId?: string | null;
  onReply: (target: ReplyTarget) => void;
  onChanged: () => void;
  /** 요청 실패 — 'locked'(커뮤니티 잠금)이면 부모가 잠금 화면으로 바꾼다 (FR-SPL-005 🚦) */
  onFailure?: (failure: CommunityFailure) => void;
}) {
  const [head, setHead] = useState(post);
  const [expanded, setExpanded] = useState(false);
  const [replies, setReplies] = useState<CommunityComment[] | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [reporting, setReporting] = useState<Target | null>(null);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const firstRefresh = useRef(refreshKey);

  useEffect(() => setHead(post), [post]);

  async function guarded(run: () => Promise<void>) {
    try {
      await run();
    } catch (cause) {
      onFailure(classifyCommunityError(cause));
    }
  }

  async function load() {
    await guarded(async () => {
      const detail = await fetchCommunityPost(bookId, post.post_id);
      setHead(detail.post);
      setReplies(detail.comments);
    });
  }

  useEffect(() => {
    if (refreshKey === firstRefresh.current) return;
    setExpanded(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function toggleReplies() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    await load();
  }

  async function togglePostLike() {
    await guarded(async () => {
      const next = head.liked_by_me
        ? await unlikeCommunityPost(bookId, head.post_id)
        : await likeCommunityPost(bookId, head.post_id);
      setHead((prev) => ({ ...prev, ...next }));
    });
  }

  async function toggleReplyLike(item: CommunityComment) {
    await guarded(async () => {
      const next = item.liked_by_me
        ? await unlikeCommunityComment(bookId, item.comment_id)
        : await likeCommunityComment(bookId, item.comment_id);
      setReplies(
        (prev) =>
          prev?.map((r) => (r.comment_id === item.comment_id ? { ...r, ...next } : r)) ?? prev
      );
    });
  }

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    if (target.type === 'post') {
      await guarded(async () => {
        await deleteCommunityPost(bookId, target.id);
        onChanged();
      });
      return;
    }
    await guarded(() => deleteCommunityComment(bookId, target.id));
    await load();
  }

  async function submitReport(reason: string): Promise<boolean> {
    if (!reporting) return false;
    try {
      await reportCommunityTarget(bookId, reporting.type, reporting.id, reason);
      setReporting(null);
      return true;
    } catch {
      return false;
    }
  }

  const count = replies && expanded ? replies.length : head.comment_count;

  return (
    <li className="list-none">
      <CommentRow
        variant="comment"
        nickname={head.nickname}
        body={head.body}
        createdAt={head.created_at}
        likeCount={head.like_count}
        likedByMe={head.liked_by_me}
        isMine={head.is_mine}
        deleted={head.deleted}
        highlighted={highlightCommentId === head.post_id}
        onReply={() =>
          onReply({ postId: head.post_id, commentId: null, nickname: head.nickname ?? '' })
        }
        onToggleLike={() => void togglePostLike()}
        onDelete={() => setDeleting({ type: 'post', id: head.post_id })}
        onReport={() => setReporting({ type: 'post', id: head.post_id })}
      />
      {count > 0 ? (
        <button
          type="button"
          onClick={() => void toggleReplies()}
          className="flex min-h-9 items-center gap-3 pb-1.5 pl-[66px] pr-3.5 pt-2.5 text-[13px] font-extrabold text-[#b5aaa6] before:w-[26px] before:border-t before:border-[#c4475f] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
        >
          {expanded ? '답글 모두 숨기기' : `답글 ${count}개 모두 보기`}
        </button>
      ) : null}
      {expanded && replies ? (
        <ul className="m-0 p-0">
          {replies.map((item) => (
            <li key={item.comment_id} className="list-none">
              <CommentRow
                variant="reply"
                nickname={item.nickname}
                body={item.body}
                createdAt={item.created_at}
                likeCount={item.like_count}
                likedByMe={item.liked_by_me}
                isMine={item.is_mine}
                isPostAuthor={item.is_post_author}
                replyToNickname={item.reply_to_nickname}
                highlighted={highlightCommentId === item.comment_id}
                onReply={
                  head.deleted
                    ? undefined
                    : () =>
                        onReply({
                          postId: head.post_id,
                          commentId: item.comment_id,
                          nickname: item.nickname,
                        })
                }
                onToggleLike={() => void toggleReplyLike(item)}
                onDelete={() => setDeleting({ type: 'comment', id: item.comment_id })}
                onReport={() => setReporting({ type: 'comment', id: item.comment_id })}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {deleting ? (
        <DeleteDialog
          label={deleting.type === 'post' ? '댓글' : '답글'}
          returnFocusRef={menuRef}
          onClose={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
      {reporting ? (
        <ReportDialog
          returnFocusRef={menuRef}
          onClose={() => setReporting(null)}
          onSubmit={submitReport}
        />
      ) : null}
    </li>
  );
}
