/**
 * 사건(타임라인) 추출 — 장면 단위 + 원문 근거 검증. FR-DAT-008
 *
 * 1) 장면 경계 제안(LLM 1회/장): 행동·장소·등장인물 구성이 바뀌는 곳(Zehe et al. 2021의
 *    장면 정의). 코드가 경계를 가장 가까운 문단 시작으로 스냅하고, 장 범위 밖·중복·순서
 *    오류를 바로잡는다. 쓸 만한 경계가 없으면 장 하나가 한 장면이다. 장면은 입력을 자르는
 *    단위일 뿐이다.
 * 2) 장면별 사건 추출(LLM 1회/장면): 입력은 장 시작부터 그 장면 끝까지의 원문뿐이다.
 *    장면 뒤 텍스트는 같은 장 안이라도 주지 않는다 — 뒤쪽을 보고 고르거나 뒤에서 밝혀진
 *    사실로 앞 사건을 쓰는 일을 구조로 막는다(FR-SPL-002 🚦).
 * 3) 코드 검증(NFR-AI-004): 인용이 그 쪽 원문에 실제로 있는지, 근거가 장면 끝을 넘지
 *    않는지, realis=actual인지, 대사 사건이 발화 행위로 적혔는지, 해석·평가어가 없는지.
 *    occurrence_page는 LLM 값을 버리고 그 장면의 끝 쪽으로 둔다. 검증 실패는 버리지 않고
 *    검수 후보로 보낸다(realis≠actual만 사건이 아니므로 제거).
 * 4) 같은 장면 안 같은 행위자·비슷한 행위는 하나로 합친다.
 *
 * 장당 LLM 호출 수 = 1 + 장면 수 — chapterEventCallCount. 배치 전용이며 런타임 호출을
 * 늘리지 않는다(R9). 호출은 주입된 ask(게이트웨이 경유)로만 한다(4.3절).
 */
import { Chapter, Page } from '../../shared/types';
import { buildPageTaggedText } from './generate';
import { ReviewCandidate, SourceEvidence, validEvidence } from './grounding';
import { evaluativeWord } from './semantic-guards';

/** 대표 결정 — 장면당 최대 사건 수 */
export const MAX_EVENTS_PER_SCENE = 2;
const MIN_EVIDENCE = 1;
const MAX_EVIDENCE = 3;
const TITLE_MAX_LENGTH = 40;
/** 같은 장면 안 중복 판정 — 행위자 이름을 뺀 행위 문구의 글자 2-gram Dice 계수 */
const DUPLICATE_SIMILARITY = 0.7;
/** 캐시 계약 버전 — 검증 규칙이 바뀌면 올린다 */
export const EVENT_EXTRACTION_VERSION = 'scene-events-v1';

const MODES = ['narration', 'dialogue', 'document'] as const;
export type EventMode = (typeof MODES)[number];

/** 대사 사건은 "A가 ~라고 말했다/진술했다"처럼 발화 행위로 적혀야 한다 */
const SPEECH_ACT =
  /(말했|말하였|말한다|물었|묻는다|되물었|대답했|답했|대꾸했|진술했|주장했|외쳤|소리쳤|중얼거렸|속삭였|일렀|타일렀|전했|알렸|고백했|부인했|털어놓았|설명했|증언했|약속했|명령했|부탁했|요청했|제안했|덧붙였|이야기했|변명했|단언했|경고했|보고했|밝혔|꾸짖었|호통쳤|고했)/u;

export interface Scene {
  scene_no: number;
  /** 장 원문(쪽 본문을 순서대로 이은 문자열)에서의 시작 위치, 포함 */
  start: number;
  /** 장 원문에서의 끝 위치, 제외 */
  end: number;
  start_page: number;
  end_page: number;
}

/** DB events 행(event, description, occurrence_page)과 호환되고, 근거 필드를 덧붙인다 */
export interface TimelineEvent {
  event: string;
  description: string;
  occurrence_page: number;
  agent: string;
  mode: EventMode;
  flashback: boolean;
  scene_no: number;
  evidence: SourceEvidence[];
}

export interface ChapterEventRaw {
  boundaries: unknown;
  scenes: { start: number; end: number; response: unknown }[];
}

