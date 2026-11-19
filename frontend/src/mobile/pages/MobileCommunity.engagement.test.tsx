import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, type AxiosResponse } from 'axios';
import MobileCommunity from './MobileCommunity';
import MobileCommunityHub from './MobileCommunityHub';
import * as service from '../../services/communityService';
import type { CommunityPost } from '../../types';

vi.mock('../../services/communityService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/communityService')>();
  return {
    ...actual,
    fetchCommunityPosts: vi.fn(),
    fetchCommunityPost: vi.fn(),
    createCommunityPost: vi.fn(),
    likeCommunityPost: vi.fn(),
    unlikeCommunityPost: vi.fn(),
    fetchCommunityHub: vi.fn(),
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
    comment_count: 3,
    like_count: 4,
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/community" element={<MobileCommunityHub />} />
        <Route path="/books/:bookId/community" element={<MobileCommunity />} />
        <Route path="/books/:bookId/briefing" element={<p>브리핑 화면</p>} />
        <Route path="/books/:bookId/read" element={<p>읽기 화면</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('책 커뮤니티 — 공감·정렬·빈 상태', () => {
  test('카드에 공감 수와 댓글 수가 보이고, 공감을 누르면 서버 값으로 바뀐다', async () => {
    mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
    mocked.likeCommunityPost.mockResolvedValue({ like_count: 5, liked_by_me: true });
    renderAt('/books/bk1/community');

    const like = await screen.findByRole('button', { name: '공감 4' });
    expect(like).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '댓글 3' })).toBeInTheDocument();

    await userEvent.click(like);
    expect(mocked.likeCommunityPost).toHaveBeenCalledWith('bk1', 'p1');
    const pressed = await screen.findByRole('button', { name: '공감 5' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
  });

  test('공감 취소는 unlike 를 부르고, 실패하면 원래 값으로 돌아간다', async () => {
    mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post({ like_count: 2, liked_by_me: true })], next_cursor: null });
    mocked.unlikeCommunityPost.mockRejectedValue(new Error('network'));
    renderAt('/books/bk1/community');

    await userEvent.click(await screen.findByRole('button', { name: '공감 2' }));
    expect(mocked.unlikeCommunityPost).toHaveBeenCalledWith('bk1', 'p1');
    expect(await screen.findByRole('button', { name: '공감 2' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('FR-SPL-005: 공감 중 403(완독 잠금)이 오면 글이 사라지고 잠금 화면으로 바뀐다', async () => {
    mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
    mocked.likeCommunityPost.mockRejectedValue(lockedError());
    renderAt('/books/bk1/community');

    await userEvent.click(await screen.findByRole('button', { name: '공감 4' }));
    expect(await screen.findByText('끝까지 읽으면 열려요')).toBeInTheDocument();
    expect(screen.queryByText('범인은 집사다')).toBeNull();
  });

  test('삭제된 글에는 공감 버튼이 없다', async () => {
    mocked.fetchCommunityPosts.mockResolvedValue({
      posts: [post({ deleted: true, body: '삭제된 글입니다', nickname: null, like_count: 0 })],
      next_cursor: null,
    });
    renderAt('/books/bk1/community');
    expect(await screen.findByText('삭제된 글입니다')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^공감/ })).toBeNull();
  });

  test('인기순을 고르면 서버에 sort=popular 로 묻고, 최신순으로 돌아오면 sort 없이 묻는다', async () => {
    mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
    renderAt('/books/bk1/community');
    await screen.findByText('범인은 집사다');

    await userEvent.click(screen.getByRole('button', { name: '인기순' }));
    expect(mocked.fetchCommunityPosts).toHaveBeenLastCalledWith('bk1', null, null, 'popular');
    expect(screen.getByRole('button', { name: '인기순' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: '감상' }));
    expect(mocked.fetchCommunityPosts).toHaveBeenLastCalledWith('bk1', 'review', null, 'popular');

    await userEvent.click(screen.getByRole('button', { name: '최신순' }));
    expect(mocked.fetchCommunityPosts).toHaveBeenLastCalledWith('bk1', 'review', null);
  });

  test('글이 없으면 첫 글을 권하고, 누르면 글쓰기 창이 그 종류로 열린다', async () => {
    mocked.fetchCommunityPosts.mockResolvedValue({ posts: [], next_cursor: null });
    renderAt('/books/bk1/community');

    expect(await screen.findByText('첫 이야기를 남겨 주세요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '감상' }));
    await userEvent.click(await screen.findByRole('button', { name: '첫 글 쓰기' }));
    const dialog = screen.getByRole('dialog', { name: '이야기 남기기' });
    expect(within(dialog).getByRole('radio', { name: '감상' })).toBeChecked();
  });

  test('글 상세에서도 공감할 수 있다', async () => {
    mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
    mocked.fetchCommunityPost.mockResolvedValue({ post: post(), comments: [] });
    mocked.likeCommunityPost.mockResolvedValue({ like_count: 5, liked_by_me: true });
    renderAt('/books/bk1/community');

    await userEvent.click(await screen.findByText('범인은 집사다'));
    const article = await screen.findByRole('article', { name: '게시글' });
    await userEvent.click(within(article).getByRole('button', { name: '공감 4' }));
    expect(await within(article).findByRole('button', { name: '공감 5' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('커뮤니티 허브 — 서버 access 를 그대로 그린다 (FR-BRF-005 🚦)', () => {
  test('FR-BRF-005: 잠긴 책은 글 수 없이 잠김으로만 보이고 브리핑으로 간다', async () => {
    mocked.fetchCommunityHub.mockResolvedValue({
      books: [{ book_id: 'bk-locked', title: '타원형의 거울', author: '김내성', cover_url: null, access: 'locked' }],
    });
    renderAt('/community');

    const card = await screen.findByTestId('hub-book-bk-locked');
    expect(card).toHaveTextContent('타원형의 거울');
    expect(card).toHaveAccessibleName('타원형의 거울, 끝까지 읽으면 열려요');
    expect(card.textContent).not.toMatch(/글 \d/);
    expect(screen.getByRole('heading', { name: '끝까지 읽으면 열려요' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '끝까지 읽은 책' })).toBeNull();
    await userEvent.click(card);
    expect(await screen.findByText('브리핑 화면')).toBeInTheDocument();
  });

  test('FR-BRF-005: 열린 책은 글 수와 함께 보이고 그 책 커뮤니티로 간다 (positive 쌍)', async () => {
    mocked.fetchCommunityHub.mockResolvedValue({
      books: [{ book_id: 'bk-open', title: '가상범인', author: '김내성', cover_url: null, access: 'open', post_count: 7 }],
    });
    mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
    renderAt('/community');

    const card = await screen.findByRole('link', { name: '가상범인 이야기방, 글 7개' });
    expect(screen.getByRole('heading', { name: '끝까지 읽은 책' })).toBeInTheDocument();
    await userEvent.click(card);
    expect(await screen.findByText('범인은 집사다')).toBeInTheDocument();
    expect(mocked.fetchCommunityPosts).toHaveBeenCalledWith('bk-open', null, null);
  });

  test('FR-SPL-005: 허브 조회가 실패하면 책 목록 0건, 다시 시도만 보인다', async () => {
    mocked.fetchCommunityHub.mockRejectedValue(new Error('network'));
    renderAt('/community');
    expect(await screen.findByText('커뮤니티를 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });
});
