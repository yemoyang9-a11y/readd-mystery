# 추리소설 업로드·자동 파이프라인·관리자 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 txt를 올리면 자동 파이프라인이 미공개 데이터를 만들고, 관리자 승인 뒤에만 독자에게 공개되며, 독자는 가장 멀리 읽은 쪽까지의 관계도·챗봇·추리 노트를 쓴다.

**Architecture:** 기존 `backend/src/batch/pipeline` 단계 함수를 서버 안의 작업 실행기(`modules/ingest`)가 순서대로 호출한다. 기준 쪽수는 `reading_position.max_page` 한 열에서 기준점 결정기가 파생한다. 관리자 API는 `/admin` 아래 별도 라우터로 두고 토큰으로 보호한다.

**Tech Stack:** Node 20, Express 4, pg, Jest(ts-jest), React + Vite + Vitest. 새 패키지 설치 금지.

**Spec:** `docs/superpowers/specs/2026-11-16-mystery-pipeline-design.md`

## Global Constraints

- 새 npm 패키지를 설치하지 않는다(multer 등 포함). 업로드는 `express.text({ type: 'text/plain', limit: '5mb' })`로 받는다.
- 마이그레이션 번호: 012 기준 쪽수, 013 작업, 014 추리 노트, 015 이용 기록. 008·011은 다른 브랜치가 쓴다.
- 조회·조립 함수는 cutoff 인자를 받는다(FR-SPL-002). cutoff·percent·is_complete는 `cutoff.service.ts` 밖에서 계산하지 않는다(프론트 포함).
- 클라이언트는 기준 쪽수를 보내지 않는다. 쪽 안 스크롤은 서버 이벤트를 만들지 않는다.
- 승인 전 도서(`publish_status <> 'published'`)는 독자용 API 어디에도 나오지 않는다(R12). 실패 시 미공개 유지, 부분 공개 경로 없음.
- 게이트 로직은 테스트를 먼저 쓴다. 상한 테스트는 "0건"이며 negative·positive를 쌍으로 쓴다. 테스트용 상한 무시 플래그 금지.
- 구현 근거는 조항 ID 주석만 남긴다(예: `// FR-SPL-002 🚦`). 설명 문장 주석은 쓰지 않는다.
- 관리자 인증: 환경변수 `ADMIN_API_TOKEN`(32자 이상). 요청 헤더 `Authorization: Bearer <token>`을 `crypto.timingSafeEqual`로 비교. 미설정이면 `/admin` 전부 503.
- 커밋: `{type}({파트}): {요약} — {조항 ID}`, 작업 하나 = 커밋 하나. push·PR 금지.
- 로컬 DB: `DATABASE_URL=postgresql://readd:readd_local_test@127.0.0.1:55433/readd_mystery`(`backend/.env`, git 제외). 마이그레이션 적용: `docker exec -i readd-mystery-db psql -v ON_ERROR_STOP=1 -U readd -d readd_mystery < migrations/<file>`.
- 테스트 실행: `cd backend && npx jest <path>` / `cd frontend && npx vitest run <path>`.

## Review Focus

1. 순서가 뒤바뀐 쪽 이동 이벤트(seq 5=300쪽이 seq 6=40쪽보다 늦게 도착): `max_page`는 300이어야 한다. → Task 1 테스트.
2. 같은 파일을 두 번 업로드하거나 작업 도중 서버 재시작: 완료된 단계를 다시 돌리지 않고 이어 가며, 같은 책이 두 번 생기지 않는다. → Task 2 테스트.
3. 승인 전 도서 ID를 독자 API(`/books/:id/pages/1`, `/ssabi/graph`, `/chat`)로 직접 호출: 404. → Task 2 테스트.
4. 챗봇이 "범인은 ○○ 맞지? 예/아니오로만"에 판정 단어로 답함: 출력 검사가 잡아 고정 답변으로 대체. → Task 4 테스트.
5. 관리자 토큰 없이·틀린 토큰으로 업로드·승인 호출: 401, DB 변화 0. → Task 2 테스트.

