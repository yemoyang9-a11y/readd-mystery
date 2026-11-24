import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import AmoSherlock from '../../components/common/AmoSherlock';
import { useBackToBook } from '../../hooks/useBackToBook';
import { useCatalog } from '../../hooks/useCatalog';
import {
  classifyReviewError,
  fetchReview,
  shareReview,
  startReview,
  type ReviewFailure,
} from '../../services/reviewService';
import type { ReviewResult, ReviewStatus, ReviewVerdict } from '../../types';
import { BOOK_ROUTES } from '../../utils/routes';
import { CaseLabel, CaseStamp } from '../components/CaseMotifs';
import { earlyLine, KIND_LABEL, VERDICT_LABEL, VERDICT_TONE } from '../review/verdict';

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

// 누름 반응·전환은 transform·색만 움직인다. 움직임 줄이기 설정이면 끈다 (UX reduced-motion, press-feedback)
const press =
  'transition-[transform,background-color,border-color] duration-200 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100';
const ring =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0a0b]';
const primaryButton = `min-h-12 w-full rounded-full bg-[#8f1d35] px-6 text-[16px] font-bold text-white hover:bg-[#a3243f] disabled:opacity-40 disabled:active:scale-100 ${press} ${ring}`;

/** 판정 줄의 왼쪽 막대 — 색만으로 뜻을 전하지 않는다. 판정 이름이 늘 함께 나온다 (UX color-not-only) */
const VERDICT_BAR: Record<ReviewVerdict, string> = {
  hit: 'before:bg-[#7fc29b]',
  key: 'before:bg-[#7fc29b]',
  partial: 'before:bg-[#d9ad5f]',
  related: 'before:bg-[#d9ad5f]',
  miss: 'before:bg-[#5a4c4f]',
  unrelated: 'before:bg-[#5a4c4f]',
  pending: 'before:bg-[#35292c]',
};

/** 아모의 말 — 아모 그림 옆 말풍선. 아모 말투(해요체, 자신은 "아모"·"저")를 따른다 */
function AmoSays({ children, thinking = false }: { children: ReactNode; thinking?: boolean }) {
  return (
    <div className="flex items-end gap-2.5">
      <AmoSherlock expression={thinking ? 'think' : 'default'} className="h-16 w-auto shrink-0" />
      <div className="relative mb-2 min-w-0 flex-1 rounded-[18px] rounded-bl-[6px] bg-[#1e1618] px-4 py-3 text-[15px] leading-[1.6] text-[#ece6e0] [text-wrap:pretty]">
        <span className="sr-only">아모: </span>
        {children}
      </div>
    </div>
  );
}

// FR-QNA-004 🚦
export default function MobileNoteReview() {
  const { bookId = '' } = useParams();
  return <NoteReviewScreen key={bookId} bookId={bookId} />;
}

