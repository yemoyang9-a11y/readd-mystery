import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimelineTab from './TimelineTab';
import type { TimelineResponse } from '../../types';

// 서버가 기준점 K=30으로 걸러 준 응답의 대역 — 1·2장은 다 읽음, 3장은 읽는 중
const timeline: TimelineResponse = {
  chapters: [
    { chapter_no: 1, title: '무대에 올려진 살인 사건', start_page: 1, end_page: 10, completed: true, summary: '좌장이 살해되고 아내가 붙잡혀요. 경찰은 아내를 의심해요.', key_point: null },
    { chapter_no: 2, title: '무대 위의 자백', start_page: 11, end_page: 20, completed: true, summary: '배우가 대본에 없던 말을 해요.', key_point: null },
    { chapter_no: 3, title: '7년 만의 재회', start_page: 21, end_page: 40, completed: false, summary: null, key_point: null },
  ],
  events: [
    { id: 'e3', event: '좌장 살해', description: '좌장이 자기 집에서 숨진 채 발견돼요.', occurrence_page: 3 },
    { id: 'e5', event: '아내 체포', description: '경찰이 아내를 붙잡아요.', occurrence_page: 5 },
    { id: 'e14', event: '무대 위 자백', description: null, occurrence_page: 14 },
  ],
  applied_cutoff: 30,
};

