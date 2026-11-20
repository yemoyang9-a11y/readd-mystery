import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import express from 'express';
import { createCommunityRouter } from '../router';
import { createCommunityAdminRouter } from '../admin-router';
import type {
  CommentRow,
  CommunityAdminRepository,
  CommunityRepository,
  PostRow,
  ReportSummary,
} from '../repository';

const READER_A = '11111111-1111-4111-8111-111111111111';
const READER_B = '22222222-2222-4222-8222-222222222222';
const READER_C = '33333333-3333-4333-8333-333333333333';
const PUBLISHED = 'bk-published';
const DRAFT = 'bk-draft';
const TOKEN = 'a'.repeat(40);

type StoredPost = PostRow & { book_id: string };
type StoredComment = CommentRow & { book_id: string; deleted: boolean };
type StoredReport = ReportSummary & { reporter_id: string };

class FakeCommunity implements CommunityRepository {
  posts: StoredPost[] = [];
  comments: StoredComment[] = [];
  reports: StoredReport[] = [];
  reads = 0;
  private seq = 0;

  private commentCount(postId: string) {
    return this.comments.filter((c) => c.post_id === postId && !c.deleted).length;
  }

  private view(p: StoredPost): PostRow {
    const { book_id: _book, ...row } = p;
    return { ...this.named(row), comment_count: this.commentCount(p.post_id) };
  }

  /** 가입 닉네임(users.display_name) 대역 — 없는 독자는 이름이 없다 */
  names = new Map<string, string>();

  private named<T extends { reader_id: string }>(row: T): T & { author_name: string | null } {
    return { ...row, author_name: this.names.get(row.reader_id) ?? null };
  }

  private commentView(c: StoredComment): CommentRow {
    const { book_id: _book, deleted: _deleted, ...row } = c;
    const target = this.comments.find((x) => x.comment_id === c.reply_to_comment_id);
    return {
      ...this.named(row),
      reply_to_reader_id: target?.reader_id ?? null,
      reply_to_name: target ? (this.names.get(target.reader_id) ?? null) : null,
    };
  }

  async listPosts(bookId: string, q: { before?: number; limit: number }) {
    this.reads += 1;
    return this.posts
      .filter((p) => p.book_id === bookId)
      .filter((p) => q.before === undefined || p.seq < q.before)
      .filter((p) => !p.deleted || this.commentCount(p.post_id) > 0)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, q.limit)
      .map((p) => this.view(p));
  }

  async getPost(bookId: string, postId: string) {
    this.reads += 1;
    const p = this.posts.find((x) => x.post_id === postId && x.book_id === bookId);
    if (!p || (p.deleted && this.commentCount(postId) === 0)) return null;
    return this.view(p);
  }

  async listComments(bookId: string, postId: string) {
    return this.comments
      .filter((c) => c.post_id === postId && c.book_id === bookId && !c.deleted)
      .map((c) => this.commentView(c));
  }

  async createPost(bookId: string, readerId: string, body: string) {
    this.seq += 1;
    const post: StoredPost = {
      seq: this.seq,
      post_id: randomUUID(),
      reader_id: readerId,
      kind: null,
      author_name: null,
      body,
      created_at: new Date().toISOString(),
      deleted: false,
      comment_count: 0,
      book_id: bookId,
    };
    this.posts.push(post);
    return this.view(post);
  }

  async createComment(
    bookId: string,
    postId: string,
    readerId: string,
    body: string,
    replyToCommentId: string | null
  ) {
    const p = this.posts.find((x) => x.post_id === postId && x.book_id === bookId && !x.deleted);
    if (!p) return null;
    if (
      replyToCommentId !== null &&
      !this.comments.some((x) => x.comment_id === replyToCommentId && x.post_id === postId && !x.deleted)
    ) {
      return null;
    }
    const c: StoredComment = {
      comment_id: randomUUID(),
      post_id: postId,
      reader_id: readerId,
      body,
      created_at: new Date().toISOString(),
      author_name: null,
      reply_to_comment_id: replyToCommentId,
      reply_to_reader_id: null,
      reply_to_name: null,
      book_id: bookId,
      deleted: false,
    };
    this.comments.push(c);
    return this.commentView(c);
  }

  async deletePost(bookId: string, postId: string, readerId: string) {
    const p = this.posts.find(
      (x) => x.post_id === postId && x.book_id === bookId && x.reader_id === readerId && !x.deleted
    );
    if (!p) return false;
    p.deleted = true;
    return true;
  }

  async deleteComment(bookId: string, commentId: string, readerId: string) {
    const c = this.comments.find(
      (x) =>
        x.comment_id === commentId && x.book_id === bookId && x.reader_id === readerId && !x.deleted
    );
    if (!c) return false;
    c.deleted = true;
    return true;
  }

  async countRecentPosts(readerId: string) {
    return this.posts.filter((p) => p.reader_id === readerId).length;
  }

  async countRecentComments(readerId: string) {
    return this.comments.filter((c) => c.reader_id === readerId).length;
  }

  async createReport(
    bookId: string,
    reporterId: string,
    targetType: 'post' | 'comment',
    targetId: string,
    reason: string
  ) {
    const found =
      targetType === 'post'
        ? this.posts.find((p) => p.post_id === targetId && p.book_id === bookId)
        : this.comments.find((c) => c.comment_id === targetId && c.book_id === bookId);
    if (!found) return false;
    this.reports.push({
      report_id: randomUUID(),
      book_id: bookId,
      target_type: targetType,
      target_id: targetId,
      reporter_id: reporterId,
      reason,
      created_at: new Date().toISOString(),
      target_body: found.body,
      target_deleted: false,
    });
    return true;
  }
}

