import { createHash } from 'crypto';
import express, { Request, Response, Router } from 'express';
import type { ContentRepository } from '../content/repository';
import type { CutoffService } from '../reading-state/cutoff.service';
import { attachReaderIdentity, resolveReaderId, UUID_PATTERN } from '../auth/reader-id.middleware';
import type {
  CommentRow,
  CommunityEngagementRepository,
  CommunityRepository,
  PostRow,
  PostSort,
  ReportTarget,
} from './repository';

const MAX_POST_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 1000;
const MAX_REASON_LENGTH = 200;
const PAGE_SIZE = 20;
const POSTS_PER_HOUR = 10;
const COMMENTS_PER_HOUR = 30;
const TARGETS: ReportTarget[] = ['post', 'comment'];
const SORTS: PostSort[] = ['new', 'popular'];
const DELETED_BODY = '삭제된 댓글입니다';

function nicknameFor(readerId: string, bookId: string): string {
  return `독자 ${createHash('sha256').update(`${readerId}:${bookId}`).digest('hex').slice(0, 4)}`;
}

// T19 — 가입 닉네임(users.display_name), 없으면 도서별 익명 이름
function displayName(name: string | null, readerId: string, bookId: string): string {
  return name?.trim() || nicknameFor(readerId, bookId);
}

function replyToNickname(row: CommentRow, post: PostRow, bookId: string): string | null {
  if (row.reply_to_comment_id === null) {
    return post.deleted ? null : displayName(post.author_name, post.reader_id, bookId);
  }
  return row.reply_to_reader_id === null
    ? null
    : displayName(row.reply_to_name, row.reply_to_reader_id, bookId);
}

function encodeCursor(seq: number): string {
  return Buffer.from(String(seq)).toString('base64url');
}

function decodeCursor(raw: string): number | null {
  const text = Buffer.from(raw, 'base64url').toString();
  if (!/^\d+$/.test(text)) return null;
  const seq = Number(text);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
}

// 인기순은 공감 수가 바뀌어 seq 커서로 이어 받을 수 없다 — 건너뛸 글 수를 커서로 쓴다.
// 최신순 커서와 섞이지 않게 앞에 'o:' 를 붙인다.
function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString('base64url');
}

function decodeOffsetCursor(raw: string): number | null {
  const match = /^o:(\d+)$/.exec(Buffer.from(raw, 'base64url').toString());
  const offset = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(offset) && offset > 0 ? offset : null;
}

function trimmedBody(raw: unknown, max: number): string | null {
  const body = typeof raw === 'string' ? raw.trim() : '';
  return body.length >= 1 && body.length <= max ? body : null;
}

function badRequest(res: Response, message: string) {
  return res.status(400).json({ error: 'BAD_REQUEST', message });
}

function notFound(res: Response, message: string) {
  return res.status(404).json({ error: 'NOT_FOUND', message });
}

function tooMany(res: Response) {
  return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests' });
}

