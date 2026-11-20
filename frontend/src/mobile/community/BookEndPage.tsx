import { useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Link } from 'react-router';
import BookCover from '../../components/common/BookCover';
import { useCatalog } from '../../hooks/useCatalog';
import { useModalLayer } from '../../hooks/useModalLayer';
import { classifyCommunityError, createCommunityPost, deleteCommunityPost } from '../../services/communityService';
import { APP_ROUTES, bookPath } from '../../utils/routes';
import { useSwipePager } from '../gestures/useSwipePager';
import { CaseStamp } from '../components/CaseMotifs';

const MAX_REVIEW_LENGTH = 2000;
const OTHER_BOOKS = 3;

/**
 * 책 끝 페이지 — 마지막 쪽(N) 다음의 N+1쪽 (대표 결정 2026-11-19 "책 끝 페이지와 커뮤니티 관문 없애기").
 *
 * 화면에만 있는 페이지다. 서버의 쪽 수·기준점·진도는 그대로 두고, 이 페이지로 오가는 동안
 * 진도 이벤트를 하나도 보내지 않는다 (절대 규칙 2·8·9, FR-PRG-003 🚦). 표시용 "N+1 / N+1"은
 * 서버가 준 전체 쪽 수에 1을 더한 글자일 뿐 기준점·% 계산이 아니다.
 * 이 화면은 완독 여부를 판별하지 않는다. 커뮤니티 관문은 서버가 정한다 — 끝까지 간 독자(저장된 가장 먼 쪽 =
 * 마지막 쪽)만 들어간다 (대표 결정 2026-11-19 정정, 차례 읽기는 따지지 않음). 이 화면에 온 독자는 마지막 쪽을
 * 펼쳤으므로, 리뷰 남기기·커뮤니티 이동 전에 마지막 쪽 진도 이벤트가 저장되기를 기다린다(flushProgress).
 * 목차로 건너뛰어 그 이벤트가 아직 가는 중이어도 403으로 막히지 않게 한다.
 *
 * 한 줄 리뷰는 커뮤니티 댓글 쓰기 API로 올린다(T19 — 말머리 없음). 고치기 API는 없고(삭제만)
 * 지우기만 둔다. 휴대폰은 화면 전체, PC 는 같은 화면을 가운데 단으로 그린다.
 */
