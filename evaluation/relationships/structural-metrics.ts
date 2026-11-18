/**
 * 관계 추출 정밀도·재현율 + 이른 확립 페이지 수 — FR-CHR-001 🚦
 *
 * 정답(사람이 원문을 읽고 정한 관계)과 추출 결과를 "방향 있는 두 인물 + 관계 키"로 맞춘다.
 * Labatut & Bost 2019 7.1.3: 연결망 추출의 표준 평가는 수작업 정답 대비 정밀도·재현율이다.
 * 거기에 우리 고유 축(스포일러 방향) — 정답보다 이른 확립 페이지 수 — 를 더한다. 이른 오류는 0이어야 한다.
 *
 * 평가 전용 순수 함수다. 제품 코드·DB·LLM을 부르지 않는다.
 */

export interface GoldRelationship {
  subject: string;
  object: string;
  relation_key: string;
  /** false면 두 인물 순서를 따지지 않는다(남매·혼인 등) */
  directed: boolean;
  established_page?: number;
}

export interface PredictedRelationship {
  character_a: string;
  character_b: string;
  direction: 'a_to_b' | 'b_to_a' | 'mutual' | 'undirected' | 'unknown';
  relation_key: string;
  established_page: number;
}

export interface PageOff {
  character_a: string;
  character_b: string;
  relation_key: string;
  gold_page: number;
  predicted_page: number;
}

export interface StructuralScore {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  early_established: number;
  late_established: number;
  early: PageOff[];
  late: PageOff[];
  unmatched_predictions: PredictedRelationship[];
  missing_gold: GoldRelationship[];
  /** 이른 확립 0건이고 맞힌 관계가 1건 이상 — 빈 결과는 통과가 아니다 */
  pass: boolean;
}

/** 같은 관계로 보는 키 — 짧고 명시적인 목록만. 늘릴 때는 원문 근거로 정당화한다 */
export const RELATION_KEY_SYNONYMS: string[][] = [
  ['jealousy', 'envy'],
  ['siblings', 'sibling', 'brother_sister'],
  ['marriage', 'married', 'spouse'],
  ['possessive_desire', 'desire', 'lust'],
];

const norm = (text: string): string => text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();

function keyClass(key: string): string {
  const k = norm(key);
  const group = RELATION_KEY_SYNONYMS.find((g) => g.includes(k));
  return group ? group[0] : k;
}

function oriented(p: PredictedRelationship): { s: string; o: string; directed: boolean } {
  if (p.direction === 'a_to_b') return { s: norm(p.character_a), o: norm(p.character_b), directed: true };
  if (p.direction === 'b_to_a') return { s: norm(p.character_b), o: norm(p.character_a), directed: true };
  return { s: norm(p.character_a), o: norm(p.character_b), directed: false };
}

function matches(g: GoldRelationship, p: PredictedRelationship): boolean {
  if (keyClass(g.relation_key) !== keyClass(p.relation_key)) return false;
  const x = oriented(p);
  const gs = norm(g.subject);
  const go = norm(g.object);
  if (g.directed) return x.directed && x.s === gs && x.o === go;
  return (x.s === gs && x.o === go) || (x.s === go && x.o === gs);
}

/**
 * 이력형 복수 행은 같은 관계로 합치고 가장 이른 확립 페이지로 비교한다(스포일러 방향을 놓치지 않게).
 */
export function scoreRelationships(
  gold: GoldRelationship[],
  predicted: PredictedRelationship[]
): StructuralScore {
  const used = new Set<number>();
  const early: PageOff[] = [];
  const late: PageOff[] = [];
  const missing: GoldRelationship[] = [];
  let tp = 0;
  for (const g of gold) {
    const hits = predicted.map((p, i) => ({ p, i })).filter(({ p }) => matches(g, p));
    if (hits.length === 0) {
      missing.push(g);
      continue;
    }
    tp++;
    for (const h of hits) used.add(h.i);
    const page = Math.min(...hits.map((h) => h.p.established_page));
    if (g.established_page !== undefined) {
      const row = {
        character_a: g.subject,
        character_b: g.object,
        relation_key: g.relation_key,
        gold_page: g.established_page,
        predicted_page: page,
      };
      if (page < g.established_page) early.push(row);
      if (page > g.established_page) late.push(row);
    }
  }
  const unmatched = predicted.filter((_, i) => !used.has(i));
  // 같은 관계의 복수 행을 fp로 세지 않도록, 맞힌 정답 수 기준으로 정밀도를 낸다
  const fp = unmatched.length;
  const fn = missing.length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = gold.length === 0 ? 0 : tp / gold.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    early_established: early.length,
    late_established: late.length,
    early,
    late,
    unmatched_predictions: unmatched,
    missing_gold: missing,
    pass: early.length === 0 && tp > 0,
  };
}

/** reviewed-source-candidates.json·oracle.json → 정답 목록 */
export function goldFromEvaluatorFiles(
  reviewed: { cases: { relationships: { character_a: string; character_b: string; established_page: number; semantics: { direction: string; relation_key: string } }[] }[] },
  oracle?: { cases: { candidate_semantics?: { subject: string; object: string; kind: string }; expected_decision?: string; expected_facts?: { subject: string; object: string; kind: string; directed: boolean }[]; pages: { page_no: number }[] }[] }
): GoldRelationship[] {
  const out: GoldRelationship[] = [];
  for (const c of reviewed.cases)
    for (const r of c.relationships) {
      const d = r.semantics.direction;
      out.push({
        subject: d === 'b_to_a' ? r.character_b : r.character_a,
        object: d === 'b_to_a' ? r.character_a : r.character_b,
        relation_key: r.semantics.relation_key,
        directed: d === 'a_to_b' || d === 'b_to_a',
        established_page: r.established_page,
      });
    }
  for (const c of oracle?.cases ?? []) {
    if (c.candidate_semantics && c.expected_decision === 'accept')
      out.push({
        subject: c.candidate_semantics.subject,
        object: c.candidate_semantics.object,
        relation_key: c.candidate_semantics.kind,
        directed: true,
        established_page: c.pages[0].page_no,
      });
    for (const f of c.expected_facts ?? [])
      out.push({ subject: f.subject, object: f.object, relation_key: f.kind, directed: f.directed });
  }
  return out;
}
