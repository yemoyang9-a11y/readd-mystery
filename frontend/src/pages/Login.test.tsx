import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import Login from './Login';
import { fetchMe, fetchProviders, login, signup, startLogin } from '../services/authService';
import { setAuthToken } from '../utils/storage';

vi.mock('../services/authService', () => ({
  fetchMe: vi.fn(),
  fetchProviders: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  startLogin: vi.fn(),
}));

function httpError(status?: number): AxiosError {
  return new AxiosError(
    'failed',
    status ? 'ERR_BAD_REQUEST' : 'ERR_NETWORK',
    undefined,
    null,
    status ? ({ status } as AxiosResponse) : undefined
  );
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function renderLogin(entry = '/login') {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <Login /> },
      { path: '*', element: <Where /> },
    ],
    { initialEntries: [entry] }
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function fill(label: string, value: string) {
  await userEvent.type(screen.getByLabelText(label), value);
}

describe('로그인·회원가입 화면 — 2026-11-18 대표 지시', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchProviders).mockReset().mockResolvedValue(['email']);
    vi.mocked(fetchMe).mockReset().mockResolvedValue({ display_name: '독자', providers: ['email'], onboarded: true });
    vi.mocked(login).mockReset().mockResolvedValue({ token: 't', display_name: '독자' });
    vi.mocked(signup).mockReset().mockResolvedValue({ token: 't', display_name: '독자', is_new: true });
    vi.mocked(startLogin).mockReset();
  });

  test('처음에는 로그인 탭이 선택돼 있고 이메일·비밀번호만 묻는다', () => {
    renderLogin();
    expect(screen.getByRole('tab', { name: '로그인' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
    expect(screen.queryByLabelText('닉네임')).toBeNull();
  });

  test('회원가입 탭으로 바꾸면 닉네임 칸이 생긴다', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('tab', { name: '회원가입' }));
    expect(screen.getByRole('tab', { name: '회원가입' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('닉네임')).toBeInTheDocument();
    // E2E #3 — 빈칸이어도 버튼은 눌린다. 누르면 칸마다 무엇이 빠졌는지 알린다
    expect(screen.getByRole('button', { name: '가입하기' })).toBeEnabled();
  });

  test('가입하면 입력값으로 signup을 부르고 첫 안내(/guide)로 간다', async () => {
    const router = renderLogin('/login?next=%2Fshelf');
    await userEvent.click(screen.getByRole('tab', { name: '회원가입' }));
    await fill('이메일', ' reader@example.com ');
    await fill('비밀번호', 'secret-pass');
    await fill('닉네임', '추리왕');
    await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/guide'));
    expect(signup).toHaveBeenCalledWith({ email: 'reader@example.com', password: 'secret-pass', displayName: '추리왕' });
    expect(router.state.location.state).toEqual({ next: '/shelf' });
  });

  test('비밀번호가 8자보다 짧으면 가입을 보내지 않고 안내한다', async () => {
    renderLogin('/login?mode=signup');
    await fill('이메일', 'reader@example.com');
    await fill('비밀번호', 'short');
    await fill('닉네임', '추리왕');
    await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('비밀번호는 8자 이상이에요');
    expect(screen.getByLabelText('비밀번호')).toHaveAttribute('aria-invalid', 'true');
    expect(signup).not.toHaveBeenCalled();
  });

  describe('E2E #3 — 빈칸·잘못된 값으로 누르면 칸 아래에 알린다', () => {
    test('가입 칸을 모두 비우고 누르면 세 칸 모두 알리고 첫 칸(이메일)으로 초점을 옮긴다', async () => {
      renderLogin('/login?mode=signup');
      const submit = screen.getByRole('button', { name: '가입하기' });
      expect(submit).toBeEnabled();
      await userEvent.click(submit);

      const email = screen.getByLabelText('이메일');
      const password = screen.getByLabelText('비밀번호');
      const name = screen.getByLabelText('닉네임');
      expect(email).toHaveAccessibleDescription('이메일을 입력해 주세요');
      expect(password).toHaveAccessibleDescription('비밀번호는 8자 이상이에요');
      expect(name).toHaveAccessibleDescription('닉네임을 입력해 주세요');
      for (const field of [email, password, name]) expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(email).toHaveFocus();
      expect(signup).not.toHaveBeenCalled();
    });

    test('이메일 형식이 틀리면 그 칸에 알리고, 맞는 칸은 알리지 않는다', async () => {
      renderLogin('/login?mode=signup');
      await fill('이메일', 'reader-at-example');
      await fill('비밀번호', 'secret-pass');
      await fill('닉네임', '추리왕');
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

      expect(screen.getByLabelText('이메일')).toHaveAccessibleDescription('올바른 이메일 형식이 아니에요');
      expect(screen.getByLabelText('이메일')).toHaveFocus();
      expect(screen.getByLabelText('비밀번호')).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText('닉네임')).not.toHaveAttribute('aria-invalid', 'true');
      expect(signup).not.toHaveBeenCalled();
    });

    test('앞 칸이 맞으면 처음 틀린 칸(닉네임)으로 초점을 옮긴다', async () => {
      renderLogin('/login?mode=signup');
      await fill('이메일', 'reader@example.com');
      await fill('비밀번호', 'secret-pass');
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

      expect(screen.getByLabelText('닉네임')).toHaveAccessibleDescription('닉네임을 입력해 주세요');
      expect(screen.getByLabelText('닉네임')).toHaveFocus();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    test('알림이 뜬 칸을 고치면 그 칸의 알림이 사라진다', async () => {
      renderLogin('/login?mode=signup');
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));
      await fill('이메일', 'reader@example.com');

      expect(screen.getByLabelText('이메일')).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByText('이메일을 입력해 주세요')).toBeNull();
      expect(screen.getByText('닉네임을 입력해 주세요')).toBeInTheDocument();
    });

    test('로그인 칸을 비우고 누르면 이메일 칸에 알리고 로그인을 보내지 않는다', async () => {
      renderLogin();
      const submit = screen.getByRole('button', { name: '로그인' });
      expect(submit).toBeEnabled();
      await userEvent.click(submit);

      expect(screen.getByLabelText('이메일')).toHaveAccessibleDescription('이메일을 입력해 주세요');
      expect(screen.getByLabelText('비밀번호')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByLabelText('이메일')).toHaveFocus();
      expect(login).not.toHaveBeenCalled();
    });

    test('탭을 바꾸면 앞 탭의 알림은 지운다', async () => {
      renderLogin('/login?mode=signup');
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));
      await userEvent.click(screen.getByRole('tab', { name: '로그인' }));

      expect(screen.queryAllByRole('alert')).toHaveLength(0);
    });
  });

  test('로그인하면 가려던 주소로 돌아간다', async () => {
    const router = renderLogin('/login?next=%2Fbooks%2Ftakryu%2Fbriefing');
    await fill('이메일', 'reader@example.com');
    await fill('비밀번호', 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/books/takryu/briefing'));
    expect(login).toHaveBeenCalledWith('reader@example.com', 'secret-pass');
  });

  test('첫 안내를 마치지 않은 계정은 로그인 뒤 /guide로 간다', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ display_name: '독자', providers: ['email'], onboarded: false });
    const router = renderLogin('/login?next=%2Fmy');
    await fill('이메일', 'reader@example.com');
    await fill('비밀번호', 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/guide'));
  });

  test('바깥 주소로는 돌려보내지 않는다', async () => {
    const router = renderLogin('/login?next=%2F%2Fevil.example');
    await fill('이메일', 'reader@example.com');
    await fill('비밀번호', 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  test.each([
    [409, 'signup', '이미 가입된 이메일이에요'],
    [401, 'login', '이메일 또는 비밀번호가 맞지 않아요'],
    [429, 'login', '시도가 너무 많아요. 잠시 후 다시 해 주세요'],
    [undefined, 'login', '연결하지 못했어요. 잠시 후 다시 해 주세요'],
  ] as const)('서버가 %s로 답하면 한국어로 알린다 (%s)', async (status, mode, message) => {
    const failure = httpError(status);
    vi.mocked(login).mockRejectedValue(failure);
    vi.mocked(signup).mockRejectedValue(failure);
    const router = renderLogin(mode === 'signup' ? '/login?mode=signup' : '/login');
    await fill('이메일', 'reader@example.com');
    await fill('비밀번호', 'secret-pass');
    if (mode === 'signup') await fill('닉네임', '추리왕');
    await userEvent.click(screen.getByRole('button', { name: mode === 'signup' ? '가입하기' : '로그인' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(router.state.location.pathname).toBe('/login');
  });

  test('서버가 OAuth를 알려 주지 않으면 구글·카카오 버튼이 없다', async () => {
    renderLogin();
    await waitFor(() => expect(fetchProviders).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /구글|카카오/ })).toBeNull();
  });

  test('서버가 알려 준 OAuth만 버튼으로 보이고 누르면 그 제공자로 로그인한다', async () => {
    vi.mocked(fetchProviders).mockResolvedValue(['email', 'kakao']);
    renderLogin();
    await userEvent.click(await screen.findByRole('button', { name: '카카오로 계속하기' }));
    expect(startLogin).toHaveBeenCalledWith('kakao');
    expect(screen.queryByRole('button', { name: '구글로 계속하기' })).toBeNull();
  });

  test('이미 로그인한 상태로 열면 가려던 주소로 바로 간다', async () => {
    setAuthToken('saved');
    const router = renderLogin('/login?next=%2Fshelf');
    await waitFor(() => expect(router.state.location.pathname).toBe('/shelf'));
  });
});
