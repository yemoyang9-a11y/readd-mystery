import { CHROME_FADE, chromeProps } from './MobileReaderView';

/**
 * 숫자를 읽는 소리에 맞춘 "(으)로" — 받침이 없거나 ㄹ이면 "로"(이·사·오·구, 일·칠·팔), 그 밖은 "으로"(삼·육·십·백·천·영).
 * 2026-11-18 대표 승인 시안: "p.13 보는 중 · p.40으로 돌아가기"
 */
export function withRo(page: number): string {
  if (page % 10 !== 0) return [1, 2, 4, 5, 7, 8, 9].includes(page % 10) ? '로' : '으로';
  return '으로';
}

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
      <span className="min-w-0 truncate">p.{currentPage} 보는 중</span>
      <span className="flex shrink-0 items-center">
        <button type="button" onClick={onReturn} className="min-h-11 rounded-full px-2 font-bold underline underline-offset-2">
          p.{origin}
          {withRo(origin)} 돌아가기
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
