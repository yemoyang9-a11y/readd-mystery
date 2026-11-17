# 싸비 사건 정리 · 인물관계도 설명 칸 · 입체 책 홈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 싸비 3탭(추리 노트 · 인물관계도 · AI 챗봇)은 유지하고, 추리 노트 안에 `내 노트 | 사건 정리` 전환을 넣는다(2026-11-17 사용자 선택 A안). 인물관계도에서 인물·선을 누르면 아래 칸에 관계 설명이 뜨게 한다. 독자에게 보이는 사건·관계 설명은 시안 말투(해요체, 쉬운 말)로 바꾼다. 모바일 홈의 책 넘김을 두께 있는 입체 책으로 바꾼다.

**Architecture:** 이미 저장된 관계 `semantics.summary`와 사건 `description`을 배치 단계에서 LLM 게이트웨이로 해요체 쉬운 문장으로 다시 쓰고(`semantics.reader_summary`, `events.reader_description`), 화면은 그 문장만 쓴다. 다시 쓰기의 입력은 해당 항목의 기존 문장 하나뿐이라 새 정보가 들어갈 경로가 없다. 타임라인은 새 조회 API가 장·사건을 기준점 이하로만 돌려준다.

**Tech Stack:** backend Express + pg + jest, frontend React + Vite + vitest + @testing-library/react.

**Spec:** 사용자 승인 시안 `docs/superpowers/specs/mockups-2026-11-17/readd-relationship-simple.html`(2026-11-16 최종본), 홈 `docs/superpowers/specs/mockups-2026-11-17/home-3d-c-v6.html`, 추리 노트 `docs/superpowers/specs/mockups-2026-11-17/ssabi-notes-split.html` A안(2026-11-17)과 이 대화의 결정(아래 Global Constraints).

## Global Constraints

- 탭은 지금 그대로 `추리 노트` · `인물관계도` · `AI 챗봇`. 기본 탭은 지금처럼 `인물관계도`.
- 추리 노트 탭 맨 위에 밑줄형 전환 `내 노트 | 사건 정리`. 처음 기본은 `내 노트`, 마지막에 고른 쪽을 기억한다(탭 기억과 같은 방식). `단서·가설 적기`는 `내 노트`에서만.
- 사건 정리 = 장(chapter) 묶음 + 그 안의 사건 목록. 제목 `지금까지, N개 장면이에요`.
- 싸비 화면 색은 지금 배포된 테마 토큰을 그대로 쓴다(시안의 어두운 색으로 바꾸지 않는다).
- 회색 부연 문장 금지("○쪽에서 일어난 사건이에요", "○쪽까지의 흐름", "인물을 누르면…", "선을 눌러 관계 자세히 보기" 등).
- 사건 정리에는 쪽 범위 표기를 넣지 않는다. 기준점이 속한 마지막 장에만 `지금 읽는 곳`.
- "아직 모르는 것", 독자의 `의심`/`제외` 표시는 넣지 않는다.
- 독자용 문장: 해요체, 60자 이하, 원문·본문 같은 메타 표현 금지(`원문`, `본문`, `작품에서`, `서술`), 입력 문장에 없는 사실 추가 금지. 관계 문장은 두 인물 이름을 모두 포함. 검증 실패 시 그 항목은 문장 없이 보인다(관계 이름·사건 이름만) — 원문 문장으로 폴백하지 않는다.
- 인물관계도: 선택과 무관한 인물 카드·선도 opacity 1. 선택 강조는 색·굵기로만.
- 선택한 선: 색 `#ff5c7d`, 굵기 3.6px, 관계 이름표 강조. 같은 선을 다시 누르면 해제.
- 설명 칸은 범례 아래. 인물 선택 시 제목 `{이름}과/와 이어진 사람`(받침에 따라), 선 선택 시 제목 `{A} · {B}`. 항목: 상대 이름 · 관계 이름 · `사실`/`의심·주장` · 독자용 문장.
- `사실` = `assertion_status === 'fact'`, 그 외 전부 `의심·주장`.
- 다른 인물 카드 위를 지나는 선(카드 중심~선분 거리 < 카드 반지름 + 6px, 선분 양 끝 8% 제외)은 반대쪽으로 휜 2차 곡선, 이름표는 곡선 중간점.
- 기준점(R1·R4, FR-SPL-002 🚦): 장은 `start_page <= K`, 사건은 `occurrence_page <= K`. K는 `getCutoffSnapshot`에서만. 조항 ID 외 주석 금지.
- 런타임 LLM 호출 추가 금지(R9). LLM은 배치(생성·백필)에서만, 게이트웨이(`backend/src/modules/llm-gateway/gateway.ts` `call`) 경유.

