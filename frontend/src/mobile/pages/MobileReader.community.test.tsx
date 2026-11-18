import { render, screen, waitFor } from '@testing-library/react';
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
      </Routes>
    </MemoryRouter>
  );
}

async function lastPageShown() {
  const input = await screen.findByLabelText<HTMLInputElement>('페이지로 이동');
  await waitFor(() => expect(input.value).toBe(String(LAST_PAGE)));
  await waitFor(() => expect(fetchPositionMock).toHaveBeenCalledWith('takryu'));
}

describe('COMMUNITY: 읽기 화면의 커뮤니티 진입은 서버의 is_complete 로만 열린다 (FR-BRF-005 🚦)', () => {
  beforeEach(() => {
    clearPendingJump();
    localStorage.clear();
    enterBookMock
      .mockReset()
      .mockResolvedValue({ route: 'reader', page: LAST_PAGE, is_new_session: false, session_epoch: 1 });
    sendProgressMock.mockReset().mockResolvedValue({ success: true, applied_cutoff: 5, confirm: null });
    fetchPositionMock.mockReset();
  });

  test('마지막 쪽을 펼쳤어도 서버가 완독이 아니라고 하면 "완독했어요"와 커뮤니티 버튼이 0건', async () => {
    fetchPositionMock.mockResolvedValue(position(false));
    renderReader();
    await lastPageShown();

    await waitFor(() => expect(fetchPositionMock).toHaveBeenCalled());
    // 미완독 안내 문구도 두지 않는다 (2026-11-18 대표 지시)
    expect(screen.queryByText('앞부분까지 모두 읽으면 완독자 이야기가 열려요')).toBeNull();
    expect(screen.queryByText('완독했어요')).toBeNull();
    expect(screen.queryByRole('button', { name: '다른 독자들과 이야기하기' })).toBeNull();
    expect(document.querySelector('[data-track="community-open"]')).toBeNull();
  });

  test('서버가 완독이라고 하면 완독 블록과 커뮤니티 버튼이 나오고 누르면 커뮤니티로 간다 (positive 쌍)', async () => {
    fetchPositionMock.mockResolvedValue(position(true));
    renderReader();
    await lastPageShown();

    expect(await screen.findByText('완독했어요')).toBeInTheDocument();
    expect(screen.queryByText('앞부분까지 모두 읽으면 완독자 이야기가 열려요')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '다른 독자들과 이야기하기' }));
    expect(await screen.findByText('커뮤니티 화면')).toBeInTheDocument();
  });

  test('FR-SPL-005: 완독 여부 조회가 실패하면 완독 블록·커뮤니티 버튼·안내가 모두 0건', async () => {
    fetchPositionMock.mockRejectedValue(new Error('network'));
    renderReader();
    await lastPageShown();
    await waitFor(() => expect(fetchPositionMock).toHaveBeenCalled());

    expect(screen.queryByText('완독했어요')).toBeNull();
    expect(screen.queryByRole('button', { name: '다른 독자들과 이야기하기' })).toBeNull();
    expect(screen.queryByText('앞부분까지 모두 읽으면 완독자 이야기가 열려요')).toBeNull();
  });
});
