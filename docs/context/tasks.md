# 작업 문서 — 남은 작업과 미결 사항

마지막 갱신: 2026-11-18 (종합 리뷰 반영, 최신 대표 결정 유지, 논문 기반 관계 추출 T12 추가)

**남은 작업, 진행 상태, 아직 정하지 않은 것은 이 문서 한 곳에서만 관리한다. 대표 컴퓨터에서 할 실측·배포 순서는 [runbook-local-2026-11-17.md](runbook-local-2026-11-17.md).** `CLAUDE.md`에는 규칙만 두고 할 일·진행 상태를 적지 않는다. `handoff-*.md`는 그날 세션의 인수인계 기록이며, 할 일 목록의 원본은 이 문서다.

## 갱신 규칙

- 작업을 시작하거나 끝내면 이 문서의 상태를 같은 커밋에서 고친다
- 끝난 작업은 "완료"로 옮기고 커밋 해시를 적는다
- 상태가 **결정 필요**인 항목은 추론해서 채우지 않는다. 사용자에게 묻고 멈춘다
- 새 결정이 나오면 [decisions.md](decisions.md) 맨 아래 "동기화 대기"에도 적는다

상태 표기: **결정 필요** (사용자 답 없이는 시작 못 함) · **진행 가능** · **진행 중** · **사용자 요청 시** · **조건부** · **로컬 필요** (대표 컴퓨터의 DB·AI 키가 있어야 함)

## 1. 남은 작업 (우선순위 순)

