/**
 * 근거 창 기반 관계 라벨링 — FR-CHR-001 🚦, FR-DAT-005, FR-SPL-002 🚦, NFR-AI-004, R9, R12
 *
 * 1) buildPairLabelPrompt: 구조적 후보 쌍(interaction-candidates.ts)과 그 근거 창만 LLM에 준다.
 *    장 원문 전체를 주지 않으므로, 창 밖 문장은 라벨의 근거가 될 수 없다.
 * 2) verifyPairLabels: LLM 응답을 결정적으로 검사한다.
 *    - 후보에 없는 쌍 → 거절(no_structural_candidate). LLM이 쌍을 지어낼 수 없다.
 *    - 근거(support)는 그 쌍의 창 id + 창 안의 정확한 낱말(trigger, DialogRE의 trigger 정의).
 *    - trigger가 있는 문장에 두 인물이 모두 이름·별칭으로 나와야 한다(대화 창은 화자·청자로 대신).
 *    - '사실'로 단정한 라벨은 trigger 절의 부정·전언·희망·출처 단서와 다음 문장의 반박을 검사한다
 *      (Saurí & Pustejovsky 2012: 사실성 = 극성 × 양태, 출처 도입 술어). 걸리면 보류.
 *    - 방향은 한국어 격조사(주제어 은/는 > 주격 이/가, 목적·여격 을/를/에게)와 영어 어순으로 반대
 *      방향만 잡는다. 판단할 수 없으면 막지 않는다(DialogRE: 비대칭 역관계에서 모델 오류가 많다).
 *    - 확립 페이지 = 검사를 통과한 가장 이른 근거의 쪽. LLM이 말한 쪽은 더 이르게 만들 수 없다
 *      (DialogRE F1c: 관계는 두 인자와 trigger가 모두 나온 시점에 평가 가능).
 * 3) finalizeStructuredRelationships: 두 번의 독립 라벨링(자기 일관성, Wang et al. 2022)을 맞추고,
 *    두 번 모두 나온 관계만 confirmed. 확립 페이지는 두 실행 중 늦은 쪽. 기존 근거 검증
 *    (validateGroundedChapter)과 선택적 반대 검토자(buildVerifierPrompt)를 그대로 통과해야 한다.
 *
 * 어떤 결과도 사람 검수 전에는 공개되지 않는다(R12). 이 검사는 구조 검사이지 해석의 진실 보증이 아니다.
 */
import { Chapter, Page, RelationshipSemantics } from '../../shared/types';
import { GroundedRelationship, validateGroundedChapter } from './grounding';
import {
  CandidateCharacter,
  EvidenceWindow,
  InteractionCandidate,
  Mention,
  TextSpan,
  findMentions,
  generateInteractionCandidates,
  splitSentences,
} from './interaction-candidates';
import { VerifierAnswer, VerifierInput, endpointForms } from './relationship-verification';

export const STRUCTURAL_LABEL_VERSION = 1;

/** 한 쌍에 프롬프트로 보내는 근거 창 수 상한 — 이른 쪽부터. 잘린 창은 확립을 늦출 뿐 앞당기지 않는다 */
export const MAX_WINDOWS_PER_PAIR = 8;

export interface VerifiedSupport {
  window_id: string;
  kind: EvidenceWindow['kind'];
  page_no: number;
  trigger: string;
  /** 쪽 본문 기준 위치 */
  trigger_start: number;
  trigger_end: number;
  /** 근거 문장(대화 창이면 대화 창 전체)의 쪽 본문 기준 위치 */
  evidence: TextSpan;
}

export interface StructuredRelationship {
  relationship: GroundedRelationship;
  character_a_id: string;
  character_b_id: string;
  support: VerifiedSupport[];
  rejected_support: { window_id: string; reason: string }[];
  claimed_established_page?: number;
  /** 보류 사유는 아니지만 검수자가 볼 메모 */
  notes: string[];
}

export interface HeldLabel {
  candidate: unknown;
  reasons: string[];
}

export interface LabelRunResult {
  relationships: StructuredRelationship[];
  held: HeldLabel[];
}

export type StructuralCheck = 'confirmed' | 'needs_review' | 'held';

export interface FinalStructuredRelationship extends StructuredRelationship {
  check: StructuralCheck;
  reasons: string[];
  runs_agreed: number;
  verifier_why?: string;
}

