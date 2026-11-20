import type { SsabiTab } from '../types';
import { DEMO_FOCUS_CHARACTER, DEMO_QUESTION, DEMO_TITLE } from './demoBook';

/** 가이드 화면이 들고 있는 상태 중 단계 문구·완료 판정에 쓰는 것 */
export interface GuideProgress {
  page: number;
}

/**
 * 단계가 넘어가는 방식 (대표 지시 2026-11-19 — 한 단계 = 한 기능 설명 + 누르기 최대 1번)
 * - tap: 비춘 곳을 누르면(또는 "다음") 그 동작을 하고 다음 단계로 간다. 화면이 바뀌는 단계.
 * - try: 비춘 곳을 눌러 기능을 직접 써 보고 그 자리에 머문다. "다음"을 눌러야 넘어간다.
 * - look: 비춘 곳은 보여 주기만 한다(누르기 없음). "다음"을 눌러야 넘어간다.
 */
export type GuideStepMode = 'tap' | 'try' | 'look';

export interface GuideStep {
  id: string;
  /** 코치 말풍선 문구 — 이 단계에서 알려 주는 기능 하나 */
  text: string | ((state: GuideProgress) => string);
  /** 밝게 비추는 실제 화면 요소. 없으면 화면 전체를 막는다 */
  target: () => Element | null;
  /** 넘어가는 방식. 없으면 tap */
  mode?: GuideStepMode;
  /**
   * 이 단계에서 열려 있을 사이드 탭. 가이드가 대신 연다 — 독자가 탭을 찾아 누를 필요가 없다.
   * 없으면 사이드 탭을 닫아 둔다.
   */
  tab?: SsabiTab;
  /**
   * true 면 비춘 곳을 눌러도 그 요소의 원래 동작은 막고 가이드가 정한 동작만 한다
   * (추천 질문을 누르면 입력 칸에 넣는 대신 가이드가 바로 묻고 답을 보여 준다).
   */
  swallowTap?: boolean;
  /** 말풍선 자리. auto 는 비춘 요소 위나 아래, top·bottom 은 화면 위·아래 끝에 고정 */
  place?: 'auto' | 'top' | 'bottom';
  /** try 단계에서 눌러 본 뒤 비출 곳 — 누른 결과(관계 설명·아모 답)까지 보이게 넓힌다 */
  afterTry?: () => Element | null;
  /** afterTry 를 비출 때 말풍선 자리 */
  afterTryPlace?: 'auto' | 'top' | 'bottom';
  /** 마지막 단계 — 비추지 않고 가운데 카드로 마무리한다 */
  final?: { title: string; action: string };
}

function byText(selector: string, text: string): Element | null {
  return Array.from(document.querySelectorAll(selector)).find((el) => el.textContent?.trim() === text) ?? null;
}

const tabPanel = () => document.querySelector('#ssabi-panel [role="tabpanel"]');

/**
 * 첫 이용 가이드 8단계 — docs/context/guide-redesign-2026-11-19.md 2장 표 그대로 (대표 지시 2026-11-19).
 * 3단계 문구만 "수상한 문장" 대신 "메모하고 싶은 문장". 화면 문구에는 "싸비" 대신 "사이드 탭".
 * 노트 저장·질문 보내기·사이드 탭 열기·끝까지 넘기기는 가이드가 데모 상태만 바꿔 대신한다(서버 호출 없음).
 */
export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'open-book',
    text: `RE:ADD는 추리소설을 읽다 잊은 인물과 사건을 바로 되찾게 돕는 곳이에요. 무엇이든 차례로 읽은 쪽까지만 보여 줘서 스포일러가 없어요. 데모 책 「${DEMO_TITLE}」 표지를 눌러 열어 보세요.`,
    target: () => document.querySelector('[data-testid="book-carousel"] .b3d-book[data-active="true"]'),
  },
  {
    id: 'recap',
    text: '책을 다시 펼치면 읽은 데까지 지난 줄거리를 정리해 둬요. 오래 쉬었다 와도 바로 이어 읽을 수 있어요. 이어서 읽기를 눌러요.',
    target: () => document.querySelector('[data-testid="briefing-continue-bar"] button'),
    // 아래쪽에 두면 정리된 줄거리를 가린다
    place: 'top',
  },
  {
    id: 'pick-sentence',
    text: '메모하고 싶은 문장은 길게 눌러 고를 수 있어요. 노트에 적거나 아모에게 물을 수 있어요. 노트에 적기를 눌러 보세요.',
    target: () => byText('[data-quote-ask] button', '노트에 적기'),
  },
  {
    id: 'side-notes',
    text: '읽다가 사이드 탭을 열면 네 가지 도구가 있어요. 먼저 추리 노트예요. 적은 단서와 가설이 쪽수와 함께 여기 모여요.',
    target: () => document.querySelector('#ssabi-panel [role="tabpanel"] li:not([role="presentation"])'),
    mode: 'look',
    tab: 'notes',
  },
  {
    id: 'side-timeline',
    text: '타임라인에는 다 읽은 장의 핵심 한 줄과 그 장의 사건이 모여요. 읽는 중인 장은 다 읽으면 정리돼요. 1장을 눌러 사건을 펼쳐 보세요.',
    target: () => document.querySelector('#ssabi-panel [role="tabpanel"] ol > li:not([data-timeline-now])'),
    mode: 'try',
    tab: 'timeline',
    place: 'bottom',
  },
  {
    id: 'side-relationship',
    text: '인물관계도에는 지금까지 드러난 인물 관계만 보여요. 읽을수록 선이 늘어나요. 윤미라를 눌러 보세요.',
    target: () => document.querySelector(`#ssabi-panel [data-node-id="${DEMO_FOCUS_CHARACTER}"], #ssabi-panel summary[data-character-id="${DEMO_FOCUS_CHARACTER}"]`),
    mode: 'try',
    tab: 'relationship',
    afterTry: tabPanel,
    afterTryPlace: 'top',
  },
  {
    id: 'ask-amo',
    text: '아모는 읽은 쪽까지의 내용으로 답하는 친구예요. 추리가 맞는지 판정하거나 범인을 말하지 않아요. 답 속 쪽 번호를 누르면 그 쪽에 갔다 돌아올 수 있어요. 추천 질문을 눌러 보세요.',
    target: () => byText('#ssabi-panel [data-track="chat-suggestion"]', DEMO_QUESTION),
    mode: 'try',
    tab: 'chatbot',
    swallowTap: true,
    place: 'top',
    afterTry: tabPanel,
    afterTryPlace: 'bottom',
  },
  {
    id: 'finish',
    text: '마지막 쪽에서 한 장 더 넘기면 끝 페이지에서 한 줄 리뷰를 남기고 완독자 커뮤니티로 갈 수 있어요. 사이드 탭은 읽기 화면 오른쪽 손잡이로 언제든 열 수 있어요.',
    target: () => document.querySelector('[data-guide-finish]'),
    final: { title: '이제 진짜 책을 읽어 볼까요', action: '홈으로' },
  },
];