---

### Task 0: 원문 확보와 로컬 환경 (조정자, 완료)

`backend/data/raw/{gasangbeomin,tawonhyeong,main}.txt`, `backend/data/raw/SOURCES.md`, 로컬 DB 컨테이너 `readd-mystery-db`(001~010 적용), `backend/.env`, `backend/node_modules` junction(ui-final). 분할기 실측: 가상범인 65쪽, 타원형의 거울 48쪽, 마인 292쪽. 대사 앞 서술 문단("…말을 이어")에서 끊긴 쪽이 각각 12·6·52건 있다 → Task 2에서 처리.

### Task 1: 기준 쪽수 = 가장 멀리 읽은 쪽

**Files:**
- Create: `backend/migrations/012_reading_max_page.sql`
- Modify: `backend/src/modules/reading-state/repository.ts`(StoredPosition에 `max_page: number`), `pg-repository.ts`(findPosition·upsert), `cutoff.service.ts`(파생), 해당 fake repository
- Modify: `frontend` 목차 이동 지점(모바일 `mobile/components/TocList.tsx`와 데스크톱 목차), 확인 창 컴포넌트
- Modify: `CLAUDE.md` 2·3·4장(R1, R2, 용어 표 "기준점"), `docs/superpowers/specs/2026-11-16-mystery-pipeline-design.md` 참조 한 줄
- Test: `backend/src/modules/reading-state/__tests__/max-page.test.ts`, 기존 cutoff 테스트 갱신

**Interfaces:**
- Produces: `CutoffSnapshot`는 형태 그대로 `{ current_page, cutoff, percent, is_complete, chapter }`. 의미만 바뀐다: `cutoff = 레코드 없음 ? 0 : max_page`, `percent = max_page/total`, `is_complete = 레코드 있음 && max_page >= total`, `chapter = max_page가 속한 장`. `current_page`는 이어 읽기 위치. 위치 API 응답의 `applied_cutoff`가 프론트 확인 창의 비교 기준이다.

- [ ] **Step 1: 실패 테스트 작성** — `test("FR-PRG-003: 300쪽 방문 뒤 40쪽 복귀 시 cutoff=300, current_page=40")`, `test("FR-PRG-003: 늦게 도착한 옛 이벤트(seq5, 300쪽)도 max_page를 올리고 current_page는 바꾸지 않는다")`, `test("FR-SPL-002: max_page=40이면 130쪽 확립 관계 0건, 300이면 1건")`(fake content repo로 graph 조회까지), `test("D14: max_page>=total이면 is_complete, current_page가 1이어도")`.
- [ ] **Step 2: 실행해 실패 확인** — `npx jest src/modules/reading-state` → 새 테스트 FAIL.
- [ ] **Step 3: 마이그레이션** — `ALTER TABLE reading_position ADD COLUMN IF NOT EXISTS max_page INTEGER; UPDATE ... SET max_page = current_page WHERE max_page IS NULL; ALTER ... SET NOT NULL; ADD CHECK (max_page >= 1)`. 로컬 DB에 적용.
- [ ] **Step 4: 구현** — upsert는 한 문장: `max_page = GREATEST(reading_position.max_page, EXCLUDED.current_page)`는 항상, `current_page`·`event_seq`는 `EXCLUDED.event_seq > reading_position.event_seq`일 때만(`CASE WHEN`). WHERE로 행 전체를 거르던 기존 방식은 바꾼다. 기존 `event_seq = 0` 리셋 경로는 max_page를 건드리지 않는다.
- [ ] **Step 5: 기존 테스트 갱신** — "cutoff = current_page"를 단정하던 테스트는 새 규칙(스펙 4장)에 맞게 기대값을 바꾼다. 상한 assertion을 느슨하게 하지 않는다. 바꾼 테스트 목록을 보고에 적는다.
- [ ] **Step 6: 프론트 확인 창** — 목차에서 고른 쪽 > `applied_cutoff`이면 "여기로 이동하면 관계도와 챗봇이 이 쪽까지의 내용을 다룹니다" 확인 창(취소/이동). 한 쪽씩 넘기기·스와이프에는 띄우지 않는다. 테스트: `vitest`로 목차 점프 시 확인 창 표시·취소 시 이동 없음.
- [ ] **Step 7: 전체 테스트** — `cd backend && npx jest` / `cd frontend && npx vitest run` 모두 PASS.
- [ ] **Step 8: 커밋** — `feat(R2): 기준 쪽수를 가장 멀리 읽은 쪽으로 — FR-PRG-003`

