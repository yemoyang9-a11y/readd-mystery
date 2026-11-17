import type { QuestionIntent } from './question-intent';

export type GuardViolation =
  'page_beyond_cutoff' | 'quote_not_in_source' | 'verdict_phrase' | 'verbatim_over_limit';

export interface GuardResult {
  ok: boolean;
  violations: GuardViolation[];
}

export interface GuardOptions {
  cutoff: number;
  pages: ReadonlyArray<{ page_no: number; content: string }>;
  intent?: QuestionIntent;
  echoedUserText?: ReadonlyArray<string>;
  /** 모델에 들어간 다른 원문(현재 장 원문 등). 원문 출력 상한 계산에만 쓴다. */
  rawText?: ReadonlyArray<string>;
}

/** 2026-11-17 대표 결정: 답변 하나에 책 원문을 그대로 옮기는 양은 합계 200자까지 */
export const VERBATIM_LIMIT = 200;
/** 공백·따옴표를 뺀 10자 이상이 원문과 이어서 같을 때만 원문 복사로 센다 */
const VERBATIM_RUN = 10;

const MIN_QUOTE_LENGTH = 8;

const PAGE_PATTERNS = [
  /(\d{1,5})(?:\s*[~\-–—]\s*(\d{1,5}))?\s*(?:쪽|페이지)/gu,
  /(?<![A-Za-z])pp?\.?\s*(\d{1,5})(?:\s*[~\-–—]\s*(\d{1,5}))?/giu,
  /\bpages?\s*(\d{1,5})(?:\s*[~\-–—]\s*(\d{1,5}))?/giu,
];

const QUOTE_PATTERNS = [/「([^」]+)」/gu, /『([^』]+)』/gu, /“([^”]+)”/gu, /"([^"\n]+)"/gu];