## Review Focus

- 진도 레코드 없음(K=0): 사건 정리 장 0·사건 0, 빈 상태 문구 하나.
- 기준점이 장 중간: 그 장은 나오되 `occurrence_page > K` 사건 0건.
- 다시 쓴 문장이 검증 실패(이름 누락·평서체·메타 표현): 저장하지 않고 화면에는 이름만.
- `semantics`가 NULL인 옛 관계: 설명 칸에 관계 이름만, 오류 없음.
- 선 클릭 영역이 이름표에 가려지지 않음(이름표 `pointer-events: none`).

---

### Task 1: 독자용 쉬운 문장 생성 (backend 배치)

**Files:**
- Create: `backend/migrations/017_reader_text.sql` — `ALTER TABLE events ADD COLUMN IF NOT EXISTS reader_description TEXT;`
- Create: `backend/src/batch/pipeline/reader-text.ts`
- Modify: `backend/src/batch/pipeline/run-generate-full.ts` (`generateFullBook`, :546 이후 · 사건 id 부여 다음), `backend/src/batch/pipeline/register.ts` (:209-218 사건 INSERT, 관계 semantics에 키 포함)
- Create: `backend/scripts/backfill-reader-text.ts` (이미 등록된 책용, `--book <id>` 필수, 기본 dry-run, `--apply`일 때만 쓰기)
- Test: `backend/src/batch/pipeline/reader-text.test.ts`

**Interfaces:**
- Produces:
  - `buildReaderTextPrompt(items: ReaderTextInput[]): string`
  - `ReaderTextInput = { key: string; kind: 'relationship' | 'event'; text: string; names: string[] }`
  - `validateReaderText(input: ReaderTextInput, out: string): boolean`
  - `rewriteReaderTexts(items: ReaderTextInput[]): Promise<Map<string, string>>` — 30개씩 묶어 `call('rewrite_reader_text', …)` 1회, JSON `{"items":[{"key","text"}]}`. 검증 실패·누락 키는 Map에 넣지 않는다.
  - 저장 위치: 관계 `semantics.reader_summary`, 사건 `events.reader_description`.

- [ ] **Step 1: 실패하는 테스트**
  - `validateReaderText: 해요체·두 이름 포함이면 통과` — `'유불란과 박영민은 오랜 친구예요.'` → true
  - `평서체는 거절` — `'유불란과 박영민은 친구다.'` → false
  - `이름 하나 빠지면 거절` — `'박영민의 친구예요.'`(names 유불란·박영민) → false
  - `메타 표현 거절` — `'원문은 나용귀가 범인이라고 확인해요.'` → false
  - `60자 초과 거절`
  - `rewriteReaderTexts: 검증 실패 항목은 결과에 없다` — gateway mock이 하나는 평서체로 돌려줌 → Map 크기 1
  - `프롬프트에는 입력 문장 외 원문이 없다` — `buildReaderTextPrompt` 결과에 입력 `text`들과 고정 지시문만 포함(페이지 본문 문자열 미포함)
- [ ] **Step 2:** `npx jest src/batch/pipeline/reader-text.test.ts` → FAIL
- [ ] **Step 3:** 구현. 프롬프트 고정 지시: 해요체, 쉬운 말, 60자 이하, 입력 문장에 없는 사실·추측·판정 추가 금지, 원문/본문 언급 금지, 관계는 두 이름 모두 포함. `generateFullBook`에서 결과를 all-resolved.json에 반영하고 register가 저장.
- [ ] **Step 4:** 백필 스크립트 — DB의 해당 책 관계(`semantics IS NOT NULL`)·사건을 읽어 `rewriteReaderTexts` → dry-run은 `key\t원래문장\t새문장` 표를 출력, `--apply`는 한 트랜잭션으로 `UPDATE relationships SET semantics = semantics || jsonb_build_object('reader_summary', $1)`, `UPDATE events SET reader_description = $1`.
- [ ] **Step 5:** `npm test` PASS. 로컬 시험 DB에 017 적용 후 `가상범인` dry-run → 표를 사람이 검토
- [ ] **Step 6: Commit** `feat(R4): 독자용 쉬운 문장 생성·백필 — R9, NFR-AI-004`

