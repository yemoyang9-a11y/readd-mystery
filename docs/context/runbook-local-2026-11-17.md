# 대표 컴퓨터에서 할 일 — 실측과 배포 (2026-11-17)

2026-11-17 세션에서 코드 작업은 모두 main에 들어갔다. 남은 두 가지는 대표가 보류한 것이다(결정 기록 "동기화 대기" 참고). 이 문서는 그 두 가지를 할 때 순서대로 따라 하는 안내다. 결과는 [tasks.md](tasks.md)의 해당 항목에 적는다.

모든 명령은 저장소 최신 main에서, `backend/` 폴더 안에서 실행한다. `backend/.env`에 OpenAI 키와 로컬(또는 운영) DB 주소가 있어야 한다. **실제 AI 호출은 비용이 든다.** 운영 DB(Supabase `readd-mystery`)를 가리키고 있는지 먼저 확인한다.

```bash
git pull origin main
cd backend && npm ci
```

## 1. 장면 단위 사건 추출 비용 (T9)

1장 하나만 생성해 장면 수·검수 후보 수·창별 입력 글자 수를 본다. 기본 방식(`full`)과 줄인 방식(`recent:2`)을 각각 한 번씩 돌린다.

```bash
npx ts-node --transpile-only src/batch/pipeline/run-generate-sample.ts --chapter 1 --scene-window full
npx ts-node --transpile-only src/batch/pipeline/run-generate-sample.ts --chapter 1 --scene-window recent:2
```

출력의 `[사건 입력]` 줄에 방식별 입력 글자 수가 나온다. 두 결과의 사건 목록이 비슷하고 `recent:2`가 훨씬 싸면 기본값을 바꿀지 정한다(T9).

## 2. 리캡 길이·이름 검사 (T10, 리캡 이름 검사)

로컬 서버를 띄워 브리핑 화면을 여러 쪽수에서 몇 번 열어 리캡을 만든 뒤, DB에서 아래를 본다.

```sql
-- 목표 문장 수 대비 실제 길이 (tasks.md 부록 쿼리와 같음)
SELECT target_sentences AS n, count(*) AS calls,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY output_chars) AS p50_chars,
       round(100.0 * avg((output_sentences = target_sentences)::int), 1) AS pct_exact_n
FROM recap_call_log WHERE target_sentences IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- 이름 검사에 걸린 것 — 실제 인물 이름인지, 일반 낱말 오탐인지 눈으로 본다
SELECT created_at, unknown_name_count, unknown_names
FROM recap_call_log WHERE unknown_name_count > 0 ORDER BY created_at DESC LIMIT 50;
```

오탐이 대부분이면 "기록만" 유지, 실제로 읽지 않은 인물 이름이 나오면 리캡을 막을지 정한다.

## 3. 챗봇 공격 질문 (T3)

로컬 서버를 띄운 뒤 같은 질문을 낮은 기준 쪽수·높은 기준 쪽수로 두 번 돌린다(쌍으로 본다).

```bash
npx ts-node --transpile-only --compiler-options '{"module":"commonjs"}' ../evaluation/chatbot-harness/run-attacks.ts --book bk-95898cdf13 --cutoff 13
npx ts-node --transpile-only --compiler-options '{"module":"commonjs"}' ../evaluation/chatbot-harness/run-attacks.ts --book bk-95898cdf13 --cutoff 68
# 새 16건(미판정)
npx ts-node --transpile-only --compiler-options '{"module":"commonjs"}' ../evaluation/chatbot-harness/run-attacks.ts --book bk-95898cdf13 --cutoff 13 --attacks ../evaluation/chatbot-harness/attacks-unjudged.json
```

자동 검사기가 표시한 누출은 1차 결과일 뿐이다. 답을 사람이 읽고 "범인·결말 암시가 있었는가"를 판정해야 한다. 자세한 방법은 `evaluation/chatbot-harness/README.md`.

## 4. 검색 구성 비교 (검색 결과 6쪽)

지금은 "검색 상위 4쪽 + 앞뒤 쪽 2쪽"이다. 3번의 공격 질문 결과와 평소 질문 10개 정도의 답을 보고, 앞뒤 쪽이 현재 장 원문과 겹쳐 자리만 차지하는지 본다. 바꿀 값은 `backend/src/modules/chatbot/vector-search.ts`의 `SEARCH_CONFIG`(`topN: 6` 전체, `seedLimit: 4` 검색 몫)다.

## 5. 배포 (2026-11-18 바뀜 — GitHub Pages)

화면은 GitHub Pages, 서버는 Fly.io 로 GitHub Actions 가 자동 배포한다. 처음 한 번만:

1. GitHub 저장소 → Settings → General 맨 아래 Danger Zone → **Change visibility → Public**
2. Settings → **Pages** → Build and deployment → Source: **GitHub Actions**
3. Settings → Secrets and variables → Actions → **Secrets** → `FLY_API_TOKEN` (fly.io → 앱 ssabi-api → Tokens → Create deploy token)
4. fly.io → 앱 ssabi-api → **Secrets**: `CORS_ORIGIN` 에 `https://yemoyang9-a11y.github.io` 추가(쉼표로 여러 개 가능), `DATABASE_URL` 이 피벗 후 DB(`rntzmaarbtzjgzknqfve`)인지 확인
5. Actions 탭 → "Deploy Frontend to GitHub Pages" → **Run workflow** (처음 한 번 수동 실행). 이후는 main 의 화면 변경 때마다 자동

화면 주소: https://yemoyang9-a11y.github.io/readd-mystery/

로그인(구글·카카오)을 쓰면 각 개발자 콘솔의 허용 주소에도 새 주소를 넣어야 한다.
