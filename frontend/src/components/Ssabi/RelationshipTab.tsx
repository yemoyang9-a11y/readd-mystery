import { useMemo, useState } from 'react';
import type { GraphResponse } from '../../types';
import Loading from '../common/Loading';
import RelationshipGraph from './RelationshipGraph';
import RelationDetails from './RelationDetails';
import { centralNodeIndex } from './graphLayout';

/**
 * 인물관계도 탭 — 2026-11-17 시안 `docs/superpowers/specs/mockups-2026-11-17/readd-relationship-simple.html`,
 * 2026-11-18 대표 지시로 시안 그대로만 남겼다.
 *
 * 제목 질문 "지금 누가 누구와 엮여 있을까요" → 그래프 → 선 모양 범례 한 줄 → "{중심 인물}과 이어진 사람" 카드.
 * 시안에 없는 주요인물/전체 토글·인물 수·검색창·인물 목록·시점 되감기 막대·확대/축소/전체 보기/전체화면 버튼과
 * 배율(%) 표시는 없앴다. 손가락으로 끌기·벌려 확대하기만 보이지 않는 조작으로 남는다(RelationshipGraph).
 *
 * 받은 그래프를 거르지 않고 그대로 그린다 — 기준점 이하의 인물은 전부 그려지고 그 밖의 인물은 응답에 없다
 * (FR-SPL-002 🚦, 절대 규칙 7번). 중심 인물(ego)이 늘 한 명 있다 — 처음은 연결이 가장 많은 인물(동점이면 먼저
 * 등장한 인물, `centralNodeIndex`)이고, 인물을 누르면 그 인물이 중심이 된다. 중심 인물을 고르는 것은 받은
 * 그래프 안에서의 표시 선택이지 기준점·쪽수 계산이 아니다 (절대 규칙 2·7번).
 * 범례의 "지난번 이후 새로"는 그 데이터(지난 방문 이후 새 관계)가 계약에 없어 넣지 않는다(CLAUDE.md 6장).
 *
 * 조회 실패는 부분 표시로 넘어가지 않는다 (FR-SPL-005 🚦).
 */
export default function RelationshipTab({
  graph,
  failed,
}: {
  graph: GraphResponse | null;
  failed: boolean;
}) {
  const [selected, setSelectedState] = useState<string | null>(null);
  // 선택한 선(graphEdgeKey). 인물을 고르면 풀린다 — 인물 선택과 선 선택은 함께 남지 않는다.
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  function setSelected(id: string) {
    setSelectedEdgeKey(null);
    setSelectedState(id);
  }

  // 고른 인물이 새 응답에 없으면(쪽을 옮겨 데이터가 바뀌면) 기본 중심 인물로 돌아간다.
  const pickedVisible = selected && graph?.nodes.some((n) => n.id === selected) ? selected : null;
  const defaultEgo = useMemo(() => {
    if (!graph) return null;
    const index = centralNodeIndex(graph.nodes, graph.edges);
    return index >= 0 ? graph.nodes[index].id : null;
  }, [graph]);
  const activeSelected = pickedVisible ?? defaultEgo;

  if (failed)
    return (
      <p role="alert" className="text-brief-muted">
        관계도를 불러오지 못했습니다
      </p>
    );
  if (!graph) return <Loading fullScreen={false} message="인물 관계를 정리하는 중" />;

  return (
    <div className="space-y-3">
      <h3 className="m-0 mt-0.5 font-dashSans text-base font-bold leading-snug text-brief-ink">
        지금 누가 누구와 엮여 있을까요
      </h3>
      <div>
        <RelationshipGraph
          graph={graph}
          selectedId={activeSelected}
          // 인물을 누르면 그 인물이 중심이 된다. 빈 곳을 누르면(null) 선 선택만 풀고 중심은 그대로 둔다.
          onSelect={(id) => (id ? setSelected(id) : setSelectedEdgeKey(null))}
          selectedEdgeKey={selectedEdgeKey}
          onSelectEdge={setSelectedEdgeKey}
        />
        {/* 선 모양 범례 한 줄 (시안). 라벨이므로 부연 문구 금지 규칙의 예외다. */}
        <ul
          aria-label="선 모양 범례"
          className="m-0 mt-2.5 flex list-none gap-4 px-0.5 font-dashSans text-[11.5px] text-brief-muted"
        >
          <li className="flex items-center gap-1.5">
            <svg aria-hidden="true" width="22" height="6" viewBox="0 0 22 6">
              <line x1="1" y1="3" x2="21" y2="3" strokeWidth="2" strokeLinecap="round" className="stroke-brief-accent" />
            </svg>
            <span>사실</span>
          </li>
          <li className="flex items-center gap-1.5">
            <svg aria-hidden="true" width="22" height="6" viewBox="0 0 22 6">
              <line
                x1="1"
                y1="3"
                x2="21"
                y2="3"
                strokeWidth="2"
                strokeDasharray="5 4"
                strokeLinecap="round"
                className="stroke-brief-accent"
              />
            </svg>
            <span>의심·주장</span>
          </li>
        </ul>
      </div>
      <RelationDetails graph={graph} selectedId={activeSelected} selectedEdgeKey={selectedEdgeKey} />
    </div>
  );
}
