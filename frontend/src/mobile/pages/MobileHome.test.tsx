import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import MobileHome from './MobileHome';

const catalog = vi.hoisted(() => ({ books: [] as unknown[] }));
const briefingApi = vi.hoisted(() => ({ fetchBriefing: vi.fn() }));

vi.mock('../../hooks/useCatalog', () => ({
  useCatalog: () => ({ books: catalog.books, status: 'ready', reload: () => {} }),
}));

vi.mock('../../services/recapService', () => briefingApi);

beforeEach(() => {
  catalog.books = [];
  briefingApi.fetchBriefing.mockReset();
  briefingApi.fetchBriefing.mockRejectedValue(new Error('no briefing in this test'));
});

const readingBook = {
  book_id: 'bk-95898cdf13',
  title: '가상범인',
  author: '김내성',
  cover_url: '/covers/gasangbeomin.webp',
  intro_summary: null,
  ssabi_ready: true,
  genre: '미스터리',
  registered_at: '2026-11-01',
  progress: { current_page: 13, percent: 19.1, is_complete: false, last_read_at: '2026-11-17T00:00:00Z' },
};

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

  test('책 넘기기 버튼은 배경 없는 얇은 꺾쇠(C안, 2026-11-18 대표 선택) — 누르는 영역은 높이 44px 유지', () => {
    renderHome();
    for (const name of ['이전 책', '다음 책']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).not.toMatch(/\bbg-white|backdrop-blur|rounded-full/);
      expect(button.className).toMatch(/\bh-11\b/);
    }
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

  // 대표 지시 2026-11-19 — 왼쪽 위 RE:ADD 워드마크(명조), 오른쪽 위 작은 이어서 읽기. 큰 이어 읽기 카드는 없앤다
  test('홈 머리 줄 왼쪽 위에 명조 RE:ADD 워드마크가 있다', () => {
    renderHome();
    const head = screen.getByTestId('home-head');
    const mark = within(head).getByText('RE:ADD');
    expect(mark).toBe(screen.getByTestId('home-wordmark'));
    expect(mark.className).toContain('font-dashSerif');
    expect(head.firstElementChild).toBe(mark);
  });

  test('FR-BRF-001: 읽던 책이 없으면 이어서 읽기 버튼이 0개다', () => {
    catalog.books = [{ ...readingBook, progress: undefined }];
    renderHome();
    expect(screen.queryByTestId('home-continue')).toBeNull();
    expect(screen.queryByRole('link', { name: /이어서 읽기/ })).toBeNull();
    expect(briefingApi.fetchBriefing).not.toHaveBeenCalled();
  });

  test('FR-BRF-001: 읽던 책이 있으면 머리 줄 오른쪽에 작은 이어서 읽기 버튼 1개 — 누르면 그 책 브리핑', async () => {
    const user = userEvent.setup();
    catalog.books = [readingBook];
    renderHome();
    const links = screen.getAllByRole('link', { name: /이어서 읽기/ });
    expect(links).toHaveLength(1);
    const button = links[0];
    expect(button).toBe(screen.getByTestId('home-continue'));
    // 머리 줄의 마지막(오른쪽) 칸, 워드마크와 같은 줄
    const head = screen.getByTestId('home-head');
    expect(head.lastElementChild).toBe(button);
    expect(head.className).toMatch(/\bjustify-between\b/);
    // 작게: 표지·진도 바 없음, 누르는 높이 44px 유지
    expect(within(button).queryByRole('img')).toBeNull();
    expect(within(button).queryByRole('progressbar')).toBeNull();
    expect(button.className).toMatch(/\bmin-h-11\b/);
    expect(button).toHaveTextContent('이어서 읽기');
    expect(button).toHaveTextContent('가상범인');
    // FR-BRF-005 🚦 — 퍼센트 글자를 쓰지 않는다. 쪽은 서버 값 그대로 이름에만
    expect(button.textContent).not.toContain('%');
    expect(button).toHaveAccessibleName('이어서 읽기, 가상범인, 13p');
    expect(screen.queryByTestId('home-continue-card')).toBeNull();
    await user.click(button);
    expect(screen.getByTestId('where')).toHaveTextContent('/books/bk-95898cdf13/briefing');
  });

  test('책마다 책등에 제목이 있다', () => {
    renderHome();
    const spines = [...screen.getByTestId('book-carousel').querySelectorAll('.b3d-spine')];
    expect(spines.map((spine) => spine.textContent)).toEqual(['가상범인', '타원형의 거울', '마인']);
  });

  test('입체 책 상자에는 filter·opacity를 걸지 않는다 — 면마다 변수로만 어둡게·숨긴다', () => {
    renderHome();
    const books = screen.getByTestId('book-carousel').querySelectorAll<HTMLElement>('.b3d-book');
    expect(books).toHaveLength(3);
    books.forEach((book) => {
      expect(book.style.filter).toBe('');
      expect(book.style.opacity).toBe('');
      expect(book.getAttribute('style')).not.toMatch(/filter|opacity(?!-)/);
      expect(book.style.getPropertyValue('--b3d-b')).not.toBe('');
      expect(book.style.getPropertyValue('--b3d-o')).not.toBe('');
      // 앞·뒤·책등·종이·윗면
      expect(book.querySelectorAll('.b3d-face')).toHaveLength(5);
    });
  });

  test('가운데 책은 환하고 옆 책은 어둡고, 책을 넘기면 가운데가 바뀐다', async () => {
    const user = userEvent.setup();
    renderHome();
    const bookOf = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });
    expect(bookOf('가상범인').style.getPropertyValue('--b3d-b')).toBe('1');
    expect(bookOf('타원형의 거울').style.getPropertyValue('--b3d-b')).toBe('0.45');
    await user.click(screen.getByRole('button', { name: '다음 책' }));
    expect(bookOf('타원형의 거울').style.getPropertyValue('--b3d-b')).toBe('1');
    expect(bookOf('가상범인').style.getPropertyValue('--b3d-b')).toBe('0.45');
  });

  test('제목은 26px 굵게 흰색이다', () => {
    renderHome();
    const title = screen.getByText('가상범인', { selector: 'b' });
    expect(title.className).toContain('text-[26px]');
    expect(title.className).toContain('font-extrabold');
    expect(title.className).toContain('text-white');
  });
});

describe('이어서 읽기 버튼은 머리 줄 안에 있어 입체 책 영역을 줄이지 않는다', () => {
  const original = { w: window.innerWidth, h: window.innerHeight };
  function screenSize(w: number, h: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  }
  const stageHeight = () => parseFloat(screen.getByTestId('book-carousel').style.height);
  afterEach(() => screenSize(original.w, original.h));

  test('390×664에서 읽던 책이 있어도 입체 책 영역 높이가 같다', () => {
    screenSize(390, 664);
    catalog.books = [];
    const { unmount } = renderHome();
    const without = stageHeight();
    unmount();

    catalog.books = [readingBook];
    renderHome();
    expect(screen.getByTestId('home-continue')).toBeInTheDocument();
    expect(stageHeight()).toBe(without);
    expect(without).toBeCloseTo(300 * (664 / 760), 5);
  });
});
