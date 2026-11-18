import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../../hooks/useModalLayer';
import type { NoteDraft, NoteKind, ReadingNote } from '../../types';
import { canResolve, CheckIcon, NOTE_KIND_LABELS, NOTE_KIND_ORDER, ResolvedMark } from './noteKind';

export { NOTE_KIND_LABELS };

// 메모 창의 종류 선택지 — 기본은 일반(null)
const KIND_CHOICES: { value: NoteKind | null; label: string }[] = [
  { value: null, label: '일반' },
  ...NOTE_KIND_ORDER.map((value) => ({ value, label: NOTE_KIND_LABELS[value] })),
];

const MAX_BODY_LENGTH = 1000;

/**
 * 메모 창. 고칠 노트(existing)를 열면 그 노트의 풀림 표시·삭제도 여기서 한다 — 승인 시안의 노트 카드에는
 * 종류 표지·쪽·내용만 있어 카드 위 버튼을 창 안으로 옮겼다 (2026-11-18 대표 승인 시안 A안).
 */
function NoteEditor({
  initial,
  existing = null,
  maxPage,
  onSave,
  onToggleResolved,
  onRemove,
  onClose,
}: {
  initial: NoteDraft;
  existing?: ReadingNote | null;
  maxPage: number | null;
  onSave: (draft: NoteDraft) => Promise<boolean>;
  onToggleResolved?: (resolved: boolean) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  useModalLayer({ active: true, dialogRef, returnFocusRef, onClose });

  const [kind, setKind] = useState<NoteKind | null>(initial.kind);
  const [body, setBody] = useState(initial.body);
  const [pageText, setPageText] = useState(String(initial.page_no));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState(existing?.resolved ?? false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // 풀림 표시는 독자만 켜고 끈다 — 누르는 즉시 서버로 보낸다(예전 카드 버튼과 같은 동작)
  async function toggleResolved() {
    if (!onToggleResolved) return;
    const next = !resolved;
    setResolved(next);
    if (!(await onToggleResolved(next))) setResolved(!next);
  }

  async function remove() {
    if (!onRemove) return;
    setConfirmingRemove(false);
    if (await onRemove()) onClose();
    else setFailed(true);
  }

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
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-[420px] rounded-brief-panel border border-brief-rule bg-brief-paper p-5 font-dashSans text-brief-ink shadow-brief-soft outline-none"
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

        <div role="radiogroup" aria-label="종류" className="mt-2 flex flex-wrap gap-2">
          {KIND_CHOICES.map(({ value, label }) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={`min-h-11 rounded-full border px-3.5 text-sm font-bold transition-colors ${
                kind === value
                  ? 'border-brief-accent bg-brief-accent-soft text-brief-accent'
                  : 'border-brief-rule text-brief-muted'
              }`}
            >
              {label}
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

        {existing && canResolve(kind) && onToggleResolved ? (
          <button
            type="button"
            aria-pressed={resolved}
            onClick={() => void toggleResolved()}
            className={`mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-bold transition-colors ${
              resolved
                ? 'border-brief-accent bg-brief-accent-soft text-brief-accent'
                : 'border-brief-rule text-brief-muted'
            }`}
          >
            {resolved ? <CheckIcon /> : null}
            풀림
          </button>
        ) : null}

        {failed ? (
          <p role="alert" className="mt-3 text-[13px] text-brief-ink">
            저장하지 못했어요. 다시 시도해 주세요.
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          {existing && onRemove ? (
            confirmingRemove ? (
              <span className="mr-auto flex items-center">
                <button
                  type="button"
                  onClick={() => void remove()}
                  aria-label="노트 삭제 확인"
                  className="min-h-11 rounded-full px-2.5 text-sm font-bold text-brief-accent"
                >
                  삭제할게요
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(false)}
                  aria-label="삭제 취소"
                  className="min-h-11 rounded-full px-2.5 text-sm text-brief-muted"
                >
                  그만두기
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                aria-label="노트 삭제"
                className="mr-auto min-h-11 rounded-full px-2.5 text-sm text-brief-muted hover:text-brief-ink"
              >
                삭제
              </button>
            )
          ) : null}
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

/**
 * 추리 노트 탭 — 2026-11-18 대표 승인 시안 A안 그대로: 노트 카드(종류 표지 · 쪽 · 내용)와 아래에 고정된
 * "단서·가설 적기" 버튼 하나. 내 노트/사건 정리 전환과 종류 고르기 줄은 없다(사건은 타임라인 탭에 있다).
 * 종류는 메모 창에서 고른다. 카드 내용을 누르면 메모 창이 열려 고치기·풀림·삭제를 하고, 쪽을 누르면 그 쪽으로 간다.
 * 노트는 독자가 쓴 것이라 스포일러 상한 대상이 아니며, 화면이 종류·풀림을 정하지 않는다(결정 23).
 */
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
          <p role="alert" className="m-0 py-8 text-center text-[13px] text-brief-muted">
            노트를 불러오지 못했어요
          </p>
        ) : null}
        {!failed && notes.length === 0 ? (
          <p className="m-0 py-8 text-center text-[13px] text-brief-muted">아직 적은 게 없어요.</p>
        ) : null}
        <ul data-no-track className="m-0 flex list-none flex-col gap-2 p-0">
          {notes.map((note) => (
            <li
              key={note.note_id}
              data-resolved={note.resolved ? 'true' : undefined}
              className="rounded-xl border border-brief-rule bg-white px-3 py-2.5 font-dashSans"
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-brief-muted">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span
                    data-testid="note-kind-badge"
                    className={`shrink-0 rounded-md px-1.5 py-1 text-[10.5px] font-semibold leading-none ${
                      note.kind === null
                        ? 'border border-brief-rule text-brief-muted'
                        : 'bg-brief-accent-soft text-brief-accent'
                    }`}
                  >
                    {note.kind === null ? '메모' : NOTE_KIND_LABELS[note.kind]}
                  </span>
                  {note.resolved ? <ResolvedMark /> : null}
                </span>
                {/* 쪽 — 누르면 그 쪽으로 간다. 보이는 크기는 시안대로 작게, 누르는 자리는 44px */}
                <button
                  type="button"
                  onClick={() => onJump(note.page_no)}
                  aria-label={`${note.page_no}쪽으로 이동`}
                  className="-my-3.5 -mr-2 shrink-0 py-3.5 pl-3 pr-2 text-[11px] text-brief-muted hover:text-brief-ink"
                >
                  {note.page_no}쪽
                </button>
              </div>
              <button
                type="button"
                onClick={() => setEditing(note)}
                aria-label="노트 수정"
                className={`mt-1.5 block w-full whitespace-pre-wrap break-words text-left text-[12.5px] leading-relaxed ${
                  note.resolved ? 'text-brief-muted' : 'text-brief-ink'
                }`}
              >
                {note.body}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* 시안 — 노트 목록 아래에 고정된 "단서·가설 적기" 한 개 */}
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 bg-brief-paper px-4 pb-4 pt-2">
        <button
          type="button"
          data-track="단서·가설 적기"
          onClick={() => setEditing('new')}
          disabled={currentPage === null}
          className="h-11 w-full rounded-full border border-brief-ink bg-transparent font-dashSans text-[13px] font-semibold text-brief-ink transition-colors hover:bg-[rgba(31,31,31,0.05)] active:bg-[rgba(31,31,31,0.1)] disabled:opacity-40"
        >
          단서·가설 적기
        </button>
      </div>

      {editing !== null ? (
        <NoteEditor
          initial={
            editing === 'new'
              ? { page_no: currentPage ?? 1, kind: null, body: prefill }
              : { page_no: editing.page_no, kind: editing.kind, body: editing.body }
          }
          existing={editing === 'new' ? null : editing}
          maxPage={maxPage}
          onSave={(draft) =>
            editing === 'new' ? onAdd(draft) : onEdit(editing.note_id, draft)
          }
          onToggleResolved={
            editing === 'new' ? undefined : (resolved) => onEdit(editing.note_id, { resolved })
          }
          onRemove={editing === 'new' ? undefined : () => onRemove(editing.note_id)}
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
