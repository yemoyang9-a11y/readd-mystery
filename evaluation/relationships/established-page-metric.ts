/**
 * 관계 확립 페이지 비대칭 지표 — FR-CHR-001 🚦
 *
 * 추출한 확립 페이지를 정답(사람이 원문을 읽고 정한 값)과 비교한다. 오류의 방향이 다르게
 * 무겁다:
 *  - 이른 오류(추출 < 정답): 독자가 아직 읽지 않은 쪽에서 드러나는 관계가 미리 보인다 = 스포일러.
 *    1건도 허용하지 않는다.
 *  - 늦은 오류(추출 > 정답): 이미 읽은 관계가 늦게 보인다. 불편이지 스포일러가 아니다. 경고로 센다.
 * 정밀도·재현율만 보면 두 방향이 한 숫자에 섞이므로 따로 센다.
 *
 * 평가 전용 순수 함수다. 제품 코드·DB·LLM을 부르지 않는다.
 */

export interface EstablishedRelationship {
  character_a: string;
  character_b: string;
  /** 두 인물 사이의 같은 의미 이력을 가리키는 키 (semantics.relation_key) */
  relation_key: string;
  established_page: number;
}

export interface PageMismatch {
  character_a: string;
  character_b: string;
  relation_key: string;
  gold_page: number;
  predicted_page: number;
  /** 정답과 벌어진 쪽수 (항상 양수) */
  pages_off: number;
}

export interface EstablishedPageReport {
  counts: {
    /** 정답 관계 수 (같은 관계의 복수 행은 1건) */
    gold: number;
    /** 추출 관계 수 (같은 관계의 복수 행은 1건) */
    predicted: number;
    /** 정답과 추출 양쪽에 있는 관계 수 — 쪽수를 비교한 대상 */
    matched: number;
    exact: number;
    /** 정답보다 이르게 잡힌 관계 수 — 스포일러 방향 */
    early: number;
    /** 정답보다 늦게 잡힌 관계 수 */
    late: number;
    /** 정답에만 있는 관계 수 (누락) */
    missing: number;
    /** 추출에만 있는 관계 수 (정답 표 밖 — 쪽수 판정 불가) */
    unmatched: number;
  };
  early: PageMismatch[];
  late: PageMismatch[];
  /** 이른 오류 0건이고 비교한 관계가 1건 이상일 때만 true — 빈 결과는 통과가 아니다 */
  pass: boolean;
}

const norm = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/gu, "");

/** 두 인물의 저장 순서와 무관한 키 */
function keyOf(r: EstablishedRelationship): string {
  return [
    ...[norm(r.character_a), norm(r.character_b)].sort(),
    norm(r.relation_key),
  ].join("\u0000");
}

/** 같은 관계의 복수 행(이력형)은 가장 이른 쪽으로 묶는다 — 독자에게 처음 보이는 시점 */
function earliest(
  rows: EstablishedRelationship[],
): Map<string, EstablishedRelationship> {
  const out = new Map<string, EstablishedRelationship>();
  for (const row of rows) {
    const key = keyOf(row);
    const seen = out.get(key);
    if (!seen || row.established_page < seen.established_page)
      out.set(key, row);
  }
  return out;
}

export function compareEstablishedPages(
  gold: EstablishedRelationship[],
  predicted: EstablishedRelationship[],
): EstablishedPageReport {
  const goldByKey = earliest(gold);
  const predictedByKey = earliest(predicted);
  const early: PageMismatch[] = [];
  const late: PageMismatch[] = [];
  let matched = 0;
  let exact = 0;

  for (const [key, g] of goldByKey) {
    const p = predictedByKey.get(key);
    if (!p) continue;
    matched++;
    if (p.established_page === g.established_page) {
      exact++;
      continue;
    }
    const mismatch: PageMismatch = {
      character_a: g.character_a,
      character_b: g.character_b,
      relation_key: g.relation_key,
      gold_page: g.established_page,
      predicted_page: p.established_page,
      pages_off: Math.abs(g.established_page - p.established_page),
    };
    (p.established_page < g.established_page ? early : late).push(mismatch);
  }

  return {
    counts: {
      gold: goldByKey.size,
      predicted: predictedByKey.size,
      matched,
      exact,
      early: early.length,
      late: late.length,
      missing: goldByKey.size - matched,
      unmatched: predictedByKey.size - matched,
    },
    early,
    late,
    pass: early.length === 0 && matched > 0,
  };
}

/**
 * 평가 파일에서 관계 행을 꺼낸다. `{cases:[{relationships}]}`(reviewed-source-candidates.json)와
 * `{relationships}`(장 캐시·all-resolved.json) 둘 다 받는다. 인물이 ID로만 적힌 산출물은
 * 같은 파일의 `characters`로 이름을 찾는다. 이름·키·쪽수가 빠진 행은 지어내지 않고 건너뛴다.
 */
export function collectEstablishedRelationships(data: unknown): {
  relationships: EstablishedRelationship[];
  skipped: number;
} {
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const root = record(data);
  const names = new Map<string, string>();
  for (const c of Array.isArray(root.characters) ? root.characters : []) {
    const { id, name } = record(c);
    if (typeof id === "string" && typeof name === "string") names.set(id, name);
  }
  const rows = [
    ...(Array.isArray(root.relationships) ? root.relationships : []),
    ...(Array.isArray(root.cases) ? root.cases : []).flatMap((c) => {
      const list = record(c).relationships;
      return Array.isArray(list) ? list : [];
    }),
  ];
  const relationships: EstablishedRelationship[] = [];
  let skipped = 0;
  for (const row of rows) {
    const r = record(row);
    const a = r.character_a ?? names.get(String(r.character_a_id));
    const b = r.character_b ?? names.get(String(r.character_b_id));
    const key = record(r.semantics).relation_key ?? r.relation_key;
    const page = r.established_page;
    if (
      typeof a !== "string" ||
      typeof b !== "string" ||
      typeof key !== "string" ||
      typeof page !== "number" ||
      !Number.isInteger(page)
    ) {
      skipped++;
      continue;
    }
    relationships.push({
      character_a: a,
      character_b: b,
      relation_key: key,
      established_page: page,
    });
  }
  return { relationships, skipped };
}
