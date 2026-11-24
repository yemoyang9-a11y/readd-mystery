# 인수인계 — AI 원가 재측정 (2026-11-24, 등록 단계 전부 Claude 구독)

새 클라우드 세션이 이 문서 하나로 재측정을 끝까지 할 수 있게 쓴다. 작업 브랜치는 `measure/ai-cost`(main 미병합)다.
측정 결과(토큰·금액·로그·보고서)는 이 저장소에 커밋하지 않는다. 이전 측정 숫자도 여기 적지 않는다(사용자가 프롬프트로 준다).

## 1. 왜 다시 재나

2026-11-24 대표 지시: **API 호출은 챗봇·리캡만, 책 등록(사전 생성) 단계는 전부 Claude 구독(claude CLI)으로.** 커밋 `a052775`.
이전 측정(2026-11-24 오전)은 등록 단계를 Haiku API로 돌렸으므로, 바뀐 코드로 다시 잰다.

| 작업 | 가는 곳 | 비용 계산 |
| --- | --- | --- |
| 챗봇 답변(`chatbot`), 리캡(`recap`) | Anthropic API `claude-haiku-5-5` effort low | 금액 |
| 등록 단계 전부: 장 요약·인물·용어·배경·장면 나누기·사건·요약 근거·독자용 문장·장 핵심·관계 판정·반대 검토·관계 설명 | Claude 구독 CLI(`claude -p`, 모델 별칭 opus) | **0원**. 호출 수·시간·토큰·CLI 정가 환산(`list_cost_usd`)만 기록 |
| 원문·질문 임베딩 | Cohere `embed-v4.0` | 금액 |

라우팅 코드는 `backend/src/modules/llm-gateway/claude-cli-provider.ts`의 `LLM_API_TASKS`(허용 목록)다. 다른 이름은 전부 CLI로 간다.
등록 단계 비용(API)은 이제 임베딩뿐이다. 챗봇 입력 크기는 등록 때 만든 요약·인물·사건의 양에 따라 달라지므로 **기능 비용도 다시 잰다.**

## 2. 절대 규칙

- 운영 DB·운영 배포(Supabase 운영, Fly.io, Cloudflare, ssabi-api.fly.dev, ssabi-d4c.pages.dev)에 접속하지 않는다. DB는 컨테이너 안 로컬 PostgreSQL만.
- API 키 값을 출력·로그·파일·커밋에 남기지 않는다. `env`·`printenv` 전체 출력 금지. `.env` 파일을 만들지 않는다.
- 측정 결과는 저장소 밖 결과 폴더(`MEASURE_DIR`, scratchpad 아래)에만 쓴다. 저장소에는 측정용 스크립트·설정·문서 변경만 커밋한다. `measurements/`, `backend/data/generated/`, `evaluation/chatbot-harness/results/`는 git 제외다.
- `measure/ai-cost` 브랜치에만 커밋·push한다. main 병합·main push 금지.
- `src/`·`migrations/`를 고치지 않는다. 측정을 막는 버그를 찾으면 고치기 전에 사용자에게 알린다(이전 측정에서는 끊긴 스트림 미기록을 게이트웨이에서 고쳤다, `36f3261`).
- 숫자를 지어내지 않는다. 못 잰 것은 "측정 못 함 + 이유", 추정은 "추정"이라고 쓴다.
- 챗봇 출력 검사·기준점(cutoff) 로직을 건드리지 않는다(CLAUDE.md 2장).

## 3. 환경 준비

```
cd /home/user/readd-mystery && git checkout measure/ai-cost && git pull --ff-only
bash backend/scripts/measure/setup-local-db.sh        # PostgreSQL 16 + pgvector 설치·기동, readd_measure DB, npm ci, 마이그레이션 25개
claude auth status                                     # loggedIn true 여야 한다(이 세션의 사용자 계정 구독). CLI 호출은 하지 않는다
```

- 세션에는 키가 `READD_ANTHROPIC_API_KEY`·`COHERE_API_KEY` 이름으로 있다. `measure-env.sh`가 `ANTHROPIC_API_KEY`로 넘긴다(값 출력 없음).
- 결과 폴더: `export MEASURE_DIR=<scratchpad>/measure` 후 `source backend/scripts/measure/measure-env.sh`. 단계마다 `export LLM_METRICS_FILE=$MEASURE_DIR/<책 또는 features>/metrics.log`.
- 키 확인(최소 호출 각 1회, 키 값 출력 없음): `cd backend && node scripts/measure/check-keys.js`
- 단가 확인: Anthropic 가격 페이지 https://platform.claude.com/docs/en/about-claude/pricing (Haiku 5.5, Opus 5.5 — CLI 환산 대조용), Cohere 공식 페이지(이전에는 Embed 4 가격을 공식 페이지에서 찾지 못해 집계 사이트 값 $0.12를 추정으로 썼다), 환율(출처·날짜). 바뀌었으면 `backend/scripts/measure/aggregate-cost.js`의 `PRICES` 한 곳만 고친다.

