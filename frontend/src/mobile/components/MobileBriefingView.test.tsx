import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MobileBriefingView from './MobileBriefingView';
import type { BriefingResponse } from '../../types';

function briefing(overrides: Partial<BriefingResponse> = {}): BriefingResponse {
  return {
    applied_cutoff: 15,
    recap: '정주사는 미두장에서 재산을 잃었다.',
    current_chapter: { chapter_no: 2, title: '생활 제일과' },
    progress: { current_page: 15, total_pages: 20, percent: 75 },
    ...overrides,
  };
}

const baseProps = {
  title: '탁류',
  author: '채만식',
  coverUrl: null,
  onContinue: () => {},
  onRequestFallback: () => {},
  onBack: () => {},
  streamedRecap: '',
  recapFailed: false,
  recapStreaming: false,
  characterNames: [],
};

// FR-BRF-001
test('FR-BRF-001: 이어서 읽기 버튼은 화면 아래 고정 줄에 하나만 있다', () => {
  render(<MobileBriefingView {...baseProps} briefing={briefing()} />);

  const buttons = screen.getAllByRole('button', { name: '이어서 읽기' });
  expect(buttons).toHaveLength(1);
  const bar = buttons[0].closest('[data-testid="briefing-continue-bar"]');
  expect(bar).not.toBeNull();
  expect(bar).toHaveClass('fixed', 'bottom-0');
  expect(buttons[0].closest('section[aria-label="진도"]')).toBeNull();
});

// FR-SPL-005 🚦
test('FR-SPL-005: 줄거리가 없어도(recap null) 이어서 읽기 버튼이 눌린다', async () => {
  const onContinue = vi.fn();
  render(
    <MobileBriefingView
      {...baseProps}
      briefing={briefing({ recap: null, applied_cutoff: 0 })}
      onContinue={onContinue}
    />
  );

  await userEvent.click(screen.getByRole('button', { name: '읽기 시작' }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

// FR-SPL-005 🚦
test('FR-SPL-005: 줄거리를 불러오는 중이어도 이어서 읽기 버튼이 눌린다', async () => {
  const onContinue = vi.fn();
  render(
    <MobileBriefingView
      {...baseProps}
      briefing={briefing({ recap: null })}
      recapStreaming
      onContinue={onContinue}
    />
  );

  expect(screen.getByText('불러오는 중')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '이어서 읽기' }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

// FR-SPL-005 🚦
test('FR-SPL-005: 줄거리 불러오기에 실패해도 이어서 읽기 버튼이 눌린다', async () => {
  const onContinue = vi.fn();
  render(
    <MobileBriefingView
      {...baseProps}
      briefing={briefing({ recap: null })}
      recapFailed
      onContinue={onContinue}
    />
  );

  expect(screen.getByRole('alert')).toHaveTextContent('리캡을 불러오지 못했습니다');
  await userEvent.click(screen.getByRole('button', { name: '이어서 읽기' }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

// 2026-11-15 추리 전환
test('브리핑에 내 추리 노트 목록이 쪽수와 함께 나오고, 없으면 안내 문구가 나온다', () => {
  const { rerender } = render(<MobileBriefingView {...baseProps} briefing={briefing()} />);
  const empty = screen.getByRole('region', { name: '내 추리 노트' });
  expect(empty).toHaveTextContent('아직 적은 게 없어요.');

  rerender(
    <MobileBriefingView
      {...baseProps}
      briefing={briefing()}
      notes={[
        {
          note_id: 'n1',
          page_no: 7,
          kind: 'hypothesis',
          body: '범인은 왼손잡이',
          created_at: '2026-11-16T00:00:00.000Z',
          updated_at: '2026-11-16T00:00:00.000Z',
        },
      ]}
    />
  );
  const region = screen.getByRole('region', { name: '내 추리 노트' });
  expect(region).toHaveTextContent('범인은 왼손잡이');
  expect(region).toHaveTextContent('7쪽');
  expect(region).toHaveTextContent('가설');
});

test("2026-11-16 시안: 브리핑에는 장·진도 카드와 목차가 없고 그동안 이야기와 내 추리 노트만 있다", () => {
  render(<MobileBriefingView {...baseProps} briefing={briefing()} />);
  expect(screen.queryByRole('region', { name: '진도' })).toBeNull();
  expect(screen.queryByText(/제2장/)).toBeNull();
  expect(screen.queryByText('75%')).toBeNull();
  expect(screen.queryByRole('heading', { name: '목차' })).toBeNull();
  expect(screen.getByRole('heading', { name: '그동안 이런 이야기였어요' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '내 추리 노트' })).toBeInTheDocument();
});

test('COMMUNITY: 서버가 완독으로 알려 준 경우에만 커뮤니티 진입 버튼이 보인다', async () => {
  const { rerender } = render(<MobileBriefingView {...baseProps} briefing={briefing()} />);
  expect(screen.queryByRole('button', { name: /커뮤니티/ })).toBeNull();

  const onOpen = vi.fn();
  rerender(<MobileBriefingView {...baseProps} briefing={briefing()} onOpenCommunity={onOpen} />);
  const button = screen.getByRole('button', { name: /커뮤니티/ });
  expect(button).toHaveAttribute('data-track', 'community-open');
  await userEvent.click(button);
  expect(onOpen).toHaveBeenCalledTimes(1);
});
