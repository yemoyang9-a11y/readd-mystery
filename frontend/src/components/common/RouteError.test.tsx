import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import RouteError from './RouteError';

function routerWithFailingLazy(error: Error) {
  return createMemoryRouter(
    [
      {
        path: '/books/b/reader',
        lazy: () => Promise.reject(error),
        errorElement: <RouteError />,
      },
    ],
    { initialEntries: ['/books/b/reader'] }
  );
}

describe('RouteError — 화면 코드를 나눠 받다 실패했을 때', () => {
  test('배포 뒤 옛 파일을 못 받으면 새로고침 안내를 한국어로 보여 준다 (영어 기본 오류 화면 아님)', async () => {
    render(
      <RouterProvider
        router={routerWithFailingLazy(new TypeError('Failed to fetch dynamically imported module: /assets/Reader-abc.js'))}
      />
    );
    expect(await screen.findByText('새 버전이 나왔어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  });

  test('그 밖의 오류는 일반 안내와 새로고침·홈 버튼을 보여 준다', async () => {
    render(<RouterProvider router={routerWithFailingLazy(new Error('boom'))} />);
    expect(await screen.findByText('화면을 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '홈으로' })).toHaveAttribute('href', '/');
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  });
});
