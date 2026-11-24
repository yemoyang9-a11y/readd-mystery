import { randomUUID } from 'crypto';
import type {
  Note,
  NoteInput,
  NotesReader,
  NotesRepository,
  ReviewNotesReader,
} from './repository';

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const COLUMNS = `note_id, page_no, kind, resolved, body, created_at, updated_at`;

function toNote(row: any): Note {
  return {
    note_id: row.note_id,
    page_no: row.page_no,
    kind: row.kind ?? null,
    resolved: row.resolved === true,
    body: row.body,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export function createPgNotesRepository(
  db: QueryClient
): NotesRepository & NotesReader & ReviewNotesReader {
  const repository: NotesRepository & NotesReader & ReviewNotesReader = {
    async list(readerId, bookId) {
      const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM reading_notes
          WHERE reader_id = $1 AND book_id = $2
          ORDER BY page_no, created_at`,
        [readerId, bookId]
      );
      return rows.map(toNote);
    },

    async find(readerId, bookId, noteId) {
      const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM reading_notes
          WHERE note_id = $1 AND reader_id = $2 AND book_id = $3`,
        [noteId, readerId, bookId]
      );
      return rows.length === 0 ? null : toNote(rows[0]);
    },

    async create(readerId, bookId, input: NoteInput) {
      const { rows } = await db.query(
        `INSERT INTO reading_notes (note_id, reader_id, book_id, page_no, kind, body, resolved)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${COLUMNS}`,
        [randomUUID(), readerId, bookId, input.page_no, input.kind, input.body, input.resolved]
      );
      return toNote(rows[0]);
    },

    async update(readerId, bookId, noteId, input) {
      const { rows } = await db.query(
        `UPDATE reading_notes
            SET page_no = COALESCE($4, page_no),
                kind = CASE WHEN $5::boolean THEN $6 ELSE kind END,
                -- 마이그레이션 029 — 내용(본문 글자·쪽·종류)이 실제로 바뀔 때만 내용 수정 시각을 옮긴다.
                -- 풀림 표시는 넣지 않는다. 추리 채점의 결말 전 판정에 쓴다 (대표 결정 2026-11-24, 8번)
                content_updated_at = CASE
                  WHEN ($7::text IS NOT NULL AND $7::text <> body)
                    OR ($4::int IS NOT NULL AND $4::int <> page_no)
                    OR ($5::boolean AND $6::text IS DISTINCT FROM kind)
                  THEN now() ELSE content_updated_at END,
                body = COALESCE($7, body),
                resolved = COALESCE($8::boolean, resolved),
                updated_at = now()
          WHERE note_id = $1 AND reader_id = $2 AND book_id = $3
          RETURNING ${COLUMNS}`,
        [
          noteId,
          readerId,
          bookId,
          input.page_no ?? null,
          input.kind !== undefined, // null(일반 메모)로 바꾸는 것과 안 건드리는 것을 구분한다
          input.kind ?? null,
          input.body ?? null,
          input.resolved ?? null,
        ]
      );
      return rows.length === 0 ? null : toNote(rows[0]);
    },

    async remove(readerId, bookId, noteId) {
      const { rows } = await db.query(
        `DELETE FROM reading_notes
          WHERE note_id = $1 AND reader_id = $2 AND book_id = $3
          RETURNING note_id`,
        [noteId, readerId, bookId]
      );
      return rows.length > 0;
    },

    // FR-SPL-002 🚦 — 추리 채점용 조회. 상한(bound)은 쿼리 조건이다 (대표 결정 2026-11-24)
    async listForReview(readerId, bookId, bound) {
      if (!Number.isInteger(bound) || bound < 1) return [];
      const { rows } = await db.query(
        `SELECT note_id, page_no, kind, body, created_at, content_updated_at FROM reading_notes
          WHERE reader_id = $1 AND book_id = $2 AND page_no >= 1 AND page_no <= $3
          ORDER BY page_no, created_at`,
        [readerId, bookId, bound]
      );
      return rows.map((row) => ({
        note_id: row.note_id,
        page_no: row.page_no,
        kind: row.kind ?? null,
        body: row.body,
        created_at: new Date(row.created_at).toISOString(),
        content_updated_at: new Date(row.content_updated_at ?? row.updated_at).toISOString(),
      }));
    },

    // FR-SPL-002 🚦 R4 — 챗봇용 조회. 상한은 쿼리 조건이며, cutoff 초과 노트는 읽어 오지 않는다
    async listNotes(readerId, bookId, cutoff) {
      if (!Number.isInteger(cutoff) || cutoff < 1) return [];
      const { rows } = await db.query(
        `SELECT page_no, kind, body, created_at FROM reading_notes
          WHERE reader_id = $1 AND book_id = $2 AND page_no >= 1 AND page_no <= $3
          ORDER BY page_no, created_at`,
        [readerId, bookId, cutoff]
      );
      return rows.map((row) => ({
        page_no: row.page_no,
        kind: row.kind,
        body: row.body,
        created_at: new Date(row.created_at).toISOString(),
      }));
    },
  };
  return repository;
}
