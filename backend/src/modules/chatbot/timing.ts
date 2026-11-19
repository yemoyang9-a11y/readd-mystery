import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

/**
 * NFR-PERF-008, 대표 결정 2026-11-19 (E) — 챗봇 요청 하나의 단계별 소요 시간.
 *
 * 운영에서 「가상범인」 질문의 첫 바이트가 2.8~5.1초였다. 어느 단계가 시간을 쓰는지 재려고
 * 단계 이름과 숫자(ms)만 모은다. 본문·근거 내용·질문·기준 쪽수(K) 같은 값은 담지 않는다 —
 * 이 객체는 SSE 'done' 프레임(`timings_ms`)으로 독자 화면까지 가기 때문이다.
 *
 * 근거 범위(K)에는 관여하지 않는다(R4). 시간을 재기만 한다.
 */
export const DURATION_STAGES = [
  /** 책 공개 여부 확인 + 호출 횟수 제한 (라우트) */
  'book_ready',
  /** 동봉 진도 수용 + 세션 활동 기록 (라우트) */
  'progress',
  /** 기준점 스냅샷 getCutoffSnapshot (라우트) */
  'snapshot',
  /** 지금 보고 있는 쪽 본문 조회 (라우트) */
  'page_text',
  /** 대화 이어가기/새로 열기 (라우트) */
  'conversation',
  /** 대화 기록 getConversationContext */
  'history',
  /** 근거 조립 assembleContext */
  'context',
  /** 검색 전체 vectorSearch (임베딩 포함) */
  'vector_search',
  /** 그중 질문 임베딩 API */
  'embedding',
  /** 독자 노트 조회 */
  'notes',
  /** 프롬프트 조립 */
  'prompt',
  /** 첫 모델 호출 시작 → 그 호출의 첫 토큰 */
  'llm_first_token_wait',
  /** 모델 호출 시작 → 모든 생성이 끝날 때까지 (호출이 여럿이면 합) */
  'llm_total',
  /** 출력 검사 guardAnswer (여러 번이면 합) */
  'guard',
  /** 대화 기록 저장 recordTurns */
  'record',
] as const;

export const ELAPSED_MARKS = [
  /** 요청 시작 → 첫 모델 호출의 첫 토큰 */
  'llm_first_token',
  /** 요청 시작 → 독자에게 첫 글자를 내보낸 시각(첫 yield) */
  'first_yield',
  /** 요청 시작 → 마지막 글자까지 */
  'total',
] as const;

export const COUNTERS = [
  /** 모델 호출 수 (MOCK 포함 실제 스트림 호출) */
  'model_calls',
  /** 재생성 횟수 (= 모델 호출 수 - 1, 0 이상) */
  'regenerations',
  /** 독자에게 나간 delta 수 */
  'deltas',
] as const;

export type DurationStage = (typeof DURATION_STAGES)[number];
export type ElapsedMark = (typeof ELAPSED_MARKS)[number];
export type Counter = (typeof COUNTERS)[number];
export type TimingName = DurationStage | ElapsedMark | Counter;

export interface ChatTiming {
  /** 단계 소요 시간을 더한다 */
  add(stage: DurationStage, ms: number): void;
  /** fn이 끝날 때까지 걸린 시간을 stage에 더한다 (실패해도 잰다) */
  time<T>(stage: DurationStage, fn: () => Promise<T>): Promise<T>;
  /** 요청 시작부터 지금까지를 처음 한 번만 남긴다 */
  markOnce(mark: ElapsedMark): void;
  /** 요청 시작부터 지금까지 (덮어쓴다) */
  mark(mark: ElapsedMark): void;
  increment(counter: Counter, by?: number): void;
  now(): number;
  /** 단계 이름 → 정수 ms(카운터는 횟수). 잰 단계만 담는다 */
  snapshot(): Partial<Record<TimingName, number>>;
}

export function createChatTiming(clock: () => number = () => performance.now()): ChatTiming {
  const start = clock();
  const values = new Map<TimingName, number>();
  const timing: ChatTiming = {
    add(stage, ms) {
      values.set(stage, (values.get(stage) ?? 0) + Math.max(0, ms));
    },
    async time(stage, fn) {
      const begin = clock();
      try {
        return await fn();
      } finally {
        timing.add(stage, clock() - begin);
      }
    },
    markOnce(mark) {
      if (!values.has(mark)) values.set(mark, Math.max(0, clock() - start));
    },
    mark(mark) {
      values.set(mark, Math.max(0, clock() - start));
    },
    increment(counter, by = 1) {
      values.set(counter, (values.get(counter) ?? 0) + by);
    },
    now: clock,
    snapshot() {
      const out: Partial<Record<TimingName, number>> = {};
      for (const name of [...DURATION_STAGES, ...ELAPSED_MARKS, ...COUNTERS]) {
        const value = values.get(name);
        if (value !== undefined) out[name] = Math.round(value);
      }
      return out;
    },
  };
  return timing;
}

/**
 * 인자 목록을 바꾸지 않고 하위 함수(vectorSearch 안의 임베딩)까지 같은 요청의 계측기를 넘긴다.
 * 계측기가 없으면 아무것도 재지 않는다 — 기능 동작은 계측기 유무와 무관하다.
 */
export const chatTimingStore = new AsyncLocalStorage<ChatTiming>();

export function currentChatTiming(): ChatTiming | undefined {
  return chatTimingStore.getStore();
}
