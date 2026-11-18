/**
 * DB 마이그레이션 실행기 — 이력(ledger)·잠금·파일별 트랜잭션 (FR-PRG-003 🚦)
 *
 * 왜: 예전 실행기는 이력 없이 migrations/*.sql 을 매번 전부 실행했다. 019_read_frontier.sql 은
 *     처음 적용될 때 기존 독자의 read_pages 를 1 ~ current_page 로 채운다(대표 결정). 이것이 다시
 *     실행되면 목차로 건너뛰기만 한 독자의 앞부분까지 읽음으로 인정되어 기준점이 올라간다(스포일러 누출).
 *
 * 규칙
 *  - 적용한 파일은 schema_migrations 표에 이름·체크섬과 함께 남기고, 다시 실행하지 않는다.
 *  - 한 번에 한 실행만 돈다 (pg_advisory_lock). 파일 하나 = 트랜잭션 하나 (실패하면 그 파일 통째로 되돌림).
 *  - 적용된 파일의 내용이 바뀌었으면(체크섬 불일치) 아무것도 실행하지 않고 멈춘다.
 *  - 이력 표가 비어 있는데 이미 테이블이 있는 DB(이 실행기 도입 전에 적용된 DB, 예: 운영 Supabase)는
 *    적용을 거부한다. 사람이 백업·확인 후 baseline 명령으로 "이미 적용됨"을 기록해야 한다.
 *  - baseline 은 `--baseline-through <파일> --confirm-baseline` 두 인자를 모두 줄 때만 동작하며
 *    SQL 을 실행하지 않는다. 자동으로 실행되는 경로(배포·시작 스크립트)에 넣지 않는다.
 *
 * 사용법 (backend/ 에서)
 *   node scripts/migrate.js                      # 남은 파일만 적용
 *   node scripts/migrate.js --status             # 적용됨/남음만 보여 줌 (실행 없음)
 *   node scripts/migrate.js --baseline-through 025_signup_consents.sql --confirm-baseline
 *
 * 접속은 DB_HOST·DB_PORT·DB_NAME·DB_USER·DB_PASSWORD. 로컬처럼 SSL 이 없는 DB 는 DB_SSL=false.
 * 절차: docs/context/runbook-local-2026-11-17.md "7. 마이그레이션 이력" 절.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEDGER_TABLE = 'schema_migrations';
// 이 저장소의 마이그레이션 전용 advisory lock 번호 (임의 고정값, 다른 용도로 쓰지 않는다)
const MIGRATION_LOCK_KEY = 7310019;
// 이력 표가 비어 있을 때 "이미 적용된 DB"로 판단하는 표 (001·002 가 만든다)
const EXISTING_SCHEMA_MARKERS = ['books', 'reading_position'];
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '../migrations');

function listMigrationFiles(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

function readMigration(migrationsDir, file) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  return { sql, checksum: checksum(sql) };
}

/** 지정한 파일까지(포함)의 목록. 없는 이름이면 거부한다. */
function filesThrough(files, through) {
  if (through === undefined) return files;
  const idx = files.indexOf(through);
  if (idx < 0) throw new Error(`마이그레이션 파일 ${through} 이(가) 없습니다`);
  return files.slice(0, idx + 1);
}

// 추가 전용 — 이미 있으면 그대로 둔다
async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      filename   TEXT        PRIMARY KEY,
      checksum   TEXT        NOT NULL,
      method     TEXT        NOT NULL CHECK (method IN ('applied', 'baseline')),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function readLedger(client) {
  const r = await client.query(`SELECT filename, checksum FROM ${LEDGER_TABLE}`);
  return new Map(r.rows.map((row) => [row.filename, row.checksum]));
}

async function ledgerExists(client) {
  const r = await client.query('SELECT to_regclass($1) AS t', [LEDGER_TABLE]);
  return r.rows[0].t !== null;
}

async function hasExistingSchema(client) {
  for (const table of EXISTING_SCHEMA_MARKERS) {
    const r = await client.query('SELECT to_regclass($1) AS t', [table]);
    if (r.rows[0].t !== null) return true;
  }
  return false;
}

async function withLock(client, fn) {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}

function changedFiles(files, ledger, migrationsDir) {
  return files.filter(
    (f) => ledger.has(f) && ledger.get(f) !== readMigration(migrationsDir, f).checksum
  );
}

/**
 * 남은 파일만 순서대로 적용한다. 반환: { applied, skipped }
 * through 를 주면 그 파일까지만 적용한다.
 */
