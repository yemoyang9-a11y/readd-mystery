/**
 * 커뮤니티 신고 관리 — 서로 다른 독자 3명 신고 시 자동 숨김 + 관리자 복구·삭제
 * (대표 결정 2026-11-17: "관리자 화면 + 신고 3건 자동 숨김")
 *
 * 같은 계약을 두 저장소에 돌린다.
 *  - 메모리 저장소: 항상 실행. 라우터 배선(신고 → 숨김 → 독자 응답에서 빠짐)을 본다.
 *  - 실제 Postgres(pg-repository + 016·022 마이그레이션): COMMUNITY_TEST_DATABASE_URL이
 *    있을 때 실행. SQL이 계약과 같은지 본다.
 *
 * 상한 테스트 규칙(7장): 숨김은 "0건", 반드시 표시(positive)와 쌍으로.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import express from 'express';
import { Pool } from 'pg';
import { createCommunityRouter } from '../router';
import { createAdminRouter } from '../../ingest/admin-router';
import {
  createPgCommunityAdminRepository,
  createPgCommunityRepository,
} from '../pg-repository';
import {
  AUTO_HIDE_REPORT_THRESHOLD,
  type CommentRow,
  type CommunityAdminRepository,
  type CommunityModerationRepository,
  type CommunityRepository,
  type ModerationItem,
  type PostKind,
  type PostRow,
  type ReportTarget,
} from '../repository';

const BOOK = 'bk-moderation';
const TOKEN = 'm'.repeat(40);
const POST_BODY = '신고 대상 글 — 집사가 수상하다';
const COMMENT_BODY = '신고 대상 댓글 — 편지가 결정적';

type Repos = {
  community: CommunityRepository;
  admin: CommunityAdminRepository & CommunityModerationRepository;
};

// ---------------------------------------------------------------------------
// 메모리 저장소 — pg-repository와 같은 계약
// ---------------------------------------------------------------------------
type MemPost = PostRow & { book_id: string; hidden_at: string | null; reviewed_at: string | null };
type MemComment = CommentRow & {
  book_id: string;
  deleted: boolean;
  hidden_at: string | null;
  reviewed_at: string | null;
};
type MemReport = {
  target_type: ReportTarget;
  target_id: string;
  book_id: string;
  reporter_id: string;
  reason: string;
  at: number;
};

function memoryRepos(): Repos {
  const posts: MemPost[] = [];
  const comments: MemComment[] = [];
  const reports: MemReport[] = [];
  let seq = 0;
  let clock = 0;
  const tick = () => {
    clock += 1;
    return clock;
  };
  const iso = (n: number) => new Date(Date.UTC(2031, 0, 1) + n * 1000).toISOString();
  const reviewTick = new Map<string, number>();

  const visibleComments = (postId: string) =>
    comments.filter((c) => c.post_id === postId && !c.deleted && c.hidden_at === null);
  const visiblePost = (p: MemPost) =>
    p.hidden_at === null && (!p.deleted || visibleComments(p.post_id).length > 0);
  const view = (p: MemPost): PostRow => ({
    seq: p.seq,
    post_id: p.post_id,
    reader_id: p.reader_id,
    kind: p.kind,
    body: p.body,
    created_at: p.created_at,
    deleted: p.deleted,
    comment_count: visibleComments(p.post_id).length,
  });
  const strip = (c: MemComment): CommentRow => ({
    comment_id: c.comment_id,
    post_id: c.post_id,
    reader_id: c.reader_id,
    body: c.body,
    created_at: c.created_at,
  });
  const find = (type: ReportTarget, id: string) =>
    type === 'post' ? posts.find((p) => p.post_id === id) : comments.find((c) => c.comment_id === id);
  const key = (type: ReportTarget, id: string) => `${type}:${id}`;

  const community: CommunityRepository = {
    async listPosts(bookId, q) {
      return posts
        .filter((p) => p.book_id === bookId && visiblePost(p))
        .filter((p) => !q.kind || p.kind === q.kind)
        .filter((p) => q.before === undefined || p.seq < q.before)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, q.limit)
        .map(view);
    },
    async getPost(bookId, postId) {
      const p = posts.find((x) => x.post_id === postId && x.book_id === bookId);
      return p && visiblePost(p) ? view(p) : null;
    },
    async listComments(bookId, postId) {
      return visibleComments(postId)
        .filter((c) => c.book_id === bookId)
        .map(strip);
    },
    async createPost(bookId, readerId, kind: PostKind, body) {
      seq += 1;
      const p: MemPost = {
        seq,
        post_id: randomUUID(),
        reader_id: readerId,
        kind,
        body,
        created_at: iso(tick()),
        deleted: false,
        comment_count: 0,
        book_id: bookId,
        hidden_at: null,
        reviewed_at: null,
      };
      posts.push(p);
      return view(p);
    },
    async createComment(bookId, postId, readerId, body) {
      const p = posts.find(
        (x) => x.post_id === postId && x.book_id === bookId && !x.deleted && x.hidden_at === null
      );
      if (!p) return null;
      const c: MemComment = {
        comment_id: randomUUID(),
        post_id: postId,
        reader_id: readerId,
        body,
        created_at: iso(tick()),
        book_id: bookId,
        deleted: false,
        hidden_at: null,
        reviewed_at: null,
      };
      comments.push(c);
      return strip(c);
    },
    async deletePost(bookId, postId, readerId) {
      const p = posts.find(
        (x) => x.post_id === postId && x.book_id === bookId && x.reader_id === readerId && !x.deleted
      );
      if (!p) return false;
      p.deleted = true;
      return true;
    },
    async deleteComment(bookId, commentId, readerId) {
      const c = comments.find(
        (x) =>
          x.comment_id === commentId && x.book_id === bookId && x.reader_id === readerId && !x.deleted
      );
      if (!c) return false;
      c.deleted = true;
      return true;
    },
    async countRecentPosts() {
      return 0;
    },
    async countRecentComments() {
      return 0;
    },
    async createReport(bookId, reporterId, targetType, targetId, reason) {
      const target = find(targetType, targetId);
      if (!target || target.book_id !== bookId) return false;
      const dup = reports.some(
        (r) =>
          r.target_type === targetType && r.target_id === targetId && r.reporter_id === reporterId
      );
      if (!dup) {
        reports.push({
          target_type: targetType,
          target_id: targetId,
          book_id: bookId,
          reporter_id: reporterId,
          reason,
          at: tick(),
        });
      }
      const since = reviewTick.get(key(targetType, targetId)) ?? 0;
      const active = new Set(
        reports
          .filter((r) => r.target_type === targetType && r.target_id === targetId && r.at > since)
          .map((r) => r.reporter_id)
      );
      if (target.hidden_at === null && active.size >= AUTO_HIDE_REPORT_THRESHOLD) {
        target.hidden_at = iso(tick());
      }
      return true;
    },
  };

  const admin: Repos['admin'] = {
    async listReports() {
      return [];
    },
    async deletePost(postId) {
      const p = posts.find((x) => x.post_id === postId && !x.deleted);
      if (!p) return false;
      p.deleted = true;
      return true;
    },
    async deleteComment(commentId) {
      const c = comments.find((x) => x.comment_id === commentId && !x.deleted);
      if (!c) return false;
      c.deleted = true;
      return true;
    },
    async listModeration() {
      const groups = new Map<string, MemReport[]>();
      for (const r of reports) {
        const k = key(r.target_type, r.target_id);
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      const items: Array<ModerationItem & { _last: number }> = [];
      for (const [k, rs] of groups) {
        const { target_type, target_id, book_id } = rs[0];
        const target = find(target_type, target_id)!;
        const since = reviewTick.get(k) ?? 0;
        const sorted = [...rs].sort((a, b) => b.at - a.at);
        items.push({
          target_type,
          target_id,
          book_id,
          book_title: '모더레이션 시험 도서',
          body: target.body,
          report_count: new Set(rs.map((r) => r.reporter_id)).size,
          reports_since_review: new Set(rs.filter((r) => r.at > since).map((r) => r.reporter_id))
            .size,
          reasons: sorted.map((r) => r.reason),
          hidden: target.hidden_at !== null,
          deleted: target.deleted,
          hidden_at: target.hidden_at,
          reviewed_at: target.reviewed_at,
          last_reported_at: iso(sorted[0].at),
          _last: sorted[0].at,
        });
      }
      return items
        .sort((a, b) => b._last - a._last)
        .map(({ _last: _drop, ...item }) => item);
    },
    async restore(targetType, targetId) {
      const target = find(targetType, targetId);
      if (!target) return false;
      const at = tick();
      target.hidden_at = null;
      target.reviewed_at = iso(at);
      reviewTick.set(key(targetType, targetId), at);
      return true;
    },
  };

  return { community, admin };
}

// ---------------------------------------------------------------------------
// 실제 Postgres — 테스트마다 새 스키마에 016·022를 적용
// ---------------------------------------------------------------------------
const PG_URL = process.env.COMMUNITY_TEST_DATABASE_URL;
const MIGRATIONS = path.join(__dirname, '../../../../migrations');

async function pgRepos(): Promise<{ repos: Repos; close: () => Promise<void> }> {
  const schema = `mod_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const setup = new Pool({ connectionString: PG_URL, max: 1 });
  await setup.query(`CREATE SCHEMA ${schema}`);
  await setup.end();
  const pool = new Pool({ connectionString: PG_URL, options: `-c search_path=${schema}` });
  await pool.query(`CREATE TABLE books (book_id TEXT PRIMARY KEY, title TEXT NOT NULL)`);
  await pool.query(`INSERT INTO books (book_id, title) VALUES ($1, '모더레이션 시험 도서')`, [BOOK]);
  await pool.query(fs.readFileSync(path.join(MIGRATIONS, '016_community.sql'), 'utf8'));
  const m022 = fs.readFileSync(path.join(MIGRATIONS, '022_community_moderation.sql'), 'utf8');
  await pool.query(m022);
  await pool.query(m022); // IF NOT EXISTS — 두 번 적용해도 그대로
  const db = { query: (sql: string, params?: unknown[]) => pool.query(sql, params) };
  return {
    repos: {
      community: createPgCommunityRepository(db),
      admin: createPgCommunityAdminRepository(db),
    },
    close: async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// 계약
// ---------------------------------------------------------------------------
function moderationSuite(
  label: string,
  make: () => Promise<{ repos: Repos; close: () => Promise<void> }>
) {
  describe(`커뮤니티 신고 관리 — ${label}`, () => {
    let server: Server;
    let baseUrl: string;
    let close: () => Promise<void>;
    const author = randomUUID();
    const viewer = randomUUID();

    beforeEach(async () => {
      const made = await make();
      close = made.close;
      const app = express();
      app.use(
        createCommunityRouter({
          community: made.repos.community,
          content: { findReadiness: async (bookId: string) => bookId === BOOK },
          // 완독 게이트는 이 파일의 관심사가 아니다 — 모두 완독자로 둔다.
          cutoff: { getCutoffSnapshot: async () => ({ is_complete: true }) as any },
        })
      );
      app.use(
        '/admin',
        createAdminRouter({
          jobs: {} as any,
          runner: {} as any,
          review: {} as any,
          uploadDir: '/nonexistent',
          community: made.repos.admin,
          getToken: () => TOKEN,
        })
      );
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
      await close();
    });

    const base = `/books/${BOOK}/community`;
    function call(method: string, p: string, reader: string, body?: unknown) {
      return fetch(`${baseUrl}${p}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-device-id': reader },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    function admin(method: string, p: string) {
      return fetch(`${baseUrl}/admin/community${p}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
    }
    async function report(type: ReportTarget, id: string, reporter: string, reason = '스포일러') {
      const res = await call('POST', `${base}/reports`, reporter, {
        target_type: type,
        target_id: id,
        reason,
      });
      expect(res.status).toBe(201);
    }
    async function seed() {
      const post = (await (
        await call('POST', `${base}/posts`, author, { kind: 'theory', body: POST_BODY })
      ).json()) as any;
      const comment = (await (
        await call('POST', `${base}/posts/${post.post_id}/comments`, author, { body: COMMENT_BODY })
      ).json()) as any;
      return { postId: post.post_id as string, commentId: comment.comment_id as string };
    }
    /** 독자 한 명이 보는 모든 화면(목록 두 종류 + 상세)의 응답을 합친다. */
    async function readerView(reader: string, postId: string) {
      const all = await call('GET', `${base}/posts`, reader);
      const theory = await call('GET', `${base}/posts?kind=theory`, reader);
      const detail = await call('GET', `${base}/posts/${postId}`, reader);
      return {
        list: ((await all.json()) as any).posts as any[],
        theory: ((await theory.json()) as any).posts as any[],
        detailStatus: detail.status,
        detail: (await detail.json().catch(() => null)) as any,
      };
    }
    const reporters = (n: number) => Array.from({ length: n }, () => randomUUID());

    test(`신고 임계값은 서로 다른 독자 ${AUTO_HIDE_REPORT_THRESHOLD}명이다`, () => {
      expect(AUTO_HIDE_REPORT_THRESHOLD).toBe(3);
    });

    test('서로 다른 독자 2명이 신고한 글은 계속 보인다 (positive 쌍)', async () => {
      const { postId } = await seed();
      for (const r of reporters(2)) await report('post', postId, r);
      for (const reader of [viewer, author]) {
        const v = await readerView(reader, postId);
        expect(v.list.map((p) => p.post_id)).toEqual([postId]);
        expect(v.theory.map((p) => p.post_id)).toEqual([postId]);
        expect(v.detailStatus).toBe(200);
        expect(v.detail.post.body).toBe(POST_BODY);
      }
    });

    test('서로 다른 독자 3명이 신고한 글은 독자 목록·상세·댓글에서 0건 (작성자 포함)', async () => {
      const { postId } = await seed();
      for (const r of reporters(3)) await report('post', postId, r);
      for (const reader of [viewer, author]) {
        const v = await readerView(reader, postId);
        expect(v.list).toHaveLength(0);
        expect(v.theory).toHaveLength(0);
        expect(v.detailStatus).toBe(404);
        const text = JSON.stringify(v);
        expect(text).not.toContain(POST_BODY);
        expect(text).not.toContain(COMMENT_BODY);
      }
      // 숨긴 글에는 새 댓글도 달리지 않는다.
      const c = await call('POST', `${base}/posts/${postId}/comments`, viewer, { body: '안녕' });
      expect(c.status).toBe(404);
    });

    test('같은 독자가 3번 신고해도 한 명으로 센다 — 계속 보인다', async () => {
      const { postId } = await seed();
      const same = randomUUID();
      for (let i = 0; i < 3; i += 1) await report('post', postId, same, `사유 ${i}`);
      const v = await readerView(viewer, postId);
      expect(v.list.map((p) => p.post_id)).toEqual([postId]);
      expect(v.detailStatus).toBe(200);
    });

    test('댓글: 2명 신고는 보이고, 3명 신고는 댓글 목록·댓글 수에서 0건', async () => {
      const { postId, commentId } = await seed();
      const [r1, r2, r3] = reporters(3);
      await report('comment', commentId, r1);
      await report('comment', commentId, r2);
      let v = await readerView(viewer, postId);
      expect(v.detail.comments.map((c: any) => c.comment_id)).toEqual([commentId]);
      expect(v.detail.post.comment_count).toBe(1);
      expect(v.list[0].comment_count).toBe(1);

      await report('comment', commentId, r3);
      for (const reader of [viewer, author]) {
        v = await readerView(reader, postId);
        expect(v.detailStatus).toBe(200);
        expect(v.detail.comments).toHaveLength(0);
        expect(v.detail.post.comment_count).toBe(0);
        expect(v.list[0].comment_count).toBe(0);
        expect(JSON.stringify(v)).not.toContain(COMMENT_BODY);
      }
    });

    test('작성자가 지운 글은 숨긴 댓글만 남으면 "삭제된 글"로도 보이지 않는다 — 0건', async () => {
      const { postId, commentId } = await seed();
      expect((await call('DELETE', `${base}/posts/${postId}`, author)).status).toBe(204);
      // positive: 댓글이 살아 있으면 "삭제된 글입니다" 자리로 남는다
      let v = await readerView(viewer, postId);
      expect(v.list.map((p) => p.post_id)).toEqual([postId]);
      for (const r of reporters(3)) await report('comment', commentId, r);
      v = await readerView(viewer, postId);
      expect(v.list).toHaveLength(0);
      expect(v.detailStatus).toBe(404);
    });

    test('관리자 복구 → 다시 보이고, 신고는 남되 "검토함"으로 표시된다', async () => {
      const { postId } = await seed();
      for (const r of reporters(3)) await report('post', postId, r);
      expect((await readerView(viewer, postId)).list).toHaveLength(0);

      expect((await admin('POST', `/posts/${postId}/restore`)).status).toBe(204);
      const v = await readerView(viewer, postId);
      expect(v.list.map((p) => p.post_id)).toEqual([postId]);
      expect(v.detailStatus).toBe(200);

      const items = ((await (await admin('GET', '/moderation')).json()) as any).items as any[];
      const item = items.find((i) => i.target_id === postId);
      expect(item).toMatchObject({
        target_type: 'post',
        report_count: 3,
        reports_since_review: 0,
        hidden: false,
        deleted: false,
      });
      expect(item.reviewed_at).not.toBeNull();
    });

    test('복구 뒤에는 새 독자 신고만 센다 — 새 2명은 보이고, 새 3명이면 다시 0건', async () => {
      const { postId } = await seed();
      const old = reporters(3);
      for (const r of old) await report('post', postId, r);
      expect((await admin('POST', `/posts/${postId}/restore`)).status).toBe(204);

      // 예전 신고자가 다시 신고해도 새로 세지 않는다
      for (const r of old) await report('post', postId, r, '또 신고');
      const [n1, n2, n3] = reporters(3);
      await report('post', postId, n1);
      await report('post', postId, n2);
      let v = await readerView(viewer, postId);
      expect(v.list.map((p) => p.post_id)).toEqual([postId]);
      expect(v.detailStatus).toBe(200);

      await report('post', postId, n3);
      v = await readerView(viewer, postId);
      expect(v.list).toHaveLength(0);
      expect(v.detailStatus).toBe(404);
    });

    test('복구한 댓글도 다시 보이고, 새 3명이면 다시 숨겨진다', async () => {
      const { postId, commentId } = await seed();
      for (const r of reporters(3)) await report('comment', commentId, r);
      expect((await admin('POST', `/comments/${commentId}/restore`)).status).toBe(204);
      let v = await readerView(viewer, postId);
      expect(v.detail.comments.map((c: any) => c.comment_id)).toEqual([commentId]);
      for (const r of reporters(3)) await report('comment', commentId, r);
      v = await readerView(viewer, postId);
      expect(v.detail.comments).toHaveLength(0);
    });

    test('관리자 목록: 신고된 글·댓글을 최신 신고순으로, 서로 다른 신고자 수·사유·숨김 상태와 함께', async () => {
      const { postId, commentId } = await seed();
      const [a, b, c] = reporters(3);
      await report('post', postId, a, '욕설');
      await report('post', postId, a, '중복 신고');
      await report('comment', commentId, a, '스포일러');
      await report('comment', commentId, b, '광고');
      await report('comment', commentId, c, '도배');

      const res = await admin('GET', '/moderation');
      expect(res.status).toBe(200);
      const items = ((await res.json()) as any).items as any[];
      expect(items.map((i) => [i.target_type, i.target_id])).toEqual([
        ['comment', commentId],
        ['post', postId],
      ]);
      expect(items[0]).toMatchObject({
        book_id: BOOK,
        book_title: '모더레이션 시험 도서',
        body: COMMENT_BODY,
        report_count: 3,
        reports_since_review: 3,
        reasons: ['도배', '광고', '스포일러'],
        hidden: true,
        deleted: false,
      });
      expect(items[0].hidden_at).not.toBeNull();
      expect(items[1]).toMatchObject({
        body: POST_BODY,
        report_count: 1,
        reasons: ['욕설'],
        hidden: false,
      });
      // 신고자 식별자는 관리자 화면에도 내보내지 않는다
      expect(JSON.stringify(items)).not.toContain(a);
    });

    test('관리자 삭제: 숨긴 글을 지우면 목록에 삭제됨으로 남고 독자에게는 계속 0건', async () => {
      const { postId } = await seed();
      for (const r of reporters(3)) await report('post', postId, r);
      expect((await admin('DELETE', `/posts/${postId}`)).status).toBe(204);
      const items = ((await (await admin('GET', '/moderation')).json()) as any).items as any[];
      expect(items[0]).toMatchObject({ target_id: postId, deleted: true });
      expect((await readerView(viewer, postId)).list).toHaveLength(0);
    });

    test('복구: 없는 대상·잘못된 ID는 404', async () => {
      expect((await admin('POST', `/posts/${randomUUID()}/restore`)).status).toBe(404);
      expect((await admin('POST', `/comments/${randomUUID()}/restore`)).status).toBe(404);
      expect((await admin('POST', '/posts/not-a-uuid/restore')).status).toBe(404);
    });

    test('관리자 신고 관리 경로는 토큰 없이 401 — 신고 내용 0건', async () => {
      const { postId, commentId } = await seed();
      for (const r of reporters(3)) await report('post', postId, r);
      const paths: Array<[string, string]> = [
        ['GET', '/moderation'],
        ['POST', `/posts/${postId}/restore`],
        ['POST', `/comments/${commentId}/restore`],
      ];
      const attempts: Array<Record<string, string>> = [
        {},
        { authorization: `Bearer ${'x'.repeat(40)}` },
        { 'x-device-id': viewer },
      ];
      for (const headers of attempts) {
        for (const [method, p] of paths) {
          const res = await fetch(`${baseUrl}/admin/community${p}`, { method, headers });
          expect([method, p, res.status]).toEqual([method, p, 401]);
          expect(await res.text()).not.toContain(POST_BODY);
        }
      }
      // 인증 실패한 복구 요청은 아무것도 바꾸지 않았다 — 계속 0건
      expect((await readerView(viewer, postId)).list).toHaveLength(0);
    });
  });
}

moderationSuite('메모리 저장소', async () => ({ repos: memoryRepos(), close: async () => {} }));

(PG_URL ? describe : describe.skip)('실제 Postgres (COMMUNITY_TEST_DATABASE_URL)', () => {
  moderationSuite('pg-repository', pgRepos);
});
