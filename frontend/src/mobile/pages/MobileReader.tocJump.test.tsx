import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import MobileReader from './MobileReader';
import { clearPendingJump } from '../../utils/pendingJump';

const { enterBookMock, sendProgressMock } = vi.hoisted(() => ({
  enterBookMock: vi.fn(),
  sendProgressMock: vi.fn(),
}));

vi.mock('../../services/progressService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/progressService')>();
  return { ...actual, enterBook: enterBookMock, sendProgress: sendProgressMock };
});

vi.mock('../../hooks/useHeartbeat', () => ({ useHeartbeat: vi.fn() }));

function renderReader() {
  return render(
    <MemoryRouter initialEntries={['/books/takryu/read']}>
      <Routes>
        <Route path="/books/:bookId/read" element={<MobileReader />} />
      </Routes>
    </MemoryRouter>
  );
}

async function openToc() {
  const input = await screen.findByLabelText<HTMLInputElement>('페이지로 이동');
  await waitFor(() => expect(input.value).toBe('5'));
  await waitFor(() => expect(sendProgressMock).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '목차 열기' }));
  return () => screen.getByLabelText<HTMLInputElement>('페이지로 이동');
}

describe('FR-PRG-003: 모바일 목차 점프 확인 창', () => {
  beforeEach(() => {
    clearPendingJump();
    localStorage.clear();
    enterBookMock
      .mockReset()
      .mockResolvedValue({ route: 'reader', page: 5, is_new_session: false, session_epoch: 1 });
    sendProgressMock.mockReset().mockResolvedValue({ success: true, applied_cutoff: 15, confirm: null });
  });

  test('기준 쪽수보다 뒤 장을 고르면 확인 창이 뜨고, 취소하면 이동하지 않는다', async () => {
    renderReader();
    const pageInput = await openToc();

    fireEvent.click(await screen.findByRole('button', { name: /신판 흥부전/ }));

    expect(screen.getByRole('dialog')).toHaveTextContent(
      '21쪽으로 이동합니다. 앞부분을 이미 읽으셨다면 관계도와 아모가 이 쪽까지 다룹니다. 이동만 하면 지금까지 차례로 읽은 쪽까지만 다룹니다.'
    );
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pageInput().value).toBe('5');
    expect(sendProgressMock).toHaveBeenCalledTimes(1);
  });

  test('확인 창에서 "이동만 하기"를 누르면 그 장으로 옮기고 claim 없이 직전 쪽만 알린다', async () => {
    renderReader();
    const pageInput = await openToc();

    fireEvent.click(await screen.findByRole('button', { name: /신판 흥부전/ }));
    fireEvent.click(screen.getByRole('button', { name: '이동만 하기' }));

    await waitFor(() => expect(pageInput().value).toBe('21'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(sendProgressMock).toHaveBeenCalledTimes(2));
    expect(sendProgressMock).toHaveBeenLastCalledWith('takryu', 21, { fromPage: 5 });
  });

  test('확인 창에서 "앞부분은 이미 읽었어요"를 누르면 그 이동 이벤트 하나에만 claim을 싣는다', async () => {
    renderReader();
    const pageInput = await openToc();

    fireEvent.click(await screen.findByRole('button', { name: /신판 흥부전/ }));
    fireEvent.click(screen.getByRole('button', { name: '앞부분은 이미 읽었어요' }));

    await waitFor(() => expect(pageInput().value).toBe('21'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(sendProgressMock).toHaveBeenCalledTimes(2));
    expect(sendProgressMock.mock.calls.map(([, page, opts]) => [page, opts])).toEqual([
      [5, { fromPage: null }],
      [21, { fromPage: 5, claim: 'read_through' }],
    ]);
  });

  test('기준 쪽수 이내 장은 확인 창 없이 바로 옮긴다', async () => {
    renderReader();
    const pageInput = await openToc();

    fireEvent.click(await screen.findByRole('button', { name: /생활 제일과/ }));

    await waitFor(() => expect(pageInput().value).toBe('11'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
