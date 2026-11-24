import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import Loading from '../../components/common/Loading';
import { useReadingSession } from '../../hooks/useReadingSession';
import SsabiPanel from '../../components/Ssabi/SsabiPanel';
import SsabiToggleButton from '../../components/common/SsabiToggleButton';
import MobileReaderView, { CHROME_FADE, chromeProps } from '../components/MobileReaderView';
import EdgeHandle from '../components/EdgeHandle';
import MobileSsabiSheet from '../components/MobileSsabiSheet';
import TocList from '../components/TocList';
import MobileErrorState from '../components/MobileErrorState';
import { useVisualViewport } from '../useVisualViewport';
import { useReaderPrefs, type ReaderTheme } from '../../hooks/useReaderPrefs';
import ReaderPrefsSheet from '../../components/Reader/ReaderPrefsSheet';
import MobileJumpBar from '../components/MobileJumpBar';
import TocJumpDialog from '../../components/Reader/TocJumpDialog';
import { useBackToBook } from '../../hooks/useBackToBook';
import { BOOK_ROUTES } from '../../utils/routes';
import BookEndPage from '../community/BookEndPage';

const FOCUS_TOGGLE_CLASS =
  'sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-1/2 focus-visible:top-[calc(var(--safe-top)+6px)] focus-visible:z-[60] focus-visible:-translate-x-1/2 focus-visible:inline-flex focus-visible:min-h-11 focus-visible:items-center focus-visible:whitespace-nowrap focus-visible:rounded-full focus-visible:border focus-visible:border-brief-ink focus-visible:bg-white focus-visible:px-4 focus-visible:font-dashSans focus-visible:text-[13px] focus-visible:font-bold focus-visible:text-brief-ink focus-visible:shadow-brief-soft-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brief-accent focus-visible:ring-offset-2 focus-visible:aria-pressed:bg-brief-accent-soft focus-visible:aria-pressed:text-brief-accent';

const HEADER_HEIGHT = 56;

const BAR_THEME_CLASS: Record<ReaderTheme, string> = {
  paper: 'bg-[#fdfdfa] text-[#272623] border-[#272623]/15',
  sepia: 'bg-[#f4ecd8] text-[#3b3024] border-[#3b3024]/15',
  dark: 'bg-[#1c1b19] text-[#d9d6cf] border-[#d9d6cf]/20',
};

export default function MobileReader() {
  const { bookId = '' } = useParams();
  return <MobileReadingSession key={bookId} />;
}

