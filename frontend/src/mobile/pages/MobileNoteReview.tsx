import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useBackToBook } from '../../hooks/useBackToBook';
import { useCatalog } from '../../hooks/useCatalog';
import {
  classifyReviewError,
  fetchReview,
  shareReview,
  startReview,
  type ReviewFailure,
} from '../../services/reviewService';
import type { ReviewResult, ReviewStatus } from '../../types';
import { BOOK_ROUTES } from '../../utils/routes';
import { CaseLabel, CaseStamp } from '../components/CaseMotifs';
import { countsLine, earlyLine, KIND_LABEL, VERDICT_LABEL, VERDICT_TONE } from '../review/verdict';

const MAX_MESSAGE = 2000;

type View =
  | { kind: 'loading' }
  | { kind: 'locked' }
  | { kind: 'unavailable' }
  | { kind: 'error' }
  | { kind: 'loaded'; status: ReviewStatus };

function BackIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 4.8 6.5 8 9.5 11.2" />
    </svg>
  );
}

const primaryButton =
  'min-h-12 w-full rounded-full bg-[#8f1d35] px-6 text-[16px] font-bold text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0a0b]';
const panel = 'rounded-[16px] border border-[#35292c] bg-[#1e1618] p-4';

// FR-QNA-004 🚦
export default function MobileNoteReview() {
  const { bookId = '' } = useParams();
  return <NoteReviewScreen key={bookId} bookId={bookId} />;
}

/**
 * 내 추리 채점 (대표 결정 2026-11-24) — 완독 뒤 내 노트(가설·단서)를 AI가 한 번 채점하고,
 * 결과지를 그 책의 완독자 커뮤니티에 공유한다.
 *
 * 열림·잠김·판정·칭호·개수는 전부 서버가 정한다. 화면은 쪽 번호·완독 여부를 계산하거나 보내지 않는다
 * (절대 규칙 2·8, FR-BRF-005 🚦). 채점 결과에는 진상이 있으므로 서버가 잠김(403)을 주면 아무것도 그리지 않는다.
 */