## 4. 측정 순서

### A. 등록 (책마다, `MEASURE_DIR/<bookId>/`)

시작 전에 `backend/data/generated/<bookId>`가 없어야 한다(있으면 캐시로 호출이 건너뛰어진다). 책 메타는 `KNOWN_BOOK_META`에 없으므로 직접 준다.

| 책 | bookId | 원문 | 메타 |
| --- | --- | --- | --- |
| 「가상범인」 | `gasangbeomin` | `backend/data/raw/gasangbeomin.txt` (5장·68쪽·65,091자) | 가상범인 / 김내성 / 1937 |
| 「마인」 | `main` | `backend/data/raw/main.txt` (29장·304쪽·291,826자) | 마인 / 김내성 / 1939 |

```
cd /home/user/readd-mystery/backend
# 1) 업로드 작업 6단계(관리자 업로드와 같은 경로). 끊겨도 같은 명령으로 이어 간다(같은 job 행, 장 캐시)
LLM_METRICS_FILE=$MEASURE_DIR/gasangbeomin/metrics.log TIMELINE_FILE=$MEASURE_DIR/gasangbeomin/timeline.txt \
  BOOK_ID=gasangbeomin TITLE=가상범인 AUTHOR=김내성 YEAR=1937 SOURCE=data/raw/gasangbeomin.txt \
  npx ts-node --transpile-only scripts/measure/run-ingest-measure.ts
# 2) 장 핵심 한 문장 — 생성 뒤 로컬 DB에 적용(--apply 하면 책이 검수 상태로 내려간다)
npx ts-node --transpile-only src/batch/pipeline/run-generate-key-points.ts --book gasangbeomin --file data/raw/gasangbeomin.txt
npx ts-node --transpile-only src/batch/pipeline/run-generate-key-points.ts --book gasangbeomin --file data/raw/gasangbeomin.txt --apply
# 3) 관계 설명문 — 로컬 DB에서 입력을 뽑아 생성, SQL은 로컬 DB에만
node scripts/measure/build-explain-rows.js gasangbeomin $MEASURE_DIR/gasangbeomin/explain-rows.json $MEASURE_DIR/gasangbeomin/explain-characters.json
npx ts-node --transpile-only scripts/backfill-relation-explain.ts --rows $MEASURE_DIR/gasangbeomin/explain-rows.json --book gasangbeomin \
  --out $MEASURE_DIR/gasangbeomin/explain-result.json --characters $MEASURE_DIR/gasangbeomin/explain-characters.json
npx ts-node --transpile-only scripts/backfill-relation-explain.ts --book gasangbeomin --from $MEASURE_DIR/gasangbeomin/explain-result.json --sql $MEASURE_DIR/gasangbeomin/explain-apply.sql
psql -h /tmp -U postgres -d readd_measure -v ON_ERROR_STOP=1 -f $MEASURE_DIR/gasangbeomin/explain-apply.sql
# 4) 로컬 공개(사람 검수 아님 — 보고서에 그렇게 쓴다). 로컬 측정 DB가 아니면 스크립트가 거부한다
BOOK_ID=gasangbeomin npx ts-node --transpile-only scripts/measure/approve-local.ts
# 5) 집계
node scripts/measure/aggregate-cost.js $MEASURE_DIR/gasangbeomin/metrics.log --json $MEASURE_DIR/gasangbeomin/cost.json
```

- 「마인」은 bookId·파일·메타만 바꿔 같은 순서. 업로드 작업이 길다(이전에는 관계 추출만 CLI로 약 33분, 이제 등록 단계 전부가 CLI라 몇 시간 걸릴 수 있다 — 추정). 10분 넘는 명령은 백그라운드로 돌리고 끝날 때까지 기다린다.
- 확인할 것: 등록 구간 metrics에 `provider: "anthropic"` 줄이 **0줄**이어야 한다(등록이 API를 부르지 않았다는 증거). 임베딩 `[Embed Metrics]` 줄만 금액이 붙는다.
- 쪽 임베딩 개수(`embedding IS NOT NULL`)가 68/304인지, `books` 상태가 `published`·`ssabi_ready=t`인지 확인한다.
- CLI가 구독 사용 한도(rate/usage limit)로 막히면 반복하지 말고 몇 장까지 됐는지와 메시지를 적고 사용자에게 알린다.

