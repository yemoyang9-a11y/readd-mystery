import { randomUUID } from 'crypto';
import type {
  CommentRow,
  CommunityAdminRepository,
  CommunityRepository,
  PostRow,
  ReportSummary,
} from './repository';

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const POST_SELECT = `
  SELECT p.seq::int AS seq, p.post_id, p.reader_id, p.kind, p.body, p.created_at,
         (p.deleted_at IS NOT NULL) AS deleted,
         (SELECT count(*)::int FROM community_comments c
           WHERE c.post_id = p.post_id AND c.deleted_at IS NULL) AS comment_count
    FROM community_posts p`;

const VISIBLE = `(p.deleted_at IS NULL OR EXISTS (
  SELECT 1 FROM community_comments c WHERE c.post_id = p.post_id AND c.deleted_at IS NULL))`;

function toPost(row: any): PostRow {
  return {
    seq: row.seq,
    post_id: row.post_id,
    reader_id: row.reader_id,
    kind: row.kind,
    body: row.body,
    created_at: new Date(row.created_at).toISOString(),
    deleted: row.deleted,
    comment_count: row.comment_count,
  };
}

function toComment(row: any): CommentRow {
  return {
    comment_id: row.comment_id,
    post_id: row.post_id,
    reader_id: row.reader_id,
    body: row.body,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export function createPgCommunityRepository(db: QueryClient): CommunityRepository {
  return {
    async listPosts(bookId, { kind, before, limit }) {
      const { rows } = await db.query(
        `${POST_SELECT}
          WHERE p.book_id = $1 AND ${VISIBLE}
            AND ($2::text IS NULL OR p.kind = $2)
            AND ($3::bigint IS NULL OR p.seq < $3)
          ORDER BY p.seq DESC
          LIMIT $4`,
        [bookId, kind ?? null, before ?? null, limit]
      );
      return rows.map(toPost);
    },

    async getPost(bookId, postId) {
      const { rows } = await db.query(
        `${POST_SELECT} WHERE p.book_id = $1 AND p.post_id = $2 AND ${VISIBLE}`,
        [bookId, postId]
      );
      return rows.length === 0 ? null : toPost(rows[0]);
    },

    async listComments(bookId, postId) {
      const { rows } = await db.query(
        `SELECT comment_id, post_id, reader_id, body, created_at
           FROM community_comments
          WHERE book_id = $1 AND post_id = $2 AND deleted_at IS NULL
          ORDER BY seq`,
        [bookId, postId]
      );
      return rows.map(toComment);
    },

    async createPost(bookId, readerId, kind, body) {
      const postId = randomUUID();
      await db.query(
        `INSERT INTO community_posts (post_id, book_id, reader_id, kind, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [postId, bookId, readerId, kind, body]
      );
      const { rows } = await db.query(`${POST_SELECT} WHERE p.post_id = $1`, [postId]);
      return toPost(rows[0]);
    },

    async createComment(bookId, postId, readerId, body) {
      const { rows } = await db.query(
        `INSERT INTO community_comments (comment_id, post_id, book_id, reader_id, body)
         SELECT $1, p.post_id, p.book_id, $4, $5
           FROM community_posts p
          WHERE p.post_id = $2 AND p.book_id = $3 AND p.deleted_at IS NULL
         RETURNING comment_id, post_id, reader_id, body, created_at`,
        [randomUUID(), postId, bookId, readerId, body]
      );
      return rows.length === 0 ? null : toComment(rows[0]);
    },

    async deletePost(bookId, postId, readerId) {
      const { rows } = await db.query(
        `UPDATE community_posts SET deleted_at = now()
          WHERE post_id = $1 AND book_id = $2 AND reader_id = $3 AND deleted_at IS NULL
          RETURNING post_id`,
        [postId, bookId, readerId]
      );
      return rows.length > 0;
    },

    async deleteComment(bookId, commentId, readerId) {
      const { rows } = await db.query(
        `UPDATE community_comments SET deleted_at = now()
          WHERE comment_id = $1 AND book_id = $2 AND reader_id = $3 AND deleted_at IS NULL
          RETURNING comment_id`,
        [commentId, bookId, readerId]
      );
      return rows.length > 0;
    },

    async countRecentPosts(readerId) {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM community_posts
          WHERE reader_id = $1 AND created_at > now() - interval '1 hour'`,
        [readerId]
      );
      return rows[0].n;
    },

    async countRecentComments(readerId) {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM community_comments
          WHERE reader_id = $1 AND created_at > now() - interval '1 hour'`,
        [readerId]
      );
      return rows[0].n;
    },

    async createReport(bookId, reporterId, targetType, targetId, reason) {
      const table = targetType === 'post' ? 'community_posts' : 'community_comments';
      const idColumn = targetType === 'post' ? 'post_id' : 'comment_id';
      const found = await db.query(
        `SELECT 1 FROM ${table} WHERE ${idColumn} = $1 AND book_id = $2`,
        [targetId, bookId]
      );
      if (found.rows.length === 0) return false;
      await db.query(
        `INSERT INTO community_reports (report_id, book_id, target_type, target_id, reporter_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (target_type, target_id, reporter_id) DO NOTHING`,
        [randomUUID(), bookId, targetType, targetId, reporterId, reason]
      );
      return true;
    },
  };
}

export function createPgCommunityAdminRepository(db: QueryClient): CommunityAdminRepository {
  return {
    async listReports(): Promise<ReportSummary[]> {
      const { rows } = await db.query(
        `SELECT r.report_id, r.book_id, r.target_type, r.target_id, r.reason, r.created_at,
                COALESCE(p.body, c.body) AS target_body,
                (COALESCE(p.deleted_at, c.deleted_at) IS NOT NULL) AS target_deleted
           FROM community_reports r
           LEFT JOIN community_posts p ON r.target_type = 'post' AND p.post_id = r.target_id
           LEFT JOIN community_comments c ON r.target_type = 'comment' AND c.comment_id = r.target_id
          ORDER BY r.created_at DESC
          LIMIT 200`
      );
      return rows.map((row) => ({
        report_id: row.report_id,
        book_id: row.book_id,
        target_type: row.target_type,
        target_id: row.target_id,
        reason: row.reason,
        created_at: new Date(row.created_at).toISOString(),
        target_body: row.target_body,
        target_deleted: row.target_deleted,
      }));
    },

    async deletePost(postId) {
      const { rows } = await db.query(
        `UPDATE community_posts SET deleted_at = now()
          WHERE post_id = $1 AND deleted_at IS NULL RETURNING post_id`,
        [postId]
      );
      return rows.length > 0;
    },

    async deleteComment(commentId) {
      const { rows } = await db.query(
        `UPDATE community_comments SET deleted_at = now()
          WHERE comment_id = $1 AND deleted_at IS NULL RETURNING comment_id`,
        [commentId]
      );
      return rows.length > 0;
    },
  };
}
