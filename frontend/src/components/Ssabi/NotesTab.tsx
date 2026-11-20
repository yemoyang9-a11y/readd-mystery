import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../../hooks/useModalLayer';
import type { NoteDraft, NoteKind, ReadingNote } from '../../types';
import { canResolve, CheckIcon, isOpenThread, NOTE_KIND_LABELS, NOTE_KIND_ORDER, ResolvedMark } from './noteKind';

export { NOTE_KIND_LABELS };

// 메모 창의 종류 선택지 — 기본은 일반(null)
const KIND_CHOICES: { value: NoteKind | null; label: string }[] = [
  { value: null, label: '일반' },
  ...NOTE_KIND_ORDER.map((value) => ({ value, label: NOTE_KIND_LABELS[value] })),
];

const MAX_BODY_LENGTH = 1000;

type NoteGroup = 'open' | 'clue' | 'rest';

const GROUP_TITLES: Record<NoteGroup, string> = {
  open: '아직 풀지 못한 것',
  clue: '모은 단서',
  rest: '그 밖의 노트',
};

const GROUP_ORDER: NoteGroup[] = ['open', 'clue', 'rest'];

const GROUP_HEADING_ORDER: Record<NoteGroup, string> = {
  open: 'mobile:order-1',
  clue: 'mobile:order-3',
  rest: 'mobile:order-5',
};

const GROUP_CARD_ORDER: Record<NoteGroup, string> = {
  open: 'mobile:order-2',
  clue: 'mobile:order-4',
  rest: 'mobile:order-6',
};

function groupOf(note: ReadingNote): NoteGroup {
  if (isOpenThread(note)) return 'open';
  return note.kind === 'clue' ? 'clue' : 'rest';
}

