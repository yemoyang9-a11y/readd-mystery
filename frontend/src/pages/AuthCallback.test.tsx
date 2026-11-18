import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import AuthCallback from './AuthCallback';
import { exchangeLoginCode, fetchMe } from '../services/authService';
import { getAuthToken } from '../utils/storage';
import { LOGIN_NEXT_STORAGE_KEY } from '../utils/authRedirect';
import { createAppRouter } from '../App';

vi.mock('../services/authService', () => ({ exchangeLoginCode: vi.fn(), fetchMe: vi.fn() }));

function Where({ label }: { label: string }) {
  const location = useLocation();
  return (
    <div>
      {label}
      <span data-testid="search">{location.search}</span>
      <span data-testid="state">{JSON.stringify(location.state)}</span>
    </div>
  );
}

function renderCallback(strict = false) {
  const tree = (
    <MemoryRouter initialEntries={['/auth/callback']}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<div>홈 화면</div>} />
        <Route path="/guide" element={<Where label="가이드 화면" />} />
        <Route path="/login" element={<div>로그인 화면</div>} />
        <Route path="/consent" element={<Where label="동의 화면" />} />
        <Route path="/books/:bookId/briefing" element={<Where label="작품 브리핑" />} />
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
    sessionStorage.clear();
    window.location.hash = '';
  });

  // 대표 지시 2026-11-18 — 작품을 열려다 카카오·구글로 로그인했으면 그 작품으로 돌아간다
  it('로그인 전에 남긴 가려던 주소로 돌아가고, 남긴 주소는 한 번 쓰면 지운다', async () => {
    window.location.hash = '#code=one-time';
    sessionStorage.setItem(LOGIN_NEXT_STORAGE_KEY, '/books/takryu/briefing');
    vi.mocked(exchangeLoginCode).mockResolvedValue({ token: 'jwt', display_name: '독자' });

    renderCallback();

    expect(await screen.findByText('작품 브리핑')).toBeInTheDocument();
    expect(sessionStorage.getItem(LOGIN_NEXT_STORAGE_KEY)).toBeNull();
  });

  it('카카오·구글 첫 로그인으로 약관 동의가 없으면 동의 화면으로 가려던 주소를 들고 간다', async () => {
    window.location.hash = '#code=one-time';
    sessionStorage.setItem(LOGIN_NEXT_STORAGE_KEY, '/books/takryu/briefing');
    vi.mocked(exchangeLoginCode).mockResolvedValue({ token: 'jwt', display_name: '독자' });
    vi.mocked(fetchMe).mockResolvedValue({
      display_name: '독자',
      providers: ['kakao'],
      onboarded: false,
      consent_required: true,
    });

    renderCallback();

    expect(await screen.findByText('동의 화면')).toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent(
      `?next=${encodeURIComponent('/books/takryu/briefing')}`
    );
  });

  it('가이드 전인 독자는 가려던 주소를 state 로 들고 가이드로 간다', async () => {
    window.location.hash = '#code=one-time';
    sessionStorage.setItem(LOGIN_NEXT_STORAGE_KEY, '/books/takryu/briefing');
    vi.mocked(exchangeLoginCode).mockResolvedValue({ token: 'jwt', display_name: '독자' });
    vi.mocked(fetchMe).mockResolvedValue({ display_name: '독자', providers: ['kakao'], onboarded: false });

    renderCallback();

    expect(await screen.findByText('가이드 화면')).toBeInTheDocument();
    expect(screen.getByTestId('state')).toHaveTextContent('{"next":"/books/takryu/briefing"}');
  });

  it('바깥 주소가 남아 있으면 따르지 않고 홈으로 간다', async () => {
    window.location.hash = '#code=one-time';
    sessionStorage.setItem(LOGIN_NEXT_STORAGE_KEY, '//evil.example');
    vi.mocked(exchangeLoginCode).mockResolvedValue({ token: 'jwt', display_name: '독자' });

    renderCallback();

    expect(await screen.findByText('홈 화면')).toBeInTheDocument();
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
