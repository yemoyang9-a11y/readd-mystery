import { act, render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from './App';
import { setAuthToken } from './utils/storage';

// 2026-11-18 로그인 관문 — 앱 화면 테스트는 로그인한 독자로 시작한다 (앱이 토큰을 저장하는 방식 그대로)
beforeEach(() => setAuthToken('test-session-token'));
afterEach(() => localStorage.clear());

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => window.history.pushState({}, '', '/books/takryu/read'));

test('모바일 기기면 읽기 라우트에 모바일 읽기 화면을 그린다', async () => {
  render(<RouterProvider router={createAppRouter(true)} />);
  // 첫 동적 import의 변환 시간을 DOM 조회의 기본 1초 제한에 포함하지 않는다.
  await act(() => vi.dynamicImportSettled());
  expect(await screen.findByTestId('mobile-reader')).toBeInTheDocument();
});

test('모바일 기기가 아니면 PC 읽기 화면을 그린다', async () => {
  render(<RouterProvider router={createAppRouter(false)} />);
  await act(() => vi.dynamicImportSettled());
  expect(await screen.findByRole('article')).toBeInTheDocument();
  expect(screen.queryByTestId('mobile-reader')).not.toBeInTheDocument();
});
