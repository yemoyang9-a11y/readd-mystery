# 인수인계 — 사건 정리 · 관계 설명 칸 · 입체 책 홈 (2026-11-17)

로컬 세션에서 클라우드 세션으로 넘기기 위한 문서다. 이어받는 세션은 이 문서와 계획서만 읽으면 다음 작업을 시작할 수 있다.

## 사용자 요청 (그대로)

- "시안화면대로 코드 작성해서 테스트 후 푸쉬하라는거야" — 시안대로 구현, 테스트, push, PR, 리뷰, 충돌 확인까지.
- "a로 하자" — 추리 노트 안 `내 노트 | 사건 정리` 전환(A안).
- "메인 화면 오른쪽 위 쪽말고 p로 표시" — `이어서 읽기 · 13p`.
- 배포(운영 DB 변경, fly/pages)는 요청받지 않았다. 하지 않는다.

## 기준 문서

- 계획서: [2026-11-16-ssabi-timeline-relationship.md](../plans/2026-11-16-ssabi-timeline-relationship.md) — Global Constraints와 Task 1~7.
- 시안: `docs/superpowers/specs/mockups-2026-11-17/`
  - `readd-relationship-simple.html` — 인물관계도(선 선택, 설명 칸, 곡선)
  - `ssabi-notes-split.html` — A안이 채택안
  - `home-3d-c-v6.html` — 홈 입체 책. 표지 경로 `/files/...`는 `frontend/public/covers/`의 파일이다
  - 시안의 셜록 홈즈·데미안·파친코 표지는 비교용이라 앱에 넣지 않는다
- 프로젝트 규칙: 루트 `CLAUDE.md`(스포일러 게이트, 조항 ID 외 주석 금지), `lessons.md` 2026-11-17 항목(3D 책 상자에 filter/opacity 금지).

## 저장소와 브랜치

- 브랜치 `feat/ssabi-notes-home3d`. 기준은 `feat/mystery-pipeline` = 비공개 저장소 main `d07031b`.
- push 대상은 **`mystery` 원격(github.com/yemoyang9-a11y/readd-mystery, 비공개)뿐**이다. `origin`은 공개 저장소라 push하지 않는다.
- PR은 readd-mystery의 main 대상.

## 진행 상황

| Task | 상태 | 커밋 |
|---|---|---|
| 1 독자용 쉬운 문장 생성·백필 | 완료, 리뷰 통과(수정 1회) | `11ab021`, `aa1dcfc` |
| 2 사건 정리 조회 API | 완료. 클라우드 리뷰 통과(계획 Task 2와 대조, 수정 없음). 백엔드 `tsc` 통과, 전체 jest 112 suites / 1182 passed | `dd9d87d` |
| 3 추리 노트 안 사건 정리 | 완료 (`내 노트 \| 사건 정리`, 기억은 `useReadingSession`이 session_epoch와 함께 보관) | `e1fad73` |
| 4 인물관계도 선 선택·곡선 | 완료 (히트 영역 20px, `#ff5c7d` 3.6px, 흐림 제거, 곡선 회피) | `e2821d2` |
| 5 관계 설명 칸 | 완료 (인물 카드 목록은 설명 칸으로 대체) | `0c902f4` |
| 6 입체 책 홈 | 완료 (`이어서 읽기 · 13p`, 면별 filter/opacity, 책등 색은 `homeShowcase`) | `e25408b` |
| 7 검증·push·PR | 클라우드 몫 완료: 프론트 `tsc` + 전체 vitest 111 files / 895 passed + `npm run build` 통과. 로컬 DB 017 적용·백필 dry-run·playwright 확인·PR·/code-review는 로컬/메인 세션에서 | |

## 다음 할 일

