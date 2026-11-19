import { graphMilestones, graphUpTo } from './graphFilter';
import type { GraphResponse } from '../../types';
import { relationshipFixture } from './relationshipFixture';

// 2026-11-19 대표 지시로 되살린 관계도 되감기 표시 필터의 시험 (피벗 전 graphFilter.test.ts의 되감기 부분)

describe('FR-CHR-001: 같은 관계 키에서 방향이 바뀌면 이전 관계를 대체한다 (서버와 같은 규칙)', () => {
  const nodes = [
    { id: 'a', name: '가', first_appearance_page: 1, aliases: [] },
    { id: 'b', name: '나', first_appearance_page: 1, aliases: [] },
  ];
  const at = (history: GraphResponse['edges'], page: number) =>
    graphUpTo({ nodes, edges: [], history, applied_cutoff: 90 }, page)
      .edges.map((e) => e.id)
      .sort();
  const oneway = relationshipFixture('oneway', 10, { relation_key: 'love' });
  const mutual = relationshipFixture('mutual', 50, { relation_key: 'love', direction: 'mutual' });

  it('한쪽 방향이 쌍방으로 바뀌면 그 시점부터 쌍방만 남고, 되감으면 한쪽 방향이 보인다', () => {
    expect(at([oneway, mutual], 30)).toEqual(['oneway']);
    expect(at([oneway, mutual], 50)).toEqual(['mutual']);
  });

  it('쌍방이 한쪽 방향으로 바뀌면 한쪽 방향만 남는다', () => {
    const before = relationshipFixture('mutual', 10, { relation_key: 'love', direction: 'mutual' });
    const after = relationshipFixture('oneway', 50, { relation_key: 'love' });
    expect(at([before, after], 50)).toEqual(['oneway']);
  });

  it('미확인 방향이 확정되면 확정된 관계만 남는다', () => {
    const unknown = relationshipFixture('unknown', 10, {
      relation_key: 'love',
      direction: 'unknown',
    });
    const known = relationshipFixture('known', 50, { relation_key: 'love', direction: 'a_to_b' });
    expect(at([unknown, known], 50)).toEqual(['known']);
  });

  it('양쪽 한쪽 방향 관계는 쌍방 하나로 함께 대체되고, 그 전에는 둘 다 보인다', () => {
    const aSide = relationshipFixture('a-side', 10, { relation_key: 'love', direction: 'a_to_b' });
    const bSide = relationshipFixture('b-side', 20, { relation_key: 'love' });
    expect(at([aSide, bSide, mutual], 30)).toEqual(['a-side', 'b-side']);
    expect(at([aSide, bSide, mutual], 50)).toEqual(['mutual']);
  });

  it('저장 순서가 뒤집힌 행도 같은 묶음으로 보고 대체한다', () => {
    const reversed = { ...mutual, source: 'b', target: 'a' };
    expect(at([oneway, reversed], 50)).toEqual(['mutual']);
  });
});

describe('FR-CHR-001: 읽은 범위의 관계 이력을 독립 관계별로 되감는다', () => {
  const initial = relationshipFixture('jealousy', 5, { relation_key: 'jealousy' });
  const event = relationshipFixture('matchmaking', 8, {
    relation_key: 'matchmaking',
    temporal_scope: 'event',
  });
  const ended = relationshipFixture('jealousy-ended', 12, {
    relation_key: 'jealousy',
    state: 'ended',
  });
  const historyGraph: GraphResponse = {
    nodes: [
      { id: 'a', name: '가', first_appearance_page: 1, aliases: [] },
      { id: 'b', name: '나', first_appearance_page: 2, aliases: [] },
    ],
    edges: [ended, event],
    history: [ended, initial, event],
    applied_cutoff: 15,
  };

  it('이전 감정과 뒤의 사건은 서로 덮지 않으며 종료 버전은 그 시점에만 선택한다', () => {
    expect(graphUpTo(historyGraph, 4).edges).toEqual([]);
    expect(graphUpTo(historyGraph, 5).edges.map((e) => e.id)).toEqual(['jealousy']);
    expect(
      graphUpTo(historyGraph, 8)
        .edges.map((e) => e.id)
        .sort()
    ).toEqual(['jealousy', 'matchmaking']);
    expect(
      graphUpTo(historyGraph, 12)
        .edges.map((e) => e.id)
        .sort()
    ).toEqual(['jealousy-ended', 'matchmaking']);
    expect(graphUpTo(historyGraph, 8).edges.every((e) => e.semantics?.state !== 'ended')).toBe(
      true
    );
  });

  it('이력과 서버가 준 현재 페이지를 눈금으로 쓰고 응답 메타데이터를 보존한다', () => {
    expect(graphMilestones(historyGraph)).toEqual([1, 2, 5, 8, 12, 15]);
    expect(graphUpTo(historyGraph, 8).applied_cutoff).toBe(15);
  });

  it('별칭별 공개 시점이 없는 응답은 과거 표시에서 별칭을 생략하고 현재에만 보여준다', () => {
    const withAlias = {
      ...historyGraph,
      nodes: historyGraph.nodes.map((node) => ({ ...node, aliases: ['늦은 별칭'] })),
    };
    expect(graphUpTo(withAlias, 8).nodes.every((node) => node.aliases.length === 0)).toBe(true);
    expect(graphUpTo(withAlias, 15).nodes.every((node) => node.aliases.includes('늦은 별칭'))).toBe(
      true
    );
  });

  it('별칭 공개 시점이 있으면 그 시점 전후에 해당 별칭만 숨기고 복원한다', () => {
    const withAlias = {
      ...historyGraph,
      nodes: historyGraph.nodes.map((node) => ({
        ...node,
        aliases: ['이른 별칭', '늦은 별칭'],
        alias_details: [
          { alias: '이른 별칭', first_appearance_page: 2 },
          { alias: '늦은 별칭', first_appearance_page: 10 },
        ],
      })),
    };
    expect(graphUpTo(withAlias, 8).nodes[0].aliases).toEqual(['이른 별칭']);
    expect(graphUpTo(withAlias, 10).nodes[0].aliases).toEqual(['이른 별칭', '늦은 별칭']);
    expect(graphMilestones(withAlias)).toContain(10);
  });
});

