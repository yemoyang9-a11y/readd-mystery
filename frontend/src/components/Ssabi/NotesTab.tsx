import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../../hooks/useModalLayer';
import type { NoteDraft, NoteKind, ReadingNote } from '../../types';

export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  clue: '단서',
  hypothesis: '가설',
};

const MAX_BODY_LENGTH = 1000;

function NoteEditor({
  initial,
  maxPage,
  onSave,
  onClose,
}: {
  initial: NoteDraft;
  maxPage: number | null;
  onSave: (draft: NoteDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  useModalLayer({ active: true, dialogRef, returnFocusRef, onClose });

  const [kind, setKind] = useState<NoteKind>(initial.kind);
  const [body, setBody] = useState(initial.body);
  const [pageText, setPageText] = useState(String(initial.page_no));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const pageNo = Number(pageText);
  const pageValid =
    Number.isInteger(pageNo) && pageNo >= 1 && (maxPage === null || pageNo <= maxPage);
  const canSave = body.trim().length > 0 && pageValid && !saving;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setFailed(false);
    const saved = await onSave({ page_no: pageNo, kind, body: body.trim() });
    if (saved) {
      onClose();
      return;
    }
    setSaving(false);
    setFailed(true);
  }

  return createPortal(
    <div
      data-testid="note-editor-overlay"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-5"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="단서·가설 적기"
        tabIndex={-1}
        className="w-full max-w-[420px] rounded-brief-panel border border-brief-rule bg-brief-paper p-5 font-dashSans text-brief-ink shadow-brief-soft outline-none"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-dashSerif text-base font-extrabold">단서·가설 적기</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-2 flex size-11 items-center justify-center rounded-full text-brief-ink"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div role="radiogroup" aria-label="종류" className="mt-2 flex gap-2">
          {(Object.keys(NOTE_KIND_LABELS) as NoteKind[]).map((it) => (
            <button
              key={it}
              type="button"
              role="radio"
              aria-checked={kind === it}
              onClick={() => setKind(it)}
              className={`min-h-11 rounded-full border px-4 text-sm font-bold transition-colors ${
                kind === it
                  ? 'border-brief-accent bg-brief-accent-soft text-brief-accent'
                  : 'border-brief-rule text-brief-muted'
              }`}
            >
              {NOTE_KIND_LABELS[it]}
            </button>
          ))}
        </div>

        <label htmlFor="note-body" className="mt-4 block text-xs font-bold text-brief-muted">
          내용
        </label>
        <textarea
          id="note-body"
          value={body}
          maxLength={MAX_BODY_LENGTH}
          rows={5}
          onChange={(event) => setBody(event.target.value)}
          placeholder="수상한 점이나 내 추리를 적어 보세요"
          className="mt-1 w-full resize-none rounded-brief-card border border-brief-rule bg-white p-3 text-[15px] leading-relaxed text-brief-ink outline-none focus:border-brief-accent"
        />

        <div className="mt-3 flex items-center gap-2">
          <label htmlFor="note-page" className="text-xs font-bold text-brief-muted">
            쪽수
          </label>
          <input
            id="note-page"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxPage ?? undefined}
            value={pageText}
            onChange={(event) => setPageText(event.target.value)}
            aria-invalid={!pageValid}
            className="h-11 w-24 rounded-brief-card border border-brief-rule bg-white px-3 text-[15px] outline-none focus:border-brief-accent"
          />
          <span className="text-xs text-brief-muted">쪽</span>
        </div>

        {failed ? (
          <p role="alert" className="mt-3 text-[13px] text-brief-ink">
            저장하지 못했어요. 다시 시도해 주세요.
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-full px-4 text-sm font-bold text-brief-muted"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSave}
            className="min-h-11 rounded-full border border-brief-ink px-5 text-sm font-bold text-brief-ink transition-colors hover:bg-[rgba(31,31,31,0.05)] disabled:opacity-40"
          >
            저장
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// 2026-11-15 추리 전환
export default function NotesTab({
  notes,
  failed,
  currentPage,
  totalPages,
  onAdd,
  onEdit,
  onRemove,
  onJump,
  quoteDraft = null,
  onQuoteDraftHandled,
}: {
  notes: ReadingNote[];
  failed: boolean;
  currentPage: number | null;
  totalPages?: number;
  onAdd: (draft: NoteDraft) => Promise<boolean>;
  onEdit: (noteId: string, draft: Partial<NoteDraft>) => Promise<boolean>;
  onRemove: (noteId: string) => Promise<boolean>;
  onJump: (page: number) => void;
  quoteDraft?: { text: string; token: number } | null;
  onQuoteDraftHandled?: () => void;
}) {
  const [editing, setEditing] = useState<ReadingNote | 'new' | null>(quoteDraft ? 'new' : null);
  const [prefill, setPrefill] = useState(quoteDraft?.text ?? '');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const maxPage = totalPages && totalPages > 0 ? totalPages : null;

  useEffect(() => {
    if (!quoteDraft) return;
    setPrefill(quoteDraft.text);
    setEditing('new');
  }, [quoteDraft?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        {failed ? (
          <p role="alert" className="m-0 text-sm text-brief-muted">
            노트를 불러오지 못했어요
          </p>
        ) : null}
        {!failed && notes.length === 0 ? (
          <p className="m-0 text-sm text-brief-muted">아직 적은 게 없어요.</p>
        ) : null}
        <ul data-no-track className="m-0 flex list-none flex-col gap-2.5 p-0">
          {notes.map((note) => (
            <li
              key={note.note_id}
              className="rounded-brief-card border border-brief-rule bg-white p-3.5 font-dashSans"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-brief-accent-soft px-2.5 py-0.5 text-[11px] font-bold text-brief-accent">
                  {NOTE_KIND_LABELS[note.kind]}
                </span>
                <span className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setEditing(note)}
                    aria-label="노트 수정"
                    className="min-h-11 rounded-full px-2.5 text-xs text-brief-muted hover:text-brief-ink"
                  >
                    수정
                  </button>
                  {confirmingId === note.note_id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingId(null);
                          void onRemove(note.note_id);
                        }}
                        aria-label="노트 삭제 확인"
                        className="min-h-11 rounded-full px-2.5 text-xs font-bold text-brief-accent"
                      >
                        삭제할게요
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="min-h-11 rounded-full px-2.5 text-xs text-brief-muted"
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(note.note_id)}
                      aria-label="노트 삭제"
                      className="min-h-11 rounded-full px-2.5 text-xs text-brief-muted hover:text-brief-ink"
                    >
                      삭제
                    </button>
                  )}
                </span>
              </div>
              <p className="my-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-brief-ink">
                {note.body}
              </p>
              <button
                type="button"
                onClick={() => onJump(note.page_no)}
                aria-label={`${note.page_no}쪽으로 이동`}
                className="min-h-11 rounded-full border border-brief-rule px-3.5 text-[13px] font-bold text-brief-accent"
              >
                {note.page_no}쪽
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="sticky bottom-0 -mx-6 -mb-6 mt-4 border-t border-brief-rule bg-brief-paper px-6 pb-6 pt-3">
        <button
          type="button"
          data-track="단서·가설 적기"
          onClick={() => setEditing('new')}
          disabled={currentPage === null}
          className="h-12 w-full rounded-full border border-brief-ink bg-transparent font-dashSans text-[15px] font-bold text-brief-ink transition-colors hover:bg-[rgba(31,31,31,0.05)] active:bg-[rgba(31,31,31,0.1)] disabled:opacity-40"
        >
          + 단서·가설 적기
        </button>
      </div>

      {editing !== null ? (
        <NoteEditor
          initial={
            editing === 'new'
              ? { page_no: currentPage ?? 1, kind: 'clue', body: prefill }
              : { page_no: editing.page_no, kind: editing.kind, body: editing.body }
          }
          maxPage={maxPage}
          onSave={(draft) =>
            editing === 'new' ? onAdd(draft) : onEdit(editing.note_id, draft)
          }
          onClose={() => {
            setEditing(null);
            setPrefill('');
            onQuoteDraftHandled?.();
          }}
        />
      ) : null}
    </div>
  );
}
