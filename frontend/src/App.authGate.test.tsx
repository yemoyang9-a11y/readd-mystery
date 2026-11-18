import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from './App';
import { LOGIN_REQUIRED_ROUTES, loginPathFor, safeNextPath } from './utils/authRedirect';
import { BOOK_ROUTES } from './utils/routes';
import { clearAuthToken, getAuthToken, setAuthToken } from './utils/storage';
import { setMockMember } from '../mocks/server';

/**
 * 로그인 시점 — 대표 지시 2026-11-18: "처음부터 로그인 창 띄우지 말고 작품을 보려거나 MY 페이지에서
 * 로그인하려고 할 때 로그인창 띄우고". 둘러보기는 비회원도, 작품을 여는 순간 로그인 화면.
 */
function renderAt(path: string, isMobile = true) {
  window.history.pushState({}, '', path);
  const router = createAppRouter(isMobile);
  render(<RouterProvider router={router} />);
  return router;
}

async function fillSignup() {
  await userEvent.click(screen.getByRole('tab', { name: '회원가입' }));
  await userEvent.type(screen.getByLabelText('이메일'), 'new@example.com');
  await userEvent.type(screen.getByLabelText('비밀번호'), 'secret-pass1');
  await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'secret-pass1');
  await userEvent.type(screen.getByLabelText('닉네임'), '새 독자');
  await userEvent.click(screen.getByRole('checkbox', { name: '전체 동의' }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setMockMember(false);
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.pushState({}, '', '/');
});

test('로그인이 필요한 경로는 브리핑·읽기·책 이야기방 셋뿐이다', () => {
  expect([...LOGIN_REQUIRED_ROUTES].sort()).toEqual(
    [BOOK_ROUTES.briefing, BOOK_ROUTES.reader, BOOK_ROUTES.community].sort()
  );
});

