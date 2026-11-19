import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { safeNextPath } from '../utils/authRedirect';
import BookCarousel3D from '../mobile/components/BookCarousel3D';
import MobileBriefingView from '../mobile/components/MobileBriefingView';
import MobileReaderView from '../mobile/components/MobileReaderView';
import EdgeHandle from '../mobile/components/EdgeHandle';
import MobileSsabiSheet from '../mobile/components/MobileSsabiSheet';
import QuoteAskButton from '../mobile/components/QuoteAskButton';
import SsabiPanel from '../components/Ssabi/SsabiPanel';
import SsabiToggleButton from '../components/common/SsabiToggleButton';
import { useVisualViewport } from '../mobile/useVisualViewport';
import type { QuoteSelectionPopover } from '../hooks/useQuoteSelection';
import type { ChatbotConversationTurn, NoteDraft, ReadingNote } from '../types';
import { markOnboarded } from '../services/onboardingService';
import GuideCoach from './GuideCoach';
import { GUIDE_STEPS } from './guideSteps';
import {
  DEMO_AMO_ANSWER,
  DEMO_AUTHOR,
  DEMO_BRIEFING,
  DEMO_CHAPTERS,
  DEMO_CHARACTER_NAMES,
  DEMO_CLUE,
  DEMO_CLUE_PAGE,
  DEMO_COVER,
  DEMO_GRAPH,
  DEMO_PAGES,
  DEMO_QUESTION,
  DEMO_SHOWCASE,
  DEMO_START_PAGE,
  DEMO_TIMELINE,
  DEMO_TITLE,
  DEMO_TOTAL_PAGES,
  DEMO_NEIGHBORS,
} from './demoBook';

type Screen = 'home' | 'briefing' | 'reader';

const HEADER_HEIGHT = 56;
const noop = () => {};
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

/**
 * 첫 이용 가이드 — 데모 책 한 권으로 홈 → 브리핑 → 읽기 → 사이드 탭 네 도구를 지나간다
 * (2026-11-18 대표 지시: "단순 텍스트가 아닌 실제 클릭해보며").
 *
 * 2026-11-19 대표 지시 — 8단계로 다시 짰다(docs/context/guide-redesign-2026-11-19.md 2장).
 * 한 단계 = 한 기능 설명 + 누르기 최대 1번. 노트 저장·질문 보내기·사이드 탭 열기는 가이드가
 * 데모 상태만 바꿔 대신하고, 끝 페이지(N+1)와 완독자 커뮤니티는 마무리 카드 설명으로 대신한다
 * (대표 결정 2026-11-19 — 데모 책은 끝 페이지를 열지 않고 서버도 부르지 않는다).
 *
 * 화면은 실제 컴포넌트(입체 책·브리핑·읽기 화면·싸비 패널)에 데모 데이터를 넣어 그린다.
 * 모든 상태는 이 컴포넌트 안에만 있다 — 진도·노트·챗봇·리캡 API를 부르지 않는다.
 * 그래서 가이드를 몇 번 해도 실제 독자의 기준점·노트·대화에 아무것도 남지 않는다
 * (절대 규칙 1·8번 — 기준점을 보내는 경로 자체가 없다, FR-SPL-002 🚦).
 * 서버에 가는 요청은 끝·건너뛰기 때의 가이드 완료 표시(markOnboarded) 하나뿐이다.
 */
