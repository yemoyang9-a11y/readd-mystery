import { useState } from 'react';
import type { TimelineResponse } from '../../types';

const NATIVE_COUNTS = ['한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];

/** 시안 "지금까지, 네 장면이에요" 말투 — 열까지는 고유어 수, 그 뒤는 숫자 + 개 */
function chapterCount(count: number): string {
  return count >= 1 && count <= NATIVE_COUNTS.length ? `${NATIVE_COUNTS[count - 1]} 장` : `${count}개 장`;
}

/**
 * 핵심 한 줄의 대체값 — 서버가 준 장 요약의 첫 문장. 요약 전체(4~5문장)는 길어서 접는다(2026-11-18 대표 지시).
 * 서버가 이미 기준점으로 거른 문장을 자르기만 한다. 장마다 따로 만든 핵심 문장(key_point)이 있으면 그것을 쓴다.
 */
export function firstSentence(summary: string | null): string | null {
  if (!summary) return null;
  const match = /^.+?[.?!。](?=\s|$)/su.exec(summary.trim());
  return (match ? match[0] : summary).trim();
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 text-brief-muted transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * 타임라인 탭 — 2026-11-18 대표 승인 시안 2차 A안: 장을 누르면 그 장의 사건 카드가 펼쳐지고, 사건 카드를
 * 누르면 그 자리에서 상세가 펼쳐진다. 쪽수는 p.N 표기. 장에는 핵심 한 줄만 둔다.
 * 이전: 승인 시안 A안 "타임라인 안에 사건을 함께"
 * (`scratchpad/eventpage/event-placement.html`, 결정 31).
 *
 * 세로 시간 축에 다 읽은 장마다 "N장" · 장 제목 · 간략 요약 · "이 장의 사건"(사건 이름 + 쪽)을 둔다.
 * 사건을 누르면 그 자리에서 칸이 아래로 늘어나며 짧은 설명이 나오고, 다시 누르면 접힌다(aria-expanded).
 * 읽는 중인 장은 "지금 읽는 곳 · N장"과 "다 읽으면 정리돼요"만 있다.
 *
 * 응답은 서버가 기준점 K로 이미 걸러 보낸 것이다 — 요약·사건은 다 읽은 장(end_page <= K)에만 오고,
 * 다 읽었는지(completed)도 서버가 정한 값이다. 여기서 K를 계산하거나 초과 여부를 판별하지 않는다
 * (FR-SPL-002 🚦, FR-BRF-005 🚦, 절대 규칙 7번). 사건은 서버가 준 장 범위로 묶기만 한다.
 * 조회가 실패하면 아무 데이터도 보이지 않는다 (FR-SPL-005 🚦).
 * 사건 설명은 검증을 통과한 독자용 문장(reader_description)뿐이다. 없으면 그 사건은 펼치지 않는다.
 */
export default function TimelineTab({
  timeline,
  failed,
}: {
  timeline: TimelineResponse | null;
  failed: boolean;
}) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());

  if (failed) {
    return (
      <p role="alert" className="m-0 px-1 py-8 text-center text-[13px] text-brief-muted">
        타임라인을 불러오지 못했어요
      </p>
    );
  }
  if (!timeline) {
    return <p className="m-0 px-1 py-8 text-center text-[13px] text-brief-muted">불러오는 중이에요</p>;
  }
  if (timeline.chapters.length === 0) {
    return <p className="m-0 px-1 py-8 text-center text-[13px] text-brief-muted">아직 정리된 장이 없어요</p>;
  }

  function toggle(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="font-dashSans text-brief-ink">
      <h3 className="m-0 mb-3 mt-0.5 text-base font-bold leading-snug">
        지금까지, {chapterCount(timeline.chapters.length)}이에요
      </h3>
      <ol data-no-track className="m-0 list-none border-l-[1.5px] border-brief-rule py-0 pl-[18px] pr-0">
        {timeline.chapters.map((chapter) => {
          if (!chapter.completed) {
            return (
              <li key={chapter.chapter_no} data-timeline-now className="relative mb-3.5">
                <span
                  aria-hidden="true"
                  className="absolute -left-6 top-1 size-[9px] rounded-full border-[1.5px] border-brief-accent bg-brief-accent"
                />
                <span className="text-[10.5px] font-semibold leading-none text-brief-accent">
                  지금 읽는 곳 · {chapter.chapter_no}장
                </span>
                <b className="mb-0.5 mt-[3px] block text-[13.5px] font-bold leading-[1.4]">다 읽으면 정리돼요</b>
              </li>
            );
          }
          const events = timeline.events.filter(
            (event) =>
              event.occurrence_page >= chapter.start_page && event.occurrence_page <= chapter.end_page
          );
          const chapterKey = `ch-${chapter.chapter_no}`;
          const chapterOpen = openIds.has(chapterKey);
          // 결정 31 — 서버가 다 읽은 장에만 실어 준 핵심 한 줄. 없으면 요약 첫 문장 (FR-SPL-003 🚦)
          const keyLine = chapter.key_point ?? firstSentence(chapter.summary);
          return (
            <li key={chapter.chapter_no} className="relative mb-4">
              <span
                aria-hidden="true"
                className="absolute -left-6 top-1 size-[9px] rounded-full border-[1.5px] border-brief-muted bg-brief-paper"
              />
              <button
                type="button"
                aria-expanded={chapterOpen}
                onClick={() => toggle(chapterKey)}
                className="block w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-accent"
              >
                <span className="block text-[11px] font-semibold leading-none tracking-[0.02em] text-brief-muted">
                  {chapter.chapter_no}장 · p.{chapter.start_page}–{chapter.end_page}
                </span>
                <span className="mb-1 mt-[3px] flex items-center gap-2">
                  <b className="min-w-0 flex-1 text-[13.5px] font-bold leading-[1.4]">{chapter.title}</b>
                  {events.length > 0 ? (
                    <span className="shrink-0 text-[11px] font-semibold text-brief-accent">사건 {events.length}</span>
                  ) : null}
                  <Chevron open={chapterOpen} />
                </span>
                {keyLine ? <span className="block text-[12.5px] leading-relaxed text-brief-ink">{keyLine}</span> : null}
              </button>
              {chapterOpen && events.length > 0 ? (
                <div data-chapter-events className="mt-2 flex flex-col gap-1.5">
                  {events.map((event) => {
                    const cardClass =
                      'block w-full rounded-[10px] border bg-white px-3 py-2.5 text-left text-xs leading-normal shadow-brief-soft-sm';
                    const row = (open: boolean, expandable: boolean) => (
                      <span className="flex items-baseline gap-2">
                        <span className={`min-w-0 flex-1 ${open ? 'font-semibold text-brief-accent' : ''}`}>
                          {event.event}
                        </span>
                        <span className="shrink-0 tabular-nums text-brief-muted">p.{event.occurrence_page}</span>
                        {expandable ? <Chevron open={open} /> : null}
                      </span>
                    );
                    // 독자용 설명이 없으면 펼칠 것이 없다 — 지어내지 않고 이름과 쪽만 둔다
                    if (!event.description) {
                      return (
                        <div key={event.id} className={`${cardClass} border-brief-rule`}>
                          {row(false, false)}
                        </div>
                      );
                    }
                    const open = openIds.has(event.id);
                    return (
                      <button
                        key={event.id}
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggle(event.id)}
                        className={`${cardClass} min-h-11 ${open ? 'border-brief-accent' : 'border-brief-rule'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brief-accent`}
                      >
                        {row(open, true)}
                        {open ? (
                          <span
                            data-event-description
                            className="mt-2 block border-t border-brief-rule/60 pt-2 text-[12.5px] leading-[1.6] text-brief-ink"
                          >
                            {event.description}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
