import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MobileHome from './MobileHome';

vi.mock('../../hooks/useCatalog', () => ({
  useCatalog: () => ({ books: [], status: 'ready', reload: () => {} }),
}));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<MobileHome />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

function swipe(dx: number) {
  const stage = screen.getByTestId('book-carousel');
  const pointer = (type: string, x: number) =>
    fireEvent(stage, new PointerEvent(type, { pointerId: 1, isPrimary: true, bubbles: true, clientX: x, clientY: 0 }));
  pointer('pointerdown', 200);
  pointer('pointermove', 200 + dx);
  pointer('pointerup', 200 + dx);
}

const hook = () => screen.getByTestId('home-hook');

describe('모바일 홈 3D 책 캐러셀', () => {
  test('첫 책은 가상범인이고 작품 보기가 브리핑 화면으로 이어진다', () => {
    renderHome();
    expect(screen.getByRole('heading', { name: '홈' })).toBeInTheDocument();
    expect(hook()).toHaveTextContent('경성의 극장, 해왕좌.');
    expect(screen.getByRole('link', { name: '작품 보기' })).toHaveAttribute('href', '/books/bk-95898cdf13/briefing');
  });

  test('다음 책·이전 책 버튼으로 넘기면 손글씨 문구가 즉시 바뀌고 세 권이 돌아간다', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: '다음 책' }));
    expect(hook()).toHaveTextContent('추리잡지 《괴인》의 현상모집.');
    await user.click(screen.getByRole('button', { name: '다음 책' }));
    expect(hook()).toHaveTextContent('한강 건너 명수대의 밤.');
    await user.click(screen.getByRole('button', { name: '다음 책' }));
    expect(hook()).toHaveTextContent('경성의 극장, 해왕좌.');
    await user.click(screen.getByRole('button', { name: '이전 책' }));
    expect(hook()).toHaveTextContent('한강 건너 명수대의 밤.');
  });

  test('좌우로 밀어도 책이 넘어간다', () => {
    renderHome();
    swipe(-80);
    expect(hook()).toHaveTextContent('추리잡지 《괴인》의 현상모집.');
    swipe(80);
    expect(hook()).toHaveTextContent('경성의 극장, 해왕좌.');
  });

  test('짧게 끌면 넘어가지 않는다', () => {
    renderHome();
    swipe(-20);
    expect(hook()).toHaveTextContent('경성의 극장, 해왕좌.');
  });

  test('옆 책을 누르면 그 책으로 넘어가고 이동은 하지 않는다', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: '타원형의 거울 보기' }));
    expect(hook()).toHaveTextContent('상금은 삼백 원.');
    expect(screen.queryByTestId('where')).toBeNull();
  });

  test('곧 공개 책은 작품 보기 대신 곧 공개 표시만 있고 눌러도 열리지 않는다', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: '마인 보기' }));
    expect(screen.queryByRole('link', { name: '작품 보기' })).toBeNull();
    expect(screen.getByText('곧 공개', { selector: 'p' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '마인, 곧 공개' }));
    expect(screen.queryByTestId('where')).toBeNull();
    expect(hook()).toHaveTextContent('가면 아래, 죄악이 시작된다.');
  });

  test('가운데 공개 책을 누르면 브리핑 화면으로 간다', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: '가상범인 작품 보기' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/books/bk-95898cdf13/briefing');
  });

  test('작품 보기 버튼은 손글씨 문구 아래 남는 공간을 밀어내고 화면 아래쪽에 붙는다', () => {
    renderHome();
    const cta = screen.getByTestId('home-cta');
    expect(cta).toHaveClass('mt-auto');
    expect(cta.contains(screen.getByRole('link', { name: '작품 보기' }))).toBe(true);
    expect(hook().compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('키보드 화살표로 넘기고 활성 책을 읽어 주는 영역이 갱신된다', async () => {
    const user = userEvent.setup();
    renderHome();
    screen.getByTestId('book-carousel').focus();
    await user.keyboard('{ArrowRight}');
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('2번째 책, 총 3권. 타원형의 거울, 곧 공개');
  });

  test('표지는 webp 이미지만 쓰고 제목·저자 글자를 덧씌우지 않는다', () => {
    renderHome();
    const covers = screen.getByTestId('book-carousel').querySelectorAll('.b3d-front');
    expect([...covers].map((face) => face.querySelector('img')?.getAttribute('src'))).toEqual([
      '/covers/gasangbeomin.webp',
      '/covers/tawonhyeong.webp',
      '/covers/main.webp',
    ]);
    covers.forEach((face) => expect(face.textContent).toBe(''));
  });
});
