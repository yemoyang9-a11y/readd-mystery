/**
 * 진도·세션 (R2 제공 API 소비)
 *   POST /books/:bookId/entry      진입 판정 (FR-BRF-001). 응답 즉시 resetSeq() 를 부른다
 *   POST /books/:bookId/progress   진도 이벤트, fire-and-forget (NFR-PERF-005)
 *   POST /books/:bookId/progress/confirm  넘겨 본 쪽 확인 답 (2026-11-17)
 *   POST /books/:bookId/heartbeat  5분 주기 (A2)
 *
 * 프론트는 기준점을 계산하지도 보내지도 않는다 (절대 규칙 2·8번).
 * 진도 이벤트를 GET /pages 로 흡수하지 않는다 — R2 거절 확정 (team-sync-r4.md §1.1).
 */

import { api } from './api';
import { USE_MOCK } from '../utils/constants';
import { nextSeq, resetSeq } from '../utils/seq';
import type {
  EntryResponse,
  FrontierChoice,
  ProgressClaim,
  ProgressEvent,
  ProgressResponse,
} from '../types';

let latestEntryRequest = 0;

export async function enterBook(bookId: string): Promise<EntryResponse> {
  const request = ++latestEntryRequest;
  const response = await (async () => {
    if (USE_MOCK) {
      const { mockEntry } = await import('../../mocks/server');
      return mockEntry(bookId);
    }
    const { data } = await api.post<EntryResponse>(`/books/${bookId}/entry`, {});
    return data;
  })();

  // 서버가 event_seq 를 0으로 되돌리므로 로컬 시퀀스도 함께 맞춘다 (team-sync-r4.md §1.6)
  // A late entry for a book already left must not rewind the active book's sequence.
  if (request === latestEntryRequest) resetSeq();
  return response;
}

/**
 * 응답을 화면이 쓸 모양으로 고정한다. applied_cutoff 가 숫자가 아니면 실패로 본다 —
 * 실패 = 미노출 (FR-SPL-005 🚦). confirm 이 빠졌으면 확인 요청 없음(null)으로 읽는다.
 */
function readProgressResponse(data: Partial<ProgressResponse> | null | undefined): ProgressResponse | null {
  if (!data || typeof data.applied_cutoff !== 'number') return null;
  return { success: data.success === true, applied_cutoff: data.applied_cutoff, confirm: data.confirm ?? null };
}

export interface SendProgressOptions {
  /** 이 쪽 직전에 화면에 떠 있던 쪽. 없으면(null·생략) from_page 를 싣지 않는다 */
  fromPage?: number | null;
  /** 목차 확인 창의 "앞부분은 이미 읽었어요" 이동 이벤트 하나에만 넘긴다 */
  claim?: ProgressClaim;
}

/**
 * 페이지 열림이 확정될 때 호출한다. 응답을 기다리지 않는다 — 넘김을 막지 않는다.
 *
 * from_page·claim 은 사실 보고일 뿐이다. 차례로 읽었는지, 기준점을 어디로 둘지는 서버만
 * 정한다 — 프론트는 기준점을 계산하지도 보내지도 않는다 (절대 규칙 2·8번).
 *
 * FR-BRF-005 FR-PRG-003 🚦
 */
export function sendProgress(
  bookId: string,
  page: number,
  opts: SendProgressOptions = {}
): Promise<ProgressResponse | null> {
  const event: ProgressEvent = { page, seq: nextSeq() };
  if (typeof opts.fromPage === 'number') event.from_page = opts.fromPage;
  if (opts.claim) event.claim = opts.claim;

  if (USE_MOCK) {
    return import('../../mocks/server').then(({ mockRecordProgress }) => {
      return mockRecordProgress(bookId, page, { fromPage: event.from_page, claim: event.claim });
    });
  }
  return api
    .post<Partial<ProgressResponse>>(`/books/${bookId}/progress`, event)
    .then(({ data }) => readProgressResponse(data))
    .catch(() => {
      // fire-and-forget — 실패해도 페이지 넘김을 막지 않는다 (NFR-PERF-005)
      return null;
    });
}

/**
 * 싸비 확인 카드의 답. 실패하면 null — 호출자는 카드를 그대로 두고 아무것도 바꾸지 않는다
 * (실패 = 미노출, FR-SPL-005 🚦). 성공(success=true)이어야 기준점을 바꾼 것으로 본다.
 *
 * FR-PRG-003 🚦
 */
export function confirmFrontier(bookId: string, choice: FrontierChoice): Promise<ProgressResponse | null> {
  if (USE_MOCK) {
    return import('../../mocks/server').then(({ mockConfirmFrontier }) => mockConfirmFrontier(bookId, choice));
  }
  return api
    .post<Partial<ProgressResponse>>(`/books/${bookId}/progress/confirm`, { choice })
    .then(({ data }) => {
      const response = readProgressResponse(data);
      return response && response.success ? response : null;
    })
    .catch(() => null);
}

export function sendHeartbeat(bookId: string): void {
  if (USE_MOCK) return;
  void api.post(`/books/${bookId}/heartbeat`, { timestamp: new Date().toISOString() }).catch(() => {
    // 조작 시각 갱신 전용 — 실패가 화면에 영향을 주지 않는다 (A2)
  });
}
