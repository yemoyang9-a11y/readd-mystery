import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { createPgReadingPositionRepository } from '../../reading-state/pg-repository';
import { createPgNotesRepository } from '../../notes/pg-repository';
import { createPgNoteReviewRepository, createPgReviewEvidenceReader } from '../pg-repository';

// 실제 Postgres — 마이그레이션 029 (추리 채점·결과지 공유, 대표 결정 2026-11-24).
// COMMUNITY_TEST_DATABASE_URL 이 있을 때만 돈다 (다른 pg 시험과 같은 변수).
const PG_URL = process.env.COMMUNITY_TEST_DATABASE_URL;
const MIGRATIONS = path.join(__dirname, '../../../../migrations');
const BOOK = 'bk-review';
const D = '11111111-1111-4111-8111-111111111111';

(PG_URL ? describe : describe.skip)('실제 Postgres — 마이그레이션 029', () => {
  let pool: Pool;
  let schema: string;
  const db = () => ({ query: (sql: string, params?: unknown[]) => pool.query(sql, params) });

  async function apply(file: string) {
    await pool.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }

  beforeEach(async () => {
    schema = `nr_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const setup = new Pool({ connectionString: PG_URL, max: 1 });
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.end();
    pool = new Pool({ connectionString: PG_URL, options: `-c search_path=${schema}` });
    await pool.query(
      `CREATE TABLE books (book_id TEXT PRIMARY KEY, title TEXT NOT NULL, total_pages INTEGER NOT NULL)`
    );
    await pool.query(`INSERT INTO books VALUES ($1, '가상범인', 100)`, [BOOK]);
    for (const file of [
      '002_reading_state.sql',
      '010_accounts.sql',
      '012_reading_max_page.sql',
      '019_read_frontier.sql',
      '014_reading_notes.sql',
      '021_note_kind.sql',
      '016_community.sql',
      '022_community_moderation.sql',
      '027_community_replies.sql',
      '028_drop_community_kind.sql',
      '029_note_review.sql',
    ]) {
      await apply(file);
    }
  });

  afterEach(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  test('029 는 두 번 적용해도 그대로이고 note_reviews 는 RLS 가 켜져 있다', async () => {
    await apply('029_note_review.sql');
    const rls = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'note_reviews' AND relnamespace = $1::regnamespace`,
      [schema]
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });

  test('끝에 처음 닿은 시각: 99쪽까지는 없고, 100쪽에 닿을 때 남고, 다시 가도 그대로', async () => {
    const repo = createPgReadingPositionRepository(db());
    await repo.savePosition(D, BOOK, { current_page: 1, event_seq: 1 });
    await repo.savePosition(D, BOOK, { current_page: 99, event_seq: 2 });
    expect((await repo.findPosition(D, BOOK))?.reached_end_at).toBeNull();

    await repo.savePosition(D, BOOK, { current_page: 100, event_seq: 3 });
    const first = (await repo.findPosition(D, BOOK))?.reached_end_at;
    expect(first).not.toBeNull();

    await repo.savePosition(D, BOOK, { current_page: 20, event_seq: 4 });
    await repo.savePosition(D, BOOK, { current_page: 100, event_seq: 5 });
    expect((await repo.findPosition(D, BOOK))?.reached_end_at).toBe(first);
  });

  test('첫 저장이 곧바로 마지막 쪽이어도 시각이 남는다', async () => {
    const repo = createPgReadingPositionRepository(db());
    await repo.savePosition(D, BOOK, { current_page: 100, event_seq: 1 });
    expect((await repo.findPosition(D, BOOK))?.reached_end_at).not.toBeNull();
  });

  test('029 전에 이미 끝까지 간 독자는 나중에 움직여도 시각이 비어 있다', async () => {
    await pool.query(
      `INSERT INTO reading_position (device_id, book_id, current_page, max_page, event_seq)
       VALUES ($1, $2, 100, 100, 1)`,
      [D, BOOK]
    );
    const repo = createPgReadingPositionRepository(db());
    await repo.savePosition(D, BOOK, { current_page: 30, event_seq: 2 });
    await repo.savePosition(D, BOOK, { current_page: 100, event_seq: 3 });
    expect((await repo.findPosition(D, BOOK))?.reached_end_at).toBeNull();
  });

  test('본문 수정 시각은 본문 글자를 바꿀 때만 움직인다 — 종류·풀림 표시는 그대로', async () => {
    const notes = createPgNotesRepository(db());
    const note = await notes.create(D, BOOK, {
      page_no: 10,
      kind: 'hypothesis',
      resolved: false,
      body: '범인은 집사',
    });
    await pool.query(
      `UPDATE reading_notes SET body_updated_at = '2026-01-01T00:00:00Z' WHERE note_id = $1`,
      [note.note_id]
    );
    await notes.update(D, BOOK, note.note_id, { resolved: true, kind: 'hypothesis' });
    await notes.update(D, BOOK, note.note_id, { body: '범인은 집사' }); // 같은 글자
    let [row] = await notes.listForReview(D, BOOK, 100);
    expect(row.body_updated_at).toBe('2026-01-01T00:00:00.000Z');

    await notes.update(D, BOOK, note.note_id, { body: '범인은 정원사' });
    [row] = await notes.listForReview(D, BOOK, 100);
    expect(row.body_updated_at).not.toBe('2026-01-01T00:00:00.000Z');
    expect(row.body).toBe('범인은 정원사');
  });

  test('FR-SPL-002: 채점용 노트 조회는 상한 쪽까지만 — 상한 밖 노트 0건, 상한을 올리면 보인다 (positive 쌍)', async () => {
    const notes = createPgNotesRepository(db());
    await notes.create(D, BOOK, { page_no: 40, kind: null, resolved: false, body: '앞' });
    await notes.create(D, BOOK, { page_no: 90, kind: 'clue', resolved: false, body: '뒤' });
    expect((await notes.listForReview(D, BOOK, 50)).map((n) => n.body)).toEqual(['앞']);
    expect((await notes.listForReview(D, BOOK, 100)).map((n) => n.body)).toEqual(['앞', '뒤']);
  });

  test('결과지 글은 독자·책당 보이는 것 하나 — 지운 뒤에는 다시 올릴 수 있다', async () => {
    const insert = (id: string) =>
      pool.query(
        `INSERT INTO community_posts (post_id, book_id, reader_id, body, review_card)
         VALUES ($1, $2, $3, '결과지', '{"v":1}'::jsonb)`,
        [id, BOOK, D]
      );
    const first = randomUUID();
    await insert(first);
    await expect(insert(randomUUID())).rejects.toThrow();
    await pool.query(`UPDATE community_posts SET deleted_at = now() WHERE post_id = $1`, [first]);
    await expect(insert(randomUUID())).resolves.toBeDefined();
  });

  const meta = {
    bound_page: 100,
    reached_end_at: null,
    eligible_count: 1,
    excluded_count: 0,
    model: 'm',
  };
  const result = { version: 1, truth_summary: 's' } as any;

  test('채점 맡기: 처음은 claimed, 진행 중이면 busy, 성공 뒤에는 done 이고 결과를 덮지 않는다', async () => {
    const repo = createPgNoteReviewRepository(db());
    expect(await repo.claim(D, BOOK, meta)).toBe('claimed');
    expect(await repo.claim(D, BOOK, meta)).toBe('busy');
    await repo.complete(D, BOOK, result);
    expect(await repo.claim(D, BOOK, meta)).toBe('done');
    await repo.fail(D, BOOK, 'late failure');
    expect(await repo.find(D, BOOK)).toMatchObject({ status: 'done', result, attempts: 1 });
    // 로그 레코드 — 채점 호출의 모델·범위·대상 수·완료 시각이 행에 남는다
    const { rows } = await pool.query(
      `SELECT model, bound_page, eligible_count, completed_at FROM note_reviews WHERE reader_id = $1`,
      [D]
    );
    expect(rows[0]).toMatchObject({ model: 'm', bound_page: 100, eligible_count: 1 });
    expect(rows[0].completed_at).not.toBeNull();
  });

  test('실패는 다시 맡을 수 있고 시도 횟수가 오른다 — 멈춘 pending 도 다시 맡는다', async () => {
    const repo = createPgNoteReviewRepository(db());
    await repo.claim(D, BOOK, meta);
    await repo.fail(D, BOOK, 'timeout');
    expect(await repo.find(D, BOOK)).toMatchObject({
      status: 'failed',
      result: null,
      last_error: 'timeout',
    });
    expect(await repo.claim(D, BOOK, meta)).toBe('claimed');
    await pool.query(`UPDATE note_reviews SET started_at = now() - interval '10 minutes'`);
    expect(await repo.claim(D, BOOK, meta)).toBe('claimed');
    expect((await repo.find(D, BOOK))?.attempts).toBe(3);
  });

  test('FR-SPL-002: 채점 근거 조회는 상한 쪽까지만 — 상한 밖 사건·장 요약 0건, 올리면 보인다 (positive 쌍)', async () => {
    await pool.query(`ALTER TABLE books ADD COLUMN author TEXT NOT NULL DEFAULT '김내성'`);
    await pool.query(
      `CREATE TABLE chapters (book_id TEXT, chapter_no INT, title TEXT, start_page INT, end_page INT)`
    );
    await pool.query(`CREATE TABLE chapter_summaries (book_id TEXT, chapter_no INT, summary TEXT)`);
    await pool.query(
      `CREATE TABLE events (id TEXT, book_id TEXT, event TEXT, description TEXT, occurrence_page INT)`
    );
    await pool.query(
      `CREATE TABLE characters (id TEXT, book_id TEXT, name TEXT, first_appearance_page INT)`
    );
    await pool.query(
      `CREATE TABLE character_notes (id TEXT, book_id TEXT, character_id TEXT, note TEXT, source_page INT)`
    );
    await pool.query(`INSERT INTO chapters VALUES ($1, 1, '앞', 1, 50), ($1, 2, '결말', 51, 100)`, [
      BOOK,
    ]);
    await pool.query(
      `INSERT INTO chapter_summaries VALUES ($1, 1, '앞 요약'), ($1, 2, '결말 요약')`,
      [BOOK]
    );
    await pool.query(
      `INSERT INTO events VALUES ('e1', $1, '앞 사건', 'd', 10), ('e2', $1, '결말 사건', 'd', 95)`,
      [BOOK]
    );
    await pool.query(
      `INSERT INTO characters VALUES ('c1', $1, '유불란', 1), ('c2', $1, '늦게 나온 인물', 80)`,
      [BOOK]
    );
    await pool.query(
      `INSERT INTO character_notes VALUES ('cn1', $1, 'c1', '탐정', 5), ('cn2', $1, 'c1', '정체', 99)`,
      [BOOK]
    );
    const reader = createPgReviewEvidenceReader(db());
    const half = await reader.load(BOOK, 50);
    expect(half.summaries.map((s) => s.content)).toEqual(['앞 요약']);
    expect(half.events.map((e) => e.event)).toEqual(['앞 사건']);
    expect(half.characters.map((c) => c.name)).toEqual(['유불란']);
    expect(half.character_notes.map((n) => n.note)).toEqual(['탐정']);
    const full = await reader.load(BOOK, 100);
    expect(full.summaries.map((s) => s.content)).toEqual(['앞 요약', '결말 요약']);
    expect(full.events).toHaveLength(2);
    expect(full.character_notes).toHaveLength(2);
    expect(full.author).toBe('김내성');
  });
});
