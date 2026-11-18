/**
 * 기준점 = 차례로 읽은 쪽(read frontier) + 독자 확인 (2026-11-17 대표 결정, A + C안)
 *
 * 기준점(cutoff)은 "1쪽부터 끊김 없이 읽었다고 확인된 마지막 쪽"이다.
 * - 직전 쪽에서 '다음'으로 넘어온 쪽(from_page + 1 = page)만 읽음으로 인정한다
 * - 목차·노트·되돌아가기로 건너뛴 곳은 따로 기록했다가, 차례로 읽은 쪽이 거기까지 이어지면 합친다
 * - 목차 확인 창의 "앞부분은 이미 읽었어요"(claim=read_through)와 싸비 확인 카드의 선택만
 *   차례 읽기 없이 기준점을 올린다. 숫자는 서버의 저장값에서 나온다(절대 규칙 8번)
 * - 기준점은 어떤 입력으로도 줄지 않는다(R1)
 *
 * 조항: FR-PRG-003 🚦, FR-BRF-005 🚦
 */

import { createCutoffService } from '../../../src/modules/reading-state/cutoff.service';
import { createProgressService } from '../../../src/modules/reading-state/progress.service';
import { SEED_DEVICE_ID, makeSeededFakes } from './fakes';

const BOOK_ID = 'frontier-book';
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
  /** 1쪽(진입)부터 to쪽까지 '다음'으로 차례로 넘긴다 */
  const readFromStart = async (to: number) => {
    await go(1, null);
    for (let p = 2; p <= to; p++) await go(p, p - 1);
  };
  /** from쪽에서 to쪽까지 '다음'으로 넘긴다 (from쪽은 이미 화면에 떠 있다) */
  const readOn = async (from: number, to: number) => {
    for (let p = from + 1; p <= to; p++) await go(p, p - 1);
  };
  const snap = () => cutoff.getCutoffSnapshot(D, BOOK_ID);
  return { positions, progress, cutoff, go, readFromStart, readOn, snap };
}

describe('기준점 = 차례로 읽은 쪽 (FR-PRG-003 🚦)', () => {
  test('FR-PRG-003: 1~30쪽을 차례로 읽으면 기준점은 30', async () => {
    const t = setup();
    await t.readFromStart(30);
    expect((await t.snap()).cutoff).toBe(30);
  });

  test('FR-PRG-003: 30쪽에서 목차로 200쪽에 갔다가 30쪽으로 돌아와도 기준점은 200이 아니라 30 — 초과 노출 0건', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.go(30, 200);
    const s = await t.snap();
    expect(s.cutoff).toBe(30);
    expect(s.current_page).toBe(30);
    expect(s.furthest_page).toBe(200);
    expect(s.chapter.chapter_no).toBe(1);
    expect(s.percent).toBe(10);
  });

  test('FR-PRG-003: 돌아와서 이어 읽으면 그만큼 오른다 (30 → 31 → 32)', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.go(30, 200);
    await t.readOn(30, 32);
    expect((await t.snap()).cutoff).toBe(32);
  });

  test('FR-PRG-003: 건너뛴 곳(200~205)을 읽은 기록은 기준점에 바로 붙지 않는다 — 0건', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.readOn(200, 205);
    expect((await t.snap()).cutoff).toBe(30);
  });

  test('FR-PRG-003: 건너뛴 곳(50~60)까지 차례 읽기가 이어지면 합쳐서 60이 된다 (positive)', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(50, 30);
    await t.readOn(50, 60);
    expect((await t.snap()).cutoff).toBe(30);
    await t.go(31, 60); // 목차로 31쪽 — 이동 자체는 인정 없음
    await t.readOn(31, 48); // 31→32 넘김부터 31 … 48 인정. 49 가 아직 비어 있다
    expect((await t.snap()).cutoff).toBe(48);
    await t.readOn(48, 49); // 48→49 넘김 → 49 가 채워져 1~60 이 이어진다
    expect((await t.snap()).cutoff).toBe(60);
  });

  test('FR-PRG-003: 이전 쪽으로 넘기는 것은 읽음으로 인정하지 않는다', async () => {
    const t = setup();
    await t.readFromStart(10);
    await t.go(40, 10);
    await t.go(39, 40);
    await t.go(38, 39);
    expect((await t.snap()).cutoff).toBe(10);
  });

  test('FR-PRG-003: 이벤트가 거꾸로 도착해도 차례 넘김은 모두 인정된다', async () => {
    const t = setup();
    // seq 를 직접 지정해 역순 도착을 만든다
    await t.progress.acceptProgressEvent(D, BOOK_ID, { page: 3, seq: 3, from_page: 2 });
    await t.progress.acceptProgressEvent(D, BOOK_ID, { page: 2, seq: 2, from_page: 1 });
    await t.progress.acceptProgressEvent(D, BOOK_ID, { page: 1, seq: 1, from_page: null });
    const s = await t.snap();
    expect(s.cutoff).toBe(3);
    expect(s.current_page).toBe(3);
  });

  test('FR-PRG-003: 기준점은 어떤 이동으로도 줄지 않는다', async () => {
    const t = setup();
    await t.readFromStart(40);
    await t.go(1, 40);
    await t.go(5, 1);
    await t.go(2, null);
    expect((await t.snap()).cutoff).toBe(40);
  });

  test('FR-PRG-003: 진도 레코드가 없으면 기준점 0, 첫 이벤트가 1쪽이면 1', async () => {
    const t = setup();
    expect((await t.snap()).cutoff).toBe(0);
    await t.go(1, null);
    expect((await t.snap()).cutoff).toBe(1);
  });

  test('FR-PRG-003: 처음부터 목차로 100쪽에 들어가 120쪽까지 읽어도 확인 전에는 기준점 0 — 장은 1장으로 표시', async () => {
    const t = setup();
    await t.go(100, null);
    await t.readOn(100, 120);
    const s = await t.snap();
    expect(s.cutoff).toBe(0);
    expect(s.percent).toBe(0);
    expect(s.is_complete).toBe(false);
    expect(s.chapter.chapter_no).toBe(1);
  });
});

