/**
 * 추리 채점 — 완독 뒤 내 추리 돌아보기 (대표 결정 2026-11-24)
 *
 * 판정은 AI가 한다(결정 23을 "읽는 동안은 판정하지 않는다. 채점 화면에서만 판정한다"로 좁힘).
 * 아모 챗봇의 판정 금지(절대 규칙 11)는 그대로다 — 이 모듈은 챗봇 응답 경로가 아니다.
 * 칭호·개수·"결말 N쪽 전"은 아래 고정 규칙으로만 정하고 AI에게 맡기지 않는다.
 */

import type { NoteKind } from '../notes/repository';

/** 가설 판정 — 적중 / 부분 적중 / 빗나감 */
export type HypothesisVerdict = 'hit' | 'partial' | 'miss';
/** 단서 판정 — 핵심 / 관련 있음 / 관련 없음 */
export type ClueVerdict = 'key' | 'related' | 'unrelated';
/** 판정 보류 — AI 응답에서 이 노트의 판정이 빠졌거나 형식에 맞지 않았다. 개수에서 뺀다 */
export type PendingVerdict = 'pending';

export const HYPOTHESIS_VERDICTS: readonly HypothesisVerdict[] = ['hit', 'partial', 'miss'];
export const CLUE_VERDICTS: readonly ClueVerdict[] = ['key', 'related', 'unrelated'];

/** 채점 대상은 가설과 단서 노트뿐이다 (대표 결정 3번) */
export type GradedKind = Extract<NoteKind, 'hypothesis' | 'clue'>;

export type ReviewTitle = '명탐정' | '조수' | '견습 탐정';

export interface ReviewedNote {
  note_id: string;
  page_no: number;
  kind: GradedKind;
  /** 독자가 채점 화면에서 "가설이었던 메모"로 고른 일반 메모. 노트 원본의 종류는 바꾸지 않는다 */
  chosen_as_hypothesis: boolean;
  body: string;
  verdict: HypothesisVerdict | ClueVerdict | PendingVerdict;
  /** 한 줄 해설. 판정 보류면 null */
  explanation: string | null;
  /** 판정 근거가 드러나는 쪽. 모르면 null */
  evidence_page: number | null;
}

export interface ReviewCounts {
  hypothesis: { hit: number; partial: number; miss: number; total: number };
  clue: { key: number; related: number; unrelated: number; total: number };
  /** 판정 보류 노트 수 — 위 개수에는 들어가지 않는다 */
  pending: number;
}

/** 저장되는 채점 결과 (note_reviews.result) */
export interface ReviewResult {
  version: 1;
  /** 사건의 진상 요약 3~5문장. 결과지 공유에는 넣지 않는다 (대표 결정 9번) */
  truth_summary: string;
  /** 진상이 밝혀지는 쪽. 모르면 null */
  reveal_page: number | null;
  notes: ReviewedNote[];
  counts: ReviewCounts;
  title: ReviewTitle;
  /** "결말 N쪽 전에 짚었어요"의 N. 적중한 가설이 없거나 계산할 수 없으면 null */
  early_pages: number | null;
  /** 끝에 처음 닿은 시각을 알아 결말 전 노트만 골랐는가. false = "결말 전 기록 여부 확인 안 됨" */
  timing_verified: boolean;
  /** 결말을 본 뒤 쓰거나 고쳐서 뺀 노트 수 */
  excluded_count: number;
  graded_at: string;
}

export function countVerdicts(notes: readonly ReviewedNote[]): ReviewCounts {
  const counts: ReviewCounts = {
    hypothesis: { hit: 0, partial: 0, miss: 0, total: 0 },
    clue: { key: 0, related: 0, unrelated: 0, total: 0 },
    pending: 0,
  };
  for (const note of notes) {
    if (note.verdict === 'pending') {
      counts.pending += 1;
    } else if (note.kind === 'hypothesis') {
      counts.hypothesis[note.verdict as HypothesisVerdict] += 1;
      counts.hypothesis.total += 1;
    } else {
      counts.clue[note.verdict as ClueVerdict] += 1;
      counts.clue.total += 1;
    }
  }
  return counts;
}

/**
 * 칭호 — 고정 규칙. AI가 정하지 않는다 (대표 결정 4번). 문구·기준은 시안 단계에서 대표가 다시 본다.
 *  - 명탐정: 적중한 가설이 1개 이상이고, 판정한 가설의 절반 이상이 적중
 *  - 조수: 적중·부분 적중 가설이 하나라도 있거나 핵심 단서를 하나라도 짚음
 *  - 견습 탐정: 그 밖
 */
export function titleFor(counts: ReviewCounts): ReviewTitle {
  const { hit, partial, total } = counts.hypothesis;
  if (hit >= 1 && hit * 2 >= total) return '명탐정';
  if (hit + partial >= 1 || counts.clue.key >= 1) return '조수';
  return '견습 탐정';
}

/**
 * "결말 N쪽 전에 짚었어요" — 진상이 밝혀지는 쪽에서 적중한 가설 중 가장 이른 노트의 쪽을 뺀다.
 * 결말 전 노트인지 확인하지 못했거나(timing_verified=false) 0 이하이면 null.
 */
export function earlyPagesFor(
  notes: readonly ReviewedNote[],
  revealPage: number | null,
  timingVerified: boolean
): number | null {
  if (revealPage === null || !timingVerified) return null;
  const hits = notes.filter((n) => n.kind === 'hypothesis' && n.verdict === 'hit');
  if (hits.length === 0) return null;
  const earliest = Math.min(...hits.map((n) => n.page_no));
  const gap = revealPage - earliest;
  return gap > 0 ? gap : null;
}
