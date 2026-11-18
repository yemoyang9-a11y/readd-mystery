import { useId, useRef } from 'react';
import type { RefObject } from 'react';
import BookCover from '../../components/common/BookCover';
import { useCatalog } from '../../hooks/useCatalog';
import { useModalLayer } from '../../hooks/useModalLayer';
import { CaseLabel, CaseStamp } from '../components/CaseMotifs';

/**
 * 완독 화면 (2026-11-18 대표 지시 "책 다 읽고 커뮤니티로 바로 들어갈 수 있게")
 *
 * 띄우는 조건은 부르는 쪽(MobileReader)이 정한다 — 마지막 쪽이 화면에 있고 서버의
 * 기준점 결정기가 is_complete 라고 답했을 때만이다. 이 화면은 완독을 계산하지 않는다
 * (절대 규칙 2, FR-BRF-005 🚦).
 *
 * 숫자는 이미 받은 값만 쓴다: 읽은 쪽 = 책 정보(GET /books/:id/info)의 전체 쪽 수,
 * 추리 노트 = 이 독자가 쓴 노트 목록(GET /books/:id/notes)의 개수. 새 기준점 계산은 없다.
 */
// FR-BRF-005 🚦
export default function CompletionScreen({
  bookId,
  bookTitle,
  totalPages,
  noteCount,
  returnFocusRef,
  onCommunity,
  onHome,
  onClose,
}: {
  bookId: string;
  bookTitle: string;
  totalPages: number;
  /** 노트를 불러오지 못했으면 null — 그 칸을 그리지 않는다 */
  noteCount: number | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  onCommunity: () => void;
  onHome: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  useModalLayer({ active: true, dialogRef, returnFocusRef, initialFocusRef: primaryRef, onClose });
  const { books } = useCatalog();
  const book = books.find((item) => item.book_id === bookId);
  const title = book?.title ?? bookTitle;

  const stats: { label: string; value: string }[] = [];
  if (totalPages > 0) stats.push({ label: '읽은 쪽', value: `${totalPages}쪽` });
  if (noteCount !== null) stats.push({ label: '추리 노트', value: `${noteCount}개` });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="completion-screen"
      className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-[#0d0a0b] font-dashSans text-[#ece6e0] outline-none"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'max(16px, var(--safe-bottom))',
        background: 'radial-gradient(110% 60% at 50% 28%, #3a1620 0%, #1a0f12 46%, #0d0a0b 100%)',
      }}
    >
      <div className="flex justify-end px-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          data-track="completion-close"
          className="flex size-11 items-center justify-center rounded-full text-[#ece6e0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        {/* 완독 = 사건 종결. 표지 모서리에 도장 하나 (조사: research-2026-11-18-new-screens.md 3장) */}
        <div className="relative">
          <div className="rotate-[-3deg] shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
            <BookCover
              book={{ book_id: bookId, title, author: book?.author ?? '', cover_url: book?.cover_url ?? '' }}
              size="detail"
            />
          </div>
          <CaseStamp className="absolute -bottom-3 -right-8 rotate-[-12deg] bg-[#0d0a0b]/85 backdrop-blur-[1px]">사건 종결</CaseStamp>
        </div>
        <CaseLabel className="mt-10">Case closed</CaseLabel>
        <h2 id={titleId} className="m-0 mt-3 break-keep font-dashSerif text-[30px] font-bold leading-[1.25] text-white">
          끝까지 읽었어요
        </h2>
        <p className="m-0 mt-3 break-keep font-dashSerif text-[17px] text-[#d8cfca]">「{title}」</p>

        {stats.length > 0 ? (
          <dl className="m-0 mt-8 flex w-full max-w-[320px] divide-x divide-[#35292c] rounded-[14px] border border-[#35292c] bg-[#1e1618]/80">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-1 flex-col items-center gap-1 py-4">
                <dt className="text-[12px] font-semibold tracking-[0.04em] text-[#bfb3ae]">{stat.label}</dt>
                <dd className="m-0 font-dashSerif text-[22px] font-bold text-white">{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 px-5 pt-6">
        <button
          ref={primaryRef}
          type="button"
          onClick={onCommunity}
          data-track="completion-community"
          className="h-[52px] w-full rounded-full bg-[#8f1d35] text-[16px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0a0b]"
        >
          커뮤니티에서 이야기 나누기
        </button>
        <button
          type="button"
          onClick={onHome}
          data-track="completion-home"
          className="h-12 w-full rounded-full border border-[#35292c] text-[15px] font-bold text-[#ece6e0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
        >
          홈으로
        </button>
      </div>
    </div>
  );
}