1. Task 2 리뷰: `aa1dcfc..`(WIP 커밋) diff를 계획 Task 2와 대조. 특히 원래 `events.description`이 응답에 없는지, `?cutoff=`를 무시하는지, K=0이면 0건인지, 쿼리 위 `// FR-SPL-002 🚦`.
2. Task 3~6을 계획 순서대로 구현하고 Task마다 리뷰한다.
3. Task 7: 테스트·빌드 → `git push mystery feat/ssabi-notes-home3d` → PR → `/code-review` → `gh pr view --json mergeable,mergeStateStatus`.

## 실행 중 내린 결정 (계획서 보완)

- T4가 `RelationshipTab`에 `selectedEdgeKey` 상태를 추가하고 props로 넘긴다. T5는 그 위에 설명 칸을 만든다.
- T3의 "쪽수 문구 없음" 테스트는 `EventSummary` 안에서만 검사한다(내 노트 카드에는 "7쪽"이 원래 있다).
- T1 백필: dry-run이 결과를 JSON 파일로 저장하고, `--apply --from <file>`이 그 파일을 LLM 호출 없이 그대로 쓴다. 사용자가 본 표와 실제 쓰이는 문장이 같아야 하기 때문이다.
- 싸비 화면 색은 지금 배포된 밝은 테마 토큰을 유지한다(시안의 어두운 색으로 바꾸지 않음).

## 미뤄 둔 사소한 지적 (최종 리뷰에서 판단)

- `rewriteBatch`가 JSON 파싱 3회 실패 시 예외 → 앞서 끝난 배치 결과가 캐시에 안 남는다.
- 테스트 `not.toContain('페이지 본문')`은 실패할 수 없는 검사다. 여러 문장 출력 중 앞 문장이 평서체인 경우 테스트 없음.
- 금지어에 스펙 외 단어(`입력`, `인용`, `요약`, `페이지`)가 있어 정상 문장을 거절할 수 있다.
- `--apply`는 파일 문장을 다시 검증하지 않는다(손으로 고친 파일이면 검사 우회).
- 백필 SQL 가드·롤백 경로 테스트 없음 → Task 7 로컬 dry-run에서 확인.
- 책을 다시 생성하면 `all-resolved.json` 해시가 바뀌어 grounding 가드가 한 번 막는다(운영 절차에 적을 것).
- 017 마이그레이션을 먼저 적용하지 않고 register를 돌리면 사건 INSERT가 실패한다.

## 클라우드 세션에서 못 하는 것 (로컬 필요)

- Task 7의 로컬 DB(Docker `readd-mystery-db`, 127.0.0.1:55433) 017 적용과 `가상범인` 백필 dry-run — DB와 LLM 키가 로컬 `.env`에만 있다. 클라우드에서는 단위 테스트·빌드·PR까지 하고, dry-run 표는 로컬에서 나중에 만든다.
- 운영 반영(017 운영 적용, 백필 `--apply`, fly/pages 배포)은 사용자 확인 뒤 별도.

## 비밀값

이 문서와 커밋에는 비밀값이 없다. `.env*`, `backend/.env.mystery-prod.local`은 git에 없고 클라우드에도 없다.

## 클라우드 세션 기록 (Task 2~6)

- `labelPoint` 필드는 만들지 않았다. 기존 `EdgePath.label`이 이미 곡선 중간점이라 그대로 쓴다.
- 인물 카드 목록을 없앴기 때문에 별칭이 화면 어디에도 나오지 않는다(검색은 별칭으로 계속 된다). 필요하면 설명 칸 제목에 넣을지 결정이 필요하다.
- 인물 카드가 없어져 관련 테스트를 그래프 노드(`role=button`, aria-label=이름) 기준으로 바꿨다. 상한 게이트 테스트는 건드리지 않았다.
- 프론트 `package-lock.json`이 `package.json`과 어긋나 있어(`esbuild@0.28.2` 누락) 클라우드에서 `npm ci`가 실패한다. 이 브랜치에서는 고치지 않았다.
- 시각 확인(playwright, iPhone 15)은 클라우드에서 하지 않았다. 입체 책 두께·전환은 로컬에서 봐야 한다.
