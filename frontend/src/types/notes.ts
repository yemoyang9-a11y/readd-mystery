// 2026-11-17 추리 노트 종류 — 종류와 풀림 표시는 독자만 정한다. null = 일반 메모(기본)
export type NoteKind = 'clue' | 'question' | 'hypothesis';

export interface ReadingNote {
  note_id: string;
  page_no: number;
  kind: NoteKind | null;
  // 독자가 궁금한 점·가설에 붙이는 "풀림" 표시
  resolved: boolean;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface NoteDraft {
  page_no: number;
  kind: NoteKind | null;
  body: string;
  resolved?: boolean;
}
