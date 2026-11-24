import { randomUUID } from 'crypto';
import type { ReviewEvidence } from './grading';
import {
  STALE_PENDING_SECONDS,
  type NoteReviewRepository,
  type ReviewClaimMeta,
  type StoredReview,
} from './repository';
import type { ReviewEvidenceReader } from './service';

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export function createPgNoteReviewRepository(db: QueryClient): NoteReviewRepository {
  return {
    async find(readerId, bookId): Promise<StoredReview | null> {
      const { rows } = await db.query(
        `SELECT status, result, attempts, last_error FROM note_reviews
          WHERE reader_id = $1 AND book_id = $2`,
        [readerId, bookId]
      );
      if (rows.length === 0) return null;
      return {
        status: rows[0].status,
        result: rows[0].status === 'done' ? rows[0].result : null,
        attempts: Number(rows[0].attempts),
        last_error: rows[0].last_error ?? null,
      };
    },

    async claim(readerId, bookId, meta: ReviewClaimMeta) {
      const token = randomUUID();
      // 한 문장으로 맡는다 — 두 요청이 함께 AI를 부르지 않는다. done 은 절대 덮지 않는다 (대표 결정 7번)
      const { rows } = await db.query(
        `INSERT INTO note_reviews (reader_id, book_id, status, model, bound_page, reached_end_at,
                                   eligible_count, excluded_count, attempts, started_at, claim_id)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, 1, now(), $9)
         ON CONFLICT (reader_id, book_id) DO UPDATE SET
           status = 'pending', model = EXCLUDED.model, bound_page = EXCLUDED.bound_page,
           reached_end_at = EXCLUDED.reached_end_at, eligible_count = EXCLUDED.eligible_count,
           excluded_count = EXCLUDED.excluded_count, attempts = note_reviews.attempts + 1,
           started_at = now(), last_error = NULL, claim_id = EXCLUDED.claim_id
         WHERE note_reviews.status = 'failed'
            OR (note_reviews.status = 'pending'
                AND note_reviews.started_at < now() - make_interval(secs => $8))
         RETURNING status`,
        [
          readerId,
          bookId,
          meta.model,
          meta.bound_page,
          meta.reached_end_at,
          meta.eligible_count,
          meta.excluded_count,
          STALE_PENDING_SECONDS,
          token,
        ]
      );
      if (rows.length > 0) return { token };
      const current = await db.query(
        `SELECT status FROM note_reviews WHERE reader_id = $1 AND book_id = $2`,
        [readerId, bookId]
      );
      return current.rows[0]?.status === 'done' ? 'done' : 'busy';
    },

    async complete(readerId, bookId, token, result) {
      const { rows } = await db.query(
        `UPDATE note_reviews SET status = 'done', result = $4::jsonb, completed_at = now(), last_error = NULL
          WHERE reader_id = $1 AND book_id = $2 AND status = 'pending' AND claim_id = $3
          RETURNING status`,
        [readerId, bookId, token, JSON.stringify(result)]
      );
      return rows.length > 0;
    },

    async fail(readerId, bookId, token, error) {
      await db.query(
        `UPDATE note_reviews SET status = 'failed', result = NULL, last_error = $4, completed_at = now()
          WHERE reader_id = $1 AND book_id = $2 AND status = 'pending' AND claim_id = $3`,
        [readerId, bookId, token, error.slice(0, 500)]
      );
    },
  };
}

/**
 * 채점 근거 — 검수 통과 데이터(장 요약·사건·인물·인물 노트). FR-SPL-002 🚦: 모든 조회가 bound 를
 * 쿼리 조건으로 쓴다. 원문 페이지는 읽지 않는다. 공개 콘텐츠 스토어는 읽기만 한다 (절대 규칙 5번).
 */
export function createPgReviewEvidenceReader(db: QueryClient): ReviewEvidenceReader {
  return {
    async load(bookId: string, bound: number): Promise<ReviewEvidence> {
      const [book, summaries, events, characters, notes] = await Promise.all([
        db.query(`SELECT title, author FROM books WHERE book_id = $1`, [bookId]),
        db.query(
          `SELECT cs.chapter_no, c.title, cs.summary AS content, c.start_page, c.end_page
             FROM chapter_summaries cs
             JOIN chapters c ON cs.book_id = c.book_id AND cs.chapter_no = c.chapter_no
            WHERE cs.book_id = $1 AND c.end_page <= $2
            ORDER BY cs.chapter_no`,
          [bookId, bound]
        ),
        db.query(
          `SELECT event, description, occurrence_page FROM events
            WHERE book_id = $1 AND occurrence_page <= $2
            ORDER BY occurrence_page`,
          [bookId, bound]
        ),
        db.query(
          `SELECT name, first_appearance_page FROM characters
            WHERE book_id = $1 AND first_appearance_page <= $2
            ORDER BY first_appearance_page`,
          [bookId, bound]
        ),
        db.query(
          `SELECT ch.name, cn.note, cn.source_page FROM character_notes cn
             JOIN characters ch ON ch.id = cn.character_id
            WHERE ch.book_id = $1 AND cn.book_id = $1
              AND cn.source_page <= $2 AND ch.first_appearance_page <= $2
            ORDER BY cn.source_page`,
          [bookId, bound]
        ),
      ]);
      return {
        title: book.rows[0]?.title ?? '',
        author: book.rows[0]?.author ?? '',
        summaries: summaries.rows,
        events: events.rows,
        characters: characters.rows,
        character_notes: notes.rows,
      };
    },
  };
}
