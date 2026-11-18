/**
 * 완독자 커뮤니티 — 완독 게이트 (출시 전 점검, 2026-11-17)
 *
 * 완독 여부는 기준점 결정기(getCutoffSnapshot)의 is_complete 하나로만 정한다.
 * 여기서는 가짜 스냅샷이 아니라 **실제 결정기**를 꽂아, "차례로 읽은 쪽" 규칙과
 * 커뮤니티 접근이 같이 움직이는지 본다.
 *
 * 조항: FR-QNA-004 🚦 (완독 파생값), FR-PRG-003 🚦 (차례로 읽은 쪽),
 *       FR-SPL-005 🚦 / R11 (실패 = 미노출), FR-ADM-006 🚦 (관리자 인증)
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import express from 'express';
import { createCommunityRouter } from '../router';
import type { CommentRow, CommunityAdminRepository, CommunityRepository, PostRow } from '../repository';
import { createAdminRouter } from '../../ingest/admin-router';
import { createCutoffService } from '../../reading-state/cutoff.service';
import { createProgressService } from '../../reading-state/progress.service';
import { makeSeededFakes } from '../../../../tests/unit/reading-state/fakes';

const READER = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const BOOK = 'gate-book';
const LAST_PAGE = 12;
const CHAPTERS = [
  { chapter_no: 1, title: '1장', start_page: 1, end_page: 6 },
  { chapter_no: 2, title: '2장', start_page: 7, end_page: LAST_PAGE },
];
const SECRET = '범인은 집사였다';
const SECRET_COMMENT = '마지막 장의 편지가 결정적이었죠';

function seededCommunity() {
  const post: PostRow = {
    seq: 1,
    post_id: randomUUID(),
    reader_id: AUTHOR,
    kind: 'theory',
    body: SECRET,
    created_at: new Date().toISOString(),
    deleted: false,
    comment_count: 1,
  };
  const comment: CommentRow = {
    comment_id: randomUUID(),
    post_id: post.post_id,
    reader_id: AUTHOR,
    body: SECRET_COMMENT,
    created_at: new Date().toISOString(),
  };
  const touched: string[] = [];
  const mark =
    <A extends unknown[], T>(name: string, fn: (...args: A) => T) =>
    async (...args: A): Promise<T> => {
      touched.push(name);
      return fn(...args);
    };
  const repo: CommunityRepository = {
    listPosts: mark('listPosts', () => [post]),
    getPost: mark('getPost', () => post),
    listComments: mark('listComments', () => [comment]),
    createPost: mark('createPost', () => post),
    createComment: mark('createComment', () => comment),
    deletePost: mark('deletePost', () => true),
    deleteComment: mark('deleteComment', () => true),
    countRecentPosts: mark('countRecentPosts', () => 0),
    countRecentComments: mark('countRecentComments', () => 0),
    createReport: mark('createReport', () => true),
  };
  return { repo, post, comment, touched };
}

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('완독자 커뮤니티 — 완독 게이트 (실제 기준점 결정기)', () => {
  let server: Server;
  let baseUrl: string;
  let community: ReturnType<typeof seededCommunity>;
  let cutoffFails: boolean;
  let readinessFails: boolean;
  let go: (page: number, from?: number | null, claim?: 'read_through') => Promise<void>;
  let progress: ReturnType<typeof createProgressService>;

  beforeEach(async () => {
    const { positions, books } = makeSeededFakes();
    books.set(BOOK, { total_pages: LAST_PAGE, chapters: CHAPTERS });
    progress = createProgressService({ positions, books });
    const cutoff = createCutoffService({ positions, books });
    let seq = 0;
    go = (page, from, claim) =>
      progress.acceptProgressEvent(READER, BOOK, { page, seq: ++seq, from_page: from, claim });
    community = seededCommunity();
    cutoffFails = false;
    readinessFails = false;

    const app = express();
    app.use(
      createCommunityRouter({
        community: community.repo,
        content: {
          findReadiness: async (bookId) => {
            if (readinessFails) throw new Error('readiness lookup failed');
            return books.findReadiness(bookId);
          },
        },
        cutoff: {
          getCutoffSnapshot: async (deviceId, bookId) => {
            if (cutoffFails) throw new Error('snapshot failed');
            return cutoff.getCutoffSnapshot(deviceId, bookId);
          },
        },
      })
    );
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    });
    ({ server, baseUrl } = await listen(app));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const base = `/books/${BOOK}/community`;

  /** 독자가 부를 수 있는 커뮤니티 경로 전부 */
  function endpoints(): Array<[string, string, unknown?]> {
    const { post, comment } = community;
    return [
      ['GET', `${base}/posts`],
      ['GET', `${base}/posts?kind=theory`],
      ['GET', `${base}/posts/${post.post_id}`],
      ['POST', `${base}/posts`, { kind: 'review', body: '재미있었어요' }],
      ['POST', `${base}/posts/${post.post_id}/comments`, { body: '저도요' }],
      ['DELETE', `${base}/posts/${post.post_id}`],
      ['DELETE', `${base}/comments/${comment.comment_id}`],
      ['POST', `${base}/reports`, { target_type: 'post', target_id: post.post_id, reason: '욕설' }],
    ];
  }

  function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-device-id': READER, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** 모든 경로가 status 로 거절되고, 응답에 커뮤니티 내용이 0건이며, 저장소에 손대지 않았다 */
  async function expectAllDenied(status: number) {
    for (const [method, path, body] of endpoints()) {
      const res = await call(method, path, body);
      const text = await res.text();
      expect([method, path, res.status]).toEqual([method, path, status]);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(SECRET_COMMENT);
      expect(text).not.toContain('comment_count');
      expect(text).not.toContain('nickname');
      expect(text).not.toContain('posts');
    }
    expect(community.touched).toEqual([]);
  }

  /** positive 쌍 — 완독 독자는 같은 경로가 전부 열리고 글·댓글이 보인다 */
  async function expectAllOpen() {
    for (const [method, path, body] of endpoints()) {
      const res = await call(method, path, body);
      expect([method, path, res.status < 300]).toEqual([method, path, true]);
    }
    const list = (await (await call('GET', `${base}/posts`)).json()) as any;
    expect(list.posts).toHaveLength(1);
    expect(list.posts[0].body).toBe(SECRET);
    const detail = (await (await call('GET', `${base}/posts/${community.post.post_id}`)).json()) as any;
    expect(detail.comments.map((c: any) => c.body)).toEqual([SECRET_COMMENT]);
  }

  const readInOrder = async (to: number) => {
    await go(1, null);
    for (let p = 2; p <= to; p++) await go(p, p - 1);
  };

  test('FR-QNA-004: 책을 한 번도 열지 않은 독자는 커뮤니티 글 0건 (403)', async () => {
    await expectAllDenied(403);
  });

  test('FR-PRG-003: 목차로 마지막 쪽에 "이동만 하기"로 간 독자는 커뮤니티 글 0건 (403)', async () => {
    await readInOrder(3);
    await go(LAST_PAGE, 3); // 목차 점프 — 차례 넘김이 아니고 claim 도 없다
    await expectAllDenied(403);
  });

  test('FR-PRG-003: 마지막 쪽 하나 앞까지만 차례로 읽은 독자는 커뮤니티 글 0건 (403)', async () => {
    await readInOrder(LAST_PAGE - 1);
    await expectAllDenied(403);
  });

  test('FR-PRG-003: 1쪽부터 마지막 쪽까지 차례로 읽은 독자는 커뮤니티가 열린다 (positive 쌍)', async () => {
    await readInOrder(LAST_PAGE);
    await expectAllOpen();
  });

  test('FR-PRG-003: 목차 확인 창에서 "앞부분은 이미 읽었어요"로 마지막 쪽에 간 독자는 열린다 (positive 쌍)', async () => {
    await readInOrder(3);
    await go(LAST_PAGE, 3, 'read_through');
    await expectAllOpen();
  });

  test('FR-PRG-003: 마지막 쪽에 이동만 한 뒤 확인 카드에서 "그대로"를 고르면 계속 0건, "N쪽까지 읽었어요"를 고르면 열린다', async () => {
    await readInOrder(3);
    await go(LAST_PAGE, 3);
    await progress.confirmFrontier(READER, BOOK, 'keep');
    await expectAllDenied(403);

    await progress.confirmFrontier(READER, BOOK, 'furthest');
    await expectAllOpen();
  });

  test('절대 규칙 8번: 클라이언트가 완독·기준점을 실어 보내도 접근이 열리지 않는다 — 0건', async () => {
    await readInOrder(3);
    const claims = { is_complete: true, cutoff: LAST_PAGE, max_page: LAST_PAGE, page: LAST_PAGE };
    const query = `is_complete=true&cutoff=${LAST_PAGE}&page=${LAST_PAGE}`;
    const headers = { 'x-is-complete': 'true', 'x-cutoff': String(LAST_PAGE) };
    const attempts: Array<[string, string, unknown?]> = [
      ['GET', `${base}/posts?${query}`],
      ['GET', `${base}/posts/${community.post.post_id}?${query}`],
      ['POST', `${base}/posts?${query}`, { kind: 'review', body: '재미있었어요', ...claims }],
      ['POST', `${base}/posts/${community.post.post_id}/comments?${query}`, { body: '저도요', ...claims }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, body, headers);
      expect([method, path, res.status]).toEqual([method, path, 403]);
      expect(await res.text()).not.toContain(SECRET);
    }
    expect(community.touched).toEqual([]);

    // positive 쌍 — 같은 요청이 완독 뒤에는 열린다
    await go(LAST_PAGE, 3, 'read_through');
    const open = await call('GET', `${base}/posts?${query}`, undefined, headers);
    expect(open.status).toBe(200);
    expect(await open.text()).toContain(SECRET);
  });

  test('FR-SPL-005: 스냅샷을 만들지 못하면 완독 독자에게도 거절한다 — 빈 성공 응답이 아니다, 0건', async () => {
    await readInOrder(LAST_PAGE);
    cutoffFails = true;
    await expectAllDenied(500);

    cutoffFails = false;
    await expectAllOpen();
  });

  test('FR-SPL-005: 도서 공개 여부를 확인하지 못하면 거절한다 — 0건', async () => {
    await readInOrder(LAST_PAGE);
    readinessFails = true;
    await expectAllDenied(500);
  });

  test('R12: 검수 전 도서는 완독 진도가 있어도 404 — 0건', async () => {
    const { positions, books } = makeSeededFakes();
    books.set(BOOK, { total_pages: LAST_PAGE, chapters: CHAPTERS, ready: false });
    positions.set(READER, BOOK, { current_page: LAST_PAGE, event_seq: 1 });
    const cutoff = createCutoffService({ positions, books });
    expect((await cutoff.getCutoffSnapshot(READER, BOOK)).is_complete).toBe(true);
    const app = express();
    app.use(createCommunityRouter({ community: community.repo, content: books, cutoff }));
    const draft = await listen(app);
    try {
      for (const [method, path, body] of endpoints()) {
        const res = await fetch(`${draft.baseUrl}${path}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-device-id': READER },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        expect([method, path, res.status]).toEqual([method, path, 404]);
        expect(await res.text()).not.toContain(SECRET);
      }
      expect(community.touched).toEqual([]);
    } finally {
      await new Promise((resolve) => draft.server.close(resolve));
    }
  });
});

describe('완독자 커뮤니티 — 관리자 경로는 실제 관리자 인증 뒤에 있다 (FR-ADM-006 🚦)', () => {
  const TOKEN = 'a'.repeat(40);
  let server: Server;
  let baseUrl: string;
  let token: string | undefined;
  let calls: string[];

  beforeEach(async () => {
    token = TOKEN;
    calls = [];
    const admin: CommunityAdminRepository = {
      listReports: async () => {
        calls.push('listReports');
        return [
          {
            report_id: randomUUID(),
            book_id: BOOK,
            target_type: 'post',
            target_id: randomUUID(),
            reason: '욕설',
            created_at: new Date().toISOString(),
            target_body: SECRET,
            target_deleted: false,
          },
        ];
      },
      deletePost: async () => {
        calls.push('deletePost');
        return true;
      },
      deleteComment: async () => {
        calls.push('deleteComment');
        return true;
      },
    };
    const app = express();
    app.use(
      '/admin',
      createAdminRouter({
        jobs: {} as any,
        runner: {} as any,
        review: {} as any,
        uploadDir: '/nonexistent',
        community: admin,
        getToken: () => token,
      })
    );
    ({ server, baseUrl } = await listen(app));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const paths: Array<[string, string]> = [
    ['GET', '/admin/community/reports'],
    ['DELETE', `/admin/community/posts/${randomUUID()}`],
    ['DELETE', `/admin/community/comments/${randomUUID()}`],
  ];

  test('토큰이 없거나 틀리거나 독자 식별 헤더만 있으면 401 — 신고 내용 0건', async () => {
    const attempts: Array<Record<string, string>> = [
      {},
      { authorization: `Bearer ${'b'.repeat(40)}` },
      { 'x-device-id': READER },
    ];
    for (const headers of attempts) {
      for (const [method, path] of paths) {
        const res = await fetch(`${baseUrl}${path}`, { method, headers });
        expect([method, path, res.status]).toEqual([method, path, 401]);
        expect(await res.text()).not.toContain(SECRET);
      }
    }
    expect(calls).toEqual([]);
  });

  test('관리자 토큰이 설정되지 않은 서버에서는 503 — 신고 내용 0건', async () => {
    token = undefined;
    for (const [method, path] of paths) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(503);
    }
    expect(calls).toEqual([]);
  });

  test('올바른 관리자 토큰이면 신고 목록·삭제가 된다 (positive 쌍)', async () => {
    const headers = { authorization: `Bearer ${TOKEN}` };
    const statuses = [];
    for (const [method, path] of paths) {
      statuses.push((await fetch(`${baseUrl}${path}`, { method, headers })).status);
    }
    expect(statuses).toEqual([200, 204, 204]);
    expect(calls).toEqual(['listReports', 'deletePost', 'deleteComment']);
  });
});
