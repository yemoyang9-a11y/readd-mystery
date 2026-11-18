# 사업계획서 8쪽 검증 (2026-11-18)

대상: `src/pages/p08.html` (SOLUTION · 스포일러 차단). 기준: main 8a4b46f의 코드와 문서. 판정 — 맞음 / 고침(옛 문구가 틀리거나 부정확해서 바꿈) / 한계 표시(사실이지만 단서를 붙임).

| 쪽의 주장 | 코드·문서 근거 | 판정 |
| --- | --- | --- |
| 제목 "어느 단계에서도 범인은 말하지 않습니다" | 'AI 도움 단계' 기능은 덱에서 빠짐(대표 지시). 판정·지목 차단은 `harness/output-guard.ts:51-66`, 완독 뒤에도 같은 검사(`chatbot/service.ts:204-206`은 완독 지침만 덧붙임) | 고침 → "AI 친구는 범인을 말하지 않습니다" |
| 자료 고르기: "가장 멀리 읽은 쪽까지" | 기준점 = `read_pages`에서 1쪽부터 끊김 없이 이어진 마지막 쪽 `reading-state/cutoff.service.ts:17-18,91,120,174-179`. 읽음 인정은 '다음' 넘김·1쪽·독자의 "이미 읽었어요" 선택뿐 `progress.service.ts:66-72,117-131`. 가장 먼 쪽(`max_page`)은 확인 카드에만 씀 `cutoff.service.ts:128-134`. 챗봇 K는 서버 스냅샷 `api/routes.ts:237-241` | 고침 → "1쪽부터 차례로 읽은 쪽까지" |
| 자료는 서버가 쪽수 조건으로 꺼냄 | 챗봇 근거 SQL 전부 `<= K`: `chatbot/repository.ts:54,73,92,116,147-154,189-190,216-217,243-244,297`, 조립 `chatbot/context-assembly.ts:19-27`. 노트 `notes/pg-repository.ts:92`, 지금 쪽 본문도 K로 자름 `chatbot/service.ts:95-101`. 리캡 입력 절단 `reading-state/recap-assembly.ts:36-57` | 맞음 |
| 답하는 AI: "받은 자료만 보고 답을 만듦" | 뒤 쪽 자료를 안 받는 것은 맞음(위 SQL). 그러나 모델이 원래 아는 유명작 내용은 막지 못함(CLAUDE.md 9장 A10) | 고침 → "받은 자료로 답을 만듦. 그 뒤 쪽의 자료는 받지 않음" + 주석에 A10 한계 |
| 규칙 검사: "범인 판정·결말 표현이 걸리면 다시 만들고, 또 걸리면 정해 둔 답" | 검사 항목은 기준 쪽 초과 쪽수·출처 없는 인용·판정 표현·원문 200자 초과·암시 `output-guard.ts:6-12,37,181-218`. 재생성 1회 후 고정 답 `service.ts:325-358`, `behavior-ladder.ts:151-157,238-243`. 예측 질문은 모델 없이 고정 답 `behavior-ladder.ts:203-211`, `service.ts:140`. 작품 밖 질문은 재생성 없이 문장 단위로 검사해 위반 문장에서 끊음 `service.ts:359-408`. '결말 표현'을 따로 찾는 규칙은 없음(결말 질문은 질문 분류 `question-intent.ts:13-14,25-32`로 엄격 검사) | 고침 → "판정·암시·뒤 쪽수가 걸리면 다시 만들고, 또 걸리면 정해 둔 답" |
| 먼저 말하지 않는다: "모든 도움은 독자가 묻거나 열 때만" | 챗봇은 독자가 보낼 때만 호출. 추천 질문은 입력칸만 채움 `frontend/src/components/Ssabi/ChatbotTab.tsx:528-540`. 그러나 브리핑 화면은 새 세션마다 리캡을 자동으로 보여 줌(R6, `frontend/src/pages/BriefingView.tsx`) — "모든 도움"은 틀림 | 고침 → "AI 친구는 독자가 물을 때만 답합니다. 추천 질문도 누르면 입력칸만 채웁니다." |
| 대칭으로 반응한다: "어떤 인물·가설에도 같은 방식으로 반응해, 반응만으로 정답을 짐작할 수 없습니다" | 코드에 '대칭' 장치는 없음(grep 0건). 사실인 것: 질문 분류·출력 검사·고정 답에 인물 이름이 없음(`question-intent.ts`, `output-guard.ts`, `messages.ts`), 서버 DB·코드에 범인 자료 없음(정답표 `answer-key.local.json`은 git 제외, 서버가 읽지 않음 — `evaluation/chatbot-harness/README.md:9`). 모델 답의 문장이 인물마다 같은지는 지시·검사 모두 없고 시험한 적 없음 | 고침 → "누구를 물어도 같은 검사" + "AI 답이 같은지는 시험 전" |
| 판정하지 않는다: "가설이 맞는지 말하지 않고 용의자를 지목하지 않습니다" | 유형별 지침 `behavior-ladder.ts:182-202`(프롬프트) + 판정 표현 정규식 `output-guard.ts:51-73` + 단서 중요도·주목 권유 검사 `harness/steering-hint.ts`(금지 행동표 `behavior-ladder.ts:88-140`). 낱말 검사라 뜻으로만 드러나는 경우는 못 잡음(`behavior-ladder.ts:84-86`) | 맞음(단서 짚기 금지 추가) + 주석에 한계 |
| 쪽수로 막는다: "인물·관계·사건마다 처음 나오는 쪽수를 붙여 두고, 그 쪽을 지나야 꺼냄" | 인물 `first_appearance_page <= K` `ssabi/pg-repository.ts:85-90`, 관계 `established_page <= K` + 근거 인용 쪽 ≤ K `ssabi/pg-repository.ts:309-330`, 사건은 **장을 다 읽어야**(`c.end_page <= K`) `ssabi/pg-repository.ts:218-227`, `chatbot/repository.ts:243-244`(결정 31) | 고침 → "인물은 처음 나온 쪽, 관계는 드러난 쪽을 지나야, 사건은 그 장을 다 읽어야" |
| "스포일러 범위는 AI가 아니라 서버가 정합니다" | 기준점 결정기 한 곳 `cutoff.service.ts:118-135`, 클라이언트는 숫자를 보내지 않음 `api/routes.ts:475`, `progress.service.ts:124` | 맞음 |
| "답변 검사는 AI가 아닌 규칙으로" | 검사는 정규식·쪽수·10자 일치 계산뿐 `output-guard.ts`, `steering-hint.ts:6`("LLM을 부르지 않는다"). 챗봇 모듈의 LLM 호출은 답 생성 1곳 `service.ts:273`(+검색용 임베딩 `vector-search.ts:3`). LLM 판정기 없음. 모델 선택도 단일 모델 `difficulty-router.ts:1-9` | 맞음 |
| "읽지 않은 부분의 자료는 검사에도 쓰지 않습니다" (절대 규칙 7) | 검사 입력 = 검색 결과(≤K)·지금 쪽(≤K)·현재 장 원문(장 시작~K)·K 이하 노트 `service.ts:298-315`, 검사 안에서도 다시 `page_no <= cutoff`로 거름 `output-guard.ts:186-188` | 맞음 |
| 누설 시험 "65개 × 두 지점 = 130번, 13건 사람 판정 누설 0건, 117건 미판정" | `attacks.json` 65건(`README.md:3`). 13/117은 `docs/context/tasks.md:27`(T3), `decisions.md:25`. T3: "이번 하네스 변경 뒤 다시 실행해야 한다" — 시험 뒤 원문 200자(11-17)·암시 검사(11-17)·쪽 짚기 규칙(11-17)·말투 검사(11-18)가 추가됨(`git log output-guard.ts`). 새 공격 16건 `attacks-unjudged.json`은 실제 모델로 실행한 적 없음(`README.md:4`) | 숫자는 맞음. "(현재)" 삭제, 재실행 필요·16건 미실행 추가 |

## 덧붙여 찾은 것 (8쪽 문구에는 넣지 않음)

- **공격 시험 실행기가 새 기준점 규칙과 맞지 않는다.** `evaluation/chatbot-harness/run-attacks.ts:92`는 진도를 `{ page: cutoff, seq: 1 }`로만 보낸다. 2026-11-17 규칙에서는 `from_page`나 `claim: 'read_through'` 없이 쪽으로 바로 가면 읽음으로 인정되지 않아(`progress.service.ts:66-72`) 새 기기의 기준점이 0이 된다. 지금 그대로 다시 돌리면 두 지점 모두 K=0으로 시험된다. T3 재실행 전에 실행기가 `claim: 'read_through'`를 보내도록 고쳐야 한다(이 작업 범위 밖이라 고치지 않음).
