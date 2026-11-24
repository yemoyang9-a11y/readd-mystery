/**
 * 추리 채점 백엔드 대역 — `VITE_USE_MOCK=true` 일 때만 쓰인다 (2026-11-24).
 *
 * ⚠️ 관문은 서버 대역이다. 실제 관문은 백엔드 note-review 라우터가 기준점 결정기(getReviewScope —
 *    커뮤니티와 같은 reached_end)로 정하며, 화면 코드는 이 판정을 갖지 않는다.
 *    게이트 시험은 backend/src/modules/note-review/__tests__ 에 있다.
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { mockPositionResponse, mockReachedEnd } from './server';
import { mockCreateReviewPost, mockMyReviewPostId } from './community';
import type { ReviewCard, ReviewResult, ReviewStatus } from '../src/types';

const results = new Map<string, ReviewResult>();

function reject(status: number, data?: unknown): never {
  throw new AxiosError('mock', 'ERR_BAD_REQUEST', undefined, null, { status, data } as AxiosResponse);
}

function gate(bookId: string): void {
  if (mockPositionResponse(bookId).status !== 200) reject(404);
  if (!mockReachedEnd(bookId)) reject(403, { error: 'REVIEW_LOCKED' });
}

function sample(asHypothesis: string[]): ReviewResult {
  const notes: ReviewResult['notes'] = [
    { note_id: 'mock-h1', page_no: 42, kind: 'hypothesis', chosen_as_hypothesis: false, body: '정 주사가 무언가 숨기고 있다', verdict: 'partial', explanation: '숨긴 것은 있었지만 사건의 중심은 아니었어요.', evidence_page: 188 },
    { note_id: 'mock-h2', page_no: 84, kind: 'hypothesis', chosen_as_hypothesis: false, body: '태수가 은행 돈에 손을 댄 것 같다', verdict: 'hit', explanation: '태수의 횡령이 뒤에서 드러나요.', evidence_page: 204 },
    { note_id: 'mock-c1', page_no: 61, kind: 'clue', chosen_as_hypothesis: false, body: '태수의 씀씀이가 갑자기 커졌다', verdict: 'key', explanation: '횡령을 짐작할 수 있는 핵심 장면이에요.', evidence_page: 61 },
    { note_id: 'mock-c2', page_no: 95, kind: 'clue', chosen_as_hypothesis: false, body: '미두장 이야기가 자주 나온다', verdict: 'related', explanation: '배경으로 중요하지만 진상의 열쇠는 아니에요.', evidence_page: 95 },
    ...asHypothesis.map((id, i) => ({
      note_id: id, page_no: 110 + i, kind: 'hypothesis' as const, chosen_as_hypothesis: true, body: '고른 메모',
      verdict: 'miss' as const, explanation: '진상과는 달랐어요.', evidence_page: 210,
    })),
  ];
  const miss = notes.filter((n) => n.verdict === 'miss').length;
  return {
    version: 1,
    truth_summary: '태수는 은행 돈을 빼돌려 미두에 쏟아부었고, 그 사실이 드러나며 초봉이의 삶이 무너지기 시작해요. 정 주사 집안의 몰락은 개인의 악의보다 돈이 사람을 끌고 가는 흐름에서 비롯돼요.',
    reveal_page: 204,
    notes,
    counts: {
      hypothesis: { hit: 1, partial: 1, miss, total: 2 + miss },
      clue: { key: 1, related: 1, unrelated: 0, total: 2 },
      pending: 0,
    },
    title: miss > 0 ? '조수' : '명탐정',
    early_pages: 120,
    timing_verified: true,
    excluded_count: 1,
    graded_at: new Date().toISOString(),
  };
}

export function mockGetReview(bookId: string): ReviewStatus {
  gate(bookId);
  const done = results.get(bookId);
  if (done) return { state: 'done', result: done, shared_post_id: mockMyReviewPostId(bookId) };
  return {
    state: 'ready',
    busy: false,
    targets: { hypothesis: 2, clue: 2 },
    candidates: [{ note_id: 'mock-m1', page_no: 110, body: '초봉이가 떠날 것 같은 예감' }],
    excluded_count: 1,
    timing_verified: true,
    last_failed: false,
  };
}

export async function mockStartReview(bookId: string, asHypothesis: string[]): Promise<ReviewResult> {
  gate(bookId);
  const existing = results.get(bookId);
  if (existing) return existing;
  await new Promise((resolve) => setTimeout(resolve, 600));
  const result = sample(asHypothesis);
  results.set(bookId, result);
  return result;
}

export function mockShareReview(bookId: string, noteIds: string[], message: string | null): { post_id: string } {
  gate(bookId);
  const result = results.get(bookId) ?? reject(409, { error: 'NOT_GRADED' });
  const chosen = new Set(noteIds);
  const card: ReviewCard = {
    version: 1,
    title: result.title,
    counts: { hypothesis: result.counts.hypothesis, clue: result.counts.clue },
    early_pages: result.early_pages,
    timing_verified: result.timing_verified,
    message,
    notes: result.notes
      .filter((n) => chosen.has(n.note_id))
      .map(({ kind, page_no, body, verdict, explanation, evidence_page }) => ({ kind, page_no, body, verdict, explanation, evidence_page })),
  };
  return { post_id: mockCreateReviewPost(bookId, message, card).post_id };
}