describe('타임라인 탭 — 2026-11-18 대표 승인 시안 2차 A안 (장 누르면 사건 카드, 카드 누르면 그 자리 상세)', () => {
  const chapterButton = (no: number) => screen.getByRole('button', { name: new RegExp(`^${no}장`) });

  it('제목은 "지금까지, 세 장이에요" — 받은 장 수를 시안 말투로', () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    expect(screen.getByRole('heading', { name: '지금까지, 세 장이에요' })).toBeInTheDocument();
  });

  it('다 읽은 장은 "N장 · p.시작–끝"·제목·핵심 한 줄·사건 수만 보이고, 사건 카드는 접혀 있다', () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    const first = within(screen.getAllByRole('listitem')[0]);
    expect(first.getByText('1장 · p.1–10')).toBeInTheDocument();
    expect(first.getByText('무대에 올려진 살인 사건')).toBeInTheDocument();
    expect(first.getByText('사건 2')).toBeInTheDocument();
    expect(chapterButton(1)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /좌장 살해/ })).not.toBeInTheDocument();
  });

  it('핵심 한 줄 = 서버가 준 요약의 첫 문장만 — 긴 요약 전체를 늘어놓지 않는다', () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    expect(screen.getByText('좌장이 살해되고 아내가 붙잡혀요.')).toBeInTheDocument();
    expect(screen.queryByText(/경찰은 아내를 의심해요/)).not.toBeInTheDocument();
  });

  // 2026-11-18 대표 승인 시안 2차 A안 — 장마다 따로 만든 핵심 한 줄(key_point, 50자 안팎)
  it('서버가 핵심 한 줄(key_point)을 주면 요약 첫 문장 대신 그것을 보인다 — 요약은 보이지 않는다', () => {
    const withKeyPoint: TimelineResponse = {
      ...timeline,
      chapters: timeline.chapters.map((c) =>
        c.chapter_no === 1 ? { ...c, key_point: '좌장이 숨진 채 발견되고 아내가 붙잡혀요.' } : c
      ),
    };
    render(<TimelineTab timeline={withKeyPoint} failed={false} />);
    const first = within(screen.getAllByRole('listitem')[0]);
    expect(first.getByText('좌장이 숨진 채 발견되고 아내가 붙잡혀요.')).toBeInTheDocument();
    expect(first.queryByText('좌장이 살해되고 아내가 붙잡혀요.')).not.toBeInTheDocument();
    // 핵심 한 줄이 없는 장은 지금처럼 요약 첫 문장
    const second = within(screen.getAllByRole('listitem')[1]);
    expect(second.getByText('배우가 대본에 없던 말을 해요.')).toBeInTheDocument();
  });

  it('핵심 한 줄은 같은 자리·같은 모양 — 장 버튼 안 한 줄로만 그린다', () => {
    const withKeyPoint: TimelineResponse = {
      ...timeline,
      chapters: timeline.chapters.map((c) =>
        c.chapter_no === 1 ? { ...c, key_point: '좌장이 숨진 채 발견되고 아내가 붙잡혀요.' } : c
      ),
    };
    const { unmount } = render(<TimelineTab timeline={withKeyPoint} failed={false} />);
    const kpLine = within(chapterButton(1)).getByText('좌장이 숨진 채 발견되고 아내가 붙잡혀요.');
    const kpClass = kpLine.className;
    unmount();
    render(<TimelineTab timeline={timeline} failed={false} />);
    const summaryLine = within(chapterButton(1)).getByText('좌장이 살해되고 아내가 붙잡혀요.');
    expect(kpClass).toBe(summaryLine.className);
  });

  it('FR-SPL-002 🚦: 읽는 중인 장은 key_point 가 실려 와도 그리지 않는다 — 서버 completed만 따른다', () => {
    const odd: TimelineResponse = {
      ...timeline,
      chapters: timeline.chapters.map((c) =>
        c.chapter_no === 3 ? { ...c, key_point: '읽는 중인 장의 핵심 한 줄이에요.' } : c
      ),
    };
    render(<TimelineTab timeline={odd} failed={false} />);
    expect(screen.queryByText('읽는 중인 장의 핵심 한 줄이에요.')).not.toBeInTheDocument();
    expect(screen.getByText('다 읽으면 정리돼요')).toBeInTheDocument();
  });

  it('장을 누르면 그 장의 사건 카드(이름·p.N)가 펼쳐지고, 다시 누르면 접힌다', async () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    await userEvent.click(chapterButton(1));
    expect(chapterButton(1)).toHaveAttribute('aria-expanded', 'true');
    const first = within(screen.getAllByRole('listitem')[0]);
    expect(first.getByRole('button', { name: /좌장 살해\s*p\.3/ })).toBeInTheDocument();
    expect(first.getByRole('button', { name: /아내 체포\s*p\.5/ })).toBeInTheDocument();
    // 사건은 서버가 준 장 범위로만 묶인다 — 2장 사건이 1장 칸에 섞이지 않는다
    expect(first.queryByText('무대 위 자백')).not.toBeInTheDocument();

    await userEvent.click(chapterButton(1));
    expect(chapterButton(1)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /좌장 살해/ })).not.toBeInTheDocument();
  });

  it('사건 카드를 누르면 그 자리에서 상세가 펼쳐지고(창·시트 없음), 다시 누르면 접힌다', async () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    await userEvent.click(chapterButton(1));
    const event = screen.getByRole('button', { name: /좌장 살해/ });
    expect(event).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('좌장이 자기 집에서 숨진 채 발견돼요.')).not.toBeInTheDocument();

    await userEvent.click(event);
    expect(event).toHaveAttribute('aria-expanded', 'true');
    const description = screen.getByText('좌장이 자기 집에서 숨진 채 발견돼요.');
    expect(event.contains(description) || event.parentElement?.contains(description)).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(event);
    expect(event).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('좌장이 자기 집에서 숨진 채 발견돼요.')).not.toBeInTheDocument();
  });

  it('여러 장·여러 사건을 따로 펼쳐 둘 수 있다', async () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    await userEvent.click(chapterButton(1));
    await userEvent.click(chapterButton(2));
    await userEvent.click(screen.getByRole('button', { name: /좌장 살해/ }));
    await userEvent.click(screen.getByRole('button', { name: /아내 체포/ }));
    expect(screen.getByText('좌장이 자기 집에서 숨진 채 발견돼요.')).toBeInTheDocument();
    expect(screen.getByText('경찰이 아내를 붙잡아요.')).toBeInTheDocument();
    expect(screen.getByText('무대 위 자백')).toBeInTheDocument();
  });

  it('독자용 설명이 없는 사건 카드는 누를 수 없고 이름과 p.N만 보인다', async () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    await userEvent.click(chapterButton(2));
    expect(screen.getByText('무대 위 자백')).toBeInTheDocument();
    expect(screen.getByText('p.14')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /무대 위 자백/ })).not.toBeInTheDocument();
  });

  it('읽는 중인 장은 "지금 읽는 곳 · N장"과 "다 읽으면 정리돼요"만 — 제목·요약·사건 칸이 없다', () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    const now = screen.getAllByRole('listitem')[2];
    expect(within(now).getByText('지금 읽는 곳 · 3장')).toBeInTheDocument();
    expect(within(now).getByText('다 읽으면 정리돼요')).toBeInTheDocument();
    expect(within(now).queryByText('7년 만의 재회')).not.toBeInTheDocument();
    expect(within(now).queryByRole('button')).not.toBeInTheDocument();
    expect(now.querySelector('span[aria-hidden="true"]')?.className).toContain('bg-brief-accent');
  });

  it('FR-SPL-002 🚦: 받은 응답의 사건만 그린다 — 다 펼쳤을 때 응답에 없는 사건 0건, 있는 사건은 전부', async () => {
    render(<TimelineTab timeline={timeline} failed={false} />);
    await userEvent.click(chapterButton(1));
    await userEvent.click(chapterButton(2));
    for (const e of timeline.events) expect(screen.getByText(e.event)).toBeInTheDocument();
    expect(screen.getAllByText(/^p\.\d+$/)).toHaveLength(timeline.events.length);
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
        key_point: null,
      })),
      events: [],
      applied_cutoff: 12,
    };
    render(<TimelineTab timeline={many} failed={false} />);
    expect(screen.getByRole('heading', { name: '지금까지, 12개 장이에요' })).toBeInTheDocument();
  });
});