export interface ChapterEventResult {
  scenes: Scene[];
  events: TimelineEvent[];
  review: ReviewCandidate[];
  warnings: string[];
}

export type AskJson = (prompt: string) => Promise<unknown>;

interface PageSpan {
  page: Page;
  start: number;
  end: number;
}

interface ChapterLayout {
  text: string;
  spans: PageSpan[];
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function layout(pages: Page[]): ChapterLayout {
  const spans: PageSpan[] = [];
  let offset = 0;
  for (const page of [...pages].sort((a, b) => a.page_no - b.page_no)) {
    spans.push({ page, start: offset, end: offset + page.content.length });
    offset += page.content.length;
  }
  return { text: spans.map((s) => s.page.content).join(''), spans };
}

function pageAt(spans: PageSpan[], offset: number): number {
  const span = spans.find((s) => offset >= s.start && offset < s.end) ?? spans[spans.length - 1];
  return span.page.page_no;
}

function spanOf(spans: PageSpan[], pageNo: number): PageSpan | undefined {
  return spans.find((s) => s.page.page_no === pageNo);
}

/** 문단 시작 위치 — 장 첫머리와 문단 경계 문자('\n') 바로 뒤. split.ts가 문단을 '\n'으로 잇는다 */
function paragraphStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length - 1; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function nearest(candidates: number[], offset: number): number {
  return candidates.reduce((best, c) =>
    Math.abs(c - offset) < Math.abs(best - offset) ? c : best
  );
}

/** [from, to) 구간만 쪽 표시와 함께 보여 준다 — 구간 밖 글자는 한 자도 넣지 않는다 */
function renderSpan(spans: PageSpan[], from: number, to: number): string {
  return spans
    .filter((s) => s.end > from && s.start < to)
    .map(
      (s) =>
        `[페이지 ${s.page.page_no}]\n${s.page.content.slice(
          Math.max(from, s.start) - s.start,
          Math.min(to, s.end) - s.start
        )}`
    )
    .join('\n\n');
}

/** 1단계 프롬프트 — 장 원문 전체에서 장면 경계 위치만 받는다(사건 내용은 받지 않는다) */
export function buildSceneBoundaryPrompt(chapter: Chapter, pages: Page[]): string {
  return `다음은 이 작품 ${chapter.chapter_no}장 "${chapter.title}"의 원문 전체다(각 문단 앞에 [페이지 N] 표시).
이 장을 장면으로 나누는 장면 경계를 찾아라. 사건을 뽑거나 줄거리를 요약하지 않는다. 경계 위치만 표시한다.

장면 경계 기준:
- 장면은 같은 시간·같은 장소에서 같은 인물들이 이어 가는 행동의 단위다.
- 행동이 바뀌거나, 장소가 바뀌거나, 등장인물 구성이 바뀌거나(누가 들어오거나 나감), 시간이 건너뛰는 곳에서 새 장면이 시작된다.
- 장 첫머리는 적지 않는다(자동으로 첫 장면의 시작이다). 경계가 없으면 빈 배열을 낸다.
- 각 경계는 새 장면 첫 문장의 앞부분을 원문 그대로 10~30자 인용한다. source_page는 그 문장이 있는 [페이지 N]의 숫자다. 인용은 그 페이지 안에서 한 번만 나오는 문자열이어야 한다.
- 서술 순서대로 적는다.

출력은 아래 JSON 형식만 반환하라. 다른 설명·마크다운 코드블록 없이 JSON 텍스트만 출력하라.
{"boundaries": [{"source_page": 0, "quote": "...", "reason": "장소 이동 등 짧은 이유"}]}

--- 원문 ---
${buildPageTaggedText(pages)}`;
}

/**
 * 경계 제안을 장면 목록으로 바꾼다. 인용 위치를 원문에서 찾아 가장 가까운 문단 시작으로
 * 스냅하고, 장 밖·못 찾은 인용·장 첫머리·중복은 버리고 순서를 정렬한다. 남는 경계가
 * 없으면 장 하나가 한 장면이다.
 */
export function resolveScenes(
  pages: Page[],
  raw: unknown
): { scenes: Scene[]; warnings: string[] } {
  const { text, spans } = layout(pages);
  const warnings: string[] = [];
  if (text.length === 0) return { scenes: [], warnings };
  const starts = paragraphStarts(text);
  const cuts = new Set<number>();
  const proposed = object(raw).boundaries;
  for (const item of Array.isArray(proposed) ? proposed : []) {
    const b = object(item);
    const located = validEvidence(b, pages, b.source_page, []);
    if (!located) {
      warnings.push(
        `장면 경계 무시: p.${String(b.source_page)} "${String(b.quote ?? '')}" — 장 원문에서 한 곳으로 찾을 수 없음`
      );
      continue;
    }
    const offset = spanOf(spans, located.source_page)!.start + located.start_char;
    const snapped = nearest(starts, offset);
    if (snapped > 0 && snapped < text.length) cuts.add(snapped);
  }
  const bounds = [0, ...[...cuts].sort((a, b) => a - b), text.length];
  const scenes: Scene[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    scenes.push({
      scene_no: i + 1,
      start: bounds[i],
      end: bounds[i + 1],
      start_page: pageAt(spans, bounds[i]),
      end_page: pageAt(spans, bounds[i + 1] - 1),
    });
  }
  return { scenes, warnings };
}

/**
 * 2단계 프롬프트 — 장 시작부터 그 장면 끝까지만 넣는다. FR-SPL-002 🚦
 * 장면 뒤 원문은 같은 장 안이라도 0자다.
 */
export function buildSceneEventPrompt(chapter: Chapter, pages: Page[], scene: Scene): string {
  const { spans } = layout(pages);
  const context =
    scene.start > 0 ? renderSpan(spans, 0, scene.start) : '(없음 — 대상 장면이 장 첫머리다)';
  const target = renderSpan(spans, scene.start, scene.end);
  return `다음은 이 작품 ${chapter.chapter_no}장 "${chapter.title}"의 원문 일부다(각 문단 앞에 [페이지 N] 표시). 원문은 장 처음부터 [대상 장면]의 끝까지만 주어진다.
[앞 맥락]은 누가 누구인지 이해하는 데만 쓴다. 사건은 [대상 장면]에서 일어난 것만 추출한다.

사건 판정 기준:
- 이야기 세계에서 실제로 일어났다고 서술된 행위나 상태 변화만 사건이다. 부정된 일(~하지 않았다), 가정(~했다면), 계획·의도(~하려고 했다), 미래(~할 것이다), 습관(늘 ~하곤 했다)은 사건이 아니다. realis에 actual/negated/hypothetical/future/habitual 중 하나를 표시한다.
- 정해진 참여자가 있고, 이 장면의 시간·장소에서 일어난 것이어야 한다.
- 단순 묘사(어두웠다, 키가 컸다 같은 상태)는 사건이 아니다. 보다·발견하다·듣다·말하다 같은 지각·발화 행위는 사건이다.
- 물건을 줍거나 보거나 숨긴 행위도 실제로 일어났다면 행위 그대로만 적는다(예: "유불란이 장갑을 주웠다"). 그 행위의 의미를 덧붙이지 않는다.
- 대사·증언·편지 속에서 일어났다고 말해지는 일은 사실로 적지 않는다. "A가 ~라고 말했다/진술했다/편지에 썼다"처럼 말한 행위로 적는다. mode는 서술자가 직접 서술한 행위면 narration, 대사·증언이면 dialogue, 편지·기록이면 document다.
- 회상 속 사건은 flashback=true로 표시한다. 순서는 이 장면에서 서술된 위치 기준이다.
- 중요도를 매기지 않는다. "단서", "결정적", "수상한", "중요한", "알고 보니", "복선" 같은 해석·평가어를 쓰지 않는다. 범인·동기·진상을 추측하지 않는다.
- agent는 행위 주체를 원문 표기로 쓴다. action은 agent를 주어로 한 짧은 사실 서술 한 문장이다(과거형, 40자 안팎).
- evidence는 ${MIN_EVIDENCE}~${MAX_EVIDENCE}개다. source_page는 [페이지 N]의 숫자, quote는 그 페이지 원문에서 그대로 복사한 부분 문자열이다(고치거나 줄이지 않는다). 근거는 [대상 장면] 안에서 고른다.
- 이 장면의 사건은 최대 ${MAX_EVENTS_PER_SCENE}개, 서술 순서대로 적는다. 사건이 없으면 빈 배열을 낸다.

출력은 아래 JSON 형식만 반환하라. 다른 설명·마크다운 코드블록 없이 JSON 텍스트만 출력하라.
{"events": [{"agent": "...", "action": "...", "mode": "narration|dialogue|document", "realis": "actual|negated|hypothetical|future|habitual", "flashback": false, "evidence": [{"source_page": 0, "quote": "..."}]}]}

--- [앞 맥락] ---
${context}

--- [대상 장면] ---
${target}`;
}

/** 장당 LLM 호출 수 = 경계 1 + 장면 수 */
export function chapterEventCallCount(sceneCount: number): number {
  return sceneCount === 0 ? 0 : 1 + sceneCount;
}

function compact(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function similarAction(agent: string, a: string, b: string): boolean {
  const strip = (s: string): string => compact(s.split(agent).join(''));
  const x = strip(a);
  const y = strip(b);
  if (x === y || (x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x)))) return true;
  const bx = bigrams(x);
  const pool = bigrams(y);
  if (bx.length === 0 || pool.length === 0) return false;
  let common = 0;
  for (const g of bx) {
    const at = pool.indexOf(g);
    if (at !== -1) {
      common++;
      pool.splice(at, 1);
    }
  }
  return (2 * common) / (bx.length + bigrams(y).length) >= DUPLICATE_SIMILARITY;
}

