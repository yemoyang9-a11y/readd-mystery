/**
 * 진도 이벤트 수용 — seq 순서 보장 (R2, S2)
 *
 * @see dev-spec-R2-core.md S2
 * @see dev-spec-00-shared.md 2.5절, 3.3절
 *
 * 조항: FR-PRG-002 (진도 순서 보장)
 *
 * `POST /books/{b}/progress`가 받는 `{page, seq}`와, 싸비·리캡·챗봇 조회 요청에 동봉된
 * `(page, seq)`는 **같은 함수**를 거친다 (3.3절) — "페이지 넘긴 직후 싸비를 열었는데
 * 저장이 아직 안 됨" 경합을 별도 분기 없이 이 함수 하나로 닫는다.
 *
 * ⚠️ 순서 판단은 저장소의 조건부 저장에 맡긴다. cutoff·percent 파생은 다루지 않는다 — 그건 저장 이후
 *    cutoff.service.ts가 담당한다 (FR-BRF-005 🚦, 계산 지점 단일화).
 */

import type { FrontierConfirmChoice, ProgressEvent } from '../../shared/types';
import type { ReadingPositionRepository } from './repository';

export interface ProgressServiceDeps {
  positions: ReadingPositionRepository;
}

export interface ProgressService {
  /**
   * 진도 이벤트를 수용한다. 저장된 seq보다 **더 새로울 때만** 반영한다
   * (FR-PRG-002). 빠른 연속 넘김·역방향 이동에서 이벤트가 역순 도착해도
   * 저장 위치가 뒤로 밀리지 않는다. 저장 위치가 없으면(첫 진입) 무조건 수용한다.
   *
   * 비블로킹·동기 커밋 여부는 호출부(라우트 핸들러)의 책임이다 — 이 함수 자체는
   * 저장소 쓰기 1회로 끝나는 순수 판단 로직이다.
   */
  acceptProgressEvent(
    deviceId: string,
    bookId: string,
    event: ProgressEvent,
    writerDeviceId?: string | null
  ): Promise<void>;

  /**
   * 싸비 확인 카드의 답을 반영한다. 클라이언트는 선택지 id 만 보내고, 인정할 쪽은 서버의
   * 저장값(current_page·max_page)에서 정한다 (절대 규칙 8번). 저장 위치가 없으면 아무 것도
   * 하지 않는다.
   */
  confirmFrontier(deviceId: string, bookId: string, choice: FrontierConfirmChoice): Promise<void>;
}

/** 1쪽부터 last쪽까지 */
function throughPage(last: number): number[] {
  return Array.from({ length: Math.max(0, Math.floor(last)) }, (_, i) => i + 1);
}

/**
 * 이 이동으로 읽음 인정되는 쪽들 (2026-11-17 대표 결정 A + C안). 기준점 계산은 하지 않는다 —
 * 인정된 쪽들을 저장할 뿐이고, 1쪽부터 이어진 마지막 쪽을 찾는 것은 기준점 결정기의 몫이다.
 *
 * - claim=read_through(목차 확인 창 "앞부분은 이미 읽었어요") → 1 ~ page
 * - '다음' 넘김(from_page + 1 = page) → 떠난 쪽과 도착한 쪽
 * - 1쪽 도착 → 1쪽 (책의 시작)
 * - 그 밖(목차·노트·되돌아가기·재진입) → 없음
 *
 * FR-PRG-003 🚦
 */
export function pagesReadByEvent(event: ProgressEvent): number[] {
  if (event.claim === 'read_through') return throughPage(event.page);
  const from = event.from_page;
  if (typeof from === 'number' && from + 1 === event.page) return [from, event.page];
  if (event.page === 1) return [1];
  return [];
}

export function createProgressService(deps: ProgressServiceDeps): ProgressService {
  const { positions } = deps;

  return {
    async acceptProgressEvent(
      deviceId: string,
      bookId: string,
      event: ProgressEvent,
      writerDeviceId: string | null = null
    ): Promise<void> {
      // FR-PRG-002, FR-PRG-003
      await positions.savePosition(
        deviceId,
        bookId,
        { current_page: event.page, event_seq: event.seq },
        writerDeviceId
      );
      // FR-PRG-003 🚦 — seq 판정과 무관하게 합친다. 늦게 도착한 차례 넘김도 인정된다
      const read = pagesReadByEvent(event);
      if (read.length > 0) await positions.addReadPages(deviceId, bookId, read);
    },

    async confirmFrontier(
      deviceId: string,
      bookId: string,
      choice: FrontierConfirmChoice
    ): Promise<void> {
      const stored = await positions.findPosition(deviceId, bookId);
      if (stored === null) return;
      // FR-PRG-003 🚦, 절대 규칙 8번 — 숫자는 저장값에서
      if (choice === 'keep') {
        await positions.dismissFrontierConfirm(deviceId, bookId, stored.max_page);
        return;
      }
      const upTo = choice === 'current' ? stored.current_page : stored.max_page;
      await positions.addReadPages(deviceId, bookId, throughPage(upTo));
    },
  };
}