describe('community router', () => {
  let server: Server;
  let baseUrl: string;
  let repo: FakeCommunity;
  let completed: Set<string>;
  let snapshotCalls: Array<[string, string]>;
  let adminDeleted: { posts: string[]; comments: string[] };

  beforeEach(async () => {
    repo = new FakeCommunity();
    completed = new Set([`${READER_A}:${PUBLISHED}`, `${READER_B}:${PUBLISHED}`]);
    snapshotCalls = [];
    adminDeleted = { posts: [], comments: [] };
    const admin: CommunityAdminRepository = {
      listReports: async () => repo.reports.map(({ reporter_id: _reporter, ...r }) => r),
      deletePost: async (id) => {
        adminDeleted.posts.push(id);
        const p = repo.posts.find((x) => x.post_id === id && !x.deleted);
        if (!p) return false;
        p.deleted = true;
        return true;
      },
      deleteComment: async (id) => {
        adminDeleted.comments.push(id);
        return true;
      },
    };
    const app = express();
    app.use(
      createCommunityRouter({
        community: repo,
        content: {
          findReadiness: async (bookId: string) =>
            bookId === PUBLISHED ? true : bookId === DRAFT ? false : null,
        },
        cutoff: {
          getCutoffSnapshot: async (deviceId: string, bookId: string) => {
            snapshotCalls.push([deviceId, bookId]);
            return { reached_end: completed.has(`${deviceId}:${bookId}`) } as any;
          },
        },
      })
    );
    app.use(
      '/admin/community',
      (req, res, next) => {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.status(401).json({ error: 'UNAUTHORIZED' });
          return;
        }
        next();
      },
      createCommunityAdminRouter(admin)
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function call(method: string, path: string, reader: string | null, body?: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(reader ? { 'x-device-id': reader } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const base = `/books/${PUBLISHED}/community`;
  const theory = { body: '범인은 집사라고 생각해요' };

  async function seedPost(reader = READER_A, body: object = theory) {
    return (await (await call('POST', `${base}/posts`, reader, body)).json()) as any;
  }

  test('COMMUNITY: 끝까지 가지 않은 독자는 게시글 0건 조회·작성 불가(403)', async () => {
    await seedPost(READER_A);
    const post = repo.posts[0];
    const lockedCalls: Array<[string, string, unknown?]> = [
      ['GET', `${base}/posts`],
      ['GET', `${base}/posts/${post.post_id}`],
      ['POST', `${base}/posts`, theory],
      ['POST', `${base}/posts/${post.post_id}/comments`, { body: '댓글' }],
      ['DELETE', `${base}/posts/${post.post_id}`],
      ['POST', `${base}/reports`, { target_type: 'post', target_id: post.post_id, reason: '욕설' }],
    ];
    const readsBefore = repo.reads;
    for (const [method, path, body] of lockedCalls) {
      const res = await call(method, path, READER_C, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'COMMUNITY_LOCKED' });
    }
    expect(repo.reads).toBe(readsBefore);
    expect(repo.posts).toHaveLength(1);
    expect(repo.comments).toHaveLength(0);
    expect(repo.reports).toHaveLength(0);
    expect(repo.posts[0].deleted).toBe(false);
  });

  test('COMMUNITY: 끝까지 간 독자는 조회·작성 가능', async () => {
    const created = await call('POST', `${base}/posts`, READER_A, theory);
    expect(created.status).toBe(201);
    const list = await call('GET', `${base}/posts`, READER_B);
    expect(list.status).toBe(200);
    const body = (await list.json()) as any;
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].body).toBe(theory.body);
    expect(snapshotCalls.some(([id]) => id === READER_B)).toBe(true);
  });

  test('COMMUNITY: 끝까지 가지 않은 독자 상세 조회도 403이며 응답에 게시글 정보가 없다', async () => {
    const post = await seedPost();
    const res = await call('GET', `${base}/posts/${post.post_id}`, READER_C);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain(theory.body);
    expect(text).not.toContain('comment_count');
  });

  test('R12: 미공개·없는 도서는 404', async () => {
    for (const bookId of [DRAFT, 'bk-missing']) {
      expect((await call('GET', `/books/${bookId}/community/posts`, READER_A)).status).toBe(404);
      expect(
        (await call('POST', `/books/${bookId}/community/posts`, READER_A, theory)).status
      ).toBe(404);
    }
  });

  test('독자 식별 헤더가 없으면 400', async () => {
    expect((await call('GET', `${base}/posts`, null)).status).toBe(400);
  });

  test('다른 도서에서 끝까지 간 독자는 이 도서 커뮤니티에 못 들어간다', async () => {
    completed.add(`${READER_C}:bk-other`);
    expect((await call('GET', `${base}/posts`, READER_C)).status).toBe(403);
  });

  test('본문 검증: 공백 제거 후 1~2000자', async () => {
    const post = (body: string) => call('POST', `${base}/posts`, READER_A, { body });
    expect((await post('   ')).status).toBe(400);
    expect((await post('a'.repeat(2001))).status).toBe(400);
    expect((await post('a'.repeat(2000))).status).toBe(201);
    const trimmed = await seedPost(READER_A, { body: '  감상  ' });
    expect(trimmed.body).toBe('감상');
  });

  test('말머리 없음: kind 없이 댓글을 쓰고, kind 를 보내도 저장·응답에 남지 않는다', async () => {
    expect((await call('POST', `${base}/posts`, READER_A, { body: '말머리 없이' })).status).toBe(201);
    const withKind = await call('POST', `${base}/posts`, READER_A, { kind: 'rant', body: '옛 화면' });
    expect(withKind.status).toBe(201);
    expect(await withKind.json()).not.toHaveProperty('kind');
    expect(repo.posts.map((p) => p.kind)).toEqual([null, null]);
    const list = (await (await call('GET', `${base}/posts?kind=theory`, READER_B)).json()) as any;
    expect(list.posts).toHaveLength(2);
    expect(list.posts[0]).not.toHaveProperty('kind');
  });

  test('이름: 가입 닉네임이 있으면 그 이름, 없으면 "독자 xxxx" — 독자 ID 는 노출되지 않는다', async () => {
    repo.names.set(READER_B, '달빛서재');
    await seedPost(READER_A);
    await seedPost(READER_A, { body: '두 번째' });
    await seedPost(READER_B);
    const text = await (await call('GET', `${base}/posts`, READER_B)).text();
    const names = JSON.parse(text).posts.map((p: any) => p.nickname);
    expect(names[0]).toBe('달빛서재');
    expect(names[1]).toMatch(/^독자 [0-9a-f]{4}$/);
    expect(names[1]).toBe(names[2]);
    expect(text).not.toContain(READER_A);
    expect(text).not.toContain(READER_B);
    expect(text).not.toContain('reader_id');
  });

  test('답글: 댓글에 단 답글은 reply_to_nickname=댓글쓴이, 답글에 단 답글은 그 답글 작성자, 글쓴이 답글은 is_post_author=true', async () => {
    repo.names.set(READER_A, '달빛서재');
    repo.names.set(READER_B, '책벌레');
    const post = await seedPost(READER_A);
    const url = `${base}/posts/${post.post_id}/comments`;
    const first = (await (await call('POST', url, READER_B, { body: '저도요' })).json()) as any;
    expect(first).toMatchObject({ nickname: '책벌레', reply_to_nickname: '달빛서재', is_post_author: false });
    const second = await call('POST', url, READER_A, { body: '맞아요', reply_to_comment_id: first.comment_id });
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({
      nickname: '달빛서재',
      reply_to_nickname: '책벌레',
      is_post_author: true,
      like_count: 0,
      liked_by_me: false,
    });
    const detail = (await (await call('GET', `${base}/posts/${post.post_id}`, READER_B)).json()) as any;
    expect(detail.comments.map((c: any) => [c.reply_to_nickname, c.is_post_author])).toEqual([
      ['달빛서재', false],
      ['책벌레', true],
    ]);
    expect(JSON.stringify(detail)).not.toContain('reply_to_comment_id');
  });

  test('답글 대상: 형식이 틀리면 400, 숨김·삭제·다른 댓글의 답글이면 404', async () => {
    const post = await seedPost(READER_A);
    const other = await seedPost(READER_A, { body: '다른 댓글' });
    const url = `${base}/posts/${post.post_id}/comments`;
    const gone = (await (await call('POST', url, READER_B, { body: '지울 답글' })).json()) as any;
    await call('DELETE', `${base}/comments/${gone.comment_id}`, READER_B);
    const foreign = (await (
      await call('POST', `${base}/posts/${other.post_id}/comments`, READER_B, { body: '저쪽 답글' })
    ).json()) as any;
    const before = repo.comments.length;
    expect((await call('POST', url, READER_B, { body: '답', reply_to_comment_id: 'nope' })).status).toBe(400);
    for (const target of [gone.comment_id, foreign.comment_id, randomUUID()]) {
      expect((await call('POST', url, READER_B, { body: '답', reply_to_comment_id: target })).status).toBe(404);
    }
    expect(repo.comments.length).toBe(before);
  });

  test('Review Focus 3: 삭제된 댓글은 답글이 있으면 "삭제된 댓글입니다"로 보이고 새 답글은 404', async () => {
    const post = await seedPost(READER_A);
    await call('POST', `${base}/posts/${post.post_id}/comments`, READER_B, { body: '답글' });
    await call('DELETE', `${base}/posts/${post.post_id}`, READER_A);
    const detail = (await (await call('GET', `${base}/posts/${post.post_id}`, READER_B)).json()) as any;
    expect(detail.post).toMatchObject({ deleted: true, body: '삭제된 댓글입니다', nickname: null });
    expect(detail.comments).toHaveLength(1);
    expect(
      (await call('POST', `${base}/posts/${post.post_id}/comments`, READER_B, { body: '또' })).status
    ).toBe(404);
  });

  test('FR-QNA-004: 끝까지 가지 않은 독자는 답글 쓰기 403, 저장소 접근 0건 — 끝까지 가면 201 (positive 쌍)', async () => {
    const post = await seedPost(READER_A);
    const reply = await seedPost(READER_A, { body: '대상' });
    const url = `${base}/posts/${post.post_id}/comments`;
    const readsBefore = repo.reads;
    const locked = await call('POST', url, READER_C, { body: '답', reply_to_comment_id: reply.post_id });
    expect(locked.status).toBe(403);
    expect(repo.reads).toBe(readsBefore);
    expect(repo.comments).toHaveLength(0);
    completed.add(`${READER_C}:${PUBLISHED}`);
    expect((await call('POST', url, READER_C, { body: '답' })).status).toBe(201);
  });

  test('is_mine은 본인 글에만 true', async () => {
    await seedPost(READER_A);
    const asA = (await (await call('GET', `${base}/posts`, READER_A)).json()) as any;
    const asB = (await (await call('GET', `${base}/posts`, READER_B)).json()) as any;
    expect(asA.posts[0].is_mine).toBe(true);
    expect(asB.posts[0].is_mine).toBe(false);
  });

  test('목록은 최신순, 20개씩 커서 페이지네이션', async () => {
    for (let i = 0; i < 25; i += 1) {
      await repo.createPost(PUBLISHED, READER_A, `글 ${i}`);
    }
    const first = (await (await call('GET', `${base}/posts`, READER_B)).json()) as any;
    expect(first.posts).toHaveLength(20);
    expect(first.posts[0].body).toBe('글 24');
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = (await (
      await call('GET', `${base}/posts?cursor=${first.next_cursor}`, READER_B)
    ).json()) as any;
    expect(second.posts).toHaveLength(5);
    expect(second.posts[0].body).toBe('글 4');
    expect(second.next_cursor).toBeNull();
    expect((await call('GET', `${base}/posts?cursor=zzz`, READER_B)).status).toBe(400);
  });

  test('댓글: 상세에 오래된 순, comment_count 반영, 본문 1~1000자', async () => {
    const post = await seedPost(READER_A);
    const url = `${base}/posts/${post.post_id}/comments`;
    expect((await call('POST', url, READER_B, { body: '' })).status).toBe(400);
    expect((await call('POST', url, READER_B, { body: 'a'.repeat(1001) })).status).toBe(400);
    expect((await call('POST', url, READER_B, { body: '첫 댓글' })).status).toBe(201);
    expect((await call('POST', url, READER_A, { body: '둘째 댓글' })).status).toBe(201);
    const detail = (await (await call('GET', `${base}/posts/${post.post_id}`, READER_B)).json()) as any;
    expect(detail.post.comment_count).toBe(2);
    expect(detail.comments.map((c: any) => c.body)).toEqual(['첫 댓글', '둘째 댓글']);
    expect(detail.comments.map((c: any) => c.is_mine)).toEqual([true, false]);
    const list = (await (await call('GET', `${base}/posts`, READER_B)).json()) as any;
    expect(list.posts[0].comment_count).toBe(2);
  });

  test('본인 글·댓글만 삭제할 수 있고 남의 것은 404', async () => {
    const post = await seedPost(READER_A);
    const c = (await (
      await call('POST', `${base}/posts/${post.post_id}/comments`, READER_B, { body: '댓글' })
    ).json()) as any;
    expect((await call('DELETE', `${base}/comments/${c.comment_id}`, READER_A)).status).toBe(404);
    expect((await call('DELETE', `${base}/posts/${post.post_id}`, READER_B)).status).toBe(404);
    expect((await call('DELETE', `${base}/comments/${c.comment_id}`, READER_B)).status).toBe(204);
    expect((await call('DELETE', `${base}/posts/${post.post_id}`, READER_A)).status).toBe(204);
  });

  test('삭제된 댓글은 답글이 있으면 "삭제된 댓글입니다"로, 없으면 숨긴다', async () => {
    const withComment = await seedPost(READER_A, { body: '비밀 추리' });
    const alone = await seedPost(READER_A, { body: '혼자 글' });
    await call('POST', `${base}/posts/${withComment.post_id}/comments`, READER_B, { body: '댓글' });
    await call('DELETE', `${base}/posts/${withComment.post_id}`, READER_A);
    await call('DELETE', `${base}/posts/${alone.post_id}`, READER_A);
    const text = await (await call('GET', `${base}/posts`, READER_B)).text();
    const list = JSON.parse(text);
    expect(list.posts).toHaveLength(1);
    expect(list.posts[0].deleted).toBe(true);
    expect(list.posts[0].body).toBe('삭제된 댓글입니다');
    expect(text).not.toContain('비밀 추리');
    expect((await call('GET', `${base}/posts/${alone.post_id}`, READER_B)).status).toBe(404);
    expect(
      (await call('POST', `${base}/posts/${alone.post_id}/comments`, READER_B, { body: 'x' })).status
    ).toBe(404);
  });

  test('시간당 글 10개·댓글 30개를 넘기면 429', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await call('POST', `${base}/posts`, READER_A, theory)).status).toBe(201);
    }
    expect((await call('POST', `${base}/posts`, READER_A, theory)).status).toBe(429);
    expect((await call('POST', `${base}/posts`, READER_B, theory)).status).toBe(201);
    const post = repo.posts[0];
    const url = `${base}/posts/${post.post_id}/comments`;
    for (let i = 0; i < 30; i += 1) {
      expect((await call('POST', url, READER_B, { body: `c${i}` })).status).toBe(201);
    }
    expect((await call('POST', url, READER_B, { body: '넘침' })).status).toBe(429);
  });

  test('신고: 끝까지 간 독자가 사유와 함께 신고하면 저장되고, 없는 대상은 404, 사유 누락은 400', async () => {
    const post = await seedPost(READER_A);
    const report = (type: string, id: string, reason: string) =>
      call('POST', `${base}/reports`, READER_B, { target_type: type, target_id: id, reason });
    expect((await report('post', post.post_id, '욕설')).status).toBe(201);
    expect(repo.reports).toHaveLength(1);
    expect((await report('post', post.post_id, '')).status).toBe(400);
    expect((await report('thread', post.post_id, 'x')).status).toBe(400);
    expect((await report('post', 'not-a-uuid', 'x')).status).toBe(404);
    expect((await report('post', randomUUID(), 'x')).status).toBe(404);
  });

  test('관리자: 토큰 없이는 401, 신고 목록·글/댓글 삭제 가능', async () => {
    const post = await seedPost(READER_A);
    await call('POST', `${base}/reports`, READER_B, {
      target_type: 'post',
      target_id: post.post_id,
      reason: '욕설',
    });
    expect((await fetch(`${baseUrl}/admin/community/reports`)).status).toBe(401);
    const headers = { Authorization: `Bearer ${TOKEN}` };
    const reports = (await (
      await fetch(`${baseUrl}/admin/community/reports`, { headers })
    ).json()) as any;
    expect(reports.reports).toHaveLength(1);
    expect(JSON.stringify(reports)).not.toContain(READER_B);
    const remove = (path: string) =>
      fetch(`${baseUrl}/admin/community/${path}`, { method: 'DELETE', headers });
    expect((await remove(`posts/${post.post_id}`)).status).toBe(204);
    expect((await remove(`posts/${post.post_id}`)).status).toBe(404);
    const commentId = randomUUID();
    expect((await remove(`comments/${commentId}`)).status).toBe(204);
    expect(adminDeleted.comments).toEqual([commentId]);
    expect((await remove('comments/not-a-uuid')).status).toBe(404);
  });
});