### B. 기능 (`MEASURE_DIR/features/`)

```
nohup bash backend/scripts/measure/start-server.sh >/dev/null 2>&1 &     # 127.0.0.1:3100, 업로드 작업 이어 달리기 끔
curl -s http://127.0.0.1:3100/health; grep -c "resumeIngestJobs 건너뜀" $MEASURE_DIR/features/server.log   # 1 이상이어야 요청을 보낸다
cd backend; D="npx ts-node --transpile-only scripts/measure/run-feature-cost.ts"; F=$MEASURE_DIR/features
$D --mode normal --questions scripts/measure/questions-normal.json --only $(seq -f N%02g 1 15 | paste -sd,) --out $F/normal-gasangbeomin.jsonl
$D --mode attacks --attacks ../evaluation/chatbot-harness/attacks.json --book gasangbeomin --cutoff 20 --out $F/attacks-20.jsonl
$D --mode attacks --attacks ../evaluation/chatbot-harness/attacks.json --book gasangbeomin --cutoff 68 --out $F/attacks-68.jsonl
$D --mode recap --targets gasangbeomin:20,gasangbeomin:40,gasangbeomin:68 --out $F/recap-gasangbeomin.jsonl
$D --mode normal --questions scripts/measure/questions-normal.json --only $(seq -f N%02g 16 30 | paste -sd,) --out $F/normal-main.jsonl
$D --mode recap --targets main:60,main:160,main:304 --out $F/recap-main.jsonl
node scripts/measure/attribute-feature-cost.js --jsonl $F/normal-gasangbeomin.jsonl --jsonl $F/attacks-20.jsonl --jsonl $F/attacks-68.jsonl --jsonl $F/recap-gasangbeomin.jsonl --jsonl $F/normal-main.jsonl --jsonl $F/recap-main.jsonl --metrics $F/metrics.log --server-log $F/server.log --json $F/feature-cost.json --csv $F/feature-cost.csv
bash scripts/measure/stop-server.sh
```

- 「가상범인」 기능은 「마인」 등록이 도는 동안 해도 된다(이어 달리기를 끈 서버라 겹치지 않는다). **`src/index.ts`를 직접 띄우지 않는다** — 기동 시 running 업로드 작업을 이어 돌려 같은 책을 이중 생성한다(이전 측정에서 실제로 1회 발생).
- 질문은 요청마다 새 기기로 `claim: read_through` 기준점을 올린 뒤 하나씩 보낸다. 오류가 나면 `--skip-done`으로 이어 간다.
- 질문 30개는 `backend/scripts/measure/questions-normal.json`(「가상범인」 15·40·68쪽, 「마인」 60·160·304쪽에 5개씩, 범인·결말 질문 없음).
- 누설 판정은 하지 않는다. 정답표 `evaluation/chatbot-harness/answer-key.local.json`이 저장소에 없다 → "정답표 없음 — 판정 못 함". 정답표를 지어내지 않는다. 응답에서 기준 쪽을 넘는 쪽 번호가 나온 건수만 기계로 센다(참고).
- 세션 종료(스위퍼) 리캡은 30분 무조작이 필요해 재지 않는다. 같은 `getRecap` 경로라 실행 중 리캡 값으로 본다(추정).

### C. 청구 대조

측정 시작·종료 UTC, 제공자별(Anthropic·Cohere) 기록 구간·호출 수·토큰·예상 청구액, CLI 호출 수·정가 환산(청구 없음)을 정리한다. 사용량 화면이 UTC 날짜별이면 걸친 날을 더해 보라고 적는다.

## 5. 기록과 집계

