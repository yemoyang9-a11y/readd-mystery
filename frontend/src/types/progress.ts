/**
 * 진도·세션 타입 — API_CONTRACT.md 1~5번 (R2 제공) + team-sync-r4.md §1 (8/20 R2 회신).
 * 프론트는 기준점을 계산하지도 보내지도 않는다 (절대 규칙 2·8번).
 */

/**
 * POST /books/:bookId/entry — 진입 판정. 라우팅은 서버가 정한다 (FR-BRF-001)
 * 본문의 device_id는 R2가 무시하기로 했다 — 헤더 X-Device-Id 가 정본이다 (team-sync §4.8).
 * TODO(팀 결정 대기) 헤더가 아직 없는 최초 실행 시 이 요청을 어떻게 보내는지 미정 — §4.8.
 */
export interface EntryRequest {
  device_id: string;
}

export interface EntryResponse {
  route: 'briefing' | 'reader';
  page: number;
  /** 싸비 탭 초기화 경계로 쓴다 (FR-SVB-004) */
  is_new_session: boolean;
  /**
   * route 와 무관하게 항상 내려온다. 직전 값과 같으면 같은 세션, 바뀌면 새 세션 —
   * 싸비 탭 초기화는 이 값의 변화로 판정한다 (R2 확정, 8/20).
   * entry 를 받을 때마다 로컬 seq 도 1부터 다시 시작한다 — 서버가 event_seq 를 0으로
   * 리셋하기 때문에 영속 저장이 필요 없다 (team-sync §1.6).
   */
  session_epoch: number;
}

/** POST /books/:bookId/progress — 진도 이벤트. fire-and-forget (NFR-PERF-005)
 *  R2가 명시적으로 유지를 확정했다 — GET /pages 로 흡수하지 않는다 (team-sync §1.1, R2 거절 근거:
 *  선요청 안전 위반·프리페치 시 미열람 구간 노출). 페이지가 열릴 때마다 그대로 호출한다. */
export interface ProgressEvent {
  page: number;
  /** 클라이언트 단조 증가 시퀀스. 서버는 더 새로운 seq만 수용 (FR-PRG-002) */
  seq: number;
  /**
   * 이 쪽 직전에 화면에 떠 있던 쪽 (2026-11-17, 차례로 읽은 범위). 직전 화면이 없으면
   * (진입 뒤 첫 쪽) 싣지 않는다. 다음·이전·목차·노트 이동 등 모든 쪽 변경에 싣고,
   * 차례로 넘긴 것인지는 서버만 판정한다 — 프론트는 사실만 보고한다 (절대 규칙 2·8번).
   */
  from_page?: number;
  /** 목차 확인 창의 "앞부분은 이미 읽었어요"로 생긴 이동 이벤트 하나에만 싣는다 */
  claim?: ProgressClaim;
}

export type ProgressClaim = 'read_through';

/**
 * 넘겨 본 쪽 확인 요청 — 확정 기준점보다 뒤 쪽을 열어 본 뒤 아직 답하지 않았을 때만 온다.
 * current_page 는 기준점과 furthest_page 사이의 의미 있는 선택지일 때만 숫자다.
 * 숫자는 화면에 그대로 쓴다 — 프론트가 계산하지 않는다 (FR-BRF-005 🚦).
 */
export interface FrontierConfirm {
  current_page: number | null;
  furthest_page: number;
}

/** POST /books/:bookId/progress, POST /books/:bookId/progress/confirm 응답 */
export interface ProgressResponse {
  success: boolean;
  applied_cutoff: number;
  confirm: FrontierConfirm | null;
}

/** POST /books/:bookId/progress/confirm 본문의 choice */
export type FrontierChoice = 'keep' | 'current' | 'furthest';

/** 싸비 확인 카드가 그리는 값 — 같은 응답의 applied_cutoff 와 confirm 을 묶은 것 */
export interface FrontierConfirmPrompt extends FrontierConfirm {
  applied_cutoff: number;
}

/** POST /books/:bookId/heartbeat — 5분 주기, 조작 시각 갱신 전용 (A2) */
export interface HeartbeatRequest {
  timestamp: string;
}

export interface SuccessResponse {
  success: boolean;
}

/** GET /books/:bookId/briefing — 브리핑 (FR-BRF-002~005) */
export interface BriefingResponse {
  /**
   * 응답 payload 의 페이지 값 필드 (NFR-OBS-003, FR-SPL-002 🚦 판정 전제).
   * 조회 응답은 최상단에 싣는다 — SSE 는 done 프레임에 싣는다 (team-sync §4.2).
   */
  applied_cutoff: number;
  /** null 이면 스트리밍 폴백. 단 첫 진입(cutoff=0)은 폴백 대상이 아니다 (D13 ①) */
  recap: string | null;
  current_chapter: {
    chapter_no: number;
    title: string;
  };
  /**
   * percent 는 서버 계산값 — 그대로 렌더한다 (FR-BRF-005 🚦).
   * 첫 진입(current_page=1)은 0%가 아니라 1/total_pages 값이 온다(예: 0.2%) — R2가 계약대로
   * 나눗셈 값을 내려보내기로 확정했다. 0%로 보여야 하면 표시 단에서 반올림한다 (team-sync §4.9).
   */
  progress: {
    current_page: number;
    total_pages: number;
    percent: number;
  };
}
