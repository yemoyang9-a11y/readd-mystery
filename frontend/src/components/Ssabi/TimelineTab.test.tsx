import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimelineTab from './TimelineTab';
import type { TimelineResponse } from '../../types';

// 서버가 기준점 K=30으로 걸러 준 응답의 대역 — 1·2장은 다 읽음, 3장은 읽는 중
const timeline: TimelineResponse = {
  chapters: [
    { chapter_no: 1, title: '무대에 올려진 살인 사건', start_page: 1, end_page: 10, completed: true, summary: '좌장이 살해되고 아내가 붙잡혀요.' },
    { chapter_no: 2, title: '무대 위의 자백', start_page: 11, end_page: 20, completed: true, summary: '배우가 대본에 없던 말을 해요.' },
    { chapter_no: 3, title: '7년 만의 재회', start_page: 21, end_page: 40, completed: false, summary: null },
  ],
  events: [
    { id: 'e3', event: '좌장 살해', description: '좌장이 자기 집에서 숨진 채 발견돼요.', occurrence_page: 3 },
    { id: 'e5', event: '아내 체포', description: '경찰이 아내를 붙잡아요.', occurrence_page: 5 },
    { id: 'e14', event: '무대 위 자백', description: null, occurrence_page: 14 },
  ],
  applied_cutoff: 30,
};

describe('타임라인 탭 — 2026-11-18 승인 시안 A안 (결정 31)', () => {
  it('제목은 "지금까지, 세 장이에요" — 받은 장 수를 시안 말투로', () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    expect(screen.getByRole('heading', { name: '지금까지, 세 장이에요' })).toBeInTheDocument();
  });

  it('다 읽은 장마다 "N장"·장 제목·요약·"이 장의 사건"(사건 이름과 쪽)을 차례로 보여 준다', () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    const first = within(items[0]);
    expect(first.getByText('1장')).toBeInTheDocument();
    expect(first.getByText('무대에 올려진 살인 사건')).toBeInTheDocument();
    expect(first.getByText('좌장이 살해되고 아내가 붙잡혀요.')).toBeInTheDocument();
    expect(first.getByText('이 장의 사건')).toBeInTheDocument();
    expect(first.getByRole('button', { name: /좌장 살해\s*3쪽/ })).toBeInTheDocument();
    expect(first.getByRole('button', { name: /아내 체포\s*5쪽/ })).toBeInTheDocument();
    // 사건은 서버가 준 장 범위로만 묶인다 — 2장 사건이 1장 칸에 섞이지 않는다
    expect(first.queryByText('무대 위 자백')).not.toBeInTheDocument();
    expect(within(items[1]).getByText('무대 위 자백')).toBeInTheDocument();
  });

  it('사건을 누르면 그 자리에서 짧은 설명이 펼쳐지고(창·시트 없음), 다시 누르면 접힌다', async () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    const event = screen.getByRole('button', { name: /좌장 살해/ });
    expect(event).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('좌장이 자기 집에서 숨진 채 발견돼요.')).not.toBeInTheDocument();

    await userEvent.click(event);
    expect(event).toHaveAttribute('aria-expanded', 'true');
    const description = screen.getByText('좌장이 자기 집에서 숨진 채 발견돼요.');
    // 사건 칸 안, 그 사건 바로 아래에 붙는다 — 이동·모달 없이 칸 높이만 늘어난다
    expect(event.parentElement?.contains(description)).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(event);
    expect(event).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('좌장이 자기 집에서 숨진 채 발견돼요.')).not.toBeInTheDocument();
  });

  it('여러 사건을 따로 펼쳐 둘 수 있다', async () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    await userEvent.click(screen.getByRole('button', { name: /좌장 살해/ }));
    await userEvent.click(screen.getByRole('button', { name: /아내 체포/ }));
    expect(screen.getByText('좌장이 자기 집에서 숨진 채 발견돼요.')).toBeInTheDocument();
    expect(screen.getByText('경찰이 아내를 붙잡아요.')).toBeInTheDocument();
  });

  it('독자용 설명이 없는 사건은 펼치는 버튼 없이 이름과 쪽만 보인다', () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    expect(screen.getByText('무대 위 자백')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /무대 위 자백/ })).not.toBeInTheDocument();
  });

  it('읽는 중인 장은 "지금 읽는 곳 · N장"과 "다 읽으면 정리돼요"만 — 제목·요약·사건 칸이 없다', () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    const now = screen.getAllByRole('listitem')[2];
    expect(within(now).getByText('지금 읽는 곳 · 3장')).toBeInTheDocument();
    expect(within(now).getByText('다 읽으면 정리돼요')).toBeInTheDocument();
    expect(within(now).queryByText('7년 만의 재회')).not.toBeInTheDocument();
    expect(within(now).queryByText('이 장의 사건')).not.toBeInTheDocument();
    // 지금 읽는 곳의 점은 강조색으로 채운다
    expect(now.querySelector('span[aria-hidden="true"]')?.className).toContain('bg-brief-accent');
  });

  it('FR-SPL-002 🚦: 받은 응답의 사건만 그린다 — 응답에 없는 사건 0건, 있는 사건은 전부', () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    for (const e of timeline.events) expect(screen.getByText(e.event)).toBeInTheDocument();
    expect(screen.getAllByText(/쪽$/)).toHaveLength(timeline.events.length);
  });

  it('FR-BRF-005 🚦: 다 읽었는지는 서버 completed만 따른다 — 쪽수로 다시 판정하지 않는다', () => {
    const allDone: TimelineResponse = {
      ...timeline,
      chapters: timeline.chapters.map((c) => ({ ...c, completed: true })),
    };
    render(<TimelineTab timeline={allDone} failed={false} />);
    expect(screen.queryByText(/지금 읽는 곳/)).not.toBeInTheDocument();
    expect(screen.getByText('7년 만의 재회')).toBeInTheDocument();
  });

  it('장이 하나도 없으면(진도 없음) 빈 상태 문구만', () => {
    render(<TimelineTab timeline={{ chapters: [], events: [], applied_cutoff: 0 }} failed={false} />);
    expect(screen.getByText('아직 정리된 장이 없어요')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('FR-SPL-005 🚦: 조회에 실패하면 미노출 안내만 보인다', () => {
    render(<TimelineTab timeline={null} failed />);
    expect(screen.getByRole('alert')).toHaveTextContent('타임라인을 불러오지 못했어요');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('열 장이 넘으면 숫자로 센다', () => {
    const many: TimelineResponse = {
      chapters: Array.from({ length: 12 }, (_, i) => ({
        chapter_no: i + 1,
        title: `${i + 1}번째`,
        start_page: i + 1,
        end_page: i + 1,
        completed: true,
        summary: null,
      })),
      events: [],
      applied_cutoff: 12,
    };
    render(<TimelineTab timeline={many} failed={false} />);
    expect(screen.getByRole('heading', { name: '지금까지, 12개 장이에요' })).toBeInTheDocument();
  });
});
