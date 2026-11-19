/**
 * 책 끝 페이지(N+1) — 대표 결정 2026-11-19 "책 끝 페이지와 커뮤니티 관문 없애기"
 *
 * 끝 페이지는 화면에만 있다. 마지막 쪽(N)에서 '다음'을 눌러 N+1로 가고 돌아오는 동안
 * 진도 이벤트는 0건이어야 한다 (절대 규칙 2·8·9, FR-PRG-003 🚦). 화면은 완독 판별을 하지 않는다.
 * 커뮤니티 관문은 서버가 저장된 가장 먼 쪽으로 정한다 (대표 결정 2026-11-19 정정 — 끝까지 간 독자만,
 * 차례 읽기는 따지지 않음). 그래서 리뷰·커뮤니티 이동 전에 마지막 쪽 진도 저장을 기다린다.
 * 예전 완독 화면(서버 is_complete 로 저절로 뜨던 창)과 마지막 쪽 "완독했어요" 블록은 없앴다.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import MobileReader from './MobileReader';
import { clearPendingJump } from '../../utils/pendingJump';
import type { PositionResponse } from '../../services/positionService';

const { enterBookMock, sendProgressMock, fetchPositionMock, createPostMock, deletePostMock } = vi.hoisted(() => ({
  enterBookMock: vi.fn(),
  sendProgressMock: vi.fn(),
  fetchPositionMock: vi.fn(),
  createPostMock: vi.fn(),
  deletePostMock: vi.fn(),
}));

vi.mock('../../services/progressService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/progressService')>();
  return { ...actual, enterBook: enterBookMock, sendProgress: sendProgressMock };
});
vi.mock('../../services/positionService', () => ({ fetchPosition: fetchPositionMock }));
vi.mock('../../services/communityService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/communityService')>();
  return { ...actual, createCommunityPost: createPostMock, deleteCommunityPost: deletePostMock };
});
vi.mock('../../hooks/useHeartbeat', () => ({ useHeartbeat: vi.fn() }));

const BOOK = 'takryu';
const LAST_PAGE = 30;

function lockedError() {
  return new AxiosError('locked', 'ERR_BAD_REQUEST', undefined, null, {
    status: 403,
    data: { error: 'COMMUNITY_LOCKED' },
  } as AxiosResponse);
}

const REVIEW = {
  post_id: 'p-1',
  kind: 'review' as const,
  body: '좋았어요',
  nickname: '독자 ab12',
  created_at: new Date().toISOString(),
  comment_count: 0,
  like_count: 0,
  liked_by_me: false,
  is_mine: true,
  deleted: false,
};

function position(isComplete: boolean): PositionResponse {
  return { applied_cutoff: 5, current_chapter_no: 1, read_chapter_nos: [], is_complete: isComplete };
}

function renderReader(startPage = LAST_PAGE) {
  enterBookMock.mockResolvedValue({ route: 'reader', page: startPage, is_new_session: false, session_epoch: 1 });
  return render(
    <MemoryRouter initialEntries={[`/books/${BOOK}/read`]}>
      <Routes>
        <Route path="/books/:bookId/read" element={<MobileReader />} />
        <Route path="/books/:bookId/community" element={<p>커뮤니티 화면</p>} />
        <Route path="/books/:bookId" element={<p>책 정보 화면</p>} />
        <Route path="/search" element={<p>책 찾기 화면</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function pageShown(pageNo: number) {
  const input = await screen.findByLabelText<HTMLInputElement>('페이지로 이동');
  await waitFor(() => expect(input.value).toBe(String(pageNo)));
}

async function openEndPage() {
  await pageShown(LAST_PAGE);
  await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }));
  return screen.findByTestId('book-end-page');
}

describe('책 끝 페이지(N+1) — 대표 결정 2026-11-19', () => {
  beforeEach(() => {
    clearPendingJump();
    localStorage.clear();
    enterBookMock.mockReset();
    sendProgressMock.mockReset().mockResolvedValue({ success: true, applied_cutoff: 5, confirm: null });
    fetchPositionMock.mockReset().mockResolvedValue(position(false));
    createPostMock.mockReset();
    deletePostMock.mockReset().mockResolvedValue(undefined);
  });

  test('FR-PRG-003: 마지막 쪽에서 다음을 누르면 끝 페이지(N+1 / N+1)가 뜨고 진도 이벤트는 0건', async () => {
    renderReader();
    await pageShown(LAST_PAGE);
    const before = sendProgressMock.mock.calls.length;

    const endPage = await openEndPage();
    expect(within(endPage).getByRole('heading', { name: '끝까지 읽었어요' })).toBeInTheDocument();
    expect(within(endPage).getByTestId('end-page-indicator')).toHaveTextContent(`${LAST_PAGE + 1} / ${LAST_PAGE + 1}`);
    expect(within(endPage).getByRole('button', { name: '다음 페이지' })).toBeDisabled();
    expect(sendProgressMock.mock.calls.length).toBe(before);
    // 서버에 N 보다 큰 쪽을 보낸 적이 없다
    for (const call of sendProgressMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(`${LAST_PAGE + 1}`);
    }
  });

  test('완독 여부와 무관하다 — 서버가 완독이 아니라고 해도 끝 페이지가 뜬다', async () => {
    fetchPositionMock.mockResolvedValue(position(false));
    renderReader();
    expect(await openEndPage()).toBeInTheDocument();
  });

  test('이전 페이지를 누르면 N쪽으로 돌아오고 진도 이벤트는 0건', async () => {
    renderReader();
    await pageShown(LAST_PAGE);
    const before = sendProgressMock.mock.calls.length;
    const endPage = await openEndPage();
    await userEvent.click(within(endPage).getByRole('button', { name: '이전 페이지' }));
    expect(screen.queryByTestId('book-end-page')).toBeNull();
    await pageShown(LAST_PAGE);
    expect(sendProgressMock.mock.calls.length).toBe(before);
  });

  test('닫기(X)와 Esc 도 N쪽으로 돌아온다', async () => {
    renderReader();
    const endPage = await openEndPage();
    await userEvent.click(within(endPage).getByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('book-end-page')).toBeNull();

    await openEndPage();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('book-end-page')).toBeNull();
    await pageShown(LAST_PAGE);
  });

  test('마지막 쪽이 아니면 다음은 평소처럼 다음 쪽으로 가고(진도 이벤트 있음, positive 쌍) 끝 페이지는 없다', async () => {
    renderReader(LAST_PAGE - 1);
    await pageShown(LAST_PAGE - 1);
    const before = sendProgressMock.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }));
    await pageShown(LAST_PAGE);
    await waitFor(() => expect(sendProgressMock.mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByTestId('book-end-page')).toBeNull();
  });

  test('예전 완독 창은 저절로 뜨지 않고, 마지막 쪽에 "완독했어요" 블록도 없다', async () => {
    fetchPositionMock.mockResolvedValue(position(true));
    renderReader();
    await pageShown(LAST_PAGE);
    // 위치 조회를 기다릴 틈을 준 뒤에도 0건
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('completion-screen')).toBeNull();
    expect(screen.queryByTestId('completion-block')).toBeNull();
    expect(screen.queryByTestId('book-end-page')).toBeNull();
    expect(screen.queryByText('완독했어요')).toBeNull();
    expect(screen.queryByText('끝까지 읽었어요')).toBeNull();
  });

  test('한 줄 리뷰는 이 책의 커뮤니티 글(kind=review)로 올라가고, 올린 뒤 "내 한 줄 리뷰"로 보인다', async () => {
    createPostMock.mockResolvedValue({
      post_id: 'p-1',
      kind: 'review',
      body: '마지막 반전이 오래 남아요',
      nickname: '독자 ab12',
      created_at: new Date().toISOString(),
      comment_count: 0,
      like_count: 0,
      liked_by_me: false,
      is_mine: true,
      deleted: false,
    });
    renderReader();
    const endPage = await openEndPage();
    const save = within(endPage).getByRole('button', { name: '남기기' });
    expect(save).toBeDisabled();
    expect(within(endPage).getByText('완독자 커뮤니티 리뷰에 올라가요')).toBeInTheDocument();
    await userEvent.type(within(endPage).getByPlaceholderText('이 책을 한 줄로 남겨 보세요'), '  마지막 반전이 오래 남아요 ');
    await userEvent.click(save);

    expect(createPostMock).toHaveBeenCalledTimes(1);
    expect(createPostMock).toHaveBeenCalledWith(BOOK, 'review', '마지막 반전이 오래 남아요');
    expect(await within(endPage).findByRole('heading', { name: '내 한 줄 리뷰' })).toBeInTheDocument();
    expect(within(endPage).getByText('마지막 반전이 오래 남아요')).toBeInTheDocument();
    // 고치기 API가 없으므로 고치기는 없고 지우기만 있다
    expect(within(endPage).queryByRole('button', { name: '고치기' })).toBeNull();
    await userEvent.click(within(endPage).getByRole('button', { name: '지우기' }));
    expect(deletePostMock).toHaveBeenCalledWith(BOOK, 'p-1');
    expect(await within(endPage).findByPlaceholderText('이 책을 한 줄로 남겨 보세요')).toBeInTheDocument();
  });

  test('리뷰를 올리지 못하면 알리고 쓴 글은 그대로 둔다', async () => {
    createPostMock.mockRejectedValue(new Error('network'));
    renderReader();
    const endPage = await openEndPage();
    const field = within(endPage).getByPlaceholderText<HTMLTextAreaElement>('이 책을 한 줄로 남겨 보세요');
    await userEvent.type(field, '좋았어요');
    await userEvent.click(within(endPage).getByRole('button', { name: '남기기' }));
    expect(await within(endPage).findByRole('alert')).toHaveTextContent('리뷰를 남기지 못했어요');
    expect(field.value).toBe('좋았어요');
  });

  test('"완독자 커뮤니티로 이동하기"는 이 책의 커뮤니티로 간다', async () => {
    renderReader();
    const endPage = await openEndPage();
    await userEvent.click(within(endPage).getByRole('button', { name: '완독자 커뮤니티로 이동하기' }));
    expect(await screen.findByText('커뮤니티 화면')).toBeInTheDocument();
  });

  test('다른 책 보기는 지금 책과 미공개 책을 빼고 3권까지 보여 주고, 누르면 그 책 정보로 간다', async () => {
    renderReader();
    const endPage = await openEndPage();
    const others = await within(endPage).findByTestId('end-page-others');
    const links = within(others)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/books/'));
    const hrefs = links.map((link) => link.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.length).toBeLessThanOrEqual(3);
    expect(hrefs).not.toContain(`/books/${BOOK}`);
    expect(hrefs).not.toContain('/books/not-ready-book');
    await userEvent.click(links[0]);
    expect(await screen.findByText('책 정보 화면')).toBeInTheDocument();
  });

  test('"전체 보기"는 책 찾기 목록으로 간다', async () => {
    renderReader();
    const endPage = await openEndPage();
    await userEvent.click(await within(endPage).findByRole('link', { name: /전체 보기/ }));
    expect(await screen.findByText('책 찾기 화면')).toBeInTheDocument();
  });

  test('화면 문구에 "싸비"·"AI"가 없다', async () => {
    renderReader();
    const endPage = await openEndPage();
    await within(endPage).findByTestId('end-page-others');
    expect(endPage.textContent).not.toMatch(/싸비|AI/);
  });

  test('키보드 ← 로도 N쪽으로 돌아온다 (글 쓰는 중에는 글자 이동에 양보)', async () => {
    renderReader();
    const endPage = await openEndPage();
    const field = within(endPage).getByPlaceholderText('이 책을 한 줄로 남겨 보세요');
    fireEvent.keyDown(field, { key: 'ArrowLeft' });
    expect(screen.getByTestId('book-end-page')).toBeInTheDocument();
    fireEvent.keyDown(within(endPage).getByRole('button', { name: '완독자 커뮤니티로 이동하기' }), { key: 'ArrowLeft' });
    expect(screen.queryByTestId('book-end-page')).toBeNull();
  });

  // 대표 결정 2026-11-19 정정 — 커뮤니티는 서버에 저장된 가장 먼 쪽이 마지막 쪽인 독자만 들어간다.
  // 목차로 건너뛰어 마지막 쪽 진도 이벤트가 아직 가는 중이면, 저장을 기다린 뒤에 간다.
  test('대표 결정 2026-11-19 정정: 마지막 쪽 진도 저장이 끝나기 전에는 커뮤니티로 가지 않고, 저장되면 간다', async () => {
    let finish: (value: unknown) => void = () => undefined;
    sendProgressMock.mockImplementation(
      (_book: string, page: number) =>
        page === LAST_PAGE
          ? new Promise((resolve) => {
              finish = () => resolve({ success: true, applied_cutoff: 5, confirm: null });
            })
          : Promise.resolve({ success: true, applied_cutoff: 5, confirm: null })
    );
    renderReader();
    const endPage = await openEndPage();
    await userEvent.click(within(endPage).getByRole('button', { name: '완독자 커뮤니티로 이동하기' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText('커뮤니티 화면')).toBeNull();

    finish(undefined);
    expect(await screen.findByText('커뮤니티 화면')).toBeInTheDocument();
    // 보낸 것은 이동 사실(마지막 쪽)뿐이다 — 끝 페이지 번호나 완독 값을 보내지 않는다 (절대 규칙 8번)
    for (const call of sendProgressMock.mock.calls) {
      expect(call[1]).toBeLessThanOrEqual(LAST_PAGE);
      expect(JSON.stringify(call)).not.toMatch(/reached_end|is_complete/);
    }
  });

  test('진도 저장이 실패해도 커뮤니티 화면으로는 간다 — 막을지는 서버 관문이 정한다', async () => {
    sendProgressMock.mockResolvedValue(null);
    renderReader();
    const endPage = await openEndPage();
    await userEvent.click(within(endPage).getByRole('button', { name: '완독자 커뮤니티로 이동하기' }));
    expect(await screen.findByText('커뮤니티 화면')).toBeInTheDocument();
  });

  test('대표 결정 2026-11-19 정정: 리뷰가 진도 저장보다 먼저 닿아 403 COMMUNITY_LOCKED 이면 저장을 기다렸다가 한 번만 다시 올린다', async () => {
    createPostMock.mockRejectedValueOnce(lockedError()).mockResolvedValueOnce(REVIEW);
    renderReader();
    const endPage = await openEndPage();
    await userEvent.type(within(endPage).getByPlaceholderText('이 책을 한 줄로 남겨 보세요'), '좋았어요');
    await userEvent.click(within(endPage).getByRole('button', { name: '남기기' }));
    expect(await within(endPage).findByRole('heading', { name: '내 한 줄 리뷰' })).toBeInTheDocument();
    expect(createPostMock).toHaveBeenCalledTimes(2);
  });

  test('다시 올려도 403 이면 알리고 더 시도하지 않는다 (재시도는 한 번뿐)', async () => {
    createPostMock.mockRejectedValue(lockedError());
    renderReader();
    const endPage = await openEndPage();
    await userEvent.type(within(endPage).getByPlaceholderText('이 책을 한 줄로 남겨 보세요'), '좋았어요');
    await userEvent.click(within(endPage).getByRole('button', { name: '남기기' }));
    expect(await within(endPage).findByRole('alert')).toHaveTextContent('리뷰를 남기지 못했어요');
    expect(createPostMock).toHaveBeenCalledTimes(2);
  });
});