// ─── 프롬프트 ────────────────────────────────────────────────────────────────

/** FR-DAT-005 — 후보 쌍과 근거 창만 담는다. NFR-AI-004: 상한은 입력 선택으로, 프롬프트는 형식만 */
export function buildPairLabelPrompt(
  chapter: Chapter,
  candidates: InteractionCandidate[],
  lexicon: CandidateCharacter[]
): string {
  const byId = new Map(lexicon.map((c) => [c.id, c]));
  const forms = (id: string, page: number) =>
    byId.get(id) ? endpointForms(byId.get(id)!, lexicon, page).join(', ') : id;
  // 같은 문장을 여러 쌍이 함께 쓰므로 창 본문은 한 번만 싣고, 쌍에는 창 id만 단다
  const shown = new Map<string, EvidenceWindow>();
  const blocks = candidates.map((c, i) => {
    const ids = c.windows.slice(0, MAX_WINDOWS_PER_PAIR).map((w) => {
      shown.set(w.id, w);
      return w.id;
    });
    return `쌍 ${i + 1}: "${c.a_name}"(표기: ${forms(c.a_id, c.first_page)}) — "${c.b_name}"(표기: ${forms(c.b_id, c.first_page)}) · 근거 창: ${ids.join(', ')}`;
  });
  const windowLines = [...shown.values()]
    .sort((x, y) => x.page_no - y.page_no || x.start - y.start)
    .map((w) => {
      const who =
        w.kind === 'dialogue'
          ? ` (대화: 말한 사람 ${byId.get(w.speaker_id!)?.name} → 듣는 사람 ${byId.get(w.addressee_id!)?.name}, 화자 추정은 규칙 기반)`
          : '';
      return `[${w.id}] ${w.page_no}쪽 ${w.kind}${who}\n${w.text}`;
    });
  return `다음은 이 작품 ${chapter.chapter_no}장 "${chapter.title}"에서 두 인물이 함께 드러난 원문 조각(근거 창)이다.
장 원문 전체가 아니다. 근거 창에 쓰인 내용만으로, 각 쌍 사이에 원문이 직접 보여 주는 관계가 있으면 적어라.

규칙:
- 아래 목록에 있는 쌍만 다룬다. 목록에 없는 두 사람의 관계는 쓰지 않는다.
- 함께 나왔다는 것만으로는 관계가 아니다. 관계를 직접 말하는 낱말이 없으면 그 쌍은 비운다(relations에 넣지 않는다).
- support에는 근거 창 id와, 그 창 안에서 관계를 가장 분명하게 말하는 최소한의 연속 낱말(trigger)을 원문 그대로 적는다. trigger가 있는 문장에 두 인물의 이름이나 표기가 함께 있어야 한다. 대화 창은 말한 사람과 듣는 사람이 두 인물이다.
- 같은 관계를 보여 주는 창이 여럿이면 모두 support에 넣는다. 확립 쪽수는 서버가 검증된 support 중 가장 이른 쪽으로 정한다. 근거가 없는 앞 쪽을 확립 쪽으로 쓰지 않는다.
- character_a/b에는 목록의 대표명을 쓴다. direction은 a_to_b(주체 A→대상 B), b_to_a, mutual(양쪽 모두 명시), undirected(방향 없는 관계: 남매·동료 등), unknown.
- label은 짧고 구체적인 술어("태수를 두고 질투한다", "고용한다", "아버지다"). summary는 두 대표명을 모두 넣은 한 문장. 추상 명사("감정", "관계", "욕망")만 쓰지 않는다.
- kind는 family/social/emotion/action, relation_key는 영어 소문자 키(parenthood, employment, jealousy, affection 등).
- assertion_status: fact(서술로 확인), belief/claim/rumor/uncertain(누가 믿거나 주장하거나 소문 — attribution에 그 사람 이름을 쓰고 summary에 "믿는다/주장한다/소문" 같은 한정을 넣는다), negated(부정된 내용). 부정·소문·희망·오해를 fact로 쓰지 않는다.
- temporal_scope는 ongoing/event, state는 active/ended, change_type은 establishment/restatement/transition/disclosure.
- 작품·장르에 대한 기억으로 보충하지 않는다. 이 근거 창에 없는 사실은 쓰지 않는다.

출력은 JSON만 반환한다:
{"relations":[{"character_a":"대표명","character_b":"대표명","direction":"a_to_b","label":"구체적인 술어","kind":"emotion","relation_key":"jealousy","assertion_status":"fact","temporal_scope":"ongoing","state":"active","change_type":"establishment","summary":"대표명 A는 대표명 B를 … 한다.","rationale":"근거 창이 의미와 방향을 뒷받침하는 이유","support":[{"window_id":"p12:30-58:sentence","trigger":"원문 그대로의 낱말"}]}]}

--- 후보 쌍 ---
${blocks.join('\n')}

--- 근거 창 ---
${windowLines.join('\n\n')}`;
}

