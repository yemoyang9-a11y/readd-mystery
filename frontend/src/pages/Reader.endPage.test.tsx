/**
 * PC 책 끝 페이지(N+1) — 대표 결정 2026-11-19. 휴대폰과 같은 화면(BookEndPage)을 쓴다.
 * 끝 페이지로 오가는 동안 진도 이벤트 0건 (절대 규칙 2·8·9, FR-PRG-003 🚦). 예전 완독 창은 없앴다.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import Reader from './Reader';
import { clearPendingJump } from '../utils/pendingJump';
import type { PositionResponse } from '../services/positionService';

const { enterBookMock, sendProgressMock, fetchPositionMock } = vi.hoisted(() => ({
  enterBookMock: vi.fn(),
  sendProgressMock: vi.fn(),
  fetchPositionMock: vi.fn(),
}));

vi.mock('../services/progressService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/progressService')>();
  return { ...actual, enterBook: enterBookMock, sendProgress: sendProgressMock };
});
vi.mock('../services/positionService', () => ({ fetchPosition: fetchPositionMock }));
vi.mock('../hooks/useHeartbeat', () => ({ useHeartbeat: vi.fn() }));

const LAST_PAGE = 30;

function position(isComplete: boolean): PositionResponse {
  return { applied_cutoff: 5, current_chapter_no: 1, read_chapter_nos: [], is_complete: isComplete };
}

function renderReader(startPage = LAST_PAGE) {
  enterBookMock.mockResolvedValue({ route: 'reader', page: startPage, is_new_session: false, session_epoch: 1 });
  return render(
    <MemoryRouter initialEntries={['/books/takryu/read']}>
      <Routes>
        <Route path="/books/:bookId/read" element={<Reader />} />
        <Route path="/books/:bookId/community" element={<p>커뮤니티 화면</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function pageShown(pageNo: number) {
  const input = await screen.findByLabelText<HTMLInputElement>('페이지로 이동');
  await waitFor(() => expect(input.value).toBe(String(pageNo)));
}

describe('PC 책 끝 페이지(N+1) — 대표 결정 2026-11-19', () => {
  beforeEach(() => {
    clearPendingJump();
    localStorage.clear();
    enterBookMock.mockReset();
    sendProgressMock.mockReset().mockResolvedValue({ success: true, applied_cutoff: 5, confirm: null });
    fetchPositionMock.mockReset().mockResolvedValue(position(true));
  });

  test('FR-PRG-003: PC 마지막 쪽에서 다음 페이지를 누르면 끝 페이지가 뜨고, 이전 페이지로 돌아온다 — 진도 이벤트 0건', async () => {
    renderReader();
    await pageShown(LAST_PAGE);
    const before = sendProgressMock.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }));
    const endPage = await screen.findByTestId('book-end-page');
    expect(within(endPage).getByTestId('end-page-indicator')).toHaveTextContent(`${LAST_PAGE + 1} / ${LAST_PAGE + 1}`);
    await userEvent.click(within(endPage).getByRole('button', { name: '이전 페이지' }));
    expect(screen.queryByTestId('book-end-page')).toBeNull();
    await pageShown(LAST_PAGE);
    expect(sendProgressMock.mock.calls.length).toBe(before);
  });

  test('FR-PRG-003: PC 키보드 → 로 끝 페이지, ← 로 N쪽 — 진도 이벤트 0건', async () => {
    renderReader();
    await pageShown(LAST_PAGE);
    const before = sendProgressMock.mock.calls.length;
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByTestId('book-end-page')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.queryByTestId('book-end-page')).toBeNull();
    expect(sendProgressMock.mock.calls.length).toBe(before);
  });

  test('PC 예전 완독 창은 서버가 완독이라고 해도 저절로 뜨지 않는다', async () => {
    renderReader();
    await pageShown(LAST_PAGE);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('completion-screen')).toBeNull();
    expect(screen.queryByTestId('completion-block')).toBeNull();
    expect(screen.queryByTestId('book-end-page')).toBeNull();
  });

  test('PC 끝 페이지의 "완독자 커뮤니티로 이동하기"는 커뮤니티로 간다', async () => {
    renderReader();
    await pageShown(LAST_PAGE);
    await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }));
    const endPage = await screen.findByTestId('book-end-page');
    await userEvent.click(within(endPage).getByRole('button', { name: '완독자 커뮤니티로 이동하기' }));
    expect(await screen.findByText('커뮤니티 화면')).toBeInTheDocument();
  });
});
