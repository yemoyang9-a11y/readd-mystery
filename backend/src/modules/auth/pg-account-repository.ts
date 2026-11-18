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
import type { ConsentRecord } from './consents';

const UNIQUE_VIOLATION = '23505';

const READING_TABLES = [
  'reading_position',
  'reading_session',
  'saved_recap',
  'session_recap_cache',
  'conversation_history',
  'chatbot_conversation',
];

const READER_ID_TABLES = ['reading_notes', 'community_post_likes'];

/** user_consents 에 한 문장으로 넣는다. 같은 종류·버전이면 동의 여부와 시각을 바꾼다 */
async function upsertConsents(
  db: Pick<Pool, 'query'> | PoolClient,
  userId: string,
  records: ConsentRecord[],
  at: Date
): Promise<void> {
  if (records.length === 0) return;
  await db.query(
    `INSERT INTO user_consents (user_id, kind, version, agreed, agreed_at)
     SELECT $1, c.kind, c.version, c.agreed, $5
       FROM unnest($2::text[], $3::text[], $4::boolean[]) AS c(kind, version, agreed)
     ON CONFLICT (user_id, kind, version) DO UPDATE
        SET agreed = EXCLUDED.agreed, agreed_at = EXCLUDED.agreed_at`,
    [
      userId,
      records.map((r) => r.kind),
      records.map((r) => r.version),
      records.map((r) => r.agreed),
      at,
    ]
  );
}

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
        // 대표 지시 2026-11-18 — 약관 동의는 계정과 같은 트랜잭션. 저장에 실패하면 가입도 되돌린다
        await upsertConsents(client, input.userId, input.consents, input.consentedAt);
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

  async listConsents(userId: string): Promise<ConsentRecord[]> {
    const { rows } = await this.pool.query<ConsentRecord>(
      `SELECT kind, version, agreed FROM user_consents WHERE user_id = $1`,
      [userId]
    );
    return rows;
  }

  async saveConsents(userId: string, records: ConsentRecord[], at: Date): Promise<void> {
    await upsertConsents(this.pool, userId, records, at);
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
      // 독자가 직접 남긴 추리 노트와 공감 기록도 함께 지운다 (2026-11-18)
      for (const table of READER_ID_TABLES) {
        await client.query(`DELETE FROM ${table} WHERE reader_id = $1`, [readerId]);
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
