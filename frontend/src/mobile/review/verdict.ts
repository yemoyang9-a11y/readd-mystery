import type { ReviewCounts, ReviewVerdict } from '../../types';

/** 판정 이름과 색 — 서버가 준 판정 값을 그리기만 한다 (대표 결정 2026-11-24, 4번: 세 단계) */
export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  hit: '적중',
  partial: '부분 적중',
  miss: '빗나감',
  key: '핵심 단서',
  related: '관련 있음',
  unrelated: '관련 없음',
  pending: '판정 보류',
};

export const VERDICT_TONE: Record<ReviewVerdict, string> = {
  hit: 'border-[#7fc29b] text-[#9fd8b5]',
  key: 'border-[#7fc29b] text-[#9fd8b5]',
  partial: 'border-[#d9ad5f] text-[#e8c88a]',
  related: 'border-[#d9ad5f] text-[#e8c88a]',
  miss: 'border-[#5a4c4f] text-[#b5aaa6]',
  unrelated: 'border-[#5a4c4f] text-[#b5aaa6]',
  pending: 'border-dashed border-[#5a4c4f] text-[#b5aaa6]',
};

export const KIND_LABEL = { hypothesis: '가설', clue: '단서' } as const;

/** "가설 3개 중 1개 적중 · 단서 2개 중 1개 핵심" — 판정 보류는 서버가 이미 개수에서 뺐다 */
export function countsLine(counts: ReviewCounts): string {
  const parts: string[] = [];
  if (counts.hypothesis.total > 0) {
    parts.push(`가설 ${counts.hypothesis.total}개 중 ${counts.hypothesis.hit}개 적중`);
  }
  if (counts.clue.total > 0) parts.push(`단서 ${counts.clue.total}개 중 ${counts.clue.key}개 핵심`);
  return parts.join(' · ');
}

export function earlyLine(earlyPages: number | null, timingVerified: boolean): string | null {
  if (!timingVerified) return '결말 전 기록 여부 확인 안 됨';
  if (earlyPages === null) return null;
  return `진상이 밝혀지기 ${earlyPages}쪽 전에 맞혔어요`;
}
