import { act, renderHook, waitFor } from '@testing-library/react';
import { useReadingSession } from './useReadingSession';
import { clearPendingJump } from '../utils/pendingJump';
import type { BookInfoResponse } from '../types';
import { fakePage } from '../../mocks/pages';

const { fetchBookInfoMock, fetchPageMock, enterBookMock, sendProgressMock } = vi.hoisted(() => ({
  fetchBookInfoMock: vi.fn(),
  fetchPageMock: vi.fn(),
  enterBookMock: vi.fn(),
  sendProgressMock: vi.fn(),
}));

vi.mock('../services/bookService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/bookService')>();
  return { ...actual, fetchBookInfo: fetchBookInfoMock, fetchPage: fetchPageMock };
});

vi.mock('../services/progressService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/progressService')>();
  return { ...actual, enterBook: enterBookMock, sendProgress: sendProgressMock };
});

const INFO = {
  basic_info: { title: '탁류', author: '채만식', published_year: 1937, length_note: '300페이지' },
  introduction: null,
  background: null,
  chapters: [
    { chapter_no: 1, title: '첫째', start_page: 1, end_page: 99 },
    { chapter_no: 2, title: '둘째', start_page: 100, end_page: 199 },
    { chapter_no: 3, title: '셋째', start_page: 200, end_page: 300 },
  ],
} as unknown as BookInfoResponse;

const APPLIED_CUTOFF = 130;

async function startReading() {
  const rendered = renderHook(() => useReadingSession('takryu'));
  await waitFor(() => expect(rendered.result.current.totalPages).toBe(300));
  await waitFor(() => expect(rendered.result.current.page).not.toBeNull());
  await waitFor(() => expect(sendProgressMock).toHaveBeenCalled());
  await act(async () => {});
  return rendered;
}

describe('useReadingSession — 목차 점프 확인 창', () => {
  beforeEach(() => {
    clearPendingJump();
    localStorage.clear();
    sessionStorage.clear();
    fetchBookInfoMock.mockReset().mockResolvedValue(INFO);
    fetchPageMock
      .mockReset()
      .mockImplementation((_bookId: string, pageNo: number) =>
        Promise.resolve(fakePage(pageNo, 300, `${pageNo}쪽 본문`))
      );
    enterBookMock
      .mockReset()
      .mockResolvedValue({ route: 'reader', page: 40, is_new_session: false, session_epoch: 1 });
    sendProgressMock.mockReset().mockResolvedValue({ success: true, applied_cutoff: APPLIED_CUTOFF, confirm: null });
  });

  test('FR-PRG-003: 목차로 applied_cutoff보다 뒤 쪽을 고르면 이동하지 않고 확인 창을 띄운다', async () => {
    const { result } = await startReading();

    act(() => result.current.requestTocJump(200));

    expect(result.current.currentPage).toBe(40);
    expect(result.current.tocJumpConfirm).toBe(200);
    expect(sendProgressMock).toHaveBeenCalledTimes(1);
  });

  test('FR-PRG-003: 확인하면 그 쪽으로 이동하고 창이 닫힌다', async () => {
    const { result } = await startReading();
    act(() => result.current.requestTocJump(200));

    act(() => result.current.confirmTocJump('move'));

    await waitFor(() => expect(result.current.currentPage).toBe(200));
    expect(result.current.tocJumpConfirm).toBeNull();
  });

  test('FR-PRG-003: 취소하면 이동하지 않고 진도 요청도 더 나가지 않는다', async () => {
    const { result } = await startReading();
    act(() => result.current.requestTocJump(200));

    act(() => result.current.cancelTocJump());

    expect(result.current.currentPage).toBe(40);
    expect(result.current.tocJumpConfirm).toBeNull();
    expect(sendProgressMock).toHaveBeenCalledTimes(1);
  });

  test('FR-PRG-003: applied_cutoff 이내 쪽은 확인 없이 바로 이동한다', async () => {
    const { result } = await startReading();

    act(() => result.current.requestTocJump(100));

    await waitFor(() => expect(result.current.currentPage).toBe(100));
    expect(result.current.tocJumpConfirm).toBeNull();
  });

  test('FR-PRG-003: applied_cutoff와 같은 쪽은 확인 없이 이동한다', async () => {
    const { result } = await startReading();

    act(() => result.current.requestTocJump(APPLIED_CUTOFF));

    await waitFor(() => expect(result.current.currentPage).toBe(APPLIED_CUTOFF));
    expect(result.current.tocJumpConfirm).toBeNull();
  });

  test('FR-PRG-003: 한 쪽씩 넘기는 moveTo는 앞쪽 끝이어도 확인 창을 띄우지 않는다', async () => {
    const { result } = await startReading();
    await act(async () => result.current.moveTo(APPLIED_CUTOFF));
    await waitFor(() => expect(result.current.currentPage).toBe(APPLIED_CUTOFF));

    act(() => result.current.moveTo(APPLIED_CUTOFF + 1));

    await waitFor(() => expect(result.current.currentPage).toBe(APPLIED_CUTOFF + 1));
    expect(result.current.tocJumpConfirm).toBeNull();
  });

  test('FR-PRG-003: 서버가 applied_cutoff를 주지 못했으면 확인 창 없이 이동한다', async () => {
    sendProgressMock.mockReset().mockResolvedValue(null);
    const { result } = await startReading();

    act(() => result.current.requestTocJump(200));

    await waitFor(() => expect(result.current.currentPage).toBe(200));
    expect(result.current.tocJumpConfirm).toBeNull();
  });
});
