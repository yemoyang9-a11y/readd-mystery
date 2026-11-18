import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MobileBriefingView from './MobileBriefingView';
import type { BriefingResponse, ChapterSummary } from '../../types';

const chapters: ChapterSummary[] = [
  { chapter_no: 1, title: '인간기념물', start_page: 1, end_page: 10 },
  { chapter_no: 2, title: '생활 제일과', start_page: 11, end_page: 20 },
];

function briefing(overrides: Partial<BriefingResponse> = {}): BriefingResponse {
  return {
    applied_cutoff: 15,
    recap: '정주사는 미두장에서 재산을 잃었다.',
    current_chapter: { chapter_no: 2, title: '생활 제일과' },
    resume_chapter: { chapter_no: 2, title: '생활 제일과' },
    progress: { current_page: 15, total_pages: 20, percent: 75 },
    last_read_at: null,
    ...overrides,
  };
}

const baseProps = {
  chapters,
  onSelectChapter: () => {},
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
          resolved: false,
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

// 2026-11-18 대표 지시 — "브리핑 화면에서 어디까지 읽었는지 보고하는거 저거 빼고 현재 아모 빼".
// 진도 카드(장 제목·전체 쪽수·진도 바 위 아모·퍼센트)를 통째로 뺀다. 헤더·리캡·이어서 읽기는 남는다
test('2026-11-18: 다시 온 독자 브리핑에 진도 카드·진도 바·아모 표지·퍼센트가 없다', () => {
  const { container } = render(
    <MobileBriefingView
      {...baseProps}
      briefing={briefing({ progress: { current_page: 15, total_pages: 20, percent: 42.4 } })}
    />
  );
  expect(screen.queryByRole('region', { name: '진도' })).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByText('42%')).toBeNull();
  expect(screen.queryByText('20쪽')).toBeNull();
  expect(container.querySelector('img[src*="amo"], [data-testid*="runner"]')).toBeNull();
  // 남는 것 (positive 쌍)
  expect(screen.getByRole('heading', { name: /다시 오셨네요/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '그동안 이런 이야기였어요' })).toBeInTheDocument();
  expect(screen.getByText('정주사는 미두장에서 재산을 잃었다.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '이어서 읽기' })).toBeInTheDocument();
});

test('FR-NAV-001: 브리핑 목차는 전체 장을 보여 주고 서버가 준 지금 장을 표시하며, 고르면 그 장 첫 쪽으로 간다', async () => {
  const onSelectChapter = vi.fn();
  render(<MobileBriefingView {...baseProps} briefing={briefing()} onSelectChapter={onSelectChapter} />);
  await userEvent.click(screen.getByRole('button', { name: /목차/ }));
  const toc = screen.getByRole('list', { name: '목차' });
  expect(within(toc).getAllByRole('button')).toHaveLength(2);
  expect(within(toc).getByRole('button', { name: /생활 제일과/ })).toHaveAttribute('aria-current', 'true');
  await userEvent.click(within(toc).getByRole('button', { name: /인간기념물/ }));
  expect(onSelectChapter).toHaveBeenCalledWith(1);
});

test('브리핑에 그동안 이야기와 내 추리 노트가 함께 있다', () => {
  render(<MobileBriefingView {...baseProps} briefing={briefing()} />);
  expect(screen.getByRole('heading', { name: '그동안 이런 이야기였어요' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '내 추리 노트' })).toBeInTheDocument();
});

test('고정 문구 "3일 만이에요"는 그리지 않는다 — 마지막 읽은 시각이 없으면 경과 줄 자체가 없다', () => {
  render(<MobileBriefingView {...baseProps} briefing={briefing()} />);
  expect(screen.queryByText('3일 만이에요')).toBeNull();
  expect(screen.queryByTestId('since-last-read')).toBeNull();
  expect(screen.getByRole('heading', { name: /다시 오셨네요/ })).toBeInTheDocument();
});

test('서버가 준 마지막 읽은 시각으로 경과 안내를 만든다', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 17, 21, 0));
  try {
    const { rerender } = render(
      <MobileBriefingView {...baseProps} briefing={briefing()} lastReadAt={new Date(2026, 10, 12, 8, 0).toISOString()} />
    );
    expect(screen.getByTestId('since-last-read')).toHaveTextContent('5일 만이에요');
    rerender(
      <MobileBriefingView {...baseProps} briefing={briefing()} lastReadAt={new Date(2026, 10, 17, 7, 0).toISOString()} />
    );
    expect(screen.getByTestId('since-last-read')).toHaveTextContent('오늘 읽으셨네요');
  } finally {
    vi.useRealTimers();
  }
});