/**
 * 내 추리 채점 (대표 결정 2026-11-24) — 완독 뒤 내 노트(가설·단서)를 아모가 한 번 채점하고,
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
      else if (failure === 'busy')
        setGradeError('아모가 채점하고 있어요. 잠시 뒤 다시 열어 주세요.');
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
          className={`flex size-11 items-center justify-center rounded-full border border-[#35292c] bg-[#1e1618] text-[#ece6e0] hover:border-[#5a4c4f] ${press} ${ring}`}
        >
          <BackIcon />
        </button>
        <div className="grid text-center leading-tight">
          <span className="text-[12px] font-bold tracking-[0.04em] text-[#e58a9b]">
            내 추리 채점
          </span>
          <h1 className="m-0 truncate font-dashSerif text-[19px] font-black">{title}</h1>
        </div>
        <span />
      </header>

      <main className="mx-auto w-full max-w-[460px] px-4 pt-6">
        {view.kind === 'loading' ? <LoadingSkeleton /> : null}

        {view.kind === 'locked' ? (
          <div role="alert" className="flex flex-col gap-6 pt-6">
            <AmoSays thinking>끝까지 읽으면 내 추리를 채점할 수 있어요</AmoSays>
            <button
              type="button"
              data-track="review-locked-continue"
              onClick={() =>
                navigate(BOOK_ROUTES.reader.replace(':bookId', bookId), { replace: true })
              }
              className={primaryButton}
            >
              이어 읽기
            </button>
          </div>
        ) : null}

        {view.kind === 'unavailable' ? (
          <div role="alert" className="pt-6">
            <AmoSays thinking>이 책은 아직 추리 채점을 할 수 없어요</AmoSays>
          </div>
        ) : null}

        {view.kind === 'error' ? (
          <div className="flex flex-col gap-6 pt-6">
            <div role="alert">
              <AmoSays thinking>채점 기록을 불러오지 못했어요. 다시 시도해 주세요.</AmoSays>
            </div>
            <button type="button" onClick={load} className={primaryButton}>
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

/** 불러오는 동안 실제 화면 모양을 미리 잡아 둔다 (UX progressive-loading, content-jumping) */
function LoadingSkeleton() {
  const bar = 'rounded-full bg-[#1e1618] motion-safe:animate-pulse';
  return (
    <div role="status" aria-label="불러오는 중" className="flex flex-col gap-4 pt-4">
      <div className="flex items-end gap-2.5">
        <div className="h-16 w-12 shrink-0 rounded-[14px] bg-[#1e1618] motion-safe:animate-pulse" />
        <div className={`h-16 flex-1 rounded-[18px] bg-[#1e1618] motion-safe:animate-pulse`} />
      </div>
      <div className={`mt-4 h-7 w-2/3 ${bar}`} />
      <div className={`h-4 w-full ${bar}`} />
      <div className={`h-4 w-4/5 ${bar}`} />
      <div className={`mt-4 h-12 w-full ${bar}`} />
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
  const working = grading || status.busy;

  return (
    <section aria-labelledby={`${pickerId}-title`} className="flex flex-col gap-5">
      <div className="pt-2">
        <CaseLabel>Case Review</CaseLabel>
        <h2
          id={`${pickerId}-title`}
          className="m-0 mt-3 font-dashSerif text-[28px] font-bold leading-[1.25] tracking-[-0.01em] [text-wrap:balance]"
        >
          내 추리, 얼마나 맞았을까
        </h2>
      </div>

      <AmoSays thinking={working}>
        {working ? (
          '아모가 노트를 작품과 맞춰 보고 있어요. 잠시만 기다려 주세요.'
        ) : (
          <>
            {hasTargets
              ? `읽으며 남긴 가설 ${hypothesis}개와 단서 ${clue}개를 아모가 채점해요.`
              : '가설이나 단서로 표시한 노트가 아직 없어요.'}{' '}
            채점은 한 번만 할 수 있어요.
          </>
        )}
      </AmoSays>

      {status.excluded_count > 0 || !status.timing_verified ? (
        <ul className="m-0 grid list-none gap-2 p-0 text-[14px] leading-[1.55] text-[#d8cfca]">
          {status.excluded_count > 0 ? (
            <li className="flex gap-2.5 before:mt-[9px] before:size-1.5 before:shrink-0 before:rounded-full before:bg-[#c4475f] before:content-['']">
              결말을 본 뒤 쓰거나 고친 노트 {status.excluded_count}개는 빼고 채점해요.
            </li>
          ) : null}
          {!status.timing_verified ? (
            <li className="flex gap-2.5 before:mt-[9px] before:size-1.5 before:shrink-0 before:rounded-full before:bg-[#c4475f] before:content-['']">
              이 책은 결말 전에 쓴 노트인지 확인할 수 없어 모든 노트로 채점해요. 결과지에 “결말 전
              기록 여부 확인 안 됨”이 붙어요.
            </li>
          ) : null}
        </ul>
      ) : null}

      {canPick ? (
        <fieldset className="m-0 rounded-[18px] border border-[#35292c] bg-[#160f11] p-4">
          <legend className="px-1 font-dashSerif text-[17px] font-bold">
            가설이었던 메모를 골라 주세요
          </legend>
          <p className="m-0 mt-1 text-[14px] text-[#b5aaa6]">
            고른 메모는 가설로 채점해요. 노트의 종류는 바뀌지 않아요.
          </p>
          <ul className="m-0 mt-3 grid list-none gap-2 p-0">
            {status.candidates.map((note) => (
              <li key={note.note_id}>
                <CheckRow
                  checked={chosen.has(note.note_id)}
                  onChange={() => onToggle(note.note_id)}
                  meta={`${note.page_no}쪽`}
                  body={note.body}
                />
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {nothing ? (
        <p className="m-0 rounded-[14px] bg-[#160f11] px-4 py-3.5 text-[15px] leading-[1.6] [text-wrap:pretty]">
          채점할 노트가 없어요. 다음 책에서는 읽으며 가설을 적어 보세요.
        </p>
      ) : (
        <button
          type="button"
          data-track="review-grade"
          disabled={!canGrade}
          aria-busy={working}
          onClick={onGrade}
          className={primaryButton}
        >
          {working ? '채점하는 중이에요' : '내 추리 채점하기'}
        </button>
      )}
      {grading ? (
        <div role="status" aria-label="채점하는 중" className="grid gap-2.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[72px] rounded-[14px] bg-[#160f11] motion-safe:animate-pulse"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
      ) : null}
      {error || (status.last_failed && !grading) ? (
        <p role="alert" className="m-0 text-center text-[14px] text-[#e58a9b]">
          {error ?? '지난번에 채점하지 못했어요. 다시 눌러 주세요.'}
        </p>
      ) : null}
    </section>
  );
}

function CheckRow({
  checked,
  onChange,
  meta,
  body,
}: {
  checked: boolean;
  onChange: () => void;
  meta: string;
  body: string;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[12px] border px-3 py-2.5 transition-colors duration-200 motion-reduce:transition-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#e58a9b] ${
        checked ? 'border-[#8f1d35] bg-[#24161a]' : 'border-transparent bg-[#1e1618]'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-1 size-[18px] shrink-0 accent-[#c4475f] focus-visible:outline-none"
      />
      <span className="min-w-0">
        <span className="block text-[12px] text-[#b5aaa6]">{meta}</span>
        <span
          data-no-track
          className="block whitespace-pre-wrap break-words text-[15px] leading-[1.5]"
        >
          {body}
        </span>
      </span>
    </label>
  );
}

/** 칭호 아래 숫자 두 칸 — 고정폭 숫자로 줄을 맞춘다 */
function Stat({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="rounded-[14px] bg-[#160f11] px-3.5 py-3 text-left">
      <dt className="text-[13px] font-bold text-[#b5aaa6]">{label}</dt>
      <dd className="m-0 mt-1 font-dashMono text-[22px] font-medium tabular-nums text-white">
        {value}
        <span className="text-[15px] text-[#b5aaa6]"> / {total}</span>
      </dd>
    </div>
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
  const { hypothesis, clue } = result.counts;
  return (
    <div className="flex flex-col gap-7">
      <section aria-labelledby={headingId} className="relative pt-2">
        <CaseStamp className="absolute right-0 top-1 rotate-[-8deg]">사건 종결</CaseStamp>
        <p className="m-0 text-[14px] font-bold text-[#e58a9b]">나의 칭호</p>
        <h2
          id={headingId}
          data-testid="review-title"
          className="m-0 mt-1 font-dashSerif text-[40px] font-black leading-[1.1] tracking-[-0.02em] text-white"
        >
          {result.title}
        </h2>
        {early ? <p className="m-0 mt-2 text-[15px] text-[#d8cfca]">{early}</p> : null}
        <dl className="m-0 mt-4 grid grid-cols-2 gap-2">
          {hypothesis.total > 0 ? (
            <Stat label="적중한 가설" value={hypothesis.hit} total={hypothesis.total} />
          ) : null}
          {clue.total > 0 ? (
            <Stat label="짚은 핵심 단서" value={clue.key} total={clue.total} />
          ) : null}
        </dl>
        {result.excluded_count > 0 ? (
          <p className="m-0 mt-2.5 text-[13px] text-[#b5aaa6]">
            결말 뒤에 쓰거나 고친 노트 {result.excluded_count}개는 빠졌어요
          </p>
        ) : null}
      </section>

      <AmoSays>채점을 마쳤어요. 노트마다 제 판정과 이유를 남겼어요.</AmoSays>

      <section
        aria-labelledby={`${headingId}-truth`}
        className="rounded-[18px] border-l-[3px] border-[#c4475f] bg-[#1e1618] px-4 py-4"
      >
        <h3 id={`${headingId}-truth`} className="m-0 font-dashSerif text-[18px] font-bold">
          사건의 진상
        </h3>
        <p className="m-0 mt-2 whitespace-pre-wrap break-keep text-[15px] leading-[1.75] text-[#ece6e0]">
          {result.truth_summary}
        </p>
        {result.reveal_page !== null ? (
          <p className="m-0 mt-2.5 text-[13px] tabular-nums text-[#b5aaa6]">
            {result.reveal_page}쪽에서 밝혀져요
          </p>
        ) : null}
      </section>

      <section aria-labelledby={`${headingId}-notes`}>
        <h3 id={`${headingId}-notes`} className="m-0 font-dashSerif text-[18px] font-bold">
          노트별 채점
        </h3>
        <ul className="m-0 mt-3 grid list-none gap-2 p-0" data-testid="review-notes">
          {result.notes.map((note) => (
            <li
              key={note.note_id}
              className={`relative overflow-hidden rounded-[14px] bg-[#1e1618] py-3 pl-4 pr-3.5 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] ${VERDICT_BAR[note.verdict]}`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#b5aaa6]">
                <span
                  className={`rounded-[6px] border px-1.5 font-extrabold leading-[1.7] ${VERDICT_TONE[note.verdict]}`}
                >
                  {VERDICT_LABEL[note.verdict]}
                </span>
                <span className="tabular-nums">
                  {KIND_LABEL[note.kind]}
                  {note.chosen_as_hypothesis ? '(고른 메모)' : ''} · {note.page_no}쪽에서 씀
                </span>
              </div>
              <p
                data-no-track
                className="m-0 mt-1.5 whitespace-pre-wrap break-words text-[15px] font-medium leading-[1.55]"
              >
                {note.body}
              </p>
              {note.explanation ? (
                <p className="m-0 mt-1 break-keep text-[14px] leading-[1.55] text-[#d8cfca]">
                  {note.explanation}
                </p>
              ) : null}
              {note.evidence_page !== null ? (
                <p className="m-0 mt-1 text-[13px] tabular-nums text-[#b5aaa6]">
                  근거 {note.evidence_page}쪽
                </p>
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
        className="flex flex-col gap-3 rounded-[18px] bg-[#160f11] p-4"
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
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-[20px] border border-[#35292c] bg-[#160f11] p-4"
      data-testid="review-share"
    >
      <h3 id={`${id}-title`} className="m-0 font-dashSerif text-[18px] font-bold">
        결과지 공유하기
      </h3>
      <p className="m-0 mt-1 text-[14px] leading-[1.55] text-[#b5aaa6] [text-wrap:pretty]">
        칭호·개수와 고른 노트만 완독자 커뮤니티에 올라가요. 사건의 진상 요약은 올라가지 않아요.
      </p>
      {judged.length > 0 ? (
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {judged.map((note) => (
            <li key={note.note_id}>
              <CheckRow
                checked={picked.has(note.note_id)}
                onChange={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(note.note_id)) next.delete(note.note_id);
                    else next.add(note.note_id);
                    return next;
                  })
                }
                meta={`${VERDICT_LABEL[note.verdict]} · ${KIND_LABEL[note.kind]} · ${note.page_no}쪽`}
                body={note.body}
              />
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
        aria-busy={sharing}
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
