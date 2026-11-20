import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommentComposer from './CommentComposer';

const TARGET = { postId: 'p1', commentId: 'c2', nickname: '밤샘독서' };

test('입력창: 답글 중이면 "밤샘독서님에게 답글 남기는 중" 과 @밤샘독서 가 미리 들어가고, ✕ 를 누르면 "댓글 달기..." 로 돌아간다', async () => {
  const onCancel = vi.fn();
  const { rerender } = render(<CommentComposer replyTarget={TARGET} onCancelReply={onCancel} onSubmit={vi.fn()} />);
  expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '밤샘독서님에게 답글 남기는 중')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('@밤샘독서 ');
  await userEvent.click(screen.getByRole('button', { name: '답글 취소' }));
  expect(onCancel).toHaveBeenCalled();
  rerender(<CommentComposer replyTarget={null} onCancelReply={onCancel} onSubmit={vi.fn()} />);
  expect(screen.queryByText(/답글 남기는 중/)).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.getByPlaceholderText('댓글 달기...')).toBeInTheDocument();
});

test('입력창: 게시하면 @머리말을 뺀 본문으로 onSubmit, 끝나면 비워진다 (Review Focus 4)', async () => {
  const onSubmit = vi.fn().mockResolvedValue(true);
  render(<CommentComposer replyTarget={TARGET} onCancelReply={vi.fn()} onSubmit={onSubmit} />);
  await userEvent.type(screen.getByRole('textbox'), '저는 반대로 읽었어요');
  await userEvent.click(screen.getByRole('button', { name: '게시' }));
  expect(onSubmit).toHaveBeenCalledWith('저는 반대로 읽었어요');
  expect(screen.getByRole('textbox')).toHaveValue('');
});

test('입력창: 공백만 있으면 게시 버튼이 비활성', async () => {
  render(<CommentComposer replyTarget={null} onCancelReply={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.getByRole('button', { name: '게시' })).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox'), '   ');
  expect(screen.getByRole('button', { name: '게시' })).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox'), '다 읽었어요');
  expect(screen.getByRole('button', { name: '게시' })).toBeEnabled();
});

test('입력창 왼쪽 동그라미에 내 닉네임 첫 글자가 보인다', () => {
  render(<CommentComposer replyTarget={null} myName="시험 독자" onCancelReply={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.getByText('시')).toBeInTheDocument();
});
