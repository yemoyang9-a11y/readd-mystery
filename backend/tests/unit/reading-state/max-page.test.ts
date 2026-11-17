import { createCutoffService } from '../../../src/modules/reading-state/cutoff.service';
import { createProgressService } from '../../../src/modules/reading-state/progress.service';
import { createGraphService } from '../../../src/modules/ssabi/graph.service';
import {
  FakeSsabiRepository,
  createTestFixture,
} from '../../../src/modules/ssabi/__mocks__/fake-repository';
import { SEED_DEVICE_ID, makeSeededFakes } from './fakes';

const BOOK_ID = 'long-book';
const CHAPTERS = [
  { chapter_no: 1, title: '1장', start_page: 1, end_page: 50 },
  { chapter_no: 2, title: '2장', start_page: 51, end_page: 150 },
  { chapter_no: 3, title: '3장', start_page: 151, end_page: 350 },
];

function setup() {
  const { positions, books } = makeSeededFakes();
  books.set(BOOK_ID, { total_pages: 350, chapters: CHAPTERS });
  return {
    positions,
    progress: createProgressService({ positions, books }),
    cutoff: createCutoffService({ positions, books }),
  };
}

// 2026-11-17 대표 결정 — 기준점은 max_page(가장 멀리 펼친 쪽)가 아니라 차례로 읽은 쪽이다.
// max_page 는 계속 저장하며 싸비 확인 카드의 근거로 쓴다 (read-frontier.test.ts).
describe('가장 멀리 펼친 쪽(max_page) 저장과 기준점', () => {
  test('FR-PRG-003: 40쪽까지 읽은 독자가 300쪽에 다녀와도 cutoff=40, current_page=40, max_page=300', async () => {
    const { progress, cutoff, positions } = setup();
    positions.set(SEED_DEVICE_ID, BOOK_ID, { current_page: 40, event_seq: 0 });
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, {
      page: 300,
      seq: 1,
      from_page: 40,
    });
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, {
      page: 40,
      seq: 2,
      from_page: 300,
    });

    const snapshot = await cutoff.getCutoffSnapshot(SEED_DEVICE_ID, BOOK_ID);

    expect(snapshot.current_page).toBe(40);
    expect(snapshot.cutoff).toBe(40);
    expect(snapshot.furthest_page).toBe(300);
    expect(snapshot.chapter.chapter_no).toBe(1);
    expect(snapshot.percent).toBe(11.4);
  });

  test('FR-PRG-003: 늦게 도착한 옛 이벤트(seq5, 300쪽)도 max_page를 올리고 current_page는 바꾸지 않는다 — 기준점은 그대로', async () => {
    const { progress, cutoff, positions } = setup();
    positions.set(SEED_DEVICE_ID, BOOK_ID, { current_page: 40, event_seq: 0 });
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, { page: 40, seq: 6 });
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, {
      page: 300,
      seq: 5,
      from_page: 40,
    });

    const stored = await positions.findPosition(SEED_DEVICE_ID, BOOK_ID);
    const snapshot = await cutoff.getCutoffSnapshot(SEED_DEVICE_ID, BOOK_ID);

    expect(stored?.max_page).toBe(300);
    expect(stored?.current_page).toBe(40);
    expect(stored?.event_seq).toBe(6);
    expect(snapshot.cutoff).toBe(40);
  });

  test('FR-PRG-003: max_page는 더 작은 쪽 이벤트로 줄지 않는다', async () => {
    const { progress, positions } = setup();
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, { page: 120, seq: 1 });
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, { page: 10, seq: 2 });
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, { page: 5, seq: 1 });

    expect((await positions.findPosition(SEED_DEVICE_ID, BOOK_ID))?.max_page).toBe(120);
  });

  test('FR-SPL-002: 40쪽까지 읽고 300쪽에 다녀오면 120쪽 확립 관계 0건, 300쪽까지 읽었다고 확인하면 1건', async () => {
    const { progress, cutoff, positions } = setup();
    const graph = createGraphService({
      repository: new FakeSsabiRepository(createTestFixture()),
    });
    const edgesAt130 = async () => {
      const snapshot = await cutoff.getCutoffSnapshot(SEED_DEVICE_ID, BOOK_ID);
      const { edges } = await graph.getGraph('takryu', snapshot.cutoff);
      return edges.filter((e) => e.established_page === 120);
    };

    positions.set(SEED_DEVICE_ID, BOOK_ID, { current_page: 40, event_seq: 0 });
    expect(await edgesAt130()).toHaveLength(0);

    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, {
      page: 300,
      seq: 2,
      from_page: 40,
    });
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, {
      page: 40,
      seq: 3,
      from_page: 300,
    });
    expect(await edgesAt130()).toHaveLength(0);

    await progress.confirmFrontier(SEED_DEVICE_ID, BOOK_ID, 'furthest');
    expect(await edgesAt130()).toHaveLength(1);
  });

  test('D14: 끝까지 읽었다고 확인되면 is_complete, current_page가 1이어도', async () => {
    const { progress, cutoff } = setup();
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, {
      page: 350,
      seq: 1,
      claim: 'read_through',
    });
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, {
      page: 1,
      seq: 2,
      from_page: 350,
    });

    const snapshot = await cutoff.getCutoffSnapshot(SEED_DEVICE_ID, BOOK_ID);

    expect(snapshot.current_page).toBe(1);
    expect(snapshot.is_complete).toBe(true);
  });

  test('D14: 마지막 쪽에 목차로만 다녀오면(max_page>=total) 완독이 아니다', async () => {
    const { progress, cutoff } = setup();
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, { page: 350, seq: 1 });
    await progress.acceptProgressEvent(SEED_DEVICE_ID, BOOK_ID, {
      page: 1,
      seq: 2,
      from_page: 350,
    });

    const snapshot = await cutoff.getCutoffSnapshot(SEED_DEVICE_ID, BOOK_ID);

    expect(snapshot.is_complete).toBe(false);
  });

  test('FR-PRG-003: 진도 레코드가 없으면 cutoff=0, is_complete=false', async () => {
    const { cutoff } = setup();
    const snapshot = await cutoff.getCutoffSnapshot(SEED_DEVICE_ID, BOOK_ID);

    expect(snapshot.cutoff).toBe(0);
    expect(snapshot.is_complete).toBe(false);
  });
});
