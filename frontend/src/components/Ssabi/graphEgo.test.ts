import { relationshipFixture } from './relationshipFixture';
import { egoCandidates, egoPositions, egoView } from './graphEgo';
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
    edge('b', 'lee', 'yu', '사랑한다', 46, {
      relation_key: 'affection',
      assertion_status: 'belief',
      attribution: '임경부',
      evidence: {
        source_page: 46,
        quote: '몽란을 끝없이 사랑하는 유불란',
        start_char: 0,
        end_char: 10,
      },
    }),
    edge('a', 'yu', 'lee', '연인', 21, {
      relation_key: 'romance',
      assertion_status: 'fact',
      evidence: { source_page: 21, quote: '첫사랑', start_char: 0, end_char: 3 },
      reader_evidence: '첫사랑',
      reader_explanation: '두 사람은 서로 아끼는 사이예요.',
    }),
    edge('c', 'yu', 'lee', '사랑한다', 30, {
      relation_key: 'loves',
      assertion_status: 'claim',
      attribution: '이몽란',
    }),
    edge('d', 'yu', 'na', '의심', 18, {
      relation_key: 'suspicion',
      assertion_status: 'claim',
      attribution: '유불란',
    }),
    edge('e', 'na', 'baek', '고용', 10, { relation_key: 'employment', assertion_status: 'fact' }),
  ],
};

describe('인물관계도 중심 인물 보기 — FR-CHR-001', () => {
  it('중심 인물과 직접 이어진 사람만 이웃이 되고 나머지는 others에 모인다', () => {
    const view = egoView(graph, 'yu')!;
    expect(view.center.name).toBe('유불란');
    expect(view.neighbors.map((n) => n.node.name)).toEqual(['이몽란', '나용귀']);
    expect(view.others.map((n) => n.name)).toEqual(['백검사', '김영애']);
  });

  it('두 사람 사이 관계가 여러 개여도 선은 하나이고 이름표는 대표 관계와 개수(연인 외 2)다', () => {
    const lee = egoView(graph, 'yu')!.neighbors.find((n) => n.node.id === 'lee')!;
    expect(lee.relations).toHaveLength(3);
    expect(lee.lineLabel).toBe('연인 외 2');
    expect(lee.lineFilled).toBe(true);
  });

  it('관계가 하나면 이름표에 개수를 붙이지 않고, 사실이 없으면 선은 점선이다', () => {
    const na = egoView(graph, 'yu')!.neighbors.find((n) => n.node.id === 'na')!;
    expect(na.lineLabel).toBe('의심');
    expect(na.lineFilled).toBe(false);
  });

  it('관계는 쪽 순서로 놓이고 사실은 채운 칩, 그 밖은 점선 칩이며 출처·쪽수·근거를 가진다', () => {
    const lee = egoView(graph, 'yu')!.neighbors.find((n) => n.node.id === 'lee')!;
    expect(lee.relations.map((r) => r.edge.established_page)).toEqual([21, 30, 46]);
    const [fact, claim, belief] = lee.relations;
    expect(fact).toMatchObject({
      filled: true,
      source: '본문에서 확인',
      evidence: '첫사랑',
      explanation: '두 사람은 서로 아끼는 사이예요.',
      label: '연인',
      page: 21,
    });
    expect(claim).toMatchObject({ filled: false, source: '이몽란의 말', evidence: null });
    expect(belief).toMatchObject({
      filled: false,
      source: '임경부의 생각',
      evidence: null,
      explanation: null,
      page: 46,
    });
    expect(belief).not.toHaveProperty('quote');
  });

  it('의미 정보가 없는 기존 관계는 채운 칩이고 출처·쪽수·근거가 없다', () => {
    const legacy: GraphResponse = {
      nodes: graph.nodes,
      edges: [
        {
          id: 'old',
          source: 'yu',
          target: 'na',
          label: '친구',
          established_page: 3,
          semantics: null,
        },
      ],
    };
    const na = egoView(legacy, 'yu')!.neighbors[0];
    expect(na.relations[0]).toMatchObject({ filled: true, source: null,
      page: null,
      evidence: null,
      explanation: null,
    });
  });

  it('없는 인물을 중심으로 하면 null', () => {
    expect(egoView(graph, 'nobody')).toBeNull();
  });

  it('칩 후보는 관계가 하나라도 있는 인물만, 연결이 많은 순서다', () => {
    expect(egoCandidates(graph).map((n) => n.name)).toEqual([
      '유불란',
      '이몽란',
      '나용귀',
      '백검사',
    ]);
  });

  it('둘레 자리는 이웃 수만큼이고 4명이면 네 모서리다', () => {
    expect(egoPositions(0)).toEqual([]);
    const four = egoPositions(4);
    expect(four.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [282, 62],
      [282, 218],
      [70, 218],
      [70, 62],
    ]);
  });
});
