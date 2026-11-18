import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../../hooks/useModalLayer';
import type { GraphEdge, GraphResponse } from '../../types';
import { edgePointAt, graphEdgeLabel, graphPillLabel, groupPillLabels, makeEdgePaths } from './graphEdges';
import {
  boundingBox,
  computeDegrees,
  estimateTextWidth,
  forceLayout,
  pickNonOverlapping,
  type BoundingBox,
  type LabelBox,
  type Point,
} from './graphLayout';

/** 선택한 선의 색·굵기 (2026-11-17 시안). 강조는 색·굵기로만 하고 다른 것을 흐리게 하지 않는다. */
const SELECTED_EDGE_COLOR = '#ff5c7d';
const SELECTED_EDGE_WIDTH = 3.6;
const EDGE_HIT_WIDTH = 20;
/** 중심 인물과 닿은 선 / 닿지 않은 선의 굵기(화면 px). 2026-11-17 시안 1.8 / 1.3 */
const EGO_EDGE_WIDTH = 2;
const PLAIN_EDGE_WIDTH = 1.2;

/**
 * 인물 칩(둥근 네모)의 반 변 길이(화면 px, 100% 기준). 2026-11-17 시안 — 중심 인물은 52px,
 * 나머지는 연결 수에 따라 28~42px.
 */
const EGO_CHIP_HALF_PX = 26;
const CHIP_HALF_MIN_PX = 15;
const CHIP_HALF_STEP_PX = 1.4;
const CHIP_HALF_MAX_PX = 22;
function chipHalfPx(degree: number, isEgo: boolean): number {
  if (isEgo) return EGO_CHIP_HALF_PX;
  return Math.min(CHIP_HALF_MAX_PX, CHIP_HALF_MIN_PX + CHIP_HALF_STEP_PX * Math.max(0, degree - 1));
}

/** 이름 첫 글자(한 음절). 칩 가운데에 크게 쓴다. */
function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '';
}

/**
 * 레이아웃 전(jsdom·첫 렌더)처럼 캔버스 크기를 아직 모를 때 쓰는 폭 — 휴대폰 싸비 패널 폭(시안 354px).
 * 1px로 잡으면 글자·이름표가 그래프 전체만큼 커져 서로 다 겹친 것으로 계산된다.
 */
const FALLBACK_CANVAS_WIDTH_PX = 354;
/** 배치 좌표 둘레 여백(사용자 좌표)과 맨 아래 이름 자리 */
const GRAPH_PADDING = 92;
const GRAPH_NAME_ROOM = 56;

/**
 * 관계도 그래프 렌더 — 지도형 리디자인 (2026-08-24)
 *
 * 시안 `docs-local/reader-map-graph.html`의 상호작용(줌/팬/핀치, 노드 클릭 선택,
 * 라벨 충돌회피)을 이 저장소의 디자인 톤(Tailwind 토큰)으로 그린다 — **디자인은 R4
 * 기존 구성이 우선이고, 목업에서는 구조·인터랙션만 가져온다.** 목업 CSS의 원색(cream/
 * terra 계열)은 옮기지 않는다 — 이미 R4 토큰(ssabi/ink/muted/line)이 비슷한 색감이다.
 *
 * React Flow → 순수 SVG로 교체했다. 좌표는 graphLayout.ts 의 힘-분산 배치(무작위성 없음,
 * 같은 입력엔 항상 같은 좌표)로 만든다.
 *
 * ⚠️ 여기서 노드·간선을 걸러내지 않는다. 서버가 이미 기준점 이하로 필터해 내려보냈고,
 *    초과 여부를 판별하는 코드를 프론트에 두지 않는다 (절대 규칙 7번).
 *
 * ## 선택 상태는 이 컴포넌트가 소유하지 않는다
 *
 * `selectedId`/`onSelect`로 부모(RelationshipTab)가 선택 상태를 갖는다 — 추후 "본문에서
 * 인물명 선택 시 관계도 포커싱" 기능이 이 자리에 그대로 꽂힐 수 있어야 한다(같은
 * setSelected를 본문 클릭 핸들러가 호출하면 된다). 이 컴포넌트는 selectedId를 받아
 * 그리기만 한다.
 *
 * 인물명 라벨은 항상 전부 그리려 하고, 겹치면 연결 수가 적은 쪽을 숨긴다(선택·인접
 * 인물은 최우선 유지). 관계 라벨은 선택된 인물과 닿은 간선에서만 보여준다 — 예전엔
 * 간선 51개에서 캔버스 라벨을 통째로 생략했는데(2026-08-21 polish), 이제 선택 시에만
 * 보여주는 쪽이 더 낫다. 항상 보이는 "관계" 텍스트 목록은 RelationshipTab이 맡는다.
 *
 * ## 2026-11-17 승인 시안 (FR-CHR-001)
 *
 * 인물은 둥근 네모 칩 + 이름 첫 글자, 이름은 칩 아래 작게. 중심 인물(selectedId)은 크게, 버건디
 * 테두리·바깥 고리. 중심 인물과 닿은 선은 강조색·화살표·관계 이름표, 나머지는 옅은 선. 실선 = 사실,
 * 점선 = 의심·주장 또는 끝난 관계. 색은 앱의 밝은 테마 토큰(brief-*)을 쓴다(시안의 검정 바탕은 옮기지 않음).
 */

