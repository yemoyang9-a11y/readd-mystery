import type { QuestionIntent } from './question-intent';

export type GuardViolation = 'page_beyond_cutoff' | 'quote_not_in_source' | 'verdict_phrase';

export interface GuardResult {
  ok: boolean;
  violations: GuardViolation[];
}

export interface GuardOptions {
  cutoff: number;
  pages: ReadonlyArray<{ page_no: number; content: string }>;
  intent?: QuestionIntent;
  echoedUserText?: ReadonlyArray<string>;
}

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

export function guardAnswer(answer: string, options: GuardOptions): GuardResult {
  const { cutoff, pages, intent, echoedUserText = [] } = options;
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

  // NFR-AI-005
  const strict = intent !== undefined && intent !== 'fact' && intent !== 'outside';
  const patterns = strict ? [...ALWAYS_VERDICT, ...HYPOTHESIS_VERDICT] : ALWAYS_VERDICT;
  if (patterns.some((pattern) => pattern.test(answer))) violations.push('verdict_phrase');

  return { ok: violations.length === 0, violations };
}
