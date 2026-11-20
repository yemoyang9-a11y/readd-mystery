import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { GraphResponse } from '../../types';
import Loading from '../common/Loading';
import RelationshipGraph from './RelationshipGraph';
import RelationDetails from './RelationDetails';
import RelationshipEgoView, { CenterChips } from './RelationshipEgoView';
import { graphMilestones, graphUpTo } from './graphFilter';
import { centralNodeIndex } from './graphLayout';

/**
 * 인물관계도 탭 — 2026-11-17 시안 `docs/superpowers/specs/mockups-2026-11-17/readd-relationship-simple.html`,
 * 2026-11-18 대표 지시로 시안 그대로만 남겼다.
 *
 * 제목 질문 "지금 누가 누구와 엮여 있을까요" → 그래프 → 선 모양 범례 한 줄 → 시점 되감기 막대(2026-11-19 대표 지시: 범례 바로 아래) → "{중심 인물}과 이어진 사람" 카드.
 * 시안에 없는 주요인물/전체 토글·인물 수·검색창·인물 목록·확대/축소/전체 보기/전체화면 버튼과
 * 배율(%) 표시는 없앴다. 손가락으로 끌기·벌려 확대하기만 보이지 않는 조작으로 남는다(RelationshipGraph).
 * 시점 되감기 막대는 2026-11-19 대표 지시로 피벗 전 방식 그대로 되살렸다(아래 "되감기 슬라이더").
 *
 * 기준점 이하의 인물은 전부 받은 그대로 있고 그 밖의 인물은 응답에 없다 (FR-SPL-002 🚦, 절대 규칙 7번).
 * 되감기는 그 받은 그래프 안에서만 과거 시점을 고르는 표시 필터다.
 *
 * ## 되감기 슬라이더 (2026-11-19 대표 지시로 복원)
 *
 * 읽은 범위 안에서 과거 시점의 관계도를 볼 수 있게 한다. 서버가 이미 기준점 이하로 걸러
 * 내려보냈으므로 이건 **받은 데이터 안의 표시 필터**이고, 서버에 다시 묻지 않는다.
 * 눈금을 받은 데이터에서 만들기 때문에 조작 가능한 오른쪽 끝이 곧 현재 진도이며,
 * 그 너머는 막힌 게 아니라 **존재하지 않는다** (graphFilter.ts 주석 참조).
 *
 * 트랙 자체는 p.1~전체 분량(`totalPages`)까지 그려서 "책 전체 대비 지금 어디까지
 * 왔는지" 감을 준다(2026-08-25, 사용자 요청). 다만 손잡이가 실제로 움직이는 구간은
 * `milestones`(=읽은 범위) 안으로 한정한다 — 조작 가능한 `<input type="range">` 뒤에
 * "아직 못 읽은 구간"을 나타내는 비활성 막대를 이어붙이는 방식이다. 두 막대의 폭은
 * `flexGrow`에 **정수 그대로**(진도 페이지 수, 남은 페이지 수)를 준다 — `/전체` 나눗셈으로
 * 비율(%)을 직접 계산하지 않는다. 절대 규칙 2번("기준점 결정기 밖에서 % 계산 금지, 프론트
 * 포함")이 겨냥하는 건 스포일러 상한과 관련된 진도율 계산인데, 나눗셈으로 값을 만들면 그
 * 계산과 형식적으로 겹쳐 보일 여지가 있어 피했다 — flexbox가 두 정수 비(比)로 폭을 알아서
 * 나누게 두는 쪽을 택함(브라우저의 레이아웃 계산이지 우리 코드의 진도율 계산이 아니다).
 * `totalPages`는 목차(전체 챕터) 기준이라 애초에 상한 대상이 아니다(R3 — 목차는 전체 상시 노출).
 *
 * 브라우저 기본 range 트랙은 높이·여백이 옆 막대와 맞지 않아 `appearance-none`으로 지우고
 * thumb·track을 직접 그린다. 두 막대가 맞닿는 안쪽 모서리는 각지게, 바깥쪽 끝만 둥글게 해서
 * 하나로 이어진 막대처럼 보이게 한다. `<input>`의 기본 inline-block 하강폭 여백 때문에 두
 * 막대가 2px 어긋나던 문제(2026-08-25)는 `block`으로 막는다.
 *
 * 표기는 앱의 쪽수 표기 "p.N"을 따른다(2026-11-18 "p.로 표현"). 눈금이 2개 미만이면 감을
 * 시점이 없으므로 막대를 그리지 않는다. 회색 부연 문구(옛 "별칭을 생략합니다" 안내)는 두지 않는다
 * (DESIGN.md 2026-11-18 대표 지시). 중심 인물(ego)이 늘 한 명 있다 — 처음은 연결이 가장 많은 인물(동점이면 먼저
 * 등장한 인물, `centralNodeIndex`)이고, 인물을 누르면 그 인물이 중심이 된다. 중심 인물을 고르는 것은 받은
 * 그래프 안에서의 표시 선택이지 기준점·쪽수 계산이 아니다 (절대 규칙 2·7번).
 * 2026-11-19 대표 지시 — 선택된 인물을 다시 누르면 선택이 풀리고 아무도 선택되지 않은 상태가 된다(설명 카드도 없다).
 * 범례의 "지난번 이후 새로"는 그 데이터(지난 방문 이후 새 관계)가 계약에 없어 넣지 않는다(CLAUDE.md 6장).
 *
 * 조회 실패는 부분 표시로 넘어가지 않는다 (FR-SPL-005 🚦).
 */
