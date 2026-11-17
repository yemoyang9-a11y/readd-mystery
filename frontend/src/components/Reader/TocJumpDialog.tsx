import { useRef } from 'react';
import { useModalLayer } from '../../hooks/useModalLayer';

const BUTTON_BASE =
  'min-h-11 w-full rounded-full px-5 font-dashSans text-[14px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brief-accent sm:w-auto';

/**
 * 목차로 기준점보다 뒤 쪽을 고를 때 띄우는 확인 창 (R1, FR-PRG-003 🚦).
 *
 * 2026-11-17 — 기준점이 "차례로 읽은 범위"로 바뀌면서 선택지가 셋이 됐다.
 *   취소                  이동하지 않는다
 *   이동만 하기            이동만 한다. 기준점은 서버가 차례로 읽은 범위로 둔다
 *   앞부분은 이미 읽었어요  그 이동 이벤트에 claim: 'read_through' 를 싣는다
 * 어느 쪽이든 기준점은 서버가 정한다 — 이 창은 독자의 답만 전한다 (절대 규칙 2·8번).
 *
 * 휴대폰 우선 — 좁은 화면에서는 버튼을 한 줄씩 꽉 차게 쌓고, 최소 44px 높이다.
 * 처음 초점은 가장 안전한 '취소'에 두고, Esc 도 취소다.
 */
export default function TocJumpDialog({
  targetPage,
  onMoveOnly,
  onReadThrough,
  onCancel,
}: {
  /** 목차에서 고른 쪽 — 받은 값을 그대로 보여준다 */
  targetPage: number;
  onMoveOnly: () => void;
  onReadThrough: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  useModalLayer({ active: true, dialogRef, returnFocusRef, initialFocusRef: cancelRef, onClose: onCancel });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="toc-jump-message"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-sm rounded-2xl border border-brief-rule bg-brief-page p-5 shadow-brief-soft-sm"
      >
        <p id="toc-jump-message" className="font-dashSans text-[15px] leading-relaxed text-brief-ink">
          {targetPage}쪽으로 이동합니다. 앞부분을 이미 읽으셨다면 관계도와 챗봇이 이 쪽까지 다룹니다.
          이동만 하면 지금까지 차례로 읽은 쪽까지만 다룹니다.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={`${BUTTON_BASE} border border-brief-rule bg-white text-brief-ink`}
          >
            취소
          </button>
          <button
            type="button"
            onClick={onMoveOnly}
            className={`${BUTTON_BASE} border border-brief-accent bg-white text-brief-accent`}
          >
            이동만 하기
          </button>
          <button
            type="button"
            onClick={onReadThrough}
            className={`${BUTTON_BASE} bg-brief-accent text-white focus-visible:ring-offset-2`}
          >
            앞부분은 이미 읽었어요
          </button>
        </div>
      </div>
    </div>
  );
}
