import { useState } from 'react';
import type { TimelineResponse } from '../../types';

/**
 * 사건 정리 — 추리 노트 탭 안의 두 번째 보기 (2026-11-17 사용자 선택 A안).
 *
 * 응답은 서버가 기준점 K 이하로 이미 걸러 보낸 것이다. 여기서 K를 계산하거나 초과 여부를
 * 판별하지 않는다 (FR-SPL-002 🚦, 절대 규칙 7번). 조회가 실패하면 아무 데이터도 보이지 않는다
 * (FR-SPL-005 🚦). 사건은 장 범위(서버가 준 start/end)에 들어가는 쪽에 묶어 보여 줄 뿐이고,
 * 쪽수는 화면에 내지 않는다. 서버는 다 읽은 장의 사건만 보내므로(결정 31) 지금 읽는 장은 제목만
 * 오고, 그 장에 사건이 없으면 안내 한 줄만 둔다. 마지막 장을 이미 다 읽었으면(서버가 준
 * completed) 안내를 내지 않는다 — 다 읽었는지는 쪽수로 다시 따지지 않는다 (2026-11-17 대표 결정).
 */
export default function EventSummary({
  timeline,
  failed,
}: {
  timeline: TimelineResponse | null;
  failed: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (failed) {
    return (
      <p role="alert" className="m-0 text-sm text-brief-muted">
        사건 정리를 불러오지 못했어요
      </p>
    );
  }
  if (!timeline) {
    return <p className="m-0 text-sm text-brief-muted">불러오는 중이에요</p>;
  }
  if (timeline.chapters.length === 0 && timeline.events.length === 0) {
    return <p className="m-0 text-sm text-brief-muted">아직 정리된 장면이 없어요</p>;
  }

  const lastIndex = timeline.chapters.length - 1;

  return (
    <div className="font-dashSans text-brief-ink">
      <h3 className="m-0 mb-4 font-dashSerif text-base font-extrabold">
        지금까지, {timeline.chapters.length}개 장면이에요
      </h3>
      <ol data-no-track className="m-0 list-none p-0">
        {timeline.chapters.map((chapter, index) => {
          const events = timeline.events.filter(
            (event) =>
              event.occurrence_page >= chapter.start_page &&
              event.occurrence_page <= chapter.end_page
          );
          const isLast = index === lastIndex;
          return (
            <li
              key={chapter.chapter_no}
              className="relative border-l border-brief-rule pb-5 pl-5 last:border-l-transparent last:pb-0"
            >
              <span
                aria-hidden="true"
                className={`absolute -left-[5px] top-1.5 size-2.5 rounded-full ${
                  isLast ? 'bg-brief-accent' : 'bg-brief-muted'
                }`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-extrabold">{chapter.title}</span>
                {isLast ? (
                  <span className="rounded-full bg-brief-accent-soft px-2 py-0.5 text-[11px] font-bold text-brief-accent">
                    지금 읽는 곳
                  </span>
                ) : null}
              </div>
              {isLast && !chapter.completed && events.length === 0 ? (
                <p className="m-0 mt-2 px-2 text-[13px] text-brief-muted">
                  이 장을 다 읽으면 사건이 정리돼요
                </p>
              ) : null}
              <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                {events.map((event) => {
                  const open = openId === event.id;
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : event.id)}
                        className="min-h-11 w-full rounded-brief-card px-2 text-left text-[14px] text-brief-ink hover:bg-[rgba(31,31,31,0.04)]"
                      >
                        {event.event}
                      </button>
                      {open && event.description ? (
                        <p
                          data-event-description
                          className="m-0 mb-1 px-2 text-[14px] leading-relaxed text-brief-muted"
                        >
                          {event.description}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
