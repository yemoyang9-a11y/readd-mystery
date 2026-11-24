import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { MemoryRouter } from 'react-router';
import BookEndPage from './BookEndPage';
import CommentThread from './CommentThread';
import type { CommunityPost, ReviewCard } from '../../types';

vi.mock('../../hooks/useCatalog', () => ({
  useCatalog: () => ({ books: [], status: 'ready', reload: () => undefined }),
}));

const card: ReviewCard = {
  version: 1,
  title: '조수',
  counts: {
    hypothesis: { hit: 1, partial: 1, miss: 1, total: 3 },
    clue: { key: 0, related: 1, unrelated: 0, total: 1 },
  },
  early_pages: 120,
  timing_verified: true,
  message: '동기는 빗나갔어요',
  notes: [
    {
      kind: 'hypothesis',
      page_no: 84,
      body: '태수가 돈에 손을 댔다',
      verdict: 'hit',
      explanation: '횡령이 드러나요.',
      evidence_page: 204,
    },
  ],
};

function post(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    post_id: 'p1',
    body: '내 추리 결과지를 공유했어요',
    nickname: '추리하는고양이',
    created_at: new Date().toISOString(),
    comment_count: 0,
    like_count: 0,
    liked_by_me: false,
    is_mine: false,
    deleted: false,
    ...overrides,
  };
}

function thread(p: CommunityPost) {
  return render(
    <ul>
      <CommentThread
        bookId="bk1"
        post={p}
        refreshKey={0}
        onReply={() => undefined}
        onChanged={() => undefined}
      />
    </ul>
  );
}

describe('커뮤니티의 추리 결과지 카드 (대표 결정 2026-11-24)', () => {
  test('결과지 글은 한마디를 본문으로, 카드에 칭호·개수·결말 N쪽 전·고른 노트의 판정을 그린다', () => {
    thread(post({ review_card: card }));
    const view = within(screen.getByTestId('review-card'));
    expect(view.getByText('조수')).toBeInTheDocument();
    expect(view.getByText('가설 3개 중 1개 적중 · 단서 1개 중 0개 핵심')).toBeInTheDocument();
    expect(view.getByText('진상이 밝혀지기 120쪽 전에 맞혔어요')).toBeInTheDocument();
    expect(view.getByText('적중')).toBeInTheDocument();
    expect(view.getByText('횡령이 드러나요.')).toBeInTheDocument();
    expect(screen.getByText('동기는 빗나갔어요')).toBeInTheDocument();
    expect(screen.queryByText('내 추리 결과지를 공유했어요')).toBeNull();
  });

  test('일반 글과 지운 글에는 카드가 없다', () => {
    const { unmount } = thread(post({ body: '그냥 소감' }));
    expect(screen.queryByTestId('review-card')).toBeNull();
    unmount();
    thread(post({ deleted: true, body: '삭제된 댓글입니다', review_card: null }));
    expect(screen.queryByTestId('review-card')).toBeNull();
  });
});

describe('책 끝 화면의 내 추리 채점 버튼', () => {
  test('마지막 쪽 진도 저장을 기다린 뒤 채점 화면으로 간다', async () => {
    const order: string[] = [];
    render(
      <MemoryRouter>
        <BookEndPage
          bookId="bk1"
          bookTitle="가상범인"
          totalPages={100}
          returnFocusRef={createRef()}
          onBack={() => undefined}
          onCommunity={() => undefined}
          onReview={() => order.push('review')}
          flushProgress={async () => {
            order.push('flush');
          }}
        />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('button', { name: '내 추리 채점하기' }));
    expect(order).toEqual(['flush', 'review']);
  });

  test('onReview 를 주지 않으면 버튼이 없다', () => {
    render(
      <MemoryRouter>
        <BookEndPage
          bookId="bk1"
          bookTitle="가상범인"
          totalPages={100}
          returnFocusRef={createRef()}
          onBack={() => undefined}
          onCommunity={() => undefined}
        />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: '내 추리 채점하기' })).toBeNull();
  });
});
