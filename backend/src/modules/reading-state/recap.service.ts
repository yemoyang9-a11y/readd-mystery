/**
 * 리캡 재사용 판정 · 생성 · 캐시 적재 · 호출 로그 (R2, S5)
 *
 * @see dev-spec-R2-core.md S5
 * @see architecture-r1.md 5.2절 흐름 B, 4.4.1절(세션 종료 잡)
 *
 * 조항: FR-DAT-009 (저장 리캡 1건) · FR-DAT-010 (세션 캐시, 영구 저장 없음) · R7·R8
 *      · NFR-OBS-002 🚦 (리캡 호출 로그) · NFR-PERF-002 🚦 (스트리밍)
 *      · FR-RCP-001 🚦 (환각 금지 지시) · NFR-AI-004 🚦 (프롬프트에 상한 지시 없음)
 *      · 2026-11-17 C안 — 목표 문장 수 N 코드 계산(recap-length.ts)과 길이 로그
 *      · 2026-11-17 고유명사 검사 — 출력에 사전(K 이하)·입력 자료에 없는 이름꼴 낱말이
 *        생겼는지 세어 로그에만 남긴다(recap-names.ts). 리캡은 막거나 고치지 않는다
 *
 * ⚠️ LLM 호출은 `llmStream` 의존성을 통해서만 이뤄진다 — 실제 게이트웨이(⑥) 연결은
 *    라우트 계층(CP3 실데이터 전환 범위)에서 `import { stream } from '../llm-gateway/gateway'`를
 *    주입한다. 여기서 직접 import하지 않는 이유 — 게이트웨이 모듈(`gateway.ts`)은 import
 *    시점에 Bedrock 클라이언트를 만들고 모델 버전 환경변수를 검증한다(가드), 그 부작용을
 *    단위 테스트에 끌고 오지 않기 위해 함수 의존성으로 분리했다.
 *
 *    로그용 모델 ID는 예외다 — `model-config.ts`의 `getModelForTask`는 순수 함수이고
 *    (import 시점 부작용 없음, MODEL_CONFIG는 env 값을 읽는 객체 리터럴일 뿐) 위
 *    가드가 걸리는 `gateway.ts`와는 다른 모듈이라 직접 import해도 안전하다.
 */

import { assembleRecapInput } from './recap-assembly';
import type { RecapAssemblyDeps } from './recap-assembly';
import {
  RECAP_SENTENCE_MAX_CHARS,
  computeRecapTargetSentences,
  countRecapSentences,
} from './recap-length';
import { findUnknownNames } from './recap-names';
import { getModelForTask } from '../llm-gateway/model-config';
import type {
  RecapCallLogger,
  SavedRecapRepository,
  SessionRecapCacheRepository,
} from './repository';
import type { RecapCallLog, RecapInput } from '../../shared/types';

export type RecapTrigger = 'realtime' | 'session_end';

export type RecapResult =
  | { kind: 'empty' }
  | { kind: 'reused'; text: string }
  | { kind: 'generated'; chunks: AsyncGenerator<string> };

/**
 * 스트리밍 종료 시 게이트웨이가 돌려주는 실사용량 (gateway.ts의 LLMStreamUsage와 필드명
 * 이 다르다 — R2는 게이트웨이 타입을 직접 import하지 않으므로 자체 이름을 쓴다).
 * `llmStream`이 반환값을 안 주면(테스트 페이크 등) undefined일 수 있다 — 그때는
 * `estimateTokens` 추정치로 흡수한다.
 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface RecapServiceDeps extends RecapAssemblyDeps {
  savedRecap: SavedRecapRepository;
  sessionCache: SessionRecapCacheRepository;
  recapLog: RecapCallLogger;
  /**
   * LLM 게이트웨이 스트리밍 호출 (⑥ 경유는 이 함수를 주입하는 쪽의 책임).
   * 스트림이 끝날 때(`return`) 실제 토큰 사용량을 낼 수 있다 — `for await`는 그 반환값을
   * 버리므로 아래 `generateAndPersist`는 제너레이터를 수동으로 `.next()`해 받는다.
   * `options.maxTokens`는 분량 상한의 안전망이다(RECAP_MAX_TOKENS_SAFETY) — 실제 분량
   * 지시는 프롬프트가 담당하고, 이건 모델이 지시를 어겼을 때의 하드 캡일 뿐이다.
   */
  llmStream: (
    task: string,
    prompt: string,
    options?: { maxTokens?: number }
  ) => AsyncGenerator<string, LLMUsage | void>;
  /** 세션 캐시 만료 시각 계산용. 주입하지 않으면 24시간 뒤로 둔다(세션 종료 전 소멸 목적일 뿐 — TTL 자체는 스펙 미지정). */
  cacheTtlMs?: number;
}

