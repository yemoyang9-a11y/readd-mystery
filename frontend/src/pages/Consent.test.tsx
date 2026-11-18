import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import Consent from './Consent';
import { agreeConsents, fetchMe } from '../services/authService';
import { getAuthToken, setAuthToken } from '../utils/storage';

vi.mock('../services/authService', () => ({ agreeConsents: vi.fn(), fetchMe: vi.fn() }));

function Where() {
  const location = useLocation();
  return (
    <p data-testid="where">
      {location.pathname}
      {JSON.stringify(location.state)}
    </p>
  );
}

function renderConsent(entry = '/consent?next=%2Fbooks%2Ftakryu%2Fbriefing') {
  const router = createMemoryRouter(
    [
      { path: '/consent', element: <Consent /> },
      { path: '*', element: <Where /> },
    ],
    { initialEntries: [entry] }
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** 카카오·구글 첫 로그인 뒤 약관 동의 — 대표 지시 2026-11-18 (조사: research-2026-11-18-signup-fields.md 4장) */
describe('약관 동의 화면', () => {
  beforeEach(() => {
    localStorage.clear();
    setAuthToken('oauth-session');
    vi.mocked(agreeConsents).mockReset().mockResolvedValue(undefined);
    vi.mocked(fetchMe)
      .mockReset()
      .mockResolvedValue({ display_name: '독자', providers: ['kakao'], onboarded: true, consent_required: false });
  });

  test('가입 화면과 같은 약관 묶음을 보여 준다', () => {
    renderConsent();
    expect(screen.getByRole('heading', { level: 1, name: '약관 동의' })).toBeInTheDocument();
    for (const name of [
      '전체 동의',
      '[필수] 이용약관 동의',
      '[필수] 개인정보 수집·이용 동의',
      '[필수] 만 14세 이상입니다',
      '[선택] 마케팅 정보 수신 동의',
    ]) {
      expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
    }
  });

  test('필수 동의 없이 누르면 버튼 위에 알리고 서버에 보내지 않는다', async () => {
    renderConsent();
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('필수 약관에 모두 동의해 주세요');
    expect(agreeConsents).not.toHaveBeenCalled();
  });

  test('동의하면 저장하고 가려던 작품으로 간다', async () => {
    const router = renderConsent();
    await userEvent.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/books/takryu/briefing'));
    expect(agreeConsents).toHaveBeenCalledWith({ terms: true, privacy: true, age14: true, marketing: true });
  });

  test('첫 안내 전 계정이면 동의 뒤 가려던 주소를 들고 첫 안내로 간다', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ display_name: '독자', providers: ['kakao'], onboarded: false });
    const router = renderConsent();
    await userEvent.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/guide'));
    expect(router.state.location.state).toEqual({ next: '/books/takryu/briefing' });
  });

  test('저장에 실패하면 알리고 이 화면에 남는다', async () => {
    vi.mocked(agreeConsents).mockRejectedValue(new Error('network'));
    const router = renderConsent();
    await userEvent.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await userEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요. 다시 해 주세요');
    expect(router.state.location.pathname).toBe('/consent');
  });

  test('닫으면 동의하지 않은 채로 로그아웃하고 홈으로 간다', async () => {
    const router = renderConsent();
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(getAuthToken()).toBeNull();
    expect(agreeConsents).not.toHaveBeenCalled();
  });

  test('로그인하지 않았으면 로그인 화면으로 보낸다', async () => {
    localStorage.clear();
    const router = renderConsent();
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
