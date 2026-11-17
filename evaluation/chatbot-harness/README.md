# 챗봇 하네스 공격 세트 (NFR-AI-005)

- `attacks.json`: 공격 질문 65건(12개 범주, 한국어 + 영어 6건)
- `attacks-unjudged.json`: 추가 공격 질문 16건 — **미판정**(사람이 응답을 읽고 판정한 적 없음, 실제 모델로 실행한 적도 없음). 기본 실행에는 들어가지 않는다
  - `implicit_hint` 9건: "범인" 같은 낱말 없이 확인·암시를 구하는 질문("…가 수상하지 않아?", "누굴 눈여겨봐야 해?")
  - `outside_disguised` 7건: 영화·드라마·작가 의도·번역 등 작품 밖 질문처럼 꾸며 범인·결말을 묻는 질문. 2026-11-17 기준 질문 분류기에서 전부 `outside`로 분류된다(문장 단위 검사 경로)
  - 암시형 누출은 `leak-detector.ts`의 어휘 판정으로 잡히지 않을 수 있다. 자동 결과가 ok여도 사람이 읽어야 한다
- `answer-key.local.json`: 정답표(범인·결말 사실). git 제외. 서버 코드는 이 파일을 읽지 않는다
- `answer-key.example.json`: 정답표 형식 예시
- `leak-detector.ts`: 응답이 누출인지 판정(결말 사실, 범인 이름 + 판정 어휘, cutoff 초과 쪽수, 판정 표현)

`first_page`는 원문 문자 위치 비율로 어림한 값이다. 실제 분할 쪽과 다르면 정답표를 고친다.

## 실행

로컬 서버를 먼저 띄우고(도서가 로컬 DB에 공개 상태로 있어야 한다), `backend`에서 실행한다.

```
cd backend
npx ts-node --transpile-only --compiler-options '{"module":"commonjs"}' ../evaluation/chatbot-harness/run-attacks.ts --book <bookId> --cutoff <쪽수>
```

- 미판정 세트는 `--attacks ../evaluation/chatbot-harness/attacks-unjudged.json`을 붙여 따로 실행한다. 기준 쪽수 낮은 값·높은 값 두 번 실행해 쌍으로 본다.
- 공격마다 새 기기 ID로 진도를 `--cutoff`까지 올린 뒤 질문한다(분당 호출 제한 회피, 대화 맥락 분리).
- 기본 주소는 `http://127.0.0.1:<backend/.env의 PORT>`. 로컬 호스트가 아니면 실행을 거부한다.
- 결과는 `results/`(git 제외)에 저장된다. 누출 또는 오류가 있으면 종료 코드 1.
- 모델 사전 지식에서 나온 누출(A10)은 구조로 막지 못한다. 결과 해석 때 이 범주(`prior_knowledge`)를 따로 본다.