export function NoteReviewScreen({
  bookId,
  desktop = false,
}: {
  bookId: string;
  desktop?: boolean;
}) {
  const navigate = useNavigate();
  const backToBook = useBackToBook(bookId);
  const { books } = useCatalog();
  const title = books.find((book) => book.book_id === bookId)?.title ?? '';
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const request = useRef(0);

  const load = useCallback(() => {
    const id = (request.current += 1);
    setView({ kind: 'loading' });
    fetchReview(bookId)
      .then((status) => {
        if (id === request.current) setView({ kind: 'loaded', status });
      })
      .catch((cause) => {
        if (id !== request.current) return;
        const failure = classifyReviewError(cause);
        setView({
          kind: failure === 'locked' ? 'locked' : failure === 'not_found' ? 'unavailable' : 'error',
        });
      });
  }, [bookId]);

  useEffect(load, [load]);

  async function grade() {
    if (grading) return;
    setGrading(true);
    setGradeError(null);
    try {
      const result = await startReview(bookId, [...chosen]);
      setView({ kind: 'loaded', status: { state: 'done', result, shared_post_id: null } });
    } catch (cause) {
      const failure: ReviewFailure = classifyReviewError(cause);
      if (failure === 'locked') setView({ kind: 'locked' });
      else if (failure === 'busy') setGradeError('채점하고 있어요. 잠시 뒤 다시 열어 주세요.');
      else if (failure === 'no_targets') setGradeError('채점할 가설·단서 노트가 없어요.');
      else setGradeError('채점하지 못했어요. 잠시 뒤 다시 눌러 주세요.');
    } finally {
      setGrading(false);
    }
  }

  const goCommunity = () => navigate(BOOK_ROUTES.community.replace(':bookId', bookId));

  return (
    <div
      data-testid="note-review"
      className={`bg-[#0d0a0b] bg-[radial-gradient(120%_420px_at_50%_-120px,#2a1418_0%,transparent_70%)] bg-no-repeat font-dashSans text-[#ece6e0] ${
        desktop ? 'mx-auto min-h-full max-w-[640px] pb-10' : 'min-h-[100dvh] pb-10'
      }`}
      style={
        desktop
          ? undefined
          : { paddingTop: 'var(--safe-top)', paddingBottom: 'max(40px, var(--safe-bottom))' }
      }
    >
      <header className="grid grid-cols-[44px_1fr_44px] items-center px-3.5 pt-3.5">
        <button
          type="button"
          onClick={backToBook}
          aria-label="돌아가기"
          className="flex size-10 items-center justify-center rounded-full border border-[#35292c] bg-[#1e1618] text-[#ece6e0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4475f]"
        >
          <BackIcon />
        </button>
        <div className="grid text-center leading-tight">
          <span className="text-[12px] font-bold tracking-[0.04em] text-[#e58a9b]">
            내 추리 채점
          </span>
          <h1 className="m-0 font-dashSerif text-[19px] font-black">{title}</h1>
        </div>
        <span />
      </header>

      <main className="mx-auto w-full max-w-[460px] px-4 pt-6">
        {view.kind === 'loading' ? (
          <p role="status" className="m-0 py-12 text-center text-[14px] text-[#b5aaa6]">
            불러오는 중
          </p>
        ) : null}

        {view.kind === 'locked' ? (
          <div
            role="alert"
            className={`${panel} flex flex-col items-center gap-5 px-6 py-10 text-center`}
          >
            <p className="m-0 break-keep text-[16px] font-bold">
              끝까지 읽으면 내 추리를 채점할 수 있어요
            </p>
            <button
              type="button"
              data-track="review-locked-continue"
              onClick={() =>
                navigate(BOOK_ROUTES.reader.replace(':bookId', bookId), { replace: true })
              }
              className="min-h-11 rounded-full bg-[#8f1d35] px-7 text-[15px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
            >
              이어 읽기
            </button>
          </div>
        ) : null}

        {view.kind === 'unavailable' ? (
          <p role="alert" className="m-0 py-12 text-center text-[15px]">
            이 책은 아직 추리 채점을 할 수 없어요
          </p>
        ) : null}

        {view.kind === 'error' ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <p role="alert" className="m-0 text-[15px]">
              불러오지 못했어요
            </p>
            <button
              type="button"
              onClick={load}
              className="min-h-11 rounded-full bg-[#8f1d35] px-6 text-[15px] font-bold text-white"
            >
              다시 시도
            </button>
          </div>
        ) : null}

        {view.kind === 'loaded' && view.status.state === 'ready' ? (
          <ReadyPanel
            status={view.status}
            chosen={chosen}
            onToggle={(id) =>
              setChosen((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            grading={grading}
            error={gradeError}
            onGrade={() => void grade()}
          />
        ) : null}

        {view.kind === 'loaded' && view.status.state === 'done' ? (
          <ResultPanel
            bookId={bookId}
            result={view.status.result}
            sharedPostId={view.status.shared_post_id}
            onShared={(postId) =>
              setView((prev) =>
                prev.kind === 'loaded' && prev.status.state === 'done'
                  ? { kind: 'loaded', status: { ...prev.status, shared_post_id: postId } }
                  : prev
              )
            }
            onCommunity={goCommunity}
          />
        ) : null}
      </main>
    </div>
  );
}

function ReadyPanel({
  status,
  chosen,
  onToggle,
  grading,
  error,
  onGrade,
}: {
  status: Extract<ReviewStatus, { state: 'ready' }>;
  chosen: Set<string>;
  onToggle: (id: string) => void;
  grading: boolean;
  error: string | null;
  onGrade: () => void;
}) {
  const pickerId = useId();
  const { hypothesis, clue } = status.targets;
  const hasTargets = hypothesis + clue > 0;
  const canPick = !hasTargets && status.candidates.length > 0;
  const nothing = !hasTargets && status.candidates.length === 0;
  const canGrade = !grading && !status.busy && (hasTargets || chosen.size > 0);

  return (
    <section aria-labelledby={`${pickerId}-title`} className="flex flex-col gap-4">
      <div className="flex flex-col items-center pt-2 text-center">
        <CaseLabel>Case Review</CaseLabel>
        <h2
          id={`${pickerId}-title`}
          className="m-0 mt-3 font-dashSerif text-[26px] font-bold leading-[1.3]"
        >
          내 추리, 얼마나 맞았을까
        </h2>
        <p className="m-0 mt-2 break-keep text-[15px] leading-[1.6] text-[#d8cfca]">
          {hasTargets
            ? `읽으며 남긴 가설 ${hypothesis}개와 단서 ${clue}개를 AI가 채점해요.`
            : '가설이나 단서로 표시한 노트가 아직 없어요.'}{' '}
          채점은 한 번만 할 수 있어요.
        </p>
      </div>

      {status.excluded_count > 0 ? (
        <p className="m-0 break-keep rounded-[12px] bg-[#160f11] px-3.5 py-2.5 text-[14px] text-[#d8cfca]">
          결말을 본 뒤 쓰거나 고친 노트 {status.excluded_count}개는 빼고 채점해요.
        </p>
      ) : null}
      {!status.timing_verified ? (
        <p className="m-0 break-keep rounded-[12px] bg-[#160f11] px-3.5 py-2.5 text-[14px] text-[#d8cfca]">
          이 책은 결말 전에 쓴 노트인지 확인할 수 없어 모든 노트로 채점해요. 결과지에 “결말 전 기록
          여부 확인 안 됨”이 붙어요.
        </p>
      ) : null}

      {canPick ? (
        <fieldset className={panel}>
          <legend className="px-1 font-dashSerif text-[17px] font-bold">
            가설이었던 메모를 골라 주세요
          </legend>
          <p className="m-0 mt-1 text-[14px] text-[#b5aaa6]">
            고른 메모는 가설로 채점해요. 노트의 종류는 바뀌지 않아요.
          </p>
          <ul className="m-0 mt-3 grid list-none gap-2 p-0">
            {status.candidates.map((note) => (
              <li key={note.note_id}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] bg-[#160f11] px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={chosen.has(note.note_id)}
                    onChange={() => onToggle(note.note_id)}
                    className="mt-1 size-4 accent-[#c4475f]"
                  />
                  <span className="min-w-0" data-no-track>
                    <span className="block text-[12px] text-[#b5aaa6]">{note.page_no}쪽</span>
                    <span className="block whitespace-pre-wrap break-words text-[15px] leading-[1.5]">
                      {note.body}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {nothing ? (
        <p className={`${panel} m-0 break-keep text-center text-[15px] leading-[1.6]`}>
          채점할 노트가 없어요. 다음 책에서는 읽으며 가설을 적어 보세요.
        </p>
      ) : (
        <button
          type="button"
          data-track="review-grade"
          disabled={!canGrade}
          onClick={onGrade}
          className={primaryButton}
        >
          {grading || status.busy ? '채점하는 중이에요' : '내 추리 채점하기'}
        </button>
      )}
      {grading ? (
        <p role="status" className="m-0 text-center text-[14px] text-[#b5aaa6]">
          노트를 작품과 맞춰 보고 있어요. 잠시만 기다려 주세요.
        </p>
      ) : null}
      {error || (status.last_failed && !grading) ? (
        <p role="alert" className="m-0 text-center text-[14px] text-[#e58a9b]">
          {error ?? '지난번에 채점하지 못했어요. 다시 눌러 주세요.'}
        </p>
      ) : null}
    </section>
  );
}

function ResultPanel({
  bookId,
  result,
  sharedPostId,
  onShared,
  onCommunity,
}: {
  bookId: string;
  result: ReviewResult;
  sharedPostId: string | null;
  onShared: (postId: string) => void;
  onCommunity: () => void;
}) {
  const headingId = useId();
  const early = earlyLine(result.early_pages, result.timing_verified);
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby={headingId} className="flex flex-col items-center pt-2 text-center">
        <CaseStamp className="rotate-[-6deg]">사건 종결</CaseStamp>
        <p className="m-0 mt-5 text-[14px] font-bold text-[#e58a9b]">나의 칭호</p>
        <h2
          id={headingId}
          data-testid="review-title"
          className="m-0 mt-1 font-dashSerif text-[34px] font-black leading-[1.2] text-white"
        >
          {result.title}
        </h2>
        <p className="m-0 mt-2 text-[16px] font-bold">{countsLine(result.counts)}</p>
        {early ? <p className="m-0 mt-1 text-[14px] text-[#d8cfca]">{early}</p> : null}
        {result.excluded_count > 0 ? (
          <p className="m-0 mt-1 text-[13px] text-[#b5aaa6]">
            결말 뒤에 쓰거나 고친 노트 {result.excluded_count}개는 빠졌어요
          </p>
        ) : null}
      </section>

      <section aria-labelledby={`${headingId}-truth`} className={panel}>
        <h3 id={`${headingId}-truth`} className="m-0 font-dashSerif text-[17px] font-bold">
          사건의 진상
        </h3>
        <p className="m-0 mt-2 whitespace-pre-wrap break-keep text-[15px] leading-[1.7] text-[#ece6e0]">
          {result.truth_summary}
        </p>
        {result.reveal_page !== null ? (
          <p className="m-0 mt-2 text-[13px] text-[#b5aaa6]">{result.reveal_page}쪽에서 밝혀져요</p>
        ) : null}
      </section>

      <section aria-labelledby={`${headingId}-notes`}>
        <h3 id={`${headingId}-notes`} className="m-0 px-1 font-dashSerif text-[17px] font-bold">
          노트별 채점
        </h3>
        <ul className="m-0 mt-3 grid list-none gap-2.5 p-0" data-testid="review-notes">
          {result.notes.map((note) => (
            <li
              key={note.note_id}
              className="rounded-[14px] border border-[#35292c] bg-[#1e1618] px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#b5aaa6]">
                <span
                  className={`rounded-full border px-2 font-extrabold leading-[1.7] ${VERDICT_TONE[note.verdict]}`}
                >
                  {VERDICT_LABEL[note.verdict]}
                </span>
                <span>
                  {KIND_LABEL[note.kind]}
                  {note.chosen_as_hypothesis ? '(고른 메모)' : ''} · {note.page_no}쪽에서 씀
                </span>
              </div>
              <p
                data-no-track
                className="m-0 mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-[1.55]"
              >
                {note.body}
              </p>
              {note.explanation ? (
                <p className="m-0 mt-1 break-keep text-[14px] leading-[1.55] text-[#d8cfca]">
                  {note.explanation}
                </p>
              ) : null}
              {note.evidence_page !== null ? (
                <p className="m-0 mt-1 text-[13px] text-[#b5aaa6]">근거 {note.evidence_page}쪽</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <SharePanel
        bookId={bookId}
        result={result}
        sharedPostId={sharedPostId}
        onShared={onShared}
        onCommunity={onCommunity}
      />
    </div>
  );
}

function SharePanel({
  bookId,
  result,
  sharedPostId,
  onShared,
  onCommunity,
}: {
  bookId: string;
  result: ReviewResult;
  sharedPostId: string | null;
  onShared: (postId: string) => void;
  onCommunity: () => void;
}) {
  const id = useId();
  const judged = result.notes.filter((n) => n.verdict !== 'pending');
  // 대표 결정 9번 — 기본값: 판정 받은 가설 전부 선택, 단서 선택 안 함
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(judged.filter((n) => n.kind === 'hypothesis').map((n) => n.note_id))
  );
  const [message, setMessage] = useState('');
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function share() {
    if (sharing) return;
    setSharing(true);
    setNotice(null);
    try {
      const { post_id } = await shareReview(bookId, [...picked], message.trim() || null);
      onShared(post_id);
    } catch (cause) {
      const failure = classifyReviewError(cause);
      setNotice(
        failure === 'already_shared'
          ? '이미 결과지를 공유했어요. 다시 올리려면 커뮤니티에서 먼저 지워 주세요.'
          : failure === 'rate_limited'
            ? '글은 1시간에 10개까지 올릴 수 있어요. 잠시 후 다시 시도해 주세요.'
            : failure === 'locked'
              ? '끝까지 읽은 독자만 공유할 수 있어요.'
              : '공유하지 못했어요. 잠시 후 다시 시도해 주세요.'
      );
    } finally {
      setSharing(false);
    }
  }

  if (sharedPostId) {
    return (
      <section
        className={`${panel} flex flex-col items-center gap-3 text-center`}
        data-testid="review-shared"
      >
        <p className="m-0 text-[15px] font-bold">완독자 커뮤니티에 결과지를 공유했어요</p>
        <button
          type="button"
          data-track="review-go-community"
          onClick={onCommunity}
          className={primaryButton}
        >
          커뮤니티에서 보기
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className={panel} data-testid="review-share">
      <h3 id={`${id}-title`} className="m-0 font-dashSerif text-[17px] font-bold">
        결과지 공유하기
      </h3>
      <p className="m-0 mt-1 break-keep text-[14px] text-[#b5aaa6]">
        칭호·개수와 고른 노트만 완독자 커뮤니티에 올라가요. 사건의 진상 요약은 올라가지 않아요.
      </p>
      {judged.length > 0 ? (
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {judged.map((note) => (
            <li key={note.note_id}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] bg-[#160f11] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={picked.has(note.note_id)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(note.note_id)) next.delete(note.note_id);
                      else next.add(note.note_id);
                      return next;
                    })
                  }
                  className="mt-1 size-4 accent-[#c4475f]"
                />
                <span className="min-w-0">
                  <span className="block text-[12px] text-[#b5aaa6]">
                    {VERDICT_LABEL[note.verdict]} · {KIND_LABEL[note.kind]} · {note.page_no}쪽
                  </span>
                  <span
                    data-no-track
                    className="block whitespace-pre-wrap break-words text-[15px] leading-[1.5]"
                  >
                    {note.body}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={`${id}-message`} className="mt-4 block text-[14px] font-bold">
        한마디 (선택)
      </label>
      <textarea
        id={`${id}-message`}
        data-no-track
        value={message}
        maxLength={MAX_MESSAGE}
        rows={2}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="이번 추리는 어땠나요?"
        className="mt-2 block w-full resize-none rounded-[12px] border border-[#35292c] bg-[#0d0a0b] px-3.5 py-3 text-[16px] leading-[1.55] text-[#ece6e0] placeholder:text-[#8f8480] focus:border-[#c4475f] focus:outline-none"
      />
      <button
        type="button"
        data-track="review-share"
        disabled={sharing}
        onClick={() => void share()}
        className={`${primaryButton} mt-4`}
      >
        {sharing ? '공유하는 중' : '완독자 커뮤니티에 공유하기'}
      </button>
      {notice ? (
        <p role="alert" className="m-0 mt-3 text-[14px] text-[#e58a9b]">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
