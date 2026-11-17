export interface ReaderNote {
  page_no: number;
  kind: 'clue' | 'hypothesis';
  body: string;
  /** 쓴 시각(ISO). 최근 노트를 고를 때만 쓴다 */
  created_at?: string;
}

export interface NotesReader {
  // FR-SPL-002 🚦: cutoff 없이 노트를 읽지 않는다. page_no <= cutoff인 노트만 돌려준다
  listNotes(readerId: string, bookId: string, cutoff: number): Promise<ReaderNote[]>;
}

export const emptyNotesReader: NotesReader = {
  listNotes: async () => [],
};