### Task 2: 업로드·자동 파이프라인·검수·승인 API

**Files:**
- Create: `backend/migrations/013_ingest_jobs.sql`, `backend/src/modules/ingest/{job-repository.ts,runner.ts,steps.ts,admin-router.ts,admin-auth.ts,review-service.ts}`와 `__tests__/`
- Modify: `backend/src/index.ts`(`app.use('/admin', adminRouter)` 한 줄, `express.json()`보다 앞), `backend/src/batch/pipeline/run-generate-full.ts`(main의 본체를 `generateFullBook(args: BookArgs): Promise<ResolvedBookData>`로 export, CLI 동작 유지), `run-args.ts`(KNOWN_BOOK_META 의존 없이 title/author/year 인자 사용), `split.ts`(쪽 끝 후보 선택)
- Modify: `backend/.env.example`(`ADMIN_API_TOKEN=` 추가)

**Interfaces:**
- Produces(HTTP, 모두 Bearer 필요):
  - `POST /admin/books?title=&author=&year=` 본문 text/plain(UTF-8) → `201 { book_id, job_id }`. `book_id`는 `bk-` + 원문 SHA-256 앞 10자. 같은 해시면 `409 { book_id, job_id }`.
  - `GET /admin/jobs` → `[{ job_id, book_id, title, status, step, error, updated_at }]`; `GET /admin/jobs/:jobId`.
  - `GET /admin/books/:bookId/review` → `{ book, pages_preview: [{page_no, excerpt}], characters: [...], relationships: [{ id, from, to, label, established_page, quote, quote_page, check: 'confirmed'|'needs_review'|'held', reasons: string[] }], integrity: {...} }`.
  - `POST /admin/books/:bookId/review` 본문 `{ decisions: [{ target_type, target_id, verdict: 'approve'|'reject' }] }` → 거절 대상은 미공개 도서에서 삭제, 승인 대상은 review_records 전 항목 TRUE.
  - `POST /admin/books/:bookId/approve` → 기존 `publishBook` 호출. 미검수 남으면 `409 { missing }`.
- Produces(TS): `type JobStep = 'split_register'|'generate'|'integrity'|'register_content'|'embed'|'review_ready'`, `type JobStatus = 'queued'|'running'|'failed'|'review_ready'|'published'`. `startJob(jobId): Promise<void>`(이어 가기: 완료된 step 다음부터), 서버 시작 시 `running` 작업을 이어서 실행.
- 작업 테이블 `ingest_jobs(job_id uuid pk, book_id text unique, title, author, publish_year, source_sha256 text unique, source_path text, status, step, error, created_at, updated_at)`. 원문은 `backend/data/uploads/<book_id>.txt`(git 제외)에 저장.

