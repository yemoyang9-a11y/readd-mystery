import { createProgressService } from '../../../src/modules/reading-state/progress.service';
import { makeSeededFakes, SEED_BOOK_ID, SEED_DEVICE_ID } from './fakes';

describe('FR-PRG-003: 실제 도서 범위를 벗어난 진도는 저장하지 않는다', () => {
  test.each([0, -1, 1.5, 31, Number.MAX_SAFE_INTEGER])('page=%s 거절', async (page) => {
    const { positions, books } = makeSeededFakes();
    const service = createProgressService({ positions, books });
    await expect(service.acceptProgressEvent(SEED_DEVICE_ID, SEED_BOOK_ID, { page, seq: 1, claim: 'read_through' })).rejects.toThrow();
    expect(await positions.findPosition(SEED_DEVICE_ID, SEED_BOOK_ID)).toBeNull();
  });
  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('seq=%s 거절', async (seq) => {
    const { positions, books } = makeSeededFakes();
    const service = createProgressService({ positions, books });
    await expect(service.acceptProgressEvent(SEED_DEVICE_ID, SEED_BOOK_ID, { page: 1, seq })).rejects.toThrow();
    expect(await positions.findPosition(SEED_DEVICE_ID, SEED_BOOK_ID)).toBeNull();
  });
  test('positive: 마지막 쪽까지 읽었다는 확인은 그대로 수용한다', async () => {
    const { positions, books } = makeSeededFakes();
    const service = createProgressService({ positions, books });
    await service.acceptProgressEvent(SEED_DEVICE_ID, SEED_BOOK_ID, { page: 30, seq: 1, claim: 'read_through' });
    expect((await positions.findPosition(SEED_DEVICE_ID, SEED_BOOK_ID))?.read_pages).toHaveLength(30);
  });
  test.each([0, 31, 1.5])('from_page=%s도 저장 전에 거절한다', async (from_page) => {
    const { positions, books } = makeSeededFakes();
    const service = createProgressService({ positions, books });
    await expect(service.acceptProgressEvent(SEED_DEVICE_ID, SEED_BOOK_ID, { page: 2, seq: 1, from_page })).rejects.toThrow();
    expect(await positions.findPosition(SEED_DEVICE_ID, SEED_BOOK_ID)).toBeNull();
  });
  test('손상된 저장 진도를 확인해도 도서 범위 밖 읽음 배열을 만들지 않는다', async () => {
    const { positions, books } = makeSeededFakes();
    await positions.savePosition(SEED_DEVICE_ID, SEED_BOOK_ID, { current_page: 1000000, event_seq: 1 });
    const service = createProgressService({ positions, books });
    await expect(service.confirmFrontier(SEED_DEVICE_ID, SEED_BOOK_ID, 'furthest')).rejects.toThrow();
    expect((await positions.findPosition(SEED_DEVICE_ID, SEED_BOOK_ID))?.read_pages).toEqual([]);
  });
});
