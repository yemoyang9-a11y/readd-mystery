import type { GraphEdge } from '../../types';
import type { Point } from './graphLayout';

/** Stable row identity; canonical endpoint order says nothing about semantic direction. */
export function graphEdgeKey(edge: GraphEdge): string {
  if (edge.id) return `id:${edge.id}`;
  return JSON.stringify([
    'edge',
    edge.source,
    edge.target,
    edge.label,
    edge.established_page,
    edge.semantics?.relation_key ?? null,
    edge.semantics?.kind ?? null,
    edge.semantics?.direction ?? null,
    edge.semantics?.assertion_status ?? null,
    edge.semantics?.state ?? null,
  ]);
}

/** FR-CHR-001: independent relationships and event occurrences never replace each other. */
export function graphTrackKey(edge: GraphEdge): string {
  const pair = [edge.source, edge.target].sort();
  const semantics = edge.semantics;
  if (!semantics) return JSON.stringify(['legacy', ...pair]);

  let direction = semantics.direction;
  if (pair[0] !== edge.source) {
    if (direction === 'a_to_b') direction = 'b_to_a';
    else if (direction === 'b_to_a') direction = 'a_to_b';
  }
  return JSON.stringify([
    'semantic',
    ...pair,
    direction,
    semantics.kind,
    semantics.relation_key,
    semantics.temporal_scope === 'event' ? (edge.id ?? edge.established_page) : null,
  ]);
}

type Slot = 'a' | 'b';

/** 정렬된 두 인물과, 그 정렬에 맞춘 방향 */
function normalized(edge: GraphEdge) {
  const pair = [edge.source, edge.target].sort();
  let direction = edge.semantics?.direction;
  if (pair[0] !== edge.source) {
    if (direction === 'a_to_b') direction = 'b_to_a';
    else if (direction === 'b_to_a') direction = 'a_to_b';
  }
  return { pair, direction };
}

/**
 * FR-CHR-001: 서로 대체할 수 있는 관계 묶음. 방향은 묶음 키가 아니라 그 안의 관점 칸이다.
 * 서버 relationshipGroup(backend/src/modules/ssabi/relationship-versions.ts)과 같은 규칙.
 */
function graphGroupKey(edge: GraphEdge): string {
  const { pair } = normalized(edge);
  const s = edge.semantics;
  if (!s) return JSON.stringify(['legacy', ...pair]);
  return JSON.stringify([
    'semantic',
    ...pair,
    s.kind,
    s.relation_key,
    s.temporal_scope === 'event'
      ? [edge.established_page, s.evidence.start_char, s.evidence.end_char]
      : 'ongoing',
  ]);
}

/** 한쪽 방향은 그 관계를 가진 쪽 칸만, 쌍방·무방향·미확인·기존 관계는 양쪽 칸 */
function graphSlots(edge: GraphEdge): Slot[] {
  const { direction } = normalized(edge);
  return direction === 'a_to_b' ? ['a'] : direction === 'b_to_a' ? ['b'] : ['a', 'b'];
}

/**
 * FR-CHR-001: 묶음마다 페이지 순서로 칸을 채우고, 칸을 하나라도 빼앗긴 관계는 통째로 대체한다.
 * 한쪽→쌍방, 쌍방→한쪽, 미확인→확정은 새 관계만 남고 A→B와 B→A는 함께 남는다.
 * 서버 currentRelationshipVersions와 같은 규칙이다 — 이미 허용된 이력만 받는다.
 */
export function currentGraphEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  const ordered = [...edges].sort(
    (x, y) =>
      x.established_page - y.established_page ||
      (graphEdgeKey(x) < graphEdgeKey(y) ? -1 : graphEdgeKey(x) > graphEdgeKey(y) ? 1 : 0)
  );
  const groups = new Map<string, Map<Slot, GraphEdge>>();
  for (const edge of ordered) {
    const key = graphGroupKey(edge);
    const slots = groups.get(key) ?? new Map<Slot, GraphEdge>();
    groups.set(key, slots);
    for (const slot of graphSlots(edge)) {
      const replaced = slots.get(slot);
      if (replaced) for (const [s, e] of [...slots]) if (e === replaced) slots.delete(s);
    }
    for (const slot of graphSlots(edge)) slots.set(slot, edge);
  }
  const current = new Set([...groups.values()].flatMap((slots) => [...slots.values()]));
  return ordered.filter((edge) => current.has(edge));
}

