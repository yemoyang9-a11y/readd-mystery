/**
 * 장 요약 문장별 근거 확인 — FR-DAT-003 🚦 · NFR-AI-004
 *
 * 장 요약은 리캡·타임라인의 입력인데 지금까지 코드 수준 근거 확인이 없었다(사람 검수만).
 * 1) 요약을 문장으로 나눈다(코드).
 * 2) LLM 1회/장: 문장마다 그 장 원문에서 그대로 옮긴 근거 인용 하나를 받는다. 입력은 그 장
 *    원문뿐이다 — 뒤 장 원문은 0자다(FR-SPL-002 🚦).
 * 3) 코드가 인용이 그 장의 그 쪽 원문에 실제로 있는지 확인한다(validEvidence).
 * 4) 확인하지 못한 문장은 지우거나 고치지 않는다. 요약에 검수 후보
 *    (summary_sentence_ungrounded)를 붙여 사람이 본다.
 *
 * 인용이 원문에 있다는 것은 필요조건일 뿐 문장이 옳다는 증명이 아니다. 사람 검수를 대신하지
 * 않고 볼 곳을 좁혀 줄 뿐이다. 배치 전용이라 런타임 호출 수(R9)와 무관하고, 호출은 주입된
 * ask(게이트웨이 경유)로만 한다(4.3절).
 */
import { Chapter, Page } from '../../shared/types';
import { buildPageTaggedText } from './generate';
import { ReviewCandidate, validEvidence } from './grounding';

/** 게이트웨이 작업 이름 — 비용 지표를 요약 생성과 나눈다(NFR-OBS-004). 모델은 generate_summary 것을 빌린다 */
export const SUMMARY_GROUNDING_TASK = 'generate_summary_grounding';
/** 캐시 계약 버전 — 검증 규칙이 바뀌면 올린다 */
export const SUMMARY_GROUNDING_VERSION = 'summary-grounding-v1';
/** 공백·따옴표를 뺀 인용 최소 길이 — "그는" 같은 조각은 어느 문장의 근거도 되지 못한다 */
export const MIN_QUOTE_LENGTH = 10;

export type SummaryGroundingDetail = 'no_quote' | 'quote_too_short' | 'quote_not_in_chapter';

export interface UngroundedSentence {
  /** 1부터 — 프롬프트에 붙인 문장 번호 */
  index: number;
  sentence: string;
  detail: SummaryGroundingDetail;
}

export type AskSummaryGrounding = (
  prompt: string,
  task: typeof SUMMARY_GROUNDING_TASK
) => Promise<unknown>;

