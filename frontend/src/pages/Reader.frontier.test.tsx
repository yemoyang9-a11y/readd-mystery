import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import Reader from './Reader';
import MobileReader from '../mobile/pages/MobileReader';
import { clearPendingJump } from '../utils/pendingJump';
import type { ProgressResponse } from '../types';

const { enterBookMock, sendProgressMock, confirmFrontierMock } = vi.hoisted(() => ({
  enterBookMock: vi.fn(),
  sendProgressMock: vi.fn(),
  confirmFrontierMock: vi.fn(),
}));

vi.mock('../services/progressService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/progressService')>();
  return { ...actual, enterBook: enterBookMock, sendProgress: sendProgressMock, confirmFrontier: confirmFrontierMock };
});

vi.mock('../hooks/useHeartbeat', () => ({ useHeartbeat: vi.fn() }));

const UNCONFIRMED: ProgressResponse = {
  success: true,
  applied_cutoff: 5,
  confirm: { current_page: null, furthest_page: 21 },
};

function renderAt(element: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={['/books/takryu/read']}>
      <Routes>
        <Route path="/books/:bookId/read" element={element} />
      </Routes>
    </MemoryRouter>
  );
}

async function openedAt(page: number) {
  const input = await screen.findByLabelText<HTMLInputElement>('페이지로 이동');
  await waitFor(() => expect(input.value).toBe(String(page)));
  await waitFor(() => expect(sendProgressMock).toHaveBeenCalled());
  return input;
}

beforeEach(() => {
  clearPendingJump();
  localStorage.clear();
  enterBookMock.mockReset().mockResolvedValue({ route: 'reader', page: 5, is_new_session: false, session_epoch: 1 });
  sendProgressMock.mockReset().mockResolvedValue({ success: true, applied_cutoff: 5, confirm: null });
  confirmFrontierMock.mockReset();
});

describe('PC 읽기 화면 — 목차 확인 창 세 선택지 (FR-PRG-003 🚦)', () => {
  test('FR-PRG-003: "앞부분은 이미 읽었어요"는 그 이동 이벤트 하나에만 claim을 싣는다', async () => {
    renderAt(<Reader />);
    await openedAt(5);
    fireEvent.click(screen.getByRole('button', { name: '목차 열기' }));
    fireEvent.click(await screen.findByRole('button', { name: /신판 흥부전/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '취소',
      '이동만 하기',
      '앞부분은 이미 읽었어요',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: '앞부분은 이미 읽었어요' }));

    await openedAt(21);
    await waitFor(() => expect(sendProgressMock).toHaveBeenCalledTimes(2));
    expect(sendProgressMock.mock.calls.map(([, page, opts]) => [page, opts])).toEqual([
      [5, { fromPage: null }],
      [21, { fromPage: 5, claim: 'read_through' }],
    ]);
  });
});

describe.each([
  ['PC', () => <Reader />],
  ['모바일', () => <MobileReader />],
])('%s 싸비 — 넘겨 본 쪽 확인 카드 (FR-PRG-003 🚦)', (_name, element) => {
  test('FR-PRG-003: confirm이 없으면 싸비를 열어도 카드가 없다', async () => {
    renderAt(element());
    await openedAt(5);
    fireEvent.click(screen.getAllByRole('button', { name: '사이드 탭 열기' })[0]);

    await screen.findByRole('tablist', { name: '사이드 탭' });
    expect(screen.queryByRole('region', { name: '읽은 범위 확인' })).not.toBeInTheDocument();
  });

  test('FR-PRG-003: confirm이 오면 싸비 위쪽에 카드를 보이고, 답이 성공하면 카드를 내린다', async () => {
    sendProgressMock.mockReset().mockResolvedValue(UNCONFIRMED);
    confirmFrontierMock.mockResolvedValue({ success: true, applied_cutoff: 21, confirm: null });
    renderAt(element());
    await openedAt(5);
    fireEvent.click(screen.getAllByRole('button', { name: '사이드 탭 열기' })[0]);

    const card = await screen.findByRole('region', { name: '읽은 범위 확인' });
    expect(card).toHaveTextContent('21쪽까지 넘겨 보셨어요. 거기까지 읽으셨나요? 지금은 5쪽까지를 기준으로 보여 드려요.');
    fireEvent.click(within(card).getByRole('button', { name: '21쪽까지 읽었어요' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: '읽은 범위 확인' })).not.toBeInTheDocument());
    expect(confirmFrontierMock).toHaveBeenCalledWith('takryu', 'furthest');
  });

  test('FR-SPL-005: 답이 실패하면 카드를 그대로 둔다', async () => {
    sendProgressMock.mockReset().mockResolvedValue(UNCONFIRMED);
    confirmFrontierMock.mockResolvedValue(null);
    renderAt(element());
    await openedAt(5);
    fireEvent.click(screen.getAllByRole('button', { name: '사이드 탭 열기' })[0]);

    const card = await screen.findByRole('region', { name: '읽은 범위 확인' });
    fireEvent.click(within(card).getByRole('button', { name: '그대로 둘게요' }));

    await waitFor(() => expect(confirmFrontierMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(card).getByRole('button', { name: '그대로 둘게요' })).toBeEnabled());
    expect(screen.getByRole('region', { name: '읽은 범위 확인' })).toBe(card);
  });
});
