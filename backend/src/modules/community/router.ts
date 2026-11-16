import { createHash } from 'crypto';
import express, { Request, Response, Router } from 'express';
import type { ContentRepository } from '../content/repository';
import type { CutoffService } from '../reading-state/cutoff.service';
import { attachReaderIdentity, resolveReaderId, UUID_PATTERN } from '../auth/reader-id.middleware';
import type { CommentRow, CommunityRepository, PostKind, PostRow, ReportTarget } from './repository';

const MAX_POST_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 1000;
const MAX_REASON_LENGTH = 200;
const PAGE_SIZE = 20;
const POSTS_PER_HOUR = 10;
const COMMENTS_PER_HOUR = 30;
const KINDS: PostKind[] = ['theory', 'review'];
const TARGETS: ReportTarget[] = ['post', 'comment'];
const DELETED_BODY = '삭제된 글입니다';

function nicknameFor(readerId: string, bookId: string): string {
  return `독자 ${createHash('sha256').update(`${readerId}:${bookId}`).digest('hex').slice(0, 4)}`;
}

function encodeCursor(seq: number): string {
  return Buffer.from(String(seq)).toString('base64url');
}

function decodeCursor(raw: string): number | null {
  const seq = Number(Buffer.from(raw, 'base64url').toString());
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
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
  content,
  cutoff,
}: {
  community: CommunityRepository;
  content: Pick<ContentRepository, 'findReadiness'>;
  cutoff: Pick<CutoffService, 'getCutoffSnapshot'>;
}): Router {
  const router = express.Router();
  router.use('/books/:bookId/community', express.json(), attachReaderIdentity());

  function publicPost(row: PostRow, readerId: string, bookId: string) {
    return {
      post_id: row.post_id,
      kind: row.kind,
      body: row.deleted ? DELETED_BODY : row.body,
      nickname: row.deleted ? null : nicknameFor(row.reader_id, bookId),
      created_at: row.created_at,
      comment_count: row.comment_count,
      is_mine: !row.deleted && row.reader_id === readerId,
      deleted: row.deleted,
    };
  }

  function publicComment(row: CommentRow, readerId: string, bookId: string) {
    return {
      comment_id: row.comment_id,
      body: row.body,
      nickname: nicknameFor(row.reader_id, bookId),
      created_at: row.created_at,
      is_mine: row.reader_id === readerId,
    };
  }

  // FR-QNA-004 🚦, R12 🚦
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
    if (snapshot.is_complete !== true) {
      res.status(403).json({ error: 'COMMUNITY_LOCKED' });
      return null;
    }
    return readerId;
  }

  router.get('/books/:bookId/community/posts', async (req, res, next) => {
    try {
      const { bookId } = req.params;
      const kind = req.query.kind;
      const cursor = req.query.cursor;
      if (kind !== undefined && !KINDS.includes(kind as PostKind)) {
        badRequest(res, 'kind must be theory or review');
        return;
      }
      let before: number | undefined;
      if (cursor !== undefined) {
        const decoded = typeof cursor === 'string' ? decodeCursor(cursor) : null;
        if (decoded === null) {
          badRequest(res, 'cursor is invalid');
          return;
        }
        before = decoded;
      }
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const rows = await community.listPosts(bookId, {
        kind: kind as PostKind | undefined,
        before,
        limit: PAGE_SIZE + 1,
      });
      const page = rows.slice(0, PAGE_SIZE);
      res.json({
        posts: page.map((row) => publicPost(row, readerId, bookId)),
        next_cursor: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1].seq) : null,
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
      if (!KINDS.includes(req.body?.kind)) {
        badRequest(res, 'kind must be theory or review');
        return;
      }
      const body = trimmedBody(req.body?.body, MAX_POST_LENGTH);
      if (body === null) {
        badRequest(res, `body must be 1-${MAX_POST_LENGTH} characters`);
        return;
      }
      if ((await community.countRecentPosts(readerId)) >= POSTS_PER_HOUR) {
        tooMany(res);
        return;
      }
      const row = await community.createPost(bookId, readerId, req.body.kind, body);
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
      const row = UUID_PATTERN.test(postId) ? await community.getPost(bookId, postId) : null;
      if (!row) {
        notFound(res, 'Post not found');
        return;
      }
      const comments = await community.listComments(bookId, postId);
      res.json({
        post: publicPost(row, readerId, bookId),
        comments: comments.map((c) => publicComment(c, readerId, bookId)),
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
      if (!UUID_PATTERN.test(postId)) {
        notFound(res, 'Post not found');
        return;
      }
      if ((await community.countRecentComments(readerId)) >= COMMENTS_PER_HOUR) {
        tooMany(res);
        return;
      }
      const row = await community.createComment(bookId, postId, readerId, body);
      if (!row) {
        notFound(res, 'Post not found');
        return;
      }
      res.status(201).json(publicComment(row, readerId, bookId));
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

  return router;
}
