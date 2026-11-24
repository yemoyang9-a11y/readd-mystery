import type { ReviewResult } from './types';

export type ReviewStatus = 'pending' | 'done' | 'failed';

export interface StoredReview {
  status: ReviewStatus;
  /** status='done' 일 때만 있다 */
  result: ReviewResult | null;
  attempts: number;
  last_error: string | null;
}

/** 채점을 시작할 때 함께 남기는 기록 — note_reviews 행이 채점 호출의 로그를 겸한다 */
export interface ReviewClaimMeta {
  bound_page: number;
  reached_end_at: string | null;
  eligible_count: number;
  excluded_count: number;
  model: string;
}

/**
 * 다른 요청이 채점 중인 기록을 이만큼 지나면 멈춘 것으로 보고 다시 맡는다.
 * 게이트웨이 한 번이 재시도 포함 최대 120초 × 4, 재생성까지 2번이라 그보다 길게 잡는다.
 * 늦게 끝난 옛 요청은 claim_id 가 달라 기록을 덮지 못한다.
 */
export const STALE_PENDING_SECONDS = 1200;

/** 채점을 맡은 요청의 표 — complete·fail 은 이 표가 지금 기록과 같을 때만 반영된다 */
export type ClaimToken = string;

export interface NoteReviewRepository {
  find(readerId: string, bookId: string): Promise<StoredReview | null>;
  /**
   * 채점을 맡는다. 기록이 없거나 실패(failed)였거나 멈춘 pending 이면 pending 으로 바꾸고 'claimed'.
   * 이미 성공(done)했으면 'done', 다른 요청이 채점 중이면 'busy'. 한 문장으로 끝나 두 요청이 함께 맡지 않는다.
   */
  claim(
    readerId: string,
    bookId: string,
    meta: ReviewClaimMeta
  ): Promise<{ token: ClaimToken } | 'busy' | 'done'>;
  /**
   * 성공한 결과를 고정한다. 이 뒤로는 다시 채점하지 않는다 (대표 결정 7번).
   * 표가 다르면(멈춘 것으로 보고 다른 요청이 맡았으면) 반영하지 않고 false.
   */
  complete(
    readerId: string,
    bookId: string,
    token: ClaimToken,
    result: ReviewResult
  ): Promise<boolean>;
  /** 실패는 1회로 치지 않는다 — 결과 없이 failed 로 남겨 다시 누를 수 있게 한다 (대표 결정 12번). 표가 다르면 그대로 */
  fail(readerId: string, bookId: string, token: ClaimToken, error: string): Promise<void>;
}
