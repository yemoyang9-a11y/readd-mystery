import type { GraphEdge, GraphResponse } from '../../types';
import { currentGraphEdges, graphEdgeKey } from './graphEdges';

/** 받침 있는 이름은 '과', 없으면 '와'. 한글이 아닌 끝 글자는 '와'. 조사는 괄호 앞 이름에 맞추고 `shown` 뒤에 붙인다. */
function withParticle(name: string, shown: string = name): string {
  const last = name.charCodeAt(name.length - 1);
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${shown}${hasFinal ? '과' : '와'}`;
}

/** 별칭이 있으면 `이름 (별칭1·별칭2)`, 없으면 이름만. 별칭은 서버가 기준점 K로 걸러 준 것 그대로 쓴다 (FR-SPL-002 🚦, FR-CHR-001). */
function withAliases(name: string, aliases: string[]): string {
  return aliases.length > 0 ? `${name} (${aliases.join('·')})` : name;
}

/** `사실` = assertion_status === 'fact', 그 외 전부 `의심·주장`. 옛 관계(semantics 없음)는 표시하지 않는다. */
function statusLabel(edge: GraphEdge): string | null {
  if (!edge.semantics) return null;
  return edge.semantics.assertion_status === 'fact' ? '사실' : '의심·주장';
}

/**
 * 관계 설명 칸 — 범례 아래, 인물 또는 선을 고르면 그 관계를 쉬운 말로 풀어 준다 (2026-11-17 시안).
 *
 * 입력 그래프는 서버가 기준점 K 이하로 걸러 준 것이다 (FR-SPL-002 🚦). 문장은 배치에서 검증을 통과한
 * `semantics.reader_summary` 뿐이고, 없으면 문장 없이 관계 이름만 보인다 — 원문 `summary`로 대신하지 않는다.
 * 선 선택이 인물 선택보다 우선한다.
 */
export default function RelationDetails({
  graph,
  selectedId,
  selectedEdgeKey,
}: {
  graph: GraphResponse;
  selectedId: string | null;
  selectedEdgeKey: string | null;
}) {
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const titles = new Map(graph.nodes.map((node) => [node.id, withAliases(node.name, node.aliases)]));
  const edges = currentGraphEdges(graph.edges);

  const selectedEdge = selectedEdgeKey
    ? edges.find((edge) => graphEdgeKey(edge) === selectedEdgeKey)
    : undefined;

  if (selectedEdge) {
    const sentence = selectedEdge.semantics?.reader_summary;
    const status = statusLabel(selectedEdge);
    return (
      <section aria-label="관계 설명" data-no-track className="font-dashSans text-brief-ink">
        <h4 className="m-0 mb-2.5 text-[15px] font-bold">
          {titles.get(selectedEdge.source)} · {titles.get(selectedEdge.target)}
        </h4>
        <ul className="m-0 list-none p-0">
          <li className="rounded-brief-card border border-[#ff5c7d] bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-brief-accent-soft px-2 py-0.5 text-xs font-bold text-brief-accent">
                {selectedEdge.label}
              </span>
              {status ? (
                <span className="ml-auto rounded-md border border-brief-rule px-1.5 py-px text-[11px] text-brief-muted">
                  {status}
                </span>
              ) : null}
            </div>
            {sentence ? (
              <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed text-brief-ink">{sentence}</p>
            ) : null}
          </li>
        </ul>
      </section>
    );
  }

  if (!selectedId) return null;
  const selectedName = names.get(selectedId);
  if (!selectedName) return null;

  const mine = edges.filter((edge) => edge.source === selectedId || edge.target === selectedId);

  return (
    <section aria-label="관계 설명" data-no-track className="font-dashSans text-brief-ink">
      <h4 className="m-0 mb-2.5 text-[15px] font-bold">
        {withParticle(selectedName, titles.get(selectedId) ?? selectedName)} 이어진 사람
      </h4>
      {mine.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {mine.map((edge) => {
            const otherId = edge.source === selectedId ? edge.target : edge.source;
            const sentence = edge.semantics?.reader_summary;
            const status = statusLabel(edge);
            return (
              <li
                key={graphEdgeKey(edge)}
                className="rounded-brief-card border border-brief-rule bg-white p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{names.get(otherId)}</span>
                  <span className="rounded-md bg-brief-accent-soft px-2 py-0.5 text-xs font-bold text-brief-accent">
                    {edge.label}
                  </span>
                  {status ? (
                    <span className="ml-auto rounded-md border border-brief-rule px-1.5 py-px text-[11px] text-brief-muted">
                      {status}
                    </span>
                  ) : null}
                </div>
                {sentence ? (
                  <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed text-brief-ink">{sentence}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