// ─── 결정적 검사 ─────────────────────────────────────────────────────────────

const LATIN = /[A-Za-z]/u;

// 사실성 단서 — Saurí & Pustejovsky 2012(극성·양태·출처 도입 술어)를 한국어 어미·영어 어휘로 옮긴 보수적 목록
const KO_NEGATION = /(?:않|아니|없[었다는이을지]|못\s*(?:했|하|한|해|된)|커녕|리\s*(?:가\s*)?없)/u;
const KO_PREVERBAL_NEGATION = /(?:^|\s)(?:안|못|아니)\s*$/u;
const KO_REPORTATIVE = /(?:다고|다는|라고|라는|다니|라니|냐고|자고|단다|란다)/u;
const KO_MODAL =
  /(?:고\s*싶|려고|려는|려\s*(?:했|한|하)|기로|겠|척|체하|ㄹ\s*것|을\s*것|예정|계획)/u;
const KO_SOURCE =
  /(?:소문|오해|믿었|믿는다|믿고\s*있|믿은|생각했|생각한다|여겼|여긴다|짐작|추측|의심|주장|착각|거짓|헛소문|모양이|듯했|듯하|것\s*같)/u;
const KO_REFUTE = /(?:거짓|오해|사실이\s*아니|그럴\s*리|헛소문|꾸며)/u;
const KO_CLAUSE_END = /[,;:]|(?:지만|는데|으나|면서|거니와)\s/u;
const KO_PASSIVE = /(?:받았|받는|받은|받고|당했|당하|당한|에게서|한테서)/u;

