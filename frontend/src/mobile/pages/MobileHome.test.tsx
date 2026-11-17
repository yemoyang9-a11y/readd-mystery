import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MobileHome from './MobileHome';
import type { BriefingResponse } from '../../types';

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

const serverBriefing: BriefingResponse = {
  applied_cutoff: 13,
  recap: null,
  // 기준점의 장(3장)과 이어 읽기 위치의 장(2장)이 다른 독자 — 되돌아가 읽는 중
  current_chapter: { chapter_no: 3, title: '지문' },
  resume_chapter: { chapter_no: 2, title: '해왕좌의 밤' },
  progress: { current_page: 13, total_pages: 68, percent: 19.1 },
  last_read_at: null,
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

  // 2026-11-17 대표 결정 — 작은 "이어서 읽기 · 13p" 버튼 자리를 큰 이어 읽기 카드가 대신한다
  test('FR-BRF-005: 이어서 읽기 카드에는 퍼센트 글자 대신 마지막으로 펼친 쪽이 p로 보인다', async () => {
    catalog.books = [readingBook];
    briefingApi.fetchBriefing.mockResolvedValue(serverBriefing);
    renderHome();
    const link = screen.getByRole('link', { name: /이어서 읽기/ });
    expect(link).toHaveTextContent('13p');
    expect(link.textContent).not.toContain('%');
    expect(link.textContent).not.toContain('19');
    await waitFor(() => expect(link).toHaveTextContent('제2장 해왕좌의 밤 · 13p'));
  });

  test('FR-BRF-005: 진도 기록이 있으면 홈에 큰 이어 읽기 카드 — 표지·제목·서버의 장 이름·쪽·진도 바, 누르면 브리핑', async () => {
    catalog.books = [readingBook];
    briefingApi.fetchBriefing.mockResolvedValue(serverBriefing);
    renderHome();
    const card = screen.getByTestId('home-continue-card');
    expect(card.tagName).toBe('A');
    expect(card).toHaveAttribute('href', '/books/bk-95898cdf13/briefing');
    expect(within(card).getByRole('img', { name: '가상범인 표지' })).toHaveAttribute('src', '/covers/gasangbeomin.webp');
    expect(card).toHaveTextContent('가상범인');
    // 진도 바 폭은 GET /books 가 준 percent 그대로 (프론트 재계산 없음)
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '19.1');
    // 장 이름은 서버 브리핑 응답의 resume_chapter(이어 읽기 위치의 장) 그대로 — 쪽과 같은 위치다.
    // 기준점의 장(current_chapter)은 쓰지 않는다
    await waitFor(() => expect(card).toHaveTextContent('제2장 해왕좌의 밤'));
    expect(card).not.toHaveTextContent('지문');
    expect(briefingApi.fetchBriefing).toHaveBeenCalledWith('bk-95898cdf13');
    // 작은 이어서 읽기 버튼과 중복되지 않는다 — 이어 읽기 링크는 카드 하나
    expect(screen.getAllByRole('link', { name: /이어서 읽기/ })).toHaveLength(1);
  });

  test('FR-SPL-005: 장 이름을 못 받아도 카드는 서버의 쪽·진도 바로 뜨고 장 이름만 빠진다', async () => {
    catalog.books = [readingBook];
    renderHome();
    const card = screen.getByTestId('home-continue-card');
    await waitFor(() => expect(briefingApi.fetchBriefing).toHaveBeenCalled());
    expect(card).toHaveTextContent('13p');
    expect(card).not.toHaveTextContent('제');
  });

  test('FR-SPL-005: 서버가 이어 읽기 위치의 장을 못 주면(resume_chapter null) 장 이름만 빠진다 — 기준점의 장으로 메우지 않는다', async () => {
    catalog.books = [readingBook];
    briefingApi.fetchBriefing.mockResolvedValue({ ...serverBriefing, resume_chapter: null });
    renderHome();
    const card = screen.getByTestId('home-continue-card');
    await waitFor(() => expect(briefingApi.fetchBriefing).toHaveBeenCalled());
    await Promise.resolve();
    expect(card).toHaveTextContent('13p');
    expect(card).not.toHaveTextContent('제');
    expect(card).not.toHaveTextContent('지문');
  });

  test('진도 기록이 있는 책이 없으면 이어 읽기 카드가 없다', () => {
    catalog.books = [{ ...readingBook, progress: undefined }];
    renderHome();
    expect(screen.queryByTestId('home-continue-card')).toBeNull();
    expect(screen.queryByRole('link', { name: /이어서 읽기/ })).toBeNull();
    expect(briefingApi.fetchBriefing).not.toHaveBeenCalled();
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

describe('작은 화면에서 이어 읽기 카드가 있으면 입체 책 영역만 줄인다', () => {
  const original = { w: window.innerWidth, h: window.innerHeight };
  function screenSize(w: number, h: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  }
  const stageHeight = () => parseFloat(screen.getByTestId('book-carousel').style.height);
  afterEach(() => screenSize(original.w, original.h));

  test('390×664에서 카드가 있으면 입체 책 영역이 카드 없을 때보다 50px 이상 낮다', () => {
    screenSize(390, 664);
    catalog.books = [{ ...readingBook, progress: undefined }];
    const { unmount } = renderHome();
    const withoutCard = stageHeight();
    unmount();

    catalog.books = [readingBook];
    renderHome();
    expect(screen.getByTestId('home-continue-card')).toBeInTheDocument();
    expect(withoutCard - stageHeight()).toBeGreaterThanOrEqual(50);
  });

  test('카드가 없으면 작은 화면이어도 입체 책 영역 높이는 지금과 같다', () => {
    screenSize(390, 664);
    catalog.books = [];
    renderHome();
    expect(stageHeight()).toBeCloseTo(300 * (664 / 760), 5);
  });

  test('큰 화면(430×932)은 카드가 있어도 입체 책 영역 높이가 줄지 않는다', () => {
    screenSize(430, 932);
    catalog.books = [];
    const { unmount } = renderHome();
    const withoutCard = stageHeight();
    unmount();

    catalog.books = [readingBook];
    renderHome();
    expect(stageHeight()).toBe(withoutCard);
  });

  test('430×739은 카드가 있어도 10px 넘게 줄지 않는다', () => {
    screenSize(430, 739);
    catalog.books = [];
    const { unmount } = renderHome();
    const withoutCard = stageHeight();
    unmount();

    catalog.books = [readingBook];
    renderHome();
    expect(withoutCard - stageHeight()).toBeLessThanOrEqual(10);
  });
});
