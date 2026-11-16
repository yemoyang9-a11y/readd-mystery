export type NoteKind = 'clue' | 'hypothesis';

export interface Note {
  note_id: string;
  page_no: number;
  kind: NoteKind;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  page_no: number;
  kind: NoteKind;
  body: string;
}

export interface NotesRepository {
  list(readerId: string, bookId: string): Promise<Note[]>;
  create(readerId: string, bookId: string, input: NoteInput): Promise<Note>;
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
  ): Promise<{ page_no: number; kind: 'clue' | 'hypothesis'; body: string }[]>;
}
