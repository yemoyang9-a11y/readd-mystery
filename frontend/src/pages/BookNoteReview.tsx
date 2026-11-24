import { useParams } from 'react-router';
import { NoteReviewScreen } from '../mobile/pages/MobileNoteReview';

/**
 * PC 내 추리 채점 (대표 결정 2026-11-24) — 휴대폰과 같은 본체를 위 줄 메뉴 아래 가운데 단에 그린다.
 * 열림·잠김은 본체가 서버 응답(REVIEW_LOCKED)으로만 따른다 (FR-BRF-005 🚦, FR-QNA-004 🚦).
 */
export default function BookNoteReview() {
  const { bookId = '' } = useParams();
  return (
    <div className="mx-auto w-full max-w-[560px] pt-3">
      <NoteReviewScreen key={bookId} bookId={bookId} desktop />
    </div>
  );
}
