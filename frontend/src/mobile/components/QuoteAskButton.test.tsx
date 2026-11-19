import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuoteAskButton from './QuoteAskButton';

const popover = { text: '문장', top: 100, bottom: 120, right: 200 };

test('FR-QNA-006: 선택한 문장에 아모에게 묻기와 노트에 적기 두 동작이 있다', async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn();
  const onNote = vi.fn();
  render(<QuoteAskButton popover={popover} limitBottom={700} onAsk={onAsk} onNote={onNote} />);
  await user.click(screen.getByRole('button', { name: '아모에게 묻기' }));
  await user.click(screen.getByRole('button', { name: '노트에 적기' }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(onNote).toHaveBeenCalledTimes(1);
});

test('2026-11-19 대표 지시: 버튼 순서는 왼쪽 "노트에 적기", 오른쪽 "아모에게 묻기"', () => {
  render(<QuoteAskButton popover={popover} limitBottom={700} onAsk={vi.fn()} onNote={vi.fn()} />);
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['노트에 적기', '아모에게 묻기']);
});

test('2026-11-19 대표 지시: 문장 선택 버튼에 "AI"·"챗봇"·"물어보기" 표기가 없다', () => {
  const { container } = render(<QuoteAskButton popover={popover} limitBottom={700} onAsk={vi.fn()} onNote={vi.fn()} />);
  expect(container.textContent).not.toMatch(/AI|챗봇|물어보기/);
});
