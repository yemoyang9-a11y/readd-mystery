/**
 * GET /books/:bookId/ssabi/graph — 관계도 조회 (R3)
 *
 * 조항: FR-CHR-001, FR-SPL-002 🚦, A6
 */

import type { GraphEdge, RelationshipGraph } from '../../shared/types';
import type { SsabiRepository } from './repository';

export interface GraphServiceDeps {
  repository: SsabiRepository;
}

export interface GraphService {
  /**
   * 관계도 그래프 조회
   *
   * FR-SPL-002 🚦: cutoff 기준 필터링
   * A6: 관계는 최신 라벨만 표시
   *
   * @param bookId - 도서 ID
   * @param cutoff - 기준점 (스포일러 상한)
   * @returns 관계도 그래프 JSON
   */
  getGraph(bookId: string, cutoff: number): Promise<RelationshipGraph>;
}

/**
 * 관계도 서비스 생성
 */
export function createGraphService(deps: GraphServiceDeps): GraphService {
  const { repository } = deps;

  return {
    async getGraph(bookId: string, cutoff: number): Promise<RelationshipGraph> {
      // FR-SPL-002 🚦: repository.getGraph가 cutoff 적용
      const graph = await repository.getGraph(bookId, cutoff);
      // FR-CHR-001 — 관계도는 관계만(2026-11-18 대표 지시). 이미 저장된 한 번의 행동(손을 맞잡음 등)은
      // 사건이라 간선·이력에서 뺀다. 상한 필터가 아니라 표시 종류 거름이다(상한은 위 조회가 이미 걸었다).
      return {
        ...graph,
        edges: graph.edges.filter(isStandingRelationship),
        ...(graph.history ? { history: graph.history.filter(isStandingRelationship) } : {}),
      };
    },
  };
}

/** 지속되는 관계인가 — 한 번 일어난 행동(kind=action 또는 temporal_scope=event)이면 false. 의미 정보 없는 기존 행은 관계로 둔다 */
export function isStandingRelationship(edge: GraphEdge): boolean {
  const s = edge.semantics;
  return !s || (s.kind !== 'action' && s.temporal_scope !== 'event');
}
