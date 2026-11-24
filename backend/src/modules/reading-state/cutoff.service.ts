/**
 * ⭐ 기준점 결정기 — 이 시스템의 유일한 파생값 계산 지점 (R2, S1)
 *
 * @see CLAUDE.md 3장 — 시스템의 축
 * @see architecture-r1.md 3.3절 — 결정 지점과 전파
 * @see dev-spec-00-shared.md 2.1절 — 동결 계약
 * @see dev-spec-R2-core.md S1
 *
 * 조항: FR-PRG-003 🚦 (기준점 규칙) · FR-BRF-005 🚦 (파생값 단일 원천)
 *
 * ┌ 저장값 ─────────────────────────────────────────────────────────────┐
 * │  reading_position.current_page   ← 지금 펼친 페이지 (이어 읽기)        │
 * │  reading_position.max_page       ← 가장 멀리 펼친 페이지 (확인 카드용)  │
 * │  reading_position.read_pages     ← 읽음으로 인정된 쪽들 (줄지 않음)     │
 * │  reading_position.confirm_dismissed_max ← 확인 카드 "그대로" 기록       │
 * └─────────────────────────────────────────────────────────────────────┘
 *      frontier    = read_pages 에서 1쪽부터 끊김 없이 이어진 마지막 쪽 (없으면 0)
 *      cutoff      = 진도 레코드 없음 ? 0 : frontier   (FR-PRG-003 🚦, 2026-11-17 대표 결정 A + C안)
 *      percent     = cutoff / total_pages
 *      is_complete = 진도 레코드 있음 && frontier >= total_pages  (D14, FR-QNA-004 🚦)
 *      reached_end = 진도 레코드 있음 && max_page >= total_pages  (커뮤니티 입장 전용.
 *                    스포일러 상한 아님. 대표 결정 2026-11-19 정정 — 차례 읽기는 따지지 않음)
 *      chapter     = max(cutoff, 1)이 속한 장
 *      resume_chapter = current_page(이어 읽기 위치)가 속한 장. 못 찾으면 null
 *      frontier_confirm = max_page > cutoff 이고 max_page > confirm_dismissed_max 일 때만
 *
 * ⚠️ **이 파일 밖에서 cutoff나 `%`를 계산하는 코드는 존재해서는 안 된다** (프론트 포함).
 *    FR-BRF-005의 "불일치 0건"은 검증이 아니라 계산 지점 단일화로 달성한다.
 *    tests/static/derived-value-single-source.test.ts 가 이것을 기계적으로 고정한다.
 *
 * ⚠️ 기준점을 움직일 수 있는 입력은 "페이지 이동" 하나뿐이다. 이 함수는 인자로
 *    (deviceId, bookId)만 받는다 — 클라이언트가 기준점·페이지를 실어 보내는 경로가 없다
 *    (절대 규칙 8번, 3.3절). 진도 이벤트의 수용은 S2의 몫이며, 그 결과가 저장값에
 *    반영된 다음 이 함수가 파생만 담당한다.
 */

import type { CutoffSnapshot } from '../../shared/types';
import type { BookMetaReader, ReadingPositionRepository } from './repository';

export interface CutoffServiceDeps {
  positions: ReadingPositionRepository;
  books: BookMetaReader;
}

export interface PositionResponse {
  applied_cutoff: number;
  current_chapter_no: number | null;
  read_chapter_nos: number[];
  is_complete: boolean;
}

export interface CutoffService {
  /**
   * 기준점 스냅샷을 1회 만든다.
   *
   * 각 요청은 시작 시 이 스냅샷을 **1회** 받아, 요청 내 모든 쿼리·조립·로그가 그 값을
   * 쓴다. 질의 도중 페이지가 바뀌어도 그 요청은 시작 시점 기준점을 유지한다
   * (dev-spec-00-shared.md 2.1절, UC-27 A5).
   *
   * @throws 도서가 없거나 장 커버리지에 구멍이 있으면 스냅샷을 만들지 않고 던진다.
   *         실패 = 미노출이 원칙이므로 기본값으로 메우지 않는다 (FR-SPL-005 🚦, R11).
   */
  getCutoffSnapshot(deviceId: string, bookId: string): Promise<CutoffSnapshot>;
}

