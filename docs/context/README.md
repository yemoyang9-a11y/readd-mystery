# 먼저 읽을 문서 — RE:ADD 현재 상태와 문서 지도

마지막 갱신: 2026-11-17. 새 세션(Claude Code 포함)은 이 문서를 가장 먼저 읽는다.

## 1. 기준이 되는 문서 (충돌하면 위가 이긴다)

1. **사용자(대표)가 대화에서 한 최신 지시**
2. **결정 기록** — 원본은 claude.ai RE:ADD 프로젝트의 `claude/readd-decisions.md`. 이 저장소의 [decisions.md](decisions.md)는 그 사본(스냅샷)이다
3. **이 문서(docs/context/README.md)** 와 [CLAUDE.md](../../CLAUDE.md)의 절대 규칙·불변식
4. 최신 설계 문서: [2026-11-16 추리소설 파이프라인 설계](../superpowers/specs/2026-11-16-mystery-pipeline-design.md), [2026-11-06 모바일 웹앱 설계](../superpowers/specs/2026-11-06-mobile-webapp-design.md), [IR v5 인수인계](../ir-v5/HANDOFF.md)
5. 그 밖의 문서. 날짜가 오래된 문서는 아래 3장의 상태 표를 보고 쓴다

결정 기록 사본과 원본이 어긋나면 날짜가 늦은 쪽을 확인하고, 그래도 다르면 사용자에게 묻는다. Claude Code 세션에서 새 결정이 나오면 [decisions.md](decisions.md) 맨 아래 "동기화 대기" 절에 적고 커밋한다. 프로젝트에 연결된 대화 세션이 원본에 옮긴다.

## 2. 지금 무엇을 만드는가 (2026-11-17)

**회사 목적:** 추리소설 독자가 끝까지 스스로 추리하는 재미를 지킨다.
**장기 목표:** 추리소설 독자가 가장 먼저 찾는 독서 플랫폼이 된다.

| 항목 | 현재 결정 | 결정 번호 |
| --- | --- | --- |
| 서비스 | 추리소설 전용 독서 플랫폼. 본문을 우리 사이트에서 읽는다 | 13, 19 |
| 기능 | 추리 노트, 인물관계도, 타임라인(다 읽은 장만 장별 간략 요약), AI 친구. 이어 읽기는 기본 | 31 |
| 스포일러 기준 | 가장 멀리 읽은 쪽(`max_page`). 목차로 그보다 뒤로 건너뛰면 확인 창 | 22 |
| AI 친구 원칙 | 같이 추론하는 친구. 독자 가설을 판정·반박하지 않고 결말을 말하지 않는다. 물을 때만 답한다 | 23 |
| 원문 출력 상한 | 답변 하나에 원문을 그대로 옮기는 양은 합계 200자까지 | 34 |
| 핵심 고객 | 추리소설을 평소에 읽으며 읽는 동안 직접 범인을 맞혀 보는 20~30대. 전자책 독자로 한정하지 않음 | 27 |
| 작품 확보 | 국내 출판사에게서만 받는다. 번역·해외 직접 협상·무명 작가 섭외는 하지 않는다. 첫 제안 대상 나비클럽(협의 전) | 20, 25, 28 |
| 수익 모델 | 구독형. 월 9,900원, 첫 달 무료. 출판사 정산 50%는 협의 전 제안값 | 29, 30, 35 |
| 출시 방식 | 무료 시연 없이 유료 출시. 수요는 유료 전환율·유지율로 확인 | 30 |
| 화면 기준 | 휴대폰 우선 (태블릿 가로 기준에서 2026-11-06 전환) | 모바일 설계 |
| 기술 | Cloudflare Pages + Fly.io + Supabase(PostgreSQL + pgvector) + OpenAI Responses API(`gpt-6-luna`, low, 코드 기본값) + Cohere embed-v4 | — |
| 데모·검증 작품 | 김내성 「가상범인」 → 「타원형의 거울」 → 「마인」 (저작권 만료). 「탁류」는 기술 검증용 | 파이프라인 설계 3장 |
| 사업 일정 | 모두의 창업 1R 사업계획서 마감 2026-12-01 13시. 로드맵은 라운드 기준으로 짜지 않는다 | — |

