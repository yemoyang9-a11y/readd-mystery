import { relativeTime } from './communityFormat';

const NOW = new Date('2026-11-16T12:00:00Z').getTime();

test('상대 시간: 방금 · 분 · 시간 · 일 · 날짜 순으로 표기한다', () => {
  expect(relativeTime('2026-11-16T11:59:40Z', NOW)).toBe('방금');
  expect(relativeTime('2026-11-16T11:50:00Z', NOW)).toBe('10분 전');
  expect(relativeTime('2026-11-16T09:00:00Z', NOW)).toBe('3시간 전');
  expect(relativeTime('2026-11-14T12:00:00Z', NOW)).toBe('2일 전');
  expect(relativeTime('2026-10-01T12:00:00Z', NOW)).toMatch(/^\d+월 \d+일$/);
});
