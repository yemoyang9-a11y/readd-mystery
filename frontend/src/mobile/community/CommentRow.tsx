import type { Ref } from 'react';
import { relativeTime } from './communityFormat';

const AVATAR_TONES = [
  'bg-[#8f1d35] shadow-[0_0_0_2px_#0d0a0b,0_0_0_3px_#e58a9b]',
  'bg-[#4b3a2a] shadow-[0_0_0_2px_#0d0a0b,0_0_0_3px_#b58a5c]',
  'bg-[#2f3446] shadow-[0_0_0_2px_#0d0a0b,0_0_0_3px_#6c7591]',
  'bg-[#3c2b3d] shadow-[0_0_0_2px_#0d0a0b,0_0_0_3px_#8f6c92]',
  'bg-[#3a3127] shadow-[0_0_0_2px_#0d0a0b,0_0_0_3px_#8c7a5c]',
];

function toneFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function Avatar({ name, size = 'md' }: { name: string | null; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'size-[30px] text-[12px]' : 'size-[38px] text-[15px]';
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-dashSerif font-black text-white ${box} ${
        name ? toneFor(name) : 'bg-[#2a2023]'
      }`}
    >
      {name ? Array.from(name)[0] : ''}
    </span>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[17px]"
      fill={filled ? '#e58a9b' : 'none'}
      stroke={filled ? '#e58a9b' : '#b5aaa6'}
      strokeWidth={1.8}
    >
      <path d="M16.8 3.5c-2 0-3.6 1.1-4.8 2.8-1.2-1.7-2.8-2.8-4.8-2.8C4.3 3.5 2 5.9 2 9c0 5.4 7.4 10.4 10 11.9 2.6-1.5 10-6.5 10-11.9 0-3.1-2.3-5.5-5.2-5.5z" />
    </svg>
  );
}

export interface CommentRowProps {
  variant: 'comment' | 'reply';
  nickname: string | null;
  body: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  isMine: boolean;
  isPostAuthor?: boolean;
  replyToNickname?: string | null;
  highlighted?: boolean;
  deleted?: boolean;
  menuRef?: Ref<HTMLButtonElement>;
  /** 없으면 "답글 달기"를 그리지 않는다 — 삭제된 댓글 묶음은 서버가 답글을 받지 않는다 */
  onReply?: () => void;
  onToggleLike: () => void;
  onDelete: () => void;
  onReport: () => void;
}

export default function CommentRow({
  variant,
  nickname,
  body,
  createdAt,
  likeCount,
  likedByMe,
  isMine,
  isPostAuthor = false,
  replyToNickname = null,
  highlighted = false,
  deleted = false,
  menuRef,
  onReply,
  onToggleLike,
  onDelete,
  onReport,
}: CommentRowProps) {
  const reply = variant === 'reply';
  return (
    <div
      data-reply={reply ? '' : undefined}
      className={`grid items-start gap-x-3 pb-1 pr-3.5 ${
        reply
          ? 'grid-cols-[30px_minmax(0,1fr)_32px] pl-[66px] pt-2.5'
          : 'grid-cols-[38px_minmax(0,1fr)_32px] pl-4 pt-3.5'
      } ${highlighted ? 'bg-[linear-gradient(90deg,rgba(143,29,53,0.28),rgba(143,29,53,0.06))] shadow-[inset_2px_0_0_#c4475f]' : ''}`}
    >
      <Avatar name={deleted ? null : nickname} size={reply ? 'sm' : 'md'} />
      <div className="min-w-0">
        <p
          className={`m-0 whitespace-pre-wrap break-words text-[15px] leading-[1.5] ${deleted ? 'text-[#b5aaa6]' : 'text-[#ece6e0]'}`}
        >
          {deleted ? null : <b className="mr-1.5 font-extrabold">{nickname}</b>}
          {isPostAuthor ? (
            <span className="mr-1.5 inline-block rounded-full border border-[#c4475f] px-[7px] align-[1px] text-[11px] font-extrabold leading-[1.6] text-[#e58a9b]">
              글쓴이
            </span>
          ) : null}
          {replyToNickname ? (
            <span className="font-bold text-[#e58a9b]">@{replyToNickname}</span>
          ) : null}
          {replyToNickname ? ' ' : null}
          {body}
        </p>
        {deleted ? null : (
          <div className="mt-1 flex flex-wrap items-center gap-x-3.5 text-[13px] text-[#b5aaa6]">
            <span>{relativeTime(createdAt).replace(/ 전$/, '')}</span>
            {likeCount > 0 ? <span className="font-bold">좋아요 {likeCount}개</span> : null}
            {onReply ? (
              <button
                type="button"
                onClick={onReply}
                className="min-h-8 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
              >
                답글 달기
              </button>
            ) : null}
            <button
              ref={menuRef}
              type="button"
              onClick={isMine ? onDelete : onReport}
              className="min-h-8 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
            >
              {isMine ? '삭제' : '신고'}
            </button>
          </div>
        )}
      </div>
      {deleted ? (
        <span />
      ) : (
        <button
          type="button"
          aria-label={likedByMe ? '좋아요 취소' : '좋아요'}
          aria-pressed={likedByMe}
          onClick={onToggleLike}
          className="flex size-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
        >
          <HeartIcon filled={likedByMe} />
        </button>
      )}
    </div>
  );
}
