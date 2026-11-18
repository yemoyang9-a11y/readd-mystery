import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import type SsabiPanel from '../components/Ssabi/SsabiPanel';
import { fetchBookInfo, fetchPage } from '../services/bookService';
import { confirmFrontier, enterBook, sendProgress } from '../services/progressService';
import { useSsabiData } from './useSsabiData';
import { useHeartbeat } from './useHeartbeat';
import { useNotes } from './useNotes';
import { useChatConversation } from './useChatConversation';
import { nextSeq } from '../utils/seq';
import { takePendingJump } from '../utils/pendingJump';
import { DEFAULT_SSABI_TAB } from '../utils/constants';
import type {
  ChapterSummary,
  EntryResponse,
  FrontierChoice,
  FrontierConfirmPrompt,
  PageResponse,
  ProgressClaim,
  SsabiTab,
} from '../types';

export type TocJumpChoice = 'move' | 'read_through';

export interface ReadingSessionState {
  entryError: boolean;
  retryEntry: () => void;
  page: PageResponse | null;
  pageError: boolean;
  retryPage: () => void;
  currentPage: number | null;
  totalPages: number;
  chapters: ChapterSummary[];
  bookTitle: string | null;
  currentChapter: ChapterSummary | null;
  jumpOrigin: number | null;
  returnToOrigin: () => void;
  dismissJumpOrigin: () => void;
  moveTo: (page: number) => void;
  requestTocJump: (page: number) => void;
  tocJumpConfirm: number | null;
  /** 'move' = 이동만 하기, 'read_through' = 앞부분은 이미 읽었어요 (그 이동 이벤트에 claim) */
  confirmTocJump: (choice: TocJumpChoice) => void;
  cancelTocJump: () => void;
  /** 넘겨 본 쪽 확인 요청 — 서버 응답 그대로. 싸비 카드가 그린다 (ssabiPanelProps 에도 실린다) */
  frontierConfirm: FrontierConfirmPrompt | null;
  /** 확인 카드의 답. 성공하면 true, 실패하면 false 이고 아무것도 바꾸지 않는다 */
  answerFrontierConfirm: (choice: FrontierChoice) => Promise<boolean>;
  panelOpen: boolean;
  togglePanel: () => void;
  highlightedQuote: string | null;
  quote: (text: string) => void;
  ssabiPanelProps: ComponentProps<typeof SsabiPanel>;
}

