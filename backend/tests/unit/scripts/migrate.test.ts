/**
 * scripts/migrate.js — 마이그레이션 이력(ledger)·잠금·파일별 트랜잭션 (FR-PRG-003 🚦)
 *
 * 019_read_frontier.sql은 처음 적용될 때 기존 독자의 read_pages를 1 ~ current_page로 채운다(대표 결정).
 * 이력 없이 다시 실행되면 목차로 건너뛰기만 한 독자의 앞부분까지 읽음으로 인정되어
 * 기준점이 올라간다 = 스포일러 누출. 이 시험은 실제 PostgreSQL에서 그 일이 0건임을 확인한다.
 *
 * 실제 Postgres가 필요하다. MIGRATE_TEST_DATABASE_URL이 있을 때만 돈다 (pgvector 설치 필요).
 * 운영 DB 주소를 넣지 않는다 — 시험마다 임시 스키마를 만들고 지운다.
 * 인자 해석 시험은 DB 없이 항상 돈다.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrate = require('../../../scripts/migrate.js');

const MIGRATIONS = path.join(__dirname, '../../../migrations');
const PG_URL = process.env.MIGRATE_TEST_DATABASE_URL;

const READER_A = '11111111-1111-4111-8111-111111111111'; // 019 이전부터 읽던 독자 (current_page 5)
const READER_JUMP = '22222222-2222-4222-8222-222222222222'; // 019 이후, 목차로 200쪽에 건너뛰기만 한 독자
const READER_SEQ = '33333333-3333-4333-8333-333333333333'; // 019 이후, 1~3쪽을 차례로 읽은 독자
const BOOK = 'gasangbeomin';

const silent = () => undefined;

// ---------------------------------------------------------------------------
// 인자 해석 — DB 없이
// ---------------------------------------------------------------------------
describe('migrate.js 인자 해석', () => {
  test('인자가 없으면 적용(apply) 모드', () => {
    expect(migrate.parseArgs([])).toEqual({ mode: 'apply' });
  });

  test('--status 는 아무것도 실행하지 않는 조회 모드', () => {
    expect(migrate.parseArgs(['--status'])).toEqual({ mode: 'status' });
  });

  test('baseline은 마지막 파일 이름과 --confirm-baseline 이 함께 있어야만 동작한다', () => {
    expect(
      migrate.parseArgs(['--baseline-through', '025_signup_consents.sql', '--confirm-baseline'])
    ).toEqual({ mode: 'baseline', through: '025_signup_consents.sql' });
    expect(() => migrate.parseArgs(['--baseline-through', '025_signup_consents.sql'])).toThrow(
      /--confirm-baseline/
    );
    expect(() => migrate.parseArgs(['--baseline-through'])).toThrow(/파일 이름/);
    expect(() => migrate.parseArgs(['--confirm-baseline'])).toThrow(/--baseline-through/);
  });

  test('모르는 인자는 거부한다', () => {
    expect(() => migrate.parseArgs(['--force'])).toThrow(/모르는 인자/);
  });
});

// ---------------------------------------------------------------------------
// 실제 PostgreSQL
// ---------------------------------------------------------------------------
(PG_URL ? describe : describe.skip)(
  '실제 Postgres — 마이그레이션 이력·잠금 (MIGRATE_TEST_DATABASE_URL)',
  () => {
    let schema: string;
    let client: Client;
    const extraClients: Client[] = [];
    const tmpDirs: string[] = [];

    async function connect(): Promise<Client> {
      const c = new Client({
        connectionString: PG_URL,
        options: `-c search_path=${schema},public`,
      });
      await c.connect();
      return c;
    }

    function tmpMigrations(files: Record<string, string>): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readd-migrate-'));
      for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
      tmpDirs.push(dir);
      return dir;
    }

    async function readPages(deviceId: string): Promise<number[]> {
      const r = await client.query(
        'SELECT read_pages FROM reading_position WHERE device_id = $1 AND book_id = $2',
        [deviceId, BOOK]
      );
      return r.rows[0].read_pages;
    }

    async function insertReader(deviceId: string, currentPage: number, readPages?: number[]) {
      if (readPages === undefined) {
        await client.query(
          `INSERT INTO reading_position (device_id, book_id, current_page, event_seq, max_page)
         VALUES ($1, $2, $3, 1, $3)`,
          [deviceId, BOOK, currentPage]
        );
      } else {
        await client.query(
          `INSERT INTO reading_position (device_id, book_id, current_page, event_seq, max_page, read_pages)
         VALUES ($1, $2, $3, 1, $3, $4)`,
          [deviceId, BOOK, currentPage, readPages]
        );
      }
    }

    /** 019 이후 생긴 독자 두 명: 목차 점프만 한 독자(read_pages 비어 있음)와 1~3쪽을 차례로 읽은 독자 */
    async function insertPost019Readers() {
      await insertReader(READER_JUMP, 200, []);
      await insertReader(READER_SEQ, 3, [1, 2, 3]);
    }

    async function ledger(): Promise<{ filename: string; method: string }[]> {
      const r = await client.query(
        `SELECT filename, method FROM ${migrate.LEDGER_TABLE} ORDER BY filename`
      );
      return r.rows;
    }

    beforeAll(async () => {
      const setup = new Client({ connectionString: PG_URL });
      await setup.connect();
      await setup.query('CREATE EXTENSION IF NOT EXISTS vector');
      await setup.end();
    });

    beforeEach(async () => {
      schema = `mig_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const setup = new Client({ connectionString: PG_URL });
      await setup.connect();
      await setup.query(`CREATE SCHEMA ${schema}`);
      await setup.end();
      client = await connect();
    });

    afterEach(async () => {
      for (const c of extraClients.splice(0)) await c.end().catch(() => undefined);
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      await client.end();
      for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    test('FR-PRG-003: 019 처음 적용 시 기존 독자는 1~current_page로 채워진다 (positive)', async () => {
      const before = await migrate.applyMigrations(client, {
        migrationsDir: MIGRATIONS,
        through: '018_recap_call_log_length.sql',
        log: silent,
      });
      expect(before.applied).toContain('002_reading_state.sql');
      expect(before.applied).not.toContain('019_read_frontier.sql');
      await insertReader(READER_A, 5);

      const after = await migrate.applyMigrations(client, {
        migrationsDir: MIGRATIONS,
        log: silent,
      });
      expect(after.applied[0]).toBe('019_read_frontier.sql');
      expect(await readPages(READER_A)).toEqual([1, 2, 3, 4, 5]);
    });

    test('FR-PRG-003: ledger가 있으면 이미 적용된 파일은 다시 실행되지 않는다 — 재실행 후 읽음 변화 0건', async () => {
      const first = await migrate.applyMigrations(client, {
        migrationsDir: MIGRATIONS,
        log: silent,
      });
      const files = migrate.listMigrationFiles(MIGRATIONS);
      expect(first.applied).toEqual(files);
      expect((await ledger()).map((r) => r.filename)).toEqual(files);
      await insertPost019Readers();

      const second = await migrate.applyMigrations(client, {
        migrationsDir: MIGRATIONS,
        log: silent,
      });
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(files);
      expect(await readPages(READER_JUMP)).toEqual([]);
      expect(await readPages(READER_SEQ)).toEqual([1, 2, 3]);
      expect(await ledger()).toHaveLength(files.length);
    });

    test('FR-PRG-003: 019 SQL을 이력 없이 직접 다시 실행해도 기존 독자의 read_pages가 변하지 않는다', async () => {
      await migrate.applyMigrations(client, { migrationsDir: MIGRATIONS, log: silent });
      await insertPost019Readers();

      await client.query(fs.readFileSync(path.join(MIGRATIONS, '019_read_frontier.sql'), 'utf8'));
      await client.query(fs.readFileSync(path.join(MIGRATIONS, '019_read_frontier.sql'), 'utf8'));

      expect(await readPages(READER_JUMP)).toEqual([]);
      expect(await readPages(READER_SEQ)).toEqual([1, 2, 3]);
    });

    test('FR-PRG-003: 이력 없이 이미 적용된 DB는 baseline 전까지 적용을 거부하고 아무것도 실행하지 않는다', async () => {
      // 예전 migrate.js처럼 이력 없이 전부 실행된 DB (운영 Supabase와 같은 상태)
      for (const file of migrate.listMigrationFiles(MIGRATIONS)) {
        await client.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
      }
      await insertPost019Readers();

      await expect(
        migrate.applyMigrations(client, { migrationsDir: MIGRATIONS, log: silent })
      ).rejects.toThrow(/baseline/);
      expect(await readPages(READER_JUMP)).toEqual([]);
      const exists = await client.query(`SELECT to_regclass($1) AS t`, [
        `${schema}.${migrate.LEDGER_TABLE}`,
      ]);
      if (exists.rows[0].t) expect(await ledger()).toEqual([]);
    });

    test('FR-PRG-003: baseline은 SQL을 실행하지 않고 지정한 파일까지 이력만 기록한다, 이후 적용은 0건', async () => {
      for (const file of migrate.listMigrationFiles(MIGRATIONS)) {
        await client.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
      }
      await insertPost019Readers();

      const files = migrate.listMigrationFiles(MIGRATIONS);
      const last = files[files.length - 1];
      const base = await migrate.baselineMigrations(client, {
        migrationsDir: MIGRATIONS,
        through: last,
        log: silent,
      });
      expect(base.recorded).toEqual(files);
      expect((await ledger()).every((r) => r.method === 'baseline')).toBe(true);
      expect(await readPages(READER_JUMP)).toEqual([]);

      const after = await migrate.applyMigrations(client, {
        migrationsDir: MIGRATIONS,
        log: silent,
      });
      expect(after.applied).toEqual([]);
      expect(await readPages(READER_JUMP)).toEqual([]);
      expect(await readPages(READER_SEQ)).toEqual([1, 2, 3]);
    });

    test('baseline은 없는 파일 이름을 거부하고, 이미 이력이 있는 DB에는 덧쓰지 않는다', async () => {
      await expect(
        migrate.baselineMigrations(client, {
          migrationsDir: MIGRATIONS,
          through: '999_nope.sql',
          log: silent,
        })
      ).rejects.toThrow(/999_nope\.sql/);

      await migrate.applyMigrations(client, {
        migrationsDir: MIGRATIONS,
        through: '002_reading_state.sql',
        log: silent,
      });
      await expect(
        migrate.baselineMigrations(client, {
          migrationsDir: MIGRATIONS,
          through: '025_signup_consents.sql',
          log: silent,
        })
      ).rejects.toThrow(/이미/);
      expect((await ledger()).map((r) => r.filename)).toEqual([
        '001_content_store.sql',
        '002_reading_state.sql',
      ]);
    });

    test('적용된 파일 내용이 바뀌면(체크섬 불일치) 아무것도 실행하지 않고 멈춘다', async () => {
      const dir = tmpMigrations({
        '001_a.sql': 'CREATE TABLE t_a (id INT);',
        '002_b.sql': 'CREATE TABLE t_b (id INT);',
      });
      await migrate.applyMigrations(client, {
        migrationsDir: dir,
        through: '001_a.sql',
        log: silent,
      });
      fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE t_a (id INT, x INT);');

      await expect(
        migrate.applyMigrations(client, { migrationsDir: dir, log: silent })
      ).rejects.toThrow(/001_a\.sql/);
      const t = await client.query(`SELECT to_regclass($1) AS t`, [`${schema}.t_b`]);
      expect(t.rows[0].t).toBeNull();
    });

    test('파일별 트랜잭션 — 실패한 파일은 통째로 되돌려지고 이력에 남지 않는다, 앞 파일은 남는다', async () => {
      const dir = tmpMigrations({
        '001_ok.sql': 'CREATE TABLE t_ok (id INT);',
        '002_bad.sql': 'CREATE TABLE t_half (id INT); SELECT no_such_column FROM t_ok;',
        '003_after.sql': 'CREATE TABLE t_after (id INT);',
      });
      await expect(
        migrate.applyMigrations(client, { migrationsDir: dir, log: silent })
      ).rejects.toThrow();

      expect((await ledger()).map((r) => r.filename)).toEqual(['001_ok.sql']);
      const half = await client.query(`SELECT to_regclass($1) AS t`, [`${schema}.t_half`]);
      expect(half.rows[0].t).toBeNull();
      const after = await client.query(`SELECT to_regclass($1) AS t`, [`${schema}.t_after`]);
      expect(after.rows[0].t).toBeNull();
    });

    test('잠금 — 두 실행이 동시에 돌아도 각 파일은 한 번만 실행된다', async () => {
      // IF NOT EXISTS 없음: 두 번 실행되면 오류가 난다
      const dir = tmpMigrations({
        '001_slow.sql': 'SELECT pg_sleep(0.3); CREATE TABLE t_once (id INT);',
        '002_next.sql': 'CREATE TABLE t_next (id INT);',
      });
      const other = await connect();
      extraClients.push(other);

      const [a, b] = await Promise.all([
        migrate.applyMigrations(client, { migrationsDir: dir, log: silent }),
        migrate.applyMigrations(other, { migrationsDir: dir, log: silent }),
      ]);
      expect([...a.applied, ...b.applied].sort()).toEqual(['001_slow.sql', '002_next.sql']);
      expect((await ledger()).map((r) => r.filename)).toEqual(['001_slow.sql', '002_next.sql']);
    });

    test('잠금은 끝나면 풀린다 — 다른 연결이 바로 잡을 수 있다', async () => {
      const dir = tmpMigrations({ '001_x.sql': 'CREATE TABLE t_x (id INT);' });
      await migrate.applyMigrations(client, { migrationsDir: dir, log: silent });
      const other = await connect();
      extraClients.push(other);
      const r = await other.query('SELECT pg_try_advisory_lock($1) AS ok', [
        migrate.MIGRATION_LOCK_KEY,
      ]);
      expect(r.rows[0].ok).toBe(true);
      await other.query('SELECT pg_advisory_unlock($1)', [migrate.MIGRATION_LOCK_KEY]);
    });

    test('--status 는 실행 없이 적용됨/남은 파일을 알려 준다', async () => {
      const dir = tmpMigrations({
        '001_a.sql': 'CREATE TABLE t_a (id INT);',
        '002_b.sql': 'CREATE TABLE t_b (id INT);',
      });
      await migrate.applyMigrations(client, {
        migrationsDir: dir,
        through: '001_a.sql',
        log: silent,
      });
      const s = await migrate.migrationStatus(client, { migrationsDir: dir });
      expect(s).toEqual({ applied: ['001_a.sql'], pending: ['002_b.sql'], changed: [] });
      const t = await client.query(`SELECT to_regclass($1) AS t`, [`${schema}.t_b`]);
      expect(t.rows[0].t).toBeNull();
    });
  }
);
