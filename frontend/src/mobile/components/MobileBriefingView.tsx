import { useEffect, useRef, useState } from 'react';
import type { BriefingResponse, ChapterSummary, ReadingNote } from '../../types';
import { resolveBriefingView } from '../../utils/briefingView';
import { parseRecapParagraphs } from '../../utils/recapText';
import { formatPercent } from '../../utils/format';
import { formatSinceLastRead } from '../../utils/sinceLastRead';
import { splitHighlighted } from '../../components/Ssabi/highlightNames';
import ProgressBar from '../../components/Reader/ProgressBar';
import TypographicCover from '../../components/common/TypographicCover';
import BriefingNotes from '../../components/Ssabi/BriefingNotes';
import { GREETING_LINES } from '../../pages/BriefingView';

/** 처음 펼친 독자 인사 (2026-11-17 대표 결정) */
export const FIRST_VISIT_GREETING_LINES = ['처음 펼치시네요.', '천천히 함께 읽어 봐요.'];

/**
 * 싸비 사용법 3단계 — 고정 안내다. 작품 내용으로 만들지 않는다(2026-11-17 대표 결정).
 * 단계마다 붙어 있던 회색 부연 설명은 뺐다(2026-11-18 대표 지시 — 기능 설명·안심용 문구를 두지 않는다).
 */
export const SSABI_GUIDE_STEPS: { title: string }[] = [
  { title: '읽은 쪽까지만 알려 줘요' },
  { title: '단서와 가설을 노트에 적어요' },
  { title: '아모에게 물어봐요' },
];

const RULE = <div data-testid="brief-rule" className="my-7 h-[2px] w-full rounded-[1px] bg-brief-rule" />;

/**
 * 모바일 브리핑 — 새 세션 진입 시 1회 경유 (PRODUCT.md: 저장 리캡·목차 위치·진도 바·마저 읽기)
 *
 * 2026-11-17 대표 결정(화면 채우기 우선순위 1)
 * - 11-16 시안(314956f)에서 빠졌던 진도 카드와 목차를 되살린다. 카드의 장·전체 쪽수·퍼센트는
 *   브리핑 응답 값을 그대로 쓴다 — 퍼센트는 formatPercent 로 반올림만 한다 (FR-BRF-005 🚦).
 * - "3일 만이에요" 고정 문구를 없앴다. 서버의 마지막 읽은 시각(lastReadAt)이 있을 때만
 *   경과 안내를 그린다.
 * - 진도 기록이 없는 첫 방문(applied_cutoff 0)은 "아직 읽은 내용이 없습니다" 한 줄 대신
 *   처음 펼친 독자용 화면(인사·작품 소개·싸비 사용법·목차)을 보여 준다. 판정은 기존과
 *   같은 resolveBriefingView 의 'empty' 분기라 이 화면의 LLM 호출 0회 조건(D13 ①)은 그대로다.
 */
