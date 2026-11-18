import { useState } from 'react';
import type { TimelineResponse } from '../../types';

const NATIVE_COUNTS = ['한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];

/** 시안 "지금까지, 네 장면이에요" 말투 — 열까지는 고유어 수, 그 뒤는 숫자 + 개 */
function chapterCount(count: number): string {
  return count >= 1 && count <= NATIVE_COUNTS.length ? `${NATIVE_COUNTS[count - 1]} 장` : `${count}개 장`;
}

/**
 * 타임라인 탭 — 2026-11-18 대표 승인 시안 A안 "타임라인 안에 사건을 함께"
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
          return (
            <li key={chapter.chapter_no} className="relative mb-3.5">
              <span
                aria-hidden="true"
                className="absolute -left-6 top-1 size-[9px] rounded-full border-[1.5px] border-brief-muted bg-brief-paper"
              />
              <span className="text-[11px] font-semibold leading-none tracking-[0.02em] text-brief-muted">
                {chapter.chapter_no}장
              </span>
              <b className="mb-0.5 mt-[3px] block text-[13.5px] font-bold leading-[1.4]">{chapter.title}</b>
              {chapter.summary ? (
                <p className="m-0 text-[12.5px] leading-relaxed text-brief-ink">{chapter.summary}</p>
              ) : null}
              {events.length > 0 ? (
                <div
                  data-chapter-events
                  className="mt-[7px] rounded-[10px] border border-brief-rule bg-white px-2.5 py-2"
                >
                  <div className="pb-1 text-[11px] font-semibold leading-none text-brief-accent">이 장의 사건</div>
                  {events.map((event) => {
                    const row = (
                      <>
                        <span className={openIds.has(event.id) ? 'font-semibold text-brief-accent' : undefined}>
                          {event.event}
                        </span>
                        <span className="shrink-0 text-brief-muted">{event.occurrence_page}쪽</span>
                      </>
                    );
                    const rowClass =
                      'flex w-full justify-between gap-2 border-t border-brief-rule/60 text-left text-xs leading-normal';
                    // 독자용 설명이 없으면 펼칠 것이 없다 — 지어내지 않고 이름과 쪽만 둔다
                    if (!event.description) {
                      return (
                        <div key={event.id} className={`${rowClass} py-1.5`}>
                          {row}
                        </div>
                      );
                    }
                    const open = openIds.has(event.id);
                    return (
                      <div key={event.id}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => toggle(event.id)}
                          className={`${rowClass} min-h-11 items-center py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brief-accent`}
                        >
                          {row}
                        </button>
                        {open ? (
                          <p
                            data-event-description
                            className="m-0 mb-1.5 text-xs leading-[1.55] text-brief-muted"
                          >
                            {event.description}
                          </p>
                        ) : null}
                      </div>
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
