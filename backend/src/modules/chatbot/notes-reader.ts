export interface ReaderNote {
  page_no: number;
  // 독자가 붙인 종류. null = 일반 메모 (2026-11-17 추리 노트 종류)
  kind: 'clue' | 'question' | 'hypothesis' | null;
  body: string;
  /** 쓴 시각(ISO). 최근 노트를 고를 때만 쓴다 */
  created_at?: string;
}

// 프롬프트에 붙는 종류 표지 — 독자가 정한 값을 그대로 옮길 뿐, 종류를 추정하지 않는다
export function noteKindLabel(kind: ReaderNote['kind']): string {
  if (kind === 'clue') return '단서';
  if (kind === 'question') return '궁금한 점';
  if (kind === 'hypothesis') return '가설';
  return '메모';
}

export interface NotesReader {
  // FR-SPL-002 🚦: cutoff 없이 노트를 읽지 않는다. page_no <= cutoff인 노트만 돌려준다
  listNotes(readerId: string, bookId: string, cutoff: number): Promise<ReaderNote[]>;
}

export const emptyNotesReader: NotesReader = {
  listNotes: async () => [],
};
