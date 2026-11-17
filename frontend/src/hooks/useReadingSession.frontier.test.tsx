import { act, renderHook, waitFor } from '@testing-library/react';
import { useReadingSession } from './useReadingSession';
import { clearPendingJump, setPendingJump } from '../utils/pendingJump';
import type { BookInfoResponse, FrontierConfirm, ProgressResponse } from '../types';
import { fakePage } from '../../mocks/pages';

const { fetchBookInfoMock, fetchPageMock, enterBookMock, sendProgressMock, confirmFrontierMock, fetchGraphMock } =
  vi.hoisted(() => ({
    fetchBookInfoMock: vi.fn(),
    fetchPageMock: vi.fn(),
    enterBookMock: vi.fn(),
    sendProgressMock: vi.fn(),
    confirmFrontierMock: vi.fn(),
    fetchGraphMock: vi.fn(),
  }));

vi.mock('../services/bookService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/bookService')>();
  return { ...actual, fetchBookInfo: fetchBookInfoMock, fetchPage: fetchPageMock };
});

vi.mock('../services/progressService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/progressService')>();
  return {
    ...actual,
    enterBook: enterBookMock,
    sendProgress: sendProgressMock,
    confirmFrontier: confirmFrontierMock,
  };
});

vi.mock('../services/ssabiService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ssabiService')>();
  return { ...actual, fetchGraph: fetchGraphMock };
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

const SERVER_PAGE = 40;

function ok(appliedCutoff: number, confirm: FrontierConfirm | null = null): ProgressResponse {
  return { success: true, applied_cutoff: appliedCutoff, confirm };
}

/** 진도 이벤트마다 [쪽, 넘긴 선택 사항] */
function progressEvents() {
  return sendProgressMock.mock.calls.map(([, page, opts]) => [page, opts ?? {}]);
}

async function startReading() {
  const rendered = renderHook(() => useReadingSession('takryu'));
  await waitFor(() => expect(rendered.result.current.totalPages).toBe(300));
  await waitFor(() => expect(rendered.result.current.page).not.toBeNull());
  await waitFor(() => expect(sendProgressMock).toHaveBeenCalled());
  await act(async () => {});
  return rendered;
}

async function moveTo(rendered: Awaited<ReturnType<typeof startReading>>, page: number) {
  act(() => rendered.result.current.moveTo(page));
  await waitFor(() => expect(rendered.result.current.currentPage).toBe(page));
  await act(async () => {});
}

