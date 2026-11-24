import type { ReviewCard } from '../../types';
import { countsLine, earlyLine, KIND_LABEL, VERDICT_LABEL, VERDICT_TONE } from './verdict';

/**
 * 커뮤니티 글에 붙은 추리 결과지 (대표 결정 2026-11-24, 9·10번).
 * 공유한 시점의 복사본을 그린다. 진상 요약은 카드에 없다. 판정·칭호는 서버가 정한 값이다.
 */
export default function ReviewCardView({ card }: { card: ReviewCard }) {
  const early = earlyLine(card.early_pages, card.timing_verified);
  return (
    <section
      aria-label="추리 결과지"
      data-testid="review-card"
      data-no-track
      className="mt-2 rounded-[14px] border border-[#35292c] bg-[#160f11] px-3.5 py-3"
    >
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold text-[#e58a9b]">추리 결과지</span>
        <span className="rounded-full border border-[#c4475f] px-2 text-[13px] font-extrabold leading-[1.7] text-[#ece6e0]">
          {card.title}
        </span>
      </div>
      <p className="m-0 mt-1.5 text-[14px] font-bold text-[#ece6e0]">{countsLine(card.counts)}</p>
      {early ? <p className="m-0 mt-0.5 text-[13px] text-[#b5aaa6]">{early}</p> : null}
      {card.notes.length > 0 ? (
        <ul className="m-0 mt-2.5 grid list-none gap-2 p-0">
          {card.notes.map((note, i) => (
            <li key={i} className="rounded-[10px] bg-[#1e1618] px-3 py-2">
              <div className="flex items-center gap-2 text-[12px] text-[#b5aaa6]">
                <span
                  className={`rounded-full border px-1.5 font-extrabold leading-[1.6] ${VERDICT_TONE[note.verdict]}`}
                >
                  {VERDICT_LABEL[note.verdict]}
                </span>
                <span>
                  {KIND_LABEL[note.kind]} · {note.page_no}쪽에서
                </span>
              </div>
              <p className="m-0 mt-1 whitespace-pre-wrap break-words text-[14px] leading-[1.5] text-[#ece6e0]">
                {note.body}
              </p>
              {note.explanation ? (
                <p className="m-0 mt-0.5 break-keep text-[13px] leading-[1.5] text-[#b5aaa6]">
                  {note.explanation}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
