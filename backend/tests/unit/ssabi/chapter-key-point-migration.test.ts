import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(__dirname, '../../../migrations/026_chapter_key_point.sql'), 'utf8');
const statements = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('026_chapter_key_point 마이그레이션 — 타임라인 장 핵심 한 줄 (결정 31)', () => {
  test('추가 전용 — 지우거나 바꾸는 문장이 없다', () => {
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
    expect(statements).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|INSERT)\b/i);
    expect(statements).not.toMatch(/RENAME/i);
  });

  test('chapter_summaries에만 열을 더하고, 모두 IF NOT EXISTS·NULL 허용이다', () => {
    const adds = statements.match(/ADD COLUMN[^;]*/gi) ?? [];
    expect(adds).toHaveLength(2);
    for (const add of adds) {
      expect(add).toMatch(/ADD COLUMN IF NOT EXISTS/i);
      expect(add).not.toMatch(/NOT NULL/i);
      expect(add).not.toMatch(/DEFAULT/i);
    }
    const tables = (statements.match(/ALTER TABLE\s+\w+/gi) ?? []).map((t) => t.split(/\s+/)[2]);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((t) => t !== 'chapter_summaries')).toHaveLength(0);
  });

  test('핵심 한 줄과 그 검수 상태 열을 둔다', () => {
    expect(statements).toMatch(/ADD COLUMN IF NOT EXISTS key_point\s+TEXT\b/i);
    expect(statements).toMatch(/ADD COLUMN IF NOT EXISTS key_point_review_status\s+TEXT\b/i);
    expect(statements).toMatch(/'pending',\s*'approved',\s*'rejected'/);
  });
});
