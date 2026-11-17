import { act, renderHook, waitFor } from '@testing-library/react';
import { COMMUNITY_ACCESS_RETRY_MS, useCommunityAccess } from './useCommunityAccess';
import type { PositionResponse } from '../../services/positionService';

const fetchPositionMock = vi.fn<(...args: unknown[]) => Promise<PositionResponse>>();

vi.mock('../../services/positionService', () => ({
  fetchPosition: (...args: unknown[]) => fetchPositionMock(...args),
}));

function position(isComplete: unknown): PositionResponse {
  return {
    applied_cutoff: 21,
    current_chapter_no: 3,
    read_chapter_nos: [1, 2],
    is_complete: isComplete as boolean,
  };
}

beforeEach(() => {
  fetchPositionMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

test('COMMUNITY: 마지막 쪽이 아니면 서버에 묻지 않고 진입도 열지 않는다', () => {
  fetchPositionMock.mockResolvedValue(position(true));
  const { result } = renderHook(() => useCommunityAccess('bk1', false, null));
  expect(result.current).toBe('unknown');
  expect(fetchPositionMock).not.toHaveBeenCalled();
});

test('FR-BRF-005: 책 id만으로 묻는다 — 쪽 번호·완독 여부를 보내지 않는다', async () => {
  fetchPositionMock.mockResolvedValue(position(true));
  const { result } = renderHook(() => useCommunityAccess('bk1', true, null));
  await waitFor(() => expect(result.current).toBe('open'));
  expect(fetchPositionMock.mock.calls).toEqual([['bk1']]);
});

test('COMMUNITY: 마지막 쪽이어도 서버가 완독이 아니라고 하면 열지 않는다 — 0건', async () => {
  fetchPositionMock.mockResolvedValue(position(false));
  const { result } = renderHook(() => useCommunityAccess('bk1', true, null));
  await waitFor(() => expect(result.current).toBe('locked'));
});

test('FR-SPL-005: is_complete 가 true 가 아닌 값(누락·문자열)이면 열지 않는다', async () => {
  for (const value of [undefined, null, 'true', 1]) {
    fetchPositionMock.mockReset().mockResolvedValue(position(value));
    const { result, unmount } = renderHook(() => useCommunityAccess('bk1', true, null));
    await waitFor(() => expect(fetchPositionMock).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current).not.toBe('open');
    unmount();
  }
});

test('FR-SPL-005: 조회가 실패하면 진입도 안내도 그리지 않는다 (unknown)', async () => {
  fetchPositionMock.mockRejectedValue(new Error('network'));
  const { result } = renderHook(() => useCommunityAccess('bk1', true, null));
  await waitFor(() => expect(fetchPositionMock).toHaveBeenCalled());
  await act(async () => {});
  expect(result.current).toBe('unknown');
});

test('COMMUNITY: 마지막 쪽 진도가 서버에 닿기 전에 물었으면 잠시 뒤 다시 물어 열린다', async () => {
  vi.useFakeTimers();
  fetchPositionMock.mockResolvedValueOnce(position(false)).mockResolvedValue(position(true));
  const { result } = renderHook(() => useCommunityAccess('bk1', true, null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(result.current).toBe('locked');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(COMMUNITY_ACCESS_RETRY_MS[0]);
  });
  expect(result.current).toBe('open');
  expect(fetchPositionMock).toHaveBeenCalledTimes(2);
});

test('COMMUNITY: 다시 묻는 횟수는 정해진 만큼뿐이다', async () => {
  vi.useFakeTimers();
  fetchPositionMock.mockResolvedValue(position(false));
  const { result } = renderHook(() => useCommunityAccess('bk1', true, null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(result.current).toBe('locked');
  expect(fetchPositionMock).toHaveBeenCalledTimes(1 + COMMUNITY_ACCESS_RETRY_MS.length);
});

test('COMMUNITY: 확인 카드 답 등으로 refreshKey 가 바뀌면 다시 묻는다', async () => {
  fetchPositionMock.mockResolvedValue(position(false));
  const { result, rerender } = renderHook(({ key }) => useCommunityAccess('bk1', true, key), {
    initialProps: { key: 0 },
  });
  await waitFor(() => expect(result.current).toBe('locked'));
  fetchPositionMock.mockResolvedValue(position(true));
  rerender({ key: 1 });
  await waitFor(() => expect(result.current).toBe('open'));
});

test('COMMUNITY: 다른 책으로 바뀌면 앞 책의 완독이 따라가지 않는다', async () => {
  fetchPositionMock.mockImplementation(async (bookId) => position(bookId === 'bk1'));
  const { result, rerender } = renderHook(({ bookId }) => useCommunityAccess(bookId, true, null), {
    initialProps: { bookId: 'bk1' },
  });
  await waitFor(() => expect(result.current).toBe('open'));
  rerender({ bookId: 'bk2' });
  expect(result.current).not.toBe('open');
  await waitFor(() => expect(result.current).toBe('locked'));
});
