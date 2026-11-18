/**
 * 주입 후보 검사 — 새 구조적 파이프라인 판 (FR-CHR-001 🚦)
 *
 * oracle.json의 주입 후보(독립 평가자가 만든 맞는/틀린 관계 주장)를, LLM 라벨 응답인 것처럼 새
 * 파이프라인의 결정적 검사(구조적 후보 → 근거 창 trigger 검사 → 기존 근거 계약 검사)에 넣는다.
 * probe-validator.cjs(기존 구조 검사 판)와 같은 질문을 한다: "잘못된 사실 후보가 구조 검사만으로
 * 걸러지는가". 실제 모델의 추출 정확도·누락률이 아니다. 자기 일관성(2회 추출)과 반대 검토자 LLM은
 * 여기서 재지 않는다 — 같은 주입을 두 번 넣으므로 항상 일치한다.
 *
 * 두 조건을 함께 낸다.
 *  - plausible: injected-triggers.json의 trigger(구현자가 고른 그럴듯한 인용 낱말)
 *  - worst_case: 틀린 후보마다 그 쌍의 근거 창 속 모든 낱말을 trigger로 시도해 하나라도 통과하면 실패
 */
import { Page } from '../../backend/src/shared/types';
import {
  CandidateCharacter,
  generateInteractionCandidates,
} from '../../backend/src/batch/pipeline/interaction-candidates';
import {
  finalizeStructuredRelationships,
  verifyPairLabels,
} from '../../backend/src/batch/pipeline/relationship-labeling';
import { relationType } from '../../backend/src/batch/pipeline/relationship-taxonomy';

interface OracleCase {
  id: string;
  corpus: string;
  provenance: string;
  holdout?: boolean;
  expected_decision?: string;
  candidate_semantics?: { subject: string; object: string; kind: string };
  pages: { page_no: number; content: string }[];
}

export interface ProbeConfig {
  lexicons: Record<string, string[]>;
  aliases?: Record<string, Record<string, { alias: string; first_appearance_page: number }[]>>;
  triggers: Record<string, string>;
}

export interface ProbeResult {
  id: string;
  provenance: string;
  holdout: boolean;
  expected: 'accept' | 'hold-unqualified-fact';
  observed: 'accept' | 'hold';
  pass: boolean;
  trigger: string;
  reasons: string[];
  /** 틀린 후보에서 최악 조건으로 통과시킨 trigger(있으면) */
  worst_case_trigger?: string;
}

const LABELS: Record<string, string> = {
  jealousy: '질투',
  possessive_desire: '탐냄',
  romantic_affection: '연정',
  romantic_partners: '연인',
  trust: '신뢰',
  hostility: '미움',
  marriage: '혼인',
  contempt: '경멸',
  friendship: '친구',
};

function lexiconFor(c: OracleCase, config: ProbeConfig): CandidateCharacter[] {
  const names = config.lexicons[c.corpus] ?? [];
  const aliases = config.aliases?.[c.corpus] ?? {};
  return names.map((name) => ({
    id: name,
    name,
    first_appearance_page: 1,
    aliases: aliases[name] ?? [],
  }));
}

/** oracle 의미 키 → 닫힌 관계 유형 표의 유형(relationship-taxonomy.ts). 표에 없는 경멸은 미움으로 본다 */
const TYPE_OF: Record<string, string> = {
  jealousy: 'jealousy',
  possessive_desire: 'lust',
  romantic_affection: 'affection',
  romantic_partners: 'romance',
  trust: 'trust',
  hostility: 'hatred',
  marriage: 'marriage',
  contempt: 'hatred',
  friendship: 'friendship',
};

/**
 * probe-validator.cjs와 같은 주입 후보 — 사실·같은 요약 형식. 2026-11-18부터 관계 질문지 형식(판정 질문에
 * 모두 맞게 답한 응답)으로 넣는다. support는 새 계약을 따른다.
 */
