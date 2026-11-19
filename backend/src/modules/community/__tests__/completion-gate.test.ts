/**
 * 완독자 커뮤니티 — 끝까지 간 독자 관문
 *
 * 대표 결정 2026-11-19 정정 — "끝까지 간 독자(가장 멀리 펼친 쪽 = 마지막 쪽)만, 차례 읽기는 따지지 않음".
 *   - 같은 날 앞서 기록한 "커뮤니티 관문 없애기(누구나)"는 대표 뜻을 잘못 읽은 것이었다.
 *   - 2026-11-17의 "차례로 읽어 완독(is_complete)한 독자만"도 아니다 — 목차로 마지막 쪽에 간 독자도 들어온다.
 * 판정은 기준점 결정기(getCutoffSnapshot)의 reached_end 하나로만 한다
 * (reached_end = 진도 레코드 있음 && max_page >= total_pages, R2·절대 규칙 2번).
 * 여기서는 가짜 스냅샷이 아니라 **실제 결정기와 진도 서비스**를 꽂아 본다.
 * 관문은 커뮤니티 입장만 정한다 — 기준점(cutoff)·완독(is_complete)·스포일러 상한은 바뀌지 않는다.
 *
 * 조항: FR-QNA-004 🚦 (관문 파생값), FR-PRG-003 🚦 (기준점 불변), FR-SPL-005 🚦 / R11 (실패 = 미노출),
 *       R12 🚦 (미공개 도서), 절대 규칙 8번 (클라이언트가 보낸 값 무시), FR-ADM-006 🚦 (관리자 인증)
 * negative(0건)는 positive 와 쌍으로 둔다 (CLAUDE.md 7장).
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import express from 'express';
import { createCommunityRouter } from '../router';
import type {
  CommentRow,
  CommunityAdminRepository,
  CommunityEngagementRepository,
  CommunityRepository,
  PostRow,
} from '../repository';
import { createAdminRouter } from '../../ingest/admin-router';
import { createCutoffService } from '../../reading-state/cutoff.service';
import { createProgressService } from '../../reading-state/progress.service';
import { makeSeededFakes } from '../../../../tests/unit/reading-state/fakes';

const READER = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const BOOK = 'gate-book';
const DRAFT = 'draft-book';
const LAST_PAGE = 68;
const CHAPTERS = [
  { chapter_no: 1, title: '1장', start_page: 1, end_page: 34 },
  { chapter_no: 2, title: '2장', start_page: 35, end_page: LAST_PAGE },
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

describe('완독자 커뮤니티 — 끝까지 간 독자만 (대표 결정 2026-11-19 정정, 실제 기준점 결정기)', () => {
  let server: Server;
  let baseUrl: string;
  let community: ReturnType<typeof seededCommunity>;
  let cutoffFails: boolean;
  let readinessFails: boolean;
  let go: (page: number, from?: number | null, claim?: 'read_through') => Promise<void>;
  let progress: ReturnType<typeof createProgressService>;
  let cutoff: ReturnType<typeof createCutoffService>;
  let fakes: ReturnType<typeof makeSeededFakes>;
  let hubTouched: string[];

  beforeEach(async () => {
    fakes = makeSeededFakes();
    const { positions, books } = fakes;
    books.set(BOOK, { total_pages: LAST_PAGE, chapters: CHAPTERS });
    books.set(DRAFT, { total_pages: LAST_PAGE, chapters: CHAPTERS, ready: false });
    progress = createProgressService({ positions, books });
    cutoff = createCutoffService({ positions, books });
    let seq = 0;
    go = (page, from, claim) =>
      progress.acceptProgressEvent(READER, BOOK, { page, seq: ++seq, from_page: from, claim });
    community = seededCommunity();
    cutoffFails = false;
    readinessFails = false;
    hubTouched = [];
    const engagement = {
      likePost: async () => {
        community.touched.push('likePost');
        return true;
      },
      unlikePost: async () => {
        community.touched.push('unlikePost');
        return true;
      },
      likeState: async () => {
        community.touched.push('likeState');
        return { like_count: 1, liked_by_me: true };
      },
      countVisiblePosts: async (bookId: string) => {
        hubTouched.push(`countVisiblePosts:${bookId}`);
        return 7;
      },
    } as unknown as CommunityEngagementRepository;

    const app = express();
    app.use(
      createCommunityRouter({
        community: community.repo,
        engagement,
        content: {
          findReadiness: async (bookId) => {
            if (readinessFails) throw new Error('readiness lookup failed');
            return books.findReadiness(bookId);
          },
          findCatalog: async () =>
            [BOOK, DRAFT].map((book_id) => ({
              book_id,
              title: book_id === BOOK ? '가상범인' : '초안',
              author: '김내성',
              cover_url: null,
              ssabi_ready: book_id === BOOK,
            })) as any,
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

  /** 독자가 부를 수 있는 커뮤니티 경로 전부 (읽기·쓰기·공감·신고) */
  function endpoints(bookId = BOOK): Array<[string, string, unknown?]> {
    const { post, comment } = community;
    const base = `/books/${bookId}/community`;
    return [
      ['GET', `${base}/posts`],
      ['GET', `${base}/posts?kind=theory`],
      ['GET', `${base}/posts?sort=popular`],
      ['GET', `${base}/posts/${post.post_id}`],
      ['POST', `${base}/posts`, { kind: 'review', body: '재미있었어요' }],
      ['POST', `${base}/posts/${post.post_id}/comments`, { body: '저도요' }],
      ['POST', `${base}/posts/${post.post_id}/like`],
      ['DELETE', `${base}/posts/${post.post_id}/like`],
      ['DELETE', `${base}/posts/${post.post_id}`],
      ['DELETE', `${base}/comments/${comment.comment_id}`],
      ['POST', `${base}/reports`, { target_type: 'post', target_id: post.post_id, reason: '욕설' }],
    ];
  }

  function call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = { 'x-device-id': READER }
  ) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** 모든 경로가 status 로 거절되고, 응답에 커뮤니티 내용이 0건이며, 저장소에 손대지 않았다 */
  async function expectAllDenied(status: number, bookId = BOOK, headers?: Record<string, string>) {
    for (const [method, path, body] of endpoints(bookId)) {
      const res = await call(method, path, body, headers);
      const text = await res.text();
      expect([method, path, res.status]).toEqual([method, path, status]);
      if (status === 403) expect(JSON.parse(text)).toEqual({ error: 'COMMUNITY_LOCKED' });
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(SECRET_COMMENT);
      expect(text).not.toContain('comment_count');
      expect(text).not.toContain('like_count');
      expect(text).not.toContain('nickname');
      expect(text).not.toContain('posts');
    }
    expect(community.touched).toEqual([]);
  }

  /** positive 쌍 — 같은 경로가 전부 열리고 글·댓글이 보인다 */
  async function expectAllOpen() {
    for (const [method, path, body] of endpoints()) {
      const res = await call(method, path, body);
      expect([method, path, res.status < 300]).toEqual([method, path, true]);
    }
    const list = (await (await call('GET', `/books/${BOOK}/community/posts`)).json()) as any;
    expect(list.posts).toHaveLength(1);
    expect(list.posts[0].body).toBe(SECRET);
    const detail = (await (
      await call('GET', `/books/${BOOK}/community/posts/${community.post.post_id}`)
    ).json()) as any;
    expect(detail.comments.map((c: any) => c.body)).toEqual([SECRET_COMMENT]);
  }

  const readInOrder = async (to: number) => {
    await go(1, null);
    for (let p = 2; p <= to; p++) await go(p, p - 1);
  };

  // ── 끝까지 가지 않은 독자 (negative, 0건) ────────────────────────────────

  test('FR-QNA-004: 책을 한 번도 열지 않은 독자는 커뮤니티 글 0건 (403) — 마지막 쪽을 펼치면 열린다 (positive 쌍)', async () => {
    await expectAllDenied(403);
    await go(LAST_PAGE, null);
    await expectAllOpen();
  });

  test('FR-QNA-004: 68쪽 중 40쪽까지 간 독자(가장 멀리 펼친 쪽 40)는 커뮤니티 글 0건 (403) — 끝까지 가면 열린다 (positive 쌍)', async () => {
    await readInOrder(40);
    expect((await cutoff.getCutoffSnapshot(READER, BOOK)).furthest_page).toBe(40);
    await expectAllDenied(403);

    for (let p = 41; p <= LAST_PAGE; p++) await go(p, p - 1);
    await expectAllOpen();
  });

  test('FR-QNA-004: 마지막 쪽 하나 앞까지 간 독자는 커뮤니티 글 0건 (403) — 한 장 더 넘기면 열린다 (positive 쌍)', async () => {
    await readInOrder(LAST_PAGE - 1);
    await expectAllDenied(403);
    await go(LAST_PAGE, LAST_PAGE - 1);
    await expectAllOpen();
  });

  // ── 끝까지 간 독자 (차례 읽기는 따지지 않는다) ────────────────────────────

  test('대표 결정 2026-11-19 정정: 목차로 마지막 쪽에 "이동만 하기"로 간 독자도 들어온다 — 차례 읽기는 따지지 않는다', async () => {
    await readInOrder(3);
    await go(LAST_PAGE, 3); // 목차 점프 — 차례 넘김도 아니고 claim 도 없다
    const snapshot = await cutoff.getCutoffSnapshot(READER, BOOK);
    expect(snapshot.reached_end).toBe(true);
    expect(snapshot.is_complete).toBe(false);
    expect(snapshot.cutoff).toBe(3);
    await expectAllOpen();
  });

  test('대표 결정 2026-11-19 정정: 읽은 쪽에 구멍이 있어도 가장 멀리 펼친 쪽이 마지막 쪽이면 들어온다', async () => {
    const pages = [
      ...Array.from({ length: 10 }, (_, i) => i + 1),
      ...Array.from({ length: 30 }, (_, i) => 39 + i),
    ];
    fakes.positions.set(READER, BOOK, {
      current_page: LAST_PAGE,
      event_seq: 1,
      max_page: LAST_PAGE,
      read_pages: pages,
    });
    const snapshot = await cutoff.getCutoffSnapshot(READER, BOOK);
    expect(snapshot.cutoff).toBe(10);
    expect(snapshot.is_complete).toBe(false);
    await expectAllOpen();
  });

  test('대표 결정 2026-11-19 정정: 마지막 쪽에 간 뒤 앞쪽으로 되돌아가도 계속 들어온다 (가장 먼 쪽은 줄지 않는다)', async () => {
    await readInOrder(3);
    await go(LAST_PAGE, 3);
    await go(2, null);
    expect((await cutoff.getCutoffSnapshot(READER, BOOK)).current_page).toBe(2);
    await expectAllOpen();
  });

  test('1쪽부터 마지막 쪽까지 차례로 읽은 독자도 들어온다', async () => {
    await readInOrder(LAST_PAGE);
    await expectAllOpen();
  });

  // ── 관문은 기준점을 바꾸지 않는다 ─────────────────────────────────────────

  test('FR-PRG-003: 커뮤니티 관문을 지나 읽고 써도 기준점·완독·퍼센트는 바뀌지 않는다', async () => {
    await readInOrder(3);
    await go(LAST_PAGE, 3);
    const before = await cutoff.getCutoffSnapshot(READER, BOOK);
    await expectAllOpen();
    await call('GET', '/community/books');
    const after = await cutoff.getCutoffSnapshot(READER, BOOK);
    expect(after).toEqual(before);
    expect(after.cutoff).toBe(3);
    expect(after.is_complete).toBe(false);
  });

  // ── 클라이언트가 보낸 값은 보지 않는다 ───────────────────────────────────

  test('절대 규칙 8번: 클라이언트가 끝·완독·기준점을 실어 보내도 열리지 않는다 — 0건, 서버에 끝까지 간 기록이 생기면 열린다 (positive 쌍)', async () => {
    await readInOrder(3);
    const claims = {
      reached_end: true,
      is_complete: true,
      cutoff: LAST_PAGE,
      max_page: LAST_PAGE,
      page: LAST_PAGE,
    };
    const query = `reached_end=true&is_complete=true&max_page=${LAST_PAGE}&page=${LAST_PAGE}`;
    const headers = { 'x-device-id': READER, 'x-reached-end': 'true', 'x-max-page': String(LAST_PAGE) };
    const base = `/books/${BOOK}/community`;
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

    await go(LAST_PAGE, 3);
    const open = await call('GET', `${base}/posts?${query}`, undefined, headers);
    expect(open.status).toBe(200);
    expect(await open.text()).toContain(SECRET);
  });

  // ── 실패 = 미노출 ────────────────────────────────────────────────────────

  test('FR-SPL-005: 스냅샷을 만들지 못하면 끝까지 간 독자에게도 거절한다 — 빈 성공 응답이 아니다, 0건', async () => {
    await go(LAST_PAGE, null);
    cutoffFails = true;
    await expectAllDenied(500);

    cutoffFails = false;
    await expectAllOpen();
  });

  test('FR-SPL-005: 도서 공개 여부를 확인하지 못하면 거절한다 — 0건', async () => {
    await go(LAST_PAGE, null);
    readinessFails = true;
    await expectAllDenied(500);

    readinessFails = false;
    await expectAllOpen();
  });

  test('R12: 검수 전·없는 도서는 끝까지 간 기록이 있어도 404 — 0건, 공개 도서는 열린다 (positive 쌍)', async () => {
    fakes.positions.set(READER, DRAFT, { current_page: LAST_PAGE, event_seq: 1 });
    expect((await cutoff.getCutoffSnapshot(READER, DRAFT)).reached_end).toBe(true);
    await expectAllDenied(404, DRAFT);
    await expectAllDenied(404, 'missing-book');
    await go(LAST_PAGE, null);
    await expectAllOpen();
  });

  test('독자 식별 헤더가 없으면 커뮤니티 글 0건 (400) — 헤더가 있으면 열린다 (positive 쌍)', async () => {
    await go(LAST_PAGE, null);
    await expectAllDenied(400, BOOK, {});
    await expectAllDenied(400, BOOK, { 'x-device-id': 'not-a-uuid' });
    await expectAllOpen();
  });

  // ── 허브 ────────────────────────────────────────────────────────────────

  test('FR-QNA-004: 허브 — 끝까지 가지 않은 도서는 잠김으로만 오고 글 수 필드·개수 조회 0건, 끝까지 가면 열림과 글 수 (positive 쌍)', async () => {
    await readInOrder(40);
    const locked = await call('GET', '/community/books');
    const lockedText = await locked.text();
    expect(JSON.parse(lockedText).books).toEqual([
      { book_id: BOOK, title: '가상범인', author: '김내성', cover_url: null, access: 'locked' },
    ]);
    expect(lockedText).not.toContain('post_count');
    expect(hubTouched).toEqual([]);

    await go(LAST_PAGE, 40); // 목차로 건너뛰어도 된다
    const open = (await (await call('GET', '/community/books')).json()) as any;
    expect(open.books).toEqual([
      { book_id: BOOK, title: '가상범인', author: '김내성', cover_url: null, access: 'open', post_count: 7 },
    ]);
    expect(hubTouched).toEqual([`countVisiblePosts:${BOOK}`]);
  });

  test('FR-SPL-005: 허브 — 스냅샷을 만들지 못한 도서는 잠김으로 내려가고 개수를 조회하지 않는다', async () => {
    await go(LAST_PAGE, null);
    cutoffFails = true;
    const body = (await (await call('GET', '/community/books')).json()) as any;
    expect(body.books.map((b: any) => b.access)).toEqual(['locked']);
    expect(hubTouched).toEqual([]);
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
