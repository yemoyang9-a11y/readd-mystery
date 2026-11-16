export type NoteKind = 'clue' | 'hypothesis';

export interface ReadingNote {
  note_id: string;
  page_no: number;
  kind: NoteKind;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface NoteDraft {
  page_no: number;
  kind: NoteKind;
  body: string;
}
