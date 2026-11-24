import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, type AxiosResponse } from 'axios';
import MobileNoteReview from './MobileNoteReview';
import * as service from '../../services/reviewService';
import type { ReviewResult, ReviewStatus } from '../../types';

vi.mock('../../services/reviewService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/reviewService')>();
  return { ...actual, fetchReview: vi.fn(), startReview: vi.fn(), shareReview: vi.fn() };
});

vi.mock('../../hooks/useCatalog', () => ({
  useCatalog: () => ({
    books: [{ book_id: 'bk1', title: '가상범인', author: '김내성', cover_url: '' }],
    status: 'ready',
    reload: () => undefined,
  }),
}));

const mocked = vi.mocked(service);

function httpError(status: number, data: unknown = {}) {
  return new AxiosError('x', 'ERR', undefined, null, { status, data } as AxiosResponse);
}

const ready = (
  overrides: Partial<Extract<ReviewStatus, { state: 'ready' }>> = {}
): ReviewStatus => ({
  state: 'ready',
  busy: false,
  targets: { hypothesis: 2, clue: 1 },
  candidates: [],
  excluded_count: 0,
  timing_verified: true,
  last_failed: false,
  ...overrides,
});

const result: ReviewResult = {
  version: 1,
  truth_summary: '범인은 집사였어요.',
  reveal_page: 95,
  notes: [
    {
      note_id: 'h1',
      page_no: 10,
      kind: 'hypothesis',
      chosen_as_hypothesis: false,
      body: '범인은 집사',
      verdict: 'hit',
      explanation: '맞혔어요.',
      evidence_page: 95,
    },
    {
      note_id: 'h2',
      page_no: 40,
      kind: 'hypothesis',
      chosen_as_hypothesis: false,
      body: '동기는 돈',
      verdict: 'miss',
      explanation: '동기는 복수였어요.',
      evidence_page: 97,
    },
    {
      note_id: 'c1',
      page_no: 20,
      kind: 'clue',
      chosen_as_hypothesis: false,
      body: '젖은 장갑',
      verdict: 'key',
      explanation: '핵심이에요.',
      evidence_page: 60,
    },
  ],
  counts: {
    hypothesis: { hit: 1, partial: 0, miss: 1, total: 2 },
    clue: { key: 1, related: 0, unrelated: 0, total: 1 },
    pending: 0,
  },
  title: '명탐정',
  early_pages: 85,
  timing_verified: true,
  excluded_count: 1,
  graded_at: '2026-11-24T00:00:00.000Z',
};

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/books/bk1/review']}>
      <Routes>
        <Route path="/books/:bookId/review" element={<MobileNoteReview />} />
        <Route path="/books/:bookId/read" element={<p>읽기 화면</p>} />
        <Route path="/books/:bookId/community" element={<p>커뮤니티 화면</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('내 추리 채점 화면 (대표 결정 2026-11-24)', () => {
  test('FR-QNA-004: 서버가 잠김(403)이면 잠김 안내만 — 진상·노트·채점 버튼이 없다', async () => {
    mocked.fetchReview.mockRejectedValue(httpError(403, { error: 'REVIEW_LOCKED' }));
    renderScreen();
    expect(await screen.findByText('끝까지 읽으면 내 추리를 채점할 수 있어요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내 추리 채점하기' })).toBeNull();
    expect(screen.queryByText('사건의 진상')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '이어 읽기' }));
    expect(screen.getByText('읽기 화면')).toBeInTheDocument();
  });

  test('채점 전: 대상 개수와 한 번만이라는 안내, 누르면 채점 결과(칭호·개수·결말 N쪽 전·진상)를 그린다', async () => {
    mocked.fetchReview.mockResolvedValue(ready({ excluded_count: 2 }));
    mocked.startReview.mockResolvedValue(result);
    renderScreen();
    expect(await screen.findByText(/가설 2개와 단서 1개를 아모가 채점해요/)).toBeInTheDocument();
    expect(screen.getByText(/채점은 한 번만 할 수 있어요/)).toBeInTheDocument();
    expect(
      screen.getByText('결말을 본 뒤 쓰거나 고친 노트 2개는 빼고 채점해요.')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '내 추리 채점하기' }));
    expect(mocked.startReview).toHaveBeenCalledWith('bk1', []);
    expect(await screen.findByTestId('review-title')).toHaveTextContent('명탐정');
    expect(screen.getByText('적중한 가설').nextElementSibling).toHaveTextContent('1 / 2');
    expect(screen.getByText('짚은 핵심 단서').nextElementSibling).toHaveTextContent('1 / 1');
    expect(screen.getByText(/채점을 마쳤어요/)).toBeInTheDocument();
    expect(screen.queryByText(/AI/)).toBeNull();
    expect(screen.getByText('진상이 밝혀지기 85쪽 전에 맞혔어요')).toBeInTheDocument();
    expect(screen.getByText('범인은 집사였어요.')).toBeInTheDocument();
    const notes = within(screen.getByTestId('review-notes'));
    expect(notes.getAllByText('적중').length).toBe(1);
    expect(notes.getByText('빗나감')).toBeInTheDocument();
    expect(notes.getByText('핵심 단서')).toBeInTheDocument();
    expect(notes.getByText('근거 95쪽')).toBeInTheDocument();
  });

  test('가설·단서가 없고 일반 메모만 있으면 고르기 — 고른 메모 ID만 보낸다', async () => {
    mocked.fetchReview.mockResolvedValue(
      ready({
        targets: { hypothesis: 0, clue: 0 },
        candidates: [{ note_id: 'm1', page_no: 30, body: '집사가 수상해' }],
      })
    );
    mocked.startReview.mockResolvedValue(result);
    renderScreen();
    const button = await screen.findByRole('button', { name: '내 추리 채점하기' });
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /집사가 수상해/ }));
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(mocked.startReview).toHaveBeenCalledWith('bk1', ['m1']);
  });

  test('노트가 하나도 없으면 AI를 부르는 버튼 대신 다음 책 안내', async () => {
    mocked.fetchReview.mockResolvedValue(ready({ targets: { hypothesis: 0, clue: 0 } }));
    renderScreen();
    expect(
      await screen.findByText('채점할 노트가 없어요. 다음 책에서는 읽으며 가설을 적어 보세요.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내 추리 채점하기' })).toBeNull();
  });

  test('채점에 실패하면 다시 누르라는 안내 — 결과는 그리지 않는다', async () => {
    mocked.fetchReview.mockResolvedValue(ready());
    mocked.startReview.mockRejectedValue(httpError(503, { error: 'REVIEW_FAILED' }));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: '내 추리 채점하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '채점하지 못했어요. 잠시 뒤 다시 눌러 주세요.'
    );
    expect(screen.queryByTestId('review-title')).toBeNull();
  });

  test('결과지 공유: 기본은 판정 받은 가설 전부·단서 없음, 한마디와 함께 보내고 공유 뒤에는 커뮤니티로', async () => {
    mocked.fetchReview.mockResolvedValue({ state: 'done', result, shared_post_id: null });
    mocked.shareReview.mockResolvedValue({ post_id: 'p1' });
    renderScreen();
    const share = within(await screen.findByTestId('review-share'));
    expect(share.getByText(/사건의 진상 요약은 올라가지 않아요/)).toBeInTheDocument();
    expect(share.getByRole('checkbox', { name: /범인은 집사/ })).toBeChecked();
    expect(share.getByRole('checkbox', { name: /동기는 돈/ })).toBeChecked();
    expect(share.getByRole('checkbox', { name: /젖은 장갑/ })).not.toBeChecked();
    await userEvent.click(share.getByRole('checkbox', { name: /동기는 돈/ }));
    await userEvent.type(share.getByLabelText('한마디 (선택)'), '범인은 맞혔어요');
    await userEvent.click(share.getByRole('button', { name: '완독자 커뮤니티에 공유하기' }));
    expect(mocked.shareReview).toHaveBeenCalledWith('bk1', ['h1'], '범인은 맞혔어요');
    expect(await screen.findByTestId('review-shared')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '커뮤니티에서 보기' }));
    expect(screen.getByText('커뮤니티 화면')).toBeInTheDocument();
  });

  test('이미 공유했으면 공유 칸 대신 커뮤니티로 가는 버튼', async () => {
    mocked.fetchReview.mockResolvedValue({ state: 'done', result, shared_post_id: 'p1' });
    renderScreen();
    expect(await screen.findByTestId('review-shared')).toBeInTheDocument();
    expect(screen.queryByTestId('review-share')).toBeNull();
  });

  test('결말 전 기록을 확인하지 못한 결과에는 "확인 안 됨"을 붙이고 결말 N쪽 전은 없다', async () => {
    mocked.fetchReview.mockResolvedValue({
      state: 'done',
      result: { ...result, timing_verified: false, early_pages: null },
      shared_post_id: null,
    });
    renderScreen();
    expect(await screen.findByText('결말 전 기록 여부 확인 안 됨')).toBeInTheDocument();
    expect(screen.queryByText(/쪽 전에 맞혔어요/)).toBeNull();
  });
});
