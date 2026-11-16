export interface ReaderNote {
  page_no: number;
  kind: 'clue' | 'hypothesis';
  body: string;
}

export interface NotesReader {
  listNotes(readerId: string, bookId: string): Promise<ReaderNote[]>;
}

export const emptyNotesReader: NotesReader = {
  listNotes: async () => [],
};
