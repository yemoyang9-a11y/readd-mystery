import { act, render, screen, within } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { createAppRouter } from './App';
import { setAuthToken } from './utils/storage';

/**
 * 데스크톱 커뮤니티 경로 (E2E #86) — PC 에서도 커뮤니티 허브와 책별 이야기방이 열린다.
 * 열림·잠김은 서버(대역)가 기준점 결정기의 is_complete 로 정한다. 화면은 완독을 계산하지 않는다 (FR-BRF-005 🚦).
 */
beforeEach(() => setAuthToken('test-session-token'));
afterEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

function renderDesktopAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<RouterProvider router={createAppRouter(false)} />);
}

test('PC 에서 /community 는 커뮤니티 허브를 그린다 (페이지를 찾을 수 없음 0건)', async () => {
  renderDesktopAt('/community');
  await act(() => vi.dynamicImportSettled());
  expect(await screen.findByTestId('community-hub')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: '커뮤니티' })).toBeInTheDocument();
  expect(screen.queryByText('페이지를 찾을 수 없습니다')).toBeNull();
});

test('PC 에서 /books/:bookId/community 는 책 이야기방을 그린다 (페이지를 찾을 수 없음 0건)', async () => {
  renderDesktopAt('/books/takryu/community');
  await act(() => vi.dynamicImportSettled());
  expect(await screen.findByTestId('book-community')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: '완독자 이야기' })).toBeInTheDocument();
  expect(screen.queryByText('페이지를 찾을 수 없습니다')).toBeNull();
});

test('FR-BRF-005: PC 에서 완독하지 않은 책의 이야기방은 잠김 안내만 보이고 글 목록·글 수 0건', async () => {
  // 대역 서버에서 진도 기록이 없는 책 = 완독 아님
  renderDesktopAt('/books/takryu/community');
  await act(() => vi.dynamicImportSettled());
  expect(await screen.findByText('끝까지 읽으면 열려요')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '글쓰기' })).toBeNull();
  expect(screen.queryByText(/^글 \d+/)).toBeNull();
  const community = screen.getByTestId('book-community');
  expect(community.querySelectorAll('[data-track="community-post-open"]')).toHaveLength(0);
});

test('PC 위 줄 메뉴에 커뮤니티 링크가 있다', () => {
  renderDesktopAt('/');
  const nav = screen.getByRole('navigation', { name: '주 메뉴' });
  expect(within(nav).getByRole('link', { name: '커뮤니티' })).toHaveAttribute('href', '/community');
});

test('PC 커뮤니티 화면에도 위 줄 메뉴가 있다', async () => {
  renderDesktopAt('/books/takryu/community');
  await act(() => vi.dynamicImportSettled());
  await screen.findByTestId('book-community');
  const nav = screen.getByRole('navigation', { name: '주 메뉴' });
  expect(within(nav).getByRole('link', { name: '커뮤니티' })).toBeInTheDocument();
});
