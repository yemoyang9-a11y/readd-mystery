/**
 * 싸비 공통 타입 정의
 *
 * ⚠️ 이 파일은 R1, R2, R3, R4 전원이 공유합니다
 * ⚠️ 수정 시 반드시 팀 합의 후 진행
 */

// ============================================================================
// 기준점 스냅샷 (R2 제공 → R3, R4 소비)
// ============================================================================

/**
 * 기준점 스냅샷
 * R2의 getCutoffSnapshot 반환 타입
 *
 * @see architecture-r1.md 3.3절
 * @see dev-spec-00-shared.md 2.1절
 */
export interface CutoffSnapshot {
  /** 지금 펼친 페이지 (저장값, 이어 읽기 위치) */
  current_page: number;

  /**
   * 기준점 (진도 레코드가 없으면 0, 있으면 차례로 읽었다고 확인된 마지막 쪽) - FR-PRG-003 🚦
   * (2026-11-17 대표 결정 — 가장 멀리 펼친 쪽(max_page)에서 바뀜)
   */
  cutoff: number;

  /** 가장 멀리 펼친 쪽 (저장값 max_page). 기준점이 아니다 — 확인 카드에만 쓴다 */
  furthest_page: number;

  /**
   * 싸비 확인 카드. 가장 멀리 펼친 쪽이 기준점보다 뒤이고 독자가 아직 답하지 않았으면 채워진다.
   * current_page 는 기준점과 가장 먼 쪽 사이일 때만 선택지로 준다.
   */
  frontier_confirm: { current_page: number | null; furthest_page: number } | null;

  /** 진도 퍼센트 (기준점 / total_pages) */
  percent: number;

  /**
   * 완독 여부 — 진도 레코드가 있고 마지막 페이지 이상에 도달했는가.
   *
   * cutoff·percent와 같은 파생값이므로 기준점 결정기(cutoff.service.ts)에서만 계산한다
   * (CLAUDE.md 절대 규칙 2번). 완독은 허용 범위에 관한 상태이며, 검색 완전성이나
   * 작품 전체의 정보 부재를 증명하지 않는다(2026-10-21 정책).
   */
  is_complete: boolean;

  /**
   * 끝까지 갔는가 — 진도 레코드가 있고 가장 멀리 펼친 쪽(저장값 max_page)이 마지막 쪽 이상.
   *
   * 커뮤니티 입장 조건 전용이다 (대표 결정 2026-11-19 정정 — "끝까지 간 독자만, 차례 읽기는
   * 따지지 않음"). 스포일러 상한이 아니다: cutoff·is_complete·챗봇·관계도·타임라인과 무관하다.
   * 파생값이므로 기준점 결정기(cutoff.service.ts)에서만 계산한다 (절대 규칙 2번, R2).
   * 클라이언트는 이 값을 보내지 않는다 — 서버가 진도 이벤트로 저장한 max_page에서만 나온다 (절대 규칙 8번).
   */
  reached_end: boolean;

  /** 현재 장 정보 */
  chapter: {
    chapter_no: number;
    title: string;
  };

  /**
   * 이어 읽기 위치(current_page)가 속한 장 — 홈 이어 읽기 카드의 "제N장 · 쪽" 표시용
   * (2026-11-17 대표 결정). 기준점의 장(chapter)과 다를 수 있다. 장 경계·제목은 목차라
   * 상한 대상이 아니다(R3). 장을 찾지 못하면 null — 다른 장으로 메우지 않는다.
   */
  resume_chapter: { chapter_no: number; title: string } | null;
}

// ============================================================================
// 진도 이벤트 (클라이언트 → R2)
// ============================================================================

/**
 * 진도 이벤트
 *
 * @see architecture-r1.md 3.3절
 */
export interface ProgressEvent {
  /** 페이지 번호 */
  page: number;

  /** 클라이언트 단조 증가 시퀀스 (순서 보장용) */
  seq: number;

  /**
   * 바로 전에 화면에 떠 있던 쪽 (없으면 null·생략). 이동 사실일 뿐 기준점이 아니다 —
   * 서버가 from_page + 1 = page 일 때만 차례 넘김으로 인정한다 (FR-PRG-003 🚦)
   */
  from_page?: number | null;

  /**
   * 목차 확인 창에서 "앞부분은 이미 읽었어요"를 눌렀을 때만 'read_through'.
   * 숫자를 싣지 않는다 — 인정 범위는 이 이벤트의 page 까지다 (절대 규칙 8번)
   */
  claim?: 'read_through' | null;
}

/** 싸비 확인 카드의 선택지. 숫자는 서버 저장값에서 정한다 (절대 규칙 8번) */
export type FrontierConfirmChoice = 'keep' | 'current' | 'furthest';

// ============================================================================
// 리캡 관련 (R2)
// ============================================================================

