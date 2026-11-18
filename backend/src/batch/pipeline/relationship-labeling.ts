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
import {
  RELATION_CATEGORIES,
  RELATION_TYPES,
  RelationCategory,
  relationType,
  storageKind,
} from './relationship-taxonomy';

// 2 — 2026-11-18 관계만(행동 제외)·동료·태도 안내로 프롬프트 계약 변경. 이전 캐시는 쓰지 않는다
// 3 — 2026-11-18 닫힌 관계 유형 표 + 질문지 응답(relationship-taxonomy.ts). 큰 종류·방향은 코드가 정한다
// 4 — 2026-11-18 보강: 대사 속 관계는 claim/belief, 관형절 방향, 화자 귀속 규칙, 반박·부정 단서 범위, summary 한정어
export const STRUCTURAL_LABEL_VERSION = 4;

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

const CATEGORY_NAMES: Record<RelationCategory, string> = {
  family: '가족',
  romance: '연애',
  social: '사회(친구·지인·한편)',
  professional: '직업',
  adversarial: '적대(적·경쟁·의심)',
  attitude: '감정·태도',
};

/** 관계 유형 표를 질문지로 — 프롬프트 문장은 표에서만 나온다(표가 바뀌면 프롬프트와 캐시 계약이 함께 바뀐다) */
export function renderTaxonomy(): string {
  return RELATION_CATEGORIES.map((category) => {
    const rows = RELATION_TYPES.filter((t) => t.category === category).map((t) => {
      const direction =
        t.directionality === 'symmetric'
          ? '대칭(subject는 null)'
          : `방향 있음(subject = ${t.roles!.subject}, 다른 사람 = ${t.roles!.object})`;
      const exclusions = t.exclusions.length
        ? `\n    제외 질문: ${t.exclusions
            .map((x) => `${x.id} "${x.question}"${x.instead ? `(예면 ${x.instead})` : ''}`)
            .join(' / ')}`
        : '';
      return `  - ${t.key} (${t.name}, ${direction}): ${t.definition}\n    판정 질문: "${t.question}"${exclusions}`;
    });
    return `[${category} — ${CATEGORY_NAMES[category]}]\n${rows.join('\n')}`;
  }).join('\n');
}

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
장 원문 전체가 아니다. 근거 창에 쓰인 내용만으로, 각 쌍 사이에 원문이 직접 말하는 관계가 있으면 아래 질문지에 답하라.

관계는 두 인물 사이에 이어지는 상태다. 한 번 일어난 행동(만남·방문·손을 잡음·구함·때림·말을 건넴)은 사건이지 관계가 아니다.
함께 나왔다는 것만으로는 관계가 아니다. 관계를 직접 말하는 낱말이 없으면 그 쌍은 비운다(relations에 넣지 않는다).
같은 두 사람 사이에 관계가 여럿이면(동료이면서 의심) 유형마다 따로 적는다. 방향 있는 감정이 서로 향하면 주체마다 따로 적는다.

