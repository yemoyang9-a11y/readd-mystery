/**
 * 커뮤니티 백엔드 대역(mocks/community.ts)이 서버 관문과 같은 규칙을 따르는지 (VITE_USE_MOCK=true 개발용).
 *
 * 대표 결정 2026-11-19 정정 — 끝까지 간 독자(가장 멀리 펼친 쪽 = 마지막 쪽)만, 차례 읽기는 따지지 않음.
 * 서버 시험은 backend/src/modules/community/__tests__/completion-gate.test.ts 에 있다.
 * negative(403·글 수 0건)는 positive 와 쌍으로 둔다.
 */
import { isAxiosError } from 'axios';

async function freshMocks() {
  vi.resetModules();
  const server = await import('../../mocks/server');
  const community = await import('../../mocks/community');
  const { MOCK_BOOK_ID } = await import('../../mocks/fixtures');
  return { server, community, book: MOCK_BOOK_ID };
}

function statusOf(run: () => unknown): number | null {
  try {
    run();
    return null;
  } catch (error) {
    return isAxiosError(error) ? (error.response?.status ?? null) : -1;
  }
}

describe('커뮤니티 대역 — 끝까지 간 독자만 (대표 결정 2026-11-19 정정)', () => {
  test('마지막 쪽 전(21/30)에는 글 목록 403·허브 글 수 0건 — 목차로 마지막 쪽에 건너뛰면 열린다 (positive 쌍)', async () => {
    const { server, community, book } = await freshMocks();
    expect(server.mockReachedEnd(book)).toBe(false);
    expect(statusOf(() => community.mockListPosts(book, null, 'new'))).toBe(403);
    const lockedCard = community.mockHub().books.find((b) => b.book_id === book);
    expect(lockedCard).toMatchObject({ access: 'locked' });
    expect(lockedCard).not.toHaveProperty('post_count');

    server.mockRecordProgress(book, 30, { fromPage: 21 }); // 차례 넘김이 아닌 건너뛰기
    expect(server.mockReachedEnd(book)).toBe(true);
    expect(statusOf(() => community.mockListPosts(book, null, 'new'))).toBeNull();
    expect(community.mockHub().books.find((b) => b.book_id === book)).toMatchObject({ access: 'open' });
  });

  test('마지막 쪽에 간 뒤 앞으로 되돌아가도 계속 열린다 (가장 먼 쪽은 줄지 않는다)', async () => {
    const { server, community, book } = await freshMocks();
    server.mockRecordProgress(book, 30);
    server.mockRecordProgress(book, 3);
    expect(statusOf(() => community.mockListPosts(book, null, 'new'))).toBeNull();
  });
});
