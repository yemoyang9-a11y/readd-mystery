import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventSummary from './EventSummary';
import type { TimelineResponse } from '../../types';

const timeline: TimelineResponse = {
  applied_cutoff: 13,
  chapters: [
    { chapter_no: 1, title: '첫 장', start_page: 1, end_page: 9 },
    { chapter_no: 2, title: '둘째 장', start_page: 10, end_page: 25 },
  ],
  events: [
    { id: 'e1', event: '편지가 도착해요', description: '유불란에게 편지가 와요.', occurrence_page: 4 },
    { id: 'e2', event: '밤길 사건', description: null, occurrence_page: 9 },
    { id: 'e3', event: '두 번째 만남', description: '두 사람이 다시 만나요.', occurrence_page: 12 },
  ],
};

describe('사건 정리', () => {
  it('장 제목과 사건 이름을 장 순서대로 보여준다', () => {
    render(<EventSummary timeline={timeline} failed={false} />);
    expect(screen.getByText('지금까지, 2개 장면이에요')).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text.indexOf('첫 장')).toBeLessThan(text.indexOf('편지가 도착해요'));
    expect(text.indexOf('밤길 사건')).toBeLessThan(text.indexOf('둘째 장'));
    expect(text.indexOf('둘째 장')).toBeLessThan(text.indexOf('두 번째 만남'));
  });

  it('사건을 누르면 설명이 펼쳐지고 다른 사건을 누르면 바뀐다', async () => {
    const user = userEvent.setup();
    render(<EventSummary timeline={timeline} failed={false} />);
    expect(screen.queryByText('유불란에게 편지가 와요.')).toBeNull();
    await user.click(screen.getByRole('button', { name: /편지가 도착해요/ }));
    expect(screen.getByText('유불란에게 편지가 와요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /두 번째 만남/ }));
    expect(screen.queryByText('유불란에게 편지가 와요.')).toBeNull();
    expect(screen.getByText('두 사람이 다시 만나요.')).toBeInTheDocument();
  });

  it('설명이 null인 사건은 이름만 보인다', async () => {
    const user = userEvent.setup();
    const { container } = render(<EventSummary timeline={timeline} failed={false} />);
    await user.click(screen.getByRole('button', { name: /밤길 사건/ }));
    expect(screen.getByText('밤길 사건')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-event-description]')).toHaveLength(0);
  });

  it('마지막 장에만 지금 읽는 곳이 붙는다', () => {
    render(<EventSummary timeline={timeline} failed={false} />);
    expect(screen.getAllByText('지금 읽는 곳')).toHaveLength(1);
    const lastChapter = screen.getByText('둘째 장').closest('li') as HTMLElement;
    expect(within(lastChapter).getByText('지금 읽는 곳')).toBeInTheDocument();
  });

  it('사건이 아직 없는 지금 읽는 장에는 다 읽으면 정리된다는 한 줄만 보인다 (결정 31)', () => {
    const reading: TimelineResponse = {
      applied_cutoff: 13,
      chapters: timeline.chapters,
      events: timeline.events.filter((event) => event.id !== 'e3'),
    };
    render(<EventSummary timeline={reading} failed={false} />);
    const lastChapter = screen.getByText('둘째 장').closest('li') as HTMLElement;
    expect(within(lastChapter).getByText('이 장을 다 읽으면 사건이 정리돼요')).toBeInTheDocument();
    expect(within(lastChapter).queryAllByRole('button')).toHaveLength(0);
    const firstChapter = screen.getByText('첫 장').closest('li') as HTMLElement;
    expect(within(firstChapter).queryByText('이 장을 다 읽으면 사건이 정리돼요')).toBeNull();
  });

  it('지금 읽는 장에 사건이 있으면 안내 한 줄은 없다', () => {
    render(<EventSummary timeline={timeline} failed={false} />);
    expect(screen.queryByText('이 장을 다 읽으면 사건이 정리돼요')).toBeNull();
  });

  it('쪽수 문구가 없다', async () => {
    const user = userEvent.setup();
    const { container } = render(<EventSummary timeline={timeline} failed={false} />);
    await user.click(screen.getByRole('button', { name: /편지가 도착해요/ }));
    expect(container.textContent).not.toMatch(/\d+\s*쪽/);
  });

  it('장·사건 0개면 빈 상태 문구만', () => {
    render(<EventSummary timeline={{ applied_cutoff: 0, chapters: [], events: [] }} failed={false} />);
    expect(screen.getByText('아직 정리된 장면이 없어요')).toBeInTheDocument();
    expect(screen.queryByText(/개 장면이에요/)).toBeNull();
  });

  it('조회에 실패하면 미노출 안내만 보인다', () => {
    render(<EventSummary timeline={null} failed />);
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했어요');
  });
});