| # | 작업 | 상태 | 막힌 곳 · 다음 행동 | 관련 |
| --- | --- | --- | --- | --- |
| R1 | 마이그레이션 재실행 안전성 | 진행 가능 (운영 적용은 별도) | 이력 없이 019를 재실행하면 비어 있는 read_pages가 current_page까지 채워짐. 기존 적용 이력 확정·ledger·트랜잭션·재실행 통합 시험 필요 | [종합 리뷰](../reviews/2026-11-18-repository-review.md) |
| R2 | 업로드 원문 영속 보관·다중 worker 점유 | 진행 가능 (설계 필요) | 이번 수정은 비루트 쓰기 권한·같은 프로세스 중복 retry만 해결. 저장소/DB lease와 재시작·머신 교체 복구 시험 필요 | `modules/ingest/`, `fly.toml` |
| R4 | 남은 의존성 Moderate 경고 | 진행 가능 | production audit의 High/Critical은 패치 업데이트로 0건. Router 7 및 uuid 호환성 전환·회귀 검증 후 남은 3개 패키지 경고 해소 | [종합 리뷰](../reviews/2026-11-18-repository-review.md) |
| R3 | 실제 브라우저·PostgreSQL 통합 검증 | 진행 중 | PR에 12개 Chromium smoke·Docker 비루트 검사 추가. 실제 iOS/VoiceOver·가상 키보드·DB 경합은 별도 검증 필요. 실제 AI 실측은 기존 대표 직접 실행 결정 유지 | [종합 리뷰](../reviews/2026-11-18-repository-review.md) |
| T8 | 로컬 DB 적용과 실데이터 확인 | 로컬 필요 | ① 마이그레이션 017(reader_text)·018(recap 길이 로그)·019(차례 읽기 기준점)·020(리캡 이름 검사 로그)·021(노트 종류)·022(커뮤니티 신고 숨김) — **2026-11-17 Supabase `readd-mystery`에 적용 완료**(대표 승인). 다른 DB(로컬 등)를 쓰면 거기에도 적용 ② 「가상범인」 독자용 문장 백필 dry-run ③ 장면 단위 사건 추출 1장 실행(`run-generate-sample.ts --chapter 1`)으로 장면 수·검수 후보 수·비용 확인 ④ 휴대폰 화면으로 실제 동작 확인(목차 확인 창·싸비 확인 카드 포함) | `docs/superpowers/handoff/2026-11-17-ssabi-notes-home3d.md` |
| T9 | 장면 단위 사건 추출 비용 | 결정 필요 (T8 ③ 뒤) | 장면마다 장 처음부터 다시 읽혀 입력이 장면 수에 비례해 늘어난다(1장 20장면 가정 시 약 23만 자). 실측 뒤 "앞 장면 1~2개 + 대상 장면"으로 줄일지 정한다(스포일러 측면은 같음, 맥락은 줄어듦). **비교 방법** — `run-generate-sample.ts --chapter 1`(또는 `run-generate-full.ts`, 사건 캐시 재생이면 AI 호출 없음)을 돌리면 `[사건 입력]` 로그에 창별 원문 입력 글자 수(`full`·`recent:1`·`recent:2`)가 함께 찍히고, 실제로 줄여서 돌려 보려면 `--scene-window recent:1`(또는 환경 변수 `EVENT_SCENE_WINDOW`)을 준다 — 기본은 `full` 그대로다 | `batch/pipeline/event-scenes.ts` |
| T10 | 리캡 길이 실측 | 로컬 필요 (대표가 직접 실행, 2026-11-17) | 018 적용 후 `recap_call_log`로 목표 문장 수 대비 실제 길이 분포를 본다(쿼리는 4장). 여전히 흔들리면 다음 단계로 누적 리캡 사전 생성·검수(A안) 설계 | `reading-state/recap-length.ts` |
| T3 | 공격 질문 시험 전체 판정 | 결정 필요 | 130건 중 117건은 사람이 읽지 않았다. 판정 방식·담당이 미정. 출시 전에 필요. 이번 하네스 변경 뒤 다시 실행해야 한다 | `evaluation/chatbot-harness/` |
| T12 | 이메일 로그인 운영 준비 | 대표·조정자 작업 필요 (2026-11-18) | ① 마이그레이션 023(`user_passwords`, provider 'email', `users.onboarded_at`) DB 적용 ② 비밀번호 재설정·이메일 인증 없음(메일 발송 서비스 미정) ③ 시도 제한은 서버 한 대 메모리 기준(IP당 분당 10회, Fly-Client-IP). 서버를 늘리면 공유 저장소가 필요 ④ 구글·카카오 버튼은 `*_CLIENT_ID`·`*_CLIENT_SECRET`이 둘 다 있을 때만 보인다 | `backend/src/modules/auth/`, `frontend/src/pages/Login.tsx` |
| C1 | 마이그레이션 024(커뮤니티 공감) 적용 | 사용자 요청 시 | `backend/migrations/024_community_likes.sql`. 적용 전에는 커뮤니티 글 목록 조회가 `community_post_likes` 없음으로 실패한다 — 서버 배포와 같이 적용해야 한다 | `modules/community/pg-repository.ts` |
| T13 | 논문 기반 인물 관계 추출 실제 모델 실행 (「가상범인」) | 로컬 필요 (대표 컴퓨터, 비용 발생) | 구조적 후보 + 근거 창 라벨링을 구현·단위 시험했으나 실제 모델 출력은 0건. ① `--candidates-only`로 기존 관계와 비교(LLM 0회) ② 라벨 실행(후보 있는 장마다 2회 + `--verifier`) ③ 발췌 5건 실행 후 `check-structural-metrics.cjs`로 정밀도·재현율·이른 확립 0건 확인 ④ 보류 목록(특히 `trigger_sentence_lacks_endpoint`)으로 재현율 손실 판단. 명령은 [runbook](runbook-local-2026-11-17.md) 6장. 그 뒤 `run-generate-full`의 관계 단계를 새 방식으로 바꿀지 **결정 필요** | [조사·설계](research-2026-11-18-relationship-extraction.md), `batch/pipeline/run-generate-relationships-structural.ts` |
| T6 | 운영 배포 | 사용자 요청 시 | 운영 주소(https://ssabi-d4c.pages.dev, https://ssabi-api.fly.dev)는 피벗 전 버전이다. 피벗 후 Cloudflare 배포가 따로 있는지 확인 중(API 토큰이 유효하지 않아 아직 못 봄) | [README.md](README.md) 3장 |

## 2. 작업과 별개로 결정이 필요한 것

| 항목 | 상태 | 메모 |
| --- | --- | --- |
| 커뮤니티 운영 정책(나머지) | 출시 뒤 필요하면 (대표 결정 2026-11-17) | 신고 처리는 정함(관리자 화면 + 서로 다른 독자 3명 신고 시 자동 숨김, 2026-11-17). 남은 것: 차단·금칙어·신고당한 글쓴이 안내 없음. 글 수정 불가(삭제만), 익명 별명 "독자 xxxx" 고정, 휴대폰 전용 — 이대로 갈지 |
| 자동 배포 켜기 | 대표 작업 필요 (2026-11-18) | 화면은 GitHub Pages(`deploy-pages.yml`, 저장소 공개 전제). ① 저장소를 Public 으로 ② Settings → Pages → Source "GitHub Actions" ③ Secrets 에 `FLY_API_TOKEN`(서버 자동 배포) ④ Fly 앱 ssabi-api 의 Secrets `CORS_ORIGIN` 에 `https://yemoyang9-a11y.github.io` 추가, `DATABASE_URL` 이 피벗 후 DB(rntzmaarbtzjgzknqfve)인지 확인. 화면 주소: https://yemoyang9-a11y.github.io/readd-mystery/ |
| 검색 결과 6쪽의 구성 | 결정 필요 (실측 뒤) | 순위 융합 상위 4쪽 + 그 앞뒤 쪽 2쪽으로 바꿨다(전에는 검색 6쪽). 근거 없는 선택이라 실제 질문으로 비교해야 한다. 앞뒤 쪽이 현재 장 원문과 겹치면 자리만 차지한다 |

## 3. 조건부 작업

| 항목 | 조건 |
| --- | --- |
| 프롬프트 캐싱 (A8-2) | 성능 측정에서 2.0초 초과 시에만 |
| 본문·챗봇 화면 캡처·복사 금지 | 앱(인앱)으로 전환할 때 설정한다. 본문과 챗봇 답에 같은 수준으로 건다. 지금 웹앱은 캡처를 막을 수 없고 읽기 화면에 복사 막기도 없다 |
| 챗봇 난이도 판정 규칙 변경 | 바꿀 일이 생길 때만. 규칙은 `difficulty-router.ts`에 있고, 바꿀 때 조건은 CLAUDE.md 9장 |
| 허전함 개선 2순위 이하 | 추리 노트 빈 상태 견본 카드, 작품 페이지 소개 보강, MY 내 독서 기록, 하단 메뉴 구성 등. 1순위 반영 결과를 보고 진행 |

## 4. 알려진 기존 문제

| 항목 | 메모 |
| --- | --- |
| 백엔드 jest 종료 경고 | 전체 실행 시 "worker process has failed to exit gracefully". 시험은 모두 통과 |
| 잔여 린트 경고 | 2026-11-18 생산 소스 린트 오류 0. 백엔드 115개(any·console 등), 프론트 2개(hook 의존성) 경고는 남음. 테스트 타입은 Jest/Vitest·TypeScript로 검증 |

## 5. 완료

2026-11-18 종합 리뷰 수정은 이 PR에 포함한다(병합 커밋은 병합 후 기록). 인용량 Unicode·진도 입력 검증·중복 retry·컨테이너 쓰기 권한·모달/확인 실패·메모 경합·SSE 중단·라우트 분리·CI 검증·현행 문서 동기화. 근거와 한계는 [종합 리뷰](../reviews/2026-11-18-repository-review.md).

| 날짜 | 작업 | 커밋 |
| --- | --- | --- |
| 2026-11-18 | 처음 접속하면 로그인·회원가입 — 이메일 가입·로그인 API(scrypt, 409/401/429), `/auth/providers`, `/auth/me`의 email·onboarded, `/auth/me/onboarded`, 마이그레이션 023, 로그인 화면 `/login`과 세션 관문(가입 뒤 `/guide`) | (이 커밋) |
| 2026-11-18 | 완독 화면(서버 is_complete 일 때 책마다 한 번, 배지로 다시 열기) → 그 책 커뮤니티로 바로. 커뮤니티 허브(하단 메뉴 "커뮤니티", 잠긴 책은 글 수 없이 잠김만), 공감(마이그레이션 024, 미적용)·인기순·빈 상태 첫 글 권유 | (이 커밋) |
| 2026-11-17 | 챗봇 — 짧은 쪽 권유("55쪽을 보세요")도 위치를 묻지 않았으면 차단, 챗봇 노트에 최근 5개 항상 포함(기준 쪽수 이하만) | (이 커밋) |
| 2026-11-17 | 커뮤니티 신고 처리 — 서로 다른 독자 3명 신고 시 자동 숨김(작성자 포함 모두에게), 관리자 화면 `/admin/community`에서 복구·삭제, 복구 뒤에는 새 신고자 3명부터 다시 숨김. 마이그레이션 022 운영 DB 적용 | f3b7ea7, 13988aa, f3cac72 |
| 2026-11-17 | 챗봇 쪽 짚기 — "N쪽을 다시 읽어 보세요"류는 독자가 장면 위치를 물었을 때만 허용, 쪽 근거 사실 서술은 언제나 허용 | 90e0797 |
| 2026-11-17 | 챗봇 2차 — 암시형 답 검사(`steering_hint`), 아모 행동 단계표를 코드 표로 고정(동작 변화 없음), 검색 순위 융합(RRF) + 앞뒤 쪽 확장(기준 쪽수 이하, SQL 조건) | fb0acac, 75899d5, d8a8e76 |
| 2026-11-17 | 완독자 커뮤니티 출시 점검 — 서버 완독 게이트를 실제 기준점 결정기로 검증(목차로 마지막 쪽만 다녀오면 403), 읽기 화면 진입을 서버 is_complete 로만 열도록 수정 | ac2eaba, 3bc8929 |
| 2026-11-17 | 화면 자동 배포 워크플로 추가, CI 백엔드 테스트 전역 이름 충돌 수정 | da25e53 |
| 2026-11-17 | 장 요약 문장별 근거 확인(검수 후보), 사건 추출 입력 창 옵션(기본 full 유지) | 1910dc8, 97ef853 |
| 2026-11-17 | 마이그레이션 017~021 Supabase `readd-mystery` 적용, PR 자동 리뷰 예약 작업(매시간, 병합은 대표) | — |
| 2026-11-17 | 생성·리캡 검증 강화 — 평가어 검사를 인물 노트·관계·장 요약·독자용 문장으로 확대(검수 후보), 리캡 이름 검사 기록(마이그레이션 020), 관계 확립 페이지 비대칭 지표 | d38eeee, 65f4f65, 0bbcea6 |
| 2026-11-17 | 챗봇 — 작품 밖 질문 답을 문장 단위로 검사한 뒤 내보냄(규칙 11), 노트 선택 = 기준 쪽수 쿼리 조건 + 질문 관련·최근 순 20개, 공격 질문 16건 추가(미판정) | f11b1a8, 6cd7335, 72b118e |
| 2026-11-17 | 파이프라인 분석·읽기 논문 조사 보고서 `docs/context/research-2026-11-17-pipeline.md` | 59f16d1 |
| 2026-11-17 | 차례 읽기 기준점 화면 캡처 `docs/validation/2026-11-17-read-frontier/` | d880277 |
| 2026-11-17 | 추리 노트 종류 — 독자가 노트에 종류(일반·단서·궁금한 점·가설)를 붙이고 궁금한 점·가설에 '풀림'을 표시. 종류별 보기, 브리핑 '아직 풀지 못한 것' 먼저 보기, 챗봇 노트 절에 종류 표지(선택 범위·프롬프트 지시 변경 없음). 마이그레이션 021. AI·시스템은 종류·풀림을 정하지 않는다 | c0d30b2, 418a73f |
| 2026-11-17 | T11 프론트 `package-lock.json` 재생성 — `npm ci` 통과, 테스트 981건·빌드 확인 | 9fc5e7c |
| 2026-11-17 | 알려진 문제 정리 — ① `chatbot/service.ts` 린트 오류(`generateChunks` 선언 위치) ② 장 범위 겹침: 등록 단계(`validateSplit`)가 이미 겹침·간극을 거절함을 시험으로 고정하고, 마지막 장이 마지막 쪽에서 끝나는지·시작 쪽 ≤ 끝 쪽 검사를 추가 ③ 장면 경계 AI 호출의 작업 이름을 `generate_event_scene_boundary`로 분리(장면별 추출은 `generate_event` 그대로) ④ `recap.service.ts`·`run-seed-demo-state.ts` 린트 오류, mock의 `page - 1` | b92d5bb |
| 2026-11-17 | 사건 정리 "이 장을 다 읽으면…" 안내 정확도 — 사건 정리 응답의 장마다 서버가 다 읽었는지(`completed`)를 싣고, 다 읽은 장에는 안내를 내지 않는다 | 38a6149 |
| 2026-11-17 | 첫 방문 브리핑(휴대폰 화면)에 배경지식 표시 — 작품 소개 아래. `GET /info`의 `background` 그대로, 없거나 조회 실패면 그리지 않는다 | 4b732a8 |
| 2026-11-17 | 브리핑 응답에 마지막 읽은 시각(`last_read_at`) 추가 — 브리핑 화면이 `GET /books`를 따로 부르지 않는다. 화면 동작은 같다 | 2530adc |
| 2026-11-17 | 홈 이어 읽기 카드의 장 이름 = 이어 읽기 위치의 장 — 기준점 결정기가 `resume_chapter`를 만들고 브리핑 응답에 실어 홈 카드가 쓴다. 서버가 장을 못 찾으면 장 이름만 뺀다 | 110692d |
| 2026-11-17 | 기준점 = 차례로 읽은 쪽 + 독자 확인(A + C안) — 서버 계산·저장(마이그레이션 019)·API, 목차 확인 창 3버튼, 싸비 확인 카드. 한계: '다음' 연타는 확인 카드로만 보완 | bfb21cd + 화면 커밋 |
| 2026-11-17 | 피벗 전(2026-08~09) 문서 정리 — 8월 화면 계획·해커톤 인수인계·AWS 인프라 문서·Terraform·이전 기록(migration.md)·8월 백엔드/프론트 README·impeccable 8월 화면 평가·Supabase 이전 스크립트 삭제. 남긴 것: architecture-r1(조항 절 번호), architecture-current, SSE_SPEC(코드 참조), CI·배포 설정, 「탁류」 데이터(기술 검증용) | (이 커밋) |
| 2026-11-17 | 작은 화면 홈 — 이어 읽기 카드가 있을 때 입체 책 무대 높이를 "화면 높이 − 456px" 이하로 줄여 작품 보기 버튼이 하단 메뉴에 가려지지 않게(390×664: 버튼 아래 끝 650→596px, 메뉴 608px). 카드 없는 화면·큰 화면은 그대로. 캡처 `docs/validation/2026-11-17-ui-fill-p1/05c·05d` | (이 커밋) |
| 2026-11-17 | W4 허전함 개선 1순위 — 브리핑 고정 문구 "3일 만이에요" 제거(실제 `last_read_at` 기반), 진도 카드·목차 복원, 첫 방문 브리핑, 홈 이어 읽기 카드, 챗봇 고정 추천 질문. 캡처 `docs/validation/2026-11-17-ui-fill-p1/` | 3c2b65b, ba93e16, 19375f5, ba01070 |
| 2026-11-17 | W3 리캡 길이 제어(C안) — 문장 수 N을 코드로 계산해 지시, "짧게" 지시 삭제, 길이 로그(마이그레이션 018) | c2d59d5 (+ 통합 시 017→018 번호 변경) |
| 2026-11-17 | W2 사건 추출을 장면 단위·원문 근거 검증으로 — 장면 끝 뒤 원문 0자, 장면당 최대 2개, 발생 쪽 = 장면 끝 쪽, 평가어·대사 형태 검사, 독자용 문장 새 고유명사 검사 | 7572ebf |
| 2026-11-17 | W1 사건 정리는 다 읽은 장의 사건만(결정 31, 스포일러 수정), 관계 설명 칸 제목에 별칭 | 410e5e2, ec854bc |
| 2026-11-17 | T2(구 T2 타임라인) 사건 정리·인물관계도 선 선택·관계 설명 칸·입체 책 홈 — 2026-11-17 로컬 시안대로 | dd9d87d, e1fad73, e2821d2, 0c902f4, e25408b |
| 2026-11-17 | T5 리캡 — 리캡을 유지하고 길이 제어부터 개선(W3)하기로 함. 환각 검증은 T10 실측 후 | — |
| 2026-11-17 | T4 `feat/chatbot-verbatim-limit` main 병합 | 7657e59 |
| 2026-11-17 | T1 원문 누적 재현 차단 — **하지 않기로 함**(사용자 결정). 지금 작품은 저작권 만료라 가져가도 문제없고, 챗봇 답은 본문과 같은 보호 수준이라 별도 통로가 아니다. 보호가 필요해지면 인앱 전환 시 캡처·복사 금지로 해결(3장). 답변당 200자 상한(결정 34)은 유지 | — |
| 2026-11-17 | 작품 밖 질문(`outside`) 원문 상한 — 스트리밍 유지, 200자에서 끊기(사용자 선택 설계안 B) | 22c9e9c |
| 2026-11-17 | 챗봇 원문 출력 상한 답변당 합계 200자 | 78787c8 |

## 부록 — 리캡 길이 분포 확인 쿼리 (T10, 018 적용 후)

```sql
-- 목표 N별 실제 길이 분포
SELECT target_sentences AS n, count(*) AS calls,
       min(output_chars) AS min_chars,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY output_chars) AS p50_chars,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY output_chars) AS p90_chars,
       max(output_chars) AS max_chars,
       round(avg(output_sentences), 2) AS avg_sentences,
       round(100.0 * avg((output_sentences = target_sentences)::int), 1) AS pct_exact_n,
       round(100.0 * avg((output_chars >= 480)::int), 1) AS pct_near_500_cap
FROM recap_call_log WHERE target_sentences IS NOT NULL
GROUP BY target_sentences ORDER BY target_sentences;

-- 바꾸기 전과 후 비교
SELECT CASE WHEN target_sentences IS NULL THEN 'before' ELSE 'after' END AS era,
       count(*) AS calls,
       percentile_cont(ARRAY[0.1,0.5,0.9]) WITHIN GROUP (ORDER BY char_length(output_ref)) AS p10_p50_p90_chars,
       round(stddev_samp(char_length(output_ref)), 1) AS stddev_chars
FROM recap_call_log GROUP BY 1;
```
