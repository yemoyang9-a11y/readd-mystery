import { fireEvent, render, screen, within } from '@testing-library/react';
import RelationshipTab from './RelationshipTab';
import type { GraphResponse } from '../../types';

const graph: GraphResponse = {
  nodes: [
    { id: 'c1', name: '정주사', first_appearance_page: 1, aliases: ['정 주사'] },
    { id: 'c2', name: '초봉', first_appearance_page: 3, aliases: [] },
  ],
  edges: [{ source: 'c1', target: 'c2', label: '부녀', established_page: 5 }],
};

it('renders graph after loading and after a position invalidates the previous graph', () => {
  const { rerender } = render(<RelationshipTab graph={null} failed={false} />);
  rerender(<RelationshipTab graph={graph} failed={false} />);
  expect(screen.getByRole('button', { name: '초봉' })).toBeInTheDocument();
  rerender(<RelationshipTab graph={null} failed={false} />);
  expect(screen.queryByRole('button', { name: '초봉' })).not.toBeInTheDocument();
  rerender(<RelationshipTab graph={graph} failed={false} />);
  expect(screen.getByRole('button', { name: '초봉' })).toBeInTheDocument();
});

// 되감기는 2026-11-19 대표 지시로 되살렸다 — 아래 '시점 되감기' 시험. 나머지 시안 밖 요소는 여전히 없다.
it('2026-11-18 대표 지시: 시안에 없는 요소가 없다 — 토글·인물 수·검색·인물 목록·확대/축소/전체 보기/전체화면·배율', () => {
  render(<RelationshipTab graph={graph} failed={false} />);
  expect(screen.queryByRole('button', { name: '주요인물' })).toBeNull();
  expect(screen.queryByRole('button', { name: '전체' })).toBeNull();
  expect(screen.queryByText(/^\d+명$/)).toBeNull();
  expect(screen.queryByLabelText('인물 검색')).toBeNull();
  expect(screen.queryByRole('region', { name: '인물' })).toBeNull();
  for (const name of ['확대', '축소', '전체 보기', '전체화면']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  expect(screen.queryByRole('toolbar')).toBeNull();
  expect(screen.queryByText(/^\d+%$/)).toBeNull();
});

it('범례·조작 안내 같은 회색 부연 문구가 없다 (2026-11-18 대표 지시) — 중심 인물이 늘 있어 선택 해제 버튼도 없다 (2026-11-17 시안)', () => {
  render(<RelationshipTab graph={graph} failed={false} />);
  expect(screen.queryByText(/화살표는 감정·행동의 방향/)).toBeNull();
  expect(screen.queryByText(/두 손가락으로 확대/)).toBeNull();
  expect(screen.queryByText(/별칭을 생략합니다/)).toBeNull();
  expect(screen.queryByRole('button', { name: '선택 해제' })).toBeNull();
});

/**
 * 인물 관계도 탭 — FR-SVB-002, FR-SPL-005 🚦, NFR-USE-006
 *
 * ⚠️ 인물 이름은 그래프 노드와 인물 카드 **양쪽**에 나온다. 전역 쿼리는 다중 매치로
 *    실패하므로 aria-label 로 구획한 영역 안에서 찾는다.
 */
describe('RelationshipTab', () => {
  it('NFR-USE-006: 인물을 선택하면 그래프에 관계 라벨이 글자로 나온다 — 색상만으로 구분하지 않는다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);
    fireEvent.click(screen.getByRole('button', { name: '정주사' }));

    expect(screen.getAllByText('부녀', { exact: false }).length).toBeGreaterThan(0);
  });

  it('설명 칸에 중심 인물과 이어진 사람이 나온다 — 처음 중심은 연결이 가장 많은(동점이면 먼저 등장한) 인물이다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);

    const details = screen.getByRole('region', { name: '관계 설명' });
    expect(within(details).getByText('정주사 (정 주사)와 이어진 사람')).toBeInTheDocument();
    expect(within(details).getByText('초봉')).toBeInTheDocument();
    expect(within(details).getByText('부녀')).toBeInTheDocument();
  });

  it('2026-11-19 대표 지시: 선택된 인물을 다시 누르면 선택이 풀려 아무도 선택되지 않는다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);

    const node = screen.getByRole('button', { name: '초봉' });
    fireEvent.click(node);
    expect(node).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: '관계 설명' })).toBeInTheDocument();

    fireEvent.click(node);
    expect(node).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '정주사' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: '관계 설명' })).toBeNull();

    // 다시 누르면 그 인물이 다시 선택된다
    fireEvent.click(node);
    expect(node).toHaveAttribute('aria-pressed', 'true');
  });

  it('2026-11-19 대표 지시: 처음 중심 인물(기본 선택)을 누르면 그 선택도 풀린다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);
    const ego = screen.getByRole('button', { name: '정주사' });
    expect(ego).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(ego);
    expect(ego).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: '관계 설명' })).toBeNull();
  });

  it('다른 인물을 연달아 눌러도 누른 인물이 선택된다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);

    const first = screen.getByRole('button', { name: '정주사' });
    const second = screen.getByRole('button', { name: '초봉' });
    fireEvent.click(first);
    fireEvent.click(second);

    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  it('인물은 그래프의 노드로 렌더된다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);

    expect(screen.getByRole('button', { name: '정주사' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '초봉' })).toBeInTheDocument();
  });

  it('FR-SPL-005 🚦: 조회 실패는 부분 표시로 넘어가지 않는다', () => {
    render(<RelationshipTab graph={null} failed={true} />);

    expect(screen.getByRole('alert')).toHaveTextContent('관계도를 불러오지 못했습니다');
    expect(screen.queryByText('정주사')).not.toBeInTheDocument();
    expect(screen.queryByText('부녀')).not.toBeInTheDocument();
  });

});

