import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import RequireSession from './RequireSession';
import { logout } from '../../services/authService';
import { verifyStoredSession } from '../../services/sessionCheck';
import { clearAuthToken, setAuthToken } from '../../utils/storage';

vi.mock('../../services/sessionCheck', () => ({ verifyStoredSession: vi.fn().mockResolvedValue(undefined) }));

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p>로그인 화면</p> },
      { path: '/', element: <p>홈 화면</p> },
      {
        path: '*',
        element: (
          <RequireSession>
            <p>보호된 화면</p>
          </RequireSession>
        ),
      },
    ],
    { initialEntries: [path] }
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('RequireSession — 로그인 관문', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(verifyStoredSession).mockClear();
  });

  test('직접 로그아웃하면(다른 탭 포함) 작품 화면에서 홈으로 간다 — 로그인 창을 억지로 띄우지 않는다', async () => {
    setAuthToken('saved');
    const router = renderAt('/books/takryu/read');
    expect(screen.getByText('보호된 화면')).toBeInTheDocument();

    act(() => logout());

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  test('E2E #81: 서버가 세션을 지우면(401·만료) 가려던 주소를 next 로 남긴다', async () => {
    setAuthToken('saved');
    const router = renderAt('/books/takryu/read');

    act(() => clearAuthToken());

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/books/takryu/read')}`);
  });

  test('E2E #89: 토큰이 있으면 화면을 바로 그리고, 토큰 확인을 맡긴다', () => {
    setAuthToken('saved');
    renderAt('/books/takryu/briefing');
    expect(screen.getByText('보호된 화면')).toBeInTheDocument();
    expect(verifyStoredSession).toHaveBeenCalled();
  });

  test('E2E #89: 토큰이 없으면 확인하지 않고 /login 으로 간다', async () => {
    const router = renderAt('/books/takryu/briefing');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(verifyStoredSession).not.toHaveBeenCalled();
  });
});
