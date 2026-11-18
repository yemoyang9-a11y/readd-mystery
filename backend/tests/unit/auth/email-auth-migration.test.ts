import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(__dirname, '../../../migrations/023_email_auth.sql'), 'utf8');

describe('023_email_auth 마이그레이션 — 2026-11-18 대표 지시', () => {
  test("user_identities.provider에 'email'을 허용한다", () => {
    expect(sql).toMatch(/CHECK \(provider IN \('google', 'kakao', 'email'\)\)/);
  });

  test('user_passwords는 users를 참조하고 계정이 지워지면 함께 지워진다', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS user_passwords/);
    expect(sql).toMatch(
      /user_id\s+UUID\s+PRIMARY KEY REFERENCES users \(user_id\) ON DELETE CASCADE/
    );
  });

  test('이메일은 소문자로만 저장되고 중복될 수 없다', () => {
    expect(sql).toMatch(/email\s+TEXT\s+NOT NULL UNIQUE CHECK \(email = lower\(email\)\)/);
  });

  test('users.onboarded_at은 NULL을 허용하는 시각 열이다', () => {
    expect(sql).toMatch(/ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ NULL/);
  });

  test('user_passwords에 ROW LEVEL SECURITY를 켜고 정책은 만들지 않는다', () => {
    expect(sql).toMatch(/ALTER TABLE user_passwords ENABLE ROW LEVEL SECURITY;/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});
