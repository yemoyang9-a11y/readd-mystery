import type { ReactNode } from 'react';
import { CaseLabel } from '../../mobile/components/CaseMotifs';

/**
 * 로그인·가입·약관 동의 화면의 공용 틀 — 미스터리 브랜딩(data-night 토큰, DESIGN.md 2026-11-18).
 * 위 왼쪽 닫기(✕)로 들어오기 전 화면으로 돌아간다 (대표 지시 2026-11-18 — 로그인 창은 필요할 때만,
 * 닫을 수 있게). 전체 화면으로 둔 이유: research-2026-11-18-signup-fields.md 3장.
 */
export default function AuthScreen({
  testId,
  onClose,
  label,
  wordmarkAs: Wordmark = 'h1',
  children,
}: {
  testId: string;
  onClose: () => void;
  label: string;
  /** 화면에 따로 제목(h1)이 있으면 'p' — 제목이 둘이 되지 않게 */
  wordmarkAs?: 'h1' | 'p';
  children: ReactNode;
}) {
  return (
    <div
      data-night
      data-testid={testId}
      className="min-h-[100dvh] bg-[#0d0a0b] font-dashSans text-[#ece6e0]"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
        background: 'radial-gradient(130% 55% at 50% 0%, #2c1219 0%, #170d10 48%, #0d0a0b 100%)',
      }}
    >
      <div className="mx-auto w-full max-w-[420px] px-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="inline-flex size-11 items-center justify-center rounded-full text-[#ece6e0] transition-colors active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
      <div className="mx-auto flex w-full max-w-[420px] flex-col px-5 pb-10 pt-[3vh]">
        <CaseLabel>{label}</CaseLabel>
        <Wordmark className="m-0 mt-3 font-dashSans text-[36px] font-bold leading-none tracking-[0.04em] text-white">
          RE:ADD
        </Wordmark>
        {children}
      </div>
    </div>
  );
}

// 서버 오류 상자와 같은 모양 — 칸 아래 알림도 이 모양을 쓴다
const ERROR_BOX =
  'm-0 flex items-start gap-2 break-keep rounded-[10px] border border-[#c4475f]/50 bg-[#2d161d] px-3 py-2.5 text-[14px] font-bold text-[#f0b3be]';

export function ErrorBox({ id, children, className = '' }: { id?: string; children: string; className?: string }) {
  return (
    <p id={id} role="alert" className={`${ERROR_BOX} ${className}`}>
      <span aria-hidden="true" className="font-dashMono text-[#e58a9b]">!</span>
      {children}
    </p>
  );
}

export const PRIMARY_BUTTON =
  'min-h-12 w-full rounded-full bg-[#8f1d35] text-[16px] font-bold text-white transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1618] disabled:bg-[#4a2630] disabled:text-[#c9b7ba]';

/** 들어오기 전 화면으로. 이 탭의 첫 화면이면(주소로 바로 들어옴) 홈으로 */
export function closeTarget(): -1 | '/' {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0 ? -1 : '/';
}