async function applyMigrations(
  client,
  { migrationsDir = DEFAULT_MIGRATIONS_DIR, through, log = console.log } = {}
) {
  const files = filesThrough(listMigrationFiles(migrationsDir), through);
  return withLock(client, async () => {
    await ensureLedger(client);
    const ledger = await readLedger(client);

    // FR-PRG-003 🚦 — 이력 없이 이미 적용된 DB에 전부 다시 실행하지 않는다 (019 재실행 = 읽음 부풀림)
    if (ledger.size === 0 && (await hasExistingSchema(client))) {
      throw new Error(
        '이력(schema_migrations)이 비어 있는데 이미 테이블이 있는 DB입니다. 다시 실행하면 019가 읽음 기록을 부풀립니다. ' +
          'DB 백업과 적용 상태 확인 후 baseline 명령(--baseline-through <마지막 적용 파일> --confirm-baseline)을 먼저 실행하세요.'
      );
    }

    const changed = changedFiles(files, ledger, migrationsDir);
    if (changed.length > 0) {
      throw new Error(
        `이미 적용된 파일의 내용이 바뀌었습니다: ${changed.join(', ')} — 아무것도 실행하지 않았습니다`
      );
    }

    const applied = [];
    const skipped = [];
    for (const file of files) {
      if (ledger.has(file)) {
        skipped.push(file);
        continue;
      }
      const { sql, checksum: sum } = readMigration(migrationsDir, file);
      log(`적용: ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${LEDGER_TABLE} (filename, checksum, method) VALUES ($1, $2, 'applied')`,
          [file, sum]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${file} 실패 — 이 파일은 되돌렸습니다: ${err.message}`);
      }
      applied.push(file);
    }
    return { applied, skipped };
  });
}

/**
 * 이 실행기 도입 전에 적용된 DB에 "through 파일까지 적용됨"을 기록만 한다. SQL 은 실행하지 않는다.
 * 이력이 하나라도 있으면 거부한다 (덧쓰기 방지).
 */
async function baselineMigrations(
  client,
  { migrationsDir = DEFAULT_MIGRATIONS_DIR, through, log = console.log } = {}
) {
  if (!through) throw new Error('baseline 에는 마지막으로 적용된 파일 이름이 필요합니다');
  const files = filesThrough(listMigrationFiles(migrationsDir), through);
  return withLock(client, async () => {
    await ensureLedger(client);
    const ledger = await readLedger(client);
    if (ledger.size > 0) {
      throw new Error(
        `이력이 이미 ${ledger.size}건 있습니다 — baseline 은 비어 있는 이력에만 기록합니다`
      );
    }
    await client.query('BEGIN');
    try {
      for (const file of files) {
        const { checksum: sum } = readMigration(migrationsDir, file);
        await client.query(
          `INSERT INTO ${LEDGER_TABLE} (filename, checksum, method) VALUES ($1, $2, 'baseline')`,
          [file, sum]
        );
        log(`baseline 기록: ${file}`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return { recorded: files };
  });
}

/** 실행 없이 상태만 본다. 이력 표도 만들지 않는다. */
async function migrationStatus(client, { migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const files = listMigrationFiles(migrationsDir);
  const ledger = (await ledgerExists(client)) ? await readLedger(client) : new Map();
  return {
    applied: files.filter((f) => ledger.has(f)),
    pending: files.filter((f) => !ledger.has(f)),
    changed: changedFiles(files, ledger, migrationsDir),
  };
}

function parseArgs(argv) {
  let status = false;
  let confirm = false;
  let through;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--status') status = true;
    else if (arg === '--confirm-baseline') confirm = true;
    else if (arg === '--baseline-through') {
      through = argv[i + 1];
      if (!through || through.startsWith('--'))
        throw new Error('--baseline-through 다음에 파일 이름을 적어야 합니다');
      i++;
    } else throw new Error(`모르는 인자: ${arg}`);
  }
  if (through !== undefined) {
    if (!confirm)
      throw new Error('baseline 은 --confirm-baseline 을 함께 줄 때만 실행합니다 (DB 백업 후)');
    if (status) throw new Error('--status 와 baseline 은 함께 쓸 수 없습니다');
    return { mode: 'baseline', through };
  }
  if (confirm) throw new Error('--confirm-baseline 은 --baseline-through 와 함께 씁니다');
  return status ? { mode: 'status' } : { mode: 'apply' };
}

async function main() {
  require('dotenv').config();
  const { Client } = require('pg');
  const args = parseArgs(process.argv.slice(2));

  console.log('DB_HOST:', process.env.DB_HOST);
  console.log('DB_NAME:', process.env.DB_NAME);
  console.log('모드:', args.mode);

  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    if (args.mode === 'status') {
      const s = await migrationStatus(client);
      console.log(`적용됨 ${s.applied.length}개, 남음 ${s.pending.length}개`);
      for (const f of s.pending) console.log(`  남음: ${f}`);
      for (const f of s.changed) console.log(`  ⚠️ 내용 바뀜: ${f}`);
    } else if (args.mode === 'baseline') {
      const r = await baselineMigrations(client, { through: args.through });
      console.log(`✅ baseline ${r.recorded.length}개 기록 (SQL 실행 없음)`);
    } else {
      // pgvector 는 001 도 만들지만 예전 실행기와 같이 먼저 확인한다 (IF NOT EXISTS)
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      const r = await applyMigrations(client);
      console.log(`✅ 적용 ${r.applied.length}개, 건너뜀 ${r.skipped.length}개`);
    }
  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ 마이그레이션 실패:', error.message);
    process.exit(1);
  });
}

module.exports = {
  LEDGER_TABLE,
  MIGRATION_LOCK_KEY,
  listMigrationFiles,
  applyMigrations,
  baselineMigrations,
  migrationStatus,
  parseArgs,
};
