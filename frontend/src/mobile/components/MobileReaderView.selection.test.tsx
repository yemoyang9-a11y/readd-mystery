import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import MobileReaderView from './MobileReaderView';

function renderView() {
  return render(
    <MobileReaderView
      content="찻잔 옆에 막 자른 나뭇가지가 놓여 있었다."
      currentPage={2}
      totalPages={4}
      prevPage={1}
      nextPage={3}
      onMove={() => {}}
      highlightedQuote={null}
      chapterStart={null}
      swipeDisabled={false}
      onQuote={() => {}}
      onNote={() => {}}
      insetTop="56px"
    />
  );
}

// 2026-11-19 대표 지시 — 문장 선택 때 뜨는 브라우저 기본 메뉴를 웹에서 막을 수 있는 만큼 막는다
test('2026-11-19 대표 지시: 본문에서 길게 누름 메뉴(contextmenu)를 막는다', () => {
  renderView();
  const article = screen.getByRole('article');
  const event = createEvent.contextMenu(article);
  fireEvent(article, event);
  expect(event.defaultPrevented).toBe(true);
});

test('2026-11-19 대표 지시: 본문은 -webkit-touch-callout:none 이고 글자 선택은 막지 않는다', () => {
  renderView();
  const article = screen.getByRole('article');
  expect(article).toHaveClass('[-webkit-touch-callout:none]');
  expect(article.className).not.toMatch(/select-none/);
  expect(article.style.userSelect).not.toBe('none');
});
