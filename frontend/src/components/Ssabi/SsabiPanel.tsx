import { useEffect, useRef, useState, useMemo } from 'react';
import type {
  ChatbotConversationSummary,
  FrontierChoice,
  FrontierConfirmPrompt,
  ChatbotConversationTurn,
  GraphResponse,
  NoteDraft,
  ReadingNote,
  SsabiTab,
  TimelineResponse,
} from '../../types';
import { resolveSsabiTab } from '../../utils/ssabiTab';
import NotesTab from './NotesTab';
import TimelineTab from './TimelineTab';
import RelationshipTab from './RelationshipTab';
import ChatbotTab from './ChatbotTab';
import { mentionNames } from './chatMentions';
import FrontierConfirmCard from './FrontierConfirmCard';

const TAB_LABELS: Record<SsabiTab, string> = {
  notes: '추리 노트',
  timeline: '타임라인',
  relationship: '인물관계도',
  chatbot: '아모',
};

// 결정 31 · 2026-11-18 대표 승인 시안 A안 — 이 순서 그대로
const TAB_ORDER: SsabiTab[] = ['notes', 'timeline', 'relationship', 'chatbot'];

/**
 * 싸비 사이드창 4탭 — S5 (FR-SVB-002·004·005), 2026-11-18 대표 승인 시안 A안
 * (`event-placement.html` "타임라인 안에 사건을 함께"): 추리 노트 · 타임라인 · 인물관계도 · AI 챗봇.
 * 탭은 칸을 똑같이 나눈 밑줄 탭이고, 사건 정리는 타임라인 안에 있다(추리 노트 안의 사건 정리는 없앴다).
 *
 * 이 컴포넌트가 갖는 상태는 "어느 탭이 열려 있는가" 하나다.
 * 조회는 컨테이너가 하고, 페이지 변경 시 재조회(FR-SVB-003)도 그쪽 책임이다.
 * 세션 경계는 서버가 준 session_epoch 의 **변화**로만 판정한다 — 클라이언트가 30분 규칙을
 * 다시 계산하지 않는다 (절대 규칙 8번, 자가 검증 17번).
 * 본문 페이지를 옮기는 수단을 갖지 않아 FR-SVB-005 를 구조로 지킨다.
 */
