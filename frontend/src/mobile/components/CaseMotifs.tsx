import type { ReactNode } from 'react';

/**
 * 사건 파일 모티프 (2026-11-18 대표 지시 — 새 화면은 미스터리 브랜딩).
 * 조사: docs/context/research-2026-11-18-new-screens.md 5장 — 타자기 머리표·도장 두 가지만 쓴다.
 * 둘 다 장식이라 스크린리더에서 숨긴다. 뜻은 화면의 제목이 전한다.
 */

/** 타자기(DM Mono) 머리표 — "CASE FILE · 001"처럼 서류 위쪽에 찍힌 분류 표 */
export function CaseLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center gap-2 font-dashMono text-[11px] font-medium uppercase tracking-[0.22em] text-[#e58a9b] ${className}`}
    >
      <span className="h-px w-5 bg-[#c4475f]" />
      {children}
    </span>
  );
}

/** 비스듬한 도장 한 개 — 버건디 이중 테두리. 화면당 하나만 쓴다 */
export function CaseStamp({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none inline-flex select-none items-center rounded-[6px] border-2 border-[#c4475f] p-[3px] ${className}`}
    >
      <span className="rounded-[3px] border border-[#c4475f]/70 px-2.5 py-1 font-dashSerif text-[15px] font-bold leading-none tracking-[0.18em] text-[#e58a9b]">
        {children}
      </span>
    </span>
  );
}
