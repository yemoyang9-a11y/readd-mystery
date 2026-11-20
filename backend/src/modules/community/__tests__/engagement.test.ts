/**
 * 커뮤니티 공감·인기순·허브 (2026-11-18 대표 지시 "책 다 읽고 커뮤니티로 바로, 커뮤니티 형성")
 *
 * 접근 규칙: 끝까지 간 독자(서버 reached_end — 가장 멀리 펼친 쪽 = 마지막 쪽)만 글·개수를 본다
 * (대표 결정 2026-11-19 정정 — 차례 읽기는 따지지 않음). 새 경로도 모두 같은 관문을 지나며,
 * 끝까지 가지 않은 독자의 요청에서는 저장소를 아예 부르지 않는다 (절대 규칙 7).
 * 여기서 FINISHER 는 "끝까지 간 독자", NON_FINISHER 는 "끝까지 가지 않은 독자"다.
 *
 * 조항: FR-QNA-004 🚦 (커뮤니티 관문 파생값 reached_end), FR-SPL-005 🚦 / R11 (실패 = 미노출), R12 🚦 (미공개 도서)
 * negative 는 positive 와 쌍으로 둔다 (CLAUDE.md 7장).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import express from 'express';
import { Pool } from 'pg';
import { createCommunityRouter } from '../router';
import { createPgCommunityRepository } from '../pg-repository';
import type {
  CommentRow,
  CommunityEngagementRepository,
  CommunityRepository,
  ListPostsQuery,
  PostRow,
} from '../repository';
import type { BookCatalogRow } from '../../content/repository';

const FINISHER = '11111111-1111-4111-8111-111111111111';
const FINISHER_2 = '22222222-2222-4222-8222-222222222222';
const NON_FINISHER = '33333333-3333-4333-8333-333333333333';
const BOOK = 'bk-open';
const OTHER = 'bk-other';
const DRAFT = 'bk-draft';
const SECRET = '범인은 집사였다';

type Stored = PostRow & { book_id: string; hidden: boolean };
type StoredReply = { comment_id: string; post_id: string; book_id: string; reader_id: string; body: string; deleted: boolean; hidden: boolean };

class FakeStore implements CommunityRepository, CommunityEngagementRepository {
  posts: Stored[] = [];
  likes = new Set<string>();
  replies: StoredReply[] = [];
  replyLikes = new Set<string>();
  touched: string[] = [];
  private seq = 0;

  private visible(p: Stored) {
    return !p.hidden && !p.deleted;
  }

  private likeCount(postId: string) {
    return [...this.likes].filter((k) => k.startsWith(`${postId}:`)).length;
  }

  private view(p: Stored, viewerId?: string): PostRow {
    const { book_id: _b, hidden: _h, ...row } = p;
    const live = this.visible(p);
    return {
      ...row,
      like_count: live ? this.likeCount(p.post_id) : 0,
      liked_by_me: live && viewerId !== undefined && this.likes.has(`${p.post_id}:${viewerId}`),
    };
  }

  seed(bookId: string, body: string, opts: Partial<Stored> = {}) {
    this.seq += 1;
    const post: Stored = {
      seq: this.seq,
      post_id: randomUUID(),
      reader_id: FINISHER,
      kind: null,
      author_name: null,
      body,
      created_at: new Date().toISOString(),
      deleted: false,
      comment_count: 0,
      book_id: bookId,
      hidden: false,
      ...opts,
    };
    this.posts.push(post);
    return post;
  }

  async listPosts(bookId: string, q: ListPostsQuery) {
    this.touched.push('listPosts');
    let rows = this.posts.filter((p) => p.book_id === bookId && !p.hidden && !p.deleted);
    if (q.sort === 'popular') {
      rows = rows
        .sort((a, b) => this.likeCount(b.post_id) - this.likeCount(a.post_id) || b.seq - a.seq)
        .slice(q.offset ?? 0);
    } else {
      rows = rows.filter((p) => q.before === undefined || p.seq < q.before).sort((a, b) => b.seq - a.seq);
    }
    return rows.slice(0, q.limit).map((p) => this.view(p, q.viewerId));
  }
  async getPost(bookId: string, postId: string, viewerId?: string) {
    this.touched.push('getPost');
    const p = this.posts.find((x) => x.post_id === postId && x.book_id === bookId && !x.hidden);
    return p ? this.view(p, viewerId) : null;
  }
  async listComments(): Promise<CommentRow[]> {
    this.touched.push('listComments');
    return [];
  }
  async createPost(bookId: string, readerId: string, body: string) {
    this.touched.push('createPost');
    return this.view(this.seed(bookId, body, { reader_id: readerId }));
  }
  async createComment() {
    return null;
  }

  seedReply(postId: string, opts: Partial<StoredReply> = {}) {
    const post = this.posts.find((p) => p.post_id === postId)!;
    const reply: StoredReply = {
      comment_id: randomUUID(),
      post_id: postId,
      book_id: post.book_id,
      reader_id: FINISHER,
      body: '답글',
      deleted: false,
      hidden: false,
      ...opts,
    };
    this.replies.push(reply);
    return reply;
  }
  private likeableReply(bookId: string, commentId: string) {
    const r = this.replies.find((x) => x.comment_id === commentId && x.book_id === bookId);
    const post = r && this.posts.find((p) => p.post_id === r.post_id);
    return r && post && !r.deleted && !r.hidden && !post.hidden ? r : null;
  }
  async likeComment(bookId: string, commentId: string, readerId: string) {
    this.touched.push('likeComment');
    if (!this.likeableReply(bookId, commentId)) return false;
    this.replyLikes.add(`${commentId}:${readerId}`);
    return true;
  }
  async unlikeComment(bookId: string, commentId: string, readerId: string) {
    this.touched.push('unlikeComment');
    if (!this.likeableReply(bookId, commentId)) return false;
    this.replyLikes.delete(`${commentId}:${readerId}`);
    return true;
  }
  async commentLikeState(_bookId: string, commentId: string, readerId: string) {
    this.touched.push('commentLikeState');
    return {
      like_count: [...this.replyLikes].filter((k) => k.startsWith(`${commentId}:`)).length,
      liked_by_me: this.replyLikes.has(`${commentId}:${readerId}`),
    };
  }
  async deletePost() {
    return false;
  }
  async deleteComment() {
    return false;
  }
  async countRecentPosts() {
    return 0;
  }
  async countRecentComments() {
    return 0;
  }
  async createReport() {
    return false;
  }

  async likePost(bookId: string, postId: string, readerId: string) {
    this.touched.push('likePost');
    const p = this.posts.find((x) => x.post_id === postId && x.book_id === bookId);
    if (!p || !this.visible(p)) return false;
    this.likes.add(`${postId}:${readerId}`);
    return true;
  }
  async unlikePost(bookId: string, postId: string, readerId: string) {
    this.touched.push('unlikePost');
    const p = this.posts.find((x) => x.post_id === postId && x.book_id === bookId);
    if (!p || !this.visible(p)) return false;
    this.likes.delete(`${postId}:${readerId}`);
    return true;
  }
  async likeState(_bookId: string, postId: string, readerId: string) {
    this.touched.push('likeState');
    return { like_count: this.likeCount(postId), liked_by_me: this.likes.has(`${postId}:${readerId}`) };
  }
  async countVisiblePosts(bookId: string) {
    this.touched.push(`countVisiblePosts:${bookId}`);
    return this.posts.filter((p) => p.book_id === bookId && this.visible(p)).length;
  }
}

const CATALOG: BookCatalogRow[] = [
  { book_id: BOOK, title: '가상범인', author: '김내성', cover_url: null, intro_summary: null, ssabi_ready: true, genre: null, registered_at: '2026-11-01T00:00:00.000Z' },
  { book_id: OTHER, title: '타원형의 거울', author: '김내성', cover_url: null, intro_summary: null, ssabi_ready: true, genre: null, registered_at: '2026-11-01T00:00:00.000Z' },
  { book_id: DRAFT, title: '마인', author: '김내성', cover_url: null, intro_summary: null, ssabi_ready: false, genre: null, registered_at: '2026-11-01T00:00:00.000Z' },
];

describe('커뮤니티 공감·인기순·허브', () => {
  let server: Server;
  let baseUrl: string;
  let store: FakeStore;
  let completed: Set<string>;
  let snapshotFails: Set<string>;

  beforeEach(async () => {
    store = new FakeStore();
    completed = new Set([`${FINISHER}:${BOOK}`, `${FINISHER_2}:${BOOK}`]);
    snapshotFails = new Set();
    const app = express();
    app.use(
      createCommunityRouter({
        community: store,
        engagement: store,
        content: {
          findReadiness: async (bookId: string) =>
            CATALOG.find((b) => b.book_id === bookId)?.ssabi_ready ?? null,
          findCatalog: async () => CATALOG,
        },
        cutoff: {
          getCutoffSnapshot: async (deviceId: string, bookId: string) => {
            if (snapshotFails.has(bookId)) throw new Error('snapshot failed');
            return { reached_end: completed.has(`${deviceId}:${bookId}`) } as any;
          },
        },
      })
    );
    app.use((_e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function call(method: string, path: string, reader: string | null) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(reader ? { 'x-device-id': reader } : {}) },
    });
  }

  const base = `/books/${BOOK}/community`;

  // ── 공감 ────────────────────────────────────────────────────────────────

  test('FR-QNA-004: 끝까지 가지 않은 독자는 공감·공감 취소 403, 저장소 접근 0건', async () => {
    const post = store.seed(BOOK, SECRET);
    for (const method of ['POST', 'DELETE']) {
      const res = await call(method, `${base}/posts/${post.post_id}/like`, NON_FINISHER);
      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).not.toContain('like_count');
      expect(text).not.toContain(SECRET);
    }
    expect(store.touched).toEqual([]);
    expect(store.likes.size).toBe(0);
  });

  test('FR-QNA-004: 끝까지 간 독자는 공감·공감 취소가 되고 like_count·liked_by_me 가 반영된다', async () => {
    const post = store.seed(BOOK, SECRET);
    const liked = await call('POST', `${base}/posts/${post.post_id}/like`, FINISHER);
    expect(liked.status).toBe(200);
    expect(await liked.json()).toEqual({ like_count: 1, liked_by_me: true });
    // 같은 독자가 다시 눌러도 1 — 한 독자 한 공감 (PK(post_id, reader_id))
    expect(await (await call('POST', `${base}/posts/${post.post_id}/like`, FINISHER)).json()).toEqual({
      like_count: 1,
      liked_by_me: true,
    });
    await call('POST', `${base}/posts/${post.post_id}/like`, FINISHER_2);

    const asA = (await (await call('GET', `${base}/posts`, FINISHER)).json()) as any;
    expect(asA.posts[0]).toMatchObject({ like_count: 2, liked_by_me: true });

    const unliked = await call('DELETE', `${base}/posts/${post.post_id}/like`, FINISHER);
    expect(unliked.status).toBe(200);
    expect(await unliked.json()).toEqual({ like_count: 1, liked_by_me: false });
    const asB = (await (await call('GET', `${base}/posts`, FINISHER_2)).json()) as any;
    expect(asB.posts[0]).toMatchObject({ like_count: 1, liked_by_me: true });
  });

  test('목록에 보이는 댓글 전체 수(total_count)가 함께 온다 — 20개씩 받아도 전체 수, 숨김·삭제 제외', async () => {
    for (let i = 0; i < 23; i += 1) store.seed(BOOK, `댓글 ${i}`);
    store.seed(BOOK, '숨김', { hidden: true });
    store.seed(BOOK, '삭제', { deleted: true });
    for (const sort of ['new', 'popular']) {
      const page = (await (await call('GET', `${base}/posts?sort=${sort}`, FINISHER)).json()) as any;
      expect(page.posts).toHaveLength(20);
      expect(page.total_count).toBe(23);
    }
  });

  test('FR-QNA-004: 끝까지 가지 않은 독자는 답글 좋아요·취소 403, 저장소 접근 0건 — 끝까지 가면 된다 (positive 쌍)', async () => {
    const reply = store.seedReply(store.seed(BOOK, SECRET).post_id);
    for (const method of ['POST', 'DELETE']) {
      const res = await call(method, `${base}/comments/${reply.comment_id}/like`, NON_FINISHER);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('like_count');
    }
    expect(store.touched).toEqual([]);
    completed.add(`${NON_FINISHER}:${BOOK}`);
    const ok = await call('POST', `${base}/comments/${reply.comment_id}/like`, NON_FINISHER);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ like_count: 1, liked_by_me: true });
  });

  test('답글 좋아요: 누르면 like_count 1·liked_by_me true, 취소하면 0·false, 다른 도서·숨김·없는 답글은 404', async () => {
    const post = store.seed(BOOK, SECRET);
    const reply = store.seedReply(post.post_id);
    const url = `${base}/comments/${reply.comment_id}/like`;
    expect(await (await call('POST', url, FINISHER)).json()).toEqual({ like_count: 1, liked_by_me: true });
    expect(await (await call('POST', url, FINISHER)).json()).toEqual({ like_count: 1, liked_by_me: true });
    const off = await call('DELETE', url, FINISHER);
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ like_count: 0, liked_by_me: false });
    const hidden = store.seedReply(post.post_id, { hidden: true });
    const otherBook = store.seedReply(store.seed(OTHER, '다른 책').post_id);
    for (const id of [hidden.comment_id, otherBook.comment_id, randomUUID(), 'not-a-uuid']) {
      expect((await call('POST', `${base}/comments/${id}/like`, FINISHER)).status).toBe(404);
    }
  });

  test('Review Focus 3: 삭제된 댓글 아래 남은 답글도 좋아요가 된다', async () => {
    const post = store.seed(BOOK, SECRET, { deleted: true });
    const reply = store.seedReply(post.post_id);
    const res = await call('POST', `${base}/comments/${reply.comment_id}/like`, FINISHER);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ like_count: 1, liked_by_me: true });
  });

  test('글 상세도 목록과 같은 공감 상태 — 누른 독자는 true, 안 누른 독자는 false (2026-11-18 E2E #72)', async () => {
    const post = store.seed(BOOK, SECRET);
    await call('POST', `${base}/posts/${post.post_id}/like`, FINISHER);
    const mine = (await (await call('GET', `${base}/posts/${post.post_id}`, FINISHER)).json()) as any;
    expect(mine.post).toMatchObject({ like_count: 1, liked_by_me: true });
    const other = (await (await call('GET', `${base}/posts/${post.post_id}`, FINISHER_2)).json()) as any;
    expect(other.post).toMatchObject({ like_count: 1, liked_by_me: false });
  });

  test('공감: 숨김·삭제·없는 글은 404, 다른 도서의 글도 404', async () => {
    const hidden = store.seed(BOOK, '숨김', { hidden: true });
    const deleted = store.seed(BOOK, '삭제', { deleted: true });
    const elsewhere = store.seed(OTHER, '다른 책');
    for (const id of [hidden.post_id, deleted.post_id, elsewhere.post_id, randomUUID(), 'not-a-uuid']) {
      expect((await call('POST', `${base}/posts/${id}/like`, FINISHER)).status).toBe(404);
      expect((await call('DELETE', `${base}/posts/${id}/like`, FINISHER)).status).toBe(404);
    }
    expect(store.likes.size).toBe(0);
    // positive 쌍 — 보이는 글은 된다
    const live = store.seed(BOOK, '보이는 글');
    expect((await call('POST', `${base}/posts/${live.post_id}/like`, FINISHER)).status).toBe(200);
  });

  test('R12: 미공개 도서의 공감은 404', async () => {
    completed.add(`${FINISHER}:${DRAFT}`);
    const post = store.seed(DRAFT, '초안');
    expect((await call('POST', `/books/${DRAFT}/community/posts/${post.post_id}/like`, FINISHER)).status).toBe(404);
  });

  // ── 인기순 ──────────────────────────────────────────────────────────────

  test('인기순: 공감 많은 순, 같으면 최신순, 20개씩 이어 받기', async () => {
    const posts = Array.from({ length: 25 }, (_, i) => store.seed(BOOK, `글 ${i}`));
    store.likes.add(`${posts[3].post_id}:${FINISHER}`);
    store.likes.add(`${posts[3].post_id}:${FINISHER_2}`);
    store.likes.add(`${posts[10].post_id}:${FINISHER}`);
    const first = (await (await call('GET', `${base}/posts?sort=popular`, FINISHER)).json()) as any;
    expect(first.posts.map((p: any) => p.body).slice(0, 3)).toEqual(['글 3', '글 10', '글 24']);
    expect(first.posts).toHaveLength(20);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = (await (
      await call('GET', `${base}/posts?sort=popular&cursor=${first.next_cursor}`, FINISHER)
    ).json()) as any;
    expect(second.posts).toHaveLength(5);
    expect(second.next_cursor).toBeNull();
    const seen = new Set([...first.posts, ...second.posts].map((p: any) => p.post_id));
    expect(seen.size).toBe(25);
  });

  test('정렬값 검증: new|popular 외에는 400, 최신순 커서를 인기순에 쓰면 400', async () => {
    expect((await call('GET', `${base}/posts?sort=hot`, FINISHER)).status).toBe(400);
    for (let i = 0; i < 21; i += 1) store.seed(BOOK, `글 ${i}`);
    const latest = (await (await call('GET', `${base}/posts`, FINISHER)).json()) as any;
    expect((await call('GET', `${base}/posts?sort=popular&cursor=${latest.next_cursor}`, FINISHER)).status).toBe(400);
    expect((await call('GET', `${base}/posts?sort=new&cursor=${latest.next_cursor}`, FINISHER)).status).toBe(200);
  });

  test('FR-QNA-004: 끝까지 가지 않은 독자는 인기순 목록도 403, 저장소 접근 0건', async () => {
    store.seed(BOOK, SECRET);
    const res = await call('GET', `${base}/posts?sort=popular`, NON_FINISHER);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(SECRET);
    expect(store.touched).toEqual([]);
  });

  // ── 허브 ────────────────────────────────────────────────────────────────

  test('FR-QNA-004: 허브 — 끝까지 가지 않은 도서는 잠김으로만 오고 글 수가 없으며 개수 조회도 0건', async () => {
    store.seed(BOOK, SECRET);
    store.seed(OTHER, '다른 책의 결말');
    const res = await call('GET', '/community/books', FINISHER);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    const other = body.books.find((b: any) => b.book_id === OTHER);
    expect(other).toEqual({ book_id: OTHER, title: '타원형의 거울', author: '김내성', cover_url: null, access: 'locked' });
    expect(store.touched).not.toContain(`countVisiblePosts:${OTHER}`);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('다른 책의 결말');
  });

  test('FR-QNA-004: 허브 — 끝까지 간 도서는 열림과 글 수(숨김·삭제 제외)가 온다', async () => {
    store.seed(BOOK, '하나');
    store.seed(BOOK, '둘');
    store.seed(BOOK, '숨김', { hidden: true });
    store.seed(BOOK, '삭제', { deleted: true });
    const body = (await (await call('GET', '/community/books', FINISHER)).json()) as any;
    expect(body.books.find((b: any) => b.book_id === BOOK)).toMatchObject({ access: 'open', post_count: 2 });
  });

  test('FR-QNA-004: 허브 — 아무 책도 끝까지 가지 않은 독자에게는 모든 도서가 잠김, 글 수 0개 필드', async () => {
    store.seed(BOOK, SECRET);
    const text = await (await call('GET', '/community/books', NON_FINISHER)).text();
    const body = JSON.parse(text);
    expect(body.books.map((b: any) => b.access)).toEqual(['locked', 'locked']);
    expect(text).not.toContain('post_count');
    expect(store.touched).toEqual([]);
  });

  test('R12: 허브에 미공개(싸비 미완비) 도서는 나오지 않는다', async () => {
    completed.add(`${FINISHER}:${DRAFT}`);
    const body = (await (await call('GET', '/community/books', FINISHER)).json()) as any;
    expect(body.books.map((b: any) => b.book_id)).toEqual([BOOK, OTHER]);
  });

  test('FR-SPL-005: 허브 — 기준점 조회가 실패한 도서는 잠김으로 내려가고 개수를 조회하지 않는다', async () => {
    completed.add(`${FINISHER}:${OTHER}`);
    snapshotFails.add(OTHER);
    const body = (await (await call('GET', '/community/books', FINISHER)).json()) as any;
    expect(body.books.find((b: any) => b.book_id === OTHER)).toEqual(expect.objectContaining({ access: 'locked' }));
    expect(body.books.find((b: any) => b.book_id === OTHER).post_count).toBeUndefined();
    expect(store.touched).not.toContain(`countVisiblePosts:${OTHER}`);
    // positive 쌍 — 실패하지 않은 끝까지 간 도서는 그대로 열린다
    expect(body.books.find((b: any) => b.book_id === BOOK).access).toBe('open');
  });

  test('허브: 독자 식별 헤더가 없으면 400', async () => {
    expect((await call('GET', '/community/books', null)).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 실제 Postgres — pg-repository + 016·022·024 마이그레이션. COMMUNITY_TEST_DATABASE_URL 이 있을 때만
// ---------------------------------------------------------------------------
const PG_URL = process.env.COMMUNITY_TEST_DATABASE_URL;
const MIGRATIONS = path.join(__dirname, '../../../../migrations');

(PG_URL ? describe : describe.skip)('실제 Postgres — 공감·인기순·글 수 (pg-repository)', () => {
  let pool: Pool;
  let schema: string;
  let repo: ReturnType<typeof createPgCommunityRepository>;

  beforeEach(async () => {
    schema = `eng_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const setup = new Pool({ connectionString: PG_URL, max: 1 });
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.end();
    pool = new Pool({ connectionString: PG_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE books (book_id TEXT PRIMARY KEY, title TEXT NOT NULL)`);
    await pool.query(`INSERT INTO books VALUES ($1, '가상범인'), ($2, '타원형의 거울')`, [BOOK, OTHER]);
    await pool.query(`CREATE TABLE users (user_id UUID PRIMARY KEY, reader_id UUID NOT NULL UNIQUE, display_name TEXT)`);
    for (const file of ['016_community.sql', '022_community_moderation.sql', '024_community_likes.sql', '027_community_replies.sql']) {
      await pool.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
    }
    // IF NOT EXISTS — 두 번 적용해도 그대로
    await pool.query(fs.readFileSync(path.join(MIGRATIONS, '024_community_likes.sql'), 'utf8'));
    repo = createPgCommunityRepository({ query: (sql, params) => pool.query(sql, params) });
  });

  afterEach(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  test('migration 024: community_post_likes 에 RLS 가 켜져 있고 PK 는 (post_id, reader_id)', async () => {
    const rls = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'community_post_likes' AND relnamespace = $1::regnamespace`,
      [schema]
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const pk = await pool.query(
      `SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = ($1 || '.community_post_likes')::regclass AND i.indisprimary
        ORDER BY a.attname`,
      [schema]
    );
    expect(pk.rows.map((r) => r.attname)).toEqual(['post_id', 'reader_id']);
  });

  test('공감: 한 독자 한 번, 취소, like_count·liked_by_me 가 목록에 반영된다', async () => {
    const post = await repo.createPost(BOOK, FINISHER, '추리');
    expect(await repo.likePost(BOOK, post.post_id, FINISHER)).toBe(true);
    expect(await repo.likePost(BOOK, post.post_id, FINISHER)).toBe(true);
    expect(await repo.likePost(BOOK, post.post_id, FINISHER_2)).toBe(true);
    expect(await repo.likeState(BOOK, post.post_id, FINISHER)).toEqual({ like_count: 2, liked_by_me: true });
    const [asA] = await repo.listPosts(BOOK, { limit: 5, viewerId: FINISHER });
    expect(asA).toMatchObject({ like_count: 2, liked_by_me: true });
    const [anon] = await repo.listPosts(BOOK, { limit: 5 });
    expect(anon.liked_by_me).toBe(false);
    expect(await repo.unlikePost(BOOK, post.post_id, FINISHER)).toBe(true);
    expect(await repo.likeState(BOOK, post.post_id, FINISHER)).toEqual({ like_count: 1, liked_by_me: false });
    // 다른 도서 ID 로는 공감할 수 없다
    expect(await repo.likePost(OTHER, post.post_id, FINISHER)).toBe(false);
  });

  test('숨김·삭제 글: 공감 불가(false), 삭제 글은 목록에서 공감 0, 글 수에서 빠진다', async () => {
    const hidden = await repo.createPost(BOOK, FINISHER, '숨김');
    const removed = await repo.createPost(BOOK, FINISHER, '삭제');
    const live = await repo.createPost(BOOK, FINISHER, '보임');
    await repo.likePost(BOOK, removed.post_id, FINISHER_2);
    await repo.createComment(BOOK, removed.post_id, FINISHER_2, '댓글이 남아 삭제 글이 보인다', null);
    await pool.query(`UPDATE community_posts SET hidden_at = now() WHERE post_id = $1`, [hidden.post_id]);
    await repo.deletePost(BOOK, removed.post_id, FINISHER);
    expect(await repo.likePost(BOOK, hidden.post_id, FINISHER)).toBe(false);
    expect(await repo.likePost(BOOK, removed.post_id, FINISHER)).toBe(false);
    expect(await repo.unlikePost(BOOK, removed.post_id, FINISHER_2)).toBe(false);
    expect(await repo.likePost(BOOK, live.post_id, FINISHER)).toBe(true);
    const rows = await repo.listPosts(BOOK, { limit: 10, viewerId: FINISHER_2 });
    expect(rows.map((r) => r.body)).toEqual(['보임', '삭제']);
    expect(rows.find((r) => r.post_id === removed.post_id)).toMatchObject({
      deleted: true,
      like_count: 0,
      liked_by_me: false,
    });
    expect(await repo.countVisiblePosts(BOOK)).toBe(1);
    expect(await repo.countVisiblePosts(OTHER)).toBe(0);
  });

  test('인기순: 공감 많은 순, 같으면 최신순, offset 으로 이어 받기', async () => {
    const a = await repo.createPost(BOOK, FINISHER, 'A');
    const b = await repo.createPost(BOOK, FINISHER, 'B');
    await repo.createPost(BOOK, FINISHER, 'C');
    await repo.likePost(BOOK, a.post_id, FINISHER);
    await repo.likePost(BOOK, a.post_id, FINISHER_2);
    await repo.likePost(BOOK, b.post_id, FINISHER);
    const all = await repo.listPosts(BOOK, { sort: 'popular', limit: 10 });
    expect(all.map((r) => r.body)).toEqual(['A', 'B', 'C']);
    const next = await repo.listPosts(BOOK, { sort: 'popular', offset: 1, limit: 1 });
    expect(next.map((r) => r.body)).toEqual(['B']);
  });
});