export interface RecapService {
  /**
   * K에 대한 리캡을 반환한다. K=0이거나 재사용 가능하면 LLM을 부르지 않는다
   * (`empty` · `reused`). 그 외에는 스트리밍 생성 결과를 돌려준다(`generated`) —
   * 소비하는 즉시(청크를 전부 드레인하면) 캐시 적재와 로그 기록이 뒤따른다.
   *
   * `trigger = 'session_end'`는 재사용 판정을 타지 않고 항상 생성한다(R7, 진도 무관).
   * 생성분의 목적지도 다르다 — realtime은 세션 캐시(K), session_end는 저장 리캡 upsert.
   */
  getRecap(
    deviceId: string,
    bookId: string,
    cutoff: number,
    trigger: RecapTrigger
  ): Promise<RecapResult>;
}

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60_000;

/**
 * 리캡 분량 — 사용자 확정(2026-08-24): 500자 / 5문장 내외.
 * 2026-11-17 C안부터 프롬프트는 글자 수 대신 코드가 계산한 목표 문장 수 N(2~5)과 문장당
 * 길이(RECAP_SENTENCE_MAX_CHARS)로 지시한다(recap-length.ts). 500자는 아래 하드 상한으로만 남는다.
 */
const RECAP_TARGET_CHARS = 500;

/**
 * 목표 분량을 넘겨도 스트림이 끝없이 늘어나지 않게 하는 안전망. 한글은 토큰당 글자수가
 * 낮아(자모 단위 분절) 500자가 토큰 수로는 더 크게 잡힌다 — 목표 준수 시엔 걸리지 않고,
 * 모델이 지시를 무시했을 때만 강제로 끊는 하드 캡이다. 상한 강제(cutoff)와는 무관하다.
 */
const RECAP_MAX_TOKENS_SAFETY = 2048;

/**
 * 500자 실측 강제 상한 (2026-08-24, 이슈 대응) — 프롬프트 분량 지시는 "부탁"일
 * 뿐이라 모델이 지키지 않으면(실측 800자+ 확인됨) 그대로 새어나간다. 이 값은 스트리밍
 * 도중에 실제로 잘라내는 하드 상한이라, 공백 포함 결과 길이가 이 값을 넘는 경우가 없다.
 * 목표(최대 5문장 × 90자 = 450자 + 소제목)를 지키면 이 상한에 걸리지 않는다.
 *
 * 2026-11-17 C안에서도 그대로 둔다 — 사용자 확정값이고, 다 받은 뒤 앞 문장을 빼는 버퍼링
 * 방식은 스트리밍(NFR-PERF-002 🚦)을 깨므로 쓰지 않는다. 재생성 호출도 하지 않는다(LLM 1회).
 */
const RECAP_HARD_LIMIT_CHARS = RECAP_TARGET_CHARS;

export function createRecapService(deps: RecapServiceDeps): RecapService {
  const { savedRecap, sessionCache, recapLog, llmStream, cacheTtlMs = DEFAULT_CACHE_TTL_MS } = deps;

  return {
    async getRecap(
      deviceId: string,
      bookId: string,
      cutoff: number,
      trigger: RecapTrigger
    ): Promise<RecapResult> {
      if (cutoff <= 0) {
        return { kind: 'empty' }; // ❓Q1 — 생성 대상 자체가 없다. 호출 0회
      }

      if (trigger === 'realtime') {
        const saved = await savedRecap.findSavedRecap(deviceId, bookId);
        if (saved !== null && saved.cutoff_page === cutoff) {
          return { kind: 'reused', text: saved.recap_text }; // R8 — 완전 일치만 재사용
        }

        const cached = await sessionCache.findCached(deviceId, bookId, cutoff);
        if (cached !== null) {
          return { kind: 'reused', text: cached }; // UC-09 A7
        }
      }
      // trigger === 'session_end'는 재사용 판정 자체를 건너뛴다 — 세션 종료 잡은 진도와
      // 무관하게 항상 재종합한다(R7, 10% 규칙 폐지·D1).

      const chunks = generateAndPersist(deps, deviceId, bookId, cutoff, trigger, {
        savedRecap,
        sessionCache,
        recapLog,
        llmStream,
        cacheTtlMs,
      });
      return { kind: 'generated', chunks };
    },
  };
}

