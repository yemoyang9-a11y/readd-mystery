import { randomUUID } from 'crypto';
import { createCutoffService } from '../../../src/modules/reading-state/cutoff.service';
import { createProgressService } from '../../../src/modules/reading-state/progress.service';
import { createSessionService } from '../../../src/modules/reading-state/session.service';
import { FakeClock, FakeReadingSessionRepository, SEED_BOOK_ID, makeSeededFakes } from './fakes';

const READER_ID = 'reader-shared-by-two-devices';

function setup() {
  const { positions, books } = makeSeededFakes();
  const clock = new FakeClock(new Date('2026-11-10T00:00:00Z'));
  const sessions = new FakeReadingSessionRepository(clock);
  const progress = createProgressService({ positions, books });
  const session = createSessionService({ positions, books, sessions, clock });
  const cutoff = createCutoffService({ positions, books });

  function device() {
    const deviceId = randomUUID();
    let seq = 0;
    // 이 기기 화면에 바로 전에 떠 있던 쪽 — 진입 직후에는 없다 (2026-11-17 차례 읽기 기준점)
    let shown: number | null = null;
    return {
      async enter() {
        await session.decideEntry(READER_ID, SEED_BOOK_ID);
        seq = 0;
        shown = null;
      },
      async openPage(page: number) {
        seq += 1;
        await progress.acceptProgressEvent(
          READER_ID,
          SEED_BOOK_ID,
          { page, seq, from_page: shown },
          deviceId
        );
        shown = page;
      },
      async sendStale(page: number, staleSeq: number) {
        await progress.acceptProgressEvent(
          READER_ID,
          SEED_BOOK_ID,
          { page, seq: staleSeq },
          deviceId
        );
      },
    };
  }

  const currentCutoff = async () =>
    (await cutoff.getCutoffSnapshot(READER_ID, SEED_BOOK_ID)).cutoff;
  const currentPage = async () =>
    (await cutoff.getCutoffSnapshot(READER_ID, SEED_BOOK_ID)).current_page;

  return { device, currentCutoff, currentPage };
}

async function deviceAReadThenDeviceBEnters(context: ReturnType<typeof setup>) {
  const a = context.device();
  const b = context.device();
  await a.enter();
  for (let page = 1; page <= 7; page++) await a.openPage(page);
  await b.enter();
  await b.openPage(7); // B 화면에 이어 읽기 위치(7쪽)가 뜬다
  return { a, b };
}

describe('같은 독자 ID를 쓰는 두 기기의 진도', () => {
  test('FR-PRG-003: 기기 B 진입 뒤 기기 A가 넘긴 쪽이 기준점에 반영된다', async () => {
    const context = setup();
    const { a } = await deviceAReadThenDeviceBEnters(context);

    await a.openPage(8);

    expect(await context.currentCutoff()).toBe(8);
  });

  test('FR-PRG-003: 기기 A가 다시 넘긴 뒤 기기 B가 이어 넘긴 쪽도 기준점에 반영된다', async () => {
    const context = setup();
    const { a, b } = await deviceAReadThenDeviceBEnters(context);

    await a.openPage(8);
    await b.openPage(8);
    await b.openPage(9);

    expect(await context.currentCutoff()).toBe(9);
  });

  test('FR-PRG-003: 기기 B가 목차로 12쪽에 가면 기준점은 오르지 않는다 — 0건', async () => {
    const context = setup();
    const { a, b } = await deviceAReadThenDeviceBEnters(context);

    await a.openPage(8);
    await b.openPage(12);

    expect(await context.currentCutoff()).toBe(8);
  });

  test('FR-PRG-003: 기기 B가 앞쪽으로 돌아가도 차례로 읽은 쪽이 기준점이고 이어 읽기 위치는 3쪽이다', async () => {
    const context = setup();
    const { a, b } = await deviceAReadThenDeviceBEnters(context);

    for (let page = 8; page <= 20; page++) await a.openPage(page);
    await b.openPage(3);

    expect(await context.currentCutoff()).toBe(20);
    expect(await context.currentPage()).toBe(3);
  });

  test('FR-PRG-003: 두 기기가 번갈아 이어 넘기면 매번 차례로 읽은 쪽이 기준점이다', async () => {
    const context = setup();
    const { a, b } = await deviceAReadThenDeviceBEnters(context);

    await a.openPage(8);
    expect(await context.currentCutoff()).toBe(8);
    await b.openPage(8);
    await b.openPage(9);
    expect(await context.currentCutoff()).toBe(9);
    await a.openPage(9);
    await a.openPage(10);
    expect(await context.currentCutoff()).toBe(10);
    await b.openPage(10);
    await b.openPage(11);
    expect(await context.currentCutoff()).toBe(11);
  });

  test('FR-PRG-002: 한 기기 안에서 늦게 도착한 낡은 seq는 두 기기 상황에서도 반영되지 않는다', async () => {
    const context = setup();
    const { a } = await deviceAReadThenDeviceBEnters(context);

    await a.openPage(8);
    await a.sendStale(2, 1);

    expect(await context.currentCutoff()).toBe(8);
  });
});
