import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, type AxiosResponse } from 'axios';
import MobileCommunity from './MobileCommunity';
import * as service from '../../services/communityService';
import type { CommunityPost } from '../../types';

vi.mock('../../services/communityService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/communityService')>();
  return {
    ...actual,
    fetchCommunityPosts: vi.fn(),
    fetchCommunityPost: vi.fn(),
    createCommunityPost: vi.fn(),
    createCommunityComment: vi.fn(),
    deleteCommunityComment: vi.fn(),
    deleteCommunityPost: vi.fn(),
    reportCommunityTarget: vi.fn(),
  };
});

const mocked = vi.mocked(service);

function post(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    post_id: 'p1',
    kind: 'theory',
    body: '범인은 집사다',
    nickname: '독자 a1b2',
    created_at: new Date().toISOString(),
    comment_count: 2,
    like_count: 0,
    liked_by_me: false,
    is_mine: false,
    deleted: false,
    ...overrides,
  };
}

function lockedError() {
  return new AxiosError('locked', 'ERR_BAD_REQUEST', undefined, null, {
    status: 403,
    data: { error: 'COMMUNITY_LOCKED' },
  } as AxiosResponse);
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/books/bk1/community']}>
      <Routes>
        <Route path="/books/:bookId/community" element={<MobileCommunity />} />
        <Route path="/books/:bookId/read" element={<p>읽기 화면</p>} />
        <Route path="/books/:bookId" element={<p>책 상세</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

test('COMMUNITY: 완독 전(403)에는 안내와 이어 읽기만 보이고 글·글쓰기는 없다', async () => {
  mocked.fetchCommunityPosts.mockRejectedValue(lockedError());
  renderScreen();

  expect(await screen.findByText('끝까지 읽으면 열려요')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '글쓰기' })).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.queryByText('범인은 집사다')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: '이어 읽기' }));
  expect(await screen.findByText('읽기 화면')).toBeInTheDocument();
});

test('COMMUNITY: 완독 독자는 글 목록과 글쓰기 버튼이 보이고 필터가 서버 kind로 전달된다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  renderScreen();

  expect(await screen.findByText('범인은 집사다')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '글쓰기' })).toHaveAttribute('data-track', 'community-write');

  await userEvent.click(screen.getByRole('button', { name: '범인 추리' }));
  expect(mocked.fetchCommunityPosts).toHaveBeenLastCalledWith('bk1', 'theory', null);
});

test('COMMUNITY: 글쓰기 모달에서 종류를 고르고 등록하면 목록을 다시 불러온다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [], next_cursor: null });
  mocked.createCommunityPost.mockResolvedValue(post());
  renderScreen();

  await userEvent.click(await screen.findByRole('button', { name: '글쓰기' }));
  const dialog = screen.getByRole('dialog', { name: '이야기 남기기' });
  const submit = within(dialog).getByRole('button', { name: '등록' });
  expect(submit).toBeDisabled();

  await userEvent.click(within(dialog).getByRole('radio', { name: '감상' }));
  await userEvent.type(within(dialog).getByLabelText('내용'), '재미있었다');
  await userEvent.click(submit);

  expect(mocked.createCommunityPost).toHaveBeenCalledWith('bk1', 'review', '재미있었다');
  await vi.waitFor(() => expect(mocked.fetchCommunityPosts).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('COMMUNITY: 글 상세에서 본인 댓글만 삭제할 수 있고 남의 댓글은 신고 메뉴가 있다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  mocked.fetchCommunityPost.mockResolvedValue({
    post: post(),
    comments: [
      { comment_id: 'c1', body: '내 댓글', nickname: '독자 0001', created_at: new Date().toISOString(), is_mine: true },
      { comment_id: 'c2', body: '남의 댓글', nickname: '독자 0002', created_at: new Date().toISOString(), is_mine: false },
    ],
  });
  mocked.deleteCommunityComment.mockResolvedValue();
  mocked.reportCommunityTarget.mockResolvedValue();
  renderScreen();

  await userEvent.click(await screen.findByText('범인은 집사다'));
  expect(await screen.findByText('내 댓글')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '댓글 더보기' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '신고하기' }));
  await userEvent.click(screen.getByRole('radio', { name: '스팸·광고' }));
  await userEvent.click(screen.getByRole('button', { name: '신고' }));
  expect(mocked.reportCommunityTarget).toHaveBeenCalledWith('bk1', 'comment', 'c2', '스팸·광고');

  await userEvent.click(screen.getByRole('button', { name: '삭제' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }));
  expect(mocked.deleteCommunityComment).toHaveBeenCalledWith('bk1', 'c1');
});

test('COMMUNITY: 댓글 등록 중 403이 오면 잠금 화면으로 바뀐다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  mocked.fetchCommunityPost.mockResolvedValue({ post: post(), comments: [] });
  mocked.createCommunityComment.mockRejectedValue(lockedError());
  renderScreen();

  await userEvent.click(await screen.findByText('범인은 집사다'));
  await userEvent.type(await screen.findByLabelText('댓글 입력'), '댓글');
  await userEvent.click(screen.getByRole('button', { name: '등록' }));

  expect(await screen.findByText('끝까지 읽으면 열려요')).toBeInTheDocument();
  expect(screen.queryByText('범인은 집사다')).toBeNull();
});
