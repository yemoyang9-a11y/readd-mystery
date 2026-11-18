import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { CaseLabel } from '../mobile/components/CaseMotifs';
import { GUIDE_STEPS } from './guideSteps';
import {
  DEMO_AMO_ANSWER,
  DEMO_AUTHOR,
  DEMO_BRIEFING,
  DEMO_CHAPTERS,
  DEMO_CHARACTER_NAMES,
  DEMO_CLUE,
  DEMO_CLUE_PAGE,
  DEMO_COMMUNITY_POSTS,
  DEMO_COVER,
  DEMO_GRAPH,
  DEMO_PAGES,
  DEMO_SHOWCASE,
  DEMO_START_PAGE,
  DEMO_TIMELINE,
  DEMO_TITLE,
  DEMO_TOTAL_PAGES,
  DEMO_NEIGHBORS,
} from './demoBook';

type Screen = 'home' | 'briefing' | 'reader' | 'community';

const HEADER_HEIGHT = 56;
const ANSWER_DELAY_MS = 450;
const noop = () => {};
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

/**
 * 첫 이용 가이드 — 데모 책 한 권으로 홈 → 브리핑 → 읽기 → 싸비 → 완독 → 커뮤니티를
 * 직접 눌러 보며 지나간다 (2026-11-18 대표 지시: "단순 텍스트가 아닌 실제 클릭해보며").
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
  const [noteQuote, setNoteQuote] = useState<{ text: string; token: number } | null>(null);
  const [chatTurns, setChatTurns] = useState<ChatbotConversationTurn[]>([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [popover, setPopover] = useState<QuoteSelectionPopover | null>(null);
  const finished = useRef(false);
  const answerTimer = useRef<number | null>(null);

  const step = GUIDE_STEPS[stepAt];
  const progress = { page };

  useEffect(() => () => {
    if (answerTimer.current !== null) window.clearTimeout(answerTimer.current);
  }, []);

  // 여러 번 누르는 단계(끝까지 읽기)는 상태가 조건을 채우면 넘어간다
  useEffect(() => {
    if (step.doneWhen?.(progress)) setStepAt((at) => Math.min(at + 1, GUIDE_STEPS.length - 1));
  });

  // 단서 문장을 누른 뒤에는 실제 읽기 화면처럼 "물어보기 · 노트에 적기" 버튼을 그 문장 아래에 띄운다
  useLayoutEffect(() => {
    if (step.id !== 'note-clue') {
      setPopover(null);
      return;
    }
    const mark = document.querySelector('[data-testid="guide-reader"] [data-testid="swipe-surface"] mark');
    const r = mark?.getBoundingClientRect();
    setPopover({ text: DEMO_CLUE, top: r?.top ?? 200, bottom: r?.bottom ?? 240, right: r?.right ?? 0 });
  }, [step.id]);

  const advance = useCallback(() => setStepAt((at) => Math.min(at + 1, GUIDE_STEPS.length - 1)), []);

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

  function ask(query: string) {
    // 휴대폰 키보드를 내려 싸비 닫기 버튼이 다시 보이게 한다
    (document.activeElement as HTMLElement | null)?.blur?.();
    setChatTurns((prev) => [...prev, { role: 'user', text: query }]);
    setChatStreaming(true);
    answerTimer.current = window.setTimeout(() => {
      setChatTurns((prev) => [...prev, { role: 'assistant', text: DEMO_AMO_ANSWER }]);
      setChatStreaming(false);
    }, ANSWER_DELAY_MS);
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
        <div className="flex items-center justify-between px-5 pt-3">
          <span className="font-dashSans text-[17px] font-bold tracking-[0.04em]">RE:ADD</span>
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
    const clueShown = page === DEMO_CLUE_PAGE && (step.id === 'pick-clue' || step.id === 'note-clue');
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
            onOpenCommunity={() => setScreen('community')}
            onBack={noop}
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
          label="싸비"
          controls="ssabi-panel"
          open={panelOpen}
          onToggle={() => setPanelOpen((open) => !open)}
          hidden={panelOpen || viewport.keyboardOpen}
        />
        {popover ? (
          <QuoteAskButton
            popover={popover}
            limitBottom={window.innerHeight - 60}
            onAsk={noop}
            onNote={() => {
              setNoteQuote((prev) => ({ text: DEMO_CLUE, token: (prev?.token ?? 0) + 1 }));
              setPanelOpen(true);
            }}
          />
        ) : null}
        <MobileSsabiSheet open={panelOpen} height={viewport.height} offsetTop={viewport.offsetTop} keyboardOpen={viewport.keyboardOpen}>
          {viewport.keyboardOpen ? null : (
            <div className="absolute right-6 z-10" style={{ top: 'calc(var(--safe-top) + 16px)' }}>
              <SsabiToggleButton open={panelOpen} onToggle={() => setPanelOpen((open) => !open)} />
            </div>
          )}
          <SsabiPanel
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
            onJumpToNote={() => setPanelOpen(false)}
            chatTurns={chatTurns}
            chatStreaming={chatStreaming}
            chatError={null}
            chatConversations={[]}
            chatHistoryOpen={false}
            pendingQuote={null}
            onAsk={ask}
            onNewChat={noop}
            onToggleChatHistory={noop}
            onSelectChatConversation={noop}
            pendingNoteQuote={noteQuote}
            onNoteQuoteHandled={() => setNoteQuote(null)}
            compactHeader={viewport.keyboardOpen}
            requireTextToSend
          />
        </MobileSsabiSheet>
      </div>
    );
  } else {
    body = <GuideCommunity />;
  }

  return (
    <div data-testid="guide-page" data-step={step.id}>
      {body}
      <GuideCoach
        step={step}
        index={stepAt}
        total={GUIDE_STEPS.length}
        progress={progress}
        onTargetTap={advance}
        onSkip={() => void finish()}
        onFinish={() => void finish()}
      />
    </div>
  );
}

/** 완독자 커뮤니티 — 데모 글 몇 개만 보여 주는 가벼운 복제 화면(실제 게시판을 부르지 않는다) */
function GuideCommunity() {
  // 실제 완독자 이야기 화면(MobileCommunity)과 같은 모양 — 미스터리 브랜딩 (2026-11-18)
  return (
    <div
      data-testid="guide-community"
      className="min-h-[100dvh] bg-[#0d0a0b] font-dashSans text-[#ece6e0]"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'calc(84px + var(--safe-bottom))' }}
    >
      <header className="flex items-center gap-3 px-4 pb-3 pt-2">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#35292c] bg-[#1e1618]">
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 4.8 6.5 8 9.5 11.2" />
          </svg>
        </span>
        <div className="min-w-0">
          <CaseLabel>Case closed</CaseLabel>
          <h1 className="m-0 mt-0.5 truncate font-dashSerif text-[20px] font-bold leading-tight">{DEMO_TITLE} 완독자 이야기</h1>
        </div>
      </header>
      <div className="flex gap-1.5 px-4 pb-3">
        {['전체', '범인 추리', '감상'].map((label, i) => (
          <span
            key={label}
            className={`flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-[14px] font-bold ${
              i === 0 ? 'border-[#c4475f] bg-[#1e1618] text-[#e58a9b]' : 'border-[#35292c] text-[#a89e9a]'
            }`}
          >
            {label}
          </span>
        ))}
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 px-4">
        {DEMO_COMMUNITY_POSTS.map((post) => (
          <li key={post.id} className="rounded-[14px] border border-[#35292c] bg-[#1e1618] px-4 pt-4 text-[#ece6e0]">
            <span className="flex items-center gap-2">
              <span
                className={`inline-flex h-6 items-center rounded-[4px] border px-2 text-[12px] font-bold tracking-[0.06em] ${
                  post.kind === '범인 추리'
                    ? 'border-[#c4475f]/60 bg-[#2d161d] text-[#e58a9b]'
                    : 'border-[#4a3f41] bg-[#2a2224] text-[#d8cfca]'
                }`}
              >
                {post.kind}
              </span>
              <span className="text-[13px] font-bold">{post.nickname}</span>
            </span>
            <span className="mt-2 block break-words pb-3 text-[15px] leading-[1.65]">{post.body}</span>
            <span className="flex min-h-11 items-center border-t border-[#35292c]/70 text-[13px] font-bold text-[#a89e9a]">
              댓글 {post.comments}
            </span>
          </li>
        ))}
      </ul>
      <div
        className="fixed inset-x-0 bottom-0 z-10 border-t border-[#35292c] bg-[#0d0a0b] px-4 pt-3"
        style={{ paddingBottom: 'max(12px, var(--safe-bottom))' }}
      >
        <span className="flex h-12 w-full items-center justify-center rounded-full bg-[#8f1d35] text-[15px] font-bold text-white">
          글쓰기
        </span>
      </div>
    </div>
  );
}