function shortTitle(action: string): string {
  const t = action.trim().replace(/[.。!?]+$/u, '');
  return t.length > TITLE_MAX_LENGTH ? `${t.slice(0, TITLE_MAX_LENGTH - 1)}…` : t;
}

interface Located {
  event: TimelineEvent;
  first: number;
  ranges: { page: number; start: number; end: number }[];
}

/**
 * 한 장면의 LLM 응답을 검증한다. NFR-AI-004 · FR-DAT-008
 * 반환 사건은 검증된 사실만, 실패는 review(kind=event), realis≠actual은 제거.
 */
export function validateSceneEvents(
  raw: unknown,
  pages: Page[],
  scene: Scene
): { events: TimelineEvent[]; review: ReviewCandidate[]; warnings: string[] } {
  const { spans } = layout(pages);
  const review: ReviewCandidate[] = [];
  const warnings: string[] = [];
  const hold = (candidate: unknown, reason: string): void => {
    review.push({ kind: 'event', reason, candidate: { scene, event: candidate } });
  };
  const located: Located[] = [];
  let removed = 0;
  const proposed = object(raw).events;
  for (const item of Array.isArray(proposed) ? proposed : []) {
    const e = object(item);
    // (c) 실제로 일어났다고 서술된 것만 사건이다
    if (e.realis !== 'actual') {
      removed++;
      continue;
    }
    if (!nonempty(e.agent) || !nonempty(e.action) || !MODES.includes(e.mode as EventMode)) {
      hold(item, 'event_malformed');
      continue;
    }
    const agent = e.agent.trim();
    const action = e.action.trim();
    // (a) 인용이 해당 쪽 원문에 실제로 있는가 — NFR-AI-004
    const rawEvidence = Array.isArray(e.evidence) ? e.evidence : [];
    const evidence = rawEvidence.map((ev) => validEvidence(ev, pages, object(ev).source_page, []));
    if (
      rawEvidence.length < MIN_EVIDENCE ||
      rawEvidence.length > MAX_EVIDENCE ||
      evidence.some((ev) => !ev)
    ) {
      hold(item, 'event_evidence_not_in_source');
      continue;
    }
    const ranges = (evidence as SourceEvidence[]).map((ev) => {
      const base = spanOf(spans, ev.source_page)!.start;
      return { page: ev.source_page, start: base + ev.start_char, end: base + ev.end_char };
    });
    // (b) 근거는 장 범위 안(위 검증) + 그 장면 끝을 넘지 않는다 — FR-SPL-002 🚦
    if (ranges.some((r) => r.end > scene.end)) {
      hold(item, 'event_evidence_after_scene');
      continue;
    }
    // 그 장면에서 일어난 사건만 — 근거가 앞 맥락에만 있으면 이 장면의 사건이 아니다
    if (!ranges.some((r) => r.end > scene.start)) {
      hold(item, 'event_evidence_outside_scene');
      continue;
    }
    // (d) 대사·증언은 진술 내용을 사실로 쓰지 않는다
    if (e.mode === 'dialogue' && !SPEECH_ACT.test(action)) {
      hold(item, 'event_dialogue_not_speech_act');
      continue;
    }
    // (e) 해석·평가어
    if (evaluativeWord(`${agent} ${action}`)) {
      hold(item, 'event_evaluative_word');
      continue;
    }
    located.push({
      first: Math.min(...ranges.map((r) => r.start)),
      ranges,
      event: {
        event: shortTitle(action),
        description: action,
        // (f) 대표 결정 — 발생 쪽은 그 장면의 끝 쪽. LLM 값은 쓰지 않는다
        occurrence_page: scene.end_page,
        agent,
        mode: e.mode as EventMode,
        flashback: e.flashback === true,
        scene_no: scene.scene_no,
        evidence: evidence as SourceEvidence[],
      },
    });
  }
  if (removed > 0) warnings.push(`장면 ${scene.scene_no}: realis≠actual ${removed}건 제거`);

  // 4) 같은 장면 안 중복 병합 — 같은 행위자 + 비슷한 행위
  const merged: Located[] = [];
  for (const cur of located.sort((a, b) => a.first - b.first)) {
    const same = merged.find(
      (m) =>
        compact(m.event.agent) === compact(cur.event.agent) &&
        similarAction(m.event.agent, m.event.description, cur.event.description)
    );
    if (!same) {
      merged.push(cur);
      continue;
    }
    for (let i = 0; i < cur.ranges.length; i++) {
      const r = cur.ranges[i];
      const covered = same.ranges.some(
        (k) => k.page === r.page && k.start <= r.start && k.end >= r.end
      );
      if (covered || same.ranges.length >= MAX_EVIDENCE) continue;
      same.ranges.push(r);
      same.event.evidence.push(cur.event.evidence[i]);
    }
  }
  if (merged.length > MAX_EVENTS_PER_SCENE) {
    warnings.push(
      `장면 ${scene.scene_no}: 장면당 ${MAX_EVENTS_PER_SCENE}개 상한 초과 ${merged.length - MAX_EVENTS_PER_SCENE}건 제외`
    );
  }
  return {
    events: merged.slice(0, MAX_EVENTS_PER_SCENE).map((m) => m.event),
    review,
    warnings,
  };
}