아직 정하지 않은 것은 [decisions.md](decisions.md)의 "아직 정하지 않은 것" 절에 있다.

## 3. 코드 상태 (main 기준, 2026-11-17 확인)

**구현·병합됨** (2026-11-16 설계의 Task 1~6, main 커밋 기준)

| 기능 | 근거 |
| --- | --- |
| 기준 쪽수 = 가장 멀리 읽은 쪽 | `backend/migrations/012_reading_max_page.sql`, `reading-state/cutoff.service.ts`, `frontend/src/components/Reader/TocJumpDialog.tsx` |
| 업로드 작업 실행기·관리자 검수·승인 API | `backend/src/modules/ingest/`, `013_ingest_jobs.sql` |
| 인물 정리·관계 교차 추출·반대 검토 | 커밋 3333fa0 |
| 챗봇 하네스(질문 분류, 출력 검사, 고정 답변) | `backend/src/modules/chatbot/harness/` |
| 추리 노트(저장, 패널 탭, 챗봇 연결) | `014_reading_notes.sql`, `frontend/src/components/Ssabi/NotesTab.tsx` |
| 관리자 대시보드·이용 기록 | `015_analytics.sql`, `frontend` `/admin` |
| 완독자 커뮤니티 게시판 | `016_community.sql` (결정 기록에는 없는 기능, 코드에만 있음) |
| 모바일 화면 | 2026-11-06 모바일 설계, 11-16 브랜드 색·아모 교체 |

**브랜치에만 있음**
- `feat/chatbot-verbatim-limit`: 챗봇 원문 출력 상한 답변당 합계 200자(커밋 78787c8). 미병합

**결정과 코드가 다른 곳 (할 일)**
- 읽기 화면 싸비 패널은 추리 노트·인물관계도·AI 챗봇 3탭이다. 결정 31의 **타임라인은 아직 없다.** 리캡은 패널에서 빠지고 브리핑 화면에만 있다
- 원문 출력 상한은 "작품 밖 질문"(`outside` 의도)에 적용되지 않는다. 이 의도는 검사 없이 바로 스트리밍된다
- 여러 질문에 나눠 원문을 받아 가는 누적 재현은 막지 않는다
- 공격 질문 시험 130건 중 117건은 사람이 아직 읽지 않았다 (출시 전 전체 판정 필요)

