/**
 * 완독자 커뮤니티 — 접근 규칙 (대표 결정 2026-11-19 "커뮤니티 관문 없애기")
 *
 * 명세 변경이다. 느슨하게 고친 것이 아니다.
 * 2026-11-17 결정 ④("완독한 독자만, 미완독자에게는 글·개수·제목을 보이지 않는다")를
 * 대표가 2026-11-19에 대체했다 — "완독이 맞는지 아닌지 판별까지 하지는 말자".
 * 그래서 이 파일의 예전 시험(미완독 독자 403·0건)을 새 규칙의 시험으로 바꿨다:
 *   - 미완독 독자도 글을 읽고 쓴다 (책을 한 번도 열지 않은 독자 포함)
 *   - 커뮤니티 이용은 기준점(cutoff)을 바꾸지 않는다 — 실제 결정기를 꽂아 확인한다
 *   - 그대로 남는 막음: 검수 전 도서 404 (R12 🚦), 독자 식별 없음 400,
 *     공개 여부를 확인하지 못하면 거절 (FR-SPL-005 🚦 실패 = 미노출) — 모두 0건 + positive 쌍
 * 기준점·챗봇·관계도·타임라인의 스포일러 상한은 바뀌지 않는다.
 * 남는 위험(결정 기록): 결말 토론이 미완독 독자에게 보인다.
 *
 * 조항: R12 🚦, FR-SPL-005 🚦, FR-PRG-003 🚦 (기준점 불변), FR-ADM-006 🚦 (관리자 인증)
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
const DRAFT = 'draft-book';
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

describe('완독자 커뮤니티 — 관문 없음 (대표 결정 2026-11-19)', () => {
  let server: Server;
  let baseUrl: string;
  let community: ReturnType<typeof seededCommunity>;
  let readinessFails: boolean;
  let go: (page: number, from?: number | null, claim?: 'read_through') => Promise<void>;
  let cutoff: ReturnType<typeof createCutoffService>;

  beforeEach(async () => {
    const { positions, books } = makeSeededFakes();
    books.set(BOOK, { total_pages: LAST_PAGE, chapters: CHAPTERS });
    books.set(DRAFT, { total_pages: LAST_PAGE, chapters: CHAPTERS, ready: false });
    const progress = createProgressService({ positions, books });
    cutoff = createCutoffService({ positions, books });
    let seq = 0;
    go = (page, from, claim) =>
      progress.acceptProgressEvent(READER, BOOK, { page, seq: ++seq, from_page: from, claim });
    community = seededCommunity();
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

  /** 독자가 부를 수 있는 커뮤니티 경로 전부 */
  function endpoints(bookId = BOOK): Array<[string, string, unknown?]> {
    const { post, comment } = community;
    const base = `/books/${bookId}/community`;
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

  function call(method: string, path: string, body?: unknown, headers: Record<string, string> = { 'x-device-id': READER }) {
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
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(SECRET_COMMENT);
      expect(text).not.toContain('comment_count');
      expect(text).not.toContain('nickname');
      expect(text).not.toContain('posts');
    }
    expect(community.touched).toEqual([]);
  }

  /** 같은 경로가 전부 열리고 글·댓글이 보인다 */
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

  test('대표 결정 2026-11-19: 미완독 독자도 커뮤니티 글을 읽는다 — 책을 한 번도 열지 않은 독자도 읽고 쓴다', async () => {
    expect((await cutoff.getCutoffSnapshot(READER, BOOK)).is_complete).toBe(false);
    await expectAllOpen();
  });

  test('대표 결정 2026-11-19: 미완독 독자도 커뮤니티 글을 읽는다 — 3쪽까지 읽은 독자', async () => {
    await readInOrder(3);
    expect((await cutoff.getCutoffSnapshot(READER, BOOK)).is_complete).toBe(false);
    await expectAllOpen();
  });

  test('대표 결정 2026-11-19: 완독 독자도 그대로 읽고 쓴다', async () => {
    await readInOrder(LAST_PAGE);
    expect((await cutoff.getCutoffSnapshot(READER, BOOK)).is_complete).toBe(true);
    await expectAllOpen();
  });

  test('FR-PRG-003: 커뮤니티를 읽고 써도 기준점은 바뀌지 않는다', async () => {
    await readInOrder(3);
    const before = await cutoff.getCutoffSnapshot(READER, BOOK);
    await expectAllOpen();
    const after = await cutoff.getCutoffSnapshot(READER, BOOK);
    expect(after).toEqual(before);
    expect(after.cutoff).toBe(3);
  });

  test('R12: 검수 전 도서는 커뮤니티 글 0건 (404) — 같은 독자의 공개 도서는 열린다 (positive 쌍)', async () => {
    await expectAllDenied(404, DRAFT);
    await expectAllDenied(404, 'missing-book');
    await expectAllOpen();
  });

  test('독자 식별 헤더가 없으면 커뮤니티 글 0건 (400) — 헤더가 있으면 열린다 (positive 쌍)', async () => {
    await expectAllDenied(400, BOOK, {});
    await expectAllDenied(400, BOOK, { 'x-device-id': 'not-a-uuid' });
    await expectAllOpen();
  });

  test('FR-SPL-005: 도서 공개 여부를 확인하지 못하면 거절한다 — 빈 성공 응답이 아니다, 0건', async () => {
    readinessFails = true;
    await expectAllDenied(500);

    readinessFails = false;
    await expectAllOpen();
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
