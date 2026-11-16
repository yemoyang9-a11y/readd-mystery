import type { QuoteSelectionPopover } from '../../hooks/useQuoteSelection';

const GAP = 12;
const SIDE_MARGIN = 16;
const WIDTH = 280;
const HEIGHT = 48;

// FR-QNA-006
export default function QuoteAskButton({
  popover,
  limitBottom,
  onAsk,
  onNote,
}: {
  popover: QuoteSelectionPopover;
  limitBottom: number;
  onAsk: () => void;
  onNote: () => void;
}) {
  const left = Math.min(
    Math.max(SIDE_MARGIN, window.innerWidth / 2 - WIDTH / 2),
    window.innerWidth - SIDE_MARGIN - WIDTH
  );
  const below = popover.bottom + GAP;
  const top = below + HEIGHT <= limitBottom ? below : popover.top - GAP - HEIGHT;
  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
    onMouseUp: (e: React.MouseEvent) => e.stopPropagation(),
    onTouchEnd: (e: React.TouchEvent) => e.stopPropagation(),
  };
  const action =
    'min-h-12 flex-1 whitespace-nowrap px-3 text-[14px] font-bold text-brief-ink active:bg-brief-accent-soft';
  return (
    <div
      data-quote-ask
      data-no-track
      style={{ top, left, width: WIDTH, minHeight: HEIGHT }}
      className="fixed z-50 flex animate-pop-in overflow-hidden rounded-2xl border border-brief-rule bg-brief-card shadow-brief-soft"
    >
      <button type="button" data-quote-ask {...stop} onClick={onAsk} className={action}>
        챗봇에 물어보기
      </button>
      <button type="button" data-quote-ask {...stop} onClick={onNote} className={`${action} border-l border-brief-rule`}>
        노트에 적기
      </button>
    </div>
  );
}
