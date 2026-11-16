import { useEffect, useRef } from 'react';

// FR-PRG-003
export default function TocJumpDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="toc-jump-message"
        className="w-full max-w-sm rounded-2xl border border-brief-rule bg-brief-page p-5 shadow-brief-soft-sm"
      >
        <p id="toc-jump-message" className="font-dashSans text-[15px] leading-relaxed text-brief-ink">
          여기로 이동하면 관계도와 챗봇이 이 쪽까지의 내용을 다룹니다
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-full border border-brief-rule bg-white px-5 font-dashSans text-[14px] font-bold text-brief-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brief-accent"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-full bg-brief-accent px-5 font-dashSans text-[14px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brief-accent focus-visible:ring-offset-2"
          >
            이동
          </button>
        </div>
      </div>
    </div>
  );
}
