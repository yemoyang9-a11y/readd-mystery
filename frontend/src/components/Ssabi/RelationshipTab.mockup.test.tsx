import { fireEvent, render, screen, within } from '@testing-library/react';
import RelationshipTab from './RelationshipTab';
import { relationshipFixture } from './relationshipFixture';
import type { GraphEdge, GraphResponse } from '../../types';

/**
 * 인물관계도 — 2026-11-17 승인 시안(`docs/superpowers/specs/mockups-2026-11-17/readd-relationship-simple.html`
 * 관계도 화면). FR-CHR-001, NFR-USE-006.
 *
 * 중심 인물(ego)이 항상 한 명 있고, 처음에는 연결이 가장 많은 인물이다. 중심 인물과 닿은 선만 강조하고
 * 그 선 위에 관계 이름표를 붙인다. 실선은 사실, 점선은 의심·주장(사실이 아니거나 끝난 관계).
 */
function edge(
  id: string,
  source: string,
  target: string,
  label: string,
  semantics: Parameters<typeof relationshipFixture>[2] = {}
): GraphEdge {
  return { ...relationshipFixture(id, 3, semantics), source, target, label };
}

const graph: GraphResponse = {
  nodes: [
    { id: 'park', name: '박영민', first_appearance_page: 1, aliases: [] },
    { id: 'yu', name: '유불란', first_appearance_page: 2, aliases: [] },
    { id: 'lee', name: '이몽란', first_appearance_page: 2, aliases: [] },
    { id: 'na', name: '나용귀', first_appearance_page: 3, aliases: [] },
    { id: 'police', name: '경찰', first_appearance_page: 4, aliases: [] },
  ],
  edges: [
    edge('friend', 'park', 'yu', '친구', {
      assertion_status: 'fact',
      kind: 'social',
      relation_key: 'friend',
      direction: 'mutual',
      reader_summary: '유불란과 박영민은 오랜 친구예요.',
    }),
    edge('suspect', 'yu', 'na', '범인으로 의심', {
      assertion_status: 'claim',
      kind: 'action',
      relation_key: 'suspect',
      direction: 'a_to_b',
      reader_summary: '유불란은 나용귀를 범인으로 의심해요.',
    }),
    edge('lover', 'yu', 'lee', '연인', {
      assertion_status: 'fact',
      kind: 'emotion',
      relation_key: 'lover',
      direction: 'mutual',
      state: 'ended',
      reader_summary: '7년 전 연인이었던 두 사람이에요.',
    }),
    edge('spouse', 'lee', 'park', '부부', {
      assertion_status: 'fact',
      kind: 'family',
      relation_key: 'spouse',
      direction: 'mutual',
    }),
    edge('arrest', 'police', 'na', '체포', {
      assertion_status: 'fact',
      kind: 'action',
      relation_key: 'arrest',
      direction: 'a_to_b',
    }),
  ],
};

