import { useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useModalLayer } from '../../hooks/useModalLayer';

export default function CommunityDialog({
  title,
  onClose,
  returnFocusRef,
  children,
}: {
  title: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalLayer({ active: true, dialogRef, returnFocusRef, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-5">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[85dvh] w-full max-w-[420px] overflow-y-auto rounded-[16px] bg-[#fbfaf9] p-5 font-dashSans text-[#1a1415] outline-none focus-visible:ring-2 focus-visible:ring-[#8f1d35]"
      >
        <h2 id={titleId} className="m-0 text-[17px] font-bold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
