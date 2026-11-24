import { isAxiosError } from 'axios';
import { api } from './api';
import { USE_MOCK } from '../utils/constants';
import type { ReviewResult, ReviewStatus } from '../types';

/**
 * 추리 채점·결과지 공유 (대표 결정 2026-11-24)
 *   GET  /books/:bookId/review
 *   POST /books/:bookId/review          { as_hypothesis?: noteId[] }
 *   POST /books/:bookId/review/share    { note_ids: noteId[], message?: string }
 *
 * 화면은 쪽 번호·완독 여부·판정을 보내지 않는다. 관문과 판정은 서버가 정한다 (절대 규칙 2·8, FR-QNA-004 🚦).
 */

export type ReviewFailure =
  | 'locked'
  | 'no_targets'
  | 'busy'
  | 'failed'
  | 'not_found'
  | 'already_shared'
  | 'rate_limited'
  | 'invalid';

export function classifyReviewError(error: unknown): ReviewFailure {
  if (!isAxiosError(error)) return 'failed';
  const code = error.response?.data?.error;
  switch (error.response?.status) {
    case 403:
      return 'locked';
    case 404:
      return 'not_found';
    case 409:
      return code === 'ALREADY_SHARED' ? 'already_shared' : 'busy';
    case 422:
      return 'no_targets';
    case 429:
      return 'rate_limited';
    case 400:
      return 'invalid';
    default:
      return 'failed';
  }
}

const base = (bookId: string) => `/books/${bookId}/review`;
const mock = () => import('../../mocks/review');

export async function fetchReview(bookId: string): Promise<ReviewStatus> {
  if (USE_MOCK) return (await mock()).mockGetReview(bookId);
  const { data } = await api.get<ReviewStatus>(base(bookId));
  return data;
}

export async function startReview(bookId: string, asHypothesis: string[]): Promise<ReviewResult> {
  if (USE_MOCK) return (await mock()).mockStartReview(bookId, asHypothesis);
  const { data } = await api.post<{ state: 'done'; result: ReviewResult }>(
    base(bookId),
    asHypothesis.length > 0 ? { as_hypothesis: asHypothesis } : {},
    // 채점은 AI 호출이라 오래 걸릴 수 있다
    { timeout: 180_000 }
  );
  return data.result;
}

export async function shareReview(
  bookId: string,
  noteIds: string[],
  message: string | null
): Promise<{ post_id: string }> {
  if (USE_MOCK) return (await mock()).mockShareReview(bookId, noteIds, message);
  const { data } = await api.post<{ post_id: string }>(`${base(bookId)}/share`, {
    note_ids: noteIds,
    ...(message ? { message } : {}),
  });
  return data;
}