### Task 2: 타임라인 조회 API (backend)

**Files:**
- Modify: `backend/src/modules/ssabi/repository.ts`, `pg-repository.ts`, `__mocks__/fake-repository.ts`, `composition.ts`
- Create: `backend/src/modules/ssabi/timeline.service.ts`
- Modify: `backend/src/api/routes.ts` (graph 라우트 :730-765 아래)
- Test: `backend/tests/unit/ssabi/timeline-gate.test.ts`, `backend/tests/unit/api/timeline-route.test.ts`

**Interfaces:**
- Produces:
  - `SsabiRepository.findTimeline(bookId: string, cutoff: number): Promise<{ chapters: TimelineChapter[]; events: TimelineEvent[] }>`
  - `TimelineChapter = { chapter_no: number; title: string; start_page: number; end_page: number }`
  - `TimelineEvent = { id: string; event: string; description: string | null; occurrence_page: number }` — `description`은 `reader_description`(원래 `description`은 내보내지 않음)
  - `GET /books/:bookId/ssabi/timeline?page=&seq=` → `{ chapters, events, applied_cutoff }`. 순서는 graph 라우트와 동일(device id → `ensureBookReady` → page/seq면 `acceptProgress`·`touchActivity` → `getCutoffSnapshot` → 조회), `Cache-Control: private, no-store`.

- [ ] **Step 1: 실패하는 게이트 테스트** (장 1–9·10–25·26–40, 사건 쪽 4·9·12·24·30·38)

```ts
test('FR-SPL-002: 타임라인 사건에 기준점 초과 레코드 0건', async () => {
  const t = await service.getTimeline(BOOK, 10);
  expect(t.events.filter(e => e.occurrence_page > 10)).toHaveLength(0);
  expect(t.chapters.filter(c => c.start_page > 10)).toHaveLength(0);
});
test('FR-SPL-002: 기준점을 올리면 그 사이 사건이 보인다', async () => {
  const t = await service.getTimeline(BOOK, 40);
  expect(t.events.some(e => e.occurrence_page > 10 && e.occurrence_page <= 40)).toBe(true);
});
test('FR-SPL-002: 진도 레코드 없음(K=0)이면 장·사건 0건', async () => {
  const t = await service.getTimeline(BOOK, 0);
  expect(t.chapters).toHaveLength(0);
  expect(t.events).toHaveLength(0);
});
```

- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** pg 구현 — `chapters WHERE book_id=$1 AND start_page <= $2 ORDER BY chapter_no`, `events WHERE book_id=$1 AND occurrence_page <= $2 ORDER BY occurrence_page, id`(SELECT에 `reader_description AS description`). 쿼리 위 `// FR-SPL-002 🚦`.
- [ ] **Step 4:** 라우트 테스트 — 스냅샷 40이면 `applied_cutoff === 40`, `?cutoff=999`는 무시(절대 규칙 8). 응답에 원래 `description` 문자열이 없음.
- [ ] **Step 5:** `npm test` PASS, 로컬 서버 curl로 `page=13` 사건 전부 `<= 13`
- [ ] **Step 6: Commit** `feat(R4): 싸비 타임라인 조회 API — FR-SPL-002`

### Task 3: 추리 노트 안 사건 정리 (frontend)

**Files:**
- Modify: `frontend/src/types/ssabi.ts` (`TimelineResponse`; `RelationshipSemantics`에 `reader_summary?: string`. `SsabiTab`은 그대로)
- Modify: `frontend/src/services/ssabiService.ts` (`fetchTimeline`), `frontend/mocks/server.ts`
- Modify: `frontend/src/hooks/useSsabiData.ts` (`notes` 탭에서 `사건 정리`가 선택됐을 때만 조회, 반환에 `timeline`, `timelineFailed`)
- Modify: `frontend/src/components/Ssabi/SsabiPanel.tsx` (추리 노트 패널 안 전환 상태와 기억)
- Create: `frontend/src/components/Ssabi/EventSummary.tsx`
- Modify: `frontend/src/components/Ssabi/NotesTab.tsx` 또는 이를 감싸는 곳 — 전환 줄 아래 기존 노트 목록 그대로
- Test: `EventSummary.test.tsx`, `SsabiPanel.test.tsx` 갱신

