# 작업 문서 — 남은 작업과 미결 사항

마지막 갱신: 2026-11-17 (통합 브랜치 `integrate/2026-11-17`)

**남은 작업, 진행 상태, 아직 정하지 않은 것은 이 문서 한 곳에서만 관리한다.** `CLAUDE.md`에는 규칙만 두고 할 일·진행 상태를 적지 않는다. `handoff-*.md`는 그날 세션의 인수인계 기록이며, 할 일 목록의 원본은 이 문서다.

## 갱신 규칙

- 작업을 시작하거나 끝내면 이 문서의 상태를 같은 커밋에서 고친다
- 끝난 작업은 "완료"로 옮기고 커밋 해시를 적는다
- 상태가 **결정 필요**인 항목은 추론해서 채우지 않는다. 사용자에게 묻고 멈춘다
- 새 결정이 나오면 [decisions.md](decisions.md) 맨 아래 "동기화 대기"에도 적는다

상태 표기: **결정 필요** (사용자 답 없이는 시작 못 함) · **진행 가능** · **진행 중** · **사용자 요청 시** · **조건부** · **로컬 필요** (대표 컴퓨터의 DB·AI 키가 있어야 함)

## 1. 남은 작업 (우선순위 순)

| # | 작업 | 상태 | 막힌 곳 · 다음 행동 | 관련 |
| --- | --- | --- | --- | --- |
| T7 | 통합 브랜치 main 병합 | 사용자 요청 시 | `integrate/2026-11-17` = T2(사건 정리·관계도·입체 책 홈) + W1~W4. 전체 시험 통과 후 병합 여부를 묻는다 | 2장의 브랜치 표 |
| T8 | 로컬 DB 적용과 실데이터 확인 | 로컬 필요 | ① 마이그레이션 017(reader_text)·018(recap 길이 로그)·019(차례 읽기 기준점) 로컬 적용 ② 「가상범인」 독자용 문장 백필 dry-run ③ 장면 단위 사건 추출 1장 실행(`run-generate-sample.ts --chapter 1`)으로 장면 수·검수 후보 수·비용 확인 ④ 휴대폰 화면으로 실제 동작 확인(목차 확인 창·싸비 확인 카드 포함) | `docs/superpowers/handoff/2026-11-17-ssabi-notes-home3d.md` |
| T9 | 장면 단위 사건 추출 비용 | 결정 필요 (T8 ③ 뒤) | 장면마다 장 처음부터 다시 읽혀 입력이 장면 수에 비례해 늘어난다(1장 20장면 가정 시 약 23만 자). 실측 뒤 "앞 장면 1~2개 + 대상 장면"으로 줄일지 정한다(스포일러 측면은 같음, 맥락은 줄어듦) | `batch/pipeline/event-scenes.ts` |
| T10 | 리캡 길이 실측 | 로컬 필요 | 018 적용 후 `recap_call_log`로 목표 문장 수 대비 실제 길이 분포를 본다(쿼리는 4장). 여전히 흔들리면 다음 단계로 누적 리캡 사전 생성·검수(A안) 설계 | `reading-state/recap-length.ts` |
| T3 | 공격 질문 시험 전체 판정 | 결정 필요 | 130건 중 117건은 사람이 읽지 않았다. 판정 방식·담당이 미정. 출시 전에 필요. 이번 하네스 변경 뒤 다시 실행해야 한다 | `evaluation/chatbot-harness/` |
| T6 | 운영 배포 | 사용자 요청 시 | 운영 주소(https://ssabi-d4c.pages.dev, https://ssabi-api.fly.dev)는 피벗 전 버전이다. 피벗 후 Cloudflare 배포가 따로 있는지 확인 중(API 토큰이 유효하지 않아 아직 못 봄) | [README.md](README.md) 3장 |
| T11 | 프론트 `package-lock.json` 재생성 | 진행 가능 | `package.json`과 어긋나 `npm ci`가 실패한다(esbuild 0.28.2 등 누락). CI·배포 빌드에서도 실패할 수 있다. `npm install`로 다시 만들고 테스트·빌드 확인 후 커밋 | `frontend/` |

## 2. 작업과 별개로 결정이 필요한 것

| 항목 | 상태 | 메모 |
| --- | --- | --- |
| 사건 정리 "이 장을 다 읽으면…" 안내 정확도 | 결정 필요 | 마지막 장을 다 읽었는데 그 장에 사건이 0건이면 안내가 잘못 뜬다. 정확히 하려면 서버가 장별 완료 여부를 내려줘야 함(API 변경) |
| 완독자 커뮤니티 출시 범위 | 결정 필요 | main 코드(`016_community.sql`)에는 있으나 결정 기록에 없다 |

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
| `chatbot/service.ts` eslint 오류 | `no-inner-declarations`(`generateChunks` 선언 위치). `feat/chatbot-verbatim-limit` 이전부터 있었다 |
| 백엔드 jest 종료 경고 | 전체 실행 시 "worker process has failed to exit gracefully". 시험은 모두 통과 |
| 장 범위가 겹치면 사건 중복 | 사건 조회가 장 범위로 조인하므로 범위가 겹치는 책에서는 같은 사건이 두 번 나올 수 있다(챗봇 쿼리도 같음). 파이프라인이 장 범위 겹침을 막는지 확인 필요 |
| 사건 추출 LLM 지표 구분 안 됨 | 장면 경계와 장면별 추출이 같은 작업 이름(`generate_event`)이라 비용 지표에서 나뉘지 않는다 |

## 5. 완료

| 날짜 | 작업 | 커밋 |
| --- | --- | --- |
| 2026-11-17 | 첫 방문 브리핑(휴대폰 화면)에 배경지식 표시 — 작품 소개 아래. `GET /info`의 `background` 그대로, 없거나 조회 실패면 그리지 않는다 | (이 커밋) |
| 2026-11-17 | 브리핑 응답에 마지막 읽은 시각(`last_read_at`) 추가 — 브리핑 화면이 `GET /books`를 따로 부르지 않는다. 화면 동작은 같다 | (이 커밋) |
| 2026-11-17 | 홈 이어 읽기 카드의 장 이름 = 이어 읽기 위치의 장 — 기준점 결정기가 `resume_chapter`를 만들고 브리핑 응답에 실어 홈 카드가 쓴다. 서버가 장을 못 찾으면 장 이름만 뺀다 | (이 커밋) |
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