async function* generateAndPersist(
  assemblyDeps: RecapAssemblyDeps,
  deviceId: string,
  bookId: string,
  cutoff: number,
  trigger: RecapTrigger,
  io: {
    savedRecap: SavedRecapRepository;
    sessionCache: SessionRecapCacheRepository;
    recapLog: RecapCallLogger;
    llmStream: (
      task: string,
      prompt: string,
      options?: { maxTokens?: number }
    ) => AsyncGenerator<string, LLMUsage | void>;
    cacheTtlMs: number;
  }
): AsyncGenerator<string> {
  const input = await assembleRecapInput(assemblyDeps, bookId, cutoff); // FR-SPL-003 🚦 상한은 여기서만
  // 2026-11-17 C안 — 목표 문장 수는 이미 K로 절단된 조립 결과에서만 계산한다(NFR-AI-004 🚦)
  const targetSentences = computeRecapTargetSentences(
    input.chapter_summaries.length,
    hasCurrentChapterText(input)
  );
  const prompt = buildRecapPrompt(input, targetSentences);

  let fullText = '';
  const gen = io.llmStream('recap', prompt, { maxTokens: RECAP_MAX_TOKENS_SAFETY });
  let step = await gen.next();
  while (!step.done) {
    const next = fullText + step.value;
    if (next.length <= RECAP_HARD_LIMIT_CHARS) {
      fullText = next;
      yield step.value;
      step = await gen.next();
      continue;
    }
    // 이 청크까지 받으면 하드 상한을 넘는다 — 문장 경계에서 잘라내고 남은 생성은 취소한다
    const truncated = truncateAtBoundary(next, RECAP_HARD_LIMIT_CHARS);
    const appended = truncated.slice(fullText.length);
    if (appended.length > 0) yield appended;
    fullText = truncated;
    try {
      // 이미 목표를 초과했으니 남은 토큰 생성을 이어갈 이유가 없다 — 순수 비용 최적화라
      // 취소 자체가 실패해도(예: 실제 게이트웨이가 스트림을 강제로 끊을 때 내부적으로
      // 에러를 던지는 경우) 이미 확보한 fullText로 정상 진행해야 한다. 여기서 던지면
      // 상한을 지키려던 로직이 오히려 응답 전체를 500으로 만든다 — 본말전도.
      await gen.return(undefined);
    } catch {
      // 취소 실패는 무시 — 위 이유
    }
    step = { done: true, value: undefined };
  }
  const usage: LLMUsage | undefined = step.value ?? undefined; // gen.next()의 마지막 호출 — TReturn 값 (for await로는 못 받는다)

  if (trigger === 'realtime') {
    await io.sessionCache.saveCached(
      deviceId,
      bookId,
      cutoff,
      fullText,
      new Date(Date.now() + io.cacheTtlMs)
    ); // FR-DAT-010 — 영구 저장 없음
  } else {
    await io.savedRecap.upsertSavedRecap(deviceId, bookId, cutoff, fullText); // FR-DAT-009
  }

  const unknownNames = await measureUnknownNames(assemblyDeps, bookId, cutoff, input, fullText);
  try {
    await io.recapLog.record(
      buildRecapCallLog(
        deviceId,
        bookId,
        input,
        fullText,
        trigger,
        usage,
        targetSentences,
        unknownNames
      )
    ); // NFR-OBS-002 🚦
  } catch (error) {
    // 리캡은 이미 다 나갔고 캐시·저장도 끝났다. 여기서 던지면 로그는 어차피 못 살리고 완성된
    // 리캡만 오류로 바뀐다. 삼키지 않고 서버 오류 로그로 남긴다 — 로그 유실은 게이트 판정
    // 근거의 유실이라 운영에서 바로 보여야 한다.
    console.error('[recap] 호출 로그 적재 실패', { bookId, cutoff, trigger, error });
  }
}