describe('인물관계도 시안 (2026-11-17 승인) — FR-CHR-001', () => {
  it('제목 질문 "지금 누가 누구와 엮여 있을까요"가 그래프 위에 있다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);
    expect(screen.getByRole('heading', { name: '지금 누가 누구와 엮여 있을까요' })).toBeInTheDocument();
  });

  it('FR-CHR-001: 처음 중심 인물은 연결이 가장 많은 인물이고, 누르지 않아도 이어진 사람 카드가 나온다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);
    // 유불란: 박영민·나용귀·이몽란 3명 — 가장 많다
    expect(screen.getByRole('button', { name: '유불란' })).toHaveAttribute('aria-pressed', 'true');
    const details = screen.getByRole('region', { name: '관계 설명' });
    expect(within(details).getByText('유불란과 이어진 사람')).toBeInTheDocument();
    const cards = within(details).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    const suspect = cards.find((li) => within(li).queryByText('나용귀'))!;
    expect(within(suspect).getByText('범인으로 의심')).toBeInTheDocument();
    expect(within(suspect).getByText('의심·주장')).toBeInTheDocument();
    expect(within(suspect).getByText('유불란은 나용귀를 범인으로 의심해요.')).toBeInTheDocument();
    const friend = cards.find((li) => within(li).queryByText('박영민'))!;
    expect(within(friend).getByText('사실')).toBeInTheDocument();
  });

  it('인물을 누르면 그 인물이 중심이 되고, 중심 인물을 다시 눌러도 중심으로 남는다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);
    const na = screen.getByRole('button', { name: '나용귀' });
    fireEvent.click(na);
    expect(na).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '유불란' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('나용귀와 이어진 사람')).toBeInTheDocument();

    fireEvent.click(na);
    expect(na).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('나용귀와 이어진 사람')).toBeInTheDocument();
  });

  it('인물 칩에는 이름 첫 글자가 크게, 이름이 아래에 작게 나온다', () => {
    const { container } = render(<RelationshipTab graph={graph} failed={false} />);
    const ego = container.querySelector('[data-node-id="yu"]')!;
    expect(ego.querySelector('[data-node-initial]')).toHaveTextContent('유');
    expect(ego.querySelector('[data-node-name]')).toHaveTextContent('유불란');
    expect(ego.querySelector('rect[data-node-chip]')).not.toBeNull();
    // 중심 인물의 칩이 다른 인물보다 크다
    const other = container.querySelector('[data-node-id="police"] rect[data-node-chip]')!;
    const egoChip = ego.querySelector('rect[data-node-chip]')!;
    expect(Number(egoChip.getAttribute('width'))).toBeGreaterThan(Number(other.getAttribute('width')));
  });

  it('NFR-USE-006: 중심 인물과 닿은 선에만 관계 이름표가 붙고, 닿지 않은 선은 이름표가 없다', () => {
    const { container } = render(<RelationshipTab graph={graph} failed={false} />);
    const labels = [...container.querySelectorAll('[data-edge-label]')].map((el) => el.textContent);
    expect(labels.sort()).toEqual(['범인으로 의심', '연인', '친구'].sort());
    expect(labels).not.toContain('부부');
    expect(labels).not.toContain('체포');

    // 중심을 경찰로 바꾸면 체포 이름표가 나오고 친구 이름표는 사라진다
    fireEvent.click(screen.getByRole('button', { name: '경찰' }));
    const after = [...container.querySelectorAll('[data-edge-label]')].map((el) => el.textContent);
    expect(after).toEqual(['체포']);
  });

  it('중심 인물과 닿은 선은 강조색, 닿지 않은 선은 옅은 선이다', () => {
    const { container } = render(<RelationshipTab graph={graph} failed={false} />);
    expect(container.querySelector('[data-edge-id="friend"]')).toHaveAttribute('data-ego-edge', 'true');
    expect(container.querySelector('[data-edge-id="friend"]')!.getAttribute('class')).toContain(
      'stroke-brief-accent'
    );
    expect(container.querySelector('[data-edge-id="spouse"]')).toHaveAttribute('data-ego-edge', 'false');
    expect(container.querySelector('[data-edge-id="spouse"]')!.getAttribute('class')).not.toContain(
      'stroke-brief-accent'
    );
  });

  it('FR-CHR-001: 사실은 실선, 의심·주장(사실이 아님)과 끝난 관계는 점선이다', () => {
    const { container } = render(<RelationshipTab graph={graph} failed={false} />);
    expect(container.querySelector('[data-edge-id="friend"]')).not.toHaveAttribute('stroke-dasharray');
    expect(container.querySelector('[data-edge-id="spouse"]')).not.toHaveAttribute('stroke-dasharray');
    expect(container.querySelector('[data-edge-id="suspect"]')).toHaveAttribute('stroke-dasharray');
    expect(container.querySelector('[data-edge-id="lover"]')).toHaveAttribute('stroke-dasharray');
  });

  it('범례는 한 줄 — 사실 · 의심·주장. 데이터가 없는 "지난번 이후 새로"는 넣지 않는다', () => {
    render(<RelationshipTab graph={graph} failed={false} />);
    const legend = screen.getByRole('list', { name: '선 모양 범례' });
    expect(within(legend).getByText('사실')).toBeInTheDocument();
    expect(within(legend).getByText('의심·주장')).toBeInTheDocument();
    expect(screen.queryByText(/지난번 이후/)).toBeNull();
  });

  it('회색 부연 문구를 두지 않는다 (DESIGN.md 2026-11-18 대표 지시)', () => {
    render(<RelationshipTab graph={graph} failed={false} />);
    expect(screen.queryByText(/화살표는 감정·행동의 방향/)).toBeNull();
    expect(screen.queryByText(/인물을 선택하면/)).toBeNull();
    expect(screen.queryByText(/두 손가락으로 확대/)).toBeNull();
    expect(screen.queryByText(/이전 관계 이력이 없는 응답/)).toBeNull();
    expect(screen.queryByText(/끌어서 이동/)).toBeNull();
  });

  it('FR-SPL-002 🚦: 받은 그래프의 인물·관계만 그린다 — 응답에 없는 인물은 0명, 있는 인물은 전부', () => {
    const { container, rerender } = render(<RelationshipTab graph={graph} failed={false} />);
    // positive — 받은 5명이 모두 그려진다
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(5);
    // negative — 경찰·체포가 없는(기준점 아래) 응답이면 화면에도 0건
    const earlier: GraphResponse = {
      nodes: graph.nodes.filter((n) => n.id !== 'police'),
      edges: graph.edges.filter((e) => e.id !== 'arrest'),
    };
    rerender(<RelationshipTab graph={earlier} failed={false} />);
    expect(container.querySelectorAll('[data-node-id="police"]')).toHaveLength(0);
    expect(screen.queryByText('체포')).toBeNull();
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(4);
  });
});