**Interfaces:**
- Consumes: Task 2 응답
- Produces: `fetchTimeline(bookId: string, page: number, seq: number): Promise<TimelineResponse>`; `<EventSummary timeline={TimelineResponse | null} failed={boolean} />`

화면: 전환 줄 `내 노트 | 사건 정리`(선택 쪽 굵게 + 버건디 밑줄) → 사건 정리면 제목 `지금까지, N개 장면이에요`(N=장 수) → 장마다 세로 점 + 장 제목 + 사건 이름 목록. 사건을 누르면 설명(`description`)이 펼쳐지고 다른 사건을 누르면 바뀐다. `description`이 null이면 이름만. 마지막 장 점만 버건디 + `지금 읽는 곳`.

- [ ] **Step 1: 실패하는 테스트**
  - `탭은 추리 노트·인물관계도·AI 챗봇 세 개다`
  - `추리 노트에 내 노트·사건 정리 전환이 있고 기본은 내 노트다`
  - `사건 정리를 고른 뒤 다른 탭에 갔다 와도 사건 정리가 유지된다`
  - `단서·가설 적기는 내 노트에서만 보인다`
  - `장 제목과 사건 이름을 장 순서대로 보여준다`
  - `사건을 누르면 설명이 펼쳐지고 다른 사건을 누르면 바뀐다` — 펼친 설명은 항상 1개
  - `마지막 장에만 지금 읽는 곳이 붙는다`
  - `쪽수 문구가 없다` — `queryByText(/\d+쪽/)` null
  - `장·사건 0개면 빈 상태 문구만` — `아직 정리된 장면이 없어요`
- [ ] **Step 2:** `npx vitest run src/components/Ssabi` FAIL
- [ ] **Step 3:** 구현(기존 버건디 토큰·탭 스타일, `data-track`은 라벨 규칙)
- [ ] **Step 4:** `npm test` PASS
- [ ] **Step 5: Commit** `feat(R4): 추리 노트 안 사건 정리 — FR-SPL-002`

### Task 4: 인물관계도 선 선택 · 흐림 제거 · 곡선 회피

**Files:**
- Modify: `frontend/src/components/Ssabi/RelationshipGraph.tsx` (:603-631 간선, :667-687 노드), `frontend/src/components/Ssabi/graphEdges.ts` (`makeEdgePaths` :141)
- Test: `graphEdges.test.ts`, `RelationshipTab.test.tsx`

**Interfaces:**
- Produces: `RelationshipGraph` props 추가 `selectedEdgeKey: string | null`, `onSelectEdge: (key: string | null) => void`(키 = `graphEdgeKey(edge)`). `EdgePath`에 `labelPoint: Point` 추가.

- [ ] **Step 1: 실패하는 테스트**
  - `graphEdges.test.ts`: 노드 A(0,0)·C(100,0)·B(200,0), 간선 A–B → 경로에 `Q`, `labelPoint.y !== 0`; 간선 A–C → 직선, `labelPoint` (50,0)
  - `선을 누르면 선택되고 다시 누르면 해제된다` — `data-edge-id` 클릭 후 `data-selected="true"`, 재클릭 후 `"false"`
  - `선택과 무관한 인물·선도 흐려지지 않는다` — 모든 노드·간선 `opacity` `1`
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 간선마다 투명 히트 영역(20px)에 클릭, 이름표 `pointerEvents="none"` 유지, 인물 클릭 시 `onSelectEdge(null)`, `dimmed` 분기 제거
- [ ] **Step 4:** `npm test` PASS
- [ ] **Step 5: Commit** `feat(R4): 인물관계도 선 선택·곡선 회피 — FR-CHR-001`

### Task 5: 관계 설명 칸

**Files:**
- Create: `frontend/src/components/Ssabi/RelationDetails.tsx`
- Modify: `frontend/src/components/Ssabi/RelationshipTab.tsx` (범례 아래, `selectedEdgeKey` 상태 보유)
- Test: `RelationDetails.test.tsx`

**Interfaces:**
- Consumes: Task 4 props, `currentGraphEdges`(graphEdges.ts:85), `semantics.reader_summary`
- Produces: `<RelationDetails graph={GraphResponse} selectedId={string | null} selectedEdgeKey={string | null} />`

