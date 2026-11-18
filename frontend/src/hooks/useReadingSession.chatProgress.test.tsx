import { act, renderHook, waitFor } from '@testing-library/react';
import { useReadingSession } from './useReadingSession';
import { clearPendingJump } from '../utils/pendingJump';
import type { BookInfoResponse, ProgressResponse } from '../types';
import { fakePage } from '../../mocks/pages';

/**
 * 대표 지시 2026-11-18 — 2쪽에서 노트를 쓰고 아모에게 물었는데 기준점이 1이었다. 챗봇 요청은 진도를
 * 동봉하지만 직전 화면 쪽(from_page)을 싣지 않아서, 진도 POST 가 늦거나 실패한 마지막 넘김은 질문해도
 * 기준점에 들어가지 않았다. 질문에도 진도 이벤트와 같은 직전 화면 쪽을 싣는다 (FR-PRG-003 🚦).
 */
const { fetchBookInfoMock, fetchPageMock, enterBookMock, sendProgressMock, askChatbotMock } = vi.hoisted(() => ({
  fetchBookInfoMock: vi.fn(),
  fetchPageMock: vi.fn(),
  enterBookMock: vi.fn(),
  sendProgressMock: vi.fn(),
  askChatbotMock: vi.fn(),
}));

vi.mock('../services/bookService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/bookService')>();
  return { ...actual, fetchBookInfo: fetchBookInfoMock, fetchPage: fetchPageMock };
});

vi.mock('../services/progressService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/progressService')>();
  return { ...actual, enterBook: enterBookMock, sendProgress: sendProgressMock };
});

vi.mock('../services/chatbotService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/chatbotService')>();
  return { ...actual, askChatbot: (...args: unknown[]) => askChatbotMock(...args) };
});

const INFO = {
  basic_info: { title: '가상범인', author: '김내성', published_year: 1937, length_note: '68쪽' },
  introduction: null,
  background: null,
  chapters: [{ chapter_no: 1, title: '탐정극', start_page: 1, end_page: 68 }],
} as unknown as BookInfoResponse;

async function* done() {
  yield { type: 'done' as const, applied_cutoff: 2 };
}

function ok(appliedCutoff: number): ProgressResponse {
  return { success: true, applied_cutoff: appliedCutoff, confirm: null };
}

async function startAt(page: number) {
  enterBookMock.mockResolvedValue({ route: 'reader', page, is_new_session: true, session_epoch: 1 });
  const rendered = renderHook(() => useReadingSession('bk'));
  await waitFor(() => expect(rendered.result.current.totalPages).toBe(68));
  await waitFor(() => expect(rendered.result.current.page).not.toBeNull());
  await waitFor(() => expect(sendProgressMock).toHaveBeenCalled());
  await act(async () => {});
  return rendered;
}

/** 챗봇 요청마다 [page, from_page] */
function askedPositions() {
  return askChatbotMock.mock.calls.map((call) => [call[2], call[6] ?? null]);
}

describe('useReadingSession — 챗봇 질문에 동봉하는 진도 (FR-PRG-003 🚦)', () => {
  beforeEach(() => {
    clearPendingJump();
    localStorage.clear();
    sessionStorage.clear();
    fetchBookInfoMock.mockReset().mockResolvedValue(INFO);
    fetchPageMock
      .mockReset()
      .mockImplementation((_bookId: string, pageNo: number) => Promise.resolve(fakePage(pageNo, 68, `${pageNo}쪽`)));
    enterBookMock.mockReset();
    sendProgressMock.mockReset().mockResolvedValue(ok(1));
    askChatbotMock.mockReset().mockImplementation(() => done());
  });

  test('FR-PRG-003: 1쪽에서 다음으로 넘긴 뒤 물으면 from_page 1 을 싣는다 — 진도 POST 가 실패해도 질문이 넘김을 알린다', async () => {
    const rendered = await startAt(1);
    // 2쪽 진도 POST 가 실패한 상황 (fire-and-forget, NFR-PERF-005)
    sendProgressMock.mockResolvedValue(null);
    act(() => rendered.result.current.moveTo(2));
    await waitFor(() => expect(rendered.result.current.currentPage).toBe(2));
    await act(async () => {});

    await act(async () => {
      rendered.result.current.ssabiPanelProps.onAsk('내 노트 보여?');
    });
    await waitFor(() => expect(askChatbotMock).toHaveBeenCalled());
    expect(askedPositions()).toEqual([[2, 1]]);
  });

  test('FR-PRG-003: 이어 읽기로 2쪽에 바로 들어와 물으면 from_page 를 싣지 않는다 (negative 쌍 — 화면에 뜬 사실만)', async () => {
    const rendered = await startAt(2);
    await act(async () => {
      rendered.result.current.ssabiPanelProps.onAsk('내 노트 보여?');
    });
    await waitFor(() => expect(askChatbotMock).toHaveBeenCalled());
    expect(askedPositions()).toEqual([[2, null]]);
  });
});