describe('useReadingSession — 차례로 읽은 범위 재료 (FR-PRG-003 🚦)', () => {
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
      .mockResolvedValue({ route: 'reader', page: SERVER_PAGE, is_new_session: false, session_epoch: 1 });
    sendProgressMock.mockReset().mockResolvedValue(ok(SERVER_PAGE));
    confirmFrontierMock.mockReset();
    fetchGraphMock.mockReset().mockResolvedValue({ nodes: [], edges: [] });
  });

  test('FR-PRG-003: 진입 뒤 첫 쪽은 from_page 없이, 이후 쪽은 직전 화면 쪽을 from_page로 보낸다', async () => {
    const rendered = await startReading();
    await moveTo(rendered, 41);
    await moveTo(rendered, 40);

    expect(progressEvents()).toEqual([
      [40, { fromPage: null }],
      [41, { fromPage: 40 }],
      [40, { fromPage: 41 }],
    ]);
  });

  test('FR-PRG-003: 목차·노트 이동·돌아가기도 직전 화면 쪽을 from_page로 보낸다 — 판정은 서버가 한다', async () => {
    // 기준점 안쪽 목차 이동이라 확인 창 없이 바로 간다
    sendProgressMock.mockReset().mockResolvedValue(ok(300));
    const rendered = await startReading();
    act(() => rendered.result.current.requestTocJump(100));
    await waitFor(() => expect(rendered.result.current.currentPage).toBe(100));
    await act(async () => {});
    act(() => rendered.result.current.ssabiPanelProps.onJumpToNote(12));
    await waitFor(() => expect(rendered.result.current.currentPage).toBe(12));
    await act(async () => {});
    act(() => rendered.result.current.returnToOrigin());
    await waitFor(() => expect(rendered.result.current.currentPage).toBe(100));
    await act(async () => {});

    expect(progressEvents()).toEqual([
      [40, { fromPage: null }],
      [100, { fromPage: 40 }],
      [12, { fromPage: 100 }],
      [100, { fromPage: 12 }],
    ]);
  });

  test('FR-PRG-003: 예약 이동으로 들어오면 첫 쪽은 from_page 없이 보낸다 — 진입 쪽은 화면에 뜨지 않았다', async () => {
    setPendingJump('takryu', 200);
    const rendered = renderHook(() => useReadingSession('takryu'));
    await waitFor(() => expect(rendered.result.current.currentPage).toBe(200));
    await waitFor(() => expect(sendProgressMock).toHaveBeenCalled());

    expect(progressEvents()).toEqual([[200, { fromPage: null }]]);
  });

  test('FR-PRG-003: "앞부분은 이미 읽었어요"는 그 이동 이벤트 하나에만 claim을 싣는다', async () => {
    const rendered = await startReading();
    act(() => rendered.result.current.requestTocJump(200));
    expect(rendered.result.current.tocJumpConfirm).toBe(200);

    act(() => rendered.result.current.confirmTocJump('read_through'));
    await waitFor(() => expect(rendered.result.current.currentPage).toBe(200));
    await act(async () => {});
    await moveTo(rendered, 201);

    expect(progressEvents()).toEqual([
      [40, { fromPage: null }],
      [200, { fromPage: 40, claim: 'read_through' }],
      [201, { fromPage: 200 }],
    ]);
    expect(rendered.result.current.tocJumpConfirm).toBeNull();
  });

  test('FR-PRG-003: "이동만 하기"는 claim 없이 이동만 한다', async () => {
    const rendered = await startReading();
    act(() => rendered.result.current.requestTocJump(200));

    act(() => rendered.result.current.confirmTocJump('move'));
    await waitFor(() => expect(rendered.result.current.currentPage).toBe(200));
    await act(async () => {});

    expect(progressEvents()).toEqual([
      [40, { fromPage: null }],
      [200, { fromPage: 40 }],
    ]);
    expect(rendered.result.current.tocJumpConfirm).toBeNull();
  });

  test('FR-PRG-003: 이미 그 쪽에 있을 때 "앞부분은 이미 읽었어요"를 고르면 claim 이벤트를 한 번 보낸다', async () => {
    const rendered = await startReading();
    await moveTo(rendered, 200);
    act(() => rendered.result.current.requestTocJump(200));
    expect(rendered.result.current.tocJumpConfirm).toBe(200);

    act(() => rendered.result.current.confirmTocJump('read_through'));
    await act(async () => {});
    await moveTo(rendered, 201);

    expect(progressEvents()).toEqual([
      [40, { fromPage: null }],
      [200, { fromPage: 40 }],
      [200, { fromPage: 40, claim: 'read_through' }],
      [201, { fromPage: 200 }],
    ]);
  });

  test('FR-PRG-003: 취소하면 claim도 이동도 남지 않는다', async () => {
    const rendered = await startReading();
    act(() => rendered.result.current.requestTocJump(200));
    act(() => rendered.result.current.cancelTocJump());
    await moveTo(rendered, 41);

    expect(progressEvents()).toEqual([
      [40, { fromPage: null }],
      [41, { fromPage: 40 }],
    ]);
  });
});

