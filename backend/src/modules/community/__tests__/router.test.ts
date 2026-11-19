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
    return { ...row, comment_count: this.commentCount(p.post_id) };
  }

  async listPosts(bookId: string, q: { kind?: string; before?: number; limit: number }) {
    this.reads += 1;
    return this.posts
      .filter((p) => p.book_id === bookId)
      .filter((p) => !q.kind || p.kind === q.kind)
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
      .map(({ book_id: _book, deleted: _deleted, ...c }) => c);
  }

  async createPost(bookId: string, readerId: string, kind: any, body: string) {
    this.seq += 1;
    const post: StoredPost = {
      seq: this.seq,
      post_id: randomUUID(),
      reader_id: readerId,
      kind,
      body,
      created_at: new Date().toISOString(),
      deleted: false,
      comment_count: 0,
      book_id: bookId,
    };
    this.posts.push(post);
    return this.view(post);
  }

  async createComment(bookId: string, postId: string, readerId: string, body: string) {
    const p = this.posts.find((x) => x.post_id === postId && x.book_id === bookId && !x.deleted);
    if (!p) return null;
    const c: StoredComment = {
      comment_id: randomUUID(),
      post_id: postId,
      reader_id: readerId,
      body,
      created_at: new Date().toISOString(),
      book_id: bookId,
      deleted: false,
    };
    this.comments.push(c);
    const { book_id: _book, deleted: _deleted, ...row } = c;
    return row;
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
  let adminDeleted: { posts: string[]; comments: string[] };

  beforeEach(async () => {
    repo = new FakeCommunity();
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
  const theory = { kind: 'theory', body: '범인은 집사라고 생각해요' };

  async function seedPost(reader = READER_A, body: object = theory) {
    return (await (await call('POST', `${base}/posts`, reader, body)).json()) as any;
  }

  // 대표 결정 2026-11-19 "커뮤니티 관문 없애기" — 11-17 결정 ④(완독 독자만)를 대체한 명세 변경.
  // 예전 "미완독 403" 시험을 새 규칙 시험으로 바꿨다. 읽은 적 없는 READER_C 로 확인한다.
  test('대표 결정 2026-11-19: 미완독 독자도 커뮤니티 글을 읽고 쓴다', async () => {
    const post = await seedPost(READER_A);
    const list = await call('GET', `${base}/posts`, READER_C);
    expect(list.status).toBe(200);
    const body = (await list.json()) as any;
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].body).toBe(theory.body);
    const detail = await call('GET', `${base}/posts/${post.post_id}`, READER_C);
    expect(detail.status).toBe(200);
    expect(
      (await call('POST', `${base}/posts`, READER_C, { kind: 'review', body: '좋았어요' })).status
    ).toBe(201);
    expect(
      (await call('POST', `${base}/posts/${post.post_id}/comments`, READER_C, { body: '댓글' })).status
    ).toBe(201);
    expect(repo.posts).toHaveLength(2);
    expect(repo.comments).toHaveLength(1);
  });

  test('R12: 미공개·없는 도서는 404 — 글 0건, 공개 도서는 열린다 (positive 쌍)', async () => {
    await seedPost(READER_A);
    const readsBefore = repo.reads;
    for (const bookId of [DRAFT, 'bk-missing']) {
      const list = await call('GET', `/books/${bookId}/community/posts`, READER_A);
      expect(list.status).toBe(404);
      expect(await list.text()).not.toContain(theory.body);
      expect(
        (await call('POST', `/books/${bookId}/community/posts`, READER_A, theory)).status
      ).toBe(404);
    }
    expect(repo.reads).toBe(readsBefore);
    expect(repo.posts).toHaveLength(1);
    expect((await call('GET', `${base}/posts`, READER_A)).status).toBe(200);
  });

  test('독자 식별 헤더가 없으면 400', async () => {
    expect((await call('GET', `${base}/posts`, null)).status).toBe(400);
  });

  test('본문 검증: 공백 제거 후 1~2000자, kind는 theory|review', async () => {
    const post = (kind: string, body: string) => call('POST', `${base}/posts`, READER_A, { kind, body });
    expect((await post('theory', '   ')).status).toBe(400);
    expect((await post('theory', 'a'.repeat(2001))).status).toBe(400);
    expect((await post('rant', '내용')).status).toBe(400);
    expect((await post('review', 'a'.repeat(2000))).status).toBe(201);
    const trimmed = await seedPost(READER_A, { kind: 'review', body: '  감상  ' });
    expect(trimmed.body).toBe('감상');
  });

  test('작성자는 안정적인 익명 닉네임으로 보이고 독자 ID는 노출되지 않는다', async () => {
    await seedPost(READER_A);
    await seedPost(READER_A, { kind: 'review', body: '두 번째' });
    await seedPost(READER_B);
    const text = await (await call('GET', `${base}/posts`, READER_B)).text();
    const names = JSON.parse(text).posts.map((p: any) => p.nickname);
    expect(names[0]).toMatch(/^독자 [0-9a-f]{4}$/);
    expect(names[1]).toBe(names[2]);
    expect(names[0]).not.toBe(names[1]);
    expect(text).not.toContain(READER_A);
    expect(text).not.toContain(READER_B);
    expect(text).not.toContain('reader_id');
  });

  test('is_mine은 본인 글에만 true', async () => {
    await seedPost(READER_A);
    const asA = (await (await call('GET', `${base}/posts`, READER_A)).json()) as any;
    const asB = (await (await call('GET', `${base}/posts`, READER_B)).json()) as any;
    expect(asA.posts[0].is_mine).toBe(true);
    expect(asB.posts[0].is_mine).toBe(false);
  });

  test('목록은 최신순, 20개씩 커서 페이지네이션, kind 필터', async () => {
    for (let i = 0; i < 25; i += 1) {
      await repo.createPost(PUBLISHED, READER_A, i % 5 === 0 ? 'review' : 'theory', `글 ${i}`);
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
    const reviews = (await (await call('GET', `${base}/posts?kind=review`, READER_B)).json()) as any;
    expect(reviews.posts.map((p: any) => p.kind)).toEqual(Array(5).fill('review'));
    expect((await call('GET', `${base}/posts?kind=zzz`, READER_B)).status).toBe(400);
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

  test('삭제된 글은 댓글이 있으면 "삭제된 글입니다"로, 없으면 숨긴다', async () => {
    const withComment = await seedPost(READER_A, { kind: 'theory', body: '비밀 추리' });
    const alone = await seedPost(READER_A, { kind: 'theory', body: '혼자 글' });
    await call('POST', `${base}/posts/${withComment.post_id}/comments`, READER_B, { body: '댓글' });
    await call('DELETE', `${base}/posts/${withComment.post_id}`, READER_A);
    await call('DELETE', `${base}/posts/${alone.post_id}`, READER_A);
    const text = await (await call('GET', `${base}/posts`, READER_B)).text();
    const list = JSON.parse(text);
    expect(list.posts).toHaveLength(1);
    expect(list.posts[0].deleted).toBe(true);
    expect(list.posts[0].body).toBe('삭제된 글입니다');
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

  test('신고: 독자가 사유와 함께 신고하면 저장되고, 없는 대상은 404, 사유 누락은 400', async () => {
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
