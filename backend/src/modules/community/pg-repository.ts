import { randomUUID } from 'crypto';
import {
  AUTO_HIDE_REPORT_THRESHOLD,
  type CommentRow,
  type CommunityAdminRepository,
  type CommunityEngagementRepository,
  type CommunityModerationRepository,
  type CommunityRepository,
  type ModerationItem,
  type PostRow,
  type ReportSummary,
  type ReportTarget,
} from './repository';

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

// 신고로 숨긴(hidden_at) 글·댓글은 독자 응답 어디에도 넣지 않는다 — 목록·상세·댓글·댓글 수.
// 작성자 본인에게도 같다: 알림 장치가 없어 "숨김됨" 표시를 따로 만들지 않고, 모든 독자가
// 같은 쿼리를 쓰는 편이 가장 단순하고 새는 곳이 없다. — 대표 결정 2026-11-17
const COMMENT_VISIBLE = `c.deleted_at IS NULL AND c.hidden_at IS NULL`;

// 공감 수 — 숨김·삭제 글은 0 (2026-11-18 대표 지시, migration 024)
const LIKE_COUNT = `(CASE WHEN p.deleted_at IS NULL AND p.hidden_at IS NULL
   THEN (SELECT count(*)::int FROM community_post_likes l WHERE l.post_id = p.post_id)
   ELSE 0 END)`;

/** viewerParam — liked_by_me 를 계산할 독자 ID 의 자리표시자($n). 없으면 false */
function postSelect(viewerParam: string | null): string {
  const liked = viewerParam
    ? `(p.deleted_at IS NULL AND p.hidden_at IS NULL AND EXISTS (
         SELECT 1 FROM community_post_likes l
          WHERE l.post_id = p.post_id AND l.reader_id = ${viewerParam}::uuid))`
    : 'false';
  return `
  SELECT p.seq::int AS seq, p.post_id, p.reader_id, p.kind, p.body, p.created_at,
         u.display_name AS author_name,
         (p.deleted_at IS NOT NULL) AS deleted,
         (SELECT count(*)::int FROM community_comments c
           WHERE c.post_id = p.post_id AND ${COMMENT_VISIBLE}) AS comment_count,
         ${LIKE_COUNT} AS like_count,
         ${liked} AS liked_by_me
    FROM community_posts p
    LEFT JOIN users u ON u.reader_id = p.reader_id`;
}

const POST_SELECT = postSelect(null);

// 답글 좋아요 수 — 숨김·삭제 답글은 0 (T19, migration 027)
const COMMENT_LIKE_COUNT = `(CASE WHEN c.deleted_at IS NULL AND c.hidden_at IS NULL
   THEN (SELECT count(*)::int FROM community_comment_likes l WHERE l.comment_id = c.comment_id)
   ELSE 0 END)`;

function commentSelect(viewerParam: string | null): string {
  const liked = viewerParam
    ? `(c.deleted_at IS NULL AND c.hidden_at IS NULL AND EXISTS (
         SELECT 1 FROM community_comment_likes l
          WHERE l.comment_id = c.comment_id AND l.reader_id = ${viewerParam}::uuid))`
    : 'false';
  return `
  SELECT c.comment_id, c.post_id, c.reader_id, c.body, c.created_at,
         u.display_name AS author_name,
         c.reply_to_comment_id, r.reader_id AS reply_to_reader_id, ru.display_name AS reply_to_name,
         ${COMMENT_LIKE_COUNT} AS like_count,
         ${liked} AS liked_by_me
    FROM community_comments c
    LEFT JOIN users u ON u.reader_id = c.reader_id
    LEFT JOIN community_comments r ON r.comment_id = c.reply_to_comment_id
    LEFT JOIN users ru ON ru.reader_id = r.reader_id`;
}

// 좋아요를 받을 수 있는 답글 — 보이는 답글이고 그 댓글이 신고로 숨겨지지 않았다(삭제된 댓글 아래 답글은 된다)
const VISIBLE_REPLY = `SELECT c.comment_id FROM community_comments c
  JOIN community_posts p ON p.post_id = c.post_id
 WHERE c.comment_id = $1 AND c.book_id = $2
   AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND p.hidden_at IS NULL`;