const ADD_BAR: { kind: NoteKind; label: string; icon: JSX.Element }[] = [
  {
    kind: 'clue',
    label: '단서 남기기',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="M15 15l5.5 5.5" />
      </svg>
    ),
  },
  {
    kind: 'question',
    label: '궁금한 점 적기',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.6 2.6 0 015 .8c0 1.7-2.5 2-2.5 3.7M12 17h.01" />
      </svg>
    ),
  },
  {
    kind: 'hypothesis',
    label: '가설 세우기',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z" />
      </svg>
    ),
  },
];

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />
      <path d="M8.5 11h7M8.5 14h4" />
    </svg>
  );
}

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

  // 2026-11-19 대표 지시 — 창은 document.body로 포털되어 [data-mobile] 밖에 놓인다. 그대로 두면 :root의
  // 데스크톱 토큰(brief-accent 초록 79 112 82)이 휴대폰 창에 샌다. 창을 연 자리가 휴대폰 화면 안이면
  // 같은 data-mobile을 창에도 달아 휴대폰 토큰(버건디 #8f1d35 · 연분홍)을 쓰게 한다. 그리기 전에 정한다.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [mobile, setMobile] = useState(false);
  useLayoutEffect(() => {
    setMobile(Boolean(anchorRef.current?.closest('[data-mobile]')));
  }, []);

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

  const overlay = createPortal(
    <div
      data-testid="note-editor-overlay"
      data-mobile={mobile ? 'true' : undefined}
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
  return (
    <>
      <span ref={anchorRef} hidden />
      {overlay}
    </>
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
  onAskAmo,
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
  onAskAmo?: (text: string) => void;
  quoteDraft?: { text: string; token: number } | null;
  onQuoteDraftHandled?: () => void;
}) {
  const [editing, setEditing] = useState<ReadingNote | 'new' | null>(quoteDraft ? 'new' : null);
  const [prefill, setPrefill] = useState(quoteDraft?.text ?? '');
  const [newKind, setNewKind] = useState<NoteKind | null>(null);
  const maxPage = totalPages && totalPages > 0 ? totalPages : null;

  useEffect(() => {
    if (!quoteDraft) return;
    setPrefill(quoteDraft.text);
    setEditing('new');
  }, [quoteDraft?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew(kind: NoteKind | null) {
    setNewKind(kind);
    setEditing('new');
  }

  const counts: Record<NoteGroup, number> = { open: 0, clue: 0, rest: 0 };
  for (const note of notes) counts[groupOf(note)] += 1;
  const firstGroup = GROUP_ORDER.find((group) => counts[group] > 0);

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        {failed ? (
          <p role="alert" className="m-0 py-8 text-center text-[13px] text-brief-muted">
            노트를 불러오지 못했어요
          </p>
        ) : null}
        {!failed && notes.length === 0 ? (
          <p className="m-0 py-8 text-center text-[13px] text-brief-muted mobile:hidden">아직 적은 게 없어요.</p>
        ) : null}
        <ul data-no-track className="m-0 flex list-none flex-col gap-2 p-0 mobile:gap-0">
          {GROUP_ORDER.filter((group) => counts[group] > 0).map((group) => (
            <li
              key={`heading-${group}`}
              role="presentation"
              data-testid={`note-group-${group}`}
              className={`hidden font-dashSans mobile:mb-3 mobile:block ${GROUP_HEADING_ORDER[group]} ${
                group === firstGroup ? '' : 'mobile:mt-5'
              }`}
            >
              <h3 className="m-0 flex items-baseline justify-between text-sm font-bold text-brief-ink">
                {GROUP_TITLES[group]}
                <small className="font-dashMono text-xs font-normal text-brief-muted">{counts[group]}</small>
              </h3>
            </li>
          ))}
          {notes.map((note) => {
            const group = groupOf(note);
            const askLabel = canResolve(note.kind) ? '아모와 따져 보기' : '아모에게 물어보기';
            return (
              <li
                key={note.note_id}
                data-resolved={note.resolved ? 'true' : undefined}
                className={`rounded-xl border border-brief-rule bg-white px-3 py-2.5 font-dashSans mobile:mb-3 mobile:rounded-[14px] mobile:p-3.5 ${GROUP_CARD_ORDER[group]}`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-brief-muted mobile:text-xs">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span
                      data-testid="note-kind-badge"
                      className={`shrink-0 rounded-md px-1.5 py-1 text-[10.5px] font-semibold leading-none mobile:px-2 mobile:py-[3px] mobile:text-xs mobile:font-bold ${
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
                    className="-my-3.5 -mr-2 shrink-0 py-3.5 pl-3 pr-2 text-[11px] text-brief-muted hover:text-brief-ink mobile:text-xs"
                  >
                    {note.page_no}쪽
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(note)}
                  aria-label="노트 수정"
                  className={`mt-1.5 block w-full whitespace-pre-wrap break-words text-left text-[12.5px] leading-relaxed mobile:mt-2 mobile:text-[15px] mobile:leading-normal ${
                    note.resolved ? 'text-brief-muted' : 'text-brief-ink'
                  }`}
                >
                  {note.body}
                </button>
                {onAskAmo ? (
                  <div className="mt-3 hidden gap-2 mobile:flex">
                    <button
                      type="button"
                      data-track={askLabel}
                      onClick={() => onAskAmo(note.body)}
                      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${
                        canResolve(note.kind)
                          ? 'border-brief-accent text-brief-accent'
                          : 'border-brief-rule text-brief-ink'
                      }`}
                    >
                      <ChatIcon />
                      {askLabel}
                    </button>
                    {isOpenThread(note) ? (
                      <button
                        type="button"
                        data-track="풀었어요"
                        onClick={() => void onEdit(note.note_id, { resolved: true })}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brief-rule px-3 text-[13px] font-semibold text-brief-ink"
                      >
                        <CheckIcon />
                        풀었어요
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {/* 시안 — 노트 목록 아래에 고정된 "단서·가설 적기" 한 개 */}
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 bg-brief-paper px-4 pb-4 pt-2 mobile:border-t mobile:border-brief-rule mobile:pb-5 mobile:pt-3">
        <button
          type="button"
          data-track="단서·가설 적기"
          onClick={() => openNew(null)}
          disabled={currentPage === null}
          className="h-11 w-full rounded-full border border-brief-ink bg-transparent font-dashSans text-[13px] font-semibold text-brief-ink transition-colors hover:bg-[rgba(31,31,31,0.05)] active:bg-[rgba(31,31,31,0.1)] disabled:opacity-40 mobile:hidden"
        >
          단서·가설 적기
        </button>
        <div className="hidden grid-cols-3 gap-2 mobile:grid">
          {ADD_BAR.map(({ kind, label, icon }) => (
            <button
              key={kind}
              type="button"
              data-track={label}
              onClick={() => openNew(kind)}
              disabled={currentPage === null}
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border border-brief-rule bg-white font-dashSans text-[13px] font-semibold text-brief-ink disabled:opacity-40"
            >
              <span className="text-brief-accent">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {editing !== null ? (
        <NoteEditor
          initial={
            editing === 'new'
              ? { page_no: currentPage ?? 1, kind: newKind, body: prefill }
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
            setNewKind(null);
            onQuoteDraftHandled?.();
          }}
        />
      ) : null}
    </div>
  );
}