// 2026-08-25 — "글씨가 작다"(1차) → 14/12로 올렸는데 "꽤 더 키워야" 재요청, 그 다음
// "관계 글자는 이름보다 작아도 된다"는 재조정 요청까지 세 차례 거쳤다. CHAR_PX(글자당
// 너비 어림)를 매번 감으로 골랐던 게 문제였다 — 실제 렌더된 <text>의
// getComputedTextLength()를 재보니(2026-08-25, 실데이터 인물명·관계 라벨로 측정)
// 한글 글자 너비는 글꼴 크기의 약 0.94배로 거의 일정했다. 매번 새 폰트 크기마다
// CHAR_PX를 따로 어림하지 않도록 폰트 크기에서 직접 계산한다 — 그래야 "관계 라벨이
// 감싸는 프레임 밖으로 튀어나온다"(CHAR_PX가 실제보다 작아 라벨 박스가 좁게
// 잡혔던 것) 같은 계산-실측 어긋남이 다시 안 생긴다.
const KOREAN_CHAR_WIDTH_RATIO = 0.94;
// 2026-08-25 (3차) — "여전히 좀 난잡해 보인다" 피드백으로 전체 글자 크기를 한 단계
// 낮춘다(17→15, 12→10). CHAR_PX는 위 비율로 자동 재계산되니 손대지 않아도 된다.
// 2026-11-17 시안 — 이름은 칩 아래 작게(시안 9.5px, 휴대폰 가독성으로 11px). 칩 안 첫 글자가 주인공이다.
const NAME_FONT_PX = 11;
const EGO_NAME_FONT_PX = 12;
const EDGE_LABEL_FONT_PX = 11;
const EDGE_LABEL_CHAR_PX = EDGE_LABEL_FONT_PX * KOREAN_CHAR_WIDTH_RATIO;
const MIN_ZOOM_RATIO = 0.32;
const MAX_ZOOM_RATIO = 2.4;
// clampViewBox 의 팬 여유는 (1 + 2*PAN_MARGIN_RATIO)*base.width 까지만 뷰박스를 허용한다.
// 이 값이 MAX_ZOOM_RATIO 보다 작으면 최대 축소 근처에서 팬 가능 범위가 한 점으로
// 쪼그라들어 드래그가 전혀 안 먹는다(실기기 확인, 2026-08-24) — 0.35였을 때 한계가
// 1.7이라 2.4까지 축소가 가능한 것과 충돌했다. 축소 한계(2.4)를 넉넉히 덮도록 올린다.
const PAN_MARGIN_RATIO = 0.9;

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clampViewBox(vb: ViewBox, base: BoundingBox): ViewBox {
  const minW = base.width * MIN_ZOOM_RATIO;
  const maxW = base.width * MAX_ZOOM_RATIO;
  const width = Math.max(minW, Math.min(maxW, vb.width));
  const height = width * (base.height / base.width);

  const marginX = base.width * PAN_MARGIN_RATIO;
  const marginY = base.height * PAN_MARGIN_RATIO;
  const x = Math.max(base.x - marginX, Math.min(base.x + base.width + marginX - width, vb.x));
  const y = Math.max(base.y - marginY, Math.min(base.y + base.height + marginY - height, vb.y));

  return { x, y, width, height };
}