describe('처음 펼친 독자(진도 기록 없음, applied_cutoff 0)', () => {
  const first = () => briefing({ applied_cutoff: 0, recap: null });

  test('D13 ①: "처음 펼치시네요" 인사와 싸비 사용법 3단계를 보여 주고 리캡 폴백은 부르지 않는다', () => {
    const onRequestFallback = vi.fn();
    render(<MobileBriefingView {...baseProps} briefing={first()} onRequestFallback={onRequestFallback} />);
    expect(screen.getByRole('heading', { name: /처음 펼치시네요/ })).toBeInTheDocument();
    expect(screen.queryByText(/다시 오셨네요/)).toBeNull();
    expect(screen.queryByText('아직 읽은 내용이 없습니다')).toBeNull();
    expect(screen.queryByRole('heading', { name: '그동안 이런 이야기였어요' })).toBeNull();

    const guide = screen.getByRole('region', { name: '싸비 사용법' });
    const steps = within(guide).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent('읽은 쪽까지만 알려 줘요');
    expect(steps[1]).toHaveTextContent('단서와 가설을 노트에 적어요');
    expect(steps[2]).toHaveTextContent('아모에게 물어봐요');
    // 2026-11-18 대표 지시 — 단계별 회색 부연 설명은 없다
    expect(screen.queryByText(/판정하지 않아요/)).toBeNull();
    expect(screen.queryByText(/쪽수가 함께 남아서/)).toBeNull();
    expect(screen.queryByText(/뒤의 일은 꺼내지 않아요/)).toBeNull();

    expect(onRequestFallback).not.toHaveBeenCalled();
  });

  test('진도 카드와 경과 안내가 없고 아래 버튼은 읽기 시작이다', () => {
    render(<MobileBriefingView {...baseProps} briefing={first()} lastReadAt="2026-11-10T00:00:00.000Z" />);
    expect(screen.queryByRole('region', { name: '진도' })).toBeNull();
    expect(screen.queryByTestId('since-last-read')).toBeNull();
    expect(screen.getByRole('button', { name: '읽기 시작' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이어서 읽기' })).toBeNull();
  });

  test('R5: 서버가 준 작품 소개가 있으면 보여 주고, 없으면 그 칸을 그리지 않는다', () => {
    const { rerender } = render(
      <MobileBriefingView {...baseProps} briefing={first()} introduction="경성의 극장 해왕좌에서 벌어진 일." />
    );
    expect(screen.getByRole('region', { name: '작품 소개' })).toHaveTextContent('경성의 극장 해왕좌에서 벌어진 일.');

    rerender(<MobileBriefingView {...baseProps} briefing={first()} introduction={null} />);
    expect(screen.queryByRole('region', { name: '작품 소개' })).toBeNull();
    rerender(<MobileBriefingView {...baseProps} briefing={first()} introduction="   " />);
    expect(screen.queryByRole('region', { name: '작품 소개' })).toBeNull();
  });

  // 2026-11-17 대표 결정 — 첫 방문 브리핑에 배경지식도 보여 준다
  test('FR-BGK-002 R5: 서버가 준 배경지식이 있으면 작품 소개 아래에 보여 주고, 없으면 그 칸을 그리지 않는다', () => {
    const { rerender } = render(
      <MobileBriefingView
        {...baseProps}
        briefing={first()}
        introduction="경성의 극장 해왕좌에서 벌어진 일."
        background="1930년대 경성의 극장가."
      />
    );
    const intro = screen.getByRole('region', { name: '작품 소개' });
    const background = screen.getByRole('region', { name: '배경지식' });
    expect(background).toHaveTextContent('1930년대 경성의 극장가.');
    expect(intro.compareDocumentPosition(background) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(<MobileBriefingView {...baseProps} briefing={first()} introduction="소개" background={null} />);
    expect(screen.queryByRole('region', { name: '배경지식' })).toBeNull();
    rerender(<MobileBriefingView {...baseProps} briefing={first()} introduction="소개" background="  " />);
    expect(screen.queryByRole('region', { name: '배경지식' })).toBeNull();
    rerender(<MobileBriefingView {...baseProps} briefing={first()} introduction="소개" />);
    expect(screen.queryByRole('region', { name: '배경지식' })).toBeNull();
  });

  test('배경지식은 작품 소개가 없어도 보이고, 첫 방문이 아니면 보이지 않는다', () => {
    const { rerender } = render(
      <MobileBriefingView {...baseProps} briefing={first()} background="1930년대 경성의 극장가." />
    );
    expect(screen.getByRole('region', { name: '배경지식' })).toHaveTextContent('1930년대 경성의 극장가.');

    rerender(<MobileBriefingView {...baseProps} briefing={briefing()} background="1930년대 경성의 극장가." />);
    expect(screen.queryByRole('region', { name: '배경지식' })).toBeNull();
  });

  test('목차는 첫 방문에도 보이고 지금 장 표시는 없다', async () => {
    render(<MobileBriefingView {...baseProps} briefing={first()} />);
    await userEvent.click(screen.getByRole('button', { name: /목차/ }));
    const toc = screen.getByRole('list', { name: '목차' });
    expect(within(toc).getAllByRole('button')).toHaveLength(2);
    within(toc)
      .getAllByRole('button')
      .forEach((button) => expect(button).not.toHaveAttribute('aria-current'));
  });

  test('다시 온 독자에게는 사용법 안내를 띄우지 않는다', () => {
    render(<MobileBriefingView {...baseProps} briefing={briefing()} />);
    expect(screen.queryByRole('region', { name: '싸비 사용법' })).toBeNull();
    expect(screen.queryByText(/처음 펼치시네요/)).toBeNull();
  });
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
