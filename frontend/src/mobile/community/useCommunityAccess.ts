import { useEffect, useState } from 'react';
import { fetchPosition } from '../../services/positionService';

/**
 * 읽기 화면 마지막 쪽에서 커뮤니티 진입을 열지 정한다.
 *
 * 완독 여부는 서버의 기준점 결정기가 준 `is_complete` 만 쓴다. "마지막 쪽을 펼쳤다"는
 * 완독이 아니다 — 목차로 건너뛴 독자도 마지막 쪽을 펼칠 수 있다 (2026-11-17 차례로 읽은 쪽).
 * 프론트는 완독을 계산하지 않는다 (절대 규칙 2번, FR-BRF-005 🚦).
 *
 *   unknown — 묻지 않았거나 답을 못 받았다. 진입도 안내도 그리지 않는다 (FR-SPL-005 🚦)
 *   locked  — 서버가 완독이 아니라고 답했다. 글 수·제목 없는 한 줄 안내만 그린다
 *   open    — 서버가 완독이라고 답했다
 */
export type CommunityAccess = 'unknown' | 'open' | 'locked';

/**
 * 마지막 쪽의 진도 이벤트는 응답을 기다리지 않고 나간다(NFR-PERF-005). 그 이벤트가 서버에
 * 닿기 전에 물으면 방금 완독한 독자도 "아직"으로 나오므로, 정해진 횟수만 다시 묻는다.
 */
export const COMMUNITY_ACCESS_RETRY_MS = [1500, 4000] as const;

export function useCommunityAccess(
  bookId: string,
  onLastPage: boolean,
  /** 바뀌면 다시 묻는다 — 확인 카드 답처럼 기준점이 움직였을 수 있는 신호 */
  refreshKey: unknown
): CommunityAccess {
  const [answer, setAnswer] = useState<{ bookId: string; access: CommunityAccess } | null>(null);

  useEffect(() => {
    if (!onLastPage) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const ask = (attempt: number) => {
      fetchPosition(bookId)
        .then((position) => {
          if (!active) return;
          // FR-BRF-005 🚦 — 서버 값 그대로. true 가 아니면 열지 않는다
          if (position.is_complete === true) {
            setAnswer({ bookId, access: 'open' });
            return;
          }
          setAnswer({ bookId, access: 'locked' });
          const delay = COMMUNITY_ACCESS_RETRY_MS[attempt];
          if (delay !== undefined) timer = setTimeout(() => ask(attempt + 1), delay);
        })
        .catch(() => {
          // FR-SPL-005 🚦 — 실패 = 미노출
          if (active) setAnswer({ bookId, access: 'unknown' });
        });
    };
    ask(0);

    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [bookId, onLastPage, refreshKey]);

  return onLastPage && answer?.bookId === bookId ? answer.access : 'unknown';
}
