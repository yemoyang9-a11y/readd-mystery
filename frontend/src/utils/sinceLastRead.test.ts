import { formatSinceLastRead } from './sinceLastRead';

// 2026-11-17 대표 결정 — 브리핑 경과 안내는 서버의 마지막 읽은 시각(GET /books progress.last_read_at)으로만 만든다
const now = new Date(2026, 10, 17, 21, 0, 0);

test('마지막 읽은 시각이 없으면 경과 안내를 만들지 않는다 — 고정 문구로 채우지 않는다', () => {
  expect(formatSinceLastRead(null, now)).toBeNull();
  expect(formatSinceLastRead(undefined, now)).toBeNull();
  expect(formatSinceLastRead('', now)).toBeNull();
  expect(formatSinceLastRead('날짜 아님', now)).toBeNull();
});

test('같은 날 읽었으면 오늘 읽으셨네요', () => {
  expect(formatSinceLastRead(new Date(2026, 10, 17, 0, 5).toISOString(), now)).toBe('오늘 읽으셨네요');
});

test('날짜가 바뀐 만큼 N일 만이에요 — 24시간이 안 지났어도 달력 날짜로 센다', () => {
  expect(formatSinceLastRead(new Date(2026, 10, 16, 23, 50).toISOString(), now)).toBe('1일 만이에요');
  expect(formatSinceLastRead(new Date(2026, 10, 14, 9, 0).toISOString(), now)).toBe('3일 만이에요');
  expect(formatSinceLastRead(new Date(2026, 9, 18, 9, 0).toISOString(), now)).toBe('30일 만이에요');
});

test('기기 시계가 서버보다 늦어 미래 날짜가 되면 안내를 숨긴다', () => {
  expect(formatSinceLastRead(new Date(2026, 10, 19, 9, 0).toISOString(), now)).toBeNull();
});
