import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthCallback from './AuthCallback';
import { exchangeLoginCode, fetchMe } from '../services/authService';
import { getAuthToken } from '../utils/storage';
import { createAppRouter } from '../App';

vi.mock('../services/authService', () => ({ exchangeLoginCode: vi.fn(), fetchMe: vi.fn() }));

function renderCallback(strict = false) {
  const tree = (
    <MemoryRouter initialEntries={['/auth/callback']}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<div>홈 화면</div>} />
        <Route path="/guide" element={<div>가이드 화면</div>} />
        <Route path="/login" element={<div>로그인 화면</div>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('AuthCallback', () => {
  beforeEach(() => {
    vi.mocked(exchangeLoginCode).mockReset();
    vi.mocked(fetchMe).mockReset();
    vi.mocked(fetchMe).mockResolvedValue({ display_name: '독자', providers: ['kakao'], onboarded: true });
    localStorage.clear();
    window.location.hash = '';
  });

  it('1회용 코드를 교환해 토큰을 저장하고, 가이드를 마친 독자는 홈으로 보낸다', async () => {
    window.location.hash = '#code=one-time';
    vi.mocked(exchangeLoginCode).mockResolvedValue({ token: 'jwt', display_name: '독자' });

    renderCallback();

    expect(await screen.findByText('홈 화면')).toBeInTheDocument();
    expect(exchangeLoginCode).toHaveBeenCalledWith('one-time');
    expect(getAuthToken()).toBe('jwt');
  });

  it('카카오·구글로 처음 로그인한 독자(가이드 전)는 이용 가이드로 보낸다', async () => {
    window.location.hash = '#code=one-time';
    vi.mocked(exchangeLoginCode).mockResolvedValue({ token: 'jwt', display_name: '독자' });
    vi.mocked(fetchMe).mockResolvedValue({ display_name: '독자', providers: ['kakao'], onboarded: false });

    renderCallback();

    expect(await screen.findByText('가이드 화면')).toBeInTheDocument();
  });

  it('StrictMode에서도 1회용 코드를 한 번만 교환한다', async () => {
    window.location.hash = '#code=one-time';
    vi.mocked(exchangeLoginCode).mockResolvedValue({ token: 'jwt', display_name: '독자' });

    renderCallback(true);

    expect(await screen.findByText('홈 화면')).toBeInTheDocument();
    expect(exchangeLoginCode).toHaveBeenCalledTimes(1);
  });

  it('제공자 화면에서 취소하고 돌아오면 오류 화면이 아니라 로그인 화면으로 돌아와 로그인 전 상태를 유지한다', async () => {
    window.location.hash = '#error=cancelled';

    renderCallback();

    expect(await screen.findByText('로그인 화면')).toBeInTheDocument();
    expect(exchangeLoginCode).not.toHaveBeenCalled();
    expect(getAuthToken()).toBeNull();
  });

  it('코드 교환이 실패하면 로그인 화면으로 돌아와 로그인 전 상태를 유지한다', async () => {
    window.location.hash = '#code=expired';
    vi.mocked(exchangeLoginCode).mockRejectedValue(new Error('invalid code'));

    renderCallback();

    expect(await screen.findByText('로그인 화면')).toBeInTheDocument();
    await waitFor(() => expect(getAuthToken()).toBeNull());
  });

  it('/auth/callback 경로가 앱 라우터에 등록돼 있다', () => {
    expect(createAppRouter(false).routes.some((r) => r.path === '/auth/callback')).toBe(true);
    expect(createAppRouter(true).routes.some((r) => r.path === '/auth/callback')).toBe(true);
  });
});
