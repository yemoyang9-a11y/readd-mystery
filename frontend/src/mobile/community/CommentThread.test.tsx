import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommentThread from './CommentThread';
import * as service from '../../services/communityService';
import type { CommunityComment, CommunityPost } from '../../types';

vi.mock('../../services/communityService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/communityService')>();
  return {
    ...actual,
    fetchCommunityPost: vi.fn(),
    likeCommunityPost: vi.fn(),
    likeCommunityComment: vi.fn(),
    unlikeCommunityComment: vi.fn(),
  };
});

const mocked = vi.mocked(service);

const POST: CommunityPost = {
  post_id: 'p1',
  body: '초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요',
  nickname: '달빛서재',
  created_at: new Date().toISOString(),
  comment_count: 2,
  like_count: 18,
  liked_by_me: true,
  is_mine: false,
  deleted: false,
};

function reply(overrides: Partial<CommunityComment>): CommunityComment {
  return {
    comment_id: 'c1',
    body: '저도요',
    nickname: '책벌레',
    created_at: new Date().toISOString(),
    is_mine: false,
    is_post_author: false,
    reply_to_nickname: '달빛서재',
    like_count: 3,
    liked_by_me: false,
    ...overrides,
  };
}

const REPLIES = [
  reply({}),
  reply({
    comment_id: 'c2',
    body: '네, 그래서 더 오래 남아요',
    nickname: '달빛서재',
    is_post_author: true,
    reply_to_nickname: '책벌레',
    like_count: 0,
  }),
];

beforeEach(() => {
  mocked.fetchCommunityPost.mockReset().mockResolvedValue({ post: POST, comments: REPLIES });
  mocked.likeCommunityComment.mockReset().mockResolvedValue({ like_count: 4, liked_by_me: true });
});

function renderThread(onReply = vi.fn()) {
  render(<CommentThread bookId="takryu" post={POST} refreshKey={0} onReply={onReply} onChanged={vi.fn()} />);
  return onReply;
}

test('답글이 있으면 "답글 2개 모두 보기", 누르면 답글이 @닉네임과 함께 보이고 "답글 모두 숨기기"로 바뀐다', async () => {
  renderThread();
  expect(screen.getByText('달빛서재')).toBeInTheDocument();
  expect(screen.getByText('좋아요 18개')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '답글 2개 모두 보기' }));
  expect(mocked.fetchCommunityPost).toHaveBeenCalledWith('takryu', 'p1');
  expect(await screen.findByText('저도요')).toBeInTheDocument();
  expect(screen.getByText('@달빛서재')).toBeInTheDocument();
  expect(screen.getByText('@책벌레')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '답글 모두 숨기기' }));
  expect(screen.queryByText('저도요')).not.toBeInTheDocument();
});

test('글쓴이의 답글에는 "글쓴이" 표시가 붙고 남의 답글에는 없다', async () => {
  renderThread();
  await userEvent.click(screen.getByRole('button', { name: '답글 2개 모두 보기' }));
  await screen.findByText('저도요');
  expect(screen.getAllByText('글쓴이')).toHaveLength(1);
  expect(screen.getByText('네, 그래서 더 오래 남아요').closest('[data-reply]')).toHaveTextContent('글쓴이');
});

test('대상이 지워진 답글은 @ 없이 본문만 보인다', async () => {
  mocked.fetchCommunityPost.mockResolvedValue({
    post: POST,
    comments: [reply({ reply_to_nickname: null, body: '대상이 사라진 답글' })],
  });
  renderThread();
  await userEvent.click(screen.getByRole('button', { name: '답글 2개 모두 보기' }));
  expect(await screen.findByText('대상이 사라진 답글')).toBeInTheDocument();
  expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
});

test('하트를 누르면 likeCommunityComment 를 부르고 좋아요 N개가 갱신된다', async () => {
  renderThread();
  await userEvent.click(screen.getByRole('button', { name: '답글 2개 모두 보기' }));
  await screen.findByText('저도요');
  const hearts = screen.getAllByRole('button', { name: '좋아요' });
  await userEvent.click(hearts[0]);
  expect(mocked.likeCommunityComment).toHaveBeenCalledWith('takryu', 'c1');
  expect(await screen.findByText('좋아요 4개')).toBeInTheDocument();
});

test('답글 달기를 누르면 onReply 가 그 답글 작성자와 commentId 로 불린다', async () => {
  const onReply = renderThread();
  await userEvent.click(screen.getAllByRole('button', { name: '답글 달기' })[0]);
  expect(onReply).toHaveBeenLastCalledWith({ postId: 'p1', commentId: null, nickname: '달빛서재' });
  await userEvent.click(screen.getByRole('button', { name: '답글 2개 모두 보기' }));
  await screen.findByText('저도요');
  await userEvent.click(screen.getAllByRole('button', { name: '답글 달기' })[1]);
  expect(onReply).toHaveBeenLastCalledWith({ postId: 'p1', commentId: 'c1', nickname: '책벌레' });
});

test('시간은 인스타그램처럼 "3시간"으로 짧게 보인다 ("전" 없음)', () => {
  render(
    <CommentThread
      bookId="takryu"
      post={{ ...POST, created_at: new Date(Date.now() - 3 * 3600_000 - 60_000).toISOString() }}
      refreshKey={0}
      onReply={vi.fn()}
      onChanged={vi.fn()}
    />
  );
  expect(screen.getByText('3시간')).toBeInTheDocument();
  expect(screen.queryByText('3시간 전')).not.toBeInTheDocument();
});