export default function RelationshipTab({
  graph,
  failed,
  totalPages,
  onJump,
}: {
  graph: GraphResponse | null;
  failed: boolean;
  /** 목차 기준 전체 페이지 수(상한 대상 아님, R3). 되감기 트랙 오른쪽 끝 표시에만 쓴다. */
  totalPages?: number;
  onJump?: (page: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [selected, setSelectedState] = useState<string | null>(null);
  // 2026-11-19 대표 지시 — 선택된 인물을 다시 누르면 선택이 풀려 아무도 선택되지 않은 상태가 된다.
  const [cleared, setCleared] = useState(false);
  // 선택한 선(graphEdgeKey). 인물을 고르면 풀린다 — 인물 선택과 선 선택은 함께 남지 않는다.
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [pickedCenter, setPickedCenter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const anchorRef = useCallback((node: HTMLDivElement | null) => {
    setMobile(Boolean(node?.closest('[data-mobile]')));
  }, []);

  // 되감기 눈금 — 받은 데이터(이미 기준점 이하)에서만 만든다. 마지막 눈금 = 현재 진도 (FR-SPL-002 🚦)
  const milestones = useMemo(() => (graph ? graphMilestones(graph) : []), [graph]);
  const latest = milestones[milestones.length - 1] ?? 0;
  // totalPages가 아직 안 왔거나(초기 로딩) latest보다 작게 들어오면(있을 수 없는 값) 그냥
  // latest로 맞춰 미조작 막대 폭이 0이 되게 한다 — 트랙이 찌그러지는 것만 막는다.
  const bookTotal = Math.max(totalPages ?? latest, latest);
  const unread = bookTotal - latest;

  // 고른 눈금이 사라졌으면(페이지를 옮겨 데이터가 바뀌었으면) 최신으로 되돌린다
  const at = picked !== null && milestones.includes(picked) ? picked : latest;
  const shown = useMemo(() => (graph ? graphUpTo(graph, at) : null), [graph, at]);

  // 고른 인물이 지금 보이는 그래프에 없으면(되감았거나 쪽을 옮겨 데이터가 바뀌면) 고른 값을 무시하고
  // 기본 중심 인물로 돌아간다 — 지우지는 않으므로 다시 앞으로 감으면 그대로 복원된다.
  const pickedVisible = selected && shown?.nodes.some((n) => n.id === selected) ? selected : null;
  const defaultEgo = useMemo(() => {
    if (!shown) return null;
    const index = centralNodeIndex(shown.nodes, shown.edges);
    return index >= 0 ? shown.nodes[index].id : null;
  }, [shown]);
  const activeSelected = cleared ? null : (pickedVisible ?? defaultEgo);

  function pickCenter(id: string) {
    setPickedCenter(id);
    setShowAll(false);
  }

  function pickPerson(id: string) {
    setSelectedEdgeKey(null);
    if (id === activeSelected) {
      setCleared(true);
      setSelectedState(null);
      return;
    }
    setCleared(false);
    setSelectedState(id);
  }

  const wrap = (child: ReactNode) => (
    <div ref={anchorRef} className="contents">
      {child}
    </div>
  );

  if (failed)
    return wrap(
      <p role="alert" className="text-brief-muted">
        관계도를 불러오지 못했습니다
      </p>
    );
  if (!graph || !shown)
    return wrap(<Loading fullScreen={false} message="인물 관계를 정리하는 중" />);

  const scrubber =
    milestones.length > 1 ? (
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between font-dashSans text-[12px]">
          <label htmlFor="graph-scrub" className="text-brief-muted">
            시점 되감기
          </label>
          <span className="font-bold text-brief-ink">
            {at === latest ? '현재까지' : `p.${at} 시점`}
          </span>
        </div>
        <div className="flex items-center">
          <div style={{ flexGrow: latest || 1, flexBasis: 0 }}>
            <input
              id="graph-scrub"
              type="range"
              min={0}
              max={milestones.length - 1}
              step={1}
              value={Math.max(0, milestones.indexOf(at))}
              onChange={(event) => setPicked(milestones[Number(event.target.value)])}
              className={`block h-3.5 w-full cursor-pointer appearance-none bg-transparent mobile:h-11
                  [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:bg-brief-accent
                  [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:border-none [&::-moz-range-track]:bg-brief-accent
                  ${
                    unread > 0
                      ? '[&::-webkit-slider-runnable-track]:rounded-l-full [&::-moz-range-track]:rounded-l-full'
                      : '[&::-webkit-slider-runnable-track]:rounded-full [&::-moz-range-track]:rounded-full'
                  }
                  [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
                  [&::-webkit-slider-thumb]:bg-brief-accent [&::-webkit-slider-thumb]:shadow
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5
                  [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white
                  [&::-moz-range-thumb]:bg-brief-accent [&::-moz-range-thumb]:shadow
                  [&::-moz-range-thumb]:cursor-pointer`}
            />
          </div>
          {unread > 0 ? (
            <div
              aria-hidden="true"
              data-testid="graph-scrub-unread"
              className="h-1.5 shrink-0 rounded-r-full bg-brief-rule"
              style={{ flexGrow: unread, flexBasis: 0 }}
            />
          ) : null}
        </div>
        <div className="flex justify-between font-dashSans text-[11px] text-brief-muted">
          <span>p.1</span>
          <span>p.{bookTotal}</span>
        </div>
      </div>
    ) : null;

  const fullView = (
    <div className="space-y-3">
      <h3 className="m-0 mt-0.5 font-dashSans text-base font-bold leading-snug text-brief-ink">
        지금 누가 누구와 엮여 있을까요
      </h3>
      <div>
        <RelationshipGraph
          graph={shown}
          selectedId={activeSelected}
          // 인물을 누르면 그 인물이 중심이 되고, 이미 선택된 인물을 다시 누르면 선택이 풀린다(2026-11-19 대표 지시).
          // 빈 곳을 누르면(null) 선 선택만 풀고 중심은 그대로 둔다.
          onSelect={(id) => (id ? pickPerson(id) : setSelectedEdgeKey(null))}
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
              <line
                x1="1"
                y1="3"
                x2="21"
                y2="3"
                strokeWidth="2"
                strokeLinecap="round"
                className="stroke-brief-accent"
              />
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
      {/* 시점 되감기 (2026-11-19 대표 지시로 피벗 전 방식 그대로 복원). 받은 자료 안의 표시 필터라
          서버에 다시 묻지 않는다. 막대 폭은 정수 flexGrow — % 계산 없음 (절대 규칙 2번, 위 주석). */}
      {scrubber}
      <RelationDetails
        graph={shown}
        selectedId={activeSelected}
        selectedEdgeKey={selectedEdgeKey}
      />
    </div>
  );

  const centerId =
    shown.nodes.some((n) => n.id === pickedCenter) && pickedCenter ? pickedCenter : defaultEgo;

  const mobileBody =
    centerId && !showAll ? (
      <div className="space-y-3">
        <CenterChips
          graph={shown}
          centerId={centerId}
          all={false}
          onPick={pickCenter}
          onAll={() => setShowAll(true)}
        />
        <RelationshipEgoView
          graph={shown}
          centerId={centerId}
          scrubber={scrubber}
          onPickCenter={pickCenter}
          onJump={onJump}
        />
      </div>
    ) : (
      <div className="space-y-3">
        <CenterChips
          graph={shown}
          centerId={centerId}
          all
          onPick={pickCenter}
          onAll={() => setShowAll(true)}
        />
        {fullView}
      </div>
    );

  return wrap(mobile ? mobileBody : fullView);
}
