/**
 * 추리 채점 화면의 범위 — 기준점 결정기 getReviewScope (대표 결정 2026-11-24)
 *
 * 채점 화면은 커뮤니티와 같은 관문(끝까지 간 독자, reached_end)으로 열고, 열렸을 때만 책 끝 쪽까지를
 * 채점 근거 범위로 준다. 2026-11-19 결정("reached_end 는 스포일러 상한에 쓰지 않는다")의 예외이며
 * 이 경로 하나에만 쓴다. 범위 숫자는 기준점 결정기에서만 나온다 (절대 규칙 2번, R2).
 *
 * "끝에 처음 닿은 시각"(reached_end_at)은 가장 멀리 펼친 쪽이 마지막 쪽에 처음 닿은 순간 한 번만
 * 기록된다. 이 기능 전에 이미 끝까지 간 독자는 시각이 없다(null) — 채점에서 "확인 안 됨"으로 보인다.
 *
 * 조항: FR-QNA-004 🚦, FR-BRF-005 🚦, FR-SPL-005 🚦
 */

import { createCutoffService } from '../../../src/modules/reading-state/cutoff.service';
import { createProgressService } from '../../../src/modules/reading-state/progress.service';
import { SEED_DEVICE_ID, makeSeededFakes } from './fakes';

const BOOK_ID = 'review-book';
const CHAPTERS = [
  { chapter_no: 1, title: '1장', start_page: 1, end_page: 50 },
  { chapter_no: 2, title: '2장', start_page: 51, end_page: 100 },
];
const D = SEED_DEVICE_ID;

function setup() {
  const { positions, books } = makeSeededFakes();
  books.set(BOOK_ID, { total_pages: 100, chapters: CHAPTERS });
  const progress = createProgressService({ positions, books });
  const cutoff = createCutoffService({ positions, books });
  let seq = 0;
  const go = (page: number, from_page?: number | null) =>
    progress.acceptProgressEvent(D, BOOK_ID, { page, seq: ++seq, from_page });
  return { positions, go, scope: () => cutoff.getReviewScope(D, BOOK_ID) };
}

describe('채점 범위 — 끝까지 간 독자만, 범위는 책 끝 (FR-QNA-004 🚦)', () => {
  test('FR-QNA-004: 진도 레코드가 없으면 채점 화면이 닫혀 있다', async () => {
    const t = setup();
    expect(await t.scope()).toEqual({ open: false });
  });

  test('FR-QNA-004: 목차로 40쪽까지만 가면 닫혀 있다 — 범위 숫자를 주지 않는다', async () => {
    const t = setup();
    await t.go(1, null);
    await t.go(40, 1);
    const scope = await t.scope();
    expect(scope.open).toBe(false);
    expect(scope).not.toHaveProperty('bound');
  });

  test('FR-QNA-004: 마지막 쪽을 펼치면 열리고 범위는 책 끝 쪽 (positive 쌍)', async () => {
    const t = setup();
    await t.go(1, null);
    await t.go(100, 1);
    const scope = await t.scope();
    expect(scope.open).toBe(true);
    if (!scope.open) return;
    expect(scope.bound).toBe(100);
  });

  test('끝에 처음 닿은 시각은 마지막 쪽을 처음 펼칠 때 기록되고, 다시 가도 바뀌지 않는다', async () => {
    const t = setup();
    await t.go(1, null);
    await t.go(99, 1);
    const before = await t.positions.findPosition(D, BOOK_ID);
    expect(before?.reached_end_at ?? null).toBeNull();

    await t.go(100, 99);
    const first = await t.scope();
    if (!first.open) throw new Error('열려야 한다');
    expect(first.reached_end_at).not.toBeNull();

    await t.go(20, 100);
    await t.go(100, 20);
    const again = await t.scope();
    if (!again.open) throw new Error('열려야 한다');
    expect(again.reached_end_at).toBe(first.reached_end_at);
  });

  test('이 기능 전에 이미 끝까지 간 독자는 시각이 없다 — 나중에 움직여도 지금 시각으로 채우지 않는다', async () => {
    const t = setup();
    t.positions.set(D, BOOK_ID, { current_page: 100, event_seq: 5, max_page: 100 });
    await t.go(30, 100);
    const scope = await t.scope();
    if (!scope.open) throw new Error('열려야 한다');
    expect(scope.reached_end_at).toBeNull();
  });

  test('FR-SPL-005: 도서의 전체 쪽수를 모르면 범위를 만들지 않고 던진다', async () => {
    const t = setup();
    const { positions, books } = makeSeededFakes();
    const cutoff = createCutoffService({ positions, books });
    positions.set(D, 'no-such-book', { current_page: 10, event_seq: 1, max_page: 10 });
    await expect(cutoff.getReviewScope(D, 'no-such-book')).rejects.toThrow();
    expect(t).toBeDefined();
  });
});
