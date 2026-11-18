import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from './App';
import { loginPathFor, safeNextPath } from './utils/authRedirect';
import { clearAuthToken, getAuthToken, setAuthToken } from './utils/storage';
import { setMockMember } from '../mocks/server';

/** 로그인 관문 — 2026-11-18 대표 지시: 처음 접속하면 로그인·회원가입 창 */
function renderAt(path: string, isMobile = true) {
  window.history.pushState({}, '', path);
  const router = createAppRouter(isMobile);
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  localStorage.clear();
  setMockMember(false);
});
afterEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe.each([
  ['모바일', true],
  ['PC', false],
])('%s 로그인 관문', (_label, isMobile) => {
  test.each(['/', '/my', '/shelf', '/search?q=%EA%B9%80'])(
    '세션이 없으면 %s 는 가려던 주소를 들고 /login 으로 간다',
    async (path) => {
      const router = renderAt(path, isMobile);
      await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
      expect(router.state.location.search).toBe(path === '/' ? '' : `?next=${encodeURIComponent(path)}`);
      expect(screen.getByRole('tab', { name: '회원가입' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull();
    }
  );

  test('세션이 있으면 관문을 지나 화면을 그린다', () => {
    setAuthToken('saved-session');
    renderAt('/my', isMobile);
    expect(screen.getByRole('heading', { level: 1, name: 'MY' })).toBeInTheDocument();
  });
});

test('세션이 없으면 나눠 받는 읽기 화면도 /login 으로 간다', async () => {
  const router = renderAt('/books/takryu/read');
  await act(() => vi.dynamicImportSettled());
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/books/takryu/read')}`);
});

test('OAuth 콜백과 관리자 화면은 세션 없이 열린다', async () => {
  const callback = renderAt('/auth/callback');
  // 콜백 화면 자체는 관문 없이 열리고, 코드가 없으면 곧장 /login 으로 보낸다
  await waitFor(() => expect(callback.state.location.pathname).toBe('/login'));
  expect(callback.state.location.search).toBe('');

  const admin = renderAt('/admin/books');
  await act(() => vi.dynamicImportSettled());
  expect(admin.state.location.pathname).toBe('/admin/books');
});

test('로그아웃해 토큰이 지워지면 그 자리에서 /login 으로 간다', async () => {
  setAuthToken('saved-session');
  const router = renderAt('/shelf');
  expect(screen.getByRole('heading', { level: 1, name: '내 서재' })).toBeInTheDocument();

  act(() => clearAuthToken());

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(router.state.location.search).toBe('?next=%2Fshelf');
});

test('mock 모드에서 가입하면 토큰이 저장되고 첫 안내 주소(/guide)로 간다', async () => {
  const router = renderAt('/shelf');
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));

  await userEvent.click(screen.getByRole('tab', { name: '회원가입' }));
  await userEvent.type(screen.getByLabelText('이메일'), 'new@example.com');
  await userEvent.type(screen.getByLabelText('비밀번호'), 'secret-pass');
  await userEvent.type(screen.getByLabelText('닉네임'), '새 독자');
  await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

  await waitFor(() => expect(router.state.location.pathname).toBe('/guide'));
  expect(getAuthToken()).toMatch(/^mock-session-/);
});

test('mock 모드에서 로그인하면 가려던 주소로 돌아간다', async () => {
  const router = renderAt('/shelf');
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));

  await userEvent.type(screen.getByLabelText('이메일'), 'reader@example.com');
  await userEvent.type(screen.getByLabelText('비밀번호'), 'secret-pass');
  await userEvent.click(screen.getByRole('button', { name: '로그인' }));

  await waitFor(() => expect(router.state.location.pathname).toBe('/shelf'));
  expect(await screen.findByRole('heading', { level: 1, name: '내 서재' })).toBeInTheDocument();
});

describe('E2E #81 — MY에서 직접 로그아웃하면 새로 시작한다', () => {
  test('MY에서 로그아웃을 누르면 next 없이 /login 으로 가고, 다시 로그인하면 홈으로 간다', async () => {
    setAuthToken('saved-session');
    const router = renderAt('/my');
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('');
    expect(getAuthToken()).toBeNull();

    await userEvent.type(screen.getByLabelText('이메일'), 'reader@example.com');
    await userEvent.type(screen.getByLabelText('비밀번호'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  test('읽는 중에 세션이 지워지면(401 등) 가려던 주소를 next 로 들고 간다', async () => {
    setAuthToken('saved-session');
    const router = renderAt('/search?q=%EA%B9%80');
    expect(router.state.location.pathname).toBe('/search');

    act(() => clearAuthToken());

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/search?q=%EA%B9%80')}`);
  });
});

describe('돌아갈 주소 검사', () => {
  test.each([
    [null, '/'],
    ['/books/a/read?x=1', '/books/a/read?x=1'],
    ['//evil.example', '/'],
    ['https://evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/login?next=%2Fmy', '/'],
  ])('%s → %s', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  test('홈으로 갈 때는 next 를 붙이지 않는다', () => {
    expect(loginPathFor('/')).toBe('/login');
    expect(loginPathFor('/my')).toBe('/login?next=%2Fmy');
  });
});