/**
 * 리캡 출력의 이름꼴 낱말 중 허용 사전·입력 자료에 없는 것 (FR-RCP-001 🚦). LLM 호출 없음(R9).
 *
 * 사전은 cutoff를 실어 조회한다 — K를 넘는 이름은 비교용으로도 읽지 않는다(FR-SPL-002 🚦,
 * 절대 규칙 1·7번). 비교 대상인 입력 자료도 조립 단계에서 이미 K로 잘린 것이다.
 *
 * 측정에 실패하면 null을 돌려준다(로그 컬럼 NULL). 측정은 부가 기능이라 실패가 리캡이나
 * 기본 로그를 깨지 않아야 한다.
 */
async function measureUnknownNames(
  deps: RecapAssemblyDeps,
  bookId: string,
  cutoff: number,
  input: RecapInput,
  outputText: string
): Promise<string[] | null> {
  try {
    const dictionary = await deps.content.findIntroducedNames(bookId, cutoff);
    const source = [
      ...input.chapter_summaries.map((s) => `${s.title}\n${s.content}`),
      input.current_chapter_text ?? '',
    ].join('\n');
    return findUnknownNames(outputText, dictionary, source);
  } catch (error) {
    console.error('[recap] 고유명사 측정 실패', { bookId, cutoff, error });
    return null;
  }
}

/**
 * 조립 결과에 읽는 중인 장 원문이 실제로 들어갔는지. 프롬프트가 빈 원문을 "(없음)"으로
 * 쓰는 기준과 맞춘다 — 빈 문자열은 원문 없음으로 본다.
 */
function hasCurrentChapterText(input: RecapInput): boolean {
  return input.current_chapter_text !== null && input.current_chapter_text.trim().length > 0;
}

/**
 * 상한은 조립 단계(recap-assembly.ts)에서 이미 절단됐다. 이 프롬프트는 **종합 지시만**
 * 담당한다 — "기준점 이후를 쓰지 마"류 지시를 넣지 않는다(NFR-AI-004 🚦, 절대 규칙 3번).
 *
 * 분량 지시 추가(2026-08-24, 이슈 대응, PR #16과 병합) — 예전 프롬프트는 분량을 정하지
 * 않아 K가 작을 때(자료 적음)와 클 때(완결 장 요약이 여러 개 누적)의 출력 길이가 크게
 * 벌어졌다. 분량 지시는 "무엇을 보여줄지"(상한)가 아니라 "얼마나 길게 말할지"(종합 방식)라
 * 데이터 선택 단계의 책임을 침범하지 않는다.
 *
 * 분량 지시 교체(2026-11-17 C안, 대표 승인) — "5문장 내외, 500자 이내 … 자료가 적으면 있는
 * 것만 짧게"는 ① '적다' 판단을 모델에 맡기고 ② 글자 수(모델이 가장 못 지키는 단위)로만
 * 상한을 걸어 길이가 들쭉날쭉했다. 이제 코드가 계산한 N(recap-length.ts)으로 "정확히 N문장,
 * 각 문장 90자 이내"를 지시하고, 판단 위임 문구는 뺐다.
 * 환각 금지 줄("자료에 없는 내용을 지어내지 마라")은 그대로 둔다 — 정확히 N문장을 채우려고
 * 자료에 없는 내용을 지어낼 수 있다. 목표 문장 수와 지어내기 금지는 서로 다른 실패 모드를
 * 겨눈다(FR-RCP-001 🚦).
 *
 * 소제목 문구 고정(2026-08-24, 사용자 요청) — 모델이 지시 없이도 종종 "# 줄거리 요약"
 * 같은 마크다운 제목을 앞에 붙였다(프론트는 마크다운을 파싱하지 않아 "#" 기호가 그대로
 * 노출됨). 제목 자체를 금지하는 대신, 정확히 이 문구("이전 이야기 요약")로 고정해 어느
 * 쪽이 나와도 일관되게 만든다.
 */
