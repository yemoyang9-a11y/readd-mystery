import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, type AxiosResponse } from 'axios';
import MobileCommunity from './MobileCommunity';
import * as service from '../../services/communityService';
import type { CommunityComment, CommunityPost } from '../../types';

vi.mock('../../services/communityService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/communityService')>();
  return {
    ...actual,
    fetchCommunityPosts: vi.fn(),
    fetchCommunityPost: vi.fn(),
    createCommunityPost: vi.fn(),
    createCommunityComment: vi.fn(),
  };
});

vi.mock('../../hooks/useCatalog', () => ({
  useCatalog: () => ({
    books: [{ book_id: 'bk1', title: '탁류', author: '채만식', cover_url: '' }],
    status: 'ready',
    reload: () => undefined,
  }),
}));

const mocked = vi.mocked(service);

function post(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    post_id: 'p1',
    body: '초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요',
    nickname: '달빛서재',
    created_at: new Date().toISOString(),
    comment_count: 1,
    like_count: 18,
    liked_by_me: false,
    is_mine: false,
    deleted: false,
    ...overrides,
  };
}

function reply(overrides: Partial<CommunityComment> = {}): CommunityComment {
  return {
    comment_id: 'c1',
    body: '저도요',
    nickname: '책벌레',
    created_at: new Date().toISOString(),
    is_mine: false,
    is_post_author: false,
    reply_to_nickname: '달빛서재',
    like_count: 0,
    liked_by_me: false,
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

test('처음 열면 최신순이 눌려 있고, 인기순을 누르면 sort=popular 로 다시 받는다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  renderScreen();
  expect(await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '최신순' })).toHaveAttribute('aria-pressed', 'true');
  expect(mocked.fetchCommunityPosts).toHaveBeenLastCalledWith('bk1', null, 'new');
  await userEvent.click(screen.getByRole('button', { name: '인기순' }));
  expect(mocked.fetchCommunityPosts).toHaveBeenLastCalledWith('bk1', null, 'popular');
  expect(screen.getByRole('button', { name: '인기순' })).toHaveAttribute('aria-pressed', 'true');
});

test('머리줄: "다 읽은 독자 이야기", 책 제목, "N개의 댓글" — 영어 장식 글씨·말머리 탭·글쓰기 막대가 없다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post(), post({ post_id: 'p2', body: '두 번째' })], next_cursor: null });
  renderScreen();
  await screen.findByText('두 번째');
  expect(screen.getByText('다 읽은 독자 이야기')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: '탁류' })).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.textContent === '2개의 댓글' && el.tagName === 'P')).toBeInTheDocument();
  expect(screen.queryByText(/case/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '범인 추리' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '글쓰기' })).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('댓글 달기...')).toBeInTheDocument();
});

test('머리줄 개수는 서버의 전체 댓글 수(total_count)를 쓴다 — 20개씩 받아도 전체 수', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: 'c', total_count: 24 });
  renderScreen();
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  expect(screen.getByText((_, el) => el?.textContent === '24개의 댓글' && el.tagName === 'P')).toBeInTheDocument();
});

test('댓글이 없으면 "아직 아무도 이야기를 꺼내지 않았어요" 와 입력창 하나만 있다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [], next_cursor: null });
  renderScreen();
  expect(await screen.findByText('다 읽은 소감을 처음으로 남겨 주세요.')).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.replace(/\s/g, '') === '아직아무도이야기를꺼내지않았어요')).toBeInTheDocument();
  const buttons = screen.getAllByRole('button').map((b) => b.textContent);
  expect(buttons).not.toContain('첫 글 쓰기');
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
});

test('입력창에서 게시하면 맨 위에 새 댓글이 생기고 개수가 1 늘어난다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  mocked.createCommunityPost.mockResolvedValue(post({ post_id: 'p9', body: '방금 다 읽었어요', nickname: '시험 독자', comment_count: 0, like_count: 0, is_mine: true }));
  renderScreen();
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  await userEvent.type(screen.getByRole('textbox'), '방금 다 읽었어요');
  await userEvent.click(screen.getByRole('button', { name: '게시' }));
  expect(mocked.createCommunityPost).toHaveBeenCalledWith('bk1', '방금 다 읽었어요');
  const items = await screen.findAllByRole('listitem');
  expect(items[0]).toHaveTextContent('방금 다 읽었어요');
  expect(screen.getByText((_, el) => el?.textContent === '2개의 댓글' && el.tagName === 'P')).toBeInTheDocument();
});

test('답글 달기 → 게시하면 그 묶음이 펼쳐진 채 새 답글이 맨 아래에 보인다 (Review Focus 4)', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  mocked.createCommunityComment.mockResolvedValue(reply({ comment_id: 'c2', body: '저는 반대로 읽었어요', nickname: '시험 독자', is_mine: true }));
  mocked.fetchCommunityPost.mockResolvedValue({
    post: post({ comment_count: 2 }),
    comments: [reply(), reply({ comment_id: 'c2', body: '저는 반대로 읽었어요', nickname: '시험 독자', reply_to_nickname: '달빛서재' })],
  });
  renderScreen();
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  await userEvent.click(screen.getByRole('button', { name: '답글 달기' }));
  expect(screen.getByRole('textbox')).toHaveValue('@달빛서재 ');
  await userEvent.type(screen.getByRole('textbox'), '저는 반대로 읽었어요');
  await userEvent.click(screen.getByRole('button', { name: '게시' }));
  expect(mocked.createCommunityComment).toHaveBeenCalledWith('bk1', 'p1', '저는 반대로 읽었어요', undefined);
  const replies = await screen.findAllByText(/저도요|저는 반대로 읽었어요/);
  expect(replies[replies.length - 1]).toHaveTextContent('저는 반대로 읽었어요');
  expect(screen.getByRole('button', { name: '답글 모두 숨기기' })).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.queryByText(/답글 남기는 중/)).not.toBeInTheDocument();
});

