import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import Login from './Login';
import { fetchMe, fetchProviders, login, signup, startLogin } from '../services/authService';
import { setAuthToken } from '../utils/storage';
import { LOGIN_NEXT_STORAGE_KEY } from '../utils/authRedirect';

vi.mock('../services/authService', () => ({
  fetchMe: vi.fn(),
  fetchProviders: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  startLogin: vi.fn(),
}));

const ALL_CONSENTS = { terms: true, privacy: true, age14: true, marketing: false };

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

/** 가입 칸을 모두 맞게 채운다. 약관은 따로 고른다 */
async function fillSignupFields(password = 'secret-pass1') {
  await fill('이메일', 'reader@example.com');
  await fill('비밀번호', password);
  await fill('비밀번호 확인', password);
  await fill('닉네임', '추리왕');
}

async function agreeRequired() {
  for (const name of ['[필수] 이용약관 동의', '[필수] 개인정보 수집·이용 동의', '[필수] 만 14세 이상입니다']) {
    await userEvent.click(screen.getByRole('checkbox', { name }));
  }
}

describe('로그인·회원가입 화면 — 2026-11-18 대표 지시', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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

  test('회원가입 탭으로 바꾸면 조사로 정한 칸(이메일·비밀번호·비밀번호 확인·닉네임)과 약관 묶음이 생긴다', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('tab', { name: '회원가입' }));
    expect(screen.getByRole('tab', { name: '회원가입' })).toHaveAttribute('aria-selected', 'true');
    for (const label of ['이메일', '비밀번호', '비밀번호 확인', '닉네임']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    for (const name of [
      '전체 동의',
      '[필수] 이용약관 동의',
      '[필수] 개인정보 수집·이용 동의',
      '[필수] 만 14세 이상입니다',
      '[선택] 마케팅 정보 수신 동의',
    ]) {
      expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
    }
    // E2E #3 — 빈칸이어도 버튼은 눌린다. 누르면 칸마다 무엇이 빠졌는지 알린다
    expect(screen.getByRole('button', { name: '가입하기' })).toBeEnabled();
  });

  test('로그인 탭에는 약관 묶음과 비밀번호 확인이 없다', () => {
    renderLogin();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByLabelText('비밀번호 확인')).toBeNull();
  });

  test('가입하면 입력값과 약관 동의로 signup을 부르고 첫 안내(/guide)로 간다', async () => {
    const router = renderLogin('/login?next=%2Fbooks%2Ftakryu%2Fbriefing');
    await userEvent.click(screen.getByRole('tab', { name: '회원가입' }));
    await fill('이메일', ' reader@example.com ');
    await fill('비밀번호', 'secret-pass1');
    await fill('비밀번호 확인', 'secret-pass1');
    await fill('닉네임', '추리왕');
    await userEvent.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/guide'));
    expect(signup).toHaveBeenCalledWith({
      email: 'reader@example.com',
      password: 'secret-pass1',
      displayName: '추리왕',
      consents: { ...ALL_CONSENTS, marketing: true },
    });
    expect(router.state.location.state).toEqual({ next: '/books/takryu/briefing' });
  });

  describe('약관 동의 — 대표 지시 2026-11-18', () => {
    test('필수 약관에 동의하지 않고 가입을 누르면 버튼 위에 알리고 보내지 않는다', async () => {
      renderLogin('/login?mode=signup');
      await fillSignupFields();
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('필수 약관에 모두 동의해 주세요');
      expect(screen.getByRole('checkbox', { name: '[필수] 이용약관 동의' })).toHaveFocus();
      expect(signup).not.toHaveBeenCalled();
    });

    test('필수 하나만 빠져도 보내지 않고 빠진 줄로 초점을 옮긴다', async () => {
      renderLogin('/login?mode=signup');
      await fillSignupFields();
      await userEvent.click(screen.getByRole('checkbox', { name: '[필수] 이용약관 동의' }));
      await userEvent.click(screen.getByRole('checkbox', { name: '[필수] 개인정보 수집·이용 동의' }));
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('필수 약관에 모두 동의해 주세요');
      expect(screen.getByRole('checkbox', { name: '[필수] 만 14세 이상입니다' })).toHaveFocus();
      expect(signup).not.toHaveBeenCalled();
    });

    test('필수 셋만 동의하면 마케팅 없이 가입한다', async () => {
      renderLogin('/login?mode=signup');
      await fillSignupFields();
      await agreeRequired();
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

      await waitFor(() => expect(signup).toHaveBeenCalledTimes(1));
      expect(vi.mocked(signup).mock.calls[0][0].consents).toEqual(ALL_CONSENTS);
    });

    test('전체 동의는 다섯 줄을 한 번에 켜고 끄며, 하나를 끄면 전체 동의도 꺼진다', async () => {
      renderLogin('/login?mode=signup');
      const all = screen.getByRole('checkbox', { name: '전체 동의' });
      await userEvent.click(all);
      for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();

      await userEvent.click(screen.getByRole('checkbox', { name: '[선택] 마케팅 정보 수신 동의' }));
      expect(all).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: '[필수] 이용약관 동의' })).toBeChecked();

      await userEvent.click(screen.getByRole('checkbox', { name: '[선택] 마케팅 정보 수신 동의' }));
      expect(all).toBeChecked();
      await userEvent.click(all);
      for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    });

    test('필수 약관에 동의하면 버튼 위 알림이 사라진다', async () => {
      renderLogin('/login?mode=signup');
      await fillSignupFields();
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));
      expect(screen.getByText('필수 약관에 모두 동의해 주세요')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('checkbox', { name: '전체 동의' }));
      expect(screen.queryByText('필수 약관에 모두 동의해 주세요')).toBeNull();
    });

    test('서버가 CONSENT_REQUIRED(400)로 답해도 같은 문구로 알린다', async () => {
      const failure = httpError(400);
      (failure.response as AxiosResponse).data = { error: 'CONSENT_REQUIRED', missing: ['age14'] };
      vi.mocked(signup).mockRejectedValue(failure);
      renderLogin('/login?mode=signup');
      await fillSignupFields();
      await userEvent.click(screen.getByRole('checkbox', { name: '전체 동의' }));
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('필수 약관에 모두 동의해 주세요');
    });

    test.each([
      ['이용약관', '이용약관 (초안)'],
      ['개인정보 수집·이용', '개인정보 수집·이용 동의 (초안)'],
      ['만 14세 이상 확인', '만 14세 이상 확인 (초안)'],
      ['마케팅 정보 수신', '마케팅 정보 수신 동의 (초안)'],
    ])('%s 보기를 누르면 초안 문서가 시트로 열리고 닫으면 보기 버튼으로 돌아간다', async (name, title) => {
      renderLogin('/login?mode=signup');
      const open = screen.getByRole('button', { name: `${name} 보기` });
      await userEvent.click(open);

      const sheet = screen.getByRole('dialog', { name: title });
      expect(sheet).toHaveAttribute('aria-modal', 'true');
      await userEvent.click(within(sheet).getByRole('button', { name: '닫기' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(open).toHaveFocus();
    });

    test('약관 시트는 Esc로도 닫힌다', async () => {
      renderLogin('/login?mode=signup');
      await userEvent.click(screen.getByRole('button', { name: '이용약관 보기' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('비밀번호 규칙 — 8자 이상, 영문·숫자 포함', () => {
    test('규칙 세 가지를 칸 아래에 보이고, 맞으면 맞음으로 바뀐다', async () => {
      renderLogin('/login?mode=signup');
      const rules = screen.getByRole('list', { name: '비밀번호 규칙' });
      const met = () => within(rules).getAllByRole('listitem').map((li) => li.getAttribute('data-met'));
      expect(within(rules).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        expect.stringContaining('8자 이상'),
        expect.stringContaining('영문'),
        expect.stringContaining('숫자'),
      ]);
      expect(met()).toEqual(['false', 'false', 'false']);
      await fill('비밀번호', 'abc');
      expect(met()).toEqual(['false', 'true', 'false']);
      await fill('비밀번호', 'defgh1');
      expect(met()).toEqual(['true', 'true', 'true']);
    });

    test.each([
      ['short1a', '비밀번호는 8자 이상이에요'],
      ['onlyletters', '영문과 숫자를 모두 넣어 주세요'],
      ['1234567890', '영문과 숫자를 모두 넣어 주세요'],
    ])('%s 는 가입을 보내지 않고 안내한다', async (password, message) => {
      renderLogin('/login?mode=signup');
      await fillSignupFields(password);
      await agreeRequired();
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

      expect(screen.getByLabelText('비밀번호')).toHaveAccessibleDescription(message);
      expect(screen.getByLabelText('비밀번호')).toHaveAttribute('aria-invalid', 'true');
      expect(signup).not.toHaveBeenCalled();
    });

    test('비밀번호 확인이 다르면 그 칸에 알리고 보내지 않는다', async () => {
      renderLogin('/login?mode=signup');
      await fill('이메일', 'reader@example.com');
      await fill('비밀번호', 'secret-pass1');
      await fill('비밀번호 확인', 'secret-pass2');
      await fill('닉네임', '추리왕');
      await agreeRequired();
      await userEvent.click(screen.getByRole('button', { name: '가입하기' }));

      expect(screen.getByLabelText('비밀번호 확인')).toHaveAccessibleDescription('비밀번호가 일치하지 않아요');
      expect(screen.getByLabelText('비밀번호 확인')).toHaveFocus();
      expect(signup).not.toHaveBeenCalled();
    });

    test('로그인에는 가입 규칙을 적용하지 않는다(규칙 전 가입자 보호)', async () => {
      renderLogin();
      await fill('이메일', 'reader@example.com');
      await fill('비밀번호', 'oldpass');
      await userEvent.click(screen.getByRole('button', { name: '로그인' }));
      await waitFor(() => expect(login).toHaveBeenCalledWith('reader@example.com', 'oldpass'));
    });
  });

  test('닫기 버튼이 있고, 앞 화면이 없으면 홈으로 간다', async () => {
    const router = renderLogin('/login?next=%2Fbooks%2Ftakryu%2Fread');
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  test('OAuth 버튼을 누르면 가려던 주소를 이 탭에 남기고 제공자로 간다', async () => {
    vi.mocked(fetchProviders).mockResolvedValue(['email', 'kakao']);
    renderLogin('/login?next=%2Fbooks%2Ftakryu%2Fbriefing');
    await userEvent.click(await screen.findByRole('button', { name: '카카오로 계속하기' }));
    expect(sessionStorage.getItem(LOGIN_NEXT_STORAGE_KEY)).toBe('/books/takryu/briefing');
    expect(startLogin).toHaveBeenCalledWith('kakao');
  });

  test('약관 동의가 없는 계정으로 로그인하면 가려던 주소를 들고 동의 화면으로 간다', async () => {
    vi.mocked(fetchMe).mockResolvedValue({
      display_name: '독자',
      providers: ['email'],
      onboarded: true,
      consent_required: true,
    });
    const router = renderLogin('/login?next=%2Fbooks%2Ftakryu%2Fread');
    await fill('이메일', 'reader@example.com');
    await fill('비밀번호', 'secret-pass1');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/consent'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/books/takryu/read')}`);
  });

  describe('E2E #3 — 빈칸·잘못된 값으로 누르면 칸 아래에 알린다', () => {
    test('가입 칸을 모두 비우고 누르면 네 칸 모두 알리고 첫 칸(이메일)으로 초점을 옮긴다', async () => {
      renderLogin('/login?mode=signup');
      const submit = screen.getByRole('button', { name: '가입하기' });
      expect(submit).toBeEnabled();
      await userEvent.click(submit);

      const email = screen.getByLabelText('이메일');
      const password = screen.getByLabelText('비밀번호');
      const confirm = screen.getByLabelText('비밀번호 확인');
      const name = screen.getByLabelText('닉네임');
      expect(email).toHaveAccessibleDescription('이메일을 입력해 주세요');
      expect(password).toHaveAccessibleDescription('비밀번호는 8자 이상이에요');
      expect(confirm).toHaveAccessibleDescription('비밀번호를 한 번 더 입력해 주세요');
      expect(name).toHaveAccessibleDescription('닉네임을 입력해 주세요');
      for (const field of [email, password, confirm, name]) expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(email).toHaveFocus();
      expect(signup).not.toHaveBeenCalled();
    });

    test('이메일 형식이 틀리면 그 칸에 알리고, 맞는 칸은 알리지 않는다', async () => {
      renderLogin('/login?mode=signup');
      await fill('이메일', 'reader-at-example');
      await fill('비밀번호', 'secret-pass1');
      await fill('비밀번호 확인', 'secret-pass1');
      await fill('닉네임', '추리왕');
      await agreeRequired();
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
      await fill('비밀번호', 'secret-pass1');
      await fill('비밀번호 확인', 'secret-pass1');
      await agreeRequired();
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
    await fill('비밀번호', 'secret-pass1');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/books/takryu/briefing'));
    expect(login).toHaveBeenCalledWith('reader@example.com', 'secret-pass1');
  });

  test('첫 안내를 마치지 않은 계정은 로그인 뒤 /guide로 간다', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ display_name: '독자', providers: ['email'], onboarded: false });
    const router = renderLogin('/login?next=%2Fmy');
    await fill('이메일', 'reader@example.com');
    await fill('비밀번호', 'secret-pass1');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/guide'));
  });

  test('바깥 주소로는 돌려보내지 않는다', async () => {
    const router = renderLogin('/login?next=%2F%2Fevil.example');
    await fill('이메일', 'reader@example.com');
    await fill('비밀번호', 'secret-pass1');
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
    await fill('비밀번호', 'secret-pass1');
    if (mode === 'signup') {
      await fill('비밀번호 확인', 'secret-pass1');
      await fill('닉네임', '추리왕');
      await agreeRequired();
    }
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