const ALWAYS_VERDICT: RegExp[] = [
  /그렇게\s*보(?:셔도|아도|시는\s*게)|무리(?:가|는)\s*없/u,
  /(?:범인|진범|공범|배후|용의자)(?:일|이)?[^.?!]{0,10}가능성|가능성이\s*(?:높|낮)/u,
  /맞는\s*것\s*(?:같|처럼)|맞을\s*(?:것|수)/u,
  /좋은\s*(?:추리|가설|추측|생각|접근)|(?:추리|가설|방향|추측|의심)[^.?!]{0,6}(?:훌륭|날카|정확|옳|합리적)|방향이\s*(?:맞|틀|옳)/u,
  /의심할\s*만|유력(?:한|해|하)/u,
  /범인(?:일|이\s*아닐|이\s*아닌|이\s*맞|으로\s*보)/u,
  /정답(?:이|은|입니다|이에요|이야|이네요|이죠|이다)|오답/u,
  /(?:추리|가설|짐작|예상|추측)(?:이|가|은|는)?\s*(?:맞|옳|틀|정확)/u,
  /(?:범인|진범|살인자|흉수)(?:은|이|는)\s*(?!누구|아직|아무|알\s*수|밝혀지지)[가-힣A-Za-z○Ｏ·]{1,10}\s*(?:입니다|이에요|예요|이야|이다|이죠|이네요|였|이었)/u,
  /(?:범인|진범)(?:으로|이라고)?\s*(?:확정|단정|확실|틀림없)/u,
  /(?:범인|진범)(?:이|은)?\s*(?:맞|아니)(?:아요|습니다|네요|죠|어요|에요)/u,
  /\bthe\s+(?:culprit|killer|murderer)\s+is\b/iu,
  /\b(?:is|was)\s+the\s+(?:culprit|killer|murderer)\b/iu,
  /\byou(?:'re|\s+are)\s+(?:right|correct|wrong)\b/iu,
];

const HYPOTHESIS_VERDICT: RegExp[] = [
  /맞(?:아요|습니다|네요|죠|아|다)(?![가-힣])|네,?\s*맞/u,
  /틀렸(?:어요|습니다|네요|어|다)|틀려요/u,
  /아니에요|아니예요|아닙니다/u,
  /\b(?:that'?s|this\s+is)\s+(?:correct|right|wrong)\b/iu,
];

function collectPageNumbers(answer: string): number[] {
  const numbers: number[] = [];
  for (const pattern of PAGE_PATTERNS) {
    for (const match of answer.matchAll(pattern)) {
      for (const group of [match[1], match[2]]) if (group) numbers.push(Number(group));
    }
  }
  return numbers;
}

function compact(text: string): string {
  return text.replace(/[\s"'“”‘’「」『』]+/gu, '');
}

function collectQuotes(answer: string): string[] {
  const quotes: string[] = [];
  for (const pattern of QUOTE_PATTERNS) {
    for (const match of answer.matchAll(pattern)) quotes.push(match[1]);
  }
  return quotes;
}

function quoteSegments(quote: string): string[] {
  return quote
    .split(/…|\.{3}|⋯/u)
    .map(compact)
    .filter((segment) => segment.length >= MIN_QUOTE_LENGTH);
}

const IGNORED = /[\s"'“”‘’「」『』]/u;

function ngrams(text: string, into: Set<string>): void {
  const c = compact(text);
  for (let i = 0; i + VERBATIM_RUN <= c.length; i++) into.add(c.slice(i, i + VERBATIM_RUN));
}

/**
 * 답변 안에서 원문과 이어서 같은 부분의 글자 수(공백 포함, 원래 답변 기준).
 * 독자가 직접 보낸 문장(echoed)과 겹치는 조각은 세지 않는다.
 */
export function verbatimLength(
  answer: string,
  sources: ReadonlyArray<string>,
  echoed: ReadonlyArray<string> = []
): number {
  return createVerbatimMeter(sources, echoed)(answer);
}

/**
 * 원문·독자 문장의 조각 집합을 한 번만 만들고 답변마다 재는 측정기.
 * 스트리밍 중 청크마다 재야 하는 경로(FR-QNA-004 🚦 outside)에서 쓴다.
 */
export function createVerbatimMeter(
  sources: ReadonlyArray<string>,
  echoed: ReadonlyArray<string> = []
): (answer: string) => number {
  const grams = new Set<string>();
  sources.forEach((source) => ngrams(source, grams));
  const excluded = new Set<string>();
  echoed.forEach((text) => ngrams(text, excluded));
  return (answer: string) => measureVerbatim(answer, grams, excluded);
}

function measureVerbatim(answer: string, grams: Set<string>, excluded: Set<string>): number {
  const chars: string[] = [];
  const index: number[] = [];
  Array.from(answer).forEach((ch, i) => {
    if (!IGNORED.test(ch)) {
      chars.push(ch);
      index.push(i);
    }
  });
  const text = chars.join('');
  const covered = new Array<boolean>(chars.length).fill(false);
  for (let i = 0; i + VERBATIM_RUN <= chars.length; i++) {
    const gram = text.slice(i, i + VERBATIM_RUN);
    if (grams.has(gram) && !excluded.has(gram)) covered.fill(true, i, i + VERBATIM_RUN);
  }

  let total = 0;
  for (let i = 0; i < covered.length; i++) {
    if (!covered[i]) continue;
    let j = i;
    while (j + 1 < covered.length && covered[j + 1]) j++;
    total += index[j] - index[i] + 1;
    i = j;
  }
  return total;
}

export function guardAnswer(answer: string, options: GuardOptions): GuardResult {
  const { cutoff, pages, intent, echoedUserText = [], rawText = [] } = options;
  const violations: GuardViolation[] = [];

  // FR-QNA-004 🚦 R4
  if (collectPageNumbers(answer).some((page) => page > cutoff)) {
    violations.push('page_beyond_cutoff');
  }

  const sources = [
    ...pages.filter((page) => page.page_no >= 1 && page.page_no <= cutoff).map((p) => p.content),
    ...echoedUserText,
  ].map(compact);
  const quoteMissing = collectQuotes(answer).some((quote) =>
    quoteSegments(quote).some((segment) => !sources.some((source) => source.includes(segment)))
  );
  if (quoteMissing) violations.push('quote_not_in_source');

  // 2026-11-17 원문 출력 상한: 출판사 작품 원문을 대량으로 재현하지 않는다
  const rawSources = [...pages.map((page) => page.content), ...rawText];
  if (verbatimLength(answer, rawSources, echoedUserText) > VERBATIM_LIMIT) {
    violations.push('verbatim_over_limit');
  }

  // NFR-AI-005
  const strict = intent !== undefined && intent !== 'fact' && intent !== 'outside';
  const patterns = strict ? [...ALWAYS_VERDICT, ...HYPOTHESIS_VERDICT] : ALWAYS_VERDICT;
  if (patterns.some((pattern) => pattern.test(answer))) violations.push('verdict_phrase');

  return { ok: violations.length === 0, violations };
}