질문지 — 관계마다 이 순서로 답한다(Massey 외 2015의 인물 관계 주석 질문지를 따른다):
1. lasting: 근거가 두 사람 사이에 이어지는 관계를 말하는가(true), 한 번 일어난 행동만 말하는가(false)? false면 적지 않아도 된다.
2. category: 큰 종류를 고른다 — ${RELATION_CATEGORIES.join(' / ')}.
3. type: 아래 관계 유형 표에서 그 큰 종류에 속한 유형 키 하나를 고른다. 표에 없는 유형은 쓰지 않는다. 맞는 유형이 없으면 적지 않는다.
4. type_question: 고른 유형의 판정 질문에 대한 답(true/false). true가 아니면 그 유형이 아니다.
5. exclusions: 고른 유형의 제외 질문마다 id를 키로 true/false. 하나라도 true면 그 유형이 아니다 — (예면 …)에 적힌 유형을 다시 검토한다.
6. subject: 방향 있는 유형이면 주체의 대표명(표의 subject 역할), 대칭 유형이면 null.
7. assertion_status: fact(서술자가 따옴표 밖에서 직접 말함) / belief·claim·rumor·uncertain(누가 믿거나 주장하거나 소문 — attribution에 그 사람의 이름을 근거 문장에 쓰인 표기 그대로 쓰고, summary에 attribution 이름과 한정어를 그대로 넣는다 — claim은 "주장한다", belief는 "믿는다" 또는 "생각한다", rumor는 "소문", uncertain은 "확실하지 않다". "말한다·의문을 품는다"만으로는 한정어가 아니다) / negated(부정된 내용). 인물의 추측·거짓말·소문·오해·희망을 fact로 쓰지 않는다.
   - 따옴표(“…”) 안의 대사·속생각에서 드러나는 관계는 fact가 아니다. 말한 사람의 주장이면 claim, 그 사람이 속으로 생각·믿는 것이면 belief로 쓰고 attribution에 말한(생각한) 사람의 대표명을 쓴다. 자기 감정을 말하는 대사("나는 부인을 사랑하고 있습니다")도 그 화자의 claim이다 — 화자가 근거 창에 "이름의 진술", "…하고 이름은 말했다"처럼 드러나야 한다.
   - 추리물에서는 겉으로 알려진 관계와 감춰진 관계가 다를 수 있다 — 누가 그렇게 말하거나 믿는지가 관계의 일부다. 다른 사람이 말한 관계(예: 검사가 "좌장이 너를 미워했다"고 말함)도 그 말한 사람의 claim으로 적는다.
   - 따옴표 밖 서술이 직접 말하는 관계만 fact다. 관형절("몽란을 끝없이 사랑하는 유불란")은 꾸밈을 받는 사람(유불란)이 주체다.
8. state(active/ended)와 change_type(establishment/restatement/transition/disclosure). 관계가 바뀌거나 끝났다고 원문이 직접 말할 때만 transition/ended를 쓴다.
9. summary: 두 대표명을 모두 넣은 한 문장. rationale: 근거 창이 판정 질문의 답을 뒷받침하는 이유.
10. support: 근거 창 id와, 그 창 안에서 관계를 가장 분명하게 말하는 최소한의 연속 낱말(trigger)을 원문 그대로. trigger가 있는 문장에 두 인물의 이름이나 표기가 함께 있어야 한다. 대화 창은 말한 사람과 듣는 사람이 두 인물이다. 같은 관계를 보여 주는 창이 여럿이면 모두 넣는다. 확립 쪽수는 서버가 검증된 support 중 가장 이른 쪽으로 정한다.

character_a/b에는 후보 쌍 목록의 대표명을 쓴다. 큰 종류·방향·라벨은 서버가 유형 표에서 정한다.
작품·장르에 대한 기억으로 보충하지 않는다. 이 근거 창에 없는 사실은 쓰지 않는다.

--- 관계 유형 표 ---
${renderTaxonomy()}

출력은 JSON 객체 하나만 반환한다(설명·코드 블록 없이):
{"relations":[{"character_a":"대표명","character_b":"대표명","lasting":true,"category":"professional","type":"colleague","type_question":true,"exclusions":{"commands":false,"hires":false},"subject":null,"assertion_status":"fact","state":"active","change_type":"establishment","summary":"대표명 A와 대표명 B는 같은 사건을 맡은 동료다.","rationale":"근거 창이 판정 질문의 답을 뒷받침하는 이유","support":[{"window_id":"p12:30-58:sentence","trigger":"원문 그대로의 낱말"}]}]}

--- 후보 쌍 ---
${blocks.join('\n')}

