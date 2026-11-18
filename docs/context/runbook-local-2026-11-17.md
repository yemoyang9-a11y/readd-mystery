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

## 7. 마이그레이션 이력 — 처음 한 번 baseline (2026-11-18 추가, tasks.md R1)

`scripts/migrate.js`가 바뀌었다. 이제 적용한 파일을 DB의 `schema_migrations` 표에 적어 두고 **다시 실행하지 않는다.** 한 번에 한 실행만 돌고(잠금), 파일 하나가 실패하면 그 파일만 통째로 되돌린다. 예전처럼 매번 전부 실행하면 019가 목차로 건너뛰기만 한 독자의 앞부분까지 "읽음"으로 채워 스포일러가 샐 수 있었다.

운영 DB(Supabase `readd-mystery`)는 이 표가 생기기 전에 001~025가 적용되었다. 그래서 새 실행기는 **이력이 비어 있는데 테이블이 있는 DB에는 아무것도 실행하지 않고 멈춘다.** 대표가 아래 순서로 "여기까지는 이미 적용됨"을 한 번 기록(baseline)해야 한다. 이 명령은 SQL을 실행하지 않고 기록만 한다. 배포나 서버 시작 때 자동으로 돌지 않는다.

1. **DB 백업.** Supabase 대시보드 → Database → Backups에서 최근 백업이 있는지 확인한다(없으면 `pg_dump`로 한 벌 받는다).
2. **접속 주소 확인.** `backend/.env`의 `DB_HOST`·`DB_NAME`이 운영 DB인지 본다. 연결은 직접 연결 또는 Session pooler(포트 5432)를 쓴다. Transaction pooler(포트 6543)는 잠금이 풀리지 않을 수 있어 쓰지 않는다.
3. **정말 025까지 적용되었는지 확인.** Supabase SQL 편집기에서:
   ```sql
   SELECT to_regclass('public.user_consents')        AS m025,  -- 025
          to_regclass('public.community_post_likes') AS m024,  -- 024
          (SELECT count(*) FROM information_schema.columns
            WHERE table_name = 'reading_position' AND column_name = 'read_pages') AS m019;
   ```
   세 값이 모두 비어 있지 않아야(m019는 1) 한다. 하나라도 비면 멈추고 알려 준다 — 그 번호 앞까지만 baseline 해야 한다.
4. **상태 보기 (실행 없음):** `cd backend && node scripts/migrate.js --status` — "적용됨 0개, 남음 22개"가 나온다.
5. **baseline 기록:**
   ```bash
   node scripts/migrate.js --baseline-through 025_signup_consents.sql --confirm-baseline
   ```
   "baseline 22개 기록 (SQL 실행 없음)"이 나오면 된다. 이력이 이미 있으면 거부한다(덧쓰지 않음).
6. **확인:** `node scripts/migrate.js` → "적용 0개, 건너뜀 22개". 이후 새 파일(026~)이 생기면 같은 명령이 새 파일만 적용한다.

로컬 DB처럼 SSL이 없는 곳은 `DB_SSL=false`를 붙인다. 이미 적용된 파일 내용을 고치면 실행기가 "내용이 바뀌었습니다"로 멈춘다. 019는 이번에 고쳐서(아래) baseline 때 고친 뒤의 내용으로 기록된다.

**019 파일도 고침:** read_pages 열을 처음 만들 때만 기존 독자를 1 ~ current_page로 채운다(023과 같은 방식). 처음 적용할 때 결과는 전과 같고, 누가 SQL 편집기에서 019를 다시 실행해도 아무것도 바뀌지 않는다.

**시험 (로컬 PostgreSQL + pgvector 필요, 운영 주소 금지):**
```bash
MIGRATE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/readd_migrate_test \
  npx jest tests/unit/scripts/migrate.test.ts
```

## 8. 타임라인 장 핵심 한 줄 만들기 (2026-11-18 추가, 결정 31·시안 2차 A안)

