import { useState } from 'react';
import {
  classifyCommunityError,
  likeCommunityPost,
  unlikeCommunityPost,
  type CommunityFailure,
} from '../../services/communityService';
import type { CommunityLikeState } from '../../types';

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-[18px]"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M10 16.5s-6-3.6-6-8.1A3.4 3.4 0 0 1 10 6.3a3.4 3.4 0 0 1 6 2.1c0 4.5-6 8.1-6 8.1Z" />
    </svg>
  );
}

/**
 * 공감 버튼 (2026-11-18 대표 지시). 숫자와 눌림 상태는 서버 응답을 그대로 쓴다 —
 * 누르는 동안만 미리 바꿔 보여 주고, 실패하면 원래 값으로 되돌린다.
 */
// COMMUNITY
export default function LikeButton({
  bookId,
  postId,
  state,
  onChange,
  onFailure,
  tone = 'card',
}: {
  bookId: string;
  postId: string;
  state: CommunityLikeState;
  onChange: (next: CommunityLikeState) => void;
  onFailure: (failure: CommunityFailure) => void;
  tone?: 'card' | 'detail';
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const before = state;
    const want = !before.liked_by_me;
    setBusy(true);
    onChange({ liked_by_me: want, like_count: Math.max(0, before.like_count + (want ? 1 : -1)) });
    try {
      onChange(await (want ? likeCommunityPost(bookId, postId) : unlikeCommunityPost(bookId, postId)));
    } catch (cause) {
      onChange(before);
      onFailure(classifyCommunityError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      aria-pressed={state.liked_by_me}
      aria-label={`공감 ${state.like_count}`}
      data-track="community-like"
      onClick={() => void toggle()}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] ${
        state.liked_by_me ? 'text-[#e58a9b]' : tone === 'detail' ? 'text-[#d8cfca]' : 'text-[#a89e9a]'
      }`}
    >
      <HeartIcon filled={state.liked_by_me} />
      <span aria-hidden="true">공감 {state.like_count}</span>
    </button>
  );
}
