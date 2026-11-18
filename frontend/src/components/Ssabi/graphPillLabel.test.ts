import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '../../types';
import { graphPillLabel, groupPillLabels } from './graphEdges';

function edge(source: string, target: string, label: string, relation_key?: string): GraphEdge {
  return {
    id: `${source}-${target}-${label}`,
    source,
    target,
    label,
    established_page: 1,
    ...(relation_key
      ? {
          semantics: {
            version: 2,
            kind: 'emotion',
            relation_key,
            direction: 'a_to_b',
            assertion_status: 'fact',
            temporal_scope: 'ongoing',
            state: 'active',
          },
        }
      : {}),
  } as unknown as GraphEdge;
}

describe('FR-CHR-001: 관계도 선 위 이름표는 시안처럼 짧은 이름', () => {
  it('알려진 관계 키는 짧은 이름 — 남편이다 → 부부, 친구다 → 친구', () => {
    expect(graphPillLabel(edge('a', 'b', '남편이다', 'marriage'))).toBe('부부');
    expect(graphPillLabel(edge('a', 'b', '친구다', 'friendship'))).toBe('친구');
    expect(graphPillLabel(edge('a', 'b', '사랑한다', 'affection'))).toBe('사랑');
  });

  it('모르는 관계 키나 의미 정보가 없으면 원래 이름 그대로 — 지어내지 않는다', () => {
    expect(graphPillLabel(edge('a', 'b', '빚을 졌다', 'debt_unknown_key'))).toBe('빚을 졌다');
    expect(graphPillLabel(edge('a', 'b', '부녀'))).toBe('부녀');
  });

  it('같은 두 사람 사이 관계가 여럿이면 이름표 하나로 묶는다 (방향 무관, 같은 이름은 한 번)', () => {
    const edges = [
      edge('a', 'b', '사랑한다', 'affection'),
      edge('b', 'a', '사랑한다', 'affection'),
      edge('a', 'b', '손을 잡아준다', 'physical_contact'),
      edge('a', 'c', '친구다', 'friendship'),
    ];
    const groups = groupPillLabels(edges);
    expect(groups.get(JSON.stringify(['a', 'b']))).toBe('사랑 · 손잡음');
    expect(groups.get(JSON.stringify(['a', 'c']))).toBe('친구');
  });

  it('셋 이상이면 앞 둘과 남은 수', () => {
    const edges = [
      edge('a', 'b', '사랑한다', 'affection'),
      edge('a', 'b', '미워한다', 'hatred'),
      edge('a', 'b', '구해내려 한다', 'rescue'),
    ];
    expect(groupPillLabels(edges).get(JSON.stringify(['a', 'b']))).toBe('사랑 · 미움 +1');
  });
});
