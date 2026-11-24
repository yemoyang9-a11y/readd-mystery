/**
 * 추리 채점 — 완독 뒤 내 추리 돌아보기 (대표 결정 2026-11-24). 서버 note-review 모듈의 응답 그대로.
 * 판정·개수·칭호는 서버가 정한다. 화면은 받은 값을 그리기만 한다 (절대 규칙 2·8).
 */

export type HypothesisVerdict = 'hit' | 'partial' | 'miss';
export type ClueVerdict = 'key' | 'related' | 'unrelated';
export type ReviewVerdict = HypothesisVerdict | ClueVerdict | 'pending';

export interface ReviewedNote {
  note_id: string;
  page_no: number;
  kind: 'hypothesis' | 'clue';
  chosen_as_hypothesis: boolean;
  body: string;
  verdict: ReviewVerdict;
  explanation: string | null;
  evidence_page: number | null;
}

export interface ReviewCounts {
  hypothesis: { hit: number; partial: number; miss: number; total: number };
  clue: { key: number; related: number; unrelated: number; total: number };
  pending?: number;
}

export interface ReviewResult {
  version: 1;
  truth_summary: string;
  reveal_page: number | null;
  notes: ReviewedNote[];
  counts: ReviewCounts;
  title: string;
  early_pages: number | null;
  timing_verified: boolean;
  excluded_count: number;
  graded_at: string;
}

export interface ReviewCandidate {
  note_id: string;
  page_no: number;
  body: string;
}

export type ReviewStatus =
  | { state: 'done'; result: ReviewResult; shared_post_id: string | null }
  | {
      state: 'ready';
      busy: boolean;
      targets: { hypothesis: number; clue: number };
      candidates: ReviewCandidate[];
      excluded_count: number;
      timing_verified: boolean;
      last_failed: boolean;
    };

/** 커뮤니티 글에 붙은 결과지 — 공유한 시점의 복사본. 진상 요약은 없다 (대표 결정 9번) */
export interface ReviewCard {
  version: 1;
  title: string;
  counts: ReviewCounts;
  early_pages: number | null;
  timing_verified: boolean;
  message: string | null;
  notes: {
    kind: 'hypothesis' | 'clue';
    page_no: number;
    body: string;
    verdict: ReviewVerdict;
    explanation: string | null;
    evidence_page: number | null;
  }[];
}
