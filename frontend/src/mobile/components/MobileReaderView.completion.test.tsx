import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MobileReaderView from './MobileReaderView';

function renderView(props: {
  nextPage: number | null;
  onOpenCommunity?: () => void;
}) {
  return render(
    <MobileReaderView
      content="마지막 페이지 본문"
      currentPage={4}
      totalPages={4}
      prevPage={3}
      nextPage={props.nextPage}
      onMove={() => {}}
      highlightedQuote={null}
      chapterStart={null}
      swipeDisabled={false}
      onQuote={() => {}}
      onNote={() => {}}
      insetTop="56px"
      onOpenCommunity={props.onOpenCommunity}
      onBack={() => {}}
    />
  );
}

test('COMMUNITY: 마지막 페이지 끝에 완독 블록과 커뮤니티 버튼이 나온다', async () => {
  const onOpenCommunity = vi.fn();
  renderView({ nextPage: null, onOpenCommunity });

  expect(screen.getByText('완독했어요')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: '다른 독자들과 이야기하기' });
  expect(button).toHaveAttribute('data-track', 'community-open');
  expect(screen.getByRole('button', { name: '책으로 돌아가기' })).toBeInTheDocument();
  await userEvent.click(button);
  expect(onOpenCommunity).toHaveBeenCalledTimes(1);
});

test('COMMUNITY: 마지막 페이지가 아니면 완독 블록이 없다', () => {
  renderView({ nextPage: 5, onOpenCommunity: () => {} });
  expect(screen.queryByText('완독했어요')).toBeNull();
  expect(screen.queryByRole('button', { name: '다른 독자들과 이야기하기' })).toBeNull();
});

test('COMMUNITY: 마지막 페이지여도 서버가 완독으로 알려 주지 않으면(onOpenCommunity 없음) 완독 블록·버튼이 0건', () => {
  renderView({ nextPage: null });
  expect(screen.queryByText('완독했어요')).toBeNull();
  expect(screen.queryByRole('button', { name: '다른 독자들과 이야기하기' })).toBeNull();
  expect(screen.queryByTestId('completion-block')).toBeNull();
});

test('COMMUNITY: 미완독 독자에게는 마지막 페이지 끝에 안내 문구도 버튼도 없다 (2026-11-18 대표 지시)', () => {
  renderView({ nextPage: null });
  expect(screen.queryByText('앞부분까지 모두 읽으면 완독자 이야기가 열려요')).toBeNull();
  expect(screen.queryByTestId('community-locked-hint')).toBeNull();
  expect(screen.queryByRole('button', { name: '다른 독자들과 이야기하기' })).toBeNull();
});

test('COMMUNITY: 완독 블록에 부연 설명 문구가 없다 (2026-11-18 대표 지시)', () => {
  renderView({ nextPage: null, onOpenCommunity: () => {} });
  expect(screen.getByText('완독했어요')).toBeInTheDocument();
  expect(screen.queryByText('끝까지 읽은 독자들의 추리와 감상을 만나 보세요.')).toBeNull();
});
