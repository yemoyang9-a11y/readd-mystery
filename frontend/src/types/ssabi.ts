/**
 * 싸비 조회 타입 — API_CONTRACT.md 10·11번 (R4 제공).
 * 모든 필드는 기준점 K 이하로 이미 걸러져 내려온다. 프론트는 초과 여부를 판별하지 않는다
 * (절대 규칙 7번).
 */

/** 관계도 노드 = 인물. 최초 등장 <= K (FR-SPL-002 🚦) */
export interface GraphNode {
  id: string;
  name: string;
  first_appearance_page: number;
  /** 별칭도 최초 등장 <= K 로 걸러진 것만 (D6) */
  aliases: string[];
  /** 별칭의 공개 시점. 서버 cutoff 안에서 선택된 별칭만 내려온다. */
  alias_details?: { alias: string; first_appearance_page: number }[];
}

/** FR-SPL-002 🚦: 서버가 현재 읽은 범위에서 선택한 원문 근거만 포함한다. */
export interface RelationshipEvidence {
  source_page: number;
  quote: string;
  start_char: number;
  end_char: number;
}

export interface RelationshipSemantics {
  version: 2;
  /** source/target은 정렬된 a/b 슬롯이다. 화살표는 이 필드만 따른다. */
  direction: 'a_to_b' | 'b_to_a' | 'mutual' | 'undirected' | 'unknown';
  kind: 'family' | 'social' | 'emotion' | 'action';
  relation_key: string;
  summary: string;
  /** 독자용 쉬운 문장(해요체). 검증을 통과한 것만 있다 — 없으면 문장 없이 관계 이름만 보인다. */
  reader_summary?: string;
  assertion_status: 'fact' | 'belief' | 'claim' | 'rumor' | 'uncertain' | 'negated';
  attribution?: string;
  temporal_scope: 'ongoing' | 'event';
  state: 'active' | 'ended';
  evidence: RelationshipEvidence;
  change_evidence?: RelationshipEvidence;
}

/** 독립 관계별 최신 버전. 저장 슬롯 순서는 의미 방향을 나타내지 않는다. */
export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  label: string;
  established_page: number;
  /** 이전 데이터는 방향·근거가 검증되지 않았으므로 화살표를 추정하지 않는다. */
  semantics?: RelationshipSemantics | null;
}

/** GET /books/:bookId/ssabi/graph */
export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 서버가 동일 cutoff로 선택한 이력. 클라이언트는 이 범위 안에서만 되감는다. */
  history?: GraphEdge[];
  /** 기준점 결정기의 값. 프론트가 재계산하지 않는다 (FR-BRF-005). */
  applied_cutoff?: number;
}

export interface CharacterAlias {
  alias: string;
  type: string;
  first_appearance_page: number;
}

/** GET /books/:bookId/ssabi/characters/:characterId — 노드 선택과 본문 인물명 탭이 같은 응답 */
export interface CharacterResponse {
  name: string;
  first_appearance_page: number;
  aliases: CharacterAlias[];
  /** 근거 페이지 <= K, 최대 8문장. 초과 시 최초 1 + 최근 7 (A5) — 절단은 서버가 한다 */
  notes: string;
}

/**
 * 싸비 4탭 — 추리 노트 · 타임라인 · 인물관계도 · AI 챗봇 (결정 31, 2026-11-18 대표 승인 시안 A안).
 * 최초 열기 기본값은 관계도 (FR-SVB-002)
 */
export type SsabiTab = 'notes' | 'timeline' | 'relationship' | 'chatbot';

/** GET /books/:bookId/ssabi/timeline — 장 시작 쪽·사건 발생 쪽 <= K 로 이미 걸러져 온다 (FR-SPL-002 🚦) */
export interface TimelineChapter {
  chapter_no: number;
  title: string;
  start_page: number;
  end_page: number;
  /** 다 읽은 장인가 — 서버가 기준점으로 정한 값. 프론트는 쪽수로 다시 판정하지 않는다 (FR-BRF-005 🚦) */
  completed: boolean;
  /** 장 간략 요약. 서버가 다 읽은 장에만 싣는다 — 읽는 중인 장·요약 없는 장은 null (FR-SPL-002 🚦, 결정 31) */
  summary: string | null;
}

export interface TimelineEvent {
  id: string;
  event: string;
  /** 독자용 문장. 검증을 통과하지 못했으면 null */
  description: string | null;
  occurrence_page: number;
}

export interface TimelineResponse {
  chapters: TimelineChapter[];
  events: TimelineEvent[];
  applied_cutoff: number;
}