const EN_NEGATION_BEFORE =
  /(?:\b(?:not|never|no|nor|neither|without|hardly|scarcely)\b|\bfar\s+from\b|n't)[^.;!?]{0,25}$/iu;
const EN_SOURCE =
  /\b(?:believ(?:e|ed|es|ing)|thought|think(?:s|ing)?|convinced|suspect(?:s|ed|ing)?|rumou?r(?:s|ed)?|suppos(?:e|ed|es|ing)|imagin(?:e|ed|es|ing)|fanc(?:y|ied|ies)|claim(?:s|ed|ing)?|said\s+that|hop(?:e|ed|es|ing)|wish(?:es|ed|ing)?|intend(?:s|ed|ing)?|plann?(?:ed|ing|s)?|seem(?:s|ed|ing)?|appear(?:s|ed)?|pretend(?:s|ed|ing)?)\b/iu;
const EN_NEGATION_IN = /\b(?:not|never|no|nor|neither|without)\b|n't/iu;
const EN_REFUTE = /\b(?:false|untrue|lie|lies|mistaken|misunderst\w*)\b/iu;
const EN_PASSIVE_AFTER = /^\s*(?:by)\b/iu;

const SUBJECT_TOPIC = /^(?:은|는|께서는|이는)$/u;
const SUBJECT_NOMINATIVE = /^(?:이|가|께서|이가)$/u;
const OBJECT_MARK = /^(?:을|를|이를|에게|한테|더러|께|보고|이에게|이한테)$/u;

/**
 * 사실성 단서 — 사실로 단정한 라벨에만 적용한다. FR-CHR-001 🚦
 * - 부정: trigger와 그 뒤 절(쉼표·연결 어미까지, 40자) 안. trigger가 부정어를 삼켜도 잡는다.
 * - 전언(-다고/-라는/-다니)·희망·계획·출처 술어(믿었다·소문·오해): 근거 문장 전체. 한국어 출처 술어는
 *   안긴 절 뒤에 오므로(“[…]고 믿었다”) 절 범위로 좁히지 않는다. 인물 이름+조사("초봉이라는")는 가린다.
 * - "윤아를 믿고"처럼 사람 목적어 바로 뒤의 믿다는 신뢰이므로 출처 단서에서 뺀다.
 * mentionSpans는 문장 기준 [이름 시작, 조사 끝] 범위.
 */
export function factualityCue(
  sentence: string,
  triggerStart: number,
  triggerEnd: number,
  nextSentence: string | undefined,
  mentionSpans: TextSpan[] = []
): string | undefined {
  let masked = sentence;
  for (const m of mentionSpans)
    masked = masked.slice(0, m.start) + '□'.repeat(m.end - m.start) + masked.slice(m.end);
  const before = masked.slice(0, triggerStart);
  const trigger = masked.slice(triggerStart, triggerEnd);
  const after = masked.slice(triggerEnd);
  if (LATIN.test(sentence.slice(triggerStart, triggerEnd))) {
    if (EN_NEGATION_BEFORE.test(before) || EN_NEGATION_IN.test(trigger))
      return 'factuality_cue:negation';
    if (EN_SOURCE.test(masked)) return 'factuality_cue:source';
    if (nextSentence && EN_REFUTE.test(nextSentence)) return 'factuality_cue:refuted_next';
    return undefined;
  }
  const cut = after.search(KO_CLAUSE_END);
  const scope = trigger + after.slice(0, Math.min(cut === -1 ? after.length : cut, 40));
  if (KO_NEGATION.test(scope) || KO_PREVERBAL_NEGATION.test(before.slice(-4)))
    return 'factuality_cue:negation';
  if (KO_REPORTATIVE.test(masked)) return 'factuality_cue:reported';
  if (KO_MODAL.test(masked)) return 'factuality_cue:modal';
  // 사람 목적어("□□를") 바로 뒤의 믿- 은 신뢰다
  const source = masked.replace(
    /(□[을를]?\s*)(믿[가-힣]*)/gu,
    (_, a: string, b: string) => a + '·'.repeat(b.length)
  );
  if (KO_SOURCE.test(source)) return 'factuality_cue:source';
  if (nextSentence && KO_REFUTE.test(nextSentence)) return 'factuality_cue:refuted_next';
  return undefined;
}

/**
 * 반대 방향 검출 — 판단할 수 있을 때만 true. 한국어: trigger 앞의 두 인물 언급 중 주제어(은/는),
 * 없으면 주격(이/가)을 주체로, 목적·여격을 대상으로 본다. 영어: trigger 바로 앞 인물이 주체, 뒤가 대상.
 * 피동(받았/당했, by)이 보이면 판단하지 않는다.
 */
export function directionConflict(
  sentence: string,
  sentenceStart: number,
  triggerStart: number,
  triggerEnd: number,
  mentions: Mention[],
  subjectId: string,
  objectId: string
): boolean {
  const ends = mentions.filter((m) => m.character_id === subjectId || m.character_id === objectId);
  const t0 = sentenceStart + triggerStart;
  const t1 = sentenceStart + triggerEnd;
  const after = sentence.slice(triggerEnd);
  const prior = ends.filter((m) => m.end <= t0);
  if (LATIN.test(sentence.slice(triggerStart, triggerEnd))) {
    if (
      EN_PASSIVE_AFTER.test(after.slice(0, 12)) ||
      /\b(?:was|were|been|being)\s*$/iu.test(sentence.slice(0, triggerStart))
    )
      return false;
    const subj = prior[prior.length - 1];
    const obj = ends.find((m) => m.start >= t1);
    return subj?.character_id === objectId || obj?.character_id === subjectId;
  }
  const scope = after.slice(0, 20);
  if (KO_PASSIVE.test(scope)) return false;
  const topic = [...prior].reverse().find((m) => SUBJECT_TOPIC.test(m.particle));
  const nominative = [...prior].reverse().find((m) => SUBJECT_NOMINATIVE.test(m.particle));
  const subj = topic ?? nominative;
  const obj = [...prior].reverse().find((m) => OBJECT_MARK.test(m.particle));
  return subj?.character_id === objectId || obj?.character_id === subjectId;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveName(name: unknown, lexicon: CandidateCharacter[]): string | undefined {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const text = name.trim();
  const byName = lexicon.filter((c) => c.name.trim() === text);
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1) return undefined;
  const byAlias = lexicon.filter((c) => c.aliases.some((a) => a.alias.trim() === text));
  return byAlias.length === 1 ? byAlias[0].id : undefined;
}

function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
}

