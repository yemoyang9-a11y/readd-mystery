import { DEMO_FOCUS_CHARACTER, DEMO_TITLE, DEMO_TOTAL_PAGES } from './demoBook';

/** 가이드 화면이 들고 있는 상태 중 단계 문구·완료 판정에 쓰는 것 */
export interface GuideProgress {
  page: number;
}

export interface GuideStep {
  id: string;
  /** 코치 말풍선 문구 — 이 단계에서 독자가 할 일 하나 */
  text: string | ((state: GuideProgress) => string);
  /** 밝게 비추고 누를 수 있게 남기는 실제 화면 요소. 없으면 화면 전체를 막는다 */
  target: () => Element | null;
  /**
   * 있으면 "눌렀다"가 아니라 이 조건이 참이 될 때 다음 단계로 간다(끝까지 읽기처럼 여러 번 누르는 단계).
   * 없으면 비춘 요소를 누르는 순간 다음 단계로 간다.
   */
  doneWhen?: (state: GuideProgress) => boolean;
  /** 말풍선 자리. auto 는 비춘 요소 위나 아래, top·bottom 은 화면 위·아래 끝에 고정 */
  place?: 'auto' | 'top' | 'bottom';
  /** 마지막 단계 — 비추지 않고 가운데 카드로 마무리한다 */
  final?: { title: string; action: string };
}

function byText(selector: string, text: string): Element | null {
  return Array.from(document.querySelectorAll(selector)).find((el) => el.textContent?.trim() === text) ?? null;
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'open-book',
    text: `데모 책 「${DEMO_TITLE}」로 둘러볼게요. 표지를 눌러 책을 열어 보세요.`,
    target: () => document.querySelector('[data-testid="book-carousel"] .b3d-book[data-active="true"]'),
  },
  {
    id: 'continue',
    text: '다시 펼치면 아모가 읽은 데까지 줄거리를 정리해 둬요. 이어서 읽기를 눌러요.',
    target: () => document.querySelector('[data-testid="briefing-continue-bar"] button'),
    // 아래쪽에 두면 정리된 줄거리를 가린다
    place: 'top',
  },
  {
    id: 'next-page',
    text: '다음 페이지를 눌러 넘겨 보세요. 화면을 옆으로 밀어도 넘어가요.',
    target: () => byText('[data-testid="guide-reader"] nav button', '다음 페이지'),
  },
  {
    id: 'pick-clue',
    text: '수상한 문장은 길게 눌러 고를 수 있어요. 표시된 문장을 눌러 보세요.',
    target: () => document.querySelector('[data-testid="guide-reader"] [data-testid="swipe-surface"] mark'),
  },
  {
    id: 'note-clue',
    text: '노트에 적기를 누르면 쪽수와 함께 추리 노트에 남아요.',
    target: () => byText('[data-quote-ask] button', '노트에 적기'),
  },
  {
    id: 'save-note',
    text: '생각을 덧붙이거나 종류를 골라도 돼요. 저장을 눌러요.',
    target: () => byText('[role="dialog"][aria-label="단서·가설 적기"] button', '저장'),
    place: 'top',
  },
  {
    id: 'open-relationship',
    text: '적은 노트는 여기 추리 노트에 모여요. 이번엔 인물관계도를 눌러 볼까요?',
    target: () => byText('#ssabi-panel [role="tab"]', '인물관계도'),
  },
  {
    id: 'pick-character',
    text: '윤태호를 눌러 보세요. 읽은 데까지 드러난 관계만 보여요.',
    target: () => document.querySelector(`#ssabi-panel [data-node-id="${DEMO_FOCUS_CHARACTER}"]`),
  },
  {
    id: 'open-chatbot',
    text: '궁금한 건 AI 친구 아모에게 물어봐요. AI 챗봇을 눌러요.',
    target: () => byText('#ssabi-panel [role="tab"]', 'AI 챗봇'),
    place: 'bottom',
  },
  {
    id: 'pick-question',
    text: '추천 질문을 눌러 볼까요? 방금 적은 노트로 물어볼게요.',
    target: () => byText('#ssabi-panel [data-track="chat-suggestion"]', '내 노트랑 관련된 장면 있어?'),
  },
  {
    id: 'send-question',
    text: '보내기를 눌러 아모에게 물어봐요.',
    target: () => document.querySelector('#ssabi-panel button[aria-label="질문 보내기"]'),
  },
  {
    id: 'close-ssabi',
    text: '아모는 추리가 맞는지 판정하지 않고, 읽은 쪽까지만 답해요. 싸비를 닫고 계속 읽어요.',
    target: () => document.querySelector('button[aria-label="싸비 닫기"]'),
    place: 'bottom',
  },
  {
    id: 'read-to-end',
    text: (state) =>
      `끝까지 넘겨 볼까요? 다음 페이지를 눌러요. ${DEMO_TOTAL_PAGES - state.page}쪽 남았어요.`,
    target: () => byText('[data-testid="guide-reader"] nav button', '다음 페이지'),
    doneWhen: (state) => state.page >= DEMO_TOTAL_PAGES,
  },
  {
    id: 'open-community',
    text: '완독하면 같은 책을 다 읽은 독자들과 이야기할 수 있어요.',
    target: () => document.querySelector('[data-testid="completion-block"] button[data-track="community-open"]'),
  },
  {
    id: 'finish',
    text: '싸비는 읽기 화면 오른쪽 손잡이로 언제든 열 수 있어요.',
    target: () => document.querySelector('[data-guide-finish]'),
    final: { title: '이제 진짜 책을 읽어 볼까요', action: '홈으로' },
  },
];