export function createCommunityRouter({
  community,
  engagement,
  content,
  cutoff,
}: {
  community: CommunityRepository;
  /** 공감·인기순·허브. 없으면 그 경로를 열지 않는다 (2026-11-18 대표 지시) */
  engagement?: CommunityEngagementRepository;
  content: Pick<ContentRepository, 'findReadiness'> &
    Partial<Pick<ContentRepository, 'findCatalog'>>;
  cutoff: Pick<CutoffService, 'getCutoffSnapshot'>;
}): Router {
  const router = express.Router();
  router.use('/books/:bookId/community', express.json(), attachReaderIdentity());
  router.use('/community', attachReaderIdentity());

  function publicPost(row: PostRow, readerId: string, bookId: string) {
    return {
      post_id: row.post_id,
      body: row.deleted ? DELETED_BODY : row.body,
      nickname: row.deleted ? null : displayName(row.author_name, row.reader_id, bookId),
      created_at: row.created_at,
      comment_count: row.comment_count,
      // 삭제된 글은 공감을 받지 않고 개수도 보이지 않는다
      like_count: row.deleted ? 0 : (row.like_count ?? 0),
      liked_by_me: !row.deleted && row.liked_by_me === true,
      is_mine: !row.deleted && row.reader_id === readerId,
      deleted: row.deleted,
      // 대표 결정 2026-11-24 — 공유한 추리 결과지(공유 시점 복사본). 지운 글은 null
      review_card: row.deleted ? null : (row.review_card ?? null),
    };
  }

  function publicComment(row: CommentRow, post: PostRow, readerId: string, bookId: string) {
    return {
      comment_id: row.comment_id,
      body: row.body,
      nickname: displayName(row.author_name, row.reader_id, bookId),
      created_at: row.created_at,
      is_mine: row.reader_id === readerId,
      // 지운 댓글·지우거나 숨긴 답글의 작성자는 @대상·글쓴이 표시로도 드러내지 않는다
      is_post_author: !post.deleted && row.reader_id === post.reader_id,
      reply_to_nickname: replyToNickname(row, post, bookId),
      like_count: row.like_count ?? 0,
      liked_by_me: row.liked_by_me === true,
    };
  }

  /**
   * 독자 식별 + 공개 도서 확인 (R12 🚦) + 끝까지 간 독자 관문 (FR-QNA-004 🚦).
   *
   * 대표 결정 2026-11-19 정정 — 커뮤니티는 끝까지 간 독자(가장 멀리 펼친 쪽 = 마지막 쪽)만.
   * 차례 읽기(기준점)는 따지지 않는다. 판정은 기준점 결정기의 reached_end 하나로만 한다
   * (R2, 절대 규칙 2번). 클라이언트가 보낸 값은 보지 않는다 (절대 규칙 8번).
   * 관문은 저장소 접근보다 먼저다 — 막힌 요청에서는 글·개수를 조회하지 않는다 (절대 규칙 7).
   * 스냅샷을 만들지 못하면 던져서 거절한다 — 실패 = 미노출 (FR-SPL-005 🚦).
   * 커뮤니티는 기준점(cutoff)을 바꾸지 않는다.
   */
  async function authorize(req: Request, res: Response): Promise<string | null> {
    const readerId = resolveReaderId(req);
    if (!readerId || !UUID_PATTERN.test(readerId)) {
      badRequest(res, 'X-Device-Id header is required');
      return null;
    }
    const ready = await content.findReadiness(req.params.bookId);
    if (ready !== true) {
      notFound(res, 'Book not found');
      return null;
    }
    const snapshot = await cutoff.getCutoffSnapshot(readerId, req.params.bookId);
    if (snapshot.reached_end !== true) {
      res.status(403).json({ error: 'COMMUNITY_LOCKED' });
      return null;
    }
    return readerId;
  }

  router.get('/books/:bookId/community/posts', async (req, res, next) => {
    try {
      const { bookId } = req.params;
      const cursor = req.query.cursor;
      const sort = (req.query.sort ?? 'new') as PostSort;
      if (!SORTS.includes(sort)) {
        badRequest(res, 'sort must be new or popular');
        return;
      }
      let before: number | undefined;
      let offset: number | undefined;
      if (cursor !== undefined) {
        const decoded =
          typeof cursor !== 'string'
            ? null
            : sort === 'popular'
              ? decodeOffsetCursor(cursor)
              : decodeCursor(cursor);
        if (decoded === null) {
          badRequest(res, 'cursor is invalid');
          return;
        }
        if (sort === 'popular') offset = decoded;
        else before = decoded;
      }
      // FR-QNA-004 🚦 — 관문을 먼저 지난다. 끝까지 가지 않았으면 저장소를 부르지 않는다
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const rows = await community.listPosts(bookId, {
        before,
        offset,
        sort,
        viewerId: readerId,
        limit: PAGE_SIZE + 1,
      });
      const page = rows.slice(0, PAGE_SIZE);
      const hasMore = rows.length > PAGE_SIZE;
      res.json({
        posts: page.map((row) => publicPost(row, readerId, bookId)),
        // T19 — 머리줄 "N개의 댓글". 관문을 지난 뒤에만 센다 (절대 규칙 7)
        ...(engagement ? { total_count: await engagement.countVisiblePosts(bookId) } : {}),
        next_cursor: !hasMore
          ? null
          : sort === 'popular'
            ? encodeOffsetCursor((offset ?? 0) + PAGE_SIZE)
            : encodeCursor(page[page.length - 1].seq),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/books/:bookId/community/posts', async (req, res, next) => {
    try {
      const { bookId } = req.params;
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const body = trimmedBody(req.body?.body, MAX_POST_LENGTH);
      if (body === null) {
        badRequest(res, `body must be 1-${MAX_POST_LENGTH} characters`);
        return;
      }
      if ((await community.countRecentPosts(readerId)) >= POSTS_PER_HOUR) {
        tooMany(res);
        return;
      }
      const row = await community.createPost(bookId, readerId, body);
      res.status(201).json(publicPost(row, readerId, bookId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/books/:bookId/community/posts/:postId', async (req, res, next) => {
    try {
      const { bookId, postId } = req.params;
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const row = UUID_PATTERN.test(postId)
        ? await community.getPost(bookId, postId, readerId)
        : null;
      if (!row) {
        notFound(res, 'Post not found');
        return;
      }
      const comments = await community.listComments(bookId, postId, readerId);
      res.json({
        post: publicPost(row, readerId, bookId),
        comments: comments.map((c) => publicComment(c, row, readerId, bookId)),
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/books/:bookId/community/posts/:postId', async (req, res, next) => {
    try {
      const { bookId, postId } = req.params;
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const removed = UUID_PATTERN.test(postId)
        ? await community.deletePost(bookId, postId, readerId)
        : false;
      if (!removed) {
        notFound(res, 'Post not found');
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/books/:bookId/community/posts/:postId/comments', async (req, res, next) => {
    try {
      const { bookId, postId } = req.params;
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const body = trimmedBody(req.body?.body, MAX_COMMENT_LENGTH);
      if (body === null) {
        badRequest(res, `body must be 1-${MAX_COMMENT_LENGTH} characters`);
        return;
      }
      const replyTo = req.body?.reply_to_comment_id ?? null;
      if (replyTo !== null && (typeof replyTo !== 'string' || !UUID_PATTERN.test(replyTo))) {
        badRequest(res, 'reply_to_comment_id must be a comment id');
        return;
      }
      if (!UUID_PATTERN.test(postId)) {
        notFound(res, 'Post not found');
        return;
      }
      if ((await community.countRecentComments(readerId)) >= COMMENTS_PER_HOUR) {
        tooMany(res);
        return;
      }
      const row = await community.createComment(bookId, postId, readerId, body, replyTo);
      const post = row ? await community.getPost(bookId, postId, readerId) : null;
      if (!row || !post) {
        notFound(res, 'Post not found');
        return;
      }
      res.status(201).json(publicComment(row, post, readerId, bookId));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/books/:bookId/community/comments/:commentId', async (req, res, next) => {
    try {
      const { bookId, commentId } = req.params;
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const removed = UUID_PATTERN.test(commentId)
        ? await community.deleteComment(bookId, commentId, readerId)
        : false;
      if (!removed) {
        notFound(res, 'Comment not found');
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/books/:bookId/community/reports', async (req, res, next) => {
    try {
      const { bookId } = req.params;
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const targetType = req.body?.target_type;
      const reason = trimmedBody(req.body?.reason, MAX_REASON_LENGTH);
      if (!TARGETS.includes(targetType) || typeof req.body?.target_id !== 'string') {
        badRequest(res, 'target_type must be post or comment');
        return;
      }
      if (reason === null) {
        badRequest(res, `reason must be 1-${MAX_REASON_LENGTH} characters`);
        return;
      }
      const targetId: string = req.body.target_id;
      const stored = UUID_PATTERN.test(targetId)
        ? await community.createReport(bookId, readerId, targetType, targetId, reason)
        : false;
      if (!stored) {
        notFound(res, 'Report target not found');
        return;
      }
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  if (engagement) {
    // 2026-11-18 대표 지시 — 공감. 커뮤니티 관문(authorize)을 지난 독자만 누르고 취소한다
    for (const method of ['post', 'delete'] as const) {
      router[method]('/books/:bookId/community/posts/:postId/like', async (req, res, next) => {
        try {
          const { bookId, postId } = req.params;
          const readerId = await authorize(req, res);
          if (!readerId) return;
          const done = UUID_PATTERN.test(postId)
            ? method === 'post'
              ? await engagement.likePost(bookId, postId, readerId)
              : await engagement.unlikePost(bookId, postId, readerId)
            : false;
          if (!done) {
            notFound(res, 'Post not found');
            return;
          }
          res.json(await engagement.likeState(bookId, postId, readerId));
        } catch (error) {
          next(error);
        }
      });
      // T19 답글 좋아요 — FR-QNA-004 🚦 관문(authorize)을 지난 독자만
      router[method](
        '/books/:bookId/community/comments/:commentId/like',
        async (req, res, next) => {
          try {
            const { bookId, commentId } = req.params;
            const readerId = await authorize(req, res);
            if (!readerId) return;
            const done = UUID_PATTERN.test(commentId)
              ? method === 'post'
                ? await engagement.likeComment(bookId, commentId, readerId)
                : await engagement.unlikeComment(bookId, commentId, readerId)
              : false;
            if (!done) {
              notFound(res, 'Comment not found');
              return;
            }
            res.json(await engagement.commentLikeState(bookId, commentId, readerId));
          } catch (error) {
            next(error);
          }
        }
      );
    }
  }

  const findCatalog = content.findCatalog;
  if (engagement && findCatalog) {
    /**
     * 커뮤니티 허브 — 공개 도서별 커뮤니티 입구 (2026-11-18 대표 지시).
     *
     * 열림 여부는 도서마다 getCutoffSnapshot 의 reached_end 하나로만 정한다 (FR-QNA-004 🚦,
     * 대표 결정 2026-11-19 정정 — 끝까지 간 독자만, 차례 읽기는 따지지 않음).
     * 잠긴 도서에는 글 수·글 내용을 넣지 않고, 글 수 조회 자체를 하지 않는다 (절대 규칙 7).
     * 기준점 조회가 실패한 도서는 잠김으로 내린다 (FR-SPL-005 🚦 실패 = 미노출).
     * 싸비 미완비 도서는 커뮤니티에 들어갈 수 없으므로 목록에서 뺀다 (R12 🚦).
     */
    router.get('/community/books', async (req, res, next) => {
      try {
        const readerId = resolveReaderId(req);
        if (!readerId || !UUID_PATTERN.test(readerId)) {
          badRequest(res, 'X-Device-Id header is required');
          return;
        }
        const catalog = (await findCatalog()).filter((book) => book.ssabi_ready === true);
        const books = await Promise.all(
          catalog.map(async (book) => {
            const card = {
              book_id: book.book_id,
              title: book.title,
              author: book.author,
              cover_url: book.cover_url,
            };
            const reachedEnd = await cutoff
              .getCutoffSnapshot(readerId, book.book_id)
              .then((snapshot) => snapshot.reached_end === true)
              .catch(() => false);
            if (!reachedEnd) return { ...card, access: 'locked' as const };
            return {
              ...card,
              access: 'open' as const,
              post_count: await engagement.countVisiblePosts(book.book_id),
            };
          })
        );
        res.json({ books });
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}