export default function SsabiPanel({
  bookTitle = null,
  sessionEpoch,
  initialTab = null,
  initialTabEpoch = null,
  onTabChange,
  graph,
  graphFailed,
  timeline = null,
  timelineFailed = false,
  totalPages,
  notes,
  notesFailed,
  currentPage,
  onAddNote,
  onEditNote,
  onRemoveNote,
  onJumpToNote,
  chatTurns,
  chatStreaming,
  chatError,
  chatConversations,
  chatHistoryOpen,
  pendingQuote,
  onAsk,
  onNewChat,
  onToggleChatHistory,
  onSelectChatConversation,
  onDeleteChatConversation,
  onQuoteDismissed,
  pendingNoteQuote = null,
  onNoteQuoteHandled,
  compactHeader = false,
  requireTextToSend = false,
  frontierConfirm = null,
  onFrontierConfirm,
}: {
  /** 패널 머리에 보일 책 제목 (승인 시안 2026-11-18) */
  bookTitle?: string | null;
  sessionEpoch: number;
  /**
   * 재마운트 시 이어서 쓸 "마지막 탭" 기억과, 그 값을 기록한 시점의 sessionEpoch
   * (2026-08-24, 사용자 요청 — 패널을 닫았다 열면 항상 기본 탭으로 리셋되던 것을 마지막
   * 이용 탭 유지로 바꿈). 이 컴포넌트는 닫힐 때 Reader가 통째로 언마운트하므로(패널
   * 언마운트 정책 참조, Reader.tsx) 내부 상태만으로는 기억할 수 없다 — 언마운트되지 않는
   * Reader가 대신 들고 있다가 재마운트 시 이 두 값으로 되돌려준다. 아래 sameSession
   * 판정(resolveSsabiTab)에 그대로 흘러 들어가므로, epoch이 안 맞으면(세션이 바뀐 채로
   * 닫혀 있었으면, FR-SVB-004) 자동으로 기본 탭으로 돌아간다 — 별도 분기 없이 기존 로직이
   * 그대로 처리한다. 둘 다 없으면(최초 진입) 기존과 동일하게 기본 탭에서 시작한다.
   */
  initialTab?: SsabiTab | null;
  initialTabEpoch?: number | null;
  onTabChange: (tab: SsabiTab) => void;
  graph: GraphResponse | null;
  graphFailed: boolean;
  /** 타임라인(장 요약·사건) — 서버가 K 이하, 다 읽은 장만 걸러 준 것 (FR-SPL-002 🚦, 결정 31) */
  timeline?: TimelineResponse | null;
  timelineFailed?: boolean;
  /** 목차 기준 전체 페이지 수 — 노트 쪽수 입력의 상한, 인물관계도 되감기 트랙 오른쪽 끝(R3, 목차는 상한 대상 아님). */
  totalPages?: number;
  notes: ReadingNote[];
  notesFailed: boolean;
  currentPage: number | null;
  onAddNote: (draft: NoteDraft) => Promise<boolean>;
  onEditNote: (noteId: string, draft: Partial<NoteDraft>) => Promise<boolean>;
  onRemoveNote: (noteId: string) => Promise<boolean>;
  onJumpToNote: (page: number) => void;
  chatTurns: ChatbotConversationTurn[];
  chatStreaming: boolean;
  chatError: string | null;
  chatConversations: ChatbotConversationSummary[];
  chatHistoryOpen: boolean;
  /** 본문에서 드래그로 인용한 문장. token 이 바뀔 때마다 챗봇 탭으로 강제 전환한다 */
  pendingQuote?: { text: string; token: number } | null;
  onAsk: (query: string, quote?: string) => void;
  onNewChat: () => void;
  onToggleChatHistory: () => void;
  onSelectChatConversation: (conversationId: number) => void;
  /** 지난 대화 삭제 (2026-08-25, 사용자 요청) */
  onDeleteChatConversation?: (conversationId: number) => void;
  /** "선택한 문장" 카드가 지워질 때마다 호출된다(2026-08-25, 사용자 요청) — Reader.tsx가
   *  본문 하이라이트를 같이 지운다. */
  onQuoteDismissed?: () => void;
  pendingNoteQuote?: { text: string; token: number } | null;
  onNoteQuoteHandled?: () => void;
  compactHeader?: boolean;
  requireTextToSend?: boolean;
  /**
   * 넘겨 본 쪽 확인 요청 (2026-11-17, FR-PRG-003 🚦) — 서버 진도 응답의 confirm 과
   * applied_cutoff 를 그대로 받는다. null 이면 카드를 그리지 않는다.
   */
  frontierConfirm?: FrontierConfirmPrompt | null;
  /** 카드의 답. 성공하면 true — 실패하면 카드가 그대로 남는다 (FR-SPL-005 🚦) */
  onFrontierConfirm?: (choice: FrontierChoice) => Promise<boolean>;
}) {
  const [lastTab, setLastTab] = useState<SsabiTab | null>(initialTab);
  const previousEpoch = useRef<number | null>(initialTabEpoch);

  const tab = resolveSsabiTab({
    previousEpoch: previousEpoch.current,
    currentEpoch: sessionEpoch,
    lastTab,
  });

  useEffect(() => {
    if (previousEpoch.current !== sessionEpoch) {
      previousEpoch.current = sessionEpoch;
      setLastTab(null); // 새 세션 — 기본 탭으로 초기화 (FR-SVB-004)
    }
  }, [sessionEpoch]);

  useEffect(() => {
    onTabChange(tab);
  }, [tab, onTabChange]);

  // 본문에서 인용 요청이 올 때마다(token 변화) 챗봇 탭으로 전환한다
  useEffect(() => {
    if (pendingQuote) setLastTab('chatbot');
  }, [pendingQuote?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const askAmoAboutNote = (body: string) => {
    setLastTab('chatbot');
    if (!chatStreaming) onAsk(`${body} 이에 대해 설명해줘.`);
  };

  useEffect(() => {
    if (pendingNoteQuote) setLastTab('notes');
  }, [pendingNoteQuote?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // FR-SPL-002 🚦 — 강조 이름은 서버가 기준점으로 거른 관계도 응답에서만. 실패·조회 전이면 0건
  const chatMentionNames = useMemo(() => mentionNames(graph), [graph]);
  return (
    <section className="flex h-full flex-col border-l border-brief-rule bg-brief-paper">
      {/* 여닫기 버튼은 이 헤더 우측에 겹쳐 보이지만 Reader 가 고정 위치로 그린다 —
          패널이 닫혀도 같은 자리에 남아야 하므로 패널 안에 두지 않는다 */}
      <div
        className={`flex items-center justify-between gap-2 pb-5 pl-20 pr-20 pt-6 mobile:flex-wrap mobile:gap-y-2 ${compactHeader ? 'hidden' : ''}`}
      >
        {/*
         * pr-20(80px) — 여닫기 버튼은 Reader가 이 헤더와 같은 줄, 같은 우측 여백(right-6)에
         * 고정 위치로 그린다(size-9=36px). px-6만 쓰면 이 배지의 오른쪽 끝이 버튼과 정확히
         * 같은 x좌표에서 겹친다 — 버튼 폭(36px) + 여유(20px)만큼 오른쪽을 비워 겹침을 막는다.
         */}
        {/* 승인 시안(2026-11-18): 헤더는 책 제목만. 읽은 범위 문구는 넣지 않는다(대표 지시, 2026-11-11 결정 유지) */}
        <h2 className="flex min-h-9 min-w-0 flex-1 items-center justify-center truncate font-dashSans text-[15px] font-bold text-brief-ink">{bookTitle ?? ''}</h2>
      </div>

      {/* 키보드가 열려 헤더를 접은 동안(compactHeader)은 입력 칸 자리를 지키려고 잠시 숨긴다 */}
      {frontierConfirm && onFrontierConfirm && !compactHeader ? (
        <FrontierConfirmCard prompt={frontierConfirm} onAnswer={onFrontierConfirm} />
      ) : null}

      {/* 4탭 — 시안 그대로 칸을 똑같이 나눈 밑줄 탭. 고른 탭은 강조색 글자·굵게·밑줄 2px */}
      <div role="tablist" aria-label="사이드 탭" className="flex border-b border-brief-rule px-2">
        {TAB_ORDER.map((it) => (
          <button
            key={it}
            role="tab"
            type="button"
            data-track={`ssabi-tab-${TAB_LABELS[it]}`}
            aria-selected={tab === it}
            onClick={() => setLastTab(it)}
            className={`-mb-px min-h-11 flex-1 whitespace-nowrap border-b-2 pb-2.5 pt-3 text-center font-dashSans text-[12.5px] leading-none transition-colors ${
              tab === it
                ? 'border-brief-accent font-bold text-brief-accent'
                : 'border-transparent font-medium text-brief-muted hover:text-brief-ink'
            }`}
          >
            {TAB_LABELS[it]}
          </button>
        ))}
      </div>

      <div
        key={tab}
        role="tabpanel"
        // 시안 본문 여백(14px 16px 16px). 챗봇 탭은 이번 시안과 무관해 지금 여백을 그대로 둔다
        className={`brief-scroll relative z-0 flex-1 animate-tab-in overflow-y-auto bg-brief-paper ${
          tab === 'chatbot' ? 'px-6 pb-6 pt-5' : 'px-4 pb-4 pt-3.5'
        }`}
      >
        {tab === 'notes' ? (
          <NotesTab
            notes={notes}
            failed={notesFailed}
            currentPage={currentPage}
            totalPages={totalPages}
            onAdd={onAddNote}
            onEdit={onEditNote}
            onRemove={onRemoveNote}
            onJump={onJumpToNote}
            onAskAmo={askAmoAboutNote}
            quoteDraft={pendingNoteQuote}
            onQuoteDraftHandled={onNoteQuoteHandled}
          />
        ) : null}
        {tab === 'timeline' ? <TimelineTab timeline={timeline} failed={timelineFailed} /> : null}
        {tab === 'relationship' ? (
          <RelationshipTab graph={graph} failed={graphFailed} totalPages={totalPages} onJump={onJumpToNote} />
        ) : null}
        {tab === 'chatbot' ? (
          <ChatbotTab
            requireTextToSend={requireTextToSend}
            turns={chatTurns}
            streaming={chatStreaming}
            error={chatError}
            conversations={chatConversations}
            historyOpen={chatHistoryOpen}
            quote={pendingQuote}
            onAsk={onAsk}
            onNewChat={onNewChat}
            onToggleHistory={onToggleChatHistory}
            onSelectConversation={onSelectChatConversation}
            onDeleteConversation={onDeleteChatConversation}
            onQuoteDismissed={onQuoteDismissed}
            mentionNames={chatMentionNames}
            onJumpToPage={onJumpToNote}
          />
        ) : null}
      </div>
    </section>
  );
}
