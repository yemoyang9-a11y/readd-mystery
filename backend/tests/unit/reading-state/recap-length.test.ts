/**
 * 리캡 분량 제어(C안) — 목표 문장 수 계산 · 출력 문장 수 세기 (순수 함수)
 *
 * 근거: 2026-11-17 대표 승인 C안 — 목표 문장 수 N을 코드가 정한다.
 *      N = clamp(다 읽은 장 수 + (읽는 중인 장 원문 있음 ? 1 : 0), 2, 5)
 *
 * 테스트 규약에 따라 구현 전에 작성했다.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  RECAP_MAX_TARGET_SENTENCES,
  RECAP_MIN_TARGET_SENTENCES,
  computeRecapTargetSentences,
  countRecapSentences,
} from '../../../src/modules/reading-state/recap-length';

describe('리캡 목표 문장 수 N — computeRecapTargetSentences', () => {
  test.each([
    // [다 읽은 장 수, 읽는 중인 장 원문 있음, 기대 N]
    [0, true, 2], // 첫 장 읽는 중 — 하한 2
    [1, true, 2], // 1장 + 원문 = 2
    [2, true, 3],
    [3, true, 4],
    [4, true, 5],
    [10, true, 5], // 상한 5
    [10, false, 5], // 상한 5 (장 끝 쪽)
    [1, false, 2], // 장 끝 쪽(원문 없음) — 1장만 완결 → 하한 2
    [2, false, 2], // 장 끝 쪽 — 2장 완결
    [3, false, 3], // 장 끝 쪽 — 3장 완결
    [5, false, 5],
    [6, false, 5],
    [0, false, 2], // 조립상 오지 않는 조합이지만 하한은 지킨다
  ])('완결 %i장 + 원문 %s → N=%i', (completed, hasCurrent, expected) => {
    expect(computeRecapTargetSentences(completed, hasCurrent)).toBe(expected);
  });

  test('N은 항상 [2, 5] 범위다', () => {
    expect(RECAP_MIN_TARGET_SENTENCES).toBe(2);
    expect(RECAP_MAX_TARGET_SENTENCES).toBe(5);
    for (let c = 0; c <= 50; c++) {
      for (const h of [true, false]) {
        const n = computeRecapTargetSentences(c, h);
        expect(n).toBeGreaterThanOrEqual(2);
        expect(n).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('리캡 출력 문장 수 — countRecapSentences (로그용)', () => {
  test('소제목 줄은 문장으로 세지 않는다', () => {
    const text = '이전 이야기 요약\n\n첫 문장이다. 둘째 문장이다.\n\n셋째 문장이다.';
    expect(countRecapSentences(text)).toBe(3);
  });

  test('따옴표로 끝나는 문장·물음표·느낌표를 문장 끝으로 센다', () => {
    const text = '이전 이야기 요약\n\n그는 "누가 범인이지?"라고 물었다. 아무도 답하지 않았다! 정말일까?';
    expect(countRecapSentences(text)).toBe(3);
  });

  test('문장 부호 없이 끝나는 줄(잘린 문장 등)도 한 문장으로 센다', () => {
    const text = '이전 이야기 요약\n\n첫 문장이다.\n\n마침표 없이 끝난 문단';
    expect(countRecapSentences(text)).toBe(2);
  });

  test('숫자 안의 마침표(3.5)는 문장을 나누지 않고, 말줄임(...)은 한 번만 센다', () => {
    const text = '이전 이야기 요약\n\n시계는 3.5초 늦었다... 그리고 문이 열렸다.';
    expect(countRecapSentences(text)).toBe(2);
  });

  test('빈 출력은 0문장', () => {
    expect(countRecapSentences('')).toBe(0);
    expect(countRecapSentences('이전 이야기 요약\n\n')).toBe(0);
  });
});

describe('017 마이그레이션 — recap_call_log 길이 컬럼 (NFR-OBS-002 🚦)', () => {
  const sql = readFileSync(
    join(__dirname, '../../../migrations/017_recap_call_log_length.sql'),
    'utf8'
  );

  test.each(['target_sentences', 'output_chars', 'output_sentences'])(
    '%s 컬럼을 NULL 허용 INTEGER로 추가한다 (기존 행은 NULL 그대로)',
    (column) => {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\s+INTEGER`));
      expect(sql).not.toMatch(new RegExp(`${column}\\s+INTEGER\\s+NOT NULL`));
    }
  );

  test('기존 데이터를 바꾸지 않는다 (UPDATE·DELETE·DEFAULT 채우기 없음)', () => {
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bDEFAULT\b/i);
  });
});
