import { act, render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from '../App';
import { ADMIN_TOKEN_KEY } from './adminApi';

beforeEach(() => {
  localStorage.setItem(ADMIN_TOKEN_KEY, 't'.repeat(40));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('관리자 /admin/community 경로가 커뮤니티 신고 화면을 연다 (NotFound 아님)', async () => {
  window.history.pushState({}, '', '/admin/community');
  render(<RouterProvider router={createAppRouter(false)} />);
  await act(() => vi.dynamicImportSettled());
  expect(await screen.findByRole('heading', { name: '커뮤니티 신고' })).toBeInTheDocument();
});
