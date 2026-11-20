import { api } from './api';
import {
  createCommunityComment,
  createCommunityPost,
  fetchCommunityPosts,
  likeCommunityComment,
  unlikeCommunityComment,
} from './communityService';

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../utils/constants', async (original) => ({
  ...(await original<typeof import('../utils/constants')>()),
  USE_MOCK: false,
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({ data: { posts: [], next_cursor: null } });
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
  vi.mocked(api.delete).mockReset().mockResolvedValue({ data: { like_count: 0, liked_by_me: false } });
});

test('답글 쓰기는 reply_to_comment_id 를 실어 보내고, 댓글 쓰기는 kind 를 보내지 않는다', async () => {
  await createCommunityPost('takryu', '다 읽었어요');
  expect(api.post).toHaveBeenLastCalledWith('/books/takryu/community/posts', { body: '다 읽었어요' });

  await createCommunityComment('takryu', 'p1', '저도요');
  expect(api.post).toHaveBeenLastCalledWith('/books/takryu/community/posts/p1/comments', { body: '저도요' });

  await createCommunityComment('takryu', 'p1', '맞아요', 'c9');
  expect(api.post).toHaveBeenLastCalledWith('/books/takryu/community/posts/p1/comments', {
    body: '맞아요',
    reply_to_comment_id: 'c9',
  });
});

test('답글 좋아요는 /comments/:id/like 로 POST·DELETE', async () => {
  await likeCommunityComment('takryu', 'c9');
  expect(api.post).toHaveBeenLastCalledWith('/books/takryu/community/comments/c9/like');
  await unlikeCommunityComment('takryu', 'c9');
  expect(api.delete).toHaveBeenLastCalledWith('/books/takryu/community/comments/c9/like');
});

test('목록은 kind 를 보내지 않고, 인기순일 때만 sort=popular', async () => {
  await fetchCommunityPosts('takryu', null, 'new');
  expect(api.get).toHaveBeenLastCalledWith('/books/takryu/community/posts', { params: {} });
  await fetchCommunityPosts('takryu', 'abc', 'popular');
  expect(api.get).toHaveBeenLastCalledWith('/books/takryu/community/posts', {
    params: { cursor: 'abc', sort: 'popular' },
  });
});
