import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MobileFeedback from './MobileFeedback';

import { api } from '../../services/api';

vi.mock('../../services/api', () => ({ api: { post: vi.fn() } }));

const post = vi.mocked(api.post);

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: { success: true } });
});

test('피드백: 의견을 적어 제출하면 감사 문구가 나오고 하나 더 남길 수 있다', async () => {
  const user = userEvent.setup();
  render(<MobileFeedback />);
  const submit = screen.getByRole('button', { name: '제출' });
  expect(submit).toBeDisabled();
  // 회색 부연 문구는 두지 않는다 (2026-11-18 대표 지시) — 입력칸 이름은 화면 낭독용으로만 둔다
  expect(screen.queryByText('여러분의 소중한 의견 남겨주시면 감사하겠습니다.')).toBeNull();
  await user.type(screen.getByLabelText('의견'), '좋아요');
  await user.click(submit);
  expect(post).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('status')).toHaveTextContent('소중한 의견 감사합니다.');
  await user.click(screen.getByRole('button', { name: '하나 더 남기기' }));
  expect(screen.getByRole('button', { name: '제출' })).toBeDisabled();
});

test('피드백: 제출에 실패하면 안내가 나오고 글은 남는다', async () => {
  const user = userEvent.setup();
  post.mockRejectedValueOnce(new Error('network'));
  render(<MobileFeedback />);
  await user.type(screen.getByRole('textbox'), '의견');
  await user.click(screen.getByRole('button', { name: '제출' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('의견');
});