describe.each([
  ['모바일', true],
  ['PC', false],
])('%s — 비회원 둘러보기', (_label, isMobile) => {
  test.each(['/', '/search?q=%EA%B9%80', '/shelf', '/community'])(
    '세션이 없어도 %s 는 로그인 화면 없이 열린다',
    async (path) => {
      const router = renderAt(path, isMobile);
      await act(() => vi.dynamicImportSettled());
      expect(router.state.location.pathname).toBe(path.split('?')[0]);
      expect(screen.queryByTestId('login-screen')).toBeNull();
    }
  );

  test('세션이 없으면 MY는 비회원 카드와 로그인/회원가입 버튼을 보여 준다', async () => {
    const router = renderAt('/my', isMobile);
    expect(screen.getByRole('heading', { level: 1, name: 'MY' })).toBeInTheDocument();
    expect(screen.getByText('로그인하지 않은 상태예요')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/my');

    await userEvent.click(screen.getByRole('link', { name: '로그인 / 회원가입' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fmy');
  });

  test.each([
    ['/books/takryu/briefing'],
    ['/books/takryu/read'],
    ['/books/takryu/community'],
  ])('세션이 없으면 작품을 여는 %s 는 가려던 주소를 들고 /login 으로 간다', async (path) => {
    const router = renderAt(path, isMobile);
    await act(() => vi.dynamicImportSettled());
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent(path)}`);
    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
  });

  test('세션이 있으면 작품 화면을 로그인 화면 없이 연다', async () => {
    setAuthToken('saved-session');
    const router = renderAt('/books/takryu/read', isMobile);
    await act(() => vi.dynamicImportSettled());
    expect(router.state.location.pathname).toBe('/books/takryu/read');
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });
});

test('PC 작품 소개(/books/:id)는 비회원도 열린다', async () => {
  const router = renderAt('/books/takryu', false);
  await act(() => vi.dynamicImportSettled());
  expect(router.state.location.pathname).toBe('/books/takryu');
  expect(screen.queryByTestId('login-screen')).toBeNull();
});

test('휴대폰에서 작품을 누르면(/books/:id → 브리핑) 로그인 화면이 뜨고 next 는 브리핑이다', async () => {
  const router = renderAt('/books/takryu', true);
  await act(() => vi.dynamicImportSettled());
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/books/takryu/briefing')}`);
});

test('OAuth 콜백·관리자·이용 가이드는 세션 없이 열린다', async () => {
  const callback = renderAt('/auth/callback');
  // 콜백 화면 자체는 관문 없이 열리고, 코드가 없으면 곧장 /login 으로 보낸다
  await waitFor(() => expect(callback.state.location.pathname).toBe('/login'));
  expect(callback.state.location.search).toBe('');

  const admin = renderAt('/admin/books');
  await act(() => vi.dynamicImportSettled());
  expect(admin.state.location.pathname).toBe('/admin/books');

  const guide = renderAt('/guide');
  await act(() => vi.dynamicImportSettled());
  expect(guide.state.location.pathname).toBe('/guide');
});

test('읽는 중에 세션이 지워지면(401 등) 가려던 주소를 next 로 들고 /login 으로 간다', async () => {
  setAuthToken('saved-session');
  const router = renderAt('/books/takryu/read');
  await act(() => vi.dynamicImportSettled());

  act(() => clearAuthToken());

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/books/takryu/read')}`);
});

test('둘러보는 중에 세션이 지워지면 화면을 그대로 둔다', async () => {
  setAuthToken('saved-session');
  const router = renderAt('/shelf');
  expect(screen.getByRole('heading', { level: 1, name: '내 서재' })).toBeInTheDocument();

  act(() => clearAuthToken());

  expect(router.state.location.pathname).toBe('/shelf');
  expect(screen.queryByTestId('login-screen')).toBeNull();
});

test('로그인 화면의 닫기를 누르면 들어오기 전 화면으로 돌아간다', async () => {
  const router = renderAt('/');
  await act(() => router.navigate('/books/takryu/read'));
  await act(() => vi.dynamicImportSettled());
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));

  await userEvent.click(screen.getByRole('button', { name: '닫기' }));

  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

test('주소로 바로 들어와 닫기를 누르면 홈으로 간다', async () => {
  const router = renderAt('/books/takryu/read');
  await act(() => vi.dynamicImportSettled());
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));

  await userEvent.click(screen.getByRole('button', { name: '닫기' }));

  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
});

test('mock 모드에서 작품을 열려다 가입하면 첫 안내(/guide)를 거쳐 그 작품으로 돌아간다', async () => {
  const router = renderAt('/books/takryu/briefing');
  await act(() => vi.dynamicImportSettled());
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));

  await fillSignup();
  await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

  await waitFor(() => expect(router.state.location.pathname).toBe('/guide'));
  expect(router.state.location.state).toEqual({ next: '/books/takryu/briefing' });
  expect(getAuthToken()).toMatch(/^mock-session-/);
});

test('mock 모드에서 작품을 열려다 로그인하면 그 작품으로 돌아간다', async () => {
  const router = renderAt('/books/takryu/read');
  await act(() => vi.dynamicImportSettled());
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));

  await userEvent.type(screen.getByLabelText('이메일'), 'reader@example.com');
  await userEvent.type(screen.getByLabelText('비밀번호'), 'secret-pass1');
  await userEvent.click(screen.getByRole('button', { name: '로그인' }));

  await waitFor(() => expect(router.state.location.pathname).toBe('/books/takryu/read'));
});

describe('MY에서 직접 로그아웃', () => {
  test('로그아웃하면 MY에 그대로 남아 비회원 카드로 바뀐다', async () => {
    setAuthToken('saved-session');
    setMockMember(true);
    const router = renderAt('/my');
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }));

    expect(getAuthToken()).toBeNull();
    expect(router.state.location.pathname).toBe('/my');
    expect(await screen.findByText('로그인하지 않은 상태예요')).toBeInTheDocument();
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
    ['/consent?next=%2Fmy', '/'],
  ])('%s → %s', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  test('홈으로 갈 때는 next 를 붙이지 않는다', () => {
    expect(loginPathFor('/')).toBe('/login');
    expect(loginPathFor('/my')).toBe('/login?next=%2Fmy');
  });
});
