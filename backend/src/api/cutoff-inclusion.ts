/**
 * 현재 페이지가 기준점(K) 안에 들어오는지 판정한다.
 *
 * K는 1쪽부터 차례로 읽었다고 인정된 마지막 쪽이고, 진도 레코드가 없으면 0이다
 * (cutoff.service.ts — 유일한 계산 지점, 2026-11-17). 목차로 K보다 뒤 쪽에 가 있으면
 * 이 판정이 거짓이 되어, 챗봇이 그 쪽 본문을 근거로 얹지 않는다.
 */
export function pageIsIncludedInCutoff(page: number, cutoff: number): boolean {
  return page <= cutoff;
}