describe('인물관계도 선 선택', () => {
  it('선을 누르면 선택되고 다시 누르면 해제된다', () => {
    const { container } = render(<RelationshipTab graph={graph} failed={false} />);
    const edge = () => container.querySelector('[data-edge-id]') as SVGElement;
    expect(edge()).toHaveAttribute('data-selected', 'false');
    fireEvent.click(edge());
    expect(edge()).toHaveAttribute('data-selected', 'true');
    fireEvent.click(edge());
    expect(edge()).toHaveAttribute('data-selected', 'false');
  });

  it('선택한 선은 #ff5c7d 색과 3.6px 굵기이고 관계 이름표가 나온다', () => {
    // 중심 인물(정주사)과 닿지 않은 선(초봉–고태수, 김씨–고태수 중 하나)을 골라야 기본 선 굵기와 비교된다
    const four: GraphResponse = {
      nodes: [
        ...graph.nodes,
        { id: 'c3', name: '고태수', first_appearance_page: 4, aliases: [] },
        { id: 'c4', name: '김씨', first_appearance_page: 5, aliases: [] },
      ],
      edges: [
        { id: 'e1', source: 'c1', target: 'c2', label: '부녀', established_page: 5 },
        { id: 'e2', source: 'c1', target: 'c4', label: '이웃', established_page: 5 },
        { id: 'e3', source: 'c3', target: 'c4', label: '거래', established_page: 6 },
      ],
    };
    const { container } = render(<RelationshipTab graph={four} failed={false} />);
    const edge = container.querySelector('[data-edge-id="e3"]') as SVGElement;
    expect(edge).toHaveAttribute('data-ego-edge', 'false');
    // 굵기는 화면 배율 k를 곱한 값이라 기본 선(1.2px)과의 비로 확인한다
    const baseWidth = Number(edge.getAttribute('stroke-width'));
    fireEvent.click(edge);
    expect(edge.getAttribute('stroke')).toBe('#ff5c7d');
    expect(Number(edge.getAttribute('stroke-width')) / baseWidth).toBeCloseTo(3.6 / 1.2);
    expect(container.querySelector('[data-edge-label][data-selected="true"]')).not.toBeNull();
  });

  it('선택과 무관한 인물·선도 흐려지지 않는다', () => {
    const three: GraphResponse = {
      nodes: [...graph.nodes, { id: 'c3', name: '고태수', first_appearance_page: 4, aliases: [] }],
      edges: [...graph.edges, { source: 'c2', target: 'c3', label: '약혼', established_page: 6 }],
    };
    const { container } = render(<RelationshipTab graph={three} failed={false} />);
    fireEvent.click(screen.getByRole('button', { name: '정주사' }));
    for (const el of container.querySelectorAll('[data-node-id], [data-edge-id]')) {
      expect(el.getAttribute('opacity') ?? '1').toBe('1');
    }
  });

  it('선을 누르면 설명 칸이 그 관계 하나로 바뀌고, 인물을 고르면 선 선택이 풀린다', () => {
    const { container } = render(<RelationshipTab graph={graph} failed={false} />);
    fireEvent.click(container.querySelector('[data-edge-id]') as SVGElement);
    const details = screen.getByRole('region', { name: '관계 설명' });
    expect(within(details).getByText('정주사 (정 주사) · 초봉')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '초봉' }));
    expect(container.querySelector('[data-edge-id]')).toHaveAttribute('data-selected', 'false');
    expect(screen.getByText('초봉과 이어진 사람')).toBeInTheDocument();
  });

  it('이름표는 선 클릭을 가리지 않는다(pointer-events 없음)', () => {
    const { container } = render(<RelationshipTab graph={graph} failed={false} />);
    fireEvent.click(container.querySelector('[data-edge-id]') as SVGElement);
    const label = container.querySelector('[data-edge-label]');
    expect(label).toHaveAttribute('pointer-events', 'none');
  });
});

