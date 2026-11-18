import { act, renderHook, waitFor } from '@testing-library/react';
import { useSsabiData } from './useSsabiData';
import type { GraphResponse, SsabiTab } from '../types';

function graph(nodeNames: string[]): GraphResponse {
  return {
    nodes: nodeNames.map((name, i) => ({
      id: `c${i}`,
      name,
      first_appearance_page: 1,
      aliases: [],
    })),
    edges: [],
  };
}

it('does not query a graph before entry supplies a reading position', async () => {
  const fetchGraph = vi.fn().mockResolvedValue(graph([]));
  const { rerender } = renderHook(
    (page: number | null) =>
      useSsabiData({ panelOpen: true, bookId: 'book', tab: 'relationship', currentPage: page, fetchGraph }),
    { initialProps: null as number | null }
  );
  await act(async () => {});
  expect(fetchGraph).not.toHaveBeenCalled();
  rerender(21);
  await waitFor(() => expect(fetchGraph).toHaveBeenCalledWith('book', 21, expect.any(Number)));
});

it('hides K90 graph while K40 is loading and ignores late K90 responses', async () => {
  let releaseOld!: (value: GraphResponse) => void;
  let releaseNew!: (value: GraphResponse) => void;
  const fetchGraph = vi
    .fn()
    .mockResolvedValueOnce(graph(['future alias']))
    .mockImplementationOnce(
      () =>
        new Promise<GraphResponse>((resolve) => {
          releaseOld = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<GraphResponse>((resolve) => {
          releaseNew = resolve;
        })
    );
  const { result, rerender } = renderHook(
    (page) => useSsabiData({ panelOpen: true, bookId: 'book', tab: 'relationship', currentPage: page, fetchGraph }),
    { initialProps: 90 }
  );
  await waitFor(() => expect(result.current.graph).not.toBeNull());
  rerender(91);
  expect(result.current.graph).toBeNull();
  rerender(40);
  await act(async () => {
    releaseOld(graph(['future leak']));
  });
  expect(result.current.graph).toBeNull();
  await act(async () => {
    releaseNew(graph(['known name']));
  });
  expect(result.current.graph).toEqual(graph(['known name']));
});

/**
 * 싸비 탭 데이터 (FR-SVB-003)
 *
 * 서버 조회는 주입받는다 — 네트워크를 흉내 내는 대신 호출 자체를 관찰한다.
 * 응답은 이미 K 이하로 걸러져 오므로 훅은 초과 여부를 판별하지 않는다 (절대 규칙 7번).
 */
describe('싸비 탭 데이터', () => {
  it('관계도 탭이 열리면 관계도를 조회한다', async () => {
    const fetchGraph = vi.fn().mockResolvedValue(graph(['정주사']));

    const { result } = renderHook(() =>
      useSsabiData({ panelOpen: true, bookId: 'takryu', tab: 'relationship', currentPage: 21, fetchGraph })
    );

    await waitFor(() => expect(result.current.graph).toEqual(graph(['정주사'])));
    // (page, seq) 를 반드시 동봉한다 — 페이지를 넘긴 직후 재조회가 최신 K 를 보게 한다 (§4.3)
    expect(fetchGraph).toHaveBeenCalledWith('takryu', 21, expect.any(Number));
  });

  it('FR-SVB-003: 페이지가 바뀌면 열려 있는 탭을 다시 조회한다', async () => {
    const fetchGraph = vi.fn().mockResolvedValue(graph(['정주사']));
    const { rerender } = renderHook(
      (page: number) =>
        useSsabiData({ panelOpen: true, bookId: 'takryu', tab: 'relationship', currentPage: page, fetchGraph }),
      { initialProps: 21 }
    );

    await waitFor(() => expect(fetchGraph).toHaveBeenCalledTimes(1));

    rerender(22);

    await waitFor(() => expect(fetchGraph).toHaveBeenCalledTimes(2));
  });

  it('같은 페이지로 다시 그려지면 재조회하지 않는다', async () => {
    const fetchGraph = vi.fn().mockResolvedValue(graph(['정주사']));
    const { rerender } = renderHook(
      (page: number) =>
        useSsabiData({ panelOpen: true, bookId: 'takryu', tab: 'relationship', currentPage: page, fetchGraph }),
      { initialProps: 21 }
    );

    await waitFor(() => expect(fetchGraph).toHaveBeenCalledTimes(1));

    rerender(21);

    expect(fetchGraph).toHaveBeenCalledTimes(1);
  });

  it('관계도·챗봇 탭이 아니면 관계도를 조회하지 않는다 — 열린 탭만 재조회한다', async () => {
    const fetchGraph = vi.fn().mockResolvedValue(graph([]));

    renderHook(() =>
      useSsabiData({ panelOpen: true, bookId: 'takryu', tab: 'timeline', currentPage: 21, fetchGraph })
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchGraph).not.toHaveBeenCalled();
  });

  // 2026-11-18 대표 승인 — 아모 답변의 인물 이름 강조는 기준점으로 거른 관계도 응답의 이름만 쓴다
  it('챗봇 탭이면 이름 강조용으로 관계도를 조회한다(같은 서버 상한 응답)', async () => {
    const fetchGraph = vi.fn().mockResolvedValue(graph(['정주사']));
    const { result } = renderHook(() =>
      useSsabiData({ panelOpen: true, bookId: 'takryu', tab: 'chatbot', currentPage: 21, fetchGraph })
    );
    await waitFor(() => expect(result.current.graph?.nodes.map((n) => n.name)).toEqual(['정주사']));
    expect(fetchGraph).toHaveBeenCalledWith('takryu', 21, expect.any(Number));
  });

  it('조회가 실패하면 데이터를 비우고 실패를 알린다 — 옛 데이터를 남기지 않는다', async () => {
    const fetchGraph = vi
      .fn()
      .mockResolvedValueOnce(graph(['정주사']))
      .mockRejectedValueOnce(new Error('boom'));

    const { rerender, result } = renderHook(
      (page: number) =>
        useSsabiData({ panelOpen: true, bookId: 'takryu', tab: 'relationship', currentPage: page, fetchGraph }),
      { initialProps: 21 }
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());

    rerender(22);

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.graph).toBeNull();
  });
});

describe('FR-SVB-003: 패널이 열렸을 때만 조회한다', () => {
  it('패널이 닫혀 있으면 관계도 탭이어도 조회하지 않는다', async () => {
    const fetchGraph = vi.fn(() => Promise.resolve(graph(['정주사'])));
    renderHook(() =>
      useSsabiData({ panelOpen: false, bookId: 'takryu', tab: 'relationship', currentPage: 21, fetchGraph })
    );
    await act(async () => {});
    expect(fetchGraph).not.toHaveBeenCalled();
  });

  it('패널을 열면 현재 쪽 기준으로 관계도를 한 번 조회한다', async () => {
    const fetchGraph = vi.fn(() => Promise.resolve(graph(['정주사'])));
    const { rerender } = renderHook(
      (open: boolean) =>
        useSsabiData({ panelOpen: open, bookId: 'takryu', tab: 'relationship', currentPage: 21, fetchGraph }),
      { initialProps: false }
    );
    await act(async () => {});
    expect(fetchGraph).not.toHaveBeenCalled();

    rerender(true);

    await waitFor(() => expect(fetchGraph).toHaveBeenCalledTimes(1));
    expect(fetchGraph).toHaveBeenCalledWith('takryu', 21, expect.any(Number));
  });

  it('패널이 닫힌 채 쪽이 바뀌어도 조회하지 않는다', async () => {
    const fetchGraph = vi.fn(() => Promise.resolve(graph(['정주사'])));
    const { rerender } = renderHook(
      (page: number) =>
        useSsabiData({ panelOpen: false, bookId: 'takryu', tab: 'relationship', currentPage: page, fetchGraph }),
      { initialProps: 21 }
    );
    rerender(22);
    await act(async () => {});
    expect(fetchGraph).not.toHaveBeenCalled();
  });
});

describe('타임라인 조회 (FR-SPL-002 🚦, 결정 31)', () => {
  const timeline = { chapters: [], events: [], applied_cutoff: 13 };

  it('타임라인 탭이 열렸을 때만 조회하고 다른 탭에서는 조회하지 않는다', async () => {
    const fetchTimeline = vi.fn().mockResolvedValue(timeline);
    const { result, rerender } = renderHook(
      (tab: SsabiTab) =>
        useSsabiData({ panelOpen: true, bookId: 'book', tab, currentPage: 13, fetchTimeline }),
      { initialProps: 'notes' as SsabiTab }
    );
    await act(async () => {});
    expect(fetchTimeline).not.toHaveBeenCalled();
    rerender('timeline');
    await waitFor(() => expect(fetchTimeline).toHaveBeenCalledWith('book', 13, expect.any(Number)));
    await waitFor(() => expect(result.current.timeline).toEqual(timeline));
  });

  it('FR-SPL-005: 조회가 실패하면 옛 타임라인을 남기지 않는다', async () => {
    const fetchTimeline = vi.fn().mockResolvedValueOnce(timeline).mockRejectedValueOnce(new Error('x'));
    const { result, rerender } = renderHook(
      (page: number) =>
        useSsabiData({ panelOpen: true, bookId: 'book', tab: 'timeline', currentPage: page, fetchTimeline }),
      { initialProps: 13 }
    );
    await waitFor(() => expect(result.current.timeline).not.toBeNull());
    rerender(14);
    await waitFor(() => expect(result.current.timelineFailed).toBe(true));
    expect(result.current.timeline).toBeNull();
  });
});
