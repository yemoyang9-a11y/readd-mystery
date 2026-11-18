import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
        <Route path="/" element={<p>홈 화면</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function pageShown(pageNo: number) {
  const input = await screen.findByLabelText<HTMLInputElement>('페이지로 이동');
  await waitFor(() => expect(input.value).toBe(String(pageNo)));
}

describe('PC 완독 화면 — 서버 is_complete 로만 열린다 (FR-BRF-005 🚦, E2E #86)', () => {
  beforeEach(() => {
    clearPendingJump();
    localStorage.clear();
    enterBookMock.mockReset();
    sendProgressMock.mockReset().mockResolvedValue({ success: true, applied_cutoff: 5, confirm: null });
    fetchPositionMock.mockReset();
  });

  test('FR-BRF-005: PC 마지막 쪽이어도 서버가 완독이 아니라고 하면 완독 화면·완독 블록 0건', async () => {
    fetchPositionMock.mockResolvedValue(position(false));
    renderReader();
    await pageShown(LAST_PAGE);
    await waitFor(() => expect(fetchPositionMock).toHaveBeenCalledWith('takryu'));
    expect(screen.queryAllByTestId('completion-screen')).toHaveLength(0);
    expect(screen.queryAllByTestId('completion-block')).toHaveLength(0);
    expect(screen.queryAllByText('끝까지 읽었어요')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: '커뮤니티에서 이야기 나누기' })).toHaveLength(0);
  });

  test('FR-SPL-005: PC 완독 여부 조회가 실패하면 완독 화면·완독 블록 0건', async () => {
    fetchPositionMock.mockRejectedValue(new Error('network'));
    renderReader();
    await pageShown(LAST_PAGE);
    await waitFor(() => expect(fetchPositionMock).toHaveBeenCalled());
    expect(screen.queryAllByTestId('completion-screen')).toHaveLength(0);
    expect(screen.queryAllByTestId('completion-block')).toHaveLength(0);
  });

  test('FR-BRF-005: PC 마지막 쪽이 아니면 완독 여부를 묻지 않고 완독 화면 0건', async () => {
    fetchPositionMock.mockResolvedValue(position(true));
    renderReader(10);
    await pageShown(10);
    expect(fetchPositionMock).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId('completion-screen')).toHaveLength(0);
    expect(screen.queryAllByTestId('completion-block')).toHaveLength(0);
  });

  test('FR-BRF-005: PC 서버가 완독이라고 하면 완독 화면이 뜨고 커뮤니티로 바로 간다 (positive 쌍)', async () => {
    fetchPositionMock.mockResolvedValue(position(true));
    renderReader();
    await pageShown(LAST_PAGE);

    const dialog = await screen.findByRole('dialog', { name: '끝까지 읽었어요' });
    expect(dialog).toHaveAttribute('data-variant', 'dialog');
    expect(within(dialog).getByText('읽은 쪽')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '커뮤니티에서 이야기 나누기' }));
    expect(await screen.findByText('커뮤니티 화면')).toBeInTheDocument();
  });

  test('PC "홈으로"는 홈으로 간다', async () => {
    fetchPositionMock.mockResolvedValue(position(true));
    renderReader();
    await pageShown(LAST_PAGE);
    await userEvent.click(await screen.findByRole('button', { name: '홈으로' }));
    expect(await screen.findByText('홈 화면')).toBeInTheDocument();
  });

  test('PC 완독 화면은 책마다 한 번만 저절로 뜨고, 마지막 쪽의 완독 블록에서 다시 열고 커뮤니티로 간다', async () => {
    fetchPositionMock.mockResolvedValue(position(true));
    const first = renderReader();
    await pageShown(LAST_PAGE);
    await userEvent.click(await screen.findByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('completion-screen')).toBeNull();
    first.unmount();

    renderReader();
    await pageShown(LAST_PAGE);
    const block = await screen.findByTestId('completion-block');
    expect(screen.queryByTestId('completion-screen')).toBeNull();

    await userEvent.click(within(block).getByRole('button', { name: '완독했어요' }));
    expect(await screen.findByRole('dialog', { name: '끝까지 읽었어요' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));

    await userEvent.click(within(block).getByRole('button', { name: '커뮤니티' }));
    expect(await screen.findByText('커뮤니티 화면')).toBeInTheDocument();
  });
});
