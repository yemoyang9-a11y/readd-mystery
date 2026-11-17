/**
 * 브리핑 경과 안내 — "N일 만이에요" / "오늘 읽으셨네요" (2026-11-17 대표 결정)
 *
 * 원천은 서버의 마지막 읽은 시각 하나다(GET /briefing 의 last_read_at =
 * reading_position.updated_at, 페이지 이동이 받아들여질 때만 바뀐다). 값이 없거나
 * 읽을 수 없으면 null 을 돌려주고 화면은 그 줄을 그리지 않는다 — 고정 문구로 채우지 않는다.
 *
 * 날짜 차이는 기준점·진도 파생값(cutoff·percent·is_complete·chapter)이 아니라서
 * 프론트에서 계산한다(FR-BRF-005 🚦 대상 아님).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatSinceLastRead(
  lastReadAt: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!lastReadAt) return null;
  const last = new Date(lastReadAt);
  if (Number.isNaN(last.getTime())) return null;
  // 서머타임이 있는 지역에서는 하루가 23·25시간일 수 있어 반올림한다
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(last)) / DAY_MS);
  if (days < 0) return null;
  if (days === 0) return '오늘 읽으셨네요';
  return `${days}일 만이에요`;
}