/**
 * 추리 채점 화면의 범위 (대표 결정 2026-11-24).
 * open 이면 책 끝 쪽(bound)까지를 채점 근거로 쓴다. 닫혀 있으면 숫자를 주지 않는다.
 */
export type ReviewScope =
  | { open: false }
  | {
      open: true;
      /** 채점 근거 조회의 상한 — 책의 마지막 쪽 */
      bound: number;
      /** 끝에 처음 닿은 시각. 029 전에 끝까지 간 독자는 null */
      reached_end_at: string | null;
    };

export interface ReviewScopeService {
  /**
   * 채점 화면은 커뮤니티와 같은 관문(reached_end)으로 연다. 2026-11-19 결정("reached_end 는 스포일러
   * 상한에 쓰지 않는다")의 예외이며 이 경로 하나에만 쓴다 — 싸비·아모의 상한은 getCutoffSnapshot().cutoff
   * 그대로다 (FR-QNA-004 🚦, R4). 실패 = 미노출: 쪽수를 모르면 던진다 (FR-SPL-005 🚦).
   */
  getReviewScope(deviceId: string, bookId: string): Promise<ReviewScope>;
}

export interface ReadChaptersService {
  // FR-SPL-002 🚦
  getReadChapters(deviceId: string, bookId: string): Promise<PositionResponse>;
}

/**
 * 진도 레코드가 없을 때(첫 진입) 화면에 보여줄 위치.
 *
 * 페이지 번호는 1-based이고(API_CONTRACT.md 공통 규칙) 첫 진입의 '마저 읽기'는
 * 1페이지로 들어간다(architecture-r1.md 4.1절). 표시용 위치일 뿐이며 cutoff는 이 값이
 * 아니라 **레코드 유무**로 가른다 — getCutoffSnapshot 주석 참고.
 */
export const FIRST_ENTRY_PAGE = 1;

/** 진도 % 표시 자리수. API_CONTRACT.md 예시(80 / 340 → 23.5)와 같은 규칙 */
const PERCENT_DECIMALS = 1;

