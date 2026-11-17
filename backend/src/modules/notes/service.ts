import { NOTE_KINDS, type Note, type NoteInput, type NoteKind, type NotesRepository } from './repository';

const MAX_BODY_LENGTH = 1000;

export type NoteResult =
  | { ok: true; note: Note }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'not_found' };

// 풀림 표시는 궁금한 점·가설에만 붙는다
function canResolve(kind: NoteKind | null): boolean {
  return kind === 'question' || kind === 'hypothesis';
}

const RESOLVED_KIND_MESSAGE = 'resolved can be set only on question or hypothesis notes';

export function parseNoteInput(raw: any, partial: boolean): Partial<NoteInput> | string {
  const input: Partial<NoteInput> = {};
  if (raw?.page_no !== undefined || !partial) {
    if (!Number.isSafeInteger(raw?.page_no) || raw.page_no < 1) {
      return 'page_no must be an integer >= 1';
    }
    input.page_no = raw.page_no;
  }
  // 생략·null = 일반 메모. 그 밖의 값은 정해진 세 종류만 받는다
  if (raw?.kind !== undefined) {
    if (raw.kind !== null && !NOTE_KINDS.includes(raw.kind)) {
      return 'kind must be clue, question, hypothesis or null';
    }
    input.kind = raw.kind;
  } else if (!partial) {
    input.kind = null;
  }
  if (raw?.resolved !== undefined) {
    if (typeof raw.resolved !== 'boolean') return 'resolved must be a boolean';
    input.resolved = raw.resolved;
  } else if (!partial) {
    input.resolved = false;
  }
  if (raw?.body !== undefined || !partial) {
    const body = typeof raw?.body === 'string' ? raw.body.trim() : '';
    if (body.length < 1 || body.length > MAX_BODY_LENGTH) {
      return `body must be 1-${MAX_BODY_LENGTH} characters`;
    }
    input.body = body;
  }
  return input;
}

// 2026-11-17 추리 노트 종류 — 종류와 풀림 표시는 독자의 요청으로만 바뀐다.
// 여기서 값을 고치는 경우는 하나뿐이다: 풀림을 붙일 수 없는 종류(단서·일반)로 바뀌면 풀림을 끈다.
export function createNotesService(notes: NotesRepository) {
  return {
    list: (readerId: string, bookId: string) => notes.list(readerId, bookId),

    async create(readerId: string, bookId: string, raw: unknown): Promise<NoteResult> {
      const input = parseNoteInput(raw, false);
      if (typeof input === 'string') return { ok: false, reason: 'invalid', message: input };
      const full = input as NoteInput;
      if (full.resolved && !canResolve(full.kind)) {
        return { ok: false, reason: 'invalid', message: RESOLVED_KIND_MESSAGE };
      }
      return { ok: true, note: await notes.create(readerId, bookId, full) };
    },

    async update(readerId: string, bookId: string, noteId: string, raw: unknown): Promise<NoteResult> {
      const input = parseNoteInput(raw, true);
      if (typeof input === 'string') return { ok: false, reason: 'invalid', message: input };
      const existing = await notes.find(readerId, bookId, noteId);
      if (!existing) return { ok: false, reason: 'not_found' };

      const nextKind = input.kind !== undefined ? input.kind : existing.kind;
      if (input.resolved === true && !canResolve(nextKind)) {
        return { ok: false, reason: 'invalid', message: RESOLVED_KIND_MESSAGE };
      }
      if (!canResolve(nextKind)) input.resolved = false;

      const note = await notes.update(readerId, bookId, noteId, input);
      return note ? { ok: true, note } : { ok: false, reason: 'not_found' };
    },

    remove: (readerId: string, bookId: string, noteId: string) =>
      notes.remove(readerId, bookId, noteId),
  };
}