/**
 * 시점 되감기 — 2026-11-19 대표 지시로 피벗 전 방식 그대로 복원 (FR-SPL-002 🚦).
 *
 * ⚠️ 이 시험이 증명하는 것은 **받은 데이터(이미 기준점 이하) 안에서 과거 시점을 고르는 표시 필터**다.
 *    상한은 서버가 응답을 만들 때 이미 걸었다. negative(0건)는 positive와 쌍으로 둔다 (CLAUDE.md 7장).
 */
describe('시점 되감기', () => {
  // 서버가 기준점 p.9 이하로 걸러 준 응답이라고 본다 — 눈금: 1·3·5·8·9
  const rewindGraph: GraphResponse = {
    nodes: [
      { id: 'c1', name: '정주사', first_appearance_page: 1, aliases: [] },
      { id: 'c2', name: '초봉', first_appearance_page: 3, aliases: [] },
      { id: 'c3', name: '계봉', first_appearance_page: 5, aliases: [] },
    ],
    edges: [
      { id: 'e1', source: 'c1', target: 'c2', label: '부녀', established_page: 3 },
      { id: 'e2', source: 'c1', target: 'c3', label: '부녀', established_page: 8 },
    ],
    applied_cutoff: 9,
  };
  const edgeIds = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-edge-id]')].map((el) => el.getAttribute('data-edge-id'));
  const scrub = () => screen.getByLabelText('시점 되감기');
  const rewindTo = (index: number) => fireEvent.change(scrub(), { target: { value: String(index) } });

  it('되감기 슬라이더의 오른쪽 끝이 현재 진도다 — 처음에는 받은 것 전부가 보인다', () => {
    const { container } = render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={20} />);

    // 눈금은 받은 데이터에서 만들어진다 — 1·3·5·8·9(서버가 준 기준점)
    expect(scrub()).toHaveAttribute('max', '4');
    expect(scrub()).toHaveValue('4');
    expect(screen.getByText('현재까지')).toBeInTheDocument();
    expect(edgeIds(container).sort()).toEqual(['e1', 'e2']);
  });

  it('FR-SPL-002: p.5 시점에서는 p.5 뒤에 확립된 관계가 0건이다', () => {
    const { container } = render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={20} />);
    rewindTo(2); // p.5

    expect(screen.getByText('p.5 시점')).toBeInTheDocument();
    const later = rewindGraph.edges.filter((e) => e.established_page > 5).map((e) => e.id);
    expect(edgeIds(container).filter((id) => later.includes(id ?? ''))).toHaveLength(0);
  });

  it('FR-SPL-002 positive: p.5 시점에서도 p.5 이하에 확립된 관계와 인물은 보인다', () => {
    const { container } = render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={20} />);
    rewindTo(2); // p.5

    expect(edgeIds(container)).toEqual(['e1']);
    expect(screen.getByRole('button', { name: '계봉' })).toBeInTheDocument();
  });

  it('FR-SPL-002: p.1 시점에서는 그 뒤에 등장한 인물과 관계가 0건이다 — 앞으로 감으면 다시 보인다', () => {
    const { container } = render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={20} />);
    rewindTo(0);

    expect(screen.getByText('p.1 시점')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '정주사' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '초봉' })).toBeNull();
    expect(screen.queryByRole('button', { name: '계봉' })).toBeNull();
    expect(edgeIds(container)).toHaveLength(0);

    rewindTo(4);
    expect(screen.getByText('현재까지')).toBeInTheDocument();
    expect(edgeIds(container).sort()).toEqual(['e1', 'e2']);
  });

  it('손잡이 조작 범위는 읽은 범위까지다 — 끝보다 큰 값을 넣어도 받은 것 이상은 나오지 않는다', () => {
    const { container } = render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={20} />);
    // 조작 범위(max)는 눈금 개수 기준이다 — 전체 페이지 수(20)로 안 늘어난다
    expect(scrub()).toHaveAttribute('max', '4');
    rewindTo(99);
    expect(screen.getByText('현재까지')).toBeInTheDocument();
    expect(edgeIds(container).sort()).toEqual(['e1', 'e2']);
  });

  it('되감아도 서버에 다시 묻지 않는다 — 받은 자료 안의 표시 필터다', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={20} />);
      rewindTo(0);
      rewindTo(2);
      rewindTo(4);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('트랙은 p.1부터 전체 쪽수까지 그리고, 아직 못 읽은 구간은 조작할 수 없는 막대다', () => {
    render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={20} />);

    expect(screen.getByText('p.1')).toBeInTheDocument();
    expect(screen.getByText('p.20')).toBeInTheDocument();
    const unread = screen.getByTestId('graph-scrub-unread');
    expect(unread).toHaveAttribute('aria-hidden', 'true');
    // 폭은 정수 flexGrow(남은 쪽수) — % 계산 없음 (절대 규칙 2번)
    expect(unread.style.flexGrow).toBe('11');
    expect(unread.style.width).toBe('');
  });

  it('아직 못 읽은 구간이 없으면(totalPages 미제공) 비활성 막대를 그리지 않는다', () => {
    render(<RelationshipTab graph={rewindGraph} failed={false} />);

    expect(screen.getByText('p.9')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-scrub-unread')).toBeNull();
  });

  it('totalPages가 읽은 범위보다 작게 와도(있을 수 없는 값) 찌그러지지 않는다', () => {
    render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={2} />);

    expect(screen.getByText('p.9')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-scrub-unread')).toBeNull();
  });

  it('눈금이 2개 미만이면 되감기 막대를 그리지 않는다', () => {
    const single: GraphResponse = {
      nodes: [{ id: 'c1', name: '정주사', first_appearance_page: 1, aliases: [] }],
      edges: [],
    };
    render(<RelationshipTab graph={single} failed={false} totalPages={20} />);
    expect(screen.queryByLabelText('시점 되감기')).toBeNull();
  });

  it('되감기 슬라이더는 brief-accent 를 쓴다', () => {
    render(<RelationshipTab graph={rewindGraph} failed={false} />);
    expect(scrub().className).toContain('bg-brief-accent');
  });

  it('고른 인물이 그 시점에 아직 없으면 기본 중심 인물로 돌아가고, 앞으로 감으면 고른 인물이 복원된다', () => {
    render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={20} />);
    fireEvent.click(screen.getByRole('button', { name: '계봉' }));
    expect(screen.getByRole('button', { name: '계봉' })).toHaveAttribute('aria-pressed', 'true');

    rewindTo(1); // p.3 — 계봉은 아직 없다
    expect(screen.queryByRole('button', { name: '계봉' })).toBeNull();
    expect(screen.getByRole('button', { name: '정주사' })).toHaveAttribute('aria-pressed', 'true');
    const details = screen.getByRole('region', { name: '관계 설명' });
    expect(within(details).getByText('초봉')).toBeInTheDocument();
    expect(within(details).queryByText('계봉')).toBeNull();

    rewindTo(4);
    expect(screen.getByRole('button', { name: '계봉' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('되감아도 회색 부연 문구(별칭 생략 안내)가 나오지 않는다 (DESIGN.md 2026-11-18)', () => {
    render(<RelationshipTab graph={rewindGraph} failed={false} totalPages={20} />);
    rewindTo(0);
    expect(screen.queryByText(/별칭을 생략/)).toBeNull();
  });
});