export function createCutoffService(
  deps: CutoffServiceDeps
): CutoffService & ReadChaptersService & ReviewScopeService {
  const { positions, books } = deps;

  const service: CutoffService & ReadChaptersService & ReviewScopeService = {
    async getCutoffSnapshot(deviceId: string, bookId: string): Promise<CutoffSnapshot> {
      const stored = await positions.findPosition(deviceId, bookId);

      const currentPage = stored?.current_page ?? FIRST_ENTRY_PAGE;
      const furthestPage = stored?.max_page ?? FIRST_ENTRY_PAGE;
      // FR-PRG-003 🚦 — 1쪽부터 끊김 없이 읽었다고 인정된 마지막 쪽
      const frontier = contiguousFrontier(stored?.read_pages ?? []);

      const totalPages = await books.findTotalPages(bookId);
      if (totalPages === null || totalPages <= 0) {
        throw new Error(
          `[cutoff] 도서의 total_pages를 확인할 수 없어 스냅샷을 만들지 않는다: bookId=${bookId}`
        );
      }

      // FR-BRF-005 🚦, FR-QNA-004 🚦
      const isComplete = stored !== null && frontier >= totalPages;
      // FR-PRG-003 🚦 — 완독한 책은 다시 읽어도 처음 읽는 것처럼 지금 펼친 쪽까지만 (2026-11-20 대표 결정)
      const frontierCutoff = stored === null ? 0 : frontier;
      const cutoff = isComplete ? currentPage : frontierCutoff;
      const chapterPage = Math.max(cutoff, FIRST_ENTRY_PAGE);

      const chapter = await books.findChapterContaining(bookId, chapterPage);
      if (chapter === null) {
        // 장 범위 합집합 = [1, 마지막 페이지] 완전 커버는 파이프라인이 검증한다
        // (FR-DAT-001 🚦). 여기 도달했다면 데이터 결함이므로 조용히 삼키지 않는다.
        throw new Error(
          `[cutoff] page=${chapterPage}가 속한 장을 찾을 수 없어 스냅샷을 만들지 않는다: bookId=${bookId}`
        );
      }

      // FR-BRF-005 🚦 — 이어 읽기 위치의 장 (2026-11-17 대표 결정). 홈 카드가 "제N장 · 쪽"을
      // 같은 원천에서 받게 한다. 장 경계·제목은 목차라 상한 대상이 아니다 (R3, FR-NAV-001).
      // 못 찾으면 null — 기준점의 장으로 메우지 않는다 (FR-SPL-005 🚦).
      const resumeChapter =
        chapter.start_page <= currentPage && currentPage <= chapter.end_page
          ? chapter
          : await books.findChapterContaining(bookId, currentPage);

      // ── 파생 계산: 이 블록이 시스템 전체의 유일한 계산 지점이다 ──────────────
      const percent = round(
        (frontier / totalPages) * 100, // FR-BRF-005 🚦
        PERCENT_DECIMALS
      );
      // FR-QNA-004 🚦
      const cutoffAtEnd = stored !== null && cutoff >= totalPages;
      // 대표 결정 2026-11-19 정정 — 커뮤니티는 끝까지 간 독자만. 가장 멀리 펼친 쪽(저장값)이
      // 마지막 쪽이면 된다. 차례 읽기는 따지지 않는다. cutoff·is_complete 에는 관여하지 않는다
      const reachedEnd = reachedEndOf(stored, totalPages);
      // FR-PRG-003 🚦 — 확인 카드. 숫자는 전부 저장값이다
      const frontierConfirm =
        stored !== null && furthestPage > frontier && furthestPage > stored.confirm_dismissed_max
          ? {
              current_page:
                currentPage > frontier && currentPage < furthestPage ? currentPage : null,
              furthest_page: furthestPage,
            }
          : null;
      // ───────────────────────────────────────────────────────────────────────

      return {
        current_page: currentPage,
        cutoff,
        furthest_page: stored === null ? 0 : furthestPage,
        frontier_confirm: frontierConfirm,
        percent,
        is_complete: isComplete,
        cutoff_at_end: cutoffAtEnd,
        reached_end: reachedEnd,
        chapter: {
          chapter_no: chapter.chapter_no,
          title: chapter.title,
        },
        resume_chapter:
          resumeChapter === null
            ? null
            : { chapter_no: resumeChapter.chapter_no, title: resumeChapter.title },
      };
    },

    async getReviewScope(deviceId: string, bookId: string): Promise<ReviewScope> {
      const stored = await positions.findPosition(deviceId, bookId);
      const totalPages = await books.findTotalPages(bookId);
      if (totalPages === null || totalPages <= 0) {
        throw new Error(
          `[cutoff] 도서의 total_pages를 확인할 수 없어 채점 범위를 만들지 않는다: bookId=${bookId}`
        );
      }
      // FR-QNA-004 🚦 — 커뮤니티 관문과 같은 식 하나를 쓴다 (R2)
      if (!reachedEndOf(stored, totalPages)) return { open: false };
      return { open: true, bound: totalPages, reached_end_at: stored?.reached_end_at ?? null };
    },

    async getReadChapters(deviceId: string, bookId: string): Promise<PositionResponse> {
      const snapshot = await service.getCutoffSnapshot(deviceId, bookId);
      return {
        applied_cutoff: snapshot.cutoff,
        current_chapter_no: snapshot.cutoff === 0 ? null : snapshot.chapter.chapter_no,
        // FR-SPL-002 🚦
        read_chapter_nos: await books.findCompletedChapterNos(bookId, snapshot.cutoff),
        is_complete: snapshot.is_complete,
      };
    },
  };

  return service;
}

/**
 * 끝까지 감 — 진도 레코드가 있고 가장 멀리 펼친 쪽(저장값)이 마지막 쪽 이상.
 * 커뮤니티 입장과 추리 채점 화면의 관문. 스포일러 상한(cutoff)에는 쓰지 않는다 (2026-11-19, 2026-11-24).
 */
function reachedEndOf(stored: { max_page: number } | null, totalPages: number): boolean {
  return stored !== null && stored.max_page >= totalPages;
}

/**
 * 1쪽부터 끊김 없이 이어진 마지막 쪽. 하나도 없으면 0.
 * 기준점 파생이므로 이 파일에만 둔다 (FR-BRF-005 🚦, 절대 규칙 2번).
 */
function contiguousFrontier(readPages: readonly number[]): number {
  const read = new Set(readPages);
  let frontier = 0;
  while (read.has(frontier + 1)) frontier += 1;
  return frontier;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
