import { useEffect, useRef, useState } from 'react';
import { Avatar } from './CommentRow';
import type { ReplyTarget } from './CommentThread';

const MAX_COMMENT = 2000;
const MAX_REPLY = 1000;

function stripMention(text: string, target: ReplyTarget | null): string {
  if (!target) return text.trim();
  const mention = `@${target.nickname}`;
  return (text.startsWith(mention) ? text.slice(mention.length) : text).trim();
}

export default function CommentComposer({
  replyTarget,
  myName = null,
  onCancelReply,
  onSubmit,
}: {
  replyTarget: ReplyTarget | null;
  myName?: string | null;
  onCancelReply: () => void;
  onSubmit: (body: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setText(replyTarget ? `@${replyTarget.nickname} ` : '');
    if (replyTarget) inputRef.current?.focus();
  }, [replyTarget]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const body = stripMention(text, replyTarget);

  async function submit() {
    if (!body || sending) return;
    setSending(true);
    try {
      await onSubmit(body);
      setText('');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid border-t border-[#35292c] bg-[#0d0a0b]/95">
      {replyTarget ? (
        <div className="flex items-center justify-between bg-[#1e1618] px-4 py-2 text-[14px] text-[#b5aaa6]">
          <span>
            <b className="text-[#ece6e0]">{replyTarget.nickname}</b>님에게 답글 남기는 중
          </span>
          <button
            type="button"
            aria-label="답글 취소"
            onClick={onCancelReply}
            className="flex size-9 items-center justify-center rounded-full text-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
          >
            ✕
          </button>
        </div>
      ) : null}
      <form
        className="flex items-end gap-2.5 px-3.5 pb-3 pt-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <span className="pb-1.5">
          <Avatar name={myName} size="sm" />
        </span>
        <div
          className={`flex min-h-11 flex-1 items-end gap-2 rounded-[22px] border bg-[#1e1618] py-1 pl-4 pr-1 ${
            body ? 'border-[#c4475f]' : 'border-[#35292c]'
          }`}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={replyTarget ? MAX_REPLY + replyTarget.nickname.length + 2 : MAX_COMMENT}
            placeholder="댓글 달기..."
            aria-label={replyTarget ? `${replyTarget.nickname}님에게 답글` : '댓글'}
            onChange={(event) => setText(event.target.value)}
            className="min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-[1.4] text-[#ece6e0] placeholder:text-[#b5aaa6] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!body || sending}
            className="h-[34px] shrink-0 rounded-[17px] bg-[#8f1d35] px-3.5 text-[14px] font-extrabold text-white disabled:bg-[#3a2a2e] disabled:text-[#7d6f72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
          >
            게시
          </button>
        </div>
      </form>
    </div>
  );
}