// COMMUNITY FR-PRG-003 🚦
export default function BookEndPage({
  bookId,
  bookTitle,
  totalPages,
  returnFocusRef,
  onBack,
  onCommunity,
  flushProgress,
}: {
  bookId: string;
  bookTitle: string;
  /** 서버가 준 전체 쪽 수(N). 끝 페이지 표시는 N+1 */
  totalPages: number;
  returnFocusRef: RefObject<HTMLElement | null>;
  /** N쪽으로 돌아간다 — 이전 페이지·닫기·Esc·오른쪽 밀기 */
  onBack: () => void;
  onCommunity: () => void;
  /** 마지막 쪽 진도 이벤트가 서버에 저장될 때까지 기다린다 (useReadingSession.flushProgress) */
  flushProgress?: () => Promise<void>;
}) {
  const titleId = useId();
  const reviewId = useId();
  const pageRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  useModalLayer({ active: true, dialogRef: pageRef, returnFocusRef, initialFocusRef: primaryRef, onClose: onBack });

  const { books } = useCatalog();
  const book = books.find((item) => item.book_id === bookId);
  const title = book?.title || bookTitle;
  const author = book?.author ?? '';
  // R12 🚦 — 공개(싸비 완비) 도서만 권한다. 지금 책은 뺀다
  const others = books.filter((item) => item.book_id !== bookId && item.ssabi_ready === true).slice(0, OTHER_BOOKS);

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ postId: string; body: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canSave = draft.trim().length > 0 && !saving;
  const [leaving, setLeaving] = useState(false);

  /** 진도 저장을 기다린다. 실패해도 막지 않는다 — 막을지는 서버 관문이 정한다 */
  async function flush() {
    await flushProgress?.().catch(() => undefined);
  }

  async function goCommunity() {
    if (leaving) return;
    setLeaving(true);
    await flush();
    onCommunity();
  }

  async function save() {
    if (!canSave) return;
    const body = draft.trim();
    setSaving(true);
    setNotice(null);
    try {
      await flush();
      let post;
      try {
        post = await createCommunityPost(bookId, body);
      } catch (cause) {
        // 진도 저장보다 글이 먼저 닿았을 수 있다 — 한 번만 다시 기다렸다가 다시 올린다
        if (classifyCommunityError(cause) !== 'locked') throw cause;
        await flush();
        post = await createCommunityPost(bookId, body);
      }
      setSaved({ postId: post.post_id, body: post.body });
      setDraft('');
    } catch (cause) {
      setNotice(
        classifyCommunityError(cause) === 'rate_limited'
          ? '글은 1시간에 10개까지 올릴 수 있어요. 잠시 후 다시 시도해 주세요.'
          : '리뷰를 남기지 못했어요. 잠시 후 다시 시도해 주세요.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!saved || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      await deleteCommunityPost(bookId, saved.postId);
      setSaved(null);
    } catch {
      setNotice('리뷰를 지우지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  }

  // FR-PRG-001 — 오른쪽으로 밀면 N쪽으로 돌아간다. 다음 쪽은 없다
  const { targetRef, bind } = useSwipePager<HTMLDivElement>({
    hasPrev: true,
    hasNext: false,
    onPrev: onBack,
    onNext: () => undefined,
    disabled: false,
  });

  const endPageNo = totalPages + 1;

  return (
    <div
      ref={pageRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="book-end-page"
      className="fixed inset-0 z-[70] flex flex-col bg-[#0d0a0b] font-dashSans text-[#ece6e0] outline-none"
      style={{
        paddingTop: 'var(--safe-top)',
        background: 'radial-gradient(110% 50% at 50% 12%, #3a1620 0%, #1a0f12 42%, #0d0a0b 100%)',
      }}
      onKeyDown={(event) => {
        // 키보드로도 이전 쪽으로 — 글을 쓰는 중이면 글자 이동에 양보한다
        if (event.key !== 'ArrowLeft') return;
        if ((event.target as HTMLElement).closest?.('textarea, input')) return;
        event.preventDefault();
        onBack();
      }}
    >
      <div className="flex shrink-0 justify-end px-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="닫기"
          data-track="end-page-close"
          className="flex size-11 items-center justify-center rounded-full text-[#ece6e0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div
        ref={targetRef}
        data-testid="end-page-surface"
        className="brief-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        style={{ touchAction: 'pan-y' }}
        {...bind}
      >
        <div className="mx-auto flex w-full max-w-[460px] flex-col px-5 pb-8">
          <header className="flex flex-col items-center pt-2 text-center">
            <div className="relative">
              <div className="w-[84px] rotate-[-3deg] shadow-[0_14px_32px_rgba(0,0,0,0.55)]">
                <BookCover book={{ book_id: bookId, title, author, cover_url: book?.cover_url ?? '' }} size="row" />
              </div>
              <CaseStamp className="absolute -bottom-3 -right-10 rotate-[-12deg] bg-[#0d0a0b]/85 backdrop-blur-[1px]">
                사건 종결
              </CaseStamp>
            </div>
            <h2 id={titleId} className="m-0 mt-8 break-keep font-dashSerif text-[28px] font-bold leading-[1.25] text-white">
              끝까지 읽었어요
            </h2>
            <p className="m-0 mt-2 break-keep font-dashSerif text-[16px] text-[#d8cfca]">
              「{title}」{author ? ` · ${author}` : ''}
            </p>
          </header>

          <section
            aria-labelledby={reviewId}
            data-testid="end-page-review"
            className="mt-8 rounded-[16px] border border-[#35292c] bg-[#1e1618] p-4"
          >
            {saved ? (
              <>
                <h3 id={reviewId} className="m-0 font-dashSerif text-[17px] font-bold text-white">
                  내 한 줄 리뷰
                </h3>
                <p data-no-track className="m-0 mt-3 whitespace-pre-wrap break-words text-[16px] leading-[1.6] text-[#ece6e0]">
                  {saved.body}
                </p>
                <p className="m-0 mt-3 text-[15px] text-[#d8cfca]">완독자 커뮤니티 리뷰에 올라갔어요</p>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    data-track="end-page-review-delete"
                    disabled={saving}
                    onClick={() => void remove()}
                    className="min-h-11 rounded-full border border-[#35292c] px-5 text-[15px] font-bold text-[#ece6e0] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
                  >
                    지우기
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 id={reviewId} className="m-0 font-dashSerif text-[17px] font-bold text-white">
                  <label htmlFor={`${reviewId}-field`}>한 줄 리뷰</label>
                </h3>
                <textarea
                  id={`${reviewId}-field`}
                  data-no-track
                  value={draft}
                  maxLength={MAX_REVIEW_LENGTH}
                  rows={2}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="이 책을 한 줄로 남겨 보세요"
                  className="mt-3 block w-full resize-none rounded-[12px] border border-[#35292c] bg-[#0d0a0b] px-3.5 py-3 text-[16px] leading-[1.55] text-[#ece6e0] placeholder:text-[#8f8480] focus:border-[#c4475f] focus:outline-none"
                />
                <div className="mt-3 flex items-center gap-3">
                  <p className="m-0 min-w-0 flex-1 break-keep text-[15px] text-[#d8cfca]">완독자 커뮤니티 리뷰에 올라가요</p>
                  <button
                    type="button"
                    data-track="end-page-review-save"
                    disabled={!canSave}
                    onClick={() => void save()}
                    className="min-h-11 shrink-0 rounded-full bg-[#8f1d35] px-5 text-[15px] font-bold text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
                  >
                    남기기
                  </button>
                </div>
              </>
            )}
            {notice ? (
              <p role="alert" className="m-0 mt-3 text-[15px] text-[#e58a9b]">
                {notice}
              </p>
            ) : null}
          </section>

          <button
            ref={primaryRef}
            type="button"
            data-track="end-page-community"
            disabled={leaving}
            onClick={() => void goCommunity()}
            className="mt-5 h-[52px] w-full rounded-full bg-[#8f1d35] text-[16px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0a0b]"
          >
            완독자 커뮤니티로 이동하기
          </button>

          {others.length > 0 ? (
            <section aria-labelledby={`${titleId}-others`} data-testid="end-page-others" className="mt-9">
              <div className="flex items-center justify-between">
                <h3 id={`${titleId}-others`} className="m-0 font-dashSerif text-[17px] font-bold text-white">
                  다른 책 보기
                </h3>
                <Link
                  to={APP_ROUTES.search}
                  data-track="end-page-all-books"
                  className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[15px] font-bold text-[#e58a9b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
                >
                  전체 보기
                  <span aria-hidden="true" className="text-[17px] font-semibold">
                    ›
                  </span>
                </Link>
              </div>
              <ul className="m-0 mt-3 grid list-none grid-cols-3 gap-3 p-0">
                {others.map((other) => (
                  <li key={other.book_id}>
                    <Link
                      to={bookPath(other.book_id)}
                      data-track="end-page-other-book"
                      className="block rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
                    >
                      <BookCover book={other} size="grid" />
                      <span className="mt-2 block truncate font-dashSerif text-[15px] font-bold text-[#ece6e0]">{other.title}</span>
                      <span className="block truncate text-[13px] text-[#bfb3ae]">{other.author}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      <nav
        aria-label="쪽 이동"
        className="flex shrink-0 items-center justify-between border-t border-[#35292c] bg-[#0d0a0b] px-3 pt-1 text-[14px] text-[#bfb3ae]"
        style={{ paddingBottom: 'max(4px, var(--safe-bottom))' }}
      >
        <button type="button" onClick={onBack} className="min-h-11 min-w-11 px-2 text-[#ece6e0]">
          이전 페이지
        </button>
        <span data-testid="end-page-indicator" className="font-dashMono text-[16px] font-medium text-[#ece6e0]">
          {endPageNo} <span className="text-[14px] text-[#bfb3ae]">/ {endPageNo}</span>
        </span>
        <button type="button" disabled className="min-h-11 min-w-11 px-2 disabled:opacity-40">
          다음 페이지
        </button>
      </nav>
    </div>
  );
}