/**
 * 관계도 되감기 — 표시 필터.
 *
 * ⚠️ 이 테스트가 증명하는 것은 **받은 데이터 안에서 과거 시점을 고르는 동작**이지
 *    서버의 상한 강제가 아니다. 상한은 서버가 응답을 만들 때 이미 걸었고, 여기 들어오는
 *    입력은 전부 기준점 이하다.
 */
const graph: GraphResponse = {
  nodes: [
    { id: 'jeong', name: '정주사', first_appearance_page: 1, aliases: [] },
    { id: 'chobong', name: '초봉', first_appearance_page: 3, aliases: [] },
    { id: 'gyebong', name: '계봉', first_appearance_page: 8, aliases: [] },
  ],
  edges: [
    { source: 'jeong', target: 'chobong', label: '부녀', established_page: 3 },
    { source: 'jeong', target: 'gyebong', label: '부녀', established_page: 8 },
  ],
};

describe('graphMilestones — 관계도가 달라지는 지점', () => {
  it('인물 등장·관계 확립 페이지를 오름차순 중복 없이 모은다', () => {
    expect(graphMilestones(graph)).toEqual([1, 3, 8]);
  });

  it('빈 그래프면 눈금이 없다', () => {
    expect(graphMilestones({ nodes: [], edges: [] })).toEqual([]);
  });

  it('관계만 있는 페이지도 눈금이 된다 — 인물은 그대로인데 관계가 늘 수 있다', () => {
    const later: GraphResponse = {
      ...graph,
      edges: [
        ...graph.edges,
        { source: 'chobong', target: 'gyebong', label: '자매', established_page: 13 },
      ],
    };
    expect(graphMilestones(later)).toEqual([1, 3, 8, 13]);
  });
});

describe('graphUpTo — 과거 시점의 관계도', () => {
  it('그 시점에 아직 등장하지 않은 인물을 뺀다', () => {
    const early = graphUpTo(graph, 3);
    expect(early.nodes.map((n) => n.name)).toEqual(['정주사', '초봉']);
  });

  it('그 시점에 아직 확립되지 않은 관계를 뺀다', () => {
    const early = graphUpTo(graph, 3);
    expect(early.edges).toHaveLength(1);
    expect(early.edges[0].label).toBe('부녀');
  });

  it('한쪽 인물이 아직 없는 관계는 그리지 않는다', () => {
    // 관계는 1페이지에 확립됐다고 하지만 계봉은 8페이지에 등장한다 — 그릴 수 없다
    const odd: GraphResponse = {
      nodes: graph.nodes,
      edges: [{ source: 'jeong', target: 'gyebong', label: '부녀', established_page: 1 }],
    };
    expect(graphUpTo(odd, 1).edges).toHaveLength(0);
  });

  it('마지막 눈금에서는 받은 것 전부가 남는다 — 오른쪽 끝이 곧 현재 진도다', () => {
    const milestones = graphMilestones(graph);
    const full = graphUpTo(graph, milestones[milestones.length - 1]);
    expect(full.nodes).toHaveLength(graph.nodes.length);
    expect(full.edges).toHaveLength(graph.edges.length);
  });

  it('눈금보다 큰 값을 넣어도 받은 것 이상은 나오지 않는다 — 넘어갈 데이터가 없다', () => {
    const beyond = graphUpTo(graph, 9999);
    expect(beyond.nodes).toHaveLength(graph.nodes.length);
    expect(beyond.edges).toHaveLength(graph.edges.length);
  });
});