- 게이트웨이가 모든 호출을 `LLM_METRICS_FILE`에 한 줄 JSON으로 남긴다: `task, attempt(1=첫 호출), provider, modelId, inputTokens, outputTokens, cacheWrite/ReadTokens, thinkingTokens, stopReason, durationMs`. CLI 줄은 `uncachedInputTokens, cacheRead/WriteTokens, cliDurationMs, attempts(CLI 내부 재시도), list_cost_usd`. 끊긴 스트림은 `aborted: true`(입력만 실측, 출력 없음).
- `aggregate-cost.js`: 단계별 호출(끊김)·재시도·토큰·금액(원), 1회 통과(attempt=1)와 재생성 포함을 나눈다. CLI 줄은 금액 없이 "구독"으로 표시하고 `cliListUsd`를 모은다.
- `attribute-feature-cost.js`: 질문별 시간 창에 metrics 줄을 붙여 질문당 금액, 끊긴 호출 하한·추정, 고정 답변·검사 종류, 서버 Query log 모델호출수와 metrics 불일치 수를 낸다. 불일치·창 밖 줄이 0이어야 한다.
- 재시도 이유는 로그 `[JSON 재시도] task=... 시도=N`, `stopReason=max_tokens`, CLI `attempts>1`, Cohere `Retrying after`로 확인한다.

## 6. 이전 측정에서 배운 함정

| 함정 | 대응 |
| --- | --- |
| 서버를 띄우면 running 업로드 작업을 이어 돌린다 | `start-server.sh`(`serve-no-resume.ts`)만 쓴다 |
| 출력 검사가 막은 챗봇 응답은 스트림이 끊겨 기록이 없었다 | `36f3261`에서 고침. `aborted` 줄을 센다 |
| 컨테이너가 재시작돼 프로세스가 죽는다 | 같은 명령으로 이어 간다(장 캐시·같은 job 행). 재시작 시각과 "기록 없는 중단 호출 가능성"을 timeline에 적는다. PostgreSQL은 `setup-local-db.sh`로 다시 켠다 |
| `max_tokens`로 잘림 | 이전 측정에서 인물·별칭 단계(16,000)와 챗봇 긴 정리 질문(4,096)이 잘렸다. 상한은 고치지 않고 건수만 적는다 |
| Haiku 긴 프롬프트 단가(요청당 10만 토큰 초과 시 5배) | 챗봇 입력이 읽은 쪽에 비례해 커진다. 넘은 호출 수(`longPromptCalls`)를 적는다 |
| 예전 장 캐시 재사용 | 생성기 계약이 바뀌어 예전 API 캐시는 낡은 캐시로 멈춘다. 새 세션은 캐시가 없으니 해당 없음 |
| Cohere 단가 미확인 | 공식 페이지 확인을 다시 시도하고, 못 찾으면 추정으로 둔다 |

## 7. 보고서 (마크다운 파일로 사용자에게, 커밋하지 않음)

1. 한 줄 결론: 권당 등록 API 비용(두 책), 질문당 비용(보통·누설), 리캡 1회 비용
2. 손익표 칸(권당 사전 생성 270원 / 질문당 0.83원 / 권당 리캡 17원)과의 대응
3. 단계별 상세 표(A·B), 재시도 횟수와 이유
4. 구독(CLI) 사용 기록: 단계별 호출 수·걸린 시간·토큰·CLI 정가 환산, 책별 등록 벽시계 시간, 사용 한도에 걸렸는지
5. 이전 측정(사용자가 프롬프트로 준 숫자)과의 비교 — 특히 챗봇 입력 토큰이 등록 모델 변경으로 달라졌는지
6. 단가·환율 출처와 날짜, 청구 대조 구간
7. 측정하지 못한 것과 이유, 결과에 영향을 주는 가정
8. 브랜치에 커밋한 변경 목록

## 8. 검토 에이전트

작업은 메인 세션(Opus 5.5)이 직접 한다. 검토는 Sonnet 5.5, effort medium 서브에이전트(읽기 전용, 파일 수정·API 호출 금지)에 맡긴다. 검토 시점과 볼 것:

| 시점 | 검토 내용 |
| --- | --- |
| 환경 준비 뒤 | 라우팅이 허용 목록대로인지(코드·시험), 키가 파일·로그에 없는지, 결과 폴더가 저장소 밖인지 |
| 책마다 등록 뒤 | metrics 원 기록으로 집계를 다시 내 보고 숫자와 대조, 등록 구간 `provider: anthropic` 0줄, 단계별 호출 수가 파이프라인 로그와 맞는지, 재시도 이유 |
| 기능 측정 뒤 | 질문별 귀속 다시 계산, 불일치·창 밖 줄 0건, 평균·최소·최대 |
| 최종 보고서 전 | 보고서의 모든 숫자가 원 기록 파일로 거슬러 올라가는지, "추정" 표시 누락, 커밋에 결과·키가 없는지 |

검토 에이전트가 찾은 불일치는 메인 세션이 원 기록으로 확인해 고치고, 고친 내용을 보고서에 적는다.
