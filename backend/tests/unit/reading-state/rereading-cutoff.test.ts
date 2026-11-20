/**
 * 다시 읽기 — 완독한 책은 싸비에 보이는 범위(K)가 지금 펼친 쪽 (2026-11-20 대표 결정)
 *
 * 완독 기록(is_complete·percent·reached_end·확인 카드)은 차례로 읽은 쪽 기준 그대로이고,
 * 기준점 K 만 지금 펼친 쪽을 따라 오르내린다. 읽는 중인 책(완독 전)은 전혀 달라지지 않는다.
 *
 * 조항: FR-PRG-003 🚦, FR-BRF-005 🚦, FR-SPL-002 🚦
 */

import { createCutoffService } from '../../../src/modules/reading-state/cutoff.service';
import { createProgressService } from '../../../src/modules/reading-state/progress.service';
import { SEED_DEVICE_ID, makeSeededFakes } from './fakes';

const BOOK_ID = 'reread-book';
const CHAPTERS = [
  { chapter_no: 1, title: '1장', start_page: 1, end_page: 50 },
  { chapter_no: 2, title: '2장', start_page: 51, end_page: 150 },
  { chapter_no: 3, title: '3장', start_page: 151, end_page: 300 },
];
const D = SEED_DEVICE_ID;

function setup() {
  const { positions, books } = makeSeededFakes();
  books.set(BOOK_ID, { total_pages: 300, chapters: CHAPTERS });
  const progress = createProgressService({ positions, books });
  const cutoff = createCutoffService({ positions, books });
  let seq = 0;
  const go = (page: number, from_page?: number | null, claim?: 'read_through') =>
    progress.acceptProgressEvent(D, BOOK_ID, { page, seq: ++seq, from_page, claim });
  const readFromStart = async (to: number) => {
    await go(1, null);
    for (let p = 2; p <= to; p++) await go(p, p - 1);
  };
  const snap = () => cutoff.getCutoffSnapshot(D, BOOK_ID);
  return { go, readFromStart, snap };
}

describe('다시 읽기 — 완독한 책의 기준점은 지금 펼친 쪽 (FR-PRG-003 🚦)', () => {
  test('FR-PRG-003: 다 읽은 책을 다시 열어 20쪽에 가면 K는 300이 아니라 20 — 초과 노출 0건', async () => {
    const t = setup();
    await t.readFromStart(300);
    expect((await t.snap()).cutoff).toBe(300);
    await t.go(20, 300);
    const s = await t.snap();
    expect(s.current_page).toBe(20);
    expect(s.cutoff).toBe(20);
    expect(s.chapter.chapter_no).toBe(1);
  });

  test('FR-PRG-003: 앞으로 넘기면 K가 따라 오른다 (positive 쌍) — 20 → 120 → 이어 넘겨 121', async () => {
    const t = setup();
    await t.readFromStart(300);
    await t.go(20, 300);
    await t.go(120, 20);
    expect((await t.snap()).cutoff).toBe(120);
    await t.go(121, 120);
    const s = await t.snap();
    expect(s.cutoff).toBe(121);
    expect(s.chapter.chapter_no).toBe(2);
  });

  test('FR-PRG-003: 뒤로 가면 K가 줄어든다 — 120 → 60', async () => {
    const t = setup();
    await t.readFromStart(300);
    await t.go(120, 300);
    expect((await t.snap()).cutoff).toBe(120);
    await t.go(60, 120);
    expect((await t.snap()).cutoff).toBe(60);
  });

  test('FR-BRF-005: 다시 읽는 중에도 완독 기록은 그대로다 — is_complete·percent 100·reached_end·확인 카드 없음', async () => {
    const t = setup();
    await t.readFromStart(300);
    await t.go(5, 300);
    const s = await t.snap();
    expect(s.cutoff).toBe(5);
    expect(s.is_complete).toBe(true);
    expect(s.percent).toBe(100);
    expect(s.reached_end).toBe(true);
    expect(s.frontier_confirm).toBeNull();
    expect(s.furthest_page).toBe(300);
  });

  test('FR-SPL-002: K가 끝 쪽일 때만 cutoff_at_end 이고, 중간 쪽이면 거짓이다 (쌍)', async () => {
    const t = setup();
    await t.readFromStart(300);
    expect((await t.snap()).cutoff_at_end).toBe(true);
    await t.go(299, 300);
    expect((await t.snap()).cutoff_at_end).toBe(false);
    await t.go(300, 299);
    expect((await t.snap()).cutoff_at_end).toBe(true);
  });
});

describe('읽는 중인 책은 달라지지 않는다 (FR-PRG-003 🚦 negative 쌍)', () => {
  test('FR-PRG-003: 30쪽까지 읽고 200쪽에 다녀온 뒤 10쪽으로 가도 K는 30 그대로', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.go(10, 200);
    const s = await t.snap();
    expect(s.current_page).toBe(10);
    expect(s.cutoff).toBe(30);
    expect(s.is_complete).toBe(false);
    expect(s.cutoff_at_end).toBe(false);
  });

  test('FR-PRG-003: 마지막 쪽에 목차로만 다녀온 독자는 완독이 아니라서 K는 차례로 읽은 쪽 그대로', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(300, 30);
    await t.go(5, 300);
    const s = await t.snap();
    expect(s.is_complete).toBe(false);
    expect(s.cutoff).toBe(30);
  });

  test('FR-PRG-003: 진도 레코드가 없으면 K는 0 (첫 진입)', async () => {
    const t = setup();
    expect((await t.snap()).cutoff).toBe(0);
  });
});