/**
 * 리캡 입력 (종합 코어용)
 */
export interface RecapInput {
  /** 완결된 장 요약 목록 (종료 페이지 <= K) */
  chapter_summaries: ChapterSummary[];

  /** 현재 장 원문 절단 [현재 장 시작 .. K] */
  current_chapter_text: string | null;

  /** 기준점 (로그용) */
  cutoff: number;
}

export interface ChapterSummary {
  chapter_no: number;
  title: string;
  content: string;
  end_page: number;
}

/**
 * 브리핑 응답
 *
 * ⚠️ applied_cutoff 추가 — R2·R4·R3 CP0 회신 합의(docs-local/R2-reply-to-R4-0820.txt 항목 3·7)로
 *    브리핑 응답 최상단에 K를 싣는다. 첫 진입(applied_cutoff === 0)은 `recap: null`이어도
 *    스트리밍 폴백 대상이 **아니다** — 클라이언트가 이 필드로 "폴백 필요"와 "표시할 내용
 *    자체가 없음"을 구분한다(❓Q1). recap/stream의 done 프레임에도 같은 이름으로 싣는다.
 */
export interface BriefingResponse {
  /** 이 응답이 적용한 기준점 K. 첫 진입 구분의 근거(❓Q1) — recap.service의 판단을 재계산하지 않는다 */
  applied_cutoff: number;

  /** 저장 리캡 (없으면 null, applied_cutoff > 0일 때만 클라이언트가 스트리밍 폴백 호출) */
  recap: string | null;

  /** 목차 위치 — 기준점(applied_cutoff)이 속한 장 */
  current_chapter: {
    chapter_no: number;
    title: string;
  };

  /**
   * 이어 읽기 위치(progress.current_page)가 속한 장. 되돌아가 읽거나 목차로 건너뛰면
   * current_chapter 와 다르다. 찾지 못하면 null (2026-11-17 대표 결정)
   */
  resume_chapter: { chapter_no: number; title: string } | null;

  /** 진도 파생값 */
  progress: {
    current_page: number;
    total_pages: number;
    percent: number;
  };

  /**
   * 마지막으로 읽은 시각(reading_position.updated_at, ISO 8601) — 브리핑의 "N일 만이에요"용.
   * GET /books 의 progress.last_read_at 과 같은 값. 진도 레코드가 없으면 null
   */
  last_read_at: string | null;
}

// ============================================================================
// 챗봇 관련 (R3)
// ============================================================================

/**
 * 챗봇 질의 요청
 */
export interface ChatRequest {
  /** 사용자 질문 */
  query: string;

  /** 진도 이벤트 동봉 (선택사항) */
  page?: number;
  seq?: number;
}

/**
 * 챗봇 근거 컨텍스트 (R3 내부)
 *
 * ⚠️ assembleChatbotContext 함수가 query를 인자로 받지 않음 (NFR-SEC-006 🚦)
 */
/**
 * 챗봇 프롬프트용 장 요약 — 공용 `ChapterSummary`에 시작 페이지를 더한다 (R3 전용).
 *
 * 프롬프트에 "1장 인간기념물 (p.1~17)"처럼 범위를 병기해야 "15페이지까지 요약해줘" 같은
 * 범위 한정 요청을 모델이 판단할 수 있다(시스템 규칙 7번). 리캡(R1·R2)은 이 필드가
 * 필요 없으므로 공용 타입은 건드리지 않는다.
 */
export interface ChatbotChapterSummary extends ChapterSummary {
  start_page: number;
}

export interface ChatbotContext {
  /** 책 제목·저자 (고정 서지 메타데이터) */
  book: {
    title: string;
    author: string;
  };

  /** 장 요약 전량 (장 번호·페이지 범위 병기) */
  chapter_summaries: ChatbotChapterSummary[];

  /** 현재 장 원문 */
  current_chapter_text: string | null;

  /** 엔티티 전량 */
  entities: {
    characters: Character[];
    relationships: Relationship[];
    character_notes: CharacterNote[];
    terms: Term[];
    events: Event[];
  };

  /** 호환용 필드. 위치 근거 없는 생성 배경지식은 챗봇 사실 근거에서 제외한다. */
  background: string;
}

/**
 * 검색 청크 결과
 */
export interface SearchChunk {
  page_no: number;
  content: string;
  distance: number;
}

// ============================================================================
// 챗봇 대화 이력 (R3, 2026-08-24 사용자·R2 조율 결정)
//
// @see backend/migrations/005_chatbot_conversation_history.sql
// ============================================================================

/**
 * 대화 목록 항목
 */