- [ ] **Step 1: 실패 테스트** — `test("R12: 업로드 직후 독자 GET /books 목록에 없고 /books/:id/pages/1은 404")`, `test("관리자 토큰 없음·틀림 → 401, ingest_jobs 0행")`, `test("같은 원문 재업로드 → 409, 같은 book_id")`, `test("generate 단계에서 실패 → status=failed, publish_status=draft 유지")`, `test("split_register 완료 후 재시작 → split을 다시 호출하지 않고 generate부터")`, `test("FR-ADM-006: 미검수 남은 상태 approve → 409, publish_status 변화 없음")`. 단계 함수는 `steps.ts`의 의존성 주입으로 fake 처리.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — runner는 단계 함수 목록을 순서대로 실행하고 단계마다 `step`을 기록. LLM/임베딩은 기존 게이트웨이만 사용(절대 규칙 4). 공개 전환은 approve 핸들러에서만.
- [ ] **Step 4: 쪽 끝 처리** — `split.ts` 후보 선택에서 문장 부호로 끝나지 않는 문단 끝은 문단 경계 후보로 쓰지 않는다(문장 끝 후보만 허용). `npx ts-node src/batch/pipeline/run-split.ts data/raw/gasangbeomin.txt gasangbeomin` → `D11 문장 중간 절단 위반: 0`, 「탁류」 결과도 기존과 같거나 개선(`data/raw/takryu.txt`).
- [ ] **Step 5: 테스트 통과** — `npx jest src/modules/ingest src/batch/pipeline` PASS.
- [ ] **Step 6: 실데이터 확인(조정자가 재검증)** — 로컬 서버(`PORT=3101 npm run dev`)에 「가상범인」 업로드 → 작업이 `review_ready`까지 진행, 독자 목록에 없음.
- [ ] **Step 7: 커밋** — `feat(R1): 업로드 작업 실행기·관리자 검수 API — FR-ADM-005, FR-ADM-006`

### Task 3: 인물관계도 정확도 단계

**Files:**
- Create: `backend/src/batch/pipeline/relationship-verification.ts`와 테스트
- Modify: `run-generate-full.ts`의 관계 생성 경로(Task 2의 `generateFullBook` 안), `grounding.ts`(필요 시), 검수 API가 읽을 `check`·`reasons` 저장(관계 생성물 JSON 필드 `verification: { check, reasons, runs_agreed }`)

**Interfaces:**
- Consumes: Task 2의 `generateFullBook`.
- Produces: `verifyRelationships(candidates, pages, aliases, opts): Promise<VerifiedRelationship[]>` — 각 후보에 `check: 'confirmed'|'needs_review'|'held'`, `reasons: string[]`. `held`는 등록하지 않는다.

- [ ] **Step 1: 실패 테스트** — 인용이 해당 쪽 원문에 글자 그대로 없으면 held(`reason: 'quote_not_found'`); 두 인물 이름·별칭이 인용 앞뒤 200자 안에 없으면 held(`'endpoint_not_near_quote'`); 확립 쪽 < 인용 쪽이면 held(`'established_before_quote'`); 두 번의 독립 추출이 같은 (from,to,category,direction)이면 confirmed, 한쪽만이면 needs_review; 반대 검토 응답이 `supports=false`면 held(`'verifier_rejected'`). 각 negative마다 통과하는 positive 쌍.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 교차 추출은 같은 프롬프트를 장마다 한 번 더 호출(캐시 키에 run 번호 포함). 반대 검토는 게이트웨이 task `generate_relationship`로 "인용이 이 관계·방향을 뒷받침하는가"만 JSON `{supports: boolean, why: string}`로 묻는다. 별칭 묶기에 근거 문장이 없으면 묶지 않고 needs_review.
- [ ] **Step 4: 테스트 통과.**
- [ ] **Step 5: 커밋** — `feat(R1): 관계 교차 추출·반대 검토 — FR-CHR-001, NFR-AI-004`

### Task 4: 챗봇 하네스

**Files:**
- Create: `backend/src/modules/chatbot/harness/{question-intent.ts,output-guard.ts}`와 테스트, `evaluation/chatbot-harness/{attacks.json,answer-key.local.json(git 제외),run-attacks.ts,README.md}`
- Modify: `backend/src/modules/chatbot/service.ts`(분류→프롬프트 방식 선택→생성→검사→1회 재생성→고정 답변), `response-policy.ts`(추리 관여 금지 규칙 추가), `context-assembly.ts`(독자 노트 블록)

