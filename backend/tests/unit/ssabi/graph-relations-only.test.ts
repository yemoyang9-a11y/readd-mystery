/**
 * 관계도는 관계만 — 2026-11-18 대표 지시
 *
 * "손을 맞잡는다"·"구해내려 한다" 같은 한 번 일어난 행동(kind=action, temporal_scope=event)은
 * 사건이지 관계가 아니다. 이미 저장된 행동 행이 있어도 관계도 간선·이력에 0건이어야 한다.
 * 상한(cutoff)은 repository가 그대로 건다 — 이 거름은 상한과 별개다(FR-SPL-002 🚦 무관).
 */
import { describe, test, expect } from '@jest/globals';
import { createGraphService } from '../../../src/modules/ssabi/graph.service';
import type { SsabiRepository } from '../../../src/modules/ssabi/repository';
import type { GraphEdge, RelationshipGraph } from '../../../src/shared/types';

const evidence = { source_page: 21, quote: '원문', start_char: 0, end_char: 2 };
const edge = (id: string, label: string, patch: Record<string, unknown> | null): GraphEdge =>
  ({
    id,
    source: 'mong',
    target: 'yu',
    label,
    established_page: 21,
    ...(patch === null
      ? {}
      : {
          semantics: {
            version: 2,
            direction: 'a_to_b',
            kind: 'emotion',
            relation_key: 'affection',
            summary: '이몽란은 유불란을 사랑한다.',
            assertion_status: 'fact',
            temporal_scope: 'ongoing',
            state: 'active',
            evidence,
            ...patch,
          },
        }),
  }) as GraphEdge;

function serviceReturning(edges: GraphEdge[]) {
  const graph: RelationshipGraph = { nodes: [], edges, history: edges, applied_cutoff: 46 };
  const repository = { getGraph: async () => graph } as unknown as SsabiRepository;
  return createGraphService({ repository });
}

describe('FR-CHR-001: 관계도는 관계만 보여 준다', () => {
  test('한 번 일어난 행동(action·event) 간선·이력 0건', async () => {
    const out = await serviceReturning([
      edge('hand', '손을 맞잡는다', {
        kind: 'action',
        relation_key: 'physical_contact',
        temporal_scope: 'event',
      }),
      edge('rescue', '구해내려 한다', { kind: 'action', relation_key: 'rescue' }),
      edge('once', '미워한다', { temporal_scope: 'event' }),
    ]).getGraph('book', 46);
    expect(out.edges).toHaveLength(0);
    expect(out.history).toHaveLength(0);
  });

  test('positive — 가족·사회·감정(사랑·의심) 관계와 의미 정보 없는 기존 행은 그대로 보인다', async () => {
    const out = await serviceReturning([
      edge('love', '사랑한다', {}),
      edge('doubt', '의심한다', { relation_key: 'suspicion' }),
      edge('marriage', '남편이다', { kind: 'family', relation_key: 'marriage', direction: 'undirected' }),
      edge('friend', '친구다', { kind: 'social', relation_key: 'friendship' }),
      edge('legacy', '아는 사이', null),
      edge('hand', '손을 맞잡는다', { kind: 'action', temporal_scope: 'event' }),
    ]).getGraph('book', 46);
    expect(out.edges.map((e) => e.id)).toEqual(['love', 'doubt', 'marriage', 'friend', 'legacy']);
    expect(out.history?.map((e) => e.id)).toEqual(['love', 'doubt', 'marriage', 'friend', 'legacy']);
    expect(out.applied_cutoff).toBe(46);
  });
});