const VISIBLE = `(p.hidden_at IS NULL AND (p.deleted_at IS NULL OR EXISTS (
  SELECT 1 FROM community_comments c WHERE c.post_id = p.post_id AND ${COMMENT_VISIBLE})))`;

const TARGETS: Record<ReportTarget, { table: string; id: string }> = {
  post: { table: 'community_posts', id: 'post_id' },
  comment: { table: 'community_comments', id: 'comment_id' },
};

function toPost(row: any): PostRow {
  return {
    seq: row.seq,
    post_id: row.post_id,
    reader_id: row.reader_id,
    kind: row.kind,
    body: row.body,
    author_name: row.author_name ?? null,
    created_at: new Date(row.created_at).toISOString(),
    deleted: row.deleted,
    comment_count: row.comment_count,
    like_count: row.like_count ?? 0,
    liked_by_me: row.liked_by_me === true,
  };
}

function toComment(row: any): CommentRow {
  return {
    comment_id: row.comment_id,
    post_id: row.post_id,
    reader_id: row.reader_id,
    body: row.body,
    created_at: new Date(row.created_at).toISOString(),
    author_name: row.author_name ?? null,
    reply_to_comment_id: row.reply_to_comment_id ?? null,
    reply_to_reader_id: row.reply_to_reader_id ?? null,
    reply_to_name: row.reply_to_name ?? null,
    like_count: row.like_count ?? 0,
    liked_by_me: row.liked_by_me === true,
  };
}