export interface ChatbotConversationSummary {
  id: number;
  /** KST 자정 기준 캘린더 날짜 'YYYY-MM-DD' */
  conversation_date: string;
  /** 첫 질문으로 자동 채워짐 */
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatbotConversationTurnView {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * 대화 상세 — 전체 문답
 */
export interface ChatbotConversationDetail extends ChatbotConversationSummary {
  turns: ChatbotConversationTurnView[];
}

// ============================================================================
// 조회 API 관련 (R4)
// ============================================================================

/**
 * 카탈로그 아이템
 */
export interface BookCatalogItem {
  book_id: string;
  title: string;
  author: string;
  cover_url: string;
  total_pages: number;

  /** 싸비 데이터 준비 여부 (완비 여부) */
  ssabi_ready: boolean;

  /** 읽던 도서인 경우 진도 정보 */
  progress?: {
    current_page: number;
    percent: number;
  };
}

/**
 * 관계도 그래프 JSON
 *
 * @see architecture-r1.md 5.1.2절
 */
export interface RelationshipGraph {
  /** 노드 = 인물 (최초 등장 페이지 <= K) */
  nodes: GraphNode[];

  /** 간선 = 관계 (확립 페이지 <= K, 최신 라벨 1개) */
  edges: GraphEdge[];
  /** FR-SPL-002: only versions already selected within the server cutoff. */
  history?: GraphEdge[];
  applied_cutoff?: number;
}

export interface GraphNode {
  id: string;
  name: string;
  first_appearance_page: number;

  /** 별칭 목록 (최초 등장 페이지 <= K) */
  aliases: string[];
  /** Allows past display selection without showing a later revealed identity. */
  alias_details?: { alias: string; first_appearance_page: number }[];
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  label: string;
  established_page: number;
  semantics?: RelationshipSemantics | null;
}

export interface RelationshipEvidence {
  source_page: number;
  quote: string;
  start_char: number;
  end_char: number;
}

/** Endpoints remain canonical storage slots; direction must never be inferred from UUID order. */
export interface RelationshipSemantics {
  version: 2;
  direction: 'a_to_b' | 'b_to_a' | 'mutual' | 'undirected' | 'unknown';
  kind: 'family' | 'social' | 'emotion' | 'action';
  relation_key: string;
  summary: string;
  reader_summary?: string;
  assertion_status: 'fact' | 'belief' | 'claim' | 'rumor' | 'uncertain' | 'negated';
  attribution?: string;
  temporal_scope: 'ongoing' | 'event';
  state: 'active' | 'ended';
  evidence: RelationshipEvidence;
  change_evidence?: RelationshipEvidence;
  verification?: RelationshipVerification;
}

export interface RelationshipVerification {
  check: 'confirmed' | 'needs_review' | 'held';
  reasons: string[];
  runs_agreed: number;
}

/**
 * 인물 상세 정보
 */
export interface CharacterDetail {
  name: string;
  first_appearance_page: number;

  /** 별칭 목록 */
  aliases: Alias[];

  /** 인물 노트 (근거 페이지 <= K, 최대 8문장) */
  notes: string;
}

// ============================================================================
// 데이터베이스 엔티티 (공통)
// ============================================================================

export interface Character {
  id: string;
  book_id: string;
  name: string;
  first_appearance_page: number;
}

/**
 * 별칭 — `aliases` 테이블에는 **대리키가 없다.** PK 가 (book_id, alias, character_id)
 * 복합키다 (001_content_store.sql).
 *
 * 이 타입에 `id` 가 있어 실제 스키마와 어긋나 있었고, mock QueryClient 테스트가 그
 * 어긋남을 잡지 못해 실 DB 를 붙인 뒤에야 드러났다 (`column a.id does not exist`).
 *
 * `type` 은 API 계약의 필드명이고 DB 컬럼명은 `alias_type` 이다 — 매핑은 어댑터의
 * SQL 이 `alias_type AS type` 으로 한다.
 */
export interface Alias {
  character_id: string;
  alias: string;
  type: 'name' | 'title' | 'kinship' | 'nickname';
  first_appearance_page: number;
}

/**
 * 관계 (이력형)
 * 같은 쌍의 관계가 시간에 따라 변하면 복수 행
 *
 * @see A6 결정
 */
export interface Relationship {
  id: string;
  book_id: string;
  character_a_id: string;
  character_b_id: string;
  label: string;
  established_page: number;
  /** null/absent means legacy, not independently verified direction. */
  semantics?: RelationshipSemantics | null;
}

export interface CharacterNote {
  id: string;
  character_id: string;
  note: string;
  source_page: number;
}

export interface Term {
  id: string;
  book_id: string;
  term: string;
  definition: string;
  first_appearance_page: number;
}

export interface Event {
  id: string;
  book_id: string;
  event: string;
  description: string;
  occurrence_page: number;
}

export interface Page {
  id: string;
  book_id: string;
  page_no: number;
  content: string;
  embedding?: number[]; // 1024 차원 벡터
}

export interface Chapter {
  id: string;
  book_id: string;
  chapter_no: number;
  title: string;
  start_page: number;
  end_page: number;
}

// ============================================================================
// 로그 필드 (NFR-OBS)
// ============================================================================

/**
 * 리캡 호출 로그
 * NFR-OBS-002 🚦
 */
export interface RecapCallLog {
  timestamp: Date;
  device_id: string;
  book_id: string;
  cutoff_page: number;

  /** 투입 장 요약 ID 목록 */
  input_chapter_summary_ids: string[];

  /** 현재 장 절단 페이지 */
  current_chapter_cutoff: number | null;

  /** 출력 참조 (S3 또는 로그 ID) */
  output_ref: string;

  /** 사용 모델 */
  model: string;

  /** 토큰 수 */
  tokens: {
    input: number;
    output: number;
  };

  /** 트리거 유형 */
  trigger: 'realtime' | 'session_end';

  /**
   * 프롬프트에 넣은 목표 문장 수 N (2~5). 2026-11-17 C안 — 리캡 길이 분포 분석용.
   * DB 컬럼은 017 마이그레이션에서 NULL 허용으로 추가했다(그 전 행은 NULL).
   */
  target_sentences: number;

  /** 실제 출력 문자 수 — 공백·소제목 포함, 500자 하드 상한과 같은 기준(잘린 뒤 길이) */
  output_chars: number;

  /** 실제 출력 문장 수 — 소제목 줄 제외 (recap-length.ts `countRecapSentences`) */
  output_sentences: number;

  /**
   * 리캡 출력의 이름꼴 낱말 중 허용 사전(기준 쪽수 이하 인물명·별칭)에도 입력 자료에도 없는
   * 것의 수 (recap-names.ts). 측정용이며 리캡을 막지 않는다. null = 측정 못 함(사전 조회 실패).
   * DB 컬럼은 020 마이그레이션에서 NULL 허용으로 추가했다(그 전 행은 NULL). FR-RCP-001 🚦
   */
  unknown_name_count: number | null;

  /** 위에서 센 낱말 목록 — 사람이 오탐 여부를 확인하는 용도. null = 측정 못 함 */
  unknown_names: string[] | null;
}

/**
 * 챗봇 질의 로그
 * NFR-OBS-005 🚦
 */
export interface ChatbotQueryLog {
  timestamp: Date;
  device_id: string;
  book_id: string;
  cutoff_page: number;
  query: string;
  /** 본문 드래그 인용(신규 UX). K와 무관하게 프롬프트에 별도 주입된 문장 — CP5 인젝션
   *  판정 시 이 필드도 봐야 "K 밖 콘텐츠가 어디서 들어왔는지" 설명이 된다 */
  quote?: string;

  /** 투입 레코드 ID 전수 (구분별) */
  input_records: {
    chapter_summaries: string[];
    current_chapter_pages: number[];
    characters: string[];
    relationships: string[];
    character_notes: string[];
    terms: string[];
    events: string[];
    background: string;
  };

  /** 검색 선정 페이지 번호·스코어 */
  search_selected_pages: Array<{
    page_no: number;
    distance: number;
  }>;

  /** 근거 부재 여부 */
  no_evidence: boolean;

  /** 완독 상태에서 처리된 질의인지. 정보 부재를 단정할 권한을 뜻하지 않는다. */
  is_complete?: boolean;

  /** 선택된 모델 */
  model: string;

  /** Number of logical model requests used to produce this answer. */
  logical_model_calls?: number;

  // FR-QNA-004, NFR-AI-005
  harness?: {
    intent: string;
    violations: string[][];
    regenerated: boolean;
    fixed_answer: boolean;
  };

  /** 출력 참조 */
  output_ref: string;

  /** 토큰 수 */
  tokens: {
    input: number;
    output: number;
  };
}

// ============================================================================
// API 응답 공통
// ============================================================================

export interface ApiError {
  error: string;
  message: string;
  code?: string;
}

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
}

// ============================================================================
// 환경 변수 타입
// ============================================================================

/**
 * OpenAI is the default generation provider; Anthropic remains an explicit legacy option.
 * Cohere embeddings are independent from generation-provider selection.
 *
 * ⚠️ 이 타입은 **어디서도 참조되지 않는다**(실제 검증은 model-config.ts의
 *    validateModelVersions와 database.ts가 각자 한다). 삭제하지 않고 갱신만 한 이유는
 *    `src/shared/types.ts`가 팀 공유 계약 파일이라서다 — 없애는 건 합의가 필요하지만,
 *    존재하지 않는 환경변수 이름을 남겨 두면 그게 정본인 줄 알고 따라 쓰게 된다.
 */
export interface EnvConfig {
  DATABASE_URL: string;
  LLM_PROVIDER?: 'openai' | 'anthropic';
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_REASONING_EFFORT?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_EFFORT?: string;
  COHERE_API_KEY: string;
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
}