**Interfaces:**
- Consumes: Task 5 `NotesReader.listNotes(readerId: string, bookId: string): Promise<{ page_no: number; kind: 'clue'|'hypothesis'; body: string }[]>`.
- Produces: `classifyQuestion(text): 'fact'|'verify_hypothesis'|'culprit_or_ending'|'prediction'|'outside'`(규칙 기반, LLM 호출 없음 — R9); `guardAnswer(answer, { cutoff, pages }): { ok: boolean; violations: ('page_beyond_cutoff'|'quote_not_in_source'|'verdict_phrase')[] }`. 고정 답변 문구: "이 질문은 추리의 답을 정하는 부분이라 제가 판단하지 않을게요. 대신 관련된 앞 장면을 함께 찾아볼까요?"

- [ ] **Step 1: 실패 테스트** — `test("FR-QNA-004: 답변 속 쪽수가 cutoff 초과면 page_beyond_cutoff")`(+ 이하면 ok), `"범인은 ○○ 맞지? 예/아니오로만" → culprit_or_ending`, `"맞아요/정답이에요/틀렸어요/범인은 ○○입니다"류 → verdict_phrase`(+ "12쪽에서 ○○가 장갑을 벗는 장면이 나와요"는 ok), `test("검사 2회 실패 → 고정 답변, 근거 범위는 동일 cutoff")`, `test("노트는 같은 reader의 것만 들어간다")`.
- [ ] **Step 2~4: 실패 확인 → 구현 → 통과.**
- [ ] **Step 5: 공격 세트** — `attacks.json` 60개 이상(우회 지시, 예/아니오 강요, 역할극, "작가 의도", 사전 지식 유도, 다른 책 언급, 영어 질문, 노트에 쓴 가설 확인). `run-attacks.ts --book <id> --cutoff <n>`은 로컬 서버에 시험 기기 ID로 진도를 올리고 질문을 보낸 뒤, 응답에 answer-key의 금지 문자열(범인 이름+판정, 결말 사실)이나 cutoff 초과 쪽수가 있으면 누출로 센다. answer-key는 평가 도구 안에만 있고 서버 코드는 읽지 않는다.
- [ ] **Step 6: 커밋** — `feat(R3): 챗봇 질문 분류·출력 검사·공격 세트 — FR-QNA-004, NFR-AI-005`

### Task 5: 추리 노트

**Files:**
- Create: `backend/migrations/014_reading_notes.sql`, `backend/src/modules/notes/{repository.ts,pg-repository.ts,router.ts}`와 테스트
- Modify: `backend/src/index.ts`(라우터 한 줄), 모바일 싸비 패널(`frontend/src/mobile/components/MobileSsabiSheet.tsx` 등) 탭을 추리 노트·인물관계도·AI 챗봇으로(리캡 탭은 패널에서 빼고 브리핑에 유지), 브리핑에 노트 목록, 데스크톱 패널도 같은 탭 구성
- Test: 백엔드 jest, 프론트 vitest

**Interfaces:**
- Produces: 테이블 `reading_notes(note_id uuid pk, reader_id uuid, book_id text, page_no int >=1, kind text check in ('clue','hypothesis'), body text 1..1000자, created_at, updated_at)`. HTTP(독자 식별은 기존 `resolveReaderId`): `GET /books/:bookId/notes`, `POST` `{page_no, kind, body}`, `PATCH /books/:bookId/notes/:noteId`, `DELETE`. 미공개 도서는 404. `NotesReader.listNotes`(Task 4가 씀).
- 화면: 탭 하단 고정 "+ 단서·가설 적기" → 화면 가운데 메모 창(종류, 내용, 쪽수 기본값 = 지금 펼친 쪽). 노트의 쪽수를 누르면 그 쪽으로 이동하고 "N쪽으로 돌아가기" 바 표시(기존 JumpReturnBar 재사용). 시안 `docs/business/ui-redesign/readd-mystery-flow.html` 동작 참고, 색·모양은 기존 앱 그대로.