interface PageIndex {
  page: Page;
  sentences: TextSpan[];
  mentions: Mention[];
}

function indexPages(pages: Page[], lexicon: CandidateCharacter[]): Map<number, PageIndex> {
  const out = new Map<number, PageIndex>();
  for (const page of pages)
    out.set(page.page_no, {
      page,
      sentences: splitSentences(page.content),
      mentions: findMentions(page.content, lexicon, page.page_no),
    });
  return out;
}

/** 근거 하나 검사 — 통과하면 VerifiedSupport, 아니면 첫 실패 사유. trigger가 창에 여러 번 나오면 모두 통과해야 한다 */
function checkSupport(
  windowItem: EvidenceWindow,
  trigger: string,
  index: PageIndex,
  aId: string,
  bId: string,
  r: Record<string, unknown>
): VerifiedSupport | string {
  const hits = occurrences(windowItem.text, trigger);
  if (!trigger.trim() || hits.length === 0) return 'trigger_not_in_window';
  const direction = String(r.direction);
  const directed = direction === 'a_to_b' || direction === 'b_to_a';
  const [subjectId, objectId] = direction === 'b_to_a' ? [bId, aId] : [aId, bId];
  let first: VerifiedSupport | undefined;
  for (const hit of hits) {
    const t0 = windowItem.start + hit;
    const t1 = t0 + trigger.length;
    const si = index.sentences.findIndex((s) => t0 >= s.start && t0 < s.end);
    if (si === -1) return 'trigger_not_in_window';
    const s = index.sentences[si];
    const sentence = index.page.content.slice(s.start, s.end);
    const inSentence = index.mentions.filter((m) => m.start >= s.start && m.end <= s.end);
    if (windowItem.kind === 'dialogue') {
      if (!windowItem.quote || t0 < windowItem.start || t1 > windowItem.end)
        return 'trigger_not_in_window';
    } else if (
      !inSentence.some((m) => m.character_id === aId) ||
      !inSentence.some((m) => m.character_id === bId)
    )
      return 'trigger_sentence_lacks_endpoint';
    // trigger는 관계를 말하는 낱말이어야 한다 — 인물 이름(+조사)만으로 된 trigger는 근거가 아니다
    const spans = inSentence.map((m) => ({
      start: m.start - s.start,
      end: m.end + m.particle.length - s.start,
    }));
    const rest = sentence.slice(t0 - s.start, t1 - s.start).split('');
    for (const sp of spans)
      for (let k = Math.max(sp.start, t0 - s.start); k < Math.min(sp.end, t1 - s.start); k++)
        rest[k - (t0 - s.start)] = ' ';
    if (!/[\p{L}]/u.test(rest.join(''))) return 'trigger_is_name';
    if (r.assertion_status === 'fact') {
      const next = index.sentences[si + 1];
      const cue = factualityCue(
        sentence,
        t0 - s.start,
        t1 - s.start,
        next ? index.page.content.slice(next.start, next.end) : undefined,
        spans
      );
      if (cue) return cue;
    }
    if (
      directed &&
      windowItem.kind !== 'dialogue' &&
      directionConflict(
        sentence,
        s.start,
        t0 - s.start,
        t1 - s.start,
        inSentence,
        subjectId,
        objectId
      )
    )
      return 'direction_conflict';
    first ??= {
      window_id: windowItem.id,
      kind: windowItem.kind,
      page_no: windowItem.page_no,
      trigger,
      trigger_start: t0,
      trigger_end: t1,
      evidence:
        windowItem.kind === 'dialogue'
          ? { start: windowItem.start, end: windowItem.end }
          : { start: s.start, end: s.end },
    };
  }
  return first!;
}

/**
 * LLM 라벨 응답 → 구조 검사. FR-CHR-001 🚦, FR-SPL-002 🚦
 * candidates·pages는 같은 범위(보통 한 장)여야 한다. LLM 호출 없음.
 */
