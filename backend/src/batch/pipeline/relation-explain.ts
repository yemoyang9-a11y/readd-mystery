import { createHash } from 'crypto';
import { call } from '../../modules/llm-gateway/gateway';
import { parseJsonResponse } from './generate';
import { introducedNames } from './reader-text';
import { evaluativeWord } from './semantic-guards';

export const EXPLAIN_TASK = 'explain_relation';
export const EVIDENCE_MAX_LENGTH = 120;
export const EXPLANATION_MAX_LENGTH = 110;
export const EXPLANATION_SENTENCE_MAX_LENGTH = 60;

const BATCH_SIZE = 10;
const MAX_TOKENS = 8000;
const JSON_PARSE_RETRIES = 2;
const META_WORDS = ['원문', '본문', '작품에서', '서술', '페이지', '텍스트', '입력', '인용', '요약'];
const EASY_ENDING = /요[.?!]?$/u;
const HEDGED_STATUSES = ['claim', 'belief', 'rumor', 'uncertain'];
const GIVEN_NAME_SOURCE = /^[가-힣]{3}$/u;
const LEADING_NOISE = /^[\s•·\-:]+/u;
const SENTENCE_PATTERN = /[^.?!]*[.?!]+[”"'’』」)]*|[^.?!]+$/gu;
const CLAUSE_PATTERN = /[^,，、“”"『』「」]+/gu;

export type NameGroup = string[];

interface Span {
  text: string;
}

function nameVariants(group: NameGroup): string[] {
  const variants = group.flatMap((name) => {
    const trimmed = name.trim();
    return GIVEN_NAME_SOURCE.test(trimmed) ? [trimmed, trimmed.slice(1)] : [trimmed];
  });
  return [...new Set(variants.filter((v) => v.length > 0))];
}

const LEADING_CONNECTIVE = /^(하고|라고|이라고|며)\s+/u;
const TRAILING_LEADER = /\s*(\.{3,}|…)\s*$/u;
const CLOSERS = /[”’」』"']$/u;
const OPENERS = /[“‘「『]/u;

function trimSpan(text: string): Span | undefined {
  let body = text.trim().replace(LEADING_NOISE, '').replace(LEADING_CONNECTIVE, '');
  body = body.replace(TRAILING_LEADER, '').trim();
  if (CLOSERS.test(body) && !OPENERS.test(body) && !/^["']/.test(body))
    body = body.slice(0, -1).trim();
  return body.length === 0 ? undefined : { text: body };
}

function sentenceSpans(quote: string): Span[] {
  const spans: Span[] = [];
  for (const line of quote.split('\n')) {
    for (const match of line.matchAll(SENTENCE_PATTERN)) {
      const span = trimSpan(match[0]);
      if (span) spans.push(span);
    }
  }
  return spans;
}

function groupHits(text: string, variants: string[][]): number {
  return variants.filter((group) => group.some((name) => text.includes(name))).length;
}

function clauseWindows(sentence: Span): string[] {
  const segments = [...sentence.text.matchAll(CLAUSE_PATTERN)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const windows: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i; j < segments.length; j++) {
      const text = sentence.text.slice(segments[i].start, segments[j].end).trim();
      if (text.length > 0 && text.length <= EVIDENCE_MAX_LENGTH) windows.push(text);
    }
  }
  return windows;
}

const longest = (texts: string[]): string | null =>
  texts.reduce<string | null>(
    (best, text) => (best === null || text.length > best.length ? text : best),
    null
  );

const LABEL_KEYWORDS: Record<string, string[]> = {
  사랑: ['사랑', '사모'],
  미워: ['미워', '미움', '증오'],
  의심: ['의심', '범인'],
  연인: ['연인', '애인', '첫사랑'],
  친구: ['친구'],
  부부: ['부부', '부인', '남편'],
};

export function relationKeywords(label: string): string[] {
  const stem = label.trim().replace(/(한다|이다|다)$/, '');
  const matched = Object.entries(LABEL_KEYWORDS).find(([key]) => stem.startsWith(key));
  if (matched) return matched[1];
  return stem.length >= 2 ? [stem] : [];
}

// FR-SPL-002 🚦
export function pickEvidenceLine(
  quote: string,
  names: NameGroup[],
  keywords: string[] = []
): string | null {
  const variants = names.map(nameVariants);
  const sentences = sentenceSpans(quote);
  if (keywords.length > 0) {
    const mentions = (text: string): boolean => keywords.some((keyword) => text.includes(keyword));
    const canonical = names.map((group) => nameVariants(group.slice(0, 1)));
    const keyed = sentences
      .filter(
        (s) =>
          s.text.length <= EVIDENCE_MAX_LENGTH &&
          mentions(s.text) &&
          groupHits(s.text, variants) >= 1
      )
      .sort(
        (a, b) =>
          groupHits(b.text, canonical) - groupHits(a.text, canonical) ||
          groupHits(b.text, variants) - groupHits(a.text, variants) ||
          a.text.length - b.text.length
      )[0];
    if (keyed) return keyed.text;
  }
  for (let need = variants.length; need >= 1; need--) {
    const whole = longest(
      sentences
        .filter((s) => s.text.length <= EVIDENCE_MAX_LENGTH && groupHits(s.text, variants) >= need)
        .map((s) => s.text)
    );
    if (whole) return whole;
    const clause = longest(
      sentences
        .filter((s) => s.text.length > EVIDENCE_MAX_LENGTH)
        .flatMap(clauseWindows)
        .filter((text) => groupHits(text, variants) >= need)
    );
    if (clause) return clause;
  }
  return null;
}

export interface ExplainInput {
  key: string;
  names: [string, string];
  label: string;
  assertionStatus: string;
  attribution?: string;
  evidenceLine: string;
  quote: string;
}

// NFR-AI-004
export function buildExplainPrompt(items: ExplainInput[]): string {
  const payload = items.map((item) => ({
    key: item.key,
    names: item.names,
    relation: item.label,
    assertion_status: item.assertionStatus,
    attribution: item.attribution ?? null,
    evidence_line: item.evidenceLine,
    quote: item.quote,
  }));
  return `아래 인물 관계마다, 그 관계가 왜 그렇게 말할 수 있는지 독자에게 설명하는 짧은 글을 써라.

규칙:
- 1~2문장, 모든 문장은 해요체로 끝낸다(예: ~예요, ~해요, ~이에요).
- 한 문장당 ${EXPLANATION_SENTENCE_MAX_LENGTH}자 이하, 전체 ${EXPLANATION_MAX_LENGTH}자 이하로 쓴다.
- quote에 없는 사실, 추측, 판정을 더하지 않는다.
- 누가 누구에게 무엇을 했는지(주어와 목적어)는 quote와 똑같이 쓴다. 대사의 화자와 그 말이 가리키는 사람이 확실하지 않으면 그 부분은 쓰지 않는다. 예: 누구의 자백인지 quote에서 확실하지 않으면 '자백'의 주인을 쓰지 않는다.
- 범인이나 결말을 지목하거나 암시하지 않는다.
- assertion_status가 claim, belief, rumor, uncertain이면 attribution이 누구의 말이나 생각인지 문장에 밝히고, 사실처럼 쓰지 않는다.
- 원문, 본문, 페이지, 텍스트, 인용, 요약 같은 말을 쓰지 않는다.
- names의 두 이름을 모두 문장에 그대로 넣는다.
- evidence_line을 그대로 되풀이하지 않고, 그 장면이 왜 이 relation을 뒷받침하는지 풀어 쓴다.
- 입력의 key를 그대로 돌려준다.

출력은 설명 없이 JSON 객체 하나만: {"items":[{"key":"...","explanation":"..."}]}

입력:
${JSON.stringify(payload, null, 2)}`;
}

// R9
export function explanationRejection(
  input: ExplainInput,
  out: string,
  lexicon: string[] = []
): string | undefined {
  const text = out.trim();
  if (text.length === 0) return 'empty';
  if (text.length > EXPLANATION_MAX_LENGTH) return 'too_long';
  const sentences = text.split(/(?<=[.?!])\s+/u);
  if (sentences.length > 2) return 'too_many_sentences';
  if (sentences.some((s) => s.length > EXPLANATION_SENTENCE_MAX_LENGTH)) return 'sentence_too_long';
  if (!sentences.every((s) => EASY_ENDING.test(s))) return 'not_easy_ending';
  if (!input.names.every((name) => nameVariants([name]).some((v) => text.includes(v)))) {
    return 'missing_name';
  }
  if (META_WORDS.some((word) => text.includes(word))) return 'meta_word';
  if (evaluativeWord(text)) return 'evaluative_word';
  if (text.includes('범인') && !input.quote.includes('범인')) return 'culprit_word';
  if (
    HEDGED_STATUSES.includes(input.assertionStatus) &&
    input.attribution &&
    !nameVariants([input.attribution]).some((v) => text.includes(v))
  ) {
    return 'missing_attribution';
  }
  if (introducedNames(`${input.quote} ${input.names.join(' ')}`, text, lexicon).length > 0) {
    return 'new_proper_noun';
  }
  return undefined;
}

export const validateExplanation = (
  input: ExplainInput,
  out: string,
  lexicon: string[] = []
): boolean => explanationRejection(input, out, lexicon) === undefined;

async function explainBatch(
  batch: ExplainInput[]
): Promise<{ key: string; explanation: string }[]> {
  const prompt = buildExplainPrompt(batch);
  for (let attempt = 1; ; attempt++) {
    const raw = await call(EXPLAIN_TASK, prompt, { maxTokens: MAX_TOKENS, attempt }); // NFR-OBS-004 (측정)
    try {
      const parsed = parseJsonResponse<{ items?: { key: string; explanation: string }[] }>(raw);
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch (err) {
      if (attempt > JSON_PARSE_RETRIES) throw err;
      console.warn(`[JSON 재시도] task=${EXPLAIN_TASK} 시도=${attempt + 1}`);
    }
  }
}

export interface ExplainOutcome {
  explanation: string | null;
  reason: string | null;
}

// R9
export async function generateExplanations(
  items: ExplainInput[],
  lexicon: string[] = []
): Promise<Map<string, ExplainOutcome>> {
  const result = new Map<string, ExplainOutcome>(
    items.map((item) => [item.key, { explanation: null, reason: 'llm_missing' }])
  );
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const byKey = new Map(batch.map((item) => [item.key, item]));
    for (const out of await explainBatch(batch)) {
      const input = typeof out?.key === 'string' ? byKey.get(out.key) : undefined;
      if (!input || typeof out.explanation !== 'string') continue;
      const reason = explanationRejection(input, out.explanation, lexicon);
      result.set(
        input.key,
        reason
          ? { explanation: null, reason }
          : { explanation: out.explanation.trim(), reason: null }
      );
    }
  }
  return result;
}

export interface ApplyRow {
  id: string;
  character_a_name: string;
  character_b_name: string;
  label: string;
  semantics: {
    assertion_status: string;
    attribution?: string;
    evidence: { source_page: number; quote: string };
  };
}

export interface ApplyRowsFile {
  book_id: string;
  rows: ApplyRow[];
}

export interface ExplainResultRow {
  id: string;
  source_quote_sha256: string;
  reader_evidence: string | null;
  reader_explanation: string | null;
  skipped_reason: string | null;
}

export interface ExplainResultFile {
  book_id: string;
  rows: ExplainResultRow[];
}

export const quoteSha256 = (quote: string): string =>
  createHash('sha256').update(quote, 'utf8').digest('hex');

// R9
export async function explainRelationships(
  rows: ApplyRow[],
  aliasesByName: Map<string, string[]>,
  lexicon: string[] = []
): Promise<ExplainResultRow[]> {
  const prepared = rows.map((row) => {
    const { quote } = row.semantics.evidence;
    const groups: NameGroup[] = [row.character_a_name, row.character_b_name].map((name) => [
      name,
      ...(aliasesByName.get(name) ?? []),
    ]);
    return {
      row,
      quote,
      evidenceLine: pickEvidenceLine(quote, groups, relationKeywords(row.label)),
    };
  });
  const inputs: ExplainInput[] = prepared.flatMap(({ row, quote, evidenceLine }) =>
    evidenceLine
      ? [
          {
            key: row.id,
            names: [row.character_a_name, row.character_b_name] as [string, string],
            label: row.label,
            assertionStatus: row.semantics.assertion_status,
            attribution: row.semantics.attribution,
            evidenceLine,
            quote,
          },
        ]
      : []
  );
  const outcomes = await generateExplanations(inputs, lexicon);
  return prepared.map(({ row, quote, evidenceLine }) => {
    const outcome = outcomes.get(row.id);
    return {
      id: row.id,
      source_quote_sha256: quoteSha256(quote),
      reader_evidence: evidenceLine,
      reader_explanation: outcome?.explanation ?? null,
      skipped_reason: evidenceLine ? (outcome?.reason ?? null) : 'no_evidence_line',
    };
  });
}

export function aliasMapFromCharacters(
  characters: { name: string; aliases?: { alias: string }[] }[]
): Map<string, string[]> {
  return new Map(characters.map((c) => [c.name, (c.aliases ?? []).map((a) => a.alias)]));
}

export function dollarQuote(text: string): string {
  let n = 0;
  while (text.includes(`$q${n}$`)) n++;
  const tag = `$q${n}$`;
  return `${tag}${text}${tag}`;
}

const OUTER_TAG = '$explain_block$';
const SHA256_HEX = /^[0-9a-f]{64}$/u;

// R9
export function buildExplainSql(bookId: string, rows: ExplainResultRow[]): string {
  if (!rows.every((row) => SHA256_HEX.test(row.source_quote_sha256))) {
    throw new Error('source_quote_sha256 형식이 잘못됐다');
  }
  const statements = rows.flatMap((row) => {
    if (!row.reader_evidence) return [];
    const evidence = dollarQuote(row.reader_evidence);
    const fields = [`'reader_evidence', ${evidence}::text`];
    if (row.reader_explanation) {
      fields.push(`'reader_explanation', ${dollarQuote(row.reader_explanation)}::text`);
    }
    const body = `  UPDATE relationships
     SET semantics = semantics || jsonb_build_object(${fields.join(', ')})
   WHERE id = ${dollarQuote(row.id)}
     AND book_id = ${dollarQuote(bookId)}
     AND encode(sha256(convert_to(semantics->'evidence'->>'quote', 'UTF8')), 'hex') = '${row.source_quote_sha256}'
     AND strpos(semantics->'evidence'->>'quote', ${evidence}) > 0;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'relationship % matched % rows', ${dollarQuote(row.id)}, affected;
  END IF;`;
    if (body.includes(OUTER_TAG)) throw new Error(`${OUTER_TAG} 가 내용에 들어 있다: ${row.id}`);
    return [body];
  });
  return `BEGIN;
DO ${OUTER_TAG}
DECLARE affected integer;
BEGIN
${statements.join('\n')}
END
${OUTER_TAG};
COMMIT;
`;
}

export interface ExplainArgs {
  rows?: string;
  book: string;
  out?: string;
  characters?: string;
  sql?: string;
  from?: string;
}

const USAGE =
  'usage: backfill-relation-explain.ts --rows <apply-rows.json> --book <id> --out <file> [--characters <file>] | --book <id> --from <result.json> --sql <out.sql>';

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} 뒤에 값이 필요하다. ${USAGE}`);
  }
  return value;
}

export function parseExplainArgs(argv: string[]): ExplainArgs {
  const book = flagValue(argv, '--book');
  if (!book) throw new Error(`--book <id> 가 필요하다. ${USAGE}`);
  const sql = flagValue(argv, '--sql');
  if (sql) {
    const from = flagValue(argv, '--from');
    if (!from) throw new Error(`--sql 은 --from <결과 파일>과 함께 쓴다. ${USAGE}`);
    return { book, sql, from };
  }
  const rows = flagValue(argv, '--rows');
  const out = flagValue(argv, '--out');
  if (!rows || !out) throw new Error(`--rows 와 --out 이 필요하다. ${USAGE}`);
  return { book, rows, out, characters: flagValue(argv, '--characters') };
}
