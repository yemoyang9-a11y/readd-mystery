import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import MobileReader from './MobileReader';
import { clearPendingJump } from '../../utils/pendingJump';
import type { PositionResponse } from '../../services/positionService';

const { enterBookMock, sendProgressMock, fetchPositionMock } = vi.hoisted(() => ({
  enterBookMock: vi.fn(),
  sendProgressMock: vi.fn(),
  fetchPositionMock: vi.fn(),
}));

vi.mock('../../services/progressService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/progressService')>();
  return { ...actual, enterBook: enterBookMock, sendProgress: sendProgressMock };
});
vi.mock('../../services/positionService', () => ({ fetchPosition: fetchPositionMock }));
vi.mock('../../hooks/useHeartbeat', () => ({ useHeartbeat: vi.fn() }));

const LAST_PAGE = 30;

function position(isComplete: boolean): PositionResponse {
  return { applied_cutoff: 5, current_chapter_no: 1, read_chapter_nos: [], is_complete: isComplete };
}

function renderReader() {
  return render(
    <MemoryRouter initialEntries={['/books/takryu/read']}>
      <Routes>
        <Route path="/books/:bookId/read" element={<MobileReader />} />
        <Route path="/books/:bookId/community" element={<p>커뮤니티 화면</p>} />
        <Route path="/" element={<p>홈 화면</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function lastPageShown() {
  const input = await screen.findByLabelText<HTMLInputElement>('페이지로 이동');
  await waitFor(() => expect(input.value).toBe(String(LAST_PAGE)));
  await waitFor(() => expect(fetchPositionMock).toHaveBeenCalledWith('takryu'));
}

describe('완독 화면 — 서버 is_complete 로만 열린다 (FR-BRF-005 🚦, 2026-11-18 대표 지시)', () => {
  beforeEach(() => {
    clearPendingJump();
    localStorage.clear();
    enterBookMock
      .mockReset()
      .mockResolvedValue({ route: 'reader', page: LAST_PAGE, is_new_session: false, session_epoch: 1 });
    sendProgressMock.mockReset().mockResolvedValue({ success: true, applied_cutoff: 5, confirm: null });
    fetchPositionMock.mockReset();
  });

  test('FR-BRF-005: 마지막 쪽이어도 서버가 완독이 아니라고 하면 완독 화면 0건', async () => {
    fetchPositionMock.mockResolvedValue(position(false));
    renderReader();
    await lastPageShown();
    await waitFor(() => expect(fetchPositionMock).toHaveBeenCalled());
    expect(screen.queryByTestId('completion-screen')).toBeNull();
    expect(screen.queryByText('끝까지 읽었어요')).toBeNull();
    expect(screen.queryByRole('button', { name: '커뮤니티에서 이야기 나누기' })).toBeNull();
  });

  test('FR-SPL-005: 완독 여부 조회가 실패하면 완독 화면 0건', async () => {
    fetchPositionMock.mockRejectedValue(new Error('network'));
    renderReader();
    await lastPageShown();
    expect(screen.queryByTestId('completion-screen')).toBeNull();
  });

  test('FR-BRF-005: 서버가 완독이라고 하면 완독 화면이 뜨고 커뮤니티로 바로 간다 (positive 쌍)', async () => {
    fetchPositionMock.mockResolvedValue(position(true));
    renderReader();
    await lastPageShown();

    const dialog = await screen.findByRole('dialog', { name: '끝까지 읽었어요' });
    expect(within(dialog).getByText('읽은 쪽')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '커뮤니티에서 이야기 나누기' }));
    expect(await screen.findByText('커뮤니티 화면')).toBeInTheDocument();
  });

  test('"홈으로"는 홈으로 간다', async () => {
    fetchPositionMock.mockResolvedValue(position(true));
    renderReader();
    await lastPageShown();
    await userEvent.click(await screen.findByRole('button', { name: '홈으로' }));
    expect(await screen.findByText('홈 화면')).toBeInTheDocument();
  });

  test('한 번 닫으면 다시 저절로 뜨지 않고, "완독했어요" 배지로 다시 연다', async () => {
    fetchPositionMock.mockResolvedValue(position(true));
    const first = renderReader();
    await lastPageShown();
    await userEvent.click(await screen.findByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('completion-screen')).toBeNull();
    first.unmount();

    renderReader();
    await lastPageShown();
    // 완독 블록이 뜰 때까지 기다린 뒤에도 완독 화면은 저절로 뜨지 않는다
    const badge = await screen.findByRole('button', { name: '완독했어요' });
    expect(screen.queryByTestId('completion-screen')).toBeNull();

    await userEvent.click(badge);
    expect(await screen.findByRole('dialog', { name: '끝까지 읽었어요' })).toBeInTheDocument();
  });
});