타임라인의 장마다 보이는 "핵심 한 줄"을 장마다 따로 만든다. 지금은 장 요약의 첫 문장을 대신 보여 준다. 만든 문장이 없거나 거절되면 화면은 지금처럼 요약 첫 문장을 보여 준다.

AI는 장마다 1번 부른다(「가상범인」 5장이면 5번). AI에게는 **그 장 원문만**(장 첫 쪽 ~ 끝 쪽) 준다. 다음 장 글자는 한 자도 들어가지 않는다. 나온 문장은 코드가 검사해서 하나라도 걸리면 쓰지 않고 검수 후보로 남긴다. 검사 항목은 다섯 가지다.

- 한 문장인가
- 60자 이하인가(목표는 50자 안팎)
- "단서·수상한·결정적" 같은 평가하는 말이 없는가
- 그 장에 안 나온 인물 이름이 없는가
- AI가 근거로 댄 원문이 그 장에 실제로 있는가

**순서 (모두 `backend/` 안에서. 7절 baseline을 먼저 마쳐야 한다):**

1. **마이그레이션 026 적용.** 장 요약 표에 빈 칸 두 개(`key_point`, `key_point_review_status`)를 더하기만 한다. 기존 데이터는 바뀌지 않는다.
   ```bash
   node scripts/migrate.js --status     # "남음 1개", "남음: 026_chapter_key_point.sql" 확인
   node scripts/migrate.js              # "적용 1개, 건너뜀 22개"
   ```
2. **책 ID와 원문 파일 확인.** 생성 결과 폴더 `data/generated/<책 ID>/full/all-resolved.json`이 있어야 한다(인물 이름 검사에 쓴다). 업로드한 책이면 Supabase SQL 편집기에서 `SELECT book_id, source_path FROM ingest_jobs;`로 ID와 원문 경로를 본다. 아래 `<책 ID>`·`<원문>`은 예를 들어 `gasangbeomin`·`data/raw/gasangbeomin.txt`다.
3. **생성 (AI 비용 발생).** DB에는 아직 쓰지 않는다.
   ```bash
   npx ts-node --transpile-only src/batch/pipeline/run-generate-key-points.ts --book <책 ID> --file <원문>
   ```
   장마다 `[글자 수] 문장` 또는 "검수 후보(쓰지 않음)"가 찍힌다. 결과는 `data/generated/<책 ID>/full/key-points.json`이다. 걸린 이유는 같은 파일의 `review_candidates`에 있다. 다시 돌리면 저장해 둔 답을 써서 AI를 부르지 않는다. 문장이 마음에 안 들어 다시 만들려면 `chapter-N.key-point.json`을 지우고 돌린다.
4. **DB에 쓰기.** 통과한 문장만 쓴다.
   ```bash
   npx ts-node --transpile-only src/batch/pipeline/run-generate-key-points.ts --book <책 ID> --file <원문> --apply
   ```
   ⚠️ **쓰는 순간 그 책은 공개에서 내려간다**(검수 상태). 검수하지 않은 문장이 독자에게 보이지 않게 하려는 것이다(R12). 5번까지 이어서 한다. 원문이나 장 나눔이 만들 때와 다르면 아무것도 쓰지 않고 멈춘다.
5. **검수 → 다시 공개.** 둘 중 하나로 한다.
   - 관리자 화면 `/admin/books/<책 ID>/review` → "장 핵심 한 줄" 칸에서 장마다 승인 또는 거절한다. 거절하면 그 장은 요약 첫 문장으로 돌아간다. 마지막으로 "최종 승인"을 누른다(업로드로 등록한 책).
   - 명령으로 할 때(명령으로 등록한 책): `run-export-review.ts --book <책 ID>`로 시트를 받는다. `chapter_key_point` 행을 채운 뒤 `run-apply-review.ts --book <책 ID>`, 이어서 `run-publish.ts --book <책 ID>`를 실행한다.
6. **확인.** 앱에서 그 책을 몇 장 읽고 싸비 → 타임라인을 연다. 다 읽은 장에만 새 문장이 보이고, 읽는 중인 장에는 "다 읽으면 정리돼요"만 보이면 된다.