export function verifyPairLabels(
  raw: unknown,
  candidates: InteractionCandidate[],
  pages: Page[],
  lexicon: CandidateCharacter[]
): LabelRunResult {
  const index = indexPages(pages, lexicon);
  // 한 문장 창은 그 문장에 함께 나온 여러 쌍이 같이 쓴다 — 소속은 쌍의 창 목록으로 판단한다
  const knownWindows = new Set(candidates.flatMap((c) => c.windows.map((w) => w.id)));
  const relationships: StructuredRelationship[] = [];
  const held: HeldLabel[] = [];
  const items = object(raw).relations;
  for (const item of Array.isArray(items) ? items : []) {
    const r = object(item);
    const aId = resolveName(r.character_a, lexicon);
    const bId = resolveName(r.character_b, lexicon);
    if (!aId || !bId) {
      held.push({ candidate: item, reasons: ['unresolved_endpoint'] });
      continue;
    }
    if (aId === bId) {
      held.push({ candidate: item, reasons: ['same_endpoint'] });
      continue;
    }
    const candidate = candidates.find(
      (c) => (c.a_id === aId && c.b_id === bId) || (c.a_id === bId && c.b_id === aId)
    );
    if (!candidate) {
      held.push({ candidate: item, reasons: ['no_structural_candidate'] });
      continue;
    }
    const support = Array.isArray(r.support) ? r.support.map(object) : [];
    if (support.length === 0) {
      held.push({ candidate: item, reasons: ['no_support'] });
      continue;
    }
    const verified: VerifiedSupport[] = [];
    const rejected: { window_id: string; reason: string }[] = [];
    for (const s of support) {
      const id = String(s.window_id ?? '');
      const own = candidate.windows.find((w) => w.id === id);
      if (!own) {
        rejected.push({
          window_id: id,
          reason: knownWindows.has(id) ? 'support_window_not_for_pair' : 'unknown_support_window',
        });
        continue;
      }
      const pageIndex = index.get(own.page_no);
      const result = pageIndex
        ? checkSupport(own, String(s.trigger ?? ''), pageIndex, aId, bId, r)
        : 'support_page_missing';
      if (typeof result === 'string') rejected.push({ window_id: id, reason: result });
      else verified.push(result);
    }
    if (verified.length === 0) {
      held.push({ candidate: item, reasons: [...new Set(rejected.map((x) => x.reason))] });
      continue;
    }
    verified.sort((x, y) => x.page_no - y.page_no || x.evidence.start - y.evidence.start);
    const notes: string[] = [];
    const claimed =
      typeof r.established_page === 'number' && Number.isInteger(r.established_page)
        ? (r.established_page as number)
        : undefined;
    // FR-SPL-002 🚦 — LLM이 말한 쪽은 확립을 앞당기지 못한다. 늦추는 것은 그 쪽 이후의 검증된 근거가 있을 때만
    let chosen = verified[0];
    if (claimed !== undefined && claimed < chosen.page_no)
      notes.push('claimed_page_earlier_than_evidence');
    if (claimed !== undefined && claimed > chosen.page_no) {
      const later = verified.find((v) => v.page_no >= claimed);
      if (later) chosen = later;
      else {
        chosen = verified[verified.length - 1];
        notes.push('claimed_page_later_than_evidence');
      }
    }
    relationships.push({
      relationship: toGrounded(r, chosen, index.get(chosen.page_no)!.page),
      character_a_id: aId,
      character_b_id: bId,
      support: verified,
      rejected_support: rejected,
      ...(claimed !== undefined ? { claimed_established_page: claimed } : {}),
      notes,
    });
  }
  return { relationships, held };
}

function toGrounded(
  r: Record<string, unknown>,
  support: VerifiedSupport,
  page: Page
): GroundedRelationship {
  const evidence = {
    source_page: support.page_no,
    quote: page.content.slice(support.evidence.start, support.evidence.end),
    start_char: support.evidence.start,
    end_char: support.evidence.end,
  };
  const needsChange =
    r.change_type === 'transition' || r.change_type === 'disclosure' || r.state === 'ended';
  const semantics = {
    version: 2,
    direction: r.direction,
    kind: r.kind,
    relation_key: r.relation_key,
    summary: r.summary,
    assertion_status: r.assertion_status,
    temporal_scope: r.temporal_scope,
    state: r.state,
    evidence,
    ...(r.attribution !== undefined ? { attribution: r.attribution } : {}),
    // 변화의 근거 = 확립 쪽의 같은 근거 문장(그 trigger가 변화를 말한다)
    ...(needsChange ? { change_evidence: evidence } : {}),
  } as unknown as RelationshipSemantics;
  return {
    character_a: String(r.character_a ?? '').trim(),
    character_b: String(r.character_b ?? '').trim(),
    label: String(r.label ?? ''),
    // FR-SPL-002 🚦 — 근거에서 결정한다. LLM의 established_page는 쓰지 않는다
    established_page: support.page_no,
    rationale: String(r.rationale ?? ''),
    evidence,
    assertion_status: r.assertion_status as RelationshipSemantics['assertion_status'],
    semantics,
    change_type: r.change_type as GroundedRelationship['change_type'],
    ...(needsChange ? { change_evidence: evidence } : {}),
  };
}

