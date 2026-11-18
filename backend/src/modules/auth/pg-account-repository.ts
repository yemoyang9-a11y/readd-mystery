import type { Pool, PoolClient } from 'pg';
import {
  EmailTakenError,
  type Account,
  type AccountProfile,
  type AccountRepository,
  type IdentityProvider,
  type NewAccount,
  type NewPasswordAccount,
  type Provider,
} from './auth.service';

const UNIQUE_VIOLATION = '23505';

const READING_TABLES = [
  'reading_position',
  'reading_session',
  'saved_recap',
  'session_recap_cache',
  'conversation_history',
  'chatbot_conversation',
];

export class PgAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async findByIdentity(provider: Provider, providerUserId: string): Promise<Account | null> {
    const { rows } = await this.pool.query<Account>(
      `SELECT u.user_id, u.reader_id, u.display_name
         FROM user_identities i
         JOIN users u ON u.user_id = i.user_id
        WHERE i.provider = $1 AND i.provider_user_id = $2`,
      [provider, providerUserId]
    );
    return rows[0] ?? null;
  }

  async findByUserId(userId: string): Promise<Account | null> {
    const { rows } = await this.pool.query<Account>(
      `SELECT user_id, reader_id, display_name FROM users WHERE user_id = $1`,
      [userId]
    );
    return rows[0] ?? null;
  }

  async readerIdExists(readerId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM users WHERE reader_id = $1`, [readerId]);
    return rows.length > 0;
  }

  createAccount(input: NewAccount): Promise<Account> {
    return this.inTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (user_id, reader_id, display_name) VALUES ($1, $2, $3)`,
        [input.userId, input.readerId, input.displayName]
      );
      await client.query(
        `INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ($1, $2, $3)`,
        [input.provider, input.providerUserId, input.userId]
      );
      return {
        user_id: input.userId,
        reader_id: input.readerId,
        display_name: input.displayName,
      };
    });
  }

  async listProviders(userId: string): Promise<IdentityProvider[]> {
    const { rows } = await this.pool.query<{ provider: IdentityProvider }>(
      `SELECT provider FROM (
         SELECT provider FROM user_identities WHERE user_id = $1
         UNION SELECT 'email' FROM user_passwords WHERE user_id = $1
       ) p ORDER BY provider`,
      [userId]
    );
    return rows.map((row) => row.provider);
  }

  // 2026-11-18 대표 지시 — 이메일 회원가입·로그인
  async findPasswordByEmail(
    email: string
  ): Promise<{ user_id: string; password_hash: string } | null> {
    const { rows } = await this.pool.query<{ user_id: string; password_hash: string }>(
      `SELECT user_id, password_hash FROM user_passwords WHERE email = $1`,
      [email]
    );
    return rows[0] ?? null;
  }

  async createPasswordAccount(input: NewPasswordAccount): Promise<Account> {
    try {
      return await this.inTransaction(async (client) => {
        await client.query(
          `INSERT INTO users (user_id, reader_id, display_name) VALUES ($1, $2, $3)`,
          [input.userId, input.readerId, input.displayName]
        );
        // 이메일 계정은 user_passwords 한 곳에만 둔다 — user_identities 는 OAuth 전용으로 남겨
        // 기존 provider 제약을 바꾸지 않는다(마이그레이션 023 을 추가 전용으로)
        await client.query(
          `INSERT INTO user_passwords (user_id, email, password_hash) VALUES ($1, $2, $3)`,
          [input.userId, input.email, input.passwordHash]
        );
        return {
          user_id: input.userId,
          reader_id: input.readerId,
          display_name: input.displayName,
        };
      });
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string } | null;
      if (pgError?.code === UNIQUE_VIOLATION && pgError.constraint === 'user_passwords_email_key') {
        throw new EmailTakenError();
      }
      throw error;
    }
  }

  async getProfile(userId: string): Promise<AccountProfile> {
    const { rows } = await this.pool.query<{ email: string | null; onboarded: boolean }>(
      `SELECT p.email, (u.onboarded_at IS NOT NULL) AS onboarded
         FROM users u
         LEFT JOIN user_passwords p ON p.user_id = u.user_id
        WHERE u.user_id = $1`,
      [userId]
    );
    return rows[0] ?? { email: null, onboarded: false };
  }

  async markOnboarded(userId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE users SET onboarded_at = COALESCE(onboarded_at, $2) WHERE user_id = $1`,
      [userId, at]
    );
  }

  async saveLoginCode(code: string, userId: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `WITH purged AS (DELETE FROM auth_login_codes WHERE expires_at <= now())
       INSERT INTO auth_login_codes (code, user_id, expires_at) VALUES ($1, $2, $3)`,
      [code, userId, expiresAt]
    );
  }

  async consumeLoginCode(code: string, now: Date): Promise<string | null> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `DELETE FROM auth_login_codes WHERE code = $1 AND expires_at > $2 RETURNING user_id`,
      [code, now]
    );
    return rows[0]?.user_id ?? null;
  }

  deleteAccount(userId: string, readerId: string): Promise<void> {
    return this.inTransaction(async (client) => {
      for (const table of READING_TABLES) {
        await client.query(`DELETE FROM ${table} WHERE device_id = $1`, [readerId]);
      }
      await client.query(`DELETE FROM users WHERE user_id = $1`, [userId]);
    });
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
