import { randomUUID } from 'crypto';
import type { Note, NoteInput, NotesReader, NotesRepository } from './repository';

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const COLUMNS = `note_id, page_no, kind, body, created_at, updated_at`;

function toNote(row: any): Note {
  return {
    note_id: row.note_id,
    page_no: row.page_no,
    kind: row.kind,
    body: row.body,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export function createPgNotesRepository(db: QueryClient): NotesRepository & NotesReader {
  const repository: NotesRepository & NotesReader = {
    async list(readerId, bookId) {
      const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM reading_notes
          WHERE reader_id = $1 AND book_id = $2
          ORDER BY page_no, created_at`,
        [readerId, bookId]
      );
      return rows.map(toNote);
    },

    async create(readerId, bookId, input: NoteInput) {
      const { rows } = await db.query(
        `INSERT INTO reading_notes (note_id, reader_id, book_id, page_no, kind, body)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${COLUMNS}`,
        [randomUUID(), readerId, bookId, input.page_no, input.kind, input.body]
      );
      return toNote(rows[0]);
    },

    async update(readerId, bookId, noteId, input) {
      const { rows } = await db.query(
        `UPDATE reading_notes
            SET page_no = COALESCE($4, page_no),
                kind = COALESCE($5, kind),
                body = COALESCE($6, body),
                updated_at = now()
          WHERE note_id = $1 AND reader_id = $2 AND book_id = $3
          RETURNING ${COLUMNS}`,
        [noteId, readerId, bookId, input.page_no ?? null, input.kind ?? null, input.body ?? null]
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