export function createPgCommunityRepository(
  db: QueryClient
): CommunityRepository & CommunityEngagementRepository {
  return {
    async listPosts(bookId, { before, offset, sort, viewerId, limit }) {
      if (sort === 'popular') {
        // 인기순 — 공감 많은 순, 같으면 최신순. 공감을 못 받는 삭제 글(댓글이 남은 것)은 뒤로 간다
        const { rows } = await db.query(
          `${postSelect('$4')}
            WHERE p.book_id = $1 AND ${VISIBLE}
            ORDER BY like_count DESC, p.seq DESC
            OFFSET $2 LIMIT $3`,
          [bookId, offset ?? 0, limit, viewerId ?? null]
        );
        return rows.map(toPost);
      }
      const { rows } = await db.query(
        `${postSelect('$4')}
          WHERE p.book_id = $1 AND ${VISIBLE}
            AND ($2::bigint IS NULL OR p.seq < $2)
          ORDER BY p.seq DESC
          LIMIT $3`,
        [bookId, before ?? null, limit, viewerId ?? null]
      );
      return rows.map(toPost);
    },

    async likePost(bookId, postId, readerId) {
      // 숨김·삭제되지 않은 이 도서의 글에만 공감한다. 이미 공감했으면 그대로 둔다(PK)
      const { rows } = await db.query(
        `WITH target AS (
           SELECT post_id FROM community_posts
            WHERE post_id = $1 AND book_id = $2 AND deleted_at IS NULL AND hidden_at IS NULL
         ), ins AS (
           INSERT INTO community_post_likes (post_id, reader_id)
           SELECT post_id, $3 FROM target
           ON CONFLICT (post_id, reader_id) DO NOTHING
         )
         SELECT post_id FROM target`,
        [postId, bookId, readerId]
      );
      return rows.length > 0;
    },

    async unlikePost(bookId, postId, readerId) {
      const { rows } = await db.query(
        `WITH target AS (
           SELECT post_id FROM community_posts
            WHERE post_id = $1 AND book_id = $2 AND deleted_at IS NULL AND hidden_at IS NULL
         ), del AS (
           DELETE FROM community_post_likes l
            USING target t WHERE l.post_id = t.post_id AND l.reader_id = $3
         )
         SELECT post_id FROM target`,
        [postId, bookId, readerId]
      );
      return rows.length > 0;
    },

    async likeState(bookId, postId, readerId) {
      // 같은 문장 안의 쓰기(CTE)는 이 조회에 보이지 않으므로 공감·취소 뒤에 따로 묻는다
      const { rows } = await db.query(
        `SELECT ${LIKE_COUNT} AS like_count,
                EXISTS (SELECT 1 FROM community_post_likes l
                         WHERE l.post_id = p.post_id AND l.reader_id = $3::uuid) AS liked_by_me
           FROM community_posts p WHERE p.post_id = $1 AND p.book_id = $2`,
        [postId, bookId, readerId]
      );
      return rows.length === 0
        ? { like_count: 0, liked_by_me: false }
        : { like_count: rows[0].like_count, liked_by_me: rows[0].liked_by_me };
    },

    async countVisiblePosts(bookId) {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM community_posts
          WHERE book_id = $1 AND deleted_at IS NULL AND hidden_at IS NULL`,
        [bookId]
      );
      return rows[0].n;
    },

    async getPost(bookId, postId, viewerId) {
      const { rows } = viewerId
        ? await db.query(
            `${postSelect('$3')} WHERE p.book_id = $1 AND p.post_id = $2 AND ${VISIBLE}`,
            [bookId, postId, viewerId]
          )
        : await db.query(`${POST_SELECT} WHERE p.book_id = $1 AND p.post_id = $2 AND ${VISIBLE}`, [
            bookId,
            postId,
          ]);
      return rows.length === 0 ? null : toPost(rows[0]);
    },

    async listComments(bookId, postId, viewerId) {
      const { rows } = await db.query(
        `${commentSelect('$3')}
          WHERE c.book_id = $1 AND c.post_id = $2 AND ${COMMENT_VISIBLE}
          ORDER BY c.seq`,
        [bookId, postId, viewerId ?? null]
      );
      return rows.map(toComment);
    },

    async createPost(bookId, readerId, body) {
      const postId = randomUUID();
      await db.query(
        `INSERT INTO community_posts (post_id, book_id, reader_id, body)
         VALUES ($1, $2, $3, $4)`,
        [postId, bookId, readerId, body]
      );
      const { rows } = await db.query(`${POST_SELECT} WHERE p.post_id = $1`, [postId]);
      return toPost(rows[0]);
    },

    async createComment(bookId, postId, readerId, body, replyToCommentId) {
      const { rows } = await db.query(
        `INSERT INTO community_comments (comment_id, post_id, book_id, reader_id, body, reply_to_comment_id)
         SELECT $1, p.post_id, p.book_id, $4, $5, $6::uuid
           FROM community_posts p
          WHERE p.post_id = $2 AND p.book_id = $3 AND p.deleted_at IS NULL AND p.hidden_at IS NULL
            AND ($6::uuid IS NULL OR EXISTS (
              SELECT 1 FROM community_comments r
               WHERE r.comment_id = $6::uuid AND r.post_id = p.post_id
                 AND r.deleted_at IS NULL AND r.hidden_at IS NULL))
         RETURNING comment_id`,
        [randomUUID(), postId, bookId, readerId, body, replyToCommentId]
      );
      if (rows.length === 0) return null;
      const created = await db.query(`${commentSelect('$2')} WHERE c.comment_id = $1`, [
        rows[0].comment_id,
        readerId,
      ]);
      return toComment(created.rows[0]);
    },

    async likeComment(bookId, commentId, readerId) {
      const { rows } = await db.query(
        `WITH target AS (${VISIBLE_REPLY}), ins AS (
           INSERT INTO community_comment_likes (comment_id, reader_id)
           SELECT comment_id, $3 FROM target
           ON CONFLICT (comment_id, reader_id) DO NOTHING
         )
         SELECT comment_id FROM target`,
        [commentId, bookId, readerId]
      );
      return rows.length > 0;
    },

    async unlikeComment(bookId, commentId, readerId) {
      const { rows } = await db.query(
        `WITH target AS (${VISIBLE_REPLY}), del AS (
           DELETE FROM community_comment_likes l
            USING target t WHERE l.comment_id = t.comment_id AND l.reader_id = $3
         )
         SELECT comment_id FROM target`,
        [commentId, bookId, readerId]
      );
      return rows.length > 0;
    },

    async commentLikeState(bookId, commentId, readerId) {
      const { rows } = await db.query(
        `SELECT ${COMMENT_LIKE_COUNT} AS like_count,
                EXISTS (SELECT 1 FROM community_comment_likes l
                         WHERE l.comment_id = c.comment_id AND l.reader_id = $3::uuid) AS liked_by_me
           FROM community_comments c WHERE c.comment_id = $1 AND c.book_id = $2`,
        [commentId, bookId, readerId]
      );
      return rows.length === 0
        ? { like_count: 0, liked_by_me: false }
        : { like_count: rows[0].like_count, liked_by_me: rows[0].liked_by_me };
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
      const { table, id: idColumn } = TARGETS[targetType];
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
      // 자동 숨김: 마지막 복구(reviewed_at) 뒤의 서로 다른 신고자가 임계값 이상이면 숨긴다.
      // 신고 INSERT가 먼저 커밋된 뒤 실행되므로 동시에 들어온 신고도 늦게 도는 쪽이 모두 센다.
      await db.query(
        `UPDATE ${table} t SET hidden_at = now()
          WHERE t.${idColumn} = $1 AND t.hidden_at IS NULL
            AND (SELECT count(DISTINCT r.reporter_id) FROM community_reports r
                  WHERE r.target_type = $2 AND r.target_id = t.${idColumn}
                    AND (t.reviewed_at IS NULL OR r.created_at > t.reviewed_at)) >= $3`,
        [targetId, targetType, AUTO_HIDE_REPORT_THRESHOLD]
      );
      return true;
    },
  };
}

export function createPgCommunityAdminRepository(
  db: QueryClient
): CommunityAdminRepository & CommunityModerationRepository {
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

    async listModeration(): Promise<ModerationItem[]> {
      const { rows } = await db.query(
        `WITH t AS (
           SELECT 'post'::text AS target_type, post_id AS target_id, book_id, body,
                  deleted_at, hidden_at, reviewed_at
             FROM community_posts
           UNION ALL
           SELECT 'comment', comment_id, book_id, body, deleted_at, hidden_at, reviewed_at
             FROM community_comments
         )
         SELECT t.target_type, t.target_id, t.book_id, b.title AS book_title, t.body,
                count(DISTINCT r.reporter_id)::int AS report_count,
                (count(DISTINCT r.reporter_id) FILTER (
                   WHERE t.reviewed_at IS NULL OR r.created_at > t.reviewed_at))::int
                  AS reports_since_review,
                array_agg(r.reason ORDER BY r.created_at DESC) AS reasons,
                (t.hidden_at IS NOT NULL) AS hidden,
                (t.deleted_at IS NOT NULL) AS deleted,
                t.hidden_at, t.reviewed_at,
                max(r.created_at) AS last_reported_at
           FROM community_reports r
           JOIN t ON t.target_type = r.target_type AND t.target_id = r.target_id
           LEFT JOIN books b ON b.book_id = t.book_id
          GROUP BY t.target_type, t.target_id, t.book_id, b.title, t.body,
                   t.deleted_at, t.hidden_at, t.reviewed_at
          ORDER BY max(r.created_at) DESC
          LIMIT 200`
      );
      const iso = (v: unknown) => (v === null ? null : new Date(v as string).toISOString());
      return rows.map((row) => ({
        target_type: row.target_type,
        target_id: row.target_id,
        book_id: row.book_id,
        book_title: row.book_title,
        body: row.body,
        report_count: row.report_count,
        reports_since_review: row.reports_since_review,
        reasons: row.reasons,
        hidden: row.hidden,
        deleted: row.deleted,
        hidden_at: iso(row.hidden_at),
        reviewed_at: iso(row.reviewed_at),
        last_reported_at: new Date(row.last_reported_at).toISOString(),
      }));
    },

    async restore(targetType, targetId) {
      const { table, id } = TARGETS[targetType];
      const { rows } = await db.query(
        `UPDATE ${table} SET hidden_at = NULL, reviewed_at = now()
          WHERE ${id} = $1 RETURNING ${id}`,
        [targetId]
      );
      return rows.length > 0;
    },
  };
}
