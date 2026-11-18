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

## 6. 논문 기반 인물 관계 추출 실측 (2026-11-18 추가, tasks.md T12)

새 방식은 코드가 두 인물이 원문에서 함께 드러난 곳만 후보로 만들고, AI는 그 근거 조각에만 관계 이름을 붙인다. 설명: [research-2026-11-18-relationship-extraction.md](research-2026-11-18-relationship-extraction.md). DB에는 쓰지 않는다.

인물·별칭은 기존 전체 생성 결과(`data/generated/gasangbeomin/full/all-resolved.json`)를 쓴다. 이 파일이 없으면 먼저 전체 생성을 한 번 돌린다(비용 큼, 이미 있으면 건너뜀):

```bash
npx ts-node --transpile-only src/batch/pipeline/run-generate-full.ts --book gasangbeomin --file data/raw/gasangbeomin.txt --title 가상범인 --author 김내성
```

① AI 호출 없이 후보와 기존 관계 비교 (무료):

```bash
npx ts-node --transpile-only src/batch/pipeline/run-generate-relationships-structural.ts --book gasangbeomin --file data/raw/gasangbeomin.txt --candidates-only --out data/generated/gasangbeomin/structural-candidates
```

`comparison-with-existing.json`의 `no_structural_evidence`(기존 관계 중 두 인물이 한 번도 함께 나오지 않은 행)와 `established_before_first_cooccurrence`(확립 쪽이 첫 동시 등장보다 이른 행 = 스포일러 위험)를 본다.

② 실제 라벨 (후보가 있는 장마다 AI 2회 + 관계마다 검토 1회):

```bash
npx ts-node --transpile-only src/batch/pipeline/run-generate-relationships-structural.ts --book gasangbeomin --file data/raw/gasangbeomin.txt --verifier
```

결과는 `data/generated/gasangbeomin/structural-relationships/`의 `structural-relationships.json`(채택·보류 사유·근거 창), `all-resolved.structural.json`(관계만 바꾼 검수용 산출물). 다시 돌리면 캐시를 재생해 AI를 부르지 않는다. 프롬프트·모델을 바꿨다면 `--out`으로 새 폴더를 준다.

③ 정답이 있는 발췌 5건으로 정확도 (탁류 2쪽, Austen 3발췌):

```bash
for f in takryu-p91 takryu-p129 austen-jealousy austen-negated-envy austen-belief-attribution; do
  npx ts-node --transpile-only src/batch/pipeline/run-generate-relationships-structural.ts --input ../evaluation/relationships/model-inputs/$f.json --out data/generated/structural/$f --verifier
done
node ../evaluation/relationships/check-structural-metrics.cjs data/generated/structural/*/structural-relationships.json --out data/generated/structural/metrics.json
```

`early_established`가 0이어야 한다(정답보다 이르게 잡힌 관계 = 스포일러). 정밀도·재현율과 보류 목록(`held`)을 tasks.md T12에 적는다. 교체·공개는 기존 검수 절차(`docs/relationship-pipeline.md`)를 따른다.
