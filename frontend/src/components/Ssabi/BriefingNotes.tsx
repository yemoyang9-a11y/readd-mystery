import type { ReadingNote } from '../../types';
import { NOTE_KIND_LABELS } from './NotesTab';

// 2026-11-15 추리 전환
export default function BriefingNotes({ notes }: { notes: ReadingNote[] }) {
  return (
    <section aria-label="내 추리 노트">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="m-0 font-dashSerif text-lg font-semibold tracking-[-.02em] text-brief-ink">
          내 추리 노트
        </h3>
        <span className="font-dashSans text-xs text-brief-muted">{notes.length}개</span>
      </div>
      {notes.length === 0 ? (
        <p className="m-0 font-dashSans text-sm text-brief-muted">아직 적은 게 없어요.</p>
      ) : (
        <ul data-no-track className="m-0 flex list-none flex-col gap-2 p-0">
          {notes.map((note) => (
            <li
              key={note.note_id}
              className="rounded-brief-card bg-brief-card p-3.5 font-dashSans shadow-brief-soft-sm"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-brief-accent-soft px-2.5 py-0.5 font-bold text-brief-accent">
                  {NOTE_KIND_LABELS[note.kind]}
                </span>
                <span className="text-brief-muted">{note.page_no}쪽</span>
              </div>
              <p className="mb-0 mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-brief-ink">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