// FR-BRF-002 FR-BRF-003 FR-BRF-005 🚦 FR-SPL-005 🚦 FR-NAV-001
export default function MobileBriefingView({
  briefing,
  chapters,
  title,
  author,
  coverUrl,
  onContinue,
  onRequestFallback,
  onBack,
  onSelectChapter,
  streamedRecap,
  recapFailed,
  recapStreaming,
  characterNames,
  notes = [],
  onOpenCommunity,
  lastReadAt = null,
  introduction = null,
  background = null,
}: {
  briefing: BriefingResponse;
  /** GET /info 목차 — 전체 상시 노출 (FR-NAV-001) */
  chapters: ChapterSummary[];
  title: string;
  author: string;
  coverUrl: string | null;
  onContinue: () => void;
  onRequestFallback: () => void;
  onBack: () => void;
  /** 장을 고르면 그 장의 start_page 로 읽기 화면을 연다 — 서버가 준 값을 그대로 넘긴다 */
  onSelectChapter: (startPage: number) => void;
  streamedRecap: string;
  recapFailed: boolean;
  recapStreaming: boolean;
  characterNames: string[];
  notes?: ReadingNote[];
  onOpenCommunity?: () => void;
  /** 서버의 마지막 읽은 시각(GET /briefing last_read_at). 없으면 경과 안내를 그리지 않는다 */
  lastReadAt?: string | null;
  /** 서버가 준 작품 소개(GET /info introduction, 상한 예외 R5). 없으면 그 칸을 그리지 않는다 */
  introduction?: string | null;
  /** 서버가 준 배경지식(GET /info background, 상한 예외 R5). 없으면 그 칸을 그리지 않는다 */
  background?: string | null;
}) {
  const view = resolveBriefingView(briefing);
  const firstVisit = view.kind === 'empty';
  const requested = useRef(false);
  const [tocOpen, setTocOpen] = useState(false);

  // D13 NFR-AI-017
  useEffect(() => {
    if (view.kind !== 'fallback' || requested.current) return;
    requested.current = true;
    onRequestFallback();
  }, [view.kind, onRequestFallback]);

  const recapText = view.kind === 'recap' ? (briefing.recap ?? '') : streamedRecap;
  const sinceLabel = firstVisit ? null : formatSinceLastRead(lastReadAt);
  const greeting = firstVisit ? FIRST_VISIT_GREETING_LINES : GREETING_LINES;
  const intro = introduction?.trim() ? introduction.trim() : null;
  const backgroundText = background?.trim() ? background.trim() : null;

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
            {sinceLabel ? (
              <p data-testid="since-last-read" className="m-0 mb-2 text-sm font-bold text-brief-muted">
                {sinceLabel}
              </p>
            ) : null}
            <h2 className="m-0 break-keep font-dashSerif text-[22px] font-semibold leading-[1.35] tracking-[-.03em] text-brief-ink">
              {greeting.map((line) => (
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
            className="mt-6 flex min-h-12 w-full items-center justify-between rounded-brief-panel border border-[#c4475f] bg-[#1e1618] px-5 text-left text-[15px] font-bold text-[#e58a9b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4475f]"
          >
            <span>커뮤니티</span>
            <span className="text-[13px] font-normal text-[#a89e9a]">다른 독자들과 이야기하기</span>
          </button>
        ) : null}

        {firstVisit ? (
          <>
            {intro ? (
              <section aria-label="작품 소개" className="mt-6">
                <h3 className="mb-3 font-dashSerif text-lg font-semibold tracking-[-.02em] text-brief-ink">
                  작품 소개
                </h3>
                <div className="rounded-brief-panel bg-brief-card p-5 shadow-brief-soft-sm">
                  <p className="m-0 whitespace-pre-wrap break-keep font-dashSerif text-[15px] leading-[1.85]">
                    {intro}
                  </p>
                </div>
              </section>
            ) : null}

            {/* FR-BGK-002 🚦 R5 — 배경지식은 1쪽 시점에도 안전한 고정 콘텐츠 (2026-11-17 대표 결정) */}
            {backgroundText ? (
              <section aria-label="배경지식" className="mt-6">
                <h3 className="mb-3 font-dashSerif text-lg font-semibold tracking-[-.02em] text-brief-ink">
                  배경지식
                </h3>
                <div className="rounded-brief-panel bg-brief-card p-5 shadow-brief-soft-sm">
                  <p className="m-0 whitespace-pre-wrap break-keep font-dashSerif text-[15px] leading-[1.85]">
                    {backgroundText}
                  </p>
                </div>
              </section>
            ) : null}

            {RULE}

            <section aria-label="싸비 사용법">
              <h3 className="mb-3 font-dashSerif text-lg font-semibold tracking-[-.02em] text-brief-ink">
                싸비는 이렇게 도와요
              </h3>
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {SSABI_GUIDE_STEPS.map((step, i) => (
                  <li
                    key={step.title}
                    className="flex items-start gap-3 rounded-brief-card bg-brief-card p-4 shadow-brief-soft-sm"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-brief-accent-soft font-dashMono text-xs font-semibold text-brief-accent"
                    >
                      {i + 1}
                    </span>
                    <b className="min-w-0 flex-1 break-keep text-[15px] font-bold text-brief-ink">{step.title}</b>
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : (
          <>
            <section aria-label="진도" className="mt-6 rounded-brief-panel bg-brief-card p-5 shadow-brief-soft-sm">
              <div className="mb-6 flex items-start justify-between gap-3 text-sm">
                {/* 백엔드는 title 에 장 번호를 섞지 않는다 — chapter_no 로 접두어를 만든다 (BriefingView.tsx) */}
                <b className="min-w-0 break-keep font-semibold text-brief-ink">
                  제{briefing.current_chapter.chapter_no}장 {briefing.current_chapter.title}
                </b>
                <span className="shrink-0 font-semibold text-brief-muted">{briefing.progress.total_pages}쪽</span>
              </div>
              {/* FR-BRF-005 🚦: percent 는 서버 계산값 그대로 — 표시만 반올림한다 */}
              <ProgressBar percent={briefing.progress.percent} tone="night" size="md" runner />
              <div className="mt-6 text-sm font-semibold text-brief-muted">{formatPercent(briefing.progress.percent)}</div>
            </section>

            {RULE}

            <h3 className="mb-3 font-dashSerif text-lg font-semibold tracking-[-.02em] text-brief-ink">
              그동안 이런 이야기였어요
            </h3>
            <div className="rounded-brief-panel bg-brief-card p-5 shadow-brief-soft-sm">
              {view.kind === 'fallback' && recapFailed ? (
                <p role="alert" className="m-0 font-dashSerif text-[15px] leading-[1.85]">
                  리캡을 불러오지 못했습니다
                </p>
              ) : (
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
              )}
            </div>

            {RULE}

            <BriefingNotes notes={notes} />
          </>
        )}

        {RULE}

        <button
          type="button"
          aria-expanded={tocOpen}
          aria-controls="mobileTocPanel"
          onClick={() => setTocOpen((open) => !open)}
          className="flex min-h-12 w-full items-center justify-between rounded-lg"
        >
          <h3 className="m-0 font-dashSerif text-lg font-semibold tracking-[-.02em] text-brief-ink">목차</h3>
          <span className="flex size-9 items-center justify-center rounded-full bg-brief-card shadow-brief-soft-sm">
            <span
              aria-hidden="true"
              className={`block text-[17px] leading-none transition-transform duration-200 ${tocOpen ? 'rotate-180' : ''}`}
            >
              ▾
            </span>
          </span>
        </button>

        {/* 접힘은 grid-rows 0fr↔1fr 로 — 장 수와 무관하게 마지막 항목이 잘리지 않는다 (BriefingView.tsx) */}
        <div
          id="mobileTocPanel"
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            tocOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            <ul aria-label="목차" className="flex flex-col gap-2 pt-3">
              {chapters.map((chapter) => {
                // 지금 장은 서버가 준 current_chapter 로만 표시한다. 첫 방문에는 표시하지 않는다
                const isNow = !firstVisit && chapter.chapter_no === briefing.current_chapter.chapter_no;
                return (
                  <li key={chapter.chapter_no}>
                    <button
                      type="button"
                      aria-current={isNow ? 'true' : undefined}
                      tabIndex={tocOpen ? 0 : -1}
                      onClick={() => onSelectChapter(chapter.start_page)}
                      className={`group flex min-h-12 w-full items-center gap-3 rounded-brief-card px-4 py-2.5 text-left shadow-brief-soft-sm transition-[background-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brief-accent/40 focus-visible:ring-offset-2 ${
                        isNow ? 'bg-brief-accent-soft' : 'bg-brief-card hover:translate-x-0.5 hover:bg-brief-accent/10'
                      }`}
                    >
                      <span
                        className={`flex size-[26px] shrink-0 items-center justify-center rounded-full font-dashMono text-xs font-semibold ${
                          isNow
                            ? 'bg-brief-accent text-brief-on-accent'
                            : 'bg-brief-paper text-brief-muted transition-colors group-hover:text-brief-accent'
                        }`}
                      >
                        {chapter.chapter_no}
                      </span>
                      <span
                        className={`min-w-0 flex-1 break-keep text-[15px] ${
                          isNow ? 'font-semibold text-brief-accent' : 'text-brief-ink transition-colors group-hover:text-brief-accent'
                        }`}
                      >
                        {chapter.title}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
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
          {firstVisit ? '읽기 시작' : '이어서 읽기'}
        </button>
      </div>
    </div>
  );
}
