import { useEffect, useRef } from 'react';
import type { BriefingResponse, ReadingNote } from '../../types';
import { resolveBriefingView } from '../../utils/briefingView';
import { EMPTY_RECAP_MESSAGE } from '../../utils/constants';
import { parseRecapParagraphs } from '../../utils/recapText';
import { splitHighlighted } from '../../components/Ssabi/highlightNames';
import TypographicCover from '../../components/common/TypographicCover';
import BriefingNotes from '../../components/Ssabi/BriefingNotes';
import { GREETING_LINES, MOCK_DAYS_SINCE_LABEL } from '../../pages/BriefingView';

// FR-BRF-002 FR-BRF-003 FR-SPL-005 🚦 FR-NAV-001
export default function MobileBriefingView({
  briefing,
  title,
  author,
  coverUrl,
  onContinue,
  onRequestFallback,
  onBack,
  streamedRecap,
  recapFailed,
  recapStreaming,
  characterNames,
  notes = [],
  onOpenCommunity,
}: {
  briefing: BriefingResponse;
  title: string;
  author: string;
  coverUrl: string | null;
  onContinue: () => void;
  onRequestFallback: () => void;
  onBack: () => void;
  streamedRecap: string;
  recapFailed: boolean;
  recapStreaming: boolean;
  characterNames: string[];
  notes?: ReadingNote[];
  onOpenCommunity?: () => void;
}) {
  const view = resolveBriefingView(briefing);
  const requested = useRef(false);

  // D13 NFR-AI-017
  useEffect(() => {
    if (view.kind !== 'fallback' || requested.current) return;
    requested.current = true;
    onRequestFallback();
  }, [view.kind, onRequestFallback]);

  const recapText = view.kind === 'recap' ? (briefing.recap ?? '') : streamedRecap;

  return (
    <div
      data-testid="mobile-briefing"
      data-mobile="true"
      data-night
      className="min-h-[100dvh] bg-brief-paper font-dashSans text-brief-ink"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'calc(60px + max(12px, var(--safe-bottom)))',
      }}
    >
      <main className="px-5 pb-10 pt-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="돌아가기"
          className="flex size-11 items-center justify-center rounded-full border border-brief-line bg-brief-paper text-brief-ink transition-opacity hover:opacity-65"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9.5 4.8 6.5 8 9.5 11.2" />
          </svg>
        </button>

        <div data-testid="brief-rule" className="my-5 h-[2px] w-full rounded-[1px] bg-brief-rule" />

        <div className="flex items-center gap-4">
          <TypographicCover size="brief-compact" title={title} author={author} coverUrl={coverUrl} />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-brief-muted">{MOCK_DAYS_SINCE_LABEL}</p>
            <h2 className="mt-2 break-keep font-dashSerif text-[22px] font-semibold leading-[1.35] tracking-[-.03em] text-brief-ink">
              {GREETING_LINES.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h2>
            <p className="mt-2 text-[13px] text-brief-muted">
              {title} · {author}
            </p>
          </div>
        </div>

        {onOpenCommunity ? (
          <button
            type="button"
            data-track="community-open"
            onClick={onOpenCommunity}
            className="my-6 flex min-h-12 w-full items-center justify-between rounded-brief-panel border border-[#c4475f] bg-[#1e1618] px-5 text-left text-[15px] font-bold text-[#e58a9b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4475f]"
          >
            <span>커뮤니티</span>
            <span className="text-[13px] font-normal text-[#a89e9a]">다른 독자들과 이야기하기</span>
          </button>
        ) : null}

        <h3 className="mb-3 font-dashSerif text-lg font-semibold tracking-[-.02em] text-brief-ink">
          그동안 이런 이야기였어요
        </h3>
        <div className="rounded-brief-panel bg-brief-card p-5 shadow-brief-soft-sm">
          {view.kind === 'empty' ? (
            <p className="m-0 font-dashSerif text-[15px] leading-[1.85]">{EMPTY_RECAP_MESSAGE}</p>
          ) : null}

          {view.kind === 'fallback' && recapFailed ? (
            <p role="alert" className="m-0 font-dashSerif text-[15px] leading-[1.85]">
              리캡을 불러오지 못했습니다
            </p>
          ) : null}

          {view.kind === 'recap' || (view.kind === 'fallback' && !recapFailed) ? (
            <>
              <span
                aria-hidden="true"
                className="mb-2 block font-dashSerif text-[40px] leading-none text-brief-accent opacity-[.45]"
              >
                “
              </span>
              {parseRecapParagraphs(recapText).map((paragraph, i) => (
                <p
                  key={i}
                  className="whitespace-pre-wrap font-dashSerif text-[15px] leading-[1.85] [&:not(:first-child)]:mt-3"
                >
                  {splitHighlighted(paragraph, characterNames).map((segment, j) =>
                    segment.bold ? (
                      <b key={j} className="font-bold">
                        {segment.text}
                      </b>
                    ) : (
                      segment.text
                    )
                  )}
                </p>
              ))}
              {view.kind === 'fallback' && recapStreaming ? (
                <span aria-live="polite" className="mt-3 block text-[12px] text-brief-muted">
                  불러오는 중
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="mt-2 block text-right font-dashSerif text-[40px] leading-none text-brief-accent opacity-[.45]"
                >
                  ”
                </span>
              )}
            </>
          ) : null}
        </div>

        <div data-testid="brief-rule" className="my-7 h-[2px] w-full rounded-[1px] bg-brief-rule" />

        <BriefingNotes notes={notes} />
      </main>

      <div
        data-testid="briefing-continue-bar"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-brief-line bg-brief-paper px-5 pt-3"
        style={{ paddingBottom: 'max(12px, var(--safe-bottom))' }}
      >
        <button
          type="button"
          data-track="마저 읽기"
          onClick={onContinue}
          className="h-12 w-full rounded-full border border-brief-ink bg-transparent text-[15px] font-bold text-brief-ink transition-colors hover:bg-[rgba(31,31,31,0.05)] active:bg-[rgba(31,31,31,0.1)]"
        >
          이어서 읽기
        </button>
      </div>
    </div>
  );
}
