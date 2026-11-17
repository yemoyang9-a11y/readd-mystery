import { render, screen, within } from '@testing-library/react';
import RelationDetails from './RelationDetails';
import { graphEdgeKey } from './graphEdges';
import { relationshipFixture } from './relationshipFixture';
import type { GraphEdge, GraphResponse } from '../../types';

const suspect: GraphEdge = {
  ...relationshipFixture('suspect', 7, {
    assertion_status: 'claim',
    reader_summary: '유불란은 나용귀를 범인으로 의심해요.',
  }),
  label: '범인으로 의심',
};
const friend: GraphEdge = {
  ...relationshipFixture('friend', 1, {
    assertion_status: 'fact',
    kind: 'social',
    relation_key: 'friend',
    reader_summary: '유불란과 박영민은 오랜 친구예요.',
  }),
  source: 'a',
  target: 'c',
  label: '친구',
};

const graph: GraphResponse = {
  nodes: [
    { id: 'a', name: '유불란', first_appearance_page: 1, aliases: [] },
    { id: 'b', name: '나용귀', first_appearance_page: 2, aliases: [] },
    { id: 'c', name: '박영민', first_appearance_page: 1, aliases: [] },
    { id: 'd', name: '경찰', first_appearance_page: 3, aliases: [] },
  ],
  edges: [suspect, friend],
};

function renderDetails(props: { selectedId?: string | null; selectedEdgeKey?: string | null; graph?: GraphResponse }) {
  return render(
    <RelationDetails
      graph={props.graph ?? graph}
      selectedId={props.selectedId ?? null}
      selectedEdgeKey={props.selectedEdgeKey ?? null}
    />
  );
}

describe('관계 설명 칸', () => {
  it('인물을 고르면 이어진 사람 목록이 나온다 — 상대 이름·관계 이름·사실 여부·독자용 문장', () => {
    renderDetails({ selectedId: 'a' });
    expect(screen.getByText('유불란과 이어진 사람')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const friendItem = items.find((li) => within(li).queryByText('박영민'))!;
    expect(within(friendItem).getByText('친구')).toBeInTheDocument();
    expect(within(friendItem).getByText('사실')).toBeInTheDocument();
    expect(within(friendItem).getByText('유불란과 박영민은 오랜 친구예요.')).toBeInTheDocument();
  });

  it('받침 없는 이름은 와', () => {
    renderDetails({ selectedId: 'b' });
    expect(screen.getByText('나용귀와 이어진 사람')).toBeInTheDocument();
  });

  it('fact가 아니면 의심·주장', () => {
    renderDetails({ selectedId: 'b' });
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('의심·주장')).toBeInTheDocument();
    expect(within(item).queryByText('사실')).toBeNull();
  });

  it('선을 고르면 그 관계 하나만 보인다', () => {
    renderDetails({ selectedId: 'a', selectedEdgeKey: graphEdgeKey(suspect) });
    expect(screen.getByText('유불란 · 나용귀')).toBeInTheDocument();
    expect(screen.queryByText(/이어진 사람/)).toBeNull();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText('범인으로 의심')).toBeInTheDocument();
    expect(within(items[0]).getByText('의심·주장')).toBeInTheDocument();
    expect(within(items[0]).getByText('유불란은 나용귀를 범인으로 의심해요.')).toBeInTheDocument();
  });

  it('reader_summary가 없으면 문장 없이 관계 이름만 보인다 — 원문 summary로 대신하지 않는다', () => {
    const noReader: GraphEdge = {
      ...suspect,
      semantics: { ...suspect.semantics!, reader_summary: undefined, summary: '원래 문장: 나는 가를 질투한다.' },
    };
    const { container } = renderDetails({ selectedId: 'b', graph: { ...graph, edges: [noReader] } });
    expect(screen.getByText('범인으로 의심')).toBeInTheDocument();
    expect(container.textContent).not.toContain('원래 문장');
  });

  it('semantics가 없는 옛 관계는 관계 이름만 보인다', () => {
    const legacy: GraphEdge = { source: 'a', target: 'b', label: '지인', established_page: 2 };
    const { container } = renderDetails({ selectedId: 'a', graph: { ...graph, edges: [legacy] } });
    expect(screen.getByText('지인')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/사실|의심·주장/);
  });

  it('관계 없는 인물은 제목만 보인다', () => {
    renderDetails({ selectedId: 'd' });
    expect(screen.getByText('경찰과 이어진 사람')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  describe('제목의 별칭 — 서버가 기준점으로 걸러 준 aliases만 쓴다 (FR-CHR-001)', () => {
    const withAliases: GraphResponse = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === 'a' ? { ...node, aliases: ['유선생', '탐정'] } : node
      ),
    };

    it('인물을 고르면 제목이 이름 (별칭1·별칭2)이고 조사는 이름에 맞춘다', () => {
      renderDetails({ selectedId: 'a', graph: withAliases });
      expect(screen.getByRole('heading')).toHaveTextContent(/^유불란 \(유선생·탐정\)과 이어진 사람$/);
    });

    it('선을 고르면 양쪽 이름에 각자 별칭이 붙고, 별칭 없는 쪽은 이름만', () => {
      renderDetails({ selectedEdgeKey: graphEdgeKey(suspect), graph: withAliases });
      expect(screen.getByRole('heading')).toHaveTextContent(/^유불란 \(유선생·탐정\) · 나용귀$/);
    });

    it('별칭이 없으면 이름만 — 괄호가 없다', () => {
      renderDetails({ selectedId: 'b', graph: withAliases });
      expect(screen.getByRole('heading')).toHaveTextContent(/^나용귀와 이어진 사람$/);
      expect(screen.getByRole('heading').textContent).not.toMatch(/[()]/);
    });
  });

  it('아무것도 고르지 않으면 아무것도 그리지 않는다', () => {
    const { container } = renderDetails({});
    expect(container.textContent).toBe('');
  });
});