/** LLM 호출 단계 — 경계 1회 + 장면마다 1회. 원본 응답만 돌려준다(검증은 evaluateChapterEvents) */
export async function extractChapterEventsRaw(
  chapter: Chapter,
  pages: Page[],
  ask: AskJson
): Promise<ChapterEventRaw> {
  if (layout(pages).text.length === 0) return { boundaries: null, scenes: [] };
  const boundaries = await ask(buildSceneBoundaryPrompt(chapter, pages));
  const { scenes } = resolveScenes(pages, boundaries);
  const out: ChapterEventRaw['scenes'] = [];
  for (const scene of scenes) {
    const response = await ask(buildSceneEventPrompt(chapter, pages, scene));
    out.push({ start: scene.start, end: scene.end, response });
  }
  return { boundaries, scenes: out };
}

/** 원본 응답에서 결과를 결정적으로 다시 계산한다 — 새 실행과 캐시 재생이 같은 검증을 거친다 */
export function evaluateChapterEvents(pages: Page[], raw: ChapterEventRaw): ChapterEventResult {
  const { scenes, warnings } = resolveScenes(pages, raw.boundaries);
  const cached = Array.isArray(raw.scenes) ? raw.scenes : [];
  if (
    cached.length !== scenes.length ||
    scenes.some((s, i) => cached[i].start !== s.start || cached[i].end !== s.end)
  ) {
    throw new Error(
      'Stale event scene cache: scene boundaries no longer match; regenerate explicitly'
    );
  }
  const events: TimelineEvent[] = [];
  const review: ReviewCandidate[] = [];
  scenes.forEach((scene, i) => {
    const out = validateSceneEvents(cached[i].response, pages, scene);
    events.push(...out.events);
    review.push(...out.review);
    warnings.push(...out.warnings);
  });
  return { scenes, events, review, warnings };
}