describe('useReadingSession — 넘겨 본 쪽 확인 (FR-PRG-003 🚦)', () => {
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
      .mockResolvedValue({ route: 'reader', page: SERVER_PAGE, is_new_session: false, session_epoch: 1 });
    sendProgressMock.mockReset().mockResolvedValue(ok(SERVER_PAGE));
    confirmFrontierMock.mockReset();
    fetchGraphMock.mockReset().mockResolvedValue({ nodes: [], edges: [] });
  });

  test('FR-PRG-003: 진도 응답의 confirm이 없으면 확인 요청도 없다', async () => {
    const { result } = await startReading();

    expect(result.current.ssabiPanelProps.frontierConfirm).toBeNull();
  });

  test('FR-PRG-003: 진도 응답의 confirm과 applied_cutoff를 그대로 싸비에 넘긴다', async () => {
    sendProgressMock.mockReset().mockResolvedValue(ok(40, { current_page: null, furthest_page: 200 }));
    const { result } = await startReading();

    expect(result.current.ssabiPanelProps.frontierConfirm).toEqual({
      applied_cutoff: 40,
      current_page: null,
      furthest_page: 200,
    });
  });

  test('FR-PRG-003: 답하면 서버 응답으로 기준점·확인 요청을 바꾸고, 열린 관계도를 다시 조회한다', async () => {
    sendProgressMock.mockReset().mockResolvedValue(ok(40, { current_page: null, furthest_page: 200 }));
    confirmFrontierMock.mockResolvedValue(ok(200));
    const rendered = await startReading();
    act(() => rendered.result.current.togglePanel());
    await waitFor(() => expect(fetchGraphMock).toHaveBeenCalledTimes(1));

    let answered: boolean | undefined;
    await act(async () => {
      answered = await rendered.result.current.ssabiPanelProps.onFrontierConfirm!('furthest');
    });

    expect(answered).toBe(true);
    expect(confirmFrontierMock).toHaveBeenCalledWith('takryu', 'furthest');
    expect(rendered.result.current.ssabiPanelProps.frontierConfirm).toBeNull();
    await waitFor(() => expect(fetchGraphMock).toHaveBeenCalledTimes(2));

    // 새 기준점(200) 이하로의 목차 이동은 확인 창 없이 바로 간다
    act(() => rendered.result.current.requestTocJump(200));
    expect(rendered.result.current.tocJumpConfirm).toBeNull();
  });

  test('FR-SPL-005: 답이 실패하면 확인 요청을 그대로 두고 기준점·관계도도 바꾸지 않는다', async () => {
    sendProgressMock.mockReset().mockResolvedValue(ok(40, { current_page: null, furthest_page: 200 }));
    confirmFrontierMock.mockResolvedValue(null);
    const rendered = await startReading();
    act(() => rendered.result.current.togglePanel());
    await waitFor(() => expect(fetchGraphMock).toHaveBeenCalledTimes(1));

    let answered: boolean | undefined;
    await act(async () => {
      answered = await rendered.result.current.ssabiPanelProps.onFrontierConfirm!('furthest');
    });

    expect(answered).toBe(false);
    expect(rendered.result.current.ssabiPanelProps.frontierConfirm).toEqual({
      applied_cutoff: 40,
      current_page: null,
      furthest_page: 200,
    });
    await act(async () => {});
    expect(fetchGraphMock).toHaveBeenCalledTimes(1);
    act(() => rendered.result.current.requestTocJump(200));
    expect(rendered.result.current.tocJumpConfirm).toBe(200);
  });

  test('FR-PRG-003: 답 뒤에도 서버가 다시 confirm을 주면 그 값을 보여준다', async () => {
    sendProgressMock.mockReset().mockResolvedValue(ok(40, { current_page: 120, furthest_page: 200 }));
    confirmFrontierMock.mockResolvedValue(ok(40, { current_page: null, furthest_page: 250 }));
    const rendered = await startReading();

    await act(async () => {
      await rendered.result.current.ssabiPanelProps.onFrontierConfirm!('keep');
    });

    expect(rendered.result.current.ssabiPanelProps.frontierConfirm).toEqual({
      applied_cutoff: 40,
      current_page: null,
      furthest_page: 250,
    });
  });
});