/** NFR-USE-006: uncertainty, denial and time are stated in text, not color alone. */
export function graphEdgeLabel(edge: GraphEdge): string {
  const semantics = edge.semantics;
  if (!semantics) return edge.label;
  const status = {
    fact: '',
    belief: '믿음',
    claim: '주장',
    rumor: '소문',
    uncertain: '불확실',
    negated: '부정됨',
  }[semantics.assertion_status];
  return [
    edge.label,
    status && `(${status})`,
    semantics.temporal_scope === 'event' && '(사건)',
    semantics.state === 'ended' && '(종료)',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * FR-CHR-001 (2026-11-17 시안): 선 위 이름표는 "부부·친구·연인"처럼 짧은 이름이다.
 * 생성 단계의 label 은 구체적인 술어("남편이다")라 카드 문장에 남기고, 이름표만 관계 키로 줄인다.
 * 표에 없는 키는 원래 label 을 그대로 쓴다 — 뜻을 지어내지 않는다.
 */
const SHORT_RELATION_NAMES: Record<string, string> = {
  marriage: '부부',
  friendship: '친구',
  affection: '사랑',
  romance: '연인',
  hatred: '미움',
  lust: '욕망',
  physical_contact: '손잡음',
  rescue: '구하려 함',
  parenthood: '부모·자식',
  sibling: '형제자매',
  employment: '고용',
  suspicion: '의심',
  rivalry: '경쟁',
  jealousy: '질투',
};

export function graphPillLabel(edge: GraphEdge): string {
  const key = edge.semantics?.relation_key;
  return (key && SHORT_RELATION_NAMES[key]) || edge.label;
}

/** 같은 두 사람 사이 관계 이름표를 하나로 묶는다 — 키는 정렬한 두 인물 id */
export function groupPillLabels(edges: readonly GraphEdge[]): Map<string, string> {
  const names = new Map<string, string[]>();
  for (const edge of edges) {
    const pair = JSON.stringify([edge.source, edge.target].sort());
    const list = names.get(pair) ?? [];
    const name = graphPillLabel(edge);
    if (!list.includes(name)) list.push(name);
    names.set(pair, list);
  }
  const out = new Map<string, string>();
  for (const [pair, list] of names) {
    out.set(pair, list.slice(0, 2).join(' · ') + (list.length > 2 ? ` +${list.length - 2}` : ''));
  }
  return out;
}

export interface EdgePath {
  edge: GraphEdge;
  key: string;
  path: string;
  label: Point;
  length: number;
  /** 2차 곡선의 점 — 이름표가 겹칠 때 선 위 다른 자리로 옮기는 데 쓴다 (edgePointAt). */
  start: Point;
  control: Point;
  end: Point;
}

/** 곡선 위 t(0~1) 지점. 이름표 자리를 선을 따라 옮길 때 쓴다. */
export function edgePointAt(entry: Pick<EdgePath, 'start' | 'control' | 'end'>, t: number): Point {
  return quadraticPoint(entry.start, entry.control, entry.end, t);
}

/**
 * Each unordered pair gets stable parallel lanes. The path always runs source → target;
 * the renderer applies start/end markers from semantics.direction independently.
 * radiusFor includes any marker clearance needed outside the visible node circle.
 */
export function makeEdgePaths(
  nodes: readonly { id: string }[],
  edges: readonly GraphEdge[],
  positions: readonly Point[],
  radiusFor: (id: string) => number,
  gap: number
): EdgePath[] {
  const points = new Map(nodes.map((node, index) => [node.id, positions[index]]));
  const groups = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const from = points.get(edge.source);
    const to = points.get(edge.target);
    if (!from || !to || ![from.x, from.y, to.x, to.y].every(Number.isFinite)) continue;
    const pair = JSON.stringify([edge.source, edge.target].sort());
    const group = groups.get(pair) ?? [];
    group.push(edge);
    groups.set(pair, group);
  }

  const result: EdgePath[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      const aKey = graphEdgeKey(a);
      const bKey = graphEdgeKey(b);
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    sorted.forEach((edge, index) => {
      const from = points.get(edge.source)!;
      const to = points.get(edge.target)!;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      if (distance === 0) return;
      // Canonical orientation is used only to place lanes, never to infer arrows.
      const orientation = edge.source < edge.target ? 1 : -1;
      const laneOffset = (index - (sorted.length - 1) / 2) * gap * orientation;
      const offset =
        laneOffset +
        avoidanceOffset(
          from,
          to,
          nodes.filter((n) => n.id !== edge.source && n.id !== edge.target),
          points,
          radiusFor
        );
      const control = {
        x: (from.x + to.x) / 2 - (dy / distance) * offset,
        y: (from.y + to.y) / 2 + (dx / distance) * offset,
      };
      const start = outsideCircle(from, control, radiusFor(edge.source));
      const end = outsideCircle(to, control, radiusFor(edge.target));
      const label = quadraticPoint(start, control, end, 0.5);
      let length = 0;
      let previous = start;
      for (let step = 1; step <= 12; step += 1) {
        const point = quadraticPoint(start, control, end, step / 12);
        length += Math.hypot(point.x - previous.x, point.y - previous.y);
        previous = point;
      }
      result.push({
        edge,
        key: graphEdgeKey(edge),
        path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
        label,
        length,
        start,
        control,
        end,
      });
    });
  }
  return result;
}

const AVOID_PADDING = 6;
const AVOID_CLEARANCE = 8;
const AVOID_END_RATIO = 0.08;

/**
 * 선이 다른 인물 카드 위를 지나면 반대쪽으로 휘게 하는 control 점 이동량.
 * 카드 중심~선분 거리 < 카드 반지름 + 6px 이고 선분 양 끝 8% 밖이면 지나는 것으로 본다.
 * 2차 곡선의 중간점은 control 점 이동량의 절반만 움직이므로 필요한 간격의 두 배를 준다.
 * 가장 깊이 가린 카드 하나를 기준으로 하고, 카드가 선 위에 정확히 놓이면(거리 0) 한쪽으로 고정한다.
 */
function avoidanceOffset(
  from: Point,
  to: Point,
  others: readonly { id: string }[],
  points: ReadonlyMap<string, Point>,
  radiusFor: (id: string) => number
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return 0;
  const distance = Math.sqrt(lengthSq);
  let worst: { need: number; side: number } | null = null;
  for (const other of others) {
    const p = points.get(other.id);
    if (!p || ![p.x, p.y].every(Number.isFinite)) continue;
    const t = ((p.x - from.x) * dx + (p.y - from.y) * dy) / lengthSq;
    if (t < AVOID_END_RATIO || t > 1 - AVOID_END_RATIO) continue;
    // 선분의 법선(-dy, dx) 기준 부호 있는 거리
    const signed = ((p.x - from.x) * -dy + (p.y - from.y) * dx) / distance;
    const reach = radiusFor(other.id) + AVOID_PADDING;
    if (Math.abs(signed) >= reach) continue;
    const need = reach - Math.abs(signed);
    if (!worst || need > worst.need) worst = { need, side: signed > 0 ? -1 : 1 };
  }
  if (!worst) return 0;
  return worst.side * 2 * (worst.need + AVOID_CLEARANCE);
}

function outsideCircle(center: Point, toward: Point, radius: number): Point {
  const length = Math.hypot(toward.x - center.x, toward.y - center.y) || 1;
  const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  return {
    x: center.x + ((toward.x - center.x) / length) * safeRadius,
    y: center.y + ((toward.y - center.y) / length) * safeRadius,
  };
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const remaining = 1 - t;
  return {
    x: remaining * remaining * start.x + 2 * remaining * t * control.x + t * t * end.x,
    y: remaining * remaining * start.y + 2 * remaining * t * control.y + t * t * end.y,
  };
}