test('FR-QNA-004: 끝까지 가지 않았으면 잠김 안내만 있고 댓글 0건', async () => {
  mocked.fetchCommunityPosts.mockRejectedValue(lockedError());
  renderScreen();
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText('끝까지 읽으면 열려요')).toBeInTheDocument();
  expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await userEvent.click(within(alert).getByRole('button', { name: '이어 읽기' }));
  expect(screen.getByText('읽기 화면')).toBeInTheDocument();
});

test('Review Focus 5: 휴대폰 자판이 올라오면 입력창이 자판 위로 올라간다', async () => {
  const viewport = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  renderScreen();
  const bar = (await screen.findByPlaceholderText('댓글 달기...')).closest('[data-testid="comment-composer-dock"]') as HTMLElement;
  expect(bar.style.bottom).toBe('0px');
  viewport.height = window.innerHeight - 300;
  await act(async () => {
    viewport.dispatchEvent(new Event('resize'));
  });
  expect(bar.style.bottom).toBe('300px');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
});

function failure(status: number) {
  return new AxiosError('fail', 'ERR_BAD_REQUEST', undefined, null, { status, data: {} } as AxiosResponse);
}

test('Final: 댓글 게시가 429 로 실패하면 안내가 나오고 쓴 글은 입력칸에 남는다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  mocked.createCommunityPost.mockRejectedValue(failure(429));
  renderScreen();
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  await userEvent.type(screen.getByRole('textbox'), '또 씀');
  await userEvent.click(screen.getByRole('button', { name: '게시' }));
  expect(await screen.findByText('댓글은 1시간에 10개까지 남길 수 있어요. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('또 씀');
});

test('Final: 답글 대상이 사라져 404 면 안내가 나오고 "답글 남기는 중"이 풀린다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  mocked.createCommunityComment.mockRejectedValue(failure(404));
  mocked.fetchCommunityPost.mockResolvedValue({ post: post({ comment_count: 0 }), comments: [] });
  renderScreen();
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  await userEvent.click(screen.getByRole('button', { name: '답글 달기' }));
  await userEvent.type(screen.getByRole('textbox'), '답');
  await userEvent.click(screen.getByRole('button', { name: '게시' }));
  expect(await screen.findByText('답글을 달 댓글이 지워졌어요.')).toBeInTheDocument();
  expect(screen.queryByText(/답글 남기는 중/)).not.toBeInTheDocument();
});

test('Final: 정렬을 바꾸면 "답글 남기는 중"이 풀리고 입력창이 "댓글 달기..."로 돌아간다', async () => {
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  renderScreen();
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  await userEvent.click(screen.getByRole('button', { name: '답글 달기' }));
  expect(screen.getByRole('textbox')).toHaveValue('@달빛서재 ');
  await userEvent.click(screen.getByRole('button', { name: '인기순' }));
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  expect(screen.queryByText(/답글 남기는 중/)).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
});

test('Final: 목록 끝 여백은 입력창 실제 높이를 따른다 — 입력창이 높아져도 마지막 댓글이 가려지지 않는다', async () => {
  const observers: Array<(entries: unknown[]) => void> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: (entries: unknown[]) => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    }
  );
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  renderScreen();
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  const dock = screen.getByTestId('comment-composer-dock');
  vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({ height: 200 } as DOMRect);
  await act(async () => observers.forEach((cb) => cb([])));
  expect(screen.getByTestId('mobile-community').style.paddingBottom).toBe('216px');
  vi.unstubAllGlobals();
});

test('Final: 화면을 확대만 하면(자판 없음) 입력창이 뜨지 않는다', async () => {
  const viewport = Object.assign(new EventTarget(), { height: window.innerHeight / 1.5, offsetTop: 0, scale: 1.5 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  mocked.fetchCommunityPosts.mockResolvedValue({ posts: [post()], next_cursor: null });
  renderScreen();
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  expect(screen.getByTestId('comment-composer-dock').style.bottom).toBe('0px');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
});

test('Final: 인기순에서 새 댓글을 쓴 뒤 "더 보기"가 같은 댓글을 다시 줘도 한 번만 보인다', async () => {
  mocked.fetchCommunityPosts
    .mockResolvedValueOnce({ posts: [post()], next_cursor: null })
    .mockResolvedValueOnce({ posts: [post()], next_cursor: 'o' })
    .mockResolvedValueOnce({ posts: [post()], next_cursor: null });
  mocked.createCommunityPost.mockResolvedValue(post({ post_id: 'p9', body: '새 댓글', comment_count: 0 }));
  renderScreen();
  await screen.findByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요');
  await userEvent.click(screen.getByRole('button', { name: '인기순' }));
  await screen.findByRole('button', { name: '더 보기' });
  await userEvent.type(screen.getByRole('textbox'), '새 댓글');
  await userEvent.click(screen.getByRole('button', { name: '게시' }));
  await screen.findByText('새 댓글');
  await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
  await screen.findByText('새 댓글');
  expect(screen.getAllByText('초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요')).toHaveLength(1);
});
