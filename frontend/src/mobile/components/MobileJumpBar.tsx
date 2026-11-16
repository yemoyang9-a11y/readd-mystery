import { CHROME_FADE, chromeProps } from './MobileReaderView';

// FR-PRG-003
export default function MobileJumpBar({
  origin,
  currentPage,
  hidden,
  onReturn,
  onDismiss,
}: {
  origin: number | null;
  currentPage: number | null;
  hidden: boolean;
  onReturn: () => void;
  onDismiss: () => void;
}) {
  if (origin === null) return null;
  return (
    <div
      {...chromeProps(hidden)}
      role="status"
      className={`absolute inset-x-4 z-[6] flex items-center justify-between gap-2 rounded-2xl bg-brief-accent py-1 pl-4 pr-1 font-dashSans text-[14px] text-brief-on-accent shadow-brief-soft ${CHROME_FADE} ${hidden ? 'invisible opacity-0' : ''}`}
      style={{ bottom: 'calc(49px + max(4px, var(--safe-bottom)) + 12px)' }}
    >
      <span className="min-w-0 truncate">{currentPage}쪽을 보는 중</span>
      <span className="flex shrink-0 items-center">
        <button type="button" onClick={onReturn} className="min-h-11 rounded-full px-2 font-bold underline underline-offset-2">
          {origin}쪽으로 돌아가기
        </button>
        <button type="button" onClick={onDismiss} aria-label="닫기" className="flex size-11 items-center justify-center rounded-full">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </span>
    </div>
  );
}