function orientedKey(s: StructuredRelationship): string {
  const d = s.relationship.semantics?.direction ?? 'unknown';
  const pair =
    d === 'a_to_b'
      ? `${s.character_a_id}>${s.character_b_id}`
      : d === 'b_to_a'
        ? `${s.character_b_id}>${s.character_a_id}`
        : [s.character_a_id, s.character_b_id].sort().join('~');
  return `${pair}|${s.relationship.semantics?.kind ?? ''}`;
}

export interface FinalizeOptions {
  /** 반대 검토자(LLM). 근거 문장과 그 근거 창만 본다 */
  verifier?: (input: VerifierInput) => Promise<VerifierAnswer>;
}

/**
 * 두 번의 라벨링 → 최종 후보. FR-CHR-001 🚦, FR-SPL-002 🚦, R12
 * - 두 실행이 같은 (방향 있는 쌍, kind)를 냈으면 runs_agreed 2, 확립 페이지는 두 실행 중 늦은 쪽.
 * - 기존 근거 계약 검사(validateGroundedChapter)에 걸리면 held.
 * - 대화 창만 근거면 needs_review(화자 추정은 휴리스틱). 반대 검토자가 거절하면 held.
 */
export async function finalizeStructuredRelationships(
  run1: LabelRunResult,
  run2: LabelRunResult,
  pages: Page[],
  lexicon: CandidateCharacter[],
  options: FinalizeOptions = {}
): Promise<{ accepted: FinalStructuredRelationship[]; held: HeldLabel[] }> {
  const held: HeldLabel[] = [...run1.held];
  const accepted: FinalStructuredRelationship[] = [];
  const unused = [...run2.relationships];
  for (const first of run1.relationships) {
    const key = orientedKey(first);
    const at = unused.findIndex((x) => orientedKey(x) === key);
    const second = at === -1 ? undefined : unused.splice(at, 1)[0];
    let chosen = first;
    if (second && second.relationship.established_page > first.relationship.established_page) {
      // 늦은 쪽의 근거로 확립한다 — 첫 실행 근거 중 그 쪽 이후가 있으면 그것을, 없으면 둘째 실행의 근거를
      const later = first.support.find((s) => s.page_no >= second.relationship.established_page);
      const support = later ?? second.support[0];
      const page = pages.find((p) => p.page_no === support.page_no)!;
      chosen = {
        ...first,
        relationship: retarget(first.relationship, support, page),
        notes: [...first.notes, 'established_page_from_later_run'],
      };
    }
    const grounded = validateGroundedChapter({ relationships: [chosen.relationship] }, pages, {
      requireRelationshipSemantics: true,
      deferRelationshipEndpoints: true,
    });
    if (grounded.relationships.length === 0) {
      held.push({ candidate: chosen, reasons: grounded.review.map((r) => r.reason) });
      continue;
    }
    const reasons: string[] = [];
    if (!second) reasons.push('single_run');
    const evidenceSupport = chosen.support.filter(
      (s) => s.page_no <= chosen.relationship.established_page
    );
    if (evidenceSupport.length > 0 && evidenceSupport.every((s) => s.kind === 'dialogue'))
      reasons.push('dialogue_attribution_heuristic');
    if (chosen.notes.includes('claimed_page_later_than_evidence'))
      reasons.push('claimed_page_later_than_evidence');
    const result: FinalStructuredRelationship = {
      ...chosen,
      relationship: grounded.relationships[0],
      check: reasons.length === 0 ? 'confirmed' : 'needs_review',
      reasons,
      runs_agreed: second ? 2 : 1,
    };
    if (options.verifier) {
      const s = result.relationship.semantics!;
      const reversed = s.direction === 'b_to_a';
      const names = (id: string) => {
        const c = lexicon.find((x) => x.id === id);
        return c
          ? endpointForms(c, lexicon, result.relationship.established_page).filter(
              (f) => f !== c.name
            )
          : [];
      };
      const fromId = reversed ? chosen.character_b_id : chosen.character_a_id;
      const toId = reversed ? chosen.character_a_id : chosen.character_b_id;
      const windowText = pages
        .find((p) => p.page_no === result.relationship.established_page)!
        .content.slice(
          Math.min(
            ...chosen.support
              .filter((x) => x.page_no === result.relationship.established_page)
              .map((x) => x.evidence.start)
          ),
          Math.max(
            ...chosen.support
              .filter((x) => x.page_no === result.relationship.established_page)
              .map((x) => x.evidence.end)
          )
        );
      try {
        const answer = await options.verifier({
          from: reversed ? result.relationship.character_b : result.relationship.character_a,
          to: reversed ? result.relationship.character_a : result.relationship.character_b,
          fromAliases: names(fromId),
          toAliases: names(toId),
          label: result.relationship.label,
          direction: s.direction,
          quote: result.relationship.evidence.quote,
          context: windowText || result.relationship.evidence.quote,
        });
        if (typeof answer.supports !== 'boolean') throw new Error('verifier answer malformed');
        if (!answer.supports) {
          held.push({
            candidate: { ...result, verifier_why: answer.why },
            reasons: ['verifier_rejected'],
          });
          continue;
        }
      } catch {
        result.check = 'needs_review';
        result.reasons = [...result.reasons, 'verifier_error'];
      }
    }
    accepted.push(result);
  }
  return { accepted, held };
}

