import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuoteAskButton from './QuoteAskButton';

test('FR-QNA-006: 선택한 문장에 챗봇에 물어보기와 노트에 적기 두 동작이 있다', async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn();
  const onNote = vi.fn();
  render(<QuoteAskButton popover={{ text: '문장', top: 100, bottom: 120, right: 200 }} limitBottom={700} onAsk={onAsk} onNote={onNote} />);
  await user.click(screen.getByRole('button', { name: '챗봇에 물어보기' }));
  await user.click(screen.getByRole('button', { name: '노트에 적기' }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(onNote).toHaveBeenCalledTimes(1);
});