const TERMINATORS = '.!?。！？';
const OPENERS = '“‘「『';
const CLOSERS = '”’」』';
const TRAILING = `"'”’」』)`;
const IGNORED_IN_LENGTH = /[\s“”„‟"«»「」『』〝〞‘’‚‛'`´〈〉《》]/gu;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 요약을 문장으로 나눈다. 따옴표 안의 마침표에서는 나누지 않는다 */
export function splitSummarySentences(summary: string): string[] {
  const sentences: string[] = [];
  let current = '';
  let depth = 0;
  let straightOpen = false;
  for (let i = 0; i < summary.length; i++) {
    const ch = summary[i];
    current += ch;
    if (ch === '"') straightOpen = !straightOpen;
    else if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
    if (!TERMINATORS.includes(ch) || depth > 0 || straightOpen) continue;
    // 1.5처럼 숫자 사이의 점은 문장 끝이 아니다
    if (ch === '.' && /\d/.test(summary[i - 1] ?? '') && /\d/.test(summary[i + 1] ?? '')) continue;
    while (i + 1 < summary.length && (TERMINATORS + TRAILING).includes(summary[i + 1])) {
      current += summary[++i];
    }
    sentences.push(current);
    current = '';
  }
  sentences.push(current);
  return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 입력은 그 장 원문과 요약 문장뿐이다 — FR-SPL-002 🚦 */
export function buildSummaryGroundingPrompt(
  chapter: Chapter,
  pages: Page[],
  sentences: string[]
): string {
  return `다음은 이 작품 ${chapter.chapter_no}장 "${chapter.title}"의 원문 전체(각 문단 앞에 [페이지 N] 표시)와, 이 장을 요약한 문장 목록이다.
요약 문장마다 그 문장을 뒷받침하는 원문 한 곳을 찾아 그대로 인용하라. 요약 문장을 고치거나 평가하지 않는다.

규칙:
- quote는 원문에서 그대로 복사한 부분 문자열이다(고치거나 줄이거나 이어 붙이지 않는다). 한 페이지 안에서 한 번만 나오는 ${MIN_QUOTE_LENGTH}자 이상의 문자열을 고른다.
- source_page는 그 인용이 있는 [페이지 N]의 숫자다.
- 아래 원문에서 뒷받침하는 곳을 찾을 수 없으면 지어내지 말고 source_page와 quote를 null로 둔다. 이 원문 밖에서 아는 내용으로 채우지 않는다.
- 모든 문장 번호에 대해 하나씩 답한다.

출력은 아래 JSON 형식만 반환하라. 다른 설명·마크다운 코드블록 없이 JSON 텍스트만 출력하라.
{"sentences": [{"index": 1, "source_page": 0, "quote": "..."}]}

--- 요약 문장 ---
${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

--- 원문 ---
${buildPageTaggedText(pages)}`;
}

/**
 * LLM 호출 단계 — 장당 1회. 원본 응답만 돌려준다(검증은 summaryGroundingCandidates).
 * 호출 실패는 잡지 않는다 — 실패를 "근거 있음"으로 바꾸는 경로를 두지 않는다(FR-SPL-005 🚦).
 */
export async function requestSummaryGrounding(
  chapter: Chapter,
  pages: Page[],
  summary: string,
  ask: AskSummaryGrounding
): Promise<unknown> {
  const sentences = splitSummarySentences(summary);
  if (sentences.length === 0) return null;
  return ask(buildSummaryGroundingPrompt(chapter, pages, sentences), SUMMARY_GROUNDING_TASK);
}

function checkQuote(entry: Record<string, unknown>, pages: Page[]): SummaryGroundingDetail | null {
  if (typeof entry.quote !== 'string' || entry.quote.trim().length === 0) return 'no_quote';
  if (entry.quote.replace(IGNORED_IN_LENGTH, '').length < MIN_QUOTE_LENGTH)
    return 'quote_too_short';
  // pages는 그 장의 쪽뿐이다 — 다른 장 쪽 번호나 다른 장 문장은 여기서 찾지 못한다
  return validEvidence(entry, pages, entry.source_page, []) ? null : 'quote_not_in_chapter';
}

/**
 * 원본 응답을 결정적으로 검증한다 — 새 실행과 캐시 재생이 같은 검증을 거친다. NFR-AI-004
 * 근거를 확인하지 못한 문장이 있으면 그 문장들을 적은 검수 후보 1건을 낸다. 요약은 그대로 둔다.
 */
export function summaryGroundingCandidates(
  chapterNo: number,
  summary: string,
  pages: Page[],
  raw: unknown
): ReviewCandidate[] {
  const sentences = splitSummarySentences(summary);
  const answers = object(raw).sentences;
  const entries = (Array.isArray(answers) ? answers : []).map(object);
  const ungrounded: UngroundedSentence[] = [];
  sentences.forEach((sentence, i) => {
    const index = i + 1;
    const mine = entries.filter((e) => e.index === index);
    const detail =
      mine.length === 0
        ? 'no_quote'
        : mine.map((e) => checkQuote(e, pages)).find((d) => d !== null);
    if (detail) ungrounded.push({ index, sentence, detail });
  });
  // 확인할 문장이 없는 요약도 "근거 확인됨"이 아니다
  if (sentences.length > 0 && ungrounded.length === 0) return [];
  return [
    {
      kind: 'summary',
      reason: 'summary_sentence_ungrounded',
      candidate: { chapter_no: chapterNo, summary, sentences: ungrounded },
    },
  ];
}
