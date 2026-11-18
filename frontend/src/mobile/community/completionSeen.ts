/**
 * 완독 화면을 이미 본 책 — 독자 기기별 편의 기록(localStorage). 완독 여부가 아니다.
 *
 * 완독 화면을 띄울지는 서버의 is_complete 가 먼저 정한다(FR-BRF-005 🚦). 이 기록은
 * "한 번 닫은 화면을 다시 자동으로 띄우지 않는다"만 정한다. 저장소를 못 쓰면(사생활 보호 창 등)
 * 본 적 없는 것으로 다룬다 — 화면이 한 번 더 뜰 뿐 스포일러와 무관하다.
 */
const PREFIX = 'readd.completion-seen:';

export function hasSeenCompletion(bookId: string): boolean {
  try {
    return localStorage.getItem(PREFIX + bookId) === '1';
  } catch {
    return false;
  }
}

export function markCompletionSeen(bookId: string): void {
  try {
    localStorage.setItem(PREFIX + bookId, '1');
  } catch {
    // 기록 실패는 무시한다 — 다음에 한 번 더 뜰 뿐이다
  }
}
