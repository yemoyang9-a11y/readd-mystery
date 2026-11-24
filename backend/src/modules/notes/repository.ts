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
  // FR-SPL-002 🚦: 챗봇용 조회는 cutoff 인자가 필수이며 page_no <= cutoff만 돌려준다
  listNotes(
    readerId: string,
    bookId: string,
    cutoff: number
  ): Promise<{ page_no: number; kind: NoteKind | null; body: string; created_at: string }[]>;
}

/** 추리 채점이 읽는 노트 한 줄 (대표 결정 2026-11-24) */
export interface ReviewNoteRow {
  note_id: string;
  page_no: number;
  kind: NoteKind | null;
  body: string;
  created_at: string;
  /** 본문을 마지막으로 고친 시각 (마이그레이션 029). 종류·풀림 표시를 바꿔도 움직이지 않는다 */
  body_updated_at: string;
}

export interface ReviewNotesReader {
  /**
   * FR-SPL-002 🚦 — 상한(bound)은 쿼리 조건이다. 채점 경로에서 bound 는 기준점 결정기의
   * getReviewScope().bound(책 끝 쪽)이며, 관문(reached_end)을 지난 요청만 부른다.
   */
  listForReview(readerId: string, bookId: string, bound: number): Promise<ReviewNoteRow[]>;
}
