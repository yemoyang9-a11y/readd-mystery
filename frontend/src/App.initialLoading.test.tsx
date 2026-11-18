import { act, render, screen } from '@testing-library/react';
import App from './App';
import { setAuthToken } from './utils/storage';

/**
 * Router 7 전환 회귀 — 첫 진입 경로의 화면 코드를 나눠 받는 동안에는 Router 6 의
 * RouterProvider fallbackElement 와 같은 '불러오는 중' 표시가 떠야 한다 (빈 화면 금지).
 */
beforeEach(() => setAuthToken('test-session-token'));
afterEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

test.each(['/books/takryu/read', '/books/takryu/briefing', '/admin'])(
  '%s 로 바로 들어오면 화면 코드를 받는 동안 불러오는 중을 보여 준다',
  async (path) => {
    window.history.pushState({}, '', path);
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('불러오는 중');
    await act(() => vi.dynamicImportSettled());
  }
);
