import { useParams } from 'react-router';
import { CommunityScreen } from '../mobile/pages/MobileCommunity';

/**
 * PC 책 이야기방 (E2E #86) — 휴대폰 이야기방과 같은 본체를 위 줄 메뉴 아래 가운데 단에 그린다.
 * 완독 게이트는 본체가 서버 응답(COMMUNITY_LOCKED)으로만 따른다 (FR-BRF-005 🚦, FR-SPL-005 🚦).
 */
// COMMUNITY
export default function BookCommunity() {
  const { bookId = '' } = useParams();
  return (
    // 커뮤니티 허브(MobileCommunityHub)와 같은 560px 단 — 위 줄 메뉴에서 오가도 왼쪽 끝이 맞는다
    <div className="mx-auto w-full max-w-[560px] pt-3">
      <CommunityScreen key={bookId} bookId={bookId} desktop />
    </div>
  );
}