export default function GuidePage() {
  const navigate = useNavigate();
  // 대표 지시 2026-11-18 — 작품을 열려다 가입했으면 안내를 마친 뒤 그 작품으로 이어 간다
  const { state } = useLocation();
  const next = safeNextPath((state as { next?: string } | null)?.next);
  const viewport = useVisualViewport();
  const [stepAt, setStepAt] = useState(0);
  const [screen, setScreen] = useState<Screen>('home');
  const [page, setPage] = useState(DEMO_START_PAGE);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notes, setNotes] = useState<ReadingNote[]>([]);
  const [chatTurns, setChatTurns] = useState<ChatbotConversationTurn[]>([]);
  const [popover, setPopover] = useState<QuoteSelectionPopover | null>(null);
  const finished = useRef(false);

  const step = GUIDE_STEPS[stepAt];
  const progress = { page };

  // 사이드 탭은 가이드가 대신 연다 — 단계마다 정해 둔 탭이 있으면 열고, 없으면 닫는다
  useEffect(() => {
    setPanelOpen(Boolean(step.tab));
  }, [step.tab]);

  // 3단계: 실제 읽기 화면에서 문장을 길게 눌러 고른 모습 그대로 — 단서 문장을 표시하고
  // "물어보기 · 노트에 적기" 버튼을 그 문장 아래에 띄워 둔다
  useLayoutEffect(() => {
    if (step.id !== 'pick-sentence') {
      setPopover(null);
      return;
    }
    const mark = document.querySelector('[data-testid="guide-reader"] [data-testid="swipe-surface"] mark');
    const r = mark?.getBoundingClientRect();
    setPopover({ text: DEMO_CLUE, top: r?.top ?? 200, bottom: r?.bottom ?? 240, right: r?.right ?? 0 });
  }, [step.id]);

  const advance = useCallback(() => setStepAt((at) => Math.min(at + 1, GUIDE_STEPS.length - 1)), []);

  /**
   * 말풍선의 "다음" (대표 지시 2026-11-19).
   * tap 단계는 비춘 곳을 누른 것과 같은 동작이다 — 비춘 요소에 click 을 보내면 그 요소의 원래
   * 동작(책 열기·이어서 읽기·노트에 적기)과 코치의 단계 넘김이 같이 일어난다.
   * try·look 단계(사이드 탭 네 도구)는 둘러보기만 하고 바로 다음 단계로 간다.
   * 데모 상태만 바뀐다 — 실제 진도 API 는 부르지 않는다(FR-SPL-002 🚦, 절대 규칙 8번).
   */
  function goNext() {
    if (step.final) return;
    if ((step.mode ?? 'tap') !== 'tap') {
      advance();
      return;
    }
    const el = step.target();
    if (!el) return;
    if (el instanceof HTMLElement) el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  async function finish() {
    if (finished.current) return;
    finished.current = true;
    await markOnboarded();
    navigate(next, { replace: true });
  }

  const addNote = async (draft: NoteDraft) => {
    const now = new Date().toISOString();
    setNotes((prev) => [
      ...prev,
      {
        note_id: `guide-note-${prev.length + 1}`,
        page_no: draft.page_no,
        kind: draft.kind,
        resolved: draft.resolved ?? false,
        body: draft.body,
        created_at: now,
        updated_at: now,
      },
    ]);
    return true;
  };

  const editNote = async (noteId: string, draft: Partial<NoteDraft>) => {
    setNotes((prev) => prev.map((note) => (note.note_id === noteId ? { ...note, ...draft } : note)));
    return true;
  };

  const removeNote = async (noteId: string) => {
    setNotes((prev) => prev.filter((note) => note.note_id !== noteId));
    return true;
  };

  /** 아모에게 묻기 — 서버를 부르지 않고 데모용으로 미리 쓴 답을 바로 보여 준다 (대표 지시 2026-11-19) */
  function ask(query: string) {
    // 휴대폰 키보드를 내려 답이 가려지지 않게 한다
    (document.activeElement as HTMLElement | null)?.blur?.();
    setChatTurns((prev) => [...prev, { role: 'user', text: query }, { role: 'assistant', text: DEMO_AMO_ANSWER }]);
  }

  /**
   * 비춘 곳을 눌렀을 때. tap 단계는 다음 단계로 간다(요소 자신의 동작은 이미 일어났다).
   * try 단계는 그 자리에 머문다 — 7단계 추천 질문만 가이드가 대신 보내고 답을 보여 준다.
   */
  function onTargetTap() {
    if ((step.mode ?? 'tap') === 'tap') {
      advance();
      return;
    }
    if (step.id === 'ask-amo') ask(DEMO_QUESTION);
  }

  /** 3단계 "노트에 적기" — 노트 창 없이 가이드가 바로 저장하고 사이드 탭(추리 노트)을 연다 */
  function saveClueNote() {
    void addNote({ page_no: DEMO_CLUE_PAGE, kind: 'clue', body: DEMO_CLUE });
    setPanelOpen(true);
  }

  let body;
  if (screen === 'home') {
    body = (
      <div
        data-testid="guide-home"
        className="flex min-h-[100dvh] flex-col overflow-x-clip text-dash-ink"
        style={{
          background: 'radial-gradient(120% 70% at 50% 38%, #26262a 0%, #141416 45%, #050505 100%)',
          paddingTop: 'var(--safe-top)',
        }}
      >
        <h1 className="sr-only">이용 가이드</h1>
        {/* 실제 홈과 같은 머리 줄 — 왼쪽 위 명조 RE:ADD (대표 지시 2026-11-19) */}
        <div className="flex min-h-11 items-center justify-between px-5 pt-3">
          <span className="font-dashSerif text-[21px] font-bold tracking-[0.02em] text-white">RE:ADD</span>
        </div>
        <div className="flex flex-1 flex-col justify-center">
          <BookCarousel3D
            books={[DEMO_SHOWCASE]}
            index={0}
            onChange={noop}
            onOpen={() => setScreen('briefing')}
          />
          <div className="px-4">
            <div className="text-center text-xs tracking-[0.02em] text-dash-muted">
              <b className="mb-1 block text-[26px] font-extrabold leading-[1.2] tracking-[-0.02em] text-white">
                {DEMO_SHOWCASE.title}
              </b>
              {`${DEMO_SHOWCASE.author} · ${DEMO_SHOWCASE.meta}`}
            </div>
            <div className="mt-2 text-center font-hand text-[#e9e2d3]">
              {DEMO_SHOWCASE.hook.map((line, i) => (
                <span
                  key={line}
                  className={`block whitespace-nowrap ${i === 2 ? 'text-[29px] leading-[1.25] text-white' : 'text-[24px] leading-[1.25]'}`}
                >
                  {line}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="pb-7 pt-4" style={{ paddingBottom: 'calc(28px + var(--safe-bottom))' }}>
          <p className="mx-5 flex min-h-[50px] items-center justify-center rounded-full border border-white/15 bg-white/[0.07] text-base font-semibold text-[#e8e8ed]">
            작품 보기
          </p>
        </div>
      </div>
    );
  } else if (screen === 'briefing') {
    body = (
      <MobileBriefingView
        briefing={DEMO_BRIEFING}
        chapters={DEMO_CHAPTERS}
        title={DEMO_TITLE}
        author={DEMO_AUTHOR}
        coverUrl={DEMO_COVER}
        onContinue={() => {
          setPage(DEMO_START_PAGE);
          setScreen('reader');
        }}
        onRequestFallback={noop}
        onBack={noop}
        onSelectChapter={noop}
        streamedRecap=""
        recapFailed={false}
        recapStreaming={false}
        characterNames={DEMO_CHARACTER_NAMES}
        notes={[]}
        lastReadAt={TWO_DAYS_AGO}
      />
    );
  } else if (screen === 'reader') {
    const clueShown = page === DEMO_CLUE_PAGE && step.id === 'pick-sentence';
    body = (
      <div data-testid="guide-reader" data-mobile="true" className="relative h-[100dvh] overflow-hidden bg-brief-page">
        <div className="absolute inset-0">
          <MobileReaderView
            content={DEMO_PAGES[page]}
            currentPage={page}
            totalPages={DEMO_TOTAL_PAGES}
            prevPage={DEMO_NEIGHBORS[page]?.prev ?? null}
            nextPage={DEMO_NEIGHBORS[page]?.next ?? null}
            onMove={setPage}
            highlightedQuote={clueShown ? DEMO_CLUE : null}
            chapterStart={DEMO_CHAPTERS.find((chapter) => chapter.start_page === page) ?? null}
            swipeDisabled={panelOpen}
            onQuote={noop}
            onNote={noop}
            insetTop={`calc(var(--safe-top) + ${HEADER_HEIGHT}px)`}
          />
        </div>
        <div
          className="absolute inset-x-0 top-0 z-[5] border-[#272623]/15 bg-[#fdfdfa] text-[#272623]"
          style={{ paddingTop: 'var(--safe-top)' }}
        >
          <header className="flex h-14 items-center border-b border-inherit px-2">
            <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full border border-inherit">
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.5 4.8 6.5 8 9.5 11.2" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 truncate px-3 text-center font-dashSans text-[13px] font-semibold">
              {DEMO_TITLE}
            </span>
            <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full border border-inherit font-dashSerif text-[15px] font-bold">
              가
            </span>
          </header>
        </div>
        <EdgeHandle side="left" label="목차" controls="guide-toc" open={false} onToggle={noop} hidden={panelOpen} />
        <EdgeHandle
          side="right"
          label="사이드 탭"
          controls="ssabi-panel"
          open={panelOpen}
          onToggle={noop}
          hidden={panelOpen || viewport.keyboardOpen}
        />
        {popover ? (
          <QuoteAskButton
            popover={popover}
            limitBottom={window.innerHeight - 60}
            onAsk={noop}
            onNote={saveClueNote}
          />
        ) : null}
        <MobileSsabiSheet open={panelOpen} height={viewport.height} offsetTop={viewport.offsetTop} keyboardOpen={viewport.keyboardOpen}>
          {viewport.keyboardOpen ? null : (
            <div className="absolute right-6 z-10" style={{ top: 'calc(var(--safe-top) + 16px)' }}>
              <SsabiToggleButton open={panelOpen} onToggle={noop} />
            </div>
          )}
          <SsabiPanel
            // 단계마다 가이드가 정한 탭으로 연다 — 탭이 바뀌면 새로 그려 그 탭에서 시작한다
            key={step.tab ?? 'none'}
            initialTab={step.tab ?? null}
            initialTabEpoch={1}
            bookTitle={DEMO_TITLE}
            sessionEpoch={1}
            onTabChange={noop}
            graph={DEMO_GRAPH}
            graphFailed={false}
            timeline={DEMO_TIMELINE}
            timelineFailed={false}
            totalPages={DEMO_TOTAL_PAGES}
            notes={notes}
            notesFailed={false}
            currentPage={page}
            onAddNote={addNote}
            onEditNote={editNote}
            onRemoveNote={removeNote}
            onJumpToNote={(to) => {
              setPage(to);
              setPanelOpen(false);
            }}
            chatTurns={chatTurns}
            chatStreaming={false}
            chatError={null}
            chatConversations={[]}
            chatHistoryOpen={false}
            pendingQuote={null}
            onAsk={ask}
            onNewChat={noop}
            onToggleChatHistory={noop}
            onSelectChatConversation={noop}
            compactHeader={viewport.keyboardOpen}
            requireTextToSend
          />
        </MobileSsabiSheet>
      </div>
    );
  }

  return (
    <div data-testid="guide-page" data-step={step.id}>
      {body}
      <GuideCoach
        step={step}
        index={stepAt}
        total={GUIDE_STEPS.length}
        progress={progress}
        onTargetTap={onTargetTap}
        onNext={goNext}
        onSkip={() => void finish()}
        onFinish={() => void finish()}
      />
    </div>
  );
}
