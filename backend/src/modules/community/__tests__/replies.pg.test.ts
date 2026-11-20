import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { createPgCommunityRepository } from '../pg-repository';

// 실제 Postgres — 016·022·024·027 + users(010). COMMUNITY_TEST_DATABASE_URL 이 있을 때만 (T19, 2026-11-20)
const PG_URL = process.env.COMMUNITY_TEST_DATABASE_URL;
const MIGRATIONS = path.join(__dirname, '../../../../migrations');
const BOOK = 'bk-open';
const OTHER = 'bk-other';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

(PG_URL ? describe : describe.skip)('실제 Postgres — 댓글·답글 (migration 027)', () => {
  let pool: Pool;
  let schema: string;
  let repo: ReturnType<typeof createPgCommunityRepository>;

  async function apply(file: string) {
    await pool.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }

  beforeEach(async () => {
    schema = `rep_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const setup = new Pool({ connectionString: PG_URL, max: 1 });
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.end();
    pool = new Pool({ connectionString: PG_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE books (book_id TEXT PRIMARY KEY, title TEXT NOT NULL)`);
    await pool.query(`INSERT INTO books VALUES ($1, '탁류'), ($2, '가상범인')`, [BOOK, OTHER]);
    await pool.query(`CREATE TABLE users (
      user_id UUID PRIMARY KEY, reader_id UUID NOT NULL UNIQUE, display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const file of ['016_community.sql', '022_community_moderation.sql', '024_community_likes.sql', '027_community_replies.sql']) {
      await apply(file);
    }
    repo = createPgCommunityRepository({ query: (sql, params) => pool.query(sql, params) });
  });

  afterEach(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  test('migration 027: kind 없이 댓글 저장, 두 번 적용해도 그대로, community_comment_likes RLS·PK (comment_id, reader_id)', async () => {
    await apply('027_community_replies.sql');
    const post = await repo.createPost(BOOK, A, '말머리 없는 댓글');
    expect(post.kind).toBeNull();
    const rls = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'community_comment_likes' AND relnamespace = $1::regnamespace`,
      [schema]
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const pk = await pool.query(
      `SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY a.attname`,
      [`${schema}.community_comment_likes`]
    );
    expect(pk.rows.map((r) => r.attname)).toEqual(['comment_id', 'reader_id']);
  });

  test('답글: 댓글에 바로 단 답글은 reply_to_* 가 null, 답글에 단 답글은 대상 id·작성자·이름이 채워진다', async () => {
    await pool.query(`INSERT INTO users (user_id, reader_id, display_name) VALUES ($1, $2, '책벌레')`, [randomUUID(), B]);
    const post = await repo.createPost(BOOK, A, '댓글');
    const first = await repo.createComment(BOOK, post.post_id, B, '첫 답글', null);
    expect(first).not.toBeNull();
    expect(first!.reply_to_comment_id).toBeNull();
    const second = await repo.createComment(BOOK, post.post_id, C, '답글의 답글', first!.comment_id);
    expect(second!.reply_to_comment_id).toBe(first!.comment_id);
    const list = await repo.listComments(BOOK, post.post_id);
    expect(list.map((c) => c.body)).toEqual(['첫 답글', '답글의 답글']);
    expect(list[1]).toMatchObject({
      reply_to_comment_id: first!.comment_id,
      reply_to_reader_id: B,
      reply_to_name: '책벌레',
    });
    expect(list[0]).toMatchObject({ reply_to_comment_id: null, reply_to_reader_id: null, reply_to_name: null });
  });

  test('답글 대상이 나중에 숨김·삭제되면 대상 id 는 남고 작성자·이름은 null', async () => {
    await pool.query(`INSERT INTO users (user_id, reader_id, display_name) VALUES ($1, $2, '책벌레')`, [randomUUID(), B]);
    const post = await repo.createPost(BOOK, A, '댓글');
    const hidden = await repo.createComment(BOOK, post.post_id, B, '숨길 답글', null);
    const removed = await repo.createComment(BOOK, post.post_id, B, '지울 답글', null);
    await repo.createComment(BOOK, post.post_id, C, '숨김 대상에 답', hidden!.comment_id);
    await repo.createComment(BOOK, post.post_id, C, '삭제 대상에 답', removed!.comment_id);
    await pool.query(`UPDATE community_comments SET hidden_at = now() WHERE comment_id = $1`, [hidden!.comment_id]);
    await repo.deleteComment(BOOK, removed!.comment_id, B);
    const list = await repo.listComments(BOOK, post.post_id);
    expect(list.map((c) => [c.body, c.reply_to_comment_id !== null, c.reply_to_reader_id, c.reply_to_name])).toEqual([
      ['숨김 대상에 답', true, null, null],
      ['삭제 대상에 답', true, null, null],
    ]);
  });

  test('Review Focus 1: 숨김·삭제·다른 댓글의 답글을 대상으로 하면 null, 저장 0건', async () => {
    const post = await repo.createPost(BOOK, A, '댓글');
    const other = await repo.createPost(BOOK, A, '다른 댓글');
    const hidden = await repo.createComment(BOOK, post.post_id, B, '숨길 답글', null);
    const deleted = await repo.createComment(BOOK, post.post_id, B, '지울 답글', null);
    const foreign = await repo.createComment(BOOK, other.post_id, B, '다른 묶음 답글', null);
    await pool.query(`UPDATE community_comments SET hidden_at = now() WHERE comment_id = $1`, [hidden!.comment_id]);
    await repo.deleteComment(BOOK, deleted!.comment_id, B);
    const before = (await pool.query(`SELECT count(*)::int AS n FROM community_comments`)).rows[0].n;
    for (const target of [hidden!.comment_id, deleted!.comment_id, foreign!.comment_id, randomUUID()]) {
      expect(await repo.createComment(BOOK, post.post_id, C, '답', target)).toBeNull();
    }
    expect((await pool.query(`SELECT count(*)::int AS n FROM community_comments`)).rows[0].n).toBe(before);
  });

  test('Review Focus 2: users.display_name 이 있으면 author_name, 없거나 users 행이 없으면 null', async () => {
    await pool.query(
      `INSERT INTO users (user_id, reader_id, display_name) VALUES ($1, $2, '달빛서재'), ($3, $4, NULL)`,
      [randomUUID(), A, randomUUID(), B]
    );
    const named = await repo.createPost(BOOK, A, '이름 있음');
    const blank = await repo.createPost(BOOK, B, '이름 비움');
    const none = await repo.createPost(BOOK, C, '계정 없음');
    expect((await repo.getPost(BOOK, named.post_id))!.author_name).toBe('달빛서재');
    expect((await repo.getPost(BOOK, blank.post_id))!.author_name).toBeNull();
    expect((await repo.getPost(BOOK, none.post_id))!.author_name).toBeNull();
    const reply = await repo.createComment(BOOK, named.post_id, A, '내 답글', null);
    expect((await repo.listComments(BOOK, named.post_id))[0].author_name).toBe('달빛서재');
    expect(reply).not.toBeNull();
    const list = await repo.listPosts(BOOK, { limit: 10 });
    expect(list.find((p) => p.post_id === named.post_id)!.author_name).toBe('달빛서재');
  });

  test('답글 좋아요: 한 독자 한 번(멱등), 취소, 숨김·삭제 답글은 false, listComments 의 like_count·liked_by_me 반영', async () => {
    const post = await repo.createPost(BOOK, A, '댓글');
    const reply = await repo.createComment(BOOK, post.post_id, B, '답글', null);
    expect(await repo.likeComment(BOOK, reply!.comment_id, C)).toBe(true);
    expect(await repo.likeComment(BOOK, reply!.comment_id, C)).toBe(true);
    expect(await repo.commentLikeState(BOOK, reply!.comment_id, C)).toEqual({ like_count: 1, liked_by_me: true });
    expect((await repo.listComments(BOOK, post.post_id, C))[0]).toMatchObject({ like_count: 1, liked_by_me: true });
    expect((await repo.listComments(BOOK, post.post_id, A))[0]).toMatchObject({ like_count: 1, liked_by_me: false });
    expect(await repo.unlikeComment(BOOK, reply!.comment_id, C)).toBe(true);
    expect(await repo.commentLikeState(BOOK, reply!.comment_id, C)).toEqual({ like_count: 0, liked_by_me: false });
    expect(await repo.likeComment(OTHER, reply!.comment_id, C)).toBe(false);
    await repo.deleteComment(BOOK, reply!.comment_id, B);
    expect(await repo.likeComment(BOOK, reply!.comment_id, C)).toBe(false);
    const hidden = await repo.createComment(BOOK, post.post_id, B, '숨길 답글', null);
    await pool.query(`UPDATE community_comments SET hidden_at = now() WHERE comment_id = $1`, [hidden!.comment_id]);
    expect(await repo.likeComment(BOOK, hidden!.comment_id, C)).toBe(false);
  });

  test('Review Focus 3: 삭제된 댓글 아래 남은 답글도 좋아요가 되고, 삭제된 댓글에는 새 답글이 null', async () => {
    const post = await repo.createPost(BOOK, A, '댓글');
    const reply = await repo.createComment(BOOK, post.post_id, B, '답글', null);
    await repo.deletePost(BOOK, post.post_id, A);
    expect(await repo.likeComment(BOOK, reply!.comment_id, C)).toBe(true);
    expect(await repo.createComment(BOOK, post.post_id, C, '새 답글', null)).toBeNull();
  });

  test('기존 데이터: kind=theory|review 글은 그대로 읽히고 kind 필드만 남는다', async () => {
    await pool.query(
      `INSERT INTO community_posts (post_id, book_id, reader_id, kind, body) VALUES ($1, $2, $3, 'theory', '옛 추리 글')`,
      [randomUUID(), BOOK, A]
    );
    const list = await repo.listPosts(BOOK, { limit: 10 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'theory', body: '옛 추리 글', author_name: null });
  });
});
