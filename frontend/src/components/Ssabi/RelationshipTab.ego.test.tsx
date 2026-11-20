import { fireEvent, render, screen, within } from '@testing-library/react';
import RelationshipTab from './RelationshipTab';
import { relationshipFixture } from './relationshipFixture';
import type { GraphEdge, GraphResponse } from '../../types';

function edge(
  id: string,
  source: string,
  target: string,
  label: string,
  page: number,
  semantics: Parameters<typeof relationshipFixture>[2] = {}
): GraphEdge {
  return {
    ...relationshipFixture(id, page, { kind: 'social', direction: 'mutual', ...semantics }),
    source,
    target,
    label,
  };
}

const graph: GraphResponse = {
  nodes: [
    { id: 'yu', name: '유불란', first_appearance_page: 1, aliases: [] },
    { id: 'lee', name: '이몽란', first_appearance_page: 2, aliases: [] },
    { id: 'na', name: '나용귀', first_appearance_page: 3, aliases: [] },
    { id: 'baek', name: '백검사', first_appearance_page: 4, aliases: [] },
    { id: 'kim', name: '김영애', first_appearance_page: 5, aliases: [] },
  ],
  edges: [
    edge('a', 'yu', 'lee', '연인', 21, {
      relation_key: 'romance',
      assertion_status: 'fact',
      evidence: { source_page: 21, quote: '첫사랑, 잘 때면 반드시', start_char: 0, end_char: 10 },
      reader_evidence: '첫사랑',
      reader_explanation: '두 사람은 서로 아끼는 사이예요.',
    }),
    edge('b', 'lee', 'yu', '사랑', 46, {
      relation_key: 'loves',
      assertion_status: 'belief',
      attribution: '임경부',
      evidence: {
        source_page: 46,
        quote: '몽란을 끝없이 사랑하는 유불란',
        start_char: 0,
        end_char: 10,
      },
      reader_explanation: '임경부는 유불란이 몽란을 사랑한다고 생각해요.',
    }),
    edge('d', 'yu', 'na', '의심', 18, {
      relation_key: 'suspicion',
      assertion_status: 'claim',
      attribution: '유불란',
      evidence: {
        source_page: 18,
        quote: '그가 좌장을 죽인 범인이라면',
        start_char: 0,
        end_char: 10,
      },
    }),
    edge('e', 'na', 'baek', '고용', 10, { relation_key: 'employment', assertion_status: 'fact' }),
  ],
};

function renderMobile(onJump = vi.fn()) {
  const view = render(
    <div data-mobile="true">
      <RelationshipTab graph={graph} failed={false} onJump={onJump} />
    </div>
  );
  return { ...view, onJump };
}

