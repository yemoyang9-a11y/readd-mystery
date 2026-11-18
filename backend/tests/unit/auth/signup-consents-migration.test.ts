import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(__dirname, '../../../migrations/025_signup_consents.sql'), 'utf8');

describe('025_signup_consents 마이그레이션 — 대표 지시 2026-11-18 (가입 약관 동의)', () => {
  test('추가 전용 — 기존 테이블·제약을 지우거나 바꾸지 않는다', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER TABLE (users|user_identities|user_passwords)\b/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
  });

  test('user_consents는 users를 참조하고 계정이 지워지면 함께 지워진다', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS user_consents/);
    expect(sql).toMatch(/user_id\s+UUID\s+NOT NULL REFERENCES users \(user_id\) ON DELETE CASCADE/);
  });

  test('종류·버전·동의 여부·시각을 남긴다', () => {
    expect(sql).toMatch(/kind\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/version\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/agreed\s+BOOLEAN\s+NOT NULL/);
    expect(sql).toMatch(/agreed_at\s+TIMESTAMPTZ\s+NOT NULL/);
    expect(sql).toMatch(/PRIMARY KEY \(user_id, kind, version\)/);
  });

  test('user_consents에 ROW LEVEL SECURITY를 켜고 정책은 만들지 않는다', () => {
    expect(sql).toMatch(/ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});