describe('목차 확인 창 — "앞부분은 이미 읽었어요" (claim=read_through)', () => {
  test('FR-PRG-003: read_through 로 200쪽에 가면 기준점 200 (positive)', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30, 'read_through');
    expect((await t.snap()).cutoff).toBe(200);
  });

  test('FR-PRG-003: 같은 이동이라도 claim 없이 "이동만 하기"면 기준점 30 그대로 — 0건', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    expect((await t.snap()).cutoff).toBe(30);
  });

  test('FR-PRG-003: 종이책 독자가 100쪽에 read_through 로 들어가 120쪽까지 읽으면 120', async () => {
    const t = setup();
    await t.go(100, null, 'read_through');
    await t.readOn(100, 120);
    expect((await t.snap()).cutoff).toBe(120);
  });
});

describe('싸비 확인 카드 — 가장 멀리 간 쪽이 기준점보다 뒤일 때 1회 묻기', () => {
  test('FR-PRG-003: 기준점까지만 갔으면 확인 카드가 없다', async () => {
    const t = setup();
    await t.readFromStart(30);
    expect((await t.snap()).frontier_confirm).toBeNull();
  });

  test('FR-PRG-003: 200쪽에 다녀와 30쪽에 있으면 카드 = { current_page: null, furthest_page: 200 }', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.go(30, 200);
    expect((await t.snap()).frontier_confirm).toEqual({ current_page: null, furthest_page: 200 });
  });

  test('FR-PRG-003: 지금 쪽이 기준점과 가장 먼 쪽 사이면 지금 쪽도 선택지로 준다', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.go(120, 200);
    expect((await t.snap()).frontier_confirm).toEqual({ current_page: 120, furthest_page: 200 });
  });

  test('FR-PRG-003: "furthest"를 고르면 기준점이 가장 먼 쪽(200)이 되고 카드가 사라진다', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.go(30, 200);
    await t.progress.confirmFrontier(D, BOOK_ID, 'furthest');
    const s = await t.snap();
    expect(s.cutoff).toBe(200);
    expect(s.frontier_confirm).toBeNull();
  });

  test('FR-PRG-003: "current"를 고르면 지금 쪽(120)까지만 오른다', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.go(120, 200);
    await t.progress.confirmFrontier(D, BOOK_ID, 'current');
    const s = await t.snap();
    expect(s.cutoff).toBe(120);
    expect(s.frontier_confirm).toEqual({ current_page: null, furthest_page: 200 });
  });

  test('FR-PRG-003: "keep"을 고르면 기준점은 그대로, 같은 가장 먼 쪽으로는 다시 묻지 않는다', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.go(30, 200);
    await t.progress.confirmFrontier(D, BOOK_ID, 'keep');
    const s = await t.snap();
    expect(s.cutoff).toBe(30);
    expect(s.frontier_confirm).toBeNull();
  });

  test('FR-PRG-003: "keep" 뒤에 더 먼 쪽(250)으로 가면 다시 묻는다', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(200, 30);
    await t.go(30, 200);
    await t.progress.confirmFrontier(D, BOOK_ID, 'keep');
    await t.go(250, 30);
    expect((await t.snap()).frontier_confirm).toEqual({ current_page: null, furthest_page: 250 });
  });

  test('FR-PRG-003: 진도 레코드가 없으면 확인 응답은 아무것도 바꾸지 않는다', async () => {
    const t = setup();
    await t.progress.confirmFrontier(D, BOOK_ID, 'furthest');
    expect((await t.snap()).cutoff).toBe(0);
    expect(await t.positions.findPosition(D, BOOK_ID)).toBeNull();
  });
});

describe('완독 — 차례로 읽은 쪽 기준 (D14, FR-QNA-004 🚦)', () => {
  test('FR-QNA-004: 마지막 쪽에 목차로만 다녀왔으면 완독이 아니다', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(300, 30);
    const s = await t.snap();
    expect(s.is_complete).toBe(false);
    expect(s.cutoff).toBe(30);
  });

  test('FR-QNA-004: 끝까지 확인되면 완독 (positive)', async () => {
    const t = setup();
    await t.readFromStart(30);
    await t.go(300, 30, 'read_through');
    const s = await t.snap();
    expect(s.is_complete).toBe(true);
    expect(s.cutoff).toBe(300);
  });
});