describe('인물관계도 모바일 — 중심 인물 1명 + 직접 이어진 사람 (2026-11-19 승인 시안 C)', () => {
  it('"누구를 중심으로 볼까요" 제목과 인물 칩이 있고, 처음 중심은 연결이 가장 많은 인물이다', () => {
    renderMobile();
    expect(screen.getByText('누구를 중심으로 볼까요')).toBeInTheDocument();
    const chips = screen.getByRole('group', { name: '중심 인물' });
    expect(within(chips).getByRole('button', { name: '유불란' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(chips).getByRole('button', { name: '이몽란' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(within(chips).getByRole('button', { name: '모두' })).toBeInTheDocument();
  });

  it('그래프 설명에 직접 이어진 사람과 관계 수가 있고 선 이름표는 "연인 외 1"이다', () => {
    const { container } = renderMobile();
    expect(
      screen.getByRole('img', { name: /유불란을 중심으로 직접 이어진 2명/ })
    ).toBeInTheDocument();
    const labels = Array.from(container.querySelectorAll('[data-edge-label]')).map(
      (el) => el.textContent
    );
    expect(labels).toEqual(['연인 외 1', '의심']);
  });

  it('선 모양 범례 두 줄은 없고 칩 견본 두 개가 있다', () => {
    renderMobile();
    expect(screen.queryByLabelText('선 모양 범례')).toBeNull();
    expect(screen.queryByText('선 하나 = 두 사람')).toBeNull();
    expect(screen.getByText('본문에 쓰인 관계')).toBeInTheDocument();
    expect(screen.getByText('인물이 말하거나 짐작한 관계')).toBeInTheDocument();
  });

  it('인물 목록은 사람당 한 줄이고 관계 칩은 채움(사실)·점선(말·생각)으로 구분한다', () => {
    const { container } = renderMobile();
    const rows = container.querySelectorAll('details');
    expect(rows).toHaveLength(2);
    const lee = rows[0];
    expect(within(lee as HTMLElement).getByText('이몽란')).toBeInTheDocument();
    const chips = lee.querySelectorAll('summary [data-relation-chip]');
    expect(
      Array.from(chips).map((c) => [c.textContent, c.getAttribute('data-relation-chip')])
    ).toEqual([
      ['연인', 'fact'],
      ['사랑', 'claim'],
    ]);
  });

  it('줄을 펼치면 관계마다 출처 문구·쪽수·근거 문장이 나온다', () => {
    const { container } = renderMobile();
    const lee = container.querySelectorAll('details')[0] as HTMLElement;
    expect(within(lee).getByText('본문에서 확인')).toBeInTheDocument();
    expect(within(lee).getByText('임경부의 생각')).toBeInTheDocument();
    expect(within(lee).getByRole('button', { name: 'p.21 쪽으로 이동' })).toBeInTheDocument();
    expect(within(lee).getByRole('button', { name: 'p.46 쪽으로 이동' })).toBeInTheDocument();
  });

  it('reader_evidence가 있으면 원문 한 줄과 설명이 나오고 근거 문단 전체는 나오지 않는다', () => {
    const { container } = renderMobile();
    const lee = container.querySelectorAll('details')[0] as HTMLElement;
    const quote = within(lee).getByText('첫사랑');
    expect(quote.tagName).toBe('Q');
    expect(within(lee).getByText('두 사람은 서로 아끼는 사이예요.')).toBeInTheDocument();
    expect(lee.textContent).not.toContain('첫사랑, 잘 때면 반드시');
  });

  it('reader_evidence가 없으면 긴 원문(evidence.quote)은 DOM에 없고, 설명만 있으면 설명만 나온다', () => {
    const { container } = renderMobile();
    const lee = container.querySelectorAll('details')[0] as HTMLElement;
    expect(lee.textContent).not.toContain('몽란을 끝없이 사랑하는 유불란');
    expect(within(lee).getByText('임경부는 유불란이 몽란을 사랑한다고 생각해요.')).toBeInTheDocument();
    expect(lee.querySelectorAll('q')).toHaveLength(1);
  });

  it('reader_explanation이 없으면 설명 줄을 그리지 않는다', () => {
    const { container } = renderMobile();
    const na = container.querySelectorAll('details')[1] as HTMLElement;
    expect(na.querySelectorAll('q')).toHaveLength(0);
    expect(na.querySelectorAll('[data-relation-explanation]')).toHaveLength(0);
    expect(na.textContent).not.toContain('그가 좌장을 죽인 범인이라면');
  });

  it('원문 한 줄 앞에는 "원문", 설명 앞에는 "설명" 이름표가 있고, 없는 줄에는 이름표도 없다', () => {
    const { container } = renderMobile();
    const lee = container.querySelectorAll('details')[0] as HTMLElement;
    expect(within(lee).getAllByText('원문')).toHaveLength(1);
    expect(within(lee).getAllByText('설명')).toHaveLength(2);
    const na = container.querySelectorAll('details')[1] as HTMLElement;
    expect(within(na).queryByText('원문')).toBeNull();
    expect(within(na).queryByText('설명')).toBeNull();
  });

  it('쪽수 키캡을 누르면 그 쪽으로 이동한다(onJump)', () => {
    const { container, onJump } = renderMobile();
    const lee = container.querySelectorAll('details')[0] as HTMLElement;
    fireEvent.click(within(lee).getByRole('button', { name: 'p.46 쪽으로 이동' }));
    expect(onJump).toHaveBeenCalledWith(46);
  });

  it('직접 이어지지 않은 인물은 한 줄로 모이고, 눌러서 그 사람을 중심으로 바꿀 수 있다', () => {
    renderMobile();
    const others = screen.getByText(/유불란과 직접 이어지지 않은 인물/);
    expect(others).toBeInTheDocument();
    expect(
      within(others.parentElement as HTMLElement).getByRole('button', { name: '김영애' })
    ).toBeInTheDocument();
    fireEvent.click(
      within(others.parentElement as HTMLElement).getByRole('button', { name: '백검사' })
    );
    const chips = screen.getByRole('group', { name: '중심 인물' });
    expect(within(chips).getByRole('button', { name: '유불란' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(
      screen.getByRole('img', { name: /백검사를 중심으로 직접 이어진 1명/ })
    ).toBeInTheDocument();
  });

  it('칩을 누르면 중심 인물이 바뀐다', () => {
    renderMobile();
    const chips = screen.getByRole('group', { name: '중심 인물' });
    fireEvent.click(within(chips).getByRole('button', { name: '나용귀' }));
    expect(within(chips).getByRole('button', { name: '나용귀' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      screen.getByRole('img', { name: /나용귀를 중심으로 직접 이어진 2명/ })
    ).toBeInTheDocument();
  });

  it('"모두" 칩을 누르면 기존 전체 보기가 나온다', () => {
    renderMobile();
    fireEvent.click(screen.getByRole('button', { name: '모두' }));
    expect(
      screen.getByRole('heading', { name: '지금 누가 누구와 엮여 있을까요' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('선 모양 범례')).toBeInTheDocument();
  });

  it('모바일이 아니면 기존 화면 그대로다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);
    expect(
      screen.getByRole('heading', { name: '지금 누가 누구와 엮여 있을까요' })
    ).toBeInTheDocument();
    expect(screen.queryByText('누구를 중심으로 볼까요')).toBeNull();
  });
});