export default function RelationshipGraph({
  graph,
  selectedId,
  onSelect,
  selectedEdgeKey = null,
  onSelectEdge,
}: {
  graph: GraphResponse;
  /** 중심 인물(ego). 2026-11-17 시안 — 부모가 늘 한 명을 준다(처음은 연결이 가장 많은 인물). */
  selectedId: string | null;
  /** 인물을 누르면 그 id, 빈 캔버스를 누르면 null(선 선택 해제용). 같은 인물을 다시 눌러도 그 id다. */
  onSelect: (id: string | null) => void;
  /** 선택한 선 = `graphEdgeKey(edge)`. 같은 선을 다시 누르면 해제된다. */
  selectedEdgeKey?: string | null;
  onSelectEdge?: (key: string | null) => void;
}) {
  const markerId = `relationship-arrow-${useId().replace(/:/g, '')}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    pointers: Map<number, Point>;
    last: Point | null;
    pinchDist: number | null;
    moved: number;
  }>({
    pointers: new Map(),
    last: null,
    pinchDist: null,
    moved: 0,
  });

  const degree = useMemo(
    () => computeDegrees(graph.nodes, graph.edges),
    [graph.nodes, graph.edges]
  );
  const positions = useMemo(
    () => forceLayout(graph.nodes, graph.edges),
    [graph.nodes, graph.edges]
  );
  // 칩 아래에 이름이 붙으므로(2026-11-17 시안) 위·옆보다 아래 여백을 더 둔다 — 맨 아래 인물의 이름이
  // 그래프 틀에 잘리지 않게.
  const base = useMemo(() => {
    const box = boundingBox(positions, GRAPH_PADDING);
    return { ...box, height: box.height + GRAPH_NAME_ROOM };
  }, [positions]);

  const [viewBox, setViewBox] = useState<ViewBox>(() => ({
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height,
  }));
  // 애니메이션 중인 뷰박스의 "지금" 값을 읽을 거울 — setState는 비동기라 다음 렌더
  // 전까지는 viewBox 클로저가 낡은 값일 수 있다. rAF 루프 안에서 매 프레임 최신값을
  // 읽어야(연속으로 다른 인물을 빠르게 선택할 때 등) 애니메이션이 어긋나지 않는다.
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;
  const viewBoxAnimRef = useRef<number | null>(null);

  /**
   * 뷰박스를 즉시 바꾸는 대신 부드럽게 이동·확대한다(2026-08-25, 사용자 요청 — "인물
   * 관계도 줌/포커스 이동이 거칠다"). 드래그·휠·핀치줌처럼 사용자 입력을 1:1로 따라가는
   * 경우는 그 자체로 이미 부드러워 애니메이션이 필요 없다 — 여기는 "클릭 한 번으로
   * 카메라가 순간이동하는" 경우(인물 선택 포커스, 전체 보기, +/− 버튼)에만 쓴다.
   */
  function animateViewBoxTo(target: ViewBox, duration = 380) {
    if (viewBoxAnimRef.current != null) cancelAnimationFrame(viewBoxAnimRef.current);
    const start = viewBoxRef.current;
    const t0 = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const next = {
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        width: start.width + (target.width - start.width) * eased,
        height: start.height + (target.height - start.height) * eased,
      };
      setViewBox(next);
      viewBoxAnimRef.current = t < 1 ? requestAnimationFrame(tick) : null;
    }
    viewBoxAnimRef.current = requestAnimationFrame(tick);
  }

  useEffect(
    () => () => {
      if (viewBoxAnimRef.current != null) cancelAnimationFrame(viewBoxAnimRef.current);
    },
    []
  );

  // 그래프가 바뀌면(되감기·페이지 진행) 그 그래프의 배치로 다시 fit — 이전 줌 위치를
  // 새 좌표계에 그대로 들고 있으면 화면 밖을 보게 된다.
  //
  // ⚠️ 처음엔 "중심 인물로 확대"를 시도했다(목업의 focusDefault()를 그대로 옮김) —
  //    목업은 인물 30명 규모에 맞춘 고정 캔버스라 확대가 자연스러웠지만, 여기 base는
  //    그래프 크기에 맞춰 매번 다시 계산되는 값이라 인물이 몇 명 안 될 때(예: 첫 진입
  //    직후) 확대하면 나머지 인물이 통째로 화면 밖으로 잘려 나갔다(스크린샷으로 확인).
  //    전체를 우선 보여주고, 확대는 사용자가 노드를 선택했을 때(아래 effect)만 한다.
  useEffect(() => {
    setViewBox({ x: base.x, y: base.y, width: base.width, height: base.height });
  }, [base]);

  // 전체화면 — 그래프 원본 가로세로비(base)는 그대로 두고 화면에 맞는 크기만 계산한다.
  // CSS의 aspect-ratio + max-width/max-height 조합은 둘 다 auto인 상태에서 "두 축을
  // 동시에 만족하는 최대 크기"(contain)를 안정적으로 계산해주지 않아(요소가 아니라
  // 이미지/비디오에만 있는 동작) 직접 계산한다.
  const [isFullscreen, setIsFullscreen] = useState(false);
  // E2E #51 — 휴대폰(싸비 시트의 data-mobile 안)에서는 가운데 카드 대신 화면 전체를 채운다.
  // 여는 순간 그래프가 어디에 그려져 있는지로 정한다(포털로 옮기면 data-mobile 조상이 사라진다).
  const [fullscreenOnMobile, setFullscreenOnMobile] = useState(false);
  const mobileFullscreen = isFullscreen && fullscreenOnMobile;
  function toggleFullscreen() {
    if (!isFullscreen) setFullscreenOnMobile(Boolean(wrapRef.current?.closest('[data-mobile]')));
    setIsFullscreen((v) => !v);
  }
  useModalLayer({
    active: isFullscreen,
    dialogRef: wrapRef,
    returnFocusRef: fullscreenButtonRef,
    onClose: () => setIsFullscreen(false),
  });
  const [fullscreenSize, setFullscreenSize] = useState<{ width: number; height: number } | null>(
    null
  );

  useEffect(() => {
    // 휴대폰 전체화면은 CSS로 화면을 채운다 — 그래프는 svg 안에서 가로세로비를 지켜 맞춘다
    if (!isFullscreen || fullscreenOnMobile) return;
    function computeSize() {
      const marginPx = 32;
      const maxW = (window.visualViewport?.width ?? window.innerWidth) - marginPx * 2;
      const maxH = (window.visualViewport?.height ?? window.innerHeight) - marginPx * 2;
      const ratio = base.width / base.height;
      let width = maxW;
      let height = width / ratio;
      if (height > maxH) {
        height = maxH;
        width = height * ratio;
      }
      setFullscreenSize({ width, height });
    }
    computeSize();
    window.addEventListener('resize', computeSize);
    window.visualViewport?.addEventListener('resize', computeSize);
    return () => {
      window.removeEventListener('resize', computeSize);
      window.visualViewport?.removeEventListener('resize', computeSize);
    };
  }, [isFullscreen, fullscreenOnMobile, base]);

  const validSelectedId = selectedId && degree.has(selectedId) ? selectedId : null;

  const neighborIds = useMemo(() => {
    if (!validSelectedId) return new Set<string>();
    const ids = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.source === validSelectedId) ids.add(edge.target);
      if (edge.target === validSelectedId) ids.add(edge.source);
    }
    return ids;
  }, [validSelectedId, graph.edges]);

  // 중심 인물이 바뀌었을 때 카메라 — 2026-11-17 시안은 인물을 눌러도 그래프 전체가 그대로 보인다.
  // 예전(2026-08-25)에는 선택 인물 + 인접 인물 범위로 늘 확대했는데, 중심 인물이 늘 있는 지금은
  // 누를 때마다 다른 인물이 틀 밖으로 밀려났다(휴대폰 화면으로 확인). 그래서 확대하지 않고,
  // 새 중심 인물이 지금 보이는 범위 밖에 있을 때만(확대·이동해 둔 상태에서 검색으로 고른 경우 등)
  // 지금 배율 그대로 그 인물을 가운데로 옮긴다.
  useEffect(() => {
    if (!validSelectedId) return;
    const idx = graph.nodes.findIndex((n) => n.id === validSelectedId);
    if (idx < 0) return;
    const p = positions[idx];
    const vb = viewBoxRef.current;
    const inside = p.x >= vb.x && p.x <= vb.x + vb.width && p.y >= vb.y && p.y <= vb.y + vb.height;
    if (inside) return;
    animateViewBoxTo(
      clampViewBox({ x: p.x - vb.width / 2, y: p.y - vb.height / 2, width: vb.width, height: vb.height }, base)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validSelectedId]);

  // SVG는 기본적으로 preserveAspectRatio="xMidYMid meet" — 컨테이너와 viewBox의 가로세로비가
  // 다르면 더 좁게 맞아야 하는 쪽(폭 기준 배율 또는 높이 기준 배율 중 작은 쪽)에 맞춰 여백을
  // 두고 줄인다. 폭만 기준으로 unit을 구하면, 패널을 가로로 늘려 컨테이너가 viewBox보다
  // 상대적으로 넓어졌을 때 실제로는 높이가 배율을 결정하는데 폭 기준값을 쓰게 돼 글자·노드가
  // 실제보다 작게 계산됐다(2026-08-25, "가로로 늘리면 글씨가 작아진다" 피드백) — 두 축 모두
  // 계산해 더 큰 쪽(더 좁게 맞아야 하는 쪽)을 쓴다.
  const canvasPx = () => {
    const el = canvasRef.current;
    const widthPx = el?.clientWidth || FALLBACK_CANVAS_WIDTH_PX;
    const heightPx = el?.clientHeight || widthPx * (base.height / base.width);
    return { widthPx, heightPx };
  };
  const unit = () => {
    const { widthPx, heightPx } = canvasPx();
    return Math.max(viewBox.width / widthPx, viewBox.height / heightPx);
  };

  // 100%(fit) 상태 기준 k — 노드 원을 이 값 대비로 스케일해 "글자처럼" 화면상 크기를
  // 고정한다(아래 nodeScale 참고).
  const unit0 = () => {
    const { widthPx, heightPx } = canvasPx();
    return Math.max(base.width / widthPx, base.height / heightPx);
  };

  /**
   * animated=true(+/− 버튼, 2026-08-25 — 클릭 한 번에 순간이동하던 걸 부드럽게)면
   * animateViewBoxTo로, 아니면(휠·핀치줌 — 사용자 입력을 1:1로 따라가는 연속 동작이라
   * 이미 부드럽다) 즉시 setViewBox로 반영한다.
   */
  function zoomAt(clientX: number, clientY: number, factor: number, animated = false) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const computeNext = (vb: ViewBox): ViewBox => {
      // svg는 viewBox를 가로세로비를 지켜 가운데에 맞춘다(meet) — 휴대폰 전체화면처럼 캔버스
      // 비율이 그래프와 달라도 손가락 아래 지점을 기준으로 확대되게 같은 방식으로 환산한다.
      const scale = Math.max(vb.width / rect.width, vb.height / rect.height);
      const ux = vb.x + vb.width / 2 + (clientX - (rect.left + rect.width / 2)) * scale;
      const uy = vb.y + vb.height / 2 + (clientY - (rect.top + rect.height / 2)) * scale;
      const rawWidth = vb.width / factor;
      const width = Math.max(
        base.width * MIN_ZOOM_RATIO,
        Math.min(base.width * MAX_ZOOM_RATIO, rawWidth)
      );
      const k = width / vb.width;
      return clampViewBox(
        { x: ux - (ux - vb.x) * k, y: uy - (uy - vb.y) * k, width, height: vb.height * k },
        base
      );
    };
    if (animated) {
      animateViewBoxTo(computeNext(viewBoxRef.current));
    } else {
      setViewBox(computeNext);
    }
  }

  // 네이티브 리스너로 직접 붙인다 — React 17+ 는 onWheel 합성 이벤트를 passive로
  // 등록해서 그 안에서 preventDefault()를 불러도 실제로는 막히지 않는다(콘솔 경고만
  // 뜨고 페이지가 같이 스크롤된다). 줌 도중 배경 스크롤을 막으려면 이 방법뿐이다.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.14 : 1 / 1.14);
    }
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, isFullscreen]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-graph-zoom-control]')) return;
    const drag = dragRef.current;
    drag.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    drag.moved = 0;
    if (drag.pointers.size === 1) {
      drag.last = { x: event.clientX, y: event.clientY };
    } else if (drag.pointers.size === 2) {
      const pts = [...drag.pointers.values()];
      drag.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  }

  // 포인터 캡처를 쓰지 않는다 — 캡처하면 드래그 중 손가락이 노드 위를 지나가도 그
  // 노드의 클릭 이벤트가 죽는다. window 에서 추적해야 클릭이 살아 있다.
  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag.pointers.has(event.pointerId)) return;
      drag.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (drag.pointers.size === 2 && drag.pinchDist !== null) {
        const pts = [...drag.pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (drag.pinchDist > 0) {
          zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, dist / drag.pinchDist);
        }
        drag.pinchDist = dist;
        drag.moved = 99;
        return;
      }

      if (drag.pointers.size === 1 && drag.last) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        // 위 zoomAt과 같은 meet 환산 — 캔버스 비율이 그래프와 달라도 손가락과 같은 거리만큼 움직인다
        const scale = Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
        const dx = (event.clientX - drag.last.x) * scale;
        const dy = (event.clientY - drag.last.y) * scale;
        drag.moved += Math.abs(event.clientX - drag.last.x) + Math.abs(event.clientY - drag.last.y);
        if (drag.moved > 4) {
          setViewBox((vb) => clampViewBox({ ...vb, x: vb.x - dx, y: vb.y - dy }, base));
        }
        drag.last = { x: event.clientX, y: event.clientY };
      }
    }
    function handleUp(event: PointerEvent) {
      const drag = dragRef.current;
      drag.pointers.delete(event.pointerId);
      if (drag.pointers.size < 2) drag.pinchDist = null;
      if (drag.pointers.size === 0) drag.last = null;
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
    // base 는 그래프가 바뀔 때만 바뀌고, viewBox 는 최신값을 클로저로 매번 새로 잡아야
    // 팬 델타 계산이 어긋나지 않는다.
  }, [base, viewBox.width, viewBox.height]);

  function wasDragged() {
    return dragRef.current.moved > 6;
  }

  function handleNodeClick(id: string) {
    if (wasDragged()) return;
    onSelectEdge?.(null);
    // 2026-11-17 시안 — 누른 인물이 중심이 된다. 같은 인물을 다시 눌러도 풀리지 않는다.
    onSelect(id);
  }

  function handleEdgeClick(key: string) {
    if (wasDragged()) return;
    onSelectEdge?.(validSelectedEdgeKey === key ? null : key);
  }

  function fitView() {
    animateViewBoxTo({ x: base.x, y: base.y, width: base.width, height: base.height });
  }

  // 컨테이너 크기가 바뀌면(창 크기·반응형 레이아웃·싸비 패널 드래그 리사이즈) k(줌 배율)도
  // 다시 계산해야 폰트·선 굵기가 화면상 크기를 유지한다 — viewBox 값 자체는 안 바꾸고
  // 재렌더만 강제한다.
  //
  // 예전엔 window의 resize 이벤트만 들었다. 그런데 싸비 패널 폭 조절(usePanelResize,
  // Reader.tsx)은 브라우저 창 크기가 아니라 이 컴포넌트를 감싼 <aside>의 CSS 폭만 바꾸는
  // 것이라 window resize가 아예 안 일어난다 — 드래그 중엔 k가 갱신될 계기가 없어서, 다음
  // 렌더에서 canvasRef.current.clientWidth를 읽어도 그 렌더 자신이 만든 DOM 변화가 아직
  // 반영되기 전 값(한 스텝 뒤처진 값)을 읽게 된다. 그 결과 그래프 바깥 상자는 순수 CSS
  // (aspect-ratio)로 즉시 폭을 따라가는데, k로 계산하는 글자·선 굵기는 뒤늦게 따라오는
  // 것처럼 보였다(2026-08-25, 사용자 제보 — "관계도 창이 혼자 조절된 다음 전체 창 조절은
  // 뒤늦게 따라온다"). ResizeObserver는 원인이 뭐든(창 크기·패널 드래그·다른 반응형 변화)
  // 이 컨테이너 자체의 실제 렌더 크기가 바뀐 뒤에 콜백이 온다 — 그 시점엔 clientWidth가
  // 이미 새 값이라 뒤처지지 않는다.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setViewBox((vb) => ({ ...vb }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isFullscreen]);

  const k = unit();
  // 노드 원·글자는 출발선이 서로 반대다 — 원은 원래 아무 보정도 없어(유닛값 그대로)
  // 축소할수록 계속 작아지고, 글자는 *k 보정이 이미 있어(NAME_FONT_PX*k) 화면상
  // 크기가 완전히 고정돼 있었다. 둘 다 "완전 고정도 아니고 원래 방식도 아닌 절충
  // (제곱근)"으로 만들려면 서로 다른 방향으로 다뤄야 한다 — 원은 고정 쪽으로 반만
  // 끌어오고(곱한다), 글자는 원래(줌에 따라 변하는) 쪽으로 반만 풀어준다(나눈다).
  // 처음에 둘 다 곱했다가 글자가 축소하면 오히려 커지고 확대하면 안 보일 정도로
  // 작아지는 버그가 났다(2026-08-25, 4차) — 아래 계산 참고.
  //
  // nodeScale(곱함): 100% 기준 완전 고정이 nodeScale=k/k0(지수 1)이므로, 지수 0.5는
  // 그 절반만 고정 쪽으로 끌어온 값 — 축소하면 원도 조금 작아지되 예전보다는 덜.
  // labelScale(나눔): 완전 고정(지금까지 글자 방식)이 "그대로"(나눌 것 없음)이므로,
  // 그 고정을 지수 0.5만큼 풀어주려면 1/nodeScale로 나눠야 한다 — 축소하면 글자도
  // 조금 작아지되 원처럼 절반만.
  // 둘 다 k=k0(100%)에서는 1이라 지금까지 확정한 기본 크기는 그대로 유지된다.
  const NODE_ZOOM_DAMPING = 0.5;
  const nodeScale = Math.pow(k / unit0(), NODE_ZOOM_DAMPING);
  const labelScale = 1 / nodeScale;
  const k0 = unit0();
  /** 칩 반 변(사용자 좌표). 100%에서 화면 px 그대로, 확대·축소하면 nodeScale만큼만 따라간다. */
  const chipHalf = (id: string) =>
    chipHalfPx(degree.get(id) ?? 0, id === validSelectedId) * k0 * nodeScale;
  const edgePaths = useMemo(
    () =>
      makeEdgePaths(
        graph.nodes,
        graph.edges,
        positions,
        // 네모 칩은 모서리까지 원보다 멀다 — 반 변의 1.15배 + 여백
        (id) => chipHalf(id) * 1.15 + 5 * k,
        38 * k * labelScale
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph.nodes, graph.edges, positions, degree, nodeScale, k, k0, labelScale, validSelectedId]
  );

  const validSelectedEdgeKey =
    selectedEdgeKey && edgePaths.some((entry) => entry.key === selectedEdgeKey)
      ? selectedEdgeKey
      : null;

  // 인물명 라벨 박스 — 겹치면 연결 수 적은 쪽을 숨긴다. 선택·인접 인물은 최우선.
  // 관계 라벨(아래)이 이 중 실제로 보이는 라벨과 안 겹치게 하려면 살아남은 박스
  // 자체가 필요하다 — id 집합만으론 위치·크기를 다시 못 얻는다.
  const nameLabelBoxes = useMemo(() => {
    const boxes: (LabelBox & { id: string })[] = graph.nodes.map((node, i) => {
      const p = positions[i];
      const r = chipHalf(node.id);
      const isSelected = node.id === validSelectedId;
      const fontPx = isSelected ? EGO_NAME_FONT_PX : NAME_FONT_PX;
      const width =
        estimateTextWidth(node.name, fontPx * KOREAN_CHAR_WIDTH_RATIO * k * labelScale) + 4 * k;
      const height = (fontPx * labelScale + 4) * k;
      const isNeighbor = neighborIds.has(node.id);
      return {
        id: node.id,
        x: p.x - width / 2,
        y: p.y + r,
        width,
        height,
        priority: (degree.get(node.id) ?? 0) + (isSelected ? 9999 : 0) + (isNeighbor ? 500 : 0),
      };
    });
    return pickNonOverlapping(boxes);
    // k(줌 배율)가 바뀌면 라벨 크기가 바뀌어 충돌 여부도 바뀐다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes, positions, degree, validSelectedId, neighborIds, k, k0, nodeScale, labelScale]);

  const nameLabels = useMemo(() => new Set(nameLabelBoxes.map((b) => b.id)), [nameLabelBoxes]);

  /**
   * 관계 이름표 — 중심 인물과 닿은 선 전부 + 고른 선 (2026-11-17 시안: 중심 인물의 선에는 늘 이름표가 있다).
   * 글은 관계 이름(edge.label) 그대로 쓰고, 사실/의심·주장은 선 모양(실선/점선)과 아래 카드의 글자 배지가
   * 말한다(NFR-USE-006). 이름표가 칩·이름·다른 이름표와 겹치면 선을 따라 자리를 옮겨 본 뒤
   * (가운데 → 양옆), 그래도 겹치면 그 이름표만 뺀다. 고른 선의 이름표가 가장 먼저 자리를 잡는다.
   */
  const edgeLabels = useMemo(() => {
    // 같은 두 사람 사이 선이 여럿이면 이름표는 한 쌍에 하나 — 묶은 짧은 이름을 단다 (FR-CHR-001 시안)
    const pairNames = groupPillLabels(edgePaths.map(({ edge }) => edge));
    const pairOf = (edge: GraphEdge) => JSON.stringify([edge.source, edge.target].sort());
    const seenPairs = new Set<string>();
    const candidates = edgePaths
      .filter(
        ({ edge, key }) =>
          key === validSelectedEdgeKey ||
          (validSelectedId !== null && (edge.source === validSelectedId || edge.target === validSelectedId))
      )
      .sort(
        (a, b) =>
          Number(b.key === validSelectedEdgeKey) - Number(a.key === validSelectedEdgeKey) ||
          b.length - a.length
      )
      .filter(({ edge, key }) => {
        if (key === validSelectedEdgeKey) {
          seenPairs.add(pairOf(edge));
          return true;
        }
        if (seenPairs.has(pairOf(edge))) return false;
        seenPairs.add(pairOf(edge));
        return true;
      })
      .map((entry) => {
        const label =
          entry.key === validSelectedEdgeKey
            ? graphPillLabel(entry.edge)
            : (pairNames.get(pairOf(entry.edge)) ?? graphPillLabel(entry.edge));
        const width = estimateTextWidth(label, EDGE_LABEL_CHAR_PX * k * labelScale) + 14 * k;
        const height = (EDGE_LABEL_FONT_PX * labelScale + 9) * k;
        return { entry, key: entry.key, label, width, height };
      })
      .sort(
        (a, b) =>
          Number(b.key === validSelectedEdgeKey) - Number(a.key === validSelectedEdgeKey) ||
          b.entry.length - a.entry.length
      );

    // 칩(사각형)과 이름 라벨은 이름표가 덮지 않는다
    const blockers: LabelBox[] = [
      ...nameLabelBoxes,
      ...graph.nodes.map((node, i) => {
        const p = positions[i];
        const h = chipHalf(node.id);
        return { x: p.x - h, y: p.y - h, width: h * 2, height: h * 2, priority: Infinity };
      }),
    ];
    const overlaps = (a: LabelBox, b: LabelBox) =>
      !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
    const placed: (LabelBox & { key: string; label: string; cx: number; cy: number })[] = [];
    for (const c of candidates) {
      for (const t of [0.5, 0.4, 0.6, 0.32, 0.68]) {
        const at = edgePointAt(c.entry, t);
        const box = {
          key: c.key,
          label: c.label,
          cx: at.x,
          cy: at.y,
          x: at.x - c.width / 2,
          y: at.y - c.height / 2,
          width: c.width,
          height: c.height,
          priority: 0,
        };
        if (blockers.some((b) => overlaps(box, b)) || placed.some((b) => overlaps(box, b))) continue;
        placed.push(box);
        break;
      }
    }
    return placed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validSelectedId, validSelectedEdgeKey, edgePaths, k, k0, labelScale, nameLabelBoxes, positions, graph.nodes]);

  const graphBox = (
    <div
      ref={wrapRef}
      // 높이를 고정값(h-[280px])으로 두면 패널을 가로로 늘려도(usePanelResize) 세로는
      // 그대로라 그래프 영역이 점점 옆으로 길쭉해졌다(2026-08-25, "늘리면 가로로만
      // 늘어난다" 피드백). 그래프 내용(base)의 가로세로비로 aspect-ratio를 잡아 폭이
      // 늘면 높이도 같이 늘게 한다 — min/max로 극단적인 비율(인물이 한 줄로 쭉 이어진
      // 그래프 등)에서도 너무 짜부라지거나 과하게 늘어나지 않게 막는다.
      //
      // 전체화면 중엔 이 규칙 대신 fullscreenSize(위에서 화면에 맞춰 계산한 px)를 쓴다 —
      // base의 가로세로비는 그대로 유지된 채 크기만 화면에 맞춰 커진다.
      //
      // 휴대폰 전체화면(E2E #51)은 고정 크기 카드가 아니라 오버레이의 남은 자리를 모두 채운다.
      className={
        mobileFullscreen
          ? 'relative flex h-full w-full min-h-0 flex-col touch-none bg-white outline-none'
          : isFullscreen
          ? 'relative flex flex-col touch-none rounded-[20px] border border-brief-rule bg-white'
          : 'relative flex w-full min-h-[220px] max-h-[420px] flex-col touch-none rounded-[20px] border border-brief-rule bg-white'
      }
      style={
        mobileFullscreen
          ? undefined
          : isFullscreen && fullscreenSize
          ? { width: fullscreenSize.width, height: fullscreenSize.height }
          : { aspectRatio: `${base.width} / ${base.height}` }
      }
      onPointerDown={handlePointerDown}
      // 전체화면 오버레이의 배경(바깥)을 눌러야 닫힌다 — 그래프 안(빈 캔버스 포함)을
      // 눌렀을 때는 안 닫혀야 하므로, svg 쪽 클릭(빈 캔버스 클릭 시 선택 해제)이 이
      // 컨테이너를 넘어 배경까지 버블링하지 않게 여기서 막는다.
      onClick={isFullscreen ? (event) => event.stopPropagation() : undefined}
      role={isFullscreen ? 'dialog' : undefined}
      tabIndex={isFullscreen ? -1 : undefined}
      aria-modal={isFullscreen ? true : undefined}
      aria-label={isFullscreen ? '인물 관계도 전체화면' : undefined}
    >
      <svg
        ref={canvasRef}
        data-graph-canvas
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className="min-h-0 w-full flex-1 cursor-grab select-none active:cursor-grabbing"
        onClick={(event) => {
          if (wasDragged()) return;
          if (!(event.target as SVGElement).closest('[data-node-id], [data-edge-group]')) {
            onSelect(null);
            onSelectEdge?.(null);
          }
        }}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-brief-accent" />
          </marker>
        </defs>
        <g>
          {edgePaths.map(({ edge, key, path }) => {
            const touches = validSelectedId === edge.source || validSelectedId === edge.target;
            const isSelectedEdge = key === validSelectedEdgeKey;
            const direction = edge.semantics?.direction;
            // FR-CHR-001 — 실선 = 사실, 점선 = 의심·주장(사실이 아닌 단언)이거나 끝난 관계.
            // 옛 관계(semantics 없음)는 사실 여부를 지어내지 않고 실선으로 둔다.
            const qualified =
              edge.semantics &&
              (edge.semantics.assertion_status !== 'fact' || edge.semantics.state === 'ended');
            // 화살표(감정·행동의 방향)는 강조된 선에만 — 2026-11-17 시안. 옅은 선까지 화살표를 달면 어지럽다.
            const marker = touches || isSelectedEdge ? `url(#${markerId})` : undefined;
            return (
              <g
                key={key}
                data-edge-group
                onClick={(event) => {
                  event.stopPropagation();
                  handleEdgeClick(key);
                }}
                className="cursor-pointer"
              >
                {/* 클릭 영역 — 얇은 선도 누르기 쉽게 20px. 이름표는 pointer-events 없음이라 가리지 않는다. */}
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={EDGE_HIT_WIDTH * k}
                  pointerEvents="stroke"
                />
                <path
                  data-edge-id={edge.id ?? key}
                  data-selected={isSelectedEdge ? 'true' : 'false'}
                  data-ego-edge={touches ? 'true' : 'false'}
                  d={path}
                  fill="none"
                  markerStart={direction === 'b_to_a' || direction === 'mutual' ? marker : undefined}
                  markerEnd={direction === 'a_to_b' || direction === 'mutual' ? marker : undefined}
                  strokeDasharray={qualified ? `${6 * k} ${5 * k}` : undefined}
                  strokeLinecap="round"
                  className={
                    isSelectedEdge ? undefined : touches ? 'stroke-brief-accent' : 'stroke-brief-muted/35'
                  }
                  stroke={isSelectedEdge ? SELECTED_EDGE_COLOR : undefined}
                  strokeWidth={
                    (isSelectedEdge ? SELECTED_EDGE_WIDTH : touches ? EGO_EDGE_WIDTH : PLAIN_EDGE_WIDTH) * k
                  }
                  // 선택과 무관한 선도 흐리게 하지 않는다 — 강조는 색·굵기로만 (2026-11-17)
                  opacity={1}
                  pointerEvents="none"
                >
                  <title>{graphEdgeLabel(edge)}</title>
                </path>
              </g>
            );
          })}
        </g>

        <g>
          {graph.nodes.map((node, i) => {
            const p = positions[i];
            const half = chipHalf(node.id);
            const isSelected = node.id === validSelectedId;
            const fontPx = isSelected ? EGO_NAME_FONT_PX : NAME_FONT_PX;
            const ring = 5 * k;
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                tabIndex={0}
                role="button"
                aria-label={node.name}
                aria-pressed={isSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  handleNodeClick(node.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleNodeClick(node.id);
                  }
                }}
                className="cursor-pointer outline-none"
                opacity={1}
              >
                <rect
                  x={p.x - half - 10 * k}
                  y={p.y - half - 10 * k}
                  width={(half + 10 * k) * 2}
                  height={(half + 10 * k) * 2}
                  fill="transparent"
                />
                {/* 2026-11-17 시안 — 둥근 네모 칩 + 첫 글자. 중심 인물은 크게, 버건디 테두리와 바깥 고리. */}
                {isSelected ? (
                  <rect
                    data-ego-ring
                    x={p.x - half - ring}
                    y={p.y - half - ring}
                    width={(half + ring) * 2}
                    height={(half + ring) * 2}
                    rx={half * 0.46 + ring}
                    fill="none"
                    className="stroke-brief-accent/30"
                    strokeWidth={4 * k}
                  />
                ) : null}
                <rect
                  data-node-chip
                  x={p.x - half}
                  y={p.y - half}
                  width={half * 2}
                  height={half * 2}
                  rx={half * 0.36}
                  className={
                    isSelected
                      ? 'fill-brief-accent-soft stroke-brief-accent'
                      : 'fill-white stroke-brief-rule'
                  }
                  strokeWidth={(isSelected ? 1.6 : 1.2) * k}
                />
                <text
                  data-node-initial
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`${isSelected ? 'fill-brief-accent' : 'fill-brief-ink'} font-dashSans font-extrabold`}
                  style={{ fontSize: half * 0.9 }}
                  aria-hidden="true"
                >
                  {initialOf(node.name)}
                </text>
                {nameLabels.has(node.id) ? (
                  <text
                    data-node-name
                    x={p.x}
                    y={p.y + half + fontPx * k * labelScale + 3 * k}
                    textAnchor="middle"
                    className={`${
                      isSelected ? 'fill-brief-accent font-bold' : 'fill-brief-muted font-semibold'
                    } stroke-white font-dashSans`}
                    style={{
                      fontSize: fontPx * k * labelScale,
                      letterSpacing: 0.5 * k * labelScale,
                      paintOrder: 'stroke',
                      // 이름 아래를 지나는 선이 글자 사이로 비치지 않게 흰 테두리를 넉넉히
                      strokeWidth: 5 * k,
                      strokeLinejoin: 'round',
                    }}
                  >
                    {node.name}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {/* 이름표는 칩 위에 그린다 — 선이 칩 근처에서 꺾여도 글이 칩에 가리지 않는다 */}
        <g>
          {edgeLabels.map((label) => {
            const selected = label.key === validSelectedEdgeKey;
            return (
              <g key={label.key} data-edge-label data-selected={selected ? 'true' : 'false'} pointerEvents="none">
                <rect
                  x={label.x}
                  y={label.y}
                  width={label.width}
                  height={label.height}
                  rx={label.height / 2}
                  className={selected ? undefined : 'fill-white stroke-brief-accent/45'}
                  fill={selected ? SELECTED_EDGE_COLOR : undefined}
                  stroke={selected ? SELECTED_EDGE_COLOR : undefined}
                  strokeWidth={1 * k}
                />
                <text
                  x={label.cx}
                  y={label.cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`${selected ? 'fill-white' : 'fill-brief-accent'} font-dashSans font-bold`}
                  style={{ fontSize: EDGE_LABEL_FONT_PX * k * labelScale }}
                >
                  {label.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* NFR-USE-006: 조작 버튼은 SVG 밖의 전용 행에 둔다. 두 인물만 펼쳐져도
          인물·이름과 겹치지 않으며, 확대·이동 좌표는 canvasRef의 실제 영역을 쓴다. */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-t border-brief-rule px-2 py-2"
        role="toolbar"
        aria-label="관계도 조작"
        data-graph-zoom-control
      >
        <span className="rounded-pill border border-brief-rule bg-white/90 px-2 py-0.5 text-[10px] text-brief-muted">
          {Math.round((base.width / viewBox.width) * 100)}%
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="확대"
            className="flex h-11 w-11 lg:h-7 lg:w-7 items-center justify-center rounded-full border border-brief-rule bg-white/95 text-brief-muted"
            onClick={() => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.35, true);
            }}
          >
            +
          </button>
          <button
            type="button"
            aria-label="축소"
            className="flex h-11 w-11 lg:h-7 lg:w-7 items-center justify-center rounded-full border border-brief-rule bg-white/95 text-brief-muted"
            onClick={() => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (rect)
                zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.35, true);
            }}
          >
            −
          </button>
          <button
            type="button"
            aria-label="전체 보기"
            className="flex h-11 w-11 lg:h-7 lg:w-7 items-center justify-center rounded-full border border-brief-rule bg-white/95 text-[11px] text-brief-muted"
            onClick={fitView}
          >
            ⤢
          </button>
          <button
            type="button"
            ref={fullscreenButtonRef}
            aria-label={isFullscreen ? '전체화면 종료' : '전체화면'}
            aria-pressed={isFullscreen}
            className="flex h-11 w-11 lg:h-7 lg:w-7 items-center justify-center rounded-full border border-brief-rule bg-white/95 text-brief-muted"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  if (!isFullscreen) return graphBox;

  // document.body로 포털한다 — QuotePopover.tsx와 같은 이유(그 파일 주석 참고)다.
  // 이 오버레이는 SsabiPanel의 tabpanel(`relative z-0`) 안에서 그려지는데, 그 형제인
  // 탭 바(`relative z-10`)가 자기 스태킹 컨텍스트 전체보다 위에 온다. `fixed`로 화면에
  // 붙여도 스태킹 비교는 DOM상 조상 컨텍스트 안에서만 일어나므로, z-50을 줘도 탭 바·
  // 패널 리사이즈 손잡이·싸비 여닫기 버튼 등 tabpanel 밖에 있는 UI에 가려 전체화면이
  // 전체화면처럼 안 보이고 뒤에 깔렸다(2026-08-26, 사용자 제보 — elementFromPoint로
  // 확인: 탭 바 자리를 눌러도 오버레이가 아니라 탭 버튼이 잡힘). body로 포털하면 그
  // 조상 스태킹 컨텍스트를 벗어나 z-index 비교가 페이지 최상위에서 의도대로 동작한다.
  //
  // 휴대폰(E2E #51): 가운데 카드 + 반투명 배경이면 뒤의 싸비 패널이 비쳐 전체화면 같지 않았다.
  // 화면 전체(100dvh × 100vw)를 불투명하게 덮고, 싸비 시트(z-10)·확인 창(z-60·70)보다 위에
  // 두며, 노치·홈 막대 자리만큼 비워 아래 조작 줄(전체화면 종료 포함)이 손에 닿게 한다.
  // data-mobile 을 다시 달아 포털 밖에서도 휴대폰용 변형(mobile:)이 그대로 걸리게 한다.
  if (mobileFullscreen) {
    return createPortal(
      <div
        data-testid="relationship-graph-fullscreen-overlay"
        data-mobile="true"
        className="viewport-overlay fixed inset-0 z-[80] flex h-[100dvh] w-screen flex-col overflow-hidden bg-white"
        style={{
          paddingTop: 'var(--safe-top)',
          paddingBottom: 'var(--safe-bottom)',
          paddingLeft: 'var(--safe-left)',
          paddingRight: 'var(--safe-right)',
        }}
      >
        {graphBox}
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      data-testid="relationship-graph-fullscreen-overlay"
      onClick={() => setIsFullscreen(false)}
      className="viewport-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    >
      {graphBox}
    </div>,
    document.body
  );
}