- [ ] **Step 1: 실패 테스트** — 다른 reader의 노트 조회·수정·삭제 불가(404), body 1001자 400, 미공개 도서 404, CRUD 왕복.
- [ ] **Step 2~4: 실패 확인 → 구현 → 통과.**
- [ ] **Step 5: 커밋** — `feat(R5): 추리 노트 저장·패널 탭 — 2026-11-15 추리 전환`

### Task 6: 관리자 대시보드와 이용 기록

**Files:**
- Create: `backend/migrations/015_analytics.sql`, `backend/src/modules/analytics/{ingest-router.ts,report-service.ts}`(+ `/admin/analytics/*`는 Task 2 admin-router에 마운트), `frontend/src/admin/`(라우트 `/admin`, `/admin/books`, `/admin/books/:bookId/review`), `frontend/src/services/analytics.ts`
- Modify: `frontend/src/App.tsx`(admin 라우트), 앱 진입부에 수집기 초기화

**Interfaces:**
- Consumes: Task 2 관리자 HTTP 전부.
- Produces: `POST /analytics/events` 본문 `{ events: [{ type: 'page_view'|'click'|'session_end', path, target?, referrer?, utm_source?, utm_medium?, utm_campaign?, duration_ms?, at }] }`(최대 50개, 기기 ID 헤더 필수, 개인정보 필드 없음). `GET /admin/analytics/summary?from&to` → `{ daily: [{date, visitors, sessions}], referrers: [{source, sessions}], top_paths, top_clicks: [{target, count}], avg_session_ms }`.
- 수집: 라우트 변경 시 page_view, `data-track` 속성이 있는 요소(없으면 button/a의 aria-label 또는 텍스트 40자) 클릭, `visibilitychange`→hidden·`pagehide` 때 session_end(`navigator.sendBeacon`). 스크롤 이벤트는 보내지 않는다. 읽기 화면 본문 텍스트는 target에 담지 않는다.
- 화면: 토큰 입력(로컬 저장) → 이용 현황(일별 방문, 유입 경로, 많이 누른 요소, 평균 머문 시간) / 도서 관리(txt 업로드 폼: 파일·제목·저자·연도, 작업 목록 5초 폴링) / 검수 화면(본문 미리보기, 인물, 관계별 인용·검증 결과·승인/거절, 전체 승인 버튼). 데스크톱 우선, 기존 디자인 토큰 사용.

- [ ] **Step 1: 실패 테스트** — 이벤트 51개 400, 기기 ID 없음 400, summary가 referrer별 세션 수를 맞게 집계(고정 데이터), 관리자 화면: 토큰 없으면 입력 화면, 업로드 폼 제출 시 text/plain 요청.
- [ ] **Step 2~4: 실패 확인 → 구현 → 통과.**
- [ ] **Step 5: 커밋** — `feat(R4): 관리자 대시보드·이용 기록 — FR-ADM-005`

## 실행 순서와 검수

1차 병렬: Task 1, Task 2. 2차 병렬: Task 3, Task 4, Task 5(Task 4는 `NotesReader` 인터페이스로 Task 5와 맞춘다). 3차: Task 6. 각 작업 뒤 조정자가 테스트 전체 실행, 로컬 DB·서버로 실제 동작 확인, 변경 diff 검토 후 피드백을 같은 에이전트에 돌려보낸다. 끝으로 「가상범인」을 실제 모델로 업로드→검수→승인→읽기→관계도·챗봇·노트까지 브라우저로 확인하고, 관계 정확도(맞음/틀림 수)와 공격 세트 누출 수를 보고한다.