function retarget(
  r: GroundedRelationship,
  support: VerifiedSupport,
  page: Page
): GroundedRelationship {
  const evidence = {
    source_page: support.page_no,
    quote: page.content.slice(support.evidence.start, support.evidence.end),
    start_char: support.evidence.start,
    end_char: support.evidence.end,
  };
  return {
    ...r,
    established_page: support.page_no,
    evidence,
    ...(r.change_evidence ? { change_evidence: evidence } : {}),
    semantics: r.semantics
      ? {
          ...r.semantics,
          evidence,
          ...(r.semantics.change_evidence ? { change_evidence: evidence } : {}),
        }
      : r.semantics,
  };
}

// ─── 장 단위 실행(게이트웨이는 호출자가 주입) ───────────────────────────────────

export interface StructuralChapterDeps {
  /** 라벨 LLM — 같은 프롬프트를 run 1·2로 두 번 부른다(자기 일관성). 실행기는 게이트웨이(⑥)를 넣는다 */
  label: (prompt: string, run: 1 | 2) => Promise<unknown>;
  verifier?: FinalizeOptions['verifier'];
}

export interface StructuralChapterResult {
  candidates: InteractionCandidate[];
  prompt: string | undefined;
  run1: LabelRunResult;
  run2: LabelRunResult;
  accepted: FinalStructuredRelationship[];
  held: HeldLabel[];
}

/**
 * 한 장: 후보 생성(LLM 0회) → 후보가 있으면 라벨 2회 → 검사·확정. FR-CHR-001 🚦
 * 후보 쌍이 없으면 LLM을 부르지 않는다.
 */
export async function runStructuralChapter(
  chapter: Chapter,
  pages: Page[],
  lexicon: CandidateCharacter[],
  deps: StructuralChapterDeps
): Promise<StructuralChapterResult> {
  const candidates = generateInteractionCandidates(pages, lexicon);
  const empty: LabelRunResult = { relationships: [], held: [] };
  if (candidates.length === 0)
    return { candidates, prompt: undefined, run1: empty, run2: empty, accepted: [], held: [] };
  const prompt = buildPairLabelPrompt(chapter, candidates, lexicon);
  const run1 = verifyPairLabels(await deps.label(prompt, 1), candidates, pages, lexicon);
  const run2 = verifyPairLabels(await deps.label(prompt, 2), candidates, pages, lexicon);
  const final = await finalizeStructuredRelationships(run1, run2, pages, lexicon, {
    verifier: deps.verifier,
  });
  return { candidates, prompt, run1, run2, ...final };
}
