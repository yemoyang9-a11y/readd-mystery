import { useId, useRef, type RefObject } from 'react';
import { useModalLayer } from '../../hooks/useModalLayer';
import type { LegalDoc } from '../../content/legalDrafts';

/**
 * 약관 보기 시트 (대표 지시 2026-11-18). 아래에서 올라오는 시트 — 밀리의서재가 가입 중 선택 항목에
 * 바텀 시트를 쓰는 방식(research-2026-11-18-new-screens.md 1장, -signup-fields.md 4장).
 * Esc·닫기·바깥 누르기로 닫고, 닫으면 열었던 "보기" 버튼으로 초점을 돌려준다(NFR-USE).
 */
export default function TermsSheet({
  doc,
  returnFocusRef,
  onClose,
}: {
  doc: LegalDoc;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useModalLayer({ active: true, dialogRef, returnFocusRef, initialFocusRef: closeRef, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[82dvh] w-full max-w-[480px] flex-col rounded-t-[18px] border border-b-0 border-[#35292c] bg-[#1e1618] font-dashSans text-[#ece6e0] shadow-[0_-16px_40px_rgba(0,0,0,0.5)] outline-none"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#35292c] px-5 pb-3 pt-4">
          <h2 id={titleId} className="m-0 font-dashSerif text-[18px] font-bold leading-snug text-white">
            {doc.title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-full border border-[#35292c] px-4 text-[14px] font-bold text-[#ece6e0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
          >
            닫기
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-6 pt-4">
          {doc.sections.map((section) => (
            <section key={section.heading} className="mt-4 first:mt-0">
              <h3 className="m-0 text-[15px] font-bold text-white">{section.heading}</h3>
              {section.body.map((line) => (
                <p key={line} className="m-0 mt-1.5 break-keep text-[15px] leading-[1.7] text-[#ece6e0]">
                  {line}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
