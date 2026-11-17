// 2026-11-17 추리 노트 종류 — 종류(kind)와 풀림 표시(resolved)는 독자만 정한다.
// kind null = 일반 메모(기본).
export type NoteKind = 'clue' | 'question' | 'hypothesis';

export const NOTE_KINDS: readonly NoteKind[] = ['clue', 'question', 'hypothesis'];

export interface Note {
  note_id: string;
  page_no: number;
  kind: NoteKind | null;
  resolved: boolean;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  page_no: number;
  kind: NoteKind | null;
  resolved: boolean;
  body: string;
}

export interface NotesRepository {
  list(readerId: string, bookId: string): Promise<Note[]>;
  find(readerId: string, bookId: string, noteId: string): Promise<Note | null>;
  create(readerId: string, bookId: string, input: NoteInput): Promise<Note>;
  // kind 키가 없으면 종류를 건드리지 않고, null이면 일반 메모로 바꾼다
  update(
    readerId: string,
    bookId: string,
    noteId: string,
    input: Partial<NoteInput>
  ): Promise<Note | null>;
  remove(readerId: string, bookId: string, noteId: string): Promise<boolean>;
}

export interface NotesReader {
  listNotes(
    readerId: string,
    bookId: string
  ): Promise<{ page_no: number; kind: NoteKind | null; body: string }[]>;
}
