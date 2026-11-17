import type { ReadingNote } from '../../types';
import { isOpenThread, NoteKindBadge, ResolvedMark } from './noteKind';

function NoteList({ notes }: { notes: ReadingNote[] }) {
  return (
    <ul data-no-track className="m-0 flex list-none flex-col gap-2 p-0">
      {notes.map((note) => (
        <li
          key={note.note_id}
          data-resolved={note.resolved ? 'true' : undefined}
          className="rounded-brief-card bg-brief-card p-3.5 font-dashSans shadow-brief-soft-sm"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <NoteKindBadge kind={note.kind} />
            <span className="text-brief-muted">{note.page_no}쪽</span>
            {note.resolved ? <ResolvedMark /> : null}
          </div>
          <p
            className={`mb-0 mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed ${
              note.resolved ? 'text-brief-muted' : 'text-brief-ink'
            }`}
          >
            {note.body}
          </p>
        </li>
      ))}
    </ul>
  );
}

function NoteGroup({ title, notes }: { title: string; notes: ReadingNote[] }) {
  return (
    <div role="group" aria-label={title}>
      <h4 className="mb-2 mt-0 font-dashSans text-xs font-bold text-brief-muted">{title}</h4>
      <NoteList notes={notes} />
    </div>
  );
}

// 2026-11-15 추리 전환
// 2026-11-17 추리 노트 종류 — 독자가 풀림으로 표시하지 않은 궁금한 점·가설을 먼저 보여 준다.
// 무엇이 중요한지는 독자가 붙인 종류와 풀림 표시로만 가른다(AI·시스템이 고르지 않는다).
export default function BriefingNotes({ notes }: { notes: ReadingNote[] }) {
  const open = notes.filter(isOpenThread);
  const rest = notes.filter((note) => !isOpenThread(note));
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
      ) : open.length === 0 ? (
        <NoteList notes={notes} />
      ) : (
        <div className="flex flex-col gap-4">
          <NoteGroup title="아직 풀지 못한 것" notes={open} />
          {rest.length > 0 ? <NoteGroup title="그 밖의 노트" notes={rest} /> : null}
        </div>
      )}
    </section>
  );
}
