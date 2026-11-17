import type { NoteKind, ReadingNote } from '../../types';

// 2026-11-17 추리 노트 종류 — 독자가 정한 값을 그대로 보여 줄 뿐, 화면이 종류를 추정하지 않는다
export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  clue: '단서',
  question: '궁금한 점',
  hypothesis: '가설',
};

export const NOTE_KIND_ORDER: NoteKind[] = ['clue', 'question', 'hypothesis'];

export function canResolve(kind: NoteKind | null): boolean {
  return kind === 'question' || kind === 'hypothesis';
}

export function isOpenThread(note: ReadingNote): boolean {
  return canResolve(note.kind) && !note.resolved;
}

export function NoteKindBadge({ kind }: { kind: NoteKind | null }) {
  return (
    <span
      data-testid="note-kind-badge"
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
        kind === null
          ? 'border border-brief-rule text-brief-muted'
          : 'bg-brief-accent-soft text-brief-accent'
      }`}
    >
      {kind === null ? '메모' : NOTE_KIND_LABELS[kind]}
    </span>
  );
}

export function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function ResolvedMark() {
  return (
    <span
      data-testid="note-resolved-check"
      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-brief-muted"
    >
      <CheckIcon />
      풀렸어요
    </span>
  );
}