**배포 상태:** 운영 주소(https://ssabi-d4c.pages.dev, https://ssabi-api.fly.dev)는 **피벗 전 버전**이다. 2026-11-17 확인: 운영 API에 추리 노트·커뮤니티 경로가 없고(404), 운영 프론트 번들에 커뮤니티 화면 코드가 없다. 배포된 화면으로 새 기능을 판단하지 않는다. 배포는 사용자가 요청할 때만 한다.

## 4. 이 저장소 문서의 상태

| 문서 | 상태 | 메모 |
| --- | --- | --- |
| `CLAUDE.md` | 현행 | 2026-11-17 추리 방향으로 정리 |
| `PRODUCT.md` | 현행 | 2026-11-17 추리 방향으로 다시 씀 |
| `README.md` | 현행 | 상단과 문서 표를 2026-11-17 갱신. 아키텍처 이전 이야기는 이력 |
| `DESIGN.md` | 대부분 현행 | 디자인 토큰은 유효. 「탁류」 표지·태블릿 레이아웃 서술은 이력이며 화면 기준은 휴대폰 우선 |
| `lessons.md` | 현행 | 개발 중 겪은 문제와 해결 |
| `docs/context/` | 현행 | 이 문서, 결정 기록 사본, 인수인계 |
| `docs/superpowers/specs/2026-11-16-*`, `plans/2026-11-16-*` | 현행 | 문서 첫 줄의 "승인 대기"는 작성 당시 상태. Task 1~6은 main에 병합됨 |
| `docs/superpowers/specs/2026-11-06-*`, `plans/2026-11-06-*` | 현행 | 모바일 기준 |
| `docs/superpowers/specs·plans/2026-10-2x-*` | 현행(부분) | 근거 기반 답변·관계 의미. 이후 설계가 덮어쓴 곳은 이후 설계를 따른다 |
| `docs/superpowers/specs·plans/2026-08-*` | 이력 | 해커톤 시기 화면·조회 API 계획 |
| `docs/architecture/architecture-current.md` | 대부분 현행 | 인프라 구성은 유효. 구성도의 LLM이 Anthropic으로 적힌 곳은 옛 표기이고 5.1절(OpenAI)이 현행 |
| `docs/architecture/architecture-r1.md` | 이력(설계 근거) | 조항·절 번호를 참조할 때 쓴다 |
| `docs/architecture/architecture-r2.md`, `architecture-aws.md`, `docs/migration.md` | 이력 | AWS 시기와 이전 과정 |
| `docs/ir-v5/` | 현행 | 사업계획서 IR v5. 이 저장소는 비공개라 둠. 공개 저장소에는 올리지 않는다 |
| `docs/validation/` | 기록 | 날짜별 화면 검증 |
| `docs/archive/2026-08-hackathon/` | 이력 | 8월 R4 인수인계, AWS 배포 안내 |
| `infra/terraform/` | 이력 | AWS 시기 인프라. 지금 쓰지 않는다 |
| `evaluation/` | 현행 | 관계 평가, 챗봇 공격 시험 |
| `backend/*.md`, `frontend/README.md` | 구현 참고 | 실행 방법은 대체로 유효. 「탁류」·Anthropic 표기가 남아 있을 수 있다 |

## 5. claude.ai 프로젝트 문서의 상태

프로젝트에 연결되지 않은 세션은 아래 문서를 읽을 수 없다. 필요한 내용은 이 문서와 [decisions.md](decisions.md)에 옮겨 두었다.

| 프로젝트 문서 | 상태 | 메모 |
| --- | --- | --- |
| `claude/readd-decisions.md` | **현행 (결정 원본)** | 이 저장소의 decisions.md가 사본 |
| `claude/readd-market-size-formula-2026-11-15.md` | 현행 근거 | 최종 수치는 IR v5 인수인계의 재계산을 따른다 |
| `claude/readd-bizplan-evidence-2026-11-14.md` | 현행 근거 | 왜 지금, 시장, 정산 비율 조사 |
| `claude/readd-deck-problem-evidence.md` | 현행 근거 | 문제 정의 근거 |
| `claude/readd-mystery-rights-plan.md` | 현행 근거 | 추리 작품 권리 확보 |
| `claude/readd-market-size-pricing-2026-11-14.md` | 일부 대체됨 | 11,900원·2,000명은 IR v5(9,900원·2,300명)로 대체. 이 문서의 "결정 29·30"은 결정 기록 번호와 다르다 |
| `claude/readd-bizplan-deck-handoff.md`, `claude/readd-deck-notes-archive.md` | 참고 | 11/14~15 슬라이드 덱 시기. 사업계획서 최신은 IR v5 |
| `claude/readd-niche-genre-research.md`, `claude/readd-mentoring-1-notes.md` | 참고 | 피벗 배경 |
| `claude/readd-essence-research.md` | 피벗 전 | 결정 21(회사 목적)로 대체 |
| `claude/readd-market-analysis-summary.md` | 피벗 전 | 웹소설 전반 기준 시장 분석(2026-10-17) |
| `claude/readd-bizplan-data-plan.md`, `claude/readd-bizplan-gap-and-budget.md`, `claude/readd-round2-mvp-scope.md` | 피벗 전 | 웹소설 작가 연계·B2B 시기 계획 |
| `claude/readd-author-outreach-plan.md` | 폐기 | 무명 작가 섭외는 결정 20으로 제외 |
| `claude/readd-b2g-textbook-works.md` | 보류 | 학교(B2G)는 확장 후보로만 둠(결정 7) |
| `readd/*` (README, PRODUCT, CLAUDE, DESIGN, handoff-r4-*, query-endpoints-split) | 피벗 전 사본 | 옛 저장소 사본. 현행본은 이 저장소에 있다 |