--- 근거 창 ---
${windowLines.join('\n\n')}`;
}

// ─── 결정적 검사 ─────────────────────────────────────────────────────────────

const LATIN = /[A-Za-z]/u;

/** 자주 함께 나오는데 관계가 하나도 없는 인물 — 검수 목록용 */
export interface UncoveredCharacter {
  character_id: string;
  name: string;
  /** 이 인물이 들어간 후보 쌍의 근거 창 수 합계 */
  windows: number;
  /** 함께 나온 상대 이름 */
  partners: string[];
}

/**
 * 관계 0건인데 다른 인물과 근거 창이 minWindows개 이상인 인물을 고른다. 추출이 놓쳤을 수 있다는
 * 표시일 뿐 관계를 만들지 않는다(R12 — 사람이 근거 창을 보고 판단한다). FR-CHR-001
 * (2026-11-18 대표 지시: 백검사가 21쪽에 나오고 임경부와 함께 수사하는데 관계도에 없었다)
 */
export function uncoveredCharacters(
  candidates: Pick<InteractionCandidate, 'a_id' | 'b_id' | 'a_name' | 'b_name' | 'windows'>[],
  relationships: { character_a_id: string; character_b_id: string }[],
  minWindows: number
): UncoveredCharacter[] {
  const related = new Set(relationships.flatMap((r) => [r.character_a_id, r.character_b_id]));
  const byId = new Map<string, UncoveredCharacter>();
  for (const c of candidates) {
    for (const [id, name, partner] of [
      [c.a_id, c.a_name, c.b_name],
      [c.b_id, c.b_name, c.a_name],
    ] as const) {
      if (related.has(id)) continue;
      const entry = byId.get(id) ?? { character_id: id, name, windows: 0, partners: [] };
      entry.windows += c.windows.length;
      if (!entry.partners.includes(partner)) entry.partners.push(partner);
      byId.set(id, entry);
    }
  }
  return [...byId.values()]
    .filter((c) => c.windows >= minWindows)
    .sort((x, y) => y.windows - x.windows);
}

/**
 * 한 번 일어난 행동인가 — kind=action 또는 temporal_scope=event. 관계도에 넣지 않는다.
 * FR-CHR-001 (2026-11-18 대표 지시: 손을 잡음 같은 사건은 관계가 아니다)
 */
export function isOneOffAction(r: { kind?: unknown; temporal_scope?: unknown }): boolean {
  return r.kind === 'action' || r.temporal_scope === 'event';
}

/** 질문지 응답 해석 결과 — 저장 필드는 유형 표에서 정한다 */
export type InterpretedAnswer =
  | { aId: string; bId: string; fields: Record<string, unknown>; notes: string[] }
  | { reasons: string[] };

/**
 * 관계 질문지 응답(buildPairLabelPrompt) → 저장 필드. LLM 호출 없음. FR-CHR-001 🚦
 * - 이어지는 관계인가(lasting) → 아니면 one_off_action. 옛 형식 kind=action·temporal_scope=event도 같다.
 * - type은 닫힌 유형 표 안(type_not_in_taxonomy), 판정 질문은 true(type_question_not_affirmed),
 *   제외 질문은 모두 false(exclusion_applies / exclusion_unanswered).
 * - 큰 종류(kind)·라벨·relation_key·방향·temporal_scope는 표에서 파생한다. LLM이 보낸 값은 쓰지 않는다
 *   (Hamilton 외 2025: LLM은 세부 종류보다 큰 종류를 더 틀린다 → 세부 종류에서 큰 종류를 파생).
 * - 방향 있는 유형은 subject가 character_a가 되고 direction=a_to_b. subject가 두 사람 중 하나가 아니면 보류.
 * - category 답이 유형의 큰 종류와 다르면 저장값은 표를 따르고 검수 메모를 남긴다(category_answer_mismatch).
 */
export function interpretAnswer(
  r: Record<string, unknown>,
  lexicon: CandidateCharacter[]
): InterpretedAnswer {
  const aId = resolveName(r.character_a, lexicon);
  const bId = resolveName(r.character_b, lexicon);
  if (!aId || !bId) return { reasons: ['unresolved_endpoint'] };
  if (aId === bId) return { reasons: ['same_endpoint'] };
  // FR-CHR-001 — 관계도는 관계만 담는다(2026-11-18 대표 지시). 한 번 일어난 행동(손을 잡음·구하려 함)은
  // 사건(타임라인 몫)이지 두 인물의 관계가 아니다. 프롬프트가 막아도 모델 출력은 여기서 다시 거른다.
  const exclusions = object(r.exclusions);
  if (r.lasting === false || isOneOffAction(r) || exclusions.one_off === true)
    return { reasons: ['one_off_action'] };
  const type = relationType(r.type);
  if (!type) return { reasons: ['type_not_in_taxonomy'] };
  if (r.lasting !== true) return { reasons: ['lasting_not_answered'] };
  if (r.type_question !== true) return { reasons: ['type_question_not_affirmed'] };
  const excluded: string[] = [];
  for (const x of type.exclusions) {
    const answer = exclusions[x.id];
    if (answer === true)
      excluded.push(`exclusion_applies:${x.id}${x.instead ? `→${x.instead}` : ''}`);
    else if (answer !== false) excluded.push(`exclusion_unanswered:${x.id}`);
  }
  if (excluded.length > 0) return { reasons: excluded };
  let [from, to, fromName, toName] = [aId, bId, r.character_a, r.character_b];
  if (type.directionality === 'directed') {
    const subject = resolveName(r.subject, lexicon);
    if (subject !== aId && subject !== bId) return { reasons: ['subject_not_in_pair'] };
    if (subject === bId) [from, to, fromName, toName] = [bId, aId, r.character_b, r.character_a];
  }
  const notes = r.category === type.category ? [] : ['category_answer_mismatch'];
  const attribution =
    typeof r.attribution === 'string' && r.attribution.trim() ? r.attribution.trim() : undefined;
  return {
    aId: from,
    bId: to,
    notes,
    fields: {
      character_a: fromName,
      character_b: toName,
      direction: type.directionality === 'directed' ? 'a_to_b' : 'undirected',
      kind: storageKind(type),
      relation_key: type.key,
      label: type.label,
      temporal_scope: 'ongoing',
      attribution,
    },
  };
}

// 사실성 단서 — Saurí & Pustejovsky 2012(극성·양태·출처 도입 술어)를 한국어 어미·영어 어휘로 옮긴 보수적 목록
const KO_NEGATION = /(?:않|아니|없[었다는을지]|못\s*(?:했|하|한|해|된)|커녕|리\s*(?:가\s*)?없)/u;
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
    if (nextSentence && EN_REFUTE.test(refuteScope(nextSentence)))
      return 'factuality_cue:refuted_next';
    return undefined;
  }
  const cut = after.search(KO_CLAUSE_END);
  // trigger 안에 인물 이름이 있으면 부정은 마지막 이름 뒤부터 본다 — "몽란은 벌써 처녀가 아니고 박영민의 애욕의
  // 대상이 되었던 것이다"의 "아니"는 앞 절(처녀)을 부정하지 관계를 부정하지 않는다(2026-11-18 보강)
  const lastInside = Math.max(
    triggerStart,
    ...mentionSpans
      .filter((m) => m.start >= triggerStart && m.start < triggerEnd)
      .map((m) => m.start)
  );
  const scope =
    masked.slice(lastInside, triggerEnd) +
    after.slice(0, Math.min(cut === -1 ? after.length : cut, 40));
  if (KO_NEGATION.test(scope) || KO_PREVERBAL_NEGATION.test(before.slice(-4)))
    return 'factuality_cue:negation';
  if (KO_REPORTATIVE.test(masked)) return 'factuality_cue:reported';
  if (KO_MODAL.test(masked)) return 'factuality_cue:modal';
  // 사람 목적어("□□를") 바로 뒤의 믿- 은 신뢰, 의심- 은 의심이라는 태도다(관계). "…라고 의심했다"처럼
  // 절을 받는 의심은 사람 목적어 바로 뒤가 아니므로 그대로 출처 단서다 (2026-11-18 대표 지시: 의심은 관계)
  const source = masked.replace(
    /(□[을를]?\s*)(믿[가-힣]*|의심[가-힣]*)/gu,
    (_, a: string, b: string) => a + '·'.repeat(b.length)
  );
  if (KO_SOURCE.test(source)) return 'factuality_cue:source';
  if (nextSentence && KO_REFUTE.test(refuteScope(nextSentence)))
    return 'factuality_cue:refuted_next';
  return undefined;
}

/**
 * 다음 문장이 앞 문장을 반박하는가는 그 문장 첫머리(따옴표·공백 뒤 20자)만 본다 — "그것은 모두의 오해였다"는
 * 반박이지만, 멀리 떨어진 "…자백이 거짓이란 것을"은 앞 문장의 관계를 반박하지 않는다(2026-11-18 보강)
 */
function refuteScope(next: string): string {
  return next.replace(/^[\s“"‘'「『]+/u, '').slice(0, 20);
}

/** 관형형 어미로 끝나는가 — 받침 ㄴ(-는/-은/-ㄴ) 또는 -던 */
function endsWithAdnominal(text: string): boolean {
  const last = text.trimEnd().slice(-1);
  if (!last) return false;
  if (last === '던') return true;
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 === 4;
}

/**
 * 관형절 "O를 … V-는 H" — 피수식 인물 H가 V의 주체, O가 대상이다. 찾으면 [주체 id, 대상 id], 없으면 undefined.
 * O·H는 trigger 안이나 trigger 바로 뒤(2자 안)에 있어야 하고, 사이에 쉼표·문장 부호가 없어야 한다.
 */
function relativeClauseRoles(
  sentence: string,
  sentenceStart: number,
  t0: number,
  t1: number,
  ends: Mention[]
): [string, string] | undefined {
  for (const o of ends) {
    if (o.start < t0 || o.end > t1 || !OBJECT_MARK.test(o.particle)) continue;
    const head = ends.find((m) => m.start > o.end && m.character_id !== o.character_id);
    if (!head || head.start > t1 + 2) continue;
    const between = sentence.slice(
      o.end + o.particle.length - sentenceStart,
      head.start - sentenceStart
    );
    if (/[,.!?;:，。]/u.test(between) || !endsWithAdnominal(between)) continue;
    return [head.character_id, o.character_id];
  }
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
  const t0 = sentenceStart + triggerStart;
  const t1 = sentenceStart + triggerEnd;
  // 대사는 따옴표가 닫힐 때까지 한 문장으로 묶인다 — trigger 앞의 마지막 문장 끝 부호 뒤(같은 문장 단위)만 본다
  const before = sentence.slice(0, triggerStart);
  const lastStop = Math.max(...['.', '!', '?', '。'].map((c) => before.lastIndexOf(c)));
  const clauseStart = sentenceStart + lastStop + 1;
  const ends = mentions.filter(
    (m) => (m.character_id === subjectId || m.character_id === objectId) && m.start >= clauseStart
  );
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
  // "B는 A의 애욕의 대상이 되었다" — 대상 구문은 주제어가 대상이다. 판단하지 않는다
  if (/대상(?:이|으로|이\s*되)/u.test(sentence.slice(triggerStart, triggerEnd) + scope))
    return false;
  // 관형절 "B를 … 사랑하는 A" — 피수식 인물 A가 주체(2026-11-18 보강)
  const roles = relativeClauseRoles(sentence, sentenceStart, t0, t1, ends);
  if (roles) return roles[0] !== subjectId || roles[1] !== objectId;
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
  /** 따옴표 안(대사·인용) 구간 */
  quotes: TextSpan[];
}

/** 따옴표 구간 — “…”, ‘…’, 「…」, 『…』 는 짝으로, 곧은 따옴표(")는 번갈아 연다·닫는다 */
export function quoteSpans(content: string): TextSpan[] {
  const pairs: Record<string, string> = { '“': '”', '「': '」' };
  const out: TextSpan[] = [];
  let open: { start: number; close: string } | undefined;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (open) {
      if (c === open.close) {
        out.push({ start: open.start, end: i + 1 });
        open = undefined;
      }
    } else if (pairs[c]) open = { start: i, close: pairs[c] };
    else if (c === '"') open = { start: i, close: '"' };
  }
  if (open) out.push({ start: open.start, end: content.length });
  return out;
}

const FIRST_PERSON = /(?:^|[\s“"‘'「,…—])(?:나는|내가|나도|나의|저는|제가|저도|저의)/u;
const SPEECH_AFTER_NAME = /^\s*(?:의\s*)?(?:진술|말|대답|고백|자백|변명|증언)/u;
const SPEECH_BEFORE_NAME = /(?:하고|라고|이라고)\s*$/u;

/**
 * 화자 본인의 감정 대사 — "나용귀의 진술. “… 나는 부인을 사랑하고 있습니다.”" 2026-11-18 보강.
 * 근거 문장에 주체(화자)의 이름이 없어도, 아래가 모두 맞을 때만 그 화자의 **주장**으로 받는다(사실로는 받지 않는다 —
 * 말하기 술어가 안긴 사건은 화자의 주장이다: Saurí & Pustejovsky 2012. 추리물 인물은 거짓말을 한다: Conan 2024).
 *  - 라벨이 claim/belief이고 attribution이 빠진 인물(=주체)
 *  - trigger가 따옴표 안이고, 그 문장 단위(마지막 문장 부호 뒤)에 1인칭(나는·저는…)이 있다
 *  - 같은 근거 창의 다른 문장에 그 인물 이름이 말하기 표지와 붙어 있다: "이름(의) 진술/말/대답/고백/자백/증언"
 *    또는 "…하고 이름은/이/가" (Elson 2010의 '인용 + 말하기 동사 + 인물' 범주, Muzny 2017의 문단 끝 언급 규칙)
 * 맞으면 근거는 그 창 전체(화자 이름이 근거 인용에 들어간다), 아니면 undefined.
 */
function speakerSelfStatement(
  windowItem: EvidenceWindow,
  index: PageIndex,
  sentence: TextSpan,
  t0: number,
  speakerId: string
): TextSpan | undefined {
  if (windowItem.kind === 'dialogue') return undefined;
  if (!index.quotes.some((q) => t0 > q.start && t0 < q.end)) return undefined;
  const before = index.page.content.slice(sentence.start, t0);
  const stop = Math.max(...['.', '!', '?', '。', '“'].map((c) => before.lastIndexOf(c)));
  if (!FIRST_PERSON.test(before.slice(stop + 1) + index.page.content.slice(t0, t0 + 4)))
    return undefined;
  const content = index.page.content;
  const marked = index.mentions.some(
    (m) =>
      m.character_id === speakerId &&
      m.start >= windowItem.start &&
      m.end <= windowItem.end &&
      (m.end <= sentence.start || m.start >= sentence.end) &&
      (SPEECH_AFTER_NAME.test(content.slice(m.end, m.end + 8)) ||
        (/^(?:은|는|이|가)?$/u.test(m.particle) &&
          SPEECH_BEFORE_NAME.test(content.slice(Math.max(windowItem.start, m.start - 6), m.start))))
  );
  return marked ? { start: windowItem.start, end: windowItem.end } : undefined;
}

function indexPages(pages: Page[], lexicon: CandidateCharacter[]): Map<number, PageIndex> {
  const out = new Map<number, PageIndex>();
  for (const page of pages)
    out.set(page.page_no, {
      page,
      sentences: splitSentences(page.content),
      mentions: findMentions(page.content, lexicon, page.page_no),
      quotes: quoteSpans(page.content),
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
  r: Record<string, unknown>,
  attributionId?: string
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
    let speakerEvidence: TextSpan | undefined;
    if (windowItem.kind === 'dialogue') {
      if (!windowItem.quote || t0 < windowItem.start || t1 > windowItem.end)
        return 'trigger_not_in_window';
    } else if (
      !inSentence.some((m) => m.character_id === aId) ||
      !inSentence.some((m) => m.character_id === bId)
    ) {
      // 빠진 쪽이 방향 있는 관계의 주체이고 그 사람이 말한 대사일 때만(화자 귀속 규칙) — 주장으로만 받는다
      const missingSubject =
        directed &&
        !inSentence.some((m) => m.character_id === subjectId) &&
        inSentence.some((m) => m.character_id === objectId);
      if (
        missingSubject &&
        (r.assertion_status === 'claim' || r.assertion_status === 'belief') &&
        attributionId === subjectId
      )
        speakerEvidence = speakerSelfStatement(windowItem, index, s, t0, subjectId);
      if (!speakerEvidence) return 'trigger_sentence_lacks_endpoint';
    }
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
    // 따옴표 안(대사·인용)의 관계는 서술자가 단정한 사실이 아니라 말한 사람의 주장이다 — claim/belief + attribution으로
    // 적어야 한다(2026-11-18 보강, Conan의 공개/비밀 관점·Saurí & Pustejovsky 2012). 대화 창은 따로 검수로 간다
    if (
      r.assertion_status === 'fact' &&
      windowItem.kind !== 'dialogue' &&
      index.quotes.some((q) => t0 > q.start && t0 < q.end)
    )
      return 'factuality_cue:quoted_speech';
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
          : (speakerEvidence ?? { start: s.start, end: s.end }),
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
    const r: Record<string, unknown> = { ...object(item) };
    const interpreted = interpretAnswer(r, lexicon);
    if ('reasons' in interpreted) {
      held.push({ candidate: item, reasons: interpreted.reasons });
      continue;
    }
    const { aId, bId } = interpreted;
    Object.assign(r, interpreted.fields);
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
        ? checkSupport(
            own,
            String(s.trigger ?? ''),
            pageIndex,
            aId,
            bId,
            r,
            resolveName(r.attribution, lexicon)
          )
        : 'support_page_missing';
      if (typeof result === 'string') rejected.push({ window_id: id, reason: result });
      else verified.push(result);
    }
    if (verified.length === 0) {
      held.push({ candidate: item, reasons: [...new Set(rejected.map((x) => x.reason))] });
      continue;
    }
    verified.sort((x, y) => x.page_no - y.page_no || x.evidence.start - y.evidence.start);
    const notes: string[] = [...interpreted.notes];
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
  // 자기 일관성은 유형(relation_key)까지 같아야 일치로 본다 — 큰 종류만 같으면 다른 관계다
  return `${pair}|${s.relationship.semantics?.relation_key ?? ''}`;
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
    // 질문지의 큰 종류 답이 유형과 어긋났다 — 저장값은 표를 따르지만 사람이 본다
    if (chosen.notes.includes('category_answer_mismatch')) reasons.push('category_answer_mismatch');
    // 관계 변화·종료는 사람끼리도 일치도가 낮다(Massey 2015 변화 κ 0.208) — 자동 확정하지 않는다
    const g = grounded.relationships[0];
    if (
      g.change_type === 'transition' ||
      g.change_type === 'disclosure' ||
      g.semantics?.state === 'ended'
    )
      reasons.push('change_needs_review');
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
          ...(relationType(s.relation_key)
            ? { definition: relationType(s.relation_key)!.definition }
            : {}),
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