- [ ] **Step 1: 실패하는 테스트** (`relationshipFixture`)
  - `인물을 고르면 이어진 사람 목록` — 제목 `유불란과 이어진 사람`, 항목: 상대 이름·라벨·`사실`·reader_summary
  - `받침 없는 이름은 와` — `나용귀와 이어진 사람`
  - `fact가 아니면 의심·주장`
  - `선을 고르면 그 관계 하나만` — 제목 `유불란 · 나용귀`
  - `reader_summary가 없으면 문장 없이 라벨만` — `semantics.summary` 문자열이 화면에 없음
  - `관계 없는 인물은 제목만`
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 선 선택이 인물 선택보다 우선. 인물 카드 목록(:394-443)은 설명 칸으로 대체, 검색·주요/전체·되감기는 유지
- [ ] **Step 4:** `npm test` PASS
- [ ] **Step 5: Commit** `feat(R4): 인물관계도 관계 설명 칸 — FR-CHR-001`

### Task 6: 입체 책 홈 (frontend, 모바일)

**Files:**
- Modify: `frontend/src/mobile/components/BookCarousel3D.tsx`, `frontend/src/mobile/pages/MobileHome.tsx`, `frontend/src/data/homeShowcase.ts`(책마다 `spine`·`spineText` 색)
- Test: `MobileHome.test.tsx`, `BookCarousel3D` 테스트(없으면 생성)

시안 `home-3d-c-v6.html` 값:
- 책 = `transform-style: preserve-3d` 상자. 면: 표지(앞), 뒤, 책등(왼쪽, 책 색 + 세로 제목), 종이(오른쪽·위, 줄무늬). 크기 164×240, 두께 42px.
- 가운데 `translateX(8px) translateZ(30px) rotateY(24deg) rotateX(4deg)`. 옆(±1) `translateX(150 | -158px) translateZ(-190px) rotateY(44 | 52deg) rotateX(4deg) scale(.86)`, 밝기 .45. 나머지 `translateZ(-260px) rotateY(50deg) scale(.8)` 숨김. 회전 방향은 모두 양수(넘길 때 0도를 지나지 않게).
- **어둡게·숨기기는 책 상자에 `filter`/`opacity`를 걸지 않는다**(3D가 납작해짐, lessons.md 2026-11-17). 면마다 `filter: brightness(var(--b))`, `opacity: var(--o)`, `@property`로 전환.
- 좌우 화살표·점·스와이프·옆 책 누르기는 지금 동작 유지. `prefers-reduced-motion`이면 전환 없음.
- 제목 26px 800 흰색, 정보 줄은 그대로.
- 오른쪽 위 `이어서 읽기 · {progress.current_page}p`(퍼센트 대신, 재계산 없음 — FR-BRF-005).
- 시안의 셜록 홈즈·데미안·파친코 표지는 비교용이라 넣지 않는다(지금 세 권 유지).

- [ ] **Step 1: 실패하는 테스트**
  - `이어서 읽기에 퍼센트 대신 현재 쪽이 p로 보인다` — progress `{current_page: 13, percent: 19.1}` → `이어서 읽기 · 13p`, `%` 없음
  - `책마다 책등에 제목이 있다`
  - `책 상자에는 filter·opacity 인라인 스타일이 없다`
  - 기존 넘기기 테스트 유지
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** `npm test` PASS, 로컬 `playwright-cli --device="iPhone 15"`로 홈 넘기기·두께 확인
- [ ] **Step 5: Commit** `feat(R4): 모바일 홈 입체 책·이어서 읽기 쪽 표시 — FR-BRF-005`

### Task 7: 검증 · push · PR (배포 안 함)

- [ ] **Step 1:** backend·frontend `npm test`, `npm run build` PASS
- [ ] **Step 2:** 로컬 시험 DB에 017 적용 → `가상범인` 백필 dry-run 표를 PR 본문과 보고에 첨부(운영 DB는 건드리지 않음)
- [ ] **Step 3:** 로컬 서버 + playwright-cli `--device="iPhone 15"`로 홈, 추리 노트 전환·사건 펼침, 인물·선 클릭 설명, 곡선 선, 콘솔 오류 0 확인
- [ ] **Step 4:** 브랜치 `feat/ssabi-notes-home3d`를 `mystery`(비공개)에 push → `mystery` main 대상 PR. `origin`(공개)에는 push하지 않는다
- [ ] **Step 5:** `/code-review`로 PR 리뷰, 지적 반영, `gh pr view --json mergeable,mergeStateStatus`로 충돌 확인
- 운영 반영(017 운영 적용·백필 `--apply`·fly/pages 배포)은 사용자 확인 뒤 별도로 한다