function injected(c: OracleCase, windowId: string, trigger: string) {
  const { subject, object, kind } = c.candidate_semantics!;
  const label = LABELS[kind] ?? kind;
  const type = relationType(TYPE_OF[kind] ?? kind);
  return {
    character_a: subject,
    character_b: object,
    lasting: true,
    category: type?.category,
    type: type?.key ?? kind,
    type_question: true,
    exclusions: Object.fromEntries((type?.exclusions ?? []).map((x) => [x.id, false])),
    subject: type?.directionality === 'directed' ? subject : null,
    assertion_status: 'fact',
    state: 'active',
    change_type: 'establishment',
    summary: `${subject}은(는) ${object}에게 ${label}의 관계 또는 감정을 가진다.`,
    rationale: `Candidate assertion: ${subject} → ${object} (${label}); independent oracle may reject it.`,
    support: [{ window_id: windowId, trigger }],
  };
}

async function decide(
  c: OracleCase,
  lexicon: CandidateCharacter[],
  pages: Page[],
  trigger: string
): Promise<{ accepted: boolean; reasons: string[] }> {
  const candidates = generateInteractionCandidates(pages, lexicon);
  const ids = (n: string) =>
    lexicon.find((x) => x.name === n || x.aliases.some((a) => a.alias === n))?.id;
  const { subject, object } = c.candidate_semantics!;
  const pair = candidates.find(
    (x) => [x.a_id, x.b_id].sort().join() === [ids(subject), ids(object)].sort().join()
  );
  const windowId = pair?.windows.find((w) => w.text.includes(trigger))?.id ?? pair?.windows[0]?.id ?? 'none';
  const run = verifyPairLabels({ relations: [injected(c, windowId, trigger)] }, candidates, pages, lexicon);
  const final = await finalizeStructuredRelationships(run, run, pages, lexicon);
  return {
    accepted: final.accepted.length > 0,
    reasons: final.held.flatMap((h) => h.reasons),
  };
}

function tokens(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\s+/u)
        .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean)
    ),
  ];
}

export async function runStructuralProbe(oracle: { cases: OracleCase[] }, config: ProbeConfig) {
  const results: ProbeResult[] = [];
  let worstFalseAccepts = 0;
  let wrongTotal = 0;
  for (const c of oracle.cases.filter((x) => x.candidate_semantics)) {
    const lexicon = lexiconFor(c, config);
    const pages: Page[] = c.pages.map((p) => ({ id: `${c.id}-${p.page_no}`, book_id: c.id, ...p }));
    const trigger = config.triggers[c.id];
    if (!trigger) throw new Error(`trigger missing for ${c.id}`);
    const expectAccept = c.expected_decision === 'accept';
    const outcome = await decide(c, lexicon, pages, trigger);
    const result: ProbeResult = {
      id: c.id,
      provenance: c.provenance,
      holdout: !!c.holdout,
      expected: expectAccept ? 'accept' : 'hold-unqualified-fact',
      observed: outcome.accepted ? 'accept' : 'hold',
      pass: outcome.accepted === expectAccept,
      trigger,
      reasons: outcome.reasons,
    };
    if (!expectAccept) {
      wrongTotal++;
      for (const t of [trigger, ...tokens(c.pages.map((p) => p.content).join(' '))]) {
        if ((await decide(c, lexicon, pages, t)).accepted) {
          worstFalseAccepts++;
          result.worst_case_trigger = t;
          break;
        }
      }
    }
    results.push(result);
  }
  return {
    mode: 'structural-candidate-injection-only',
    counts: {
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      false_accepts: results.filter((r) => !r.pass && r.observed === 'accept').length,
      false_holds: results.filter((r) => !r.pass && r.observed === 'hold').length,
    },
    worst_case: { wrong_total: wrongTotal, false_accepts: worstFalseAccepts },
    results,
  };
}
