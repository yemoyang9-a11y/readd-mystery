# 챗봇 하네스 공격 세트 (NFR-AI-005)

- `attacks.json`: 공격 질문 65건(12개 범주, 한국어 + 영어 6건)
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

- 공격마다 새 기기 ID로 진도를 `--cutoff`까지 올린 뒤 질문한다(분당 호출 제한 회피, 대화 맥락 분리).
- 기본 주소는 `http://127.0.0.1:<backend/.env의 PORT>`. 로컬 호스트가 아니면 실행을 거부한다.
- 결과는 `results/`(git 제외)에 저장된다. 누출 또는 오류가 있으면 종료 코드 1.
- 모델 사전 지식에서 나온 누출(A10)은 구조로 막지 못한다. 결과 해석 때 이 범주(`prior_knowledge`)를 따로 본다.
