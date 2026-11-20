import type { GraphEdge, GraphNode, GraphResponse } from '../../types';
import { currentGraphEdges, graphPillLabel } from './graphEdges';

export const EGO_CANVAS = { width: 352, height: 300 };
export const EGO_CENTER = { x: 176, y: 140 };
const RADIUS = { x: 150, y: 110 };

export interface EgoRelation {
  edge: GraphEdge;
  label: string;
  filled: boolean;
  source: string | null;
  page: number | null;
  evidence: string | null;
  explanation: string | null;
}

export interface EgoNeighbor {
  node: GraphNode;
  relations: EgoRelation[];
  lineLabel: string;
  lineFilled: boolean;
}

export interface EgoGraph {
  center: GraphNode;
  neighbors: EgoNeighbor[];
  others: GraphNode[];
}

const ATTRIBUTED_VERB: Record<string, string> = {
  belief: '생각',
  claim: '말',
  rumor: '소문',
  uncertain: '짐작',
  negated: '말',
};

function sourceOf(edge: GraphEdge): string | null {
  const s = edge.semantics;
  if (!s) return null;
  if (s.assertion_status === 'fact') return '본문에서 확인';
  const verb = ATTRIBUTED_VERB[s.assertion_status] ?? '말';
  return `${s.attribution || '인물'}의 ${verb}`;
}

function relationOf(edge: GraphEdge): EgoRelation {
  const s = edge.semantics;
  return {
    edge,
    label: graphPillLabel(edge),
    filled: !s || s.assertion_status === 'fact',
    source: sourceOf(edge),
    page: s ? s.evidence.source_page : null,
    evidence: s?.reader_evidence || null,
    explanation: s?.reader_explanation || null,
  };
}

export function egoView(graph: GraphResponse, centerId: string): EgoGraph | null {
  const center = graph.nodes.find((node) => node.id === centerId);
  if (!center) return null;
  const edges = currentGraphEdges(graph.edges);
  const neighbors: EgoNeighbor[] = [];
  const connected = new Set<string>([centerId]);
  for (const node of graph.nodes) {
    if (node.id === centerId) continue;
    const between = edges
      .filter(
        (edge) =>
          (edge.source === centerId && edge.target === node.id) ||
          (edge.target === centerId && edge.source === node.id)
      )
      .sort((a, b) => a.established_page - b.established_page);
    if (between.length === 0) continue;
    connected.add(node.id);
    const relations = between.map(relationOf);
    const lead = relations.find((r) => r.filled) ?? relations[0];
    neighbors.push({
      node,
      relations,
      lineLabel: relations.length > 1 ? `${lead.label} 외 ${relations.length - 1}` : lead.label,
      lineFilled: relations.some((r) => r.filled),
    });
  }
  return { center, neighbors, others: graph.nodes.filter((node) => !connected.has(node.id)) };
}

export function egoCandidates(graph: GraphResponse): GraphNode[] {
  const degree = new Map<string, number>();
  for (const edge of currentGraphEdges(graph.edges)) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return graph.nodes
    .map((node, index) => ({ node, index, count: degree.get(node.id) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((entry) => entry.node);
}

export function egoPositions(count: number): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = ((-90 + 180 / count + (360 / count) * index) * Math.PI) / 180;
    return {
      x: EGO_CENTER.x + RADIUS.x * Math.cos(angle),
      y: EGO_CENTER.y + RADIUS.y * Math.sin(angle),
    };
  });
}