// FR-PRG-003 🚦 FR-BRF-001
function MobileReadingSession() {
  const { bookId = '' } = useParams();
  const { entryError, retryEntry, page, pageError, retryPage, currentPage, totalPages, chapters, bookTitle, jumpOrigin, returnToOrigin, dismissJumpOrigin, moveTo, flushProgress, requestTocJump, tocJumpConfirm, confirmTocJump, cancelTocJump, highlightedQuote, panelOpen, togglePanel, ssabiPanelProps, quote } =
    useReadingSession(bookId);
  const backToBook = useBackToBook(bookId);
  const navigate = useNavigate();
  const prefsApi = useReaderPrefs();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const prefsButtonRef = useRef<HTMLButtonElement>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [noteQuote, setNoteQuote] = useState<{ text: string; token: number } | null>(null);
  const viewport = useVisualViewport();
  // 대표 결정 2026-11-19 — 마지막 쪽(N) 다음의 끝 페이지(N+1). 화면 상태일 뿐이라 진도 이벤트를
  // 보내지 않고 서버 쪽 수·기준점도 바꾸지 않는다 (절대 규칙 2·8·9, FR-PRG-003 🚦). 커뮤니티 관문은 서버가 저장된 가장 먼 쪽으로 정한다(대표 결정 2026-11-19 정정).
  const onLastPage = page !== null && page.page_no === currentPage && page.next_page === null;
  const [endPageOpen, setEndPageOpen] = useState(false);
  const endPageReturnRef = useRef<HTMLElement | null>(null);
  function openEndPage() {
    endPageReturnRef.current = document.activeElement as HTMLElement | null;
    setEndPageOpen(true);
  }
  const openCommunity = () => navigate(BOOK_ROUTES.community.replace(':bookId', bookId));
  // 대표 결정 2026-11-24 — 책 끝 화면에서 내 추리 채점으로
  const openReview = () => navigate(BOOK_ROUTES.review.replace(':bookId', bookId));

  useEffect(() => {
    if (panelOpen) setTocOpen(false);
  }, [panelOpen]);

  let body: ReactNode;
  if (entryError) {
    body = <MobileErrorState message="읽기를 시작하지 못했습니다" onRetry={retryEntry} />;
  } else if (page && page.page_no === currentPage) {
    body = (
      <MobileReaderView
        content={page.content}
        currentPage={page.page_no}
        totalPages={totalPages}
        prevPage={page.prev_page}
        nextPage={page.next_page}
        onMove={moveTo}
        highlightedQuote={highlightedQuote}
        chapterStart={chapters.find((chapter) => chapter.start_page === page.page_no) ?? null}
        swipeDisabled={panelOpen}
        onQuote={quote}
        onNote={(text) => {
          setNoteQuote((prev) => ({ text, token: (prev?.token ?? 0) + 1 }));
          if (!panelOpen) togglePanel();
        }}
        prefs={prefsApi.prefs}
        insetTop={`calc(var(--safe-top) + ${HEADER_HEIGHT}px)`}
        chromeHidden={chromeHidden}
        canToggleChrome={!panelOpen && !tocOpen && !prefsOpen}
        onToggleChrome={() => setChromeHidden((hidden) => !hidden)}
        onEndPage={onLastPage ? openEndPage : undefined}
      />
    );
  } else if (pageError) {
    body = <MobileErrorState message="페이지를 불러오지 못했습니다" onRetry={retryPage} />;
  } else {
    body = <Loading message={page ? '페이지를 불러오는 중' : '책을 펼치는 중'} />;
  }

  return (
    <div
      data-testid="mobile-reader"
      data-mobile="true"
      className="relative h-[100dvh] overflow-hidden bg-brief-page"
    >
      {/* FR-PRG-001 */}
      <button
        type="button"
        aria-pressed={chromeHidden}
        onClick={() => {
          if (!panelOpen && !tocOpen && !prefsOpen) setChromeHidden((hidden) => !hidden);
        }}
        className={FOCUS_TOGGLE_CLASS}
      >
        본문만 보기
      </button>
      <div className="absolute inset-0">{body}</div>
      <div
        {...chromeProps(chromeHidden)}
        data-reader-theme={prefsApi.prefs.theme}
        className={`absolute inset-x-0 top-0 z-[5] ${BAR_THEME_CLASS[prefsApi.prefs.theme]} ${CHROME_FADE} ${chromeHidden ? 'invisible opacity-0' : ''}`}
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <header
          data-testid="reader-topbar"
          className="flex h-14 shrink-0 items-center border-b border-inherit px-2"
        >
          <button
            type="button"
            // FR-BRW-003
            onClick={backToBook}
            aria-label="뒤로 가기"
            className="flex size-11 items-center justify-center rounded-full border border-inherit bg-transparent transition-shadow hover:shadow-brief-soft-sm"
          >
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
          </button>
          <span className="flex-1" />
          <button
            ref={prefsButtonRef}
            type="button"
            onClick={() => setPrefsOpen((open) => !open)}
            aria-label="보기 설정"
            aria-haspopup="dialog"
            aria-expanded={prefsOpen}
            className="flex size-11 items-center justify-center rounded-full border border-inherit bg-transparent font-dashSerif text-[15px] font-bold transition-shadow hover:shadow-brief-soft-sm"
          >
            <span aria-hidden="true">가</span>
          </button>
        </header>
      </div>
      <MobileJumpBar origin={jumpOrigin} currentPage={currentPage} hidden={chromeHidden} onReturn={returnToOrigin} onDismiss={dismissJumpOrigin} />
      <EdgeHandle side="left" label="목차" controls="toc-panel" open={tocOpen} onToggle={() => setTocOpen((open) => !open)} hidden={panelOpen || chromeHidden} />
      {tocOpen && !panelOpen ? (
        <TocList
          chapters={chapters}
          currentPage={currentPage}
          onSelect={(startPage) => {
            requestTocJump(startPage);
            setTocOpen(false);
          }}
        />
      ) : null}
      <EdgeHandle side="right" label="사이드 탭" controls="ssabi-panel" open={panelOpen} onToggle={togglePanel} hidden={panelOpen || viewport.keyboardOpen || chromeHidden} />
      <MobileSsabiSheet open={panelOpen} height={viewport.height} offsetTop={viewport.offsetTop} keyboardOpen={viewport.keyboardOpen}>
        {viewport.keyboardOpen ? null : (
          <div className="absolute right-6 z-10" style={{ top: 'calc(var(--safe-top) + 16px)' }}>
            <SsabiToggleButton open={panelOpen} onToggle={togglePanel} />
          </div>
        )}
        <SsabiPanel
          key={currentPage}
          {...ssabiPanelProps}
          onJumpToNote={(target) => {
            ssabiPanelProps.onJumpToNote(target);
            togglePanel();
          }}
          pendingNoteQuote={noteQuote}
          onNoteQuoteHandled={() => setNoteQuote(null)}
          compactHeader={viewport.keyboardOpen} requireTextToSend />
      </MobileSsabiSheet>
      {tocJumpConfirm !== null ? (
        <TocJumpDialog
          targetPage={tocJumpConfirm}
          onMoveOnly={() => confirmTocJump('move')}
          onReadThrough={() => confirmTocJump('read_through')}
          onCancel={cancelTocJump}
        />
      ) : null}
      {endPageOpen && onLastPage ? (
        <BookEndPage
          bookId={bookId}
          bookTitle={bookTitle ?? ''}
          totalPages={totalPages}
          returnFocusRef={endPageReturnRef}
          onBack={() => setEndPageOpen(false)}
          onCommunity={openCommunity}
          onReview={openReview}
          flushProgress={flushProgress}
        />
      ) : null}
      {prefsOpen ? (
        <ReaderPrefsSheet
          variant="sheet"
          onClose={() => setPrefsOpen(false)}
          returnFocusRef={prefsButtonRef}
          prefsApi={prefsApi}
        />
      ) : null}
    </div>
  );
}