function buildRecapPrompt(input: RecapInput, targetSentences: number): string {
  const summaries = input.chapter_summaries
    .map((s) => `[${s.chapter_no}장 ${s.title}] ${s.content}`)
    .join('\n');
  const currentChapter = input.current_chapter_text ?? '';
  // N이 2~3이면 문단을 억지로 쪼개지 않는다
  const paragraphs =
    targetSentences <= 3
      ? '1~2개의 짧은 문단으로 써라. 문단을 나눌 때는 빈 줄로 구분해라.'
      : '한 문단으로 몰아쓰지 말고 2~3개의 짧은 문단으로 나눠라. 문단 사이는 빈 줄로 구분해라.';

  return [
    '아래 자료만으로 독자가 지금까지 읽은 줄거리를 이어서 요약해라.',
    '첫 줄에 정확히 "이전 이야기 요약"이라는 소제목만 쓰고, 빈 줄로 구분한 뒤 본문을 이어서 써라.',
    `소제목을 뺀 본문은 정확히 ${targetSentences}문장으로 써라. 각 문장은 ${RECAP_SENTENCE_MAX_CHARS}자 이내로 써라.`,
    paragraphs,
    '소제목 외에는 "#" 같은 마크다운 기호를 쓰지 말고 본문 문단만 써라.',
    '자료에 없는 내용을 지어내지 마라.', // FR-RCP-001 🚦 환각 금지 — 문장 수를 채우려 지어내는 것도 포함
    // ⚠️ 상한("기준점 이후는 쓰지 마")류 지시는 넣지 않는다 — NFR-AI-004 🚦, 절대 규칙 3번
    '완결된 장 요약:',
    summaries || '(없음)',
    '현재 장에서 읽은 부분:',
    currentChapter || '(없음)',
  ].join('\n\n');
}

/**
 * 하드 상한(RECAP_HARD_LIMIT_CHARS) 실제 절단 지점 — limit 이내에서 마지막 문장 부호
 * (.!?) 또는 문단 구분(개행)을 찾아 그 직후에서 자른다. 경계가 없으면(예: 첫 문장이
 * 이미 limit보다 김) limit에서 그냥 끊는다 — 매끄러움보다 상한 보장이 우선이다.
 */
function truncateAtBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const boundary = Math.max(
    window.lastIndexOf('.'),
    window.lastIndexOf('!'),
    window.lastIndexOf('?'),
    window.lastIndexOf('\n')
  );
  return boundary > 0 ? text.slice(0, boundary + 1).trimEnd() : window.trimEnd();
}

function buildRecapCallLog(
  deviceId: string,
  bookId: string,
  input: RecapInput,
  outputText: string,
  trigger: RecapTrigger,
  usage: LLMUsage | undefined,
  targetSentences: number,
  unknownNames: string[] | null
): RecapCallLog {
  return {
    timestamp: new Date(),
    device_id: deviceId,
    book_id: bookId,
    cutoff_page: input.cutoff,
    input_chapter_summary_ids: input.chapter_summaries.map((s) => String(s.chapter_no)),
    current_chapter_cutoff: input.current_chapter_text !== null ? input.cutoff : null,
    output_ref: outputText,
    model: getModelForTask('recap'), // 실제 매핑된 모델 ID (R3 소유 설정, model-config.ts)
    tokens: usage
      ? { input: usage.inputTokens, output: usage.outputTokens } // 게이트웨이 실사용량 (커밋 410f558)
      : estimateTokens(input, outputText), // llmStream이 usage를 안 주는 경우(예: 테스트 페이크)의 대체
    trigger,
    // 2026-11-17 C안 — 목표 대비 실제 길이 분포를 보려고 남긴다(NFR-OBS-002 🚦, 017 마이그레이션)
    target_sentences: targetSentences,
    output_chars: outputText.length, // 하드 상한과 같은 기준: 공백·소제목 포함, 잘린 뒤 길이
    output_sentences: countRecapSentences(outputText),
    // 고유명사 측정(020 마이그레이션) — null은 측정 못 함, 0은 걸린 것 없음
    unknown_name_count: unknownNames === null ? null : unknownNames.length,
    unknown_names: unknownNames,
  };
}

/**
 * `llmStream` 의존성이 usage를 반환하지 않을 때만 쓰는 대체 추정치 — 실제 게이트웨이
 * (`gateway.ts`)는 커밋 410f558부터 스트림 종료 시 진짜 토큰 수를 반환한다.
 */
function estimateTokens(input: RecapInput, outputText: string): { input: number; output: number } {
  const inputChars =
    input.chapter_summaries.reduce((sum, s) => sum + s.content.length, 0) +
    (input.current_chapter_text?.length ?? 0);
  return {
    input: Math.ceil(inputChars / 2),
    output: Math.ceil(outputText.length / 2),
  };
}