// FR-PRG-003 🚦 FR-BRF-001 FR-SVB-003
export function useReadingSession(bookId: string): ReadingSessionState {
  /**
   * ⚠️ `location.state.entry`를 시작 페이지로 쓰지 않는다 (2026-08-26, 사용자 제보 —
   * "30페이지에서 F5를 누르면 25페이지로 되돌아간다").
   *
   * React Router v6는 navigate state를 `window.history.state`에 싣고, 브라우저는 그것을
   * 새로고침 후에도 복원한다. 그래서 F5를 하면 "읽기 화면에 처음 들어왔을 때의 page"가
   * 되살아난다 — 언제 만들어진 값인지 알 수 없는 값이다. 예전엔 그 값으로 화면을 그리고
   * (낡은 페이지로 되돌아감) 진도까지 보내서(서버의 올바른 위치를 덮어씀) 두 번 틀렸다.
   *
   * 어디까지 읽었는지의 원천은 서버가 저장한 진도 하나뿐이므로, 진입할 때마다
   * enterBook()으로 물어본다. 이 호출은 서버의 event_seq도 0으로 되돌려(session.service.ts)
   * 새로고침으로 0부터 다시 시작한 로컬 seq와 다시 맞춰 준다 — 그러지 않으면 이후 진도가
   * FR-PRG-002의 "더 새로운 seq만 수용"에 막혀 통째로 버려진다.
   */

  const [page, setPage] = useState<PageResponse | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  /** 목차 (2026-08-25, 사용자 요청) — GET /info가 cutoff 인자 없이 전량 내려준다
   *  (FR-NAV-001, R3 4장). TocPanel이 그대로 그린다. */
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [bookTitle, setBookTitle] = useState<string | null>(null);
  const [infoSettled, setInfoSettled] = useState(false);
  const [tab, setTab] = useState<SsabiTab>(DEFAULT_SSABI_TAB);
  /**
   * 빠르게 여러 번 페이지를 넘기면(직접 입력 포함) fetchPage 요청이 겹쳐 나가고, 응답이
   * 순서대로 안 돌아올 수 있다 — 늦게 도착한 예전 요청이 최신 페이지를 덮어쓰면 본문·
   * 페이지 표시가 실제로 이동한 곳보다 뒤처진다(2026-08-24, 실사용 중 발견 — "Np까지
   * 확인" 배지는 currentPage를 바로 쓰는데 본문 표시는 이 응답에 묶여 있어 서로 어긋나
   * 보였다). 요청을 보낼 때 목표 페이지를 기록해 두고, 응답이 왔을 때 그 사이 더 최신
   * 요청이 나가지 않았을 때만 반영한다.
   */
  const latestRequestedPageRef = useRef<number | null>(null);

  /**
   * 싸비 패널 열림 상태. **기본은 닫힘**이다 — 읽기 화면에 들어오면 본문만 보이고,
   * 사용자가 top-bar 우측 토글을 눌러야 싸비가 열린다 (시안 47:132 "싸비없는 책읽기").
   *
   * 닫을 때는 `<aside>` 째로 언마운트한다. 숨기기만 하면 닫힌 패널의 리캡 탭이 계속 살아 있어
   * 페이지를 넘길 때마다 보이지도 않는 리캡 스트리밍이 나간다 — 아래 리캡 effect 가 선택된
   * 탭만 보고 패널 가시성은 보지 않기 때문이다. 그건 그대로 LLM 재호출이고 분당 3회 상한에
   * 걸린다 (NFR-AI-017).
   *
   * 대가로 닫았다 열면 탭이 기본값으로 돌아갔었다 — 무의미한 조회 차단(이 언마운트 정책)과
   * 탭 기억(2026-08-24, 아래 tabMemory)을 함께 만족시켰다: 조회는 여전히 언마운트로
   * 차단하고, 탭은 Reader가 별도로 기억했다 되돌려주는 방식으로 풀었다.
   */
  const [panelOpen, setPanelOpen] = useState(false);
  const togglePanel = useCallback(() => setPanelOpen((open) => !open), []);

  /**
   * 본문 드래그 선택 → 챗봇 인용. token 은 같은 문장을 연달아 다시 선택해도 SsabiPanel의
   * 탭 강제 전환 effect 가 매번 반응하도록 하는 1회성 신호다 (문자열만 같으면 effect가
   * 재실행되지 않는 문제 방지).
   *
   * 리캡 카드 드래그(2026-08-25)도 같은 핸들러를 쓴다 — ReaderView에는 onQuote로,
   * SsabiPanel에는 onRecapQuote로 똑같이 넘긴다. 소스가 뭐든 결과(pendingQuote)는
   * 동일하게 처리되므로 핸들러를 나눌 이유가 없다.
   */
  const [pendingQuote, setPendingQuote] = useState<{ text: string; token: number } | null>(null);
  const handleQuote = useCallback((text: string) => {
    setPanelOpen(true);
    setPendingQuote((prev) => ({ text, token: (prev?.token ?? 0) + 1 }));
    setHighlightedQuote(text);
  }, []);

  /**
   * 본문 인용 하이라이트 (2026-08-25, 사용자 요청) — "선택한 문장" 카드와 같은 값을
   * 따로 들고 있다가 ReaderView에 내려준다. pendingQuote와 값은 같지만 목적이 다르다 —
   * pendingQuote는 "새 인용이 왔다"는 1회성 신호(token 포함, SsabiPanel 탭 전환용)이고
   * 이건 "지금 강조해야 할 문장이 있는가"라는 상태값이라, 카드가 지워지면(×·새 채팅·
   * 다른 대화 선택 — ChatbotTab의 onQuoteDismissed) 이것만 따로 null로 돌아간다.
   */
  const [highlightedQuote, setHighlightedQuote] = useState<string | null>(null);

  /**
   * 시작 페이지·세션은 **서버 진입 판정**이 정한다 (FR-BRF-001, 절대 규칙 8번).
   * 브리핑을 거쳐 왔으면 그 결과를 그대로 받고, URL 로 바로 들어왔으면 여기서 판정을 받는다.
   * 클라이언트가 1페이지라고 가정하면 그 값으로 진도가 발신되어 기준점이 되감긴다.
   */
  const [session, setSession] = useState<EntryResponse | null>(null);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [previousPage, setPreviousPage] = useState(currentPage);

  /**
   * 선택 문장은 그 문장이 있던 본문 페이지에서만 유효하다. 이전/다음·목차·직접 입력처럼
   * currentPage를 바꾸는 모든 이동 경로가 이 한 상태를 거치므로, 페이지를 떠나는 즉시
   * 챗봇 카드와 본문 강조를 함께 비운다.
   */
  if (previousPage !== currentPage) {
    setPreviousPage(currentPage);
    setPendingQuote(null);
    setHighlightedQuote(null);
  }

  /**
   * 마지막으로 활성이던 싸비 탭 기억 — 어느 session_epoch에서 기록됐는지와 함께 보관한다.
   * 패널을 닫으면 SsabiPanel이 통째로 언마운트되어(위 panelOpen 주석) 그 안의 탭 상태가
   * 사라지므로, 언마운트되지 않는 이 컨테이너가 대신 들고 있다가 재마운트 시 SsabiPanel에
   * 초기값으로 되돌려준다 (2026-08-24, 사용자 요청 — 닫았다 다시 열면 항상 인물 관계도로
   * 리셋되던 것을 마지막 이용 탭 유지로 바꿈). epoch을 함께 저장해 두는 이유는 세션이
   * 바뀐 채로 닫혀 있었으면(FR-SVB-004) 옛 탭 기억을 쓰면 안 되기 때문 — SsabiPanel의
   * resolveSsabiTab이 이 짝을 그대로 보고 sameSession을 판정하므로 별도 분기가 필요 없다.
   */
  const [tabMemory, setTabMemory] = useState<{ tab: SsabiTab; epoch: number } | null>(null);
  const handleTabChange = useCallback(
    (nextTab: SsabiTab) => {
      setTab(nextTab);
      setTabMemory({ tab: nextTab, epoch: session?.session_epoch ?? 0 });
    },
    [session?.session_epoch]
  );

  /**
   * 진입 판정 실패 상태. 실패 시 무한 로딩 대신 재시도 UI를 보여준다 —
   * 크리틱 P0: 이전에는 `.catch` 가 없어 백엔드 장애 시 "불러오는 중"에서 영원히 멈췄다.
   */
  const [entryError, setEntryError] = useState(false);
  const [pageError, setPageError] = useState(false);

  // FR-PRG-003 🚦
  const pendingJumpRef = useRef<{ taken: boolean; page: number | null }>({ taken: false, page: null });
  useEffect(() => {
    if (!pendingJumpRef.current.taken) pendingJumpRef.current = { taken: true, page: takePendingJump(bookId) };
  }, [bookId]);
  const [entryPage, setEntryPage] = useState<number | null>(null);
  const [jumpOrigin, setJumpOrigin] = useState<number | null>(null);
  const entryRequestRef = useRef(0);

  const loadEntry = useCallback(() => {
    setEntryError(false);
    const request = ++entryRequestRef.current;
    void enterBook(bookId)
      .then((judged) => {
        if (request !== entryRequestRef.current) return;
        setSession(judged);
        if (pendingJumpRef.current.page === null) setCurrentPage(judged.page);
        else setEntryPage(judged.page);
      })
      .catch(() => {
        if (request === entryRequestRef.current) setEntryError(true);
      });
  }, [bookId]);

  // 진입할 때마다 서버에 위치를 묻는다 — 새로고침으로 되살아난 낡은 state를 믿지 않기
  // 위해서다(위 주석). loadEntry는 bookId에만 의존하므로 책당 1회 실행된다.
  useEffect(() => {
    loadEntry();
  }, [loadEntry]);

  const notesState = useNotes(bookId);
  // FR-BRF-005
  const knownAppliedCutoffRef = useRef<{ requestId: number; cutoff: number } | null>(null);
  const [tocJumpConfirm, setTocJumpConfirm] = useState<number | null>(null);
  /**
   * 넘겨 본 쪽 확인 요청 (2026-11-17, FR-PRG-003 🚦). 가장 최근 응답의 applied_cutoff 와
   * confirm 을 묶어 그대로 들고 있다가 싸비 카드에 넘긴다 — 숫자를 계산하지 않는다.
   */
  const [frontierConfirm, setFrontierConfirm] = useState<FrontierConfirmPrompt | null>(null);
  /** 확인 답으로 기준점이 바뀌면 올린다 — useSsabiData 가 열린 탭을 다시 조회한다 */
  const [ssabiRefreshKey, setSsabiRefreshKey] = useState(0);
  const progressRequestIdRef = useRef(0);
  const progressSyncRef = useRef<{
    page: number;
    promise: Promise<void>;
  } | null>(null);
  /**
   * 화면에 뜬 쪽과 그 직전에 떠 있던 쪽 (2026-11-17, FR-PRG-003 🚦). 진도 이벤트의
   * from_page 로 그대로 싣는다 — 차례로 넘긴 것인지는 서버만 판정한다. 같은 쪽을 다시
   * 보낼 때(챗봇 직전 재동기화·StrictMode 재실행)도 그 쪽의 직전 쪽을 그대로 쓴다.
   * 책이 바뀌면 직전 쪽은 없다(null).
   */
  const displayedRef = useRef<{ bookId: string; page: number | null; from: number | null }>({
    bookId,
    page: null,
    from: null,
  });
  /** "앞부분은 이미 읽었어요"로 고른 쪽. 그 쪽의 진도 이벤트 하나가 claim 을 싣고 비운다 */
  const pendingClaimRef = useRef<number | null>(null);
  const syncPageProgress = useCallback(
    (targetPage: number, opts: { fromPage: number | null; claim?: ProgressClaim }): Promise<void> => {
      const requestId = ++progressRequestIdRef.current;
      const request = { page: targetPage, promise: Promise.resolve() };
      request.promise = sendProgress(bookId, targetPage, opts).then((response) => {
        if (response === null) throw new Error('PROGRESS_SYNC_FAILED');
        if (requestId > (knownAppliedCutoffRef.current?.requestId ?? 0)) {
          knownAppliedCutoffRef.current = { requestId, cutoff: response.applied_cutoff };
          setFrontierConfirm(
            response.confirm ? { applied_cutoff: response.applied_cutoff, ...response.confirm } : null
          );
        }
      });
      progressSyncRef.current = request;
      return request.promise;
    },
    [bookId]
  );
  const fromPageOf = useCallback(
    (targetPage: number) => (displayedRef.current.page === targetPage ? displayedRef.current.from : null),
    []
  );
  const ensureHistoryPosition = useCallback(async () => {
    if (currentPage === null) throw new Error('POSITION_NOT_READY');
    const pending = progressSyncRef.current;
    if (pending?.page === currentPage) {
      await pending.promise;
      return;
    }
    await syncPageProgress(currentPage, { fromPage: fromPageOf(currentPage) });
  }, [currentPage, fromPageOf, syncPageProgress]);

  // FR-PRG-003 🚦 — 답이 실패하면 카드·기준점·싸비 데이터를 그대로 둔다 (FR-SPL-005 🚦)
  const answerFrontierConfirm = useCallback(
    async (choice: FrontierChoice): Promise<boolean> => {
      const response = await confirmFrontier(bookId, choice);
      if (response === null) return false;
      // 답 이전에 나간 진도 응답이 늦게 와서 이 결과를 덮지 않게 순번을 올린다
      const requestId = ++progressRequestIdRef.current;
      knownAppliedCutoffRef.current = { requestId, cutoff: response.applied_cutoff };
      setFrontierConfirm(
        response.confirm ? { applied_cutoff: response.applied_cutoff, ...response.confirm } : null
      );
      // 챗봇 직전 재동기화가 옛 응답을 기다리지 않게 한다
      progressSyncRef.current = null;
      setSsabiRefreshKey((key) => key + 1);
      return true;
    },
    [bookId]
  );
  const invalidateHistoryPosition = useCallback(() => {
    progressSyncRef.current = null;
  }, []);
  const {
    turns: chatTurns,
    streaming: chatStreaming,
    error: chatError,
    conversations: chatConversations,
    historyOpen: chatHistoryOpen,
    ask: askChat,
    newChat: startNewChat,
    toggleHistory: toggleChatHistory,
    selectConversation: selectChatConversation,
    deleteConversation: deleteChatConversation,
  } = useChatConversation(bookId, currentPage, ensureHistoryPosition, invalidateHistoryPosition);
  const {
    graph,
    failed: graphFailed,
    timeline,
    timelineFailed,
  } = useSsabiData({
    panelOpen,
    bookId,
    tab,
    currentPage,
    refreshKey: ssabiRefreshKey,
  });

  /**
   * 한 페이지에 오래 머물러도 세션이 끊기지 않게 한다 (A2).
   * 읽기 화면에만 둔다 — 브리핑은 스쳐 가는 화면이고, 여기가 사용자가 머무는 곳이다.
   */
  useHeartbeat({ bookId });

  useEffect(() => {
    void fetchBookInfo(bookId)
      .then((info) => {
        const last = info.chapters[info.chapters.length - 1];
        setTotalPages(last ? last.end_page : 0);
        setChapters(info.chapters);
        setBookTitle(info.basic_info.title);
      })
      // FR-SPL-005
      .catch(() => undefined)
      .finally(() => setInfoSettled(true));
  }, [bookId]);

  // FR-PRG-003 🚦
  useEffect(() => {
    const jump = pendingJumpRef.current.page;
    if (entryPage === null || jump === null || !infoSettled) return;
    pendingJumpRef.current = { taken: true, page: null };
    const inRange = jump >= 1 && jump <= totalPages;
    if (inRange && jump !== entryPage) setJumpOrigin(entryPage);
    setCurrentPage(inRange ? jump : entryPage);
  }, [entryPage, infoSettled, totalPages]);

  // FR-PRG-003 🚦
  const requestTocJump = useCallback((targetPage: number) => {
    const applied = knownAppliedCutoffRef.current?.cutoff ?? null;
    if (applied !== null && targetPage > applied) setTocJumpConfirm(targetPage);
    else setCurrentPage(targetPage);
  }, []);
  const confirmTocJump = useCallback(
    (choice: TocJumpChoice) => {
      const target = tocJumpConfirm;
      setTocJumpConfirm(null);
      if (target === null) return;
      if (choice === 'read_through') {
        if (target === currentPage) {
          // 이미 그 쪽에 있으면 쪽이 바뀌지 않아 아래 effect 가 돌지 않는다 — 답만 한 번 보낸다
          void syncPageProgress(target, { fromPage: fromPageOf(target), claim: 'read_through' }).catch(() => {
            // FR-SPL-005
          });
          return;
        }
        pendingClaimRef.current = target;
      }
      setCurrentPage(target);
    },
    [currentPage, fromPageOf, syncPageProgress, tocJumpConfirm]
  );
  const cancelTocJump = useCallback(() => setTocJumpConfirm(null), []);

  // FR-PRG-003
  const jumpToNote = useCallback(
    (target: number) => {
      if (currentPage === null || target === currentPage) return;
      setJumpOrigin(currentPage);
      setCurrentPage(target);
    },
    [currentPage]
  );

  const returnToOrigin = useCallback(() => {
    if (jumpOrigin !== null) setCurrentPage(jumpOrigin);
    setJumpOrigin(null);
  }, [jumpOrigin]);
  const dismissJumpOrigin = useCallback(() => setJumpOrigin(null), []);

  const loadPage = useCallback(
    (targetPage: number) => {
      setPageError(false);
      latestRequestedPageRef.current = targetPage;
      void fetchPage(bookId, targetPage)
        .then((fetched) => {
          // 그 사이 더 최신 페이지 요청이 나갔으면 이 응답은 버린다 — 늦게 도착한 예전
          // 요청이 최신 화면을 덮어쓰지 않게 막는다
          if (latestRequestedPageRef.current === targetPage) setPage(fetched);
        })
        .catch(() => {
          if (latestRequestedPageRef.current === targetPage) setPageError(true);
        });
    },
    [bookId]
  );

  useEffect(() => {
    if (currentPage === null) return; // 진입 판정 전에는 진도를 보내지 않는다
    loadPage(currentPage);
    // 페이지 열림이 확정된 시점에 진도를 알린다 (FR-PRG-002, NFR-PERF-005)
    // FR-PRG-003 🚦 — 직전 화면 쪽(from_page)과 claim 은 사실만 싣는다. 판정은 서버가 한다.
    const displayed = displayedRef.current;
    if (displayed.bookId !== bookId) {
      displayedRef.current = { bookId, page: currentPage, from: null };
    } else if (displayed.page !== currentPage) {
      displayedRef.current = { bookId, page: currentPage, from: displayed.page };
    }
    const claim: ProgressClaim | undefined = pendingClaimRef.current === currentPage ? 'read_through' : undefined;
    pendingClaimRef.current = null;
    void syncPageProgress(currentPage, { fromPage: displayedRef.current.from, ...(claim ? { claim } : {}) }).catch(
      () => {
        // FR-SPL-005
      }
    );
  }, [bookId, currentPage, loadPage, syncPageProgress]);

  const handleAsk = useCallback(
    (query: string, quote?: string) => {
      if (currentPage === null) return;
      // FR-PRG-003 🚦 — 진도 이벤트와 같은 직전 화면 쪽을 싣는다. 진도 POST 가 늦거나 실패한 마지막 넘김도
      // 질문할 때 서버에 닿는다(대표 지시 2026-11-18). 판정은 서버가 한다
      void askChat(query, currentPage, nextSeq(), quote, fromPageOf(currentPage));
    },
    [askChat, currentPage, fromPageOf]
  );

  const retryPage = useCallback(() => {
    if (currentPage !== null) loadPage(currentPage);
  }, [currentPage, loadPage]);

  const currentChapter =
    currentPage === null
      ? null
      : (chapters.find((chapter) => currentPage >= chapter.start_page && currentPage <= chapter.end_page) ?? null);

  return {
    entryError,
    retryEntry: loadEntry,
    page,
    pageError,
    retryPage,
    currentPage,
    totalPages,
    chapters,
    bookTitle,
    currentChapter,
    jumpOrigin,
    returnToOrigin,
    dismissJumpOrigin,
    moveTo: setCurrentPage,
    requestTocJump,
    tocJumpConfirm,
    confirmTocJump,
    cancelTocJump,
    frontierConfirm,
    answerFrontierConfirm,
    panelOpen,
    togglePanel,
    highlightedQuote,
    quote: handleQuote,
    ssabiPanelProps: {
      sessionEpoch: session?.session_epoch ?? 0,
      initialTab: tabMemory?.tab ?? null,
      initialTabEpoch: tabMemory?.epoch ?? null,
      onTabChange: handleTabChange,
      graph,
      graphFailed,
      timeline,
      timelineFailed,
      totalPages,
      notes: notesState.notes,
      notesFailed: notesState.failed,
      currentPage,
      onAddNote: notesState.add,
      onEditNote: notesState.edit,
      onRemoveNote: notesState.remove,
      onJumpToNote: jumpToNote,
      chatTurns,
      chatStreaming,
      chatError,
      chatConversations,
      chatHistoryOpen,
      pendingQuote,
      onQuoteDismissed: () => setHighlightedQuote(null),
      onAsk: handleAsk,
      onNewChat: startNewChat,
      onToggleChatHistory: toggleChatHistory,
      onSelectChatConversation: selectChatConversation,
      onDeleteChatConversation: deleteChatConversation,
      frontierConfirm,
      onFrontierConfirm: answerFrontierConfirm,
    },
  };
}
