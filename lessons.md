# lessons.md

## 2026-11-16 — Windows에서 한글이 든 Python 치환 스크립트가 조용히 아무것도 안 바꿈

- 증상: `python - <<EOF`로 소스 파일의 한글 문자열을 `str.replace`했는데 오류 없이 끝났고, `git diff`가 비어 있었다. 이후 분할 결과도 그대로였다.
- 원인: Windows Python이 표준입력 스크립트를 로캘 코드페이지(cp949)로 읽어 한글 패턴이 파일 내용과 일치하지 않았다. `replace`는 일치하지 않아도 예외를 내지 않는다.
- 해결: 스크립트를 파일로 저장해 `PYTHONUTF8=1 python 파일.py`로 실행하고, 치환 전에 `assert 패턴 in 본문`을 둔다. 적용 뒤에는 `git diff --stat`으로 실제 변경을 확인한다. 한두 군데 수정은 Edit 도구가 더 안전하다.

## 2026-11-16 — 관계 검증 결과를 이전 관계 힌트에 넣으면 재실행 때 이후 장 캐시가 전부 낡은 것으로 판정됨

- 증상: 관계에 `semantics.verification`(확인됨·확인 필요·보류)을 붙인 뒤 같은 책을 다시 돌리자 2장부터 `Stale/unverified chapter 2 cache` 오류로 실패했다. 1장은 재생됐다.
- 원인: 장 캐시 키는 `previousRelationshipHints`(앞 장까지의 관계를 `JSON.stringify(semantics)`로 적은 문자열)를 포함한다. 검증 표시가 semantics 안에 있어 반대 검토 결과가 바뀔 때마다 다음 장 캐시 키가 달라졌다.
- 해결: 힌트를 만들 때 `verification`을 뺀다(`hintSemantics`). 수정 뒤 다섯 장을 캐시에서 그대로 재생하고 반대 검토만 새로 불러 다시 끝냈다(장 생성 호출 0회). 테스트: `relationship-semantics.test.ts`의 "다음 장 힌트(캐시 키)는 검증 결과 표시에 따라 바뀌지 않는다".
- 참고: 반대 검토 캐시 키는 입력이 아니라 만든 프롬프트 전체의 해시여야 한다. 프롬프트만 바꿨을 때 옛 답이 재사용되지 않는다.

## 2026-11-16 — 관리자 화면이 "서버에 연결할 수 없습니다"를 띄우며 localhost:3000으로 요청함

- 증상: `VITE_API_URL=http://127.0.0.1:3101`로 띄운 Vite인데 브라우저 요청이 `http://localhost:3000/admin/jobs`로 가서 `ERR_CONNECTION_REFUSED`.
- 원인: 같은 5191 포트에 예전에 띄운 Vite(`--host 127.0.0.1`, 환경변수 없음)가 살아 있었다. 새 Vite는 `::1`에만 붙어서, `127.0.0.1:5191`로 접속하면 옛 서버가 응답했다.
- 해결: `Get-NetTCPConnection -LocalPort <포트> -State Listen`으로 포트 소유 프로세스와 명령줄을 확인하고 옛 서버를 종료한 뒤 다시 접속했다. 업로드가 실제 서버로 들어가는 것을 확인했다. 개발 서버를 띄우기 전에 포트를 먼저 확인한다.

## 2026-11-16 — 휴대폰(와이파이 주소 http)에서 "작품 정보를 불러오지 못했습니다"

- 증상: `http://192.168.x.x:5191`로 열면 작품 페이지가 실패했다. 서버 요청이 하나도 나가지 않았고 localhost에서는 정상이었다.
- 원인: 기기 ID를 `crypto.randomUUID()`로 만들었는데, 이 함수는 https나 localhost 같은 보안 컨텍스트에서만 있다. http LAN 주소에서는 `TypeError: crypto.randomUUID is not a function`이 요청 인터셉터에서 나서 모든 API 호출이 실패했다.
- 해결: `randomUUID`가 없으면 `crypto.getRandomValues`로 v4 UUID를 만든다(`frontend/src/services/api.ts`). 재현 테스트 `ensureDeviceId.test.ts`가 수정 전 실패·수정 후 통과했고, 와이파이 주소로 작품 페이지가 열리는 것을 브라우저로 확인했다.

## 2026-11-16 — 새로 넣은 Tailwind 색 토큰 클래스가 실행 중인 Vite에서 투명으로 나옴

- 증상: `tailwind.config.js`에 `brief.mark` 색을 추가하고 `bg-brief-mark`를 썼는데 브라우저 computed 배경이 `rgba(0, 0, 0, 0)`이었다.
- 원인: 이미 떠 있던 Vite 개발 서버가 옛 Tailwind 설정을 캐시한 채였다(CSS 변수는 정상).
- 해결: Vite를 재시작하자 `rgb(196, 71, 95)`로 적용됐다. 설정 파일을 바꾼 뒤에는 개발 서버를 다시 띄워 확인한다.

## 2026-11-16 — 운영 비밀값 파일 이름이 git 무시 규칙에 걸리지 않음

- 증상: `backend/.env.mystery-prod`를 만들었는데 `git check-ignore`가 아무것도 반환하지 않았다(커밋될 수 있는 상태).
- 원인: `.gitignore`는 `.env`, `.env.local`, `.env.*.local`, `backend/.env`만 무시한다. `.env.<이름>` 형태는 규칙에 없다.
- 해결: 이름을 `.env.mystery-prod.local`로 바꿔 `.env.*.local` 규칙에 맞췄고, `git check-ignore -v`로 무시되는 것을 확인했다. 비밀값 파일은 만들자마자 `git check-ignore -v`로 확인한다.

## 2026-11-16 — Bash 도구 heredoc으로 쓴 Python 정규식에서 백슬래시가 사라짐

- 증상: heredoc(`<<'EOF'`)으로 만든 스크립트의 `[^"\]`가 파일에 `[^"\]`로 저장돼 `re.PatternError: unterminated character set`이 났다. 수집한 239쪽 전부가 파싱 실패로 기록됐다.
- 해결: 정규식이 든 스크립트는 Write 도구로 파일을 만들어 실행하자 정상 파싱됐다(239/239). 백슬래시가 든 코드는 heredoc 대신 파일로 쓴다. 긴 수집은 파서를 캐시 파일 한 개로 먼저 시험한 뒤 돌린다.

## 2026-11-17 — 3D 책이 넘길 때마다 납작해졌다가 두꺼워짐

- 증상: 홈 입체 책 시안에서 책을 넘기는 동안 책등·종이 두께가 사라졌다가 전환이 끝나면 다시 생겼다. 옆 책은 늘 납작했다.
- 원인: `transform-style: preserve-3d`인 책 요소 자체에 `filter: brightness()`와 `opacity`를 걸었다. 이 둘(`none`/1이 아닐 때)은 3D 자식을 평면으로 눌러 버린다. 가운데 책은 전환이 끝나 `filter: none`이 된 뒤에야 입체로 돌아왔다.
- 해결: 어둡게 하기·숨기기를 책 요소에서 빼고, 면(`.f`) 하나하나에 `filter: brightness(var(--b))`, `opacity: var(--o)`로 걸었다. `@property`로 `--b`·`--o`를 등록해 전환되게 했다. `document.getAnimations()`로 전환 중간(120ms)에 멈춰 찍어 보니, 고치기 전에는 책등이 없고 고친 뒤에는 책등과 두께가 보였다.

## 2026-11-20 — 이 컴퓨터(Node 26)에서 화면 시험이 localStorage 오류로 대량 실패

- 증상: `npm test`(vitest)에서 `sessionCheck`·`authService`·관리자 화면 시험 등이 `TypeError: Cannot read properties of undefined (reading 'clear')`로 실패. 기준 커밋에서도 똑같이 실패했다.
- 원인: Node 26은 전역 `localStorage`(Web Storage)를 기본으로 켜서 jsdom 의 `localStorage`를 가린다. 저장 파일 경로가 없어 동작하지 않는 객체가 된다. 프로젝트 기준은 Node 20 이상이라 20·22에서는 드러나지 않는다.
- 해결: `NODE_OPTIONS=--no-experimental-webstorage npm test`로 실행하면 전부 통과했다(1237개). Node 20/22 LTS를 쓰면 옵션이 필요 없다.

## 2026-11-20 — 서버 시험 chatbot·llm-gateway 149건이 이 컴퓨터에서만 실패

- 증상: `backend npm test`에서 chatbot·llm-gateway 20개 묶음 149건 실패(예: 답이 "현재까지 읽은 페이지 기준으로 알 수 없는 내용입니다…"로 나옴).
- 확인: 같은 `.env`로 기준 커밋(4a50b0f)을 별도 worktree에서 돌려도 같은 20개 묶음·같은 149건이 실패했다. 내 변경과 무관한 이 컴퓨터 환경 문제다(원인은 아직 확인 안 함 — `.env`의 MOCK_MODE·LLM 설정이 의심됨).
- 대응: 회귀 판단은 기준 커밋 전체 결과와 실패 묶음 목록을 `diff`로 비교해서 한다.

## 2026-11-20 — Python 으로 파일을 다시 쓰면 줄바꿈이 CRLF 로 바뀜

- 증상: `open(p,'w')`로 다시 쓴 TS 파일이 CRLF 가 되어 `git` 이 "CRLF will be replaced by LF" 경고를 냈다.
- 원인: Windows Python 텍스트 모드는 쓸 때 `
`을 `
`으로 바꾼다.
- 해결: `open(p, encoding='utf-8', newline='')`로 읽고 써서 원래 줄바꿈을 유지한다. 이미 바뀐 파일은 `sed -i 's/$//'`로 되돌렸다(`git diff` 비어 있음 확인).


## 2026-11-20 — 이 컴퓨터(Node 26)에서 vitest 72건 실패, CI(Node 22)에서는 전부 통과

- 증상: `npx vitest run src/components src/guide src/mobile`에서 72건 실패. 오류는 `TypeError: Cannot read properties of undefined (reading 'getItem' / 'clear')`이고 실패 파일은 RequireSession·MobileCommunity·MobileReader 계열(싸비 탭과 무관).
- 원인: 이 컴퓨터는 Node v26이라 테스트 환경에서 `localStorage`가 없다(추정). 같은 커밋을 GitHub Actions(Node 22)에서 돌리면 Lint·Test·Build가 모두 통과했다(Frontend CI 44678182611, 2026-11-20).
- 대응: 로컬 vitest 실패가 `localStorage` 오류뿐이고 내가 건드린 파일이 아니면 CI 결과로 판단한다. 싸비 탭 변경은 `src/components/Ssabi`·`src/guide`로 좁혀 돌린다. 단, 그렇게 좁히면 다른 폴더의 테스트(가이드 6단계 대상 선택자 등)를 놓치므로 변경 후에는 `src/guide`도 같이 돌린다.

## 2026-11-20 — ego-browser로 휴대폰 크기 화면 캡처

- 증상: 휴대폰 크기 설정 뒤에 찍은 캡처가 데스크톱 폭(1057px)으로 나왔다.
- 원인: `Emulation.setDeviceMetricsOverride`는 스크립트 실행(프로세스)마다 다시 걸어야 한다. 이전 실행에서 건 설정은 다음 실행에 남지 않는다.
- 해결: 매 스크립트 첫머리에 `page.cdp("Emulation.setDeviceMetricsOverride", {width:390, height:844, deviceScaleFactor:2, mobile:true})`를 걸고 `Page.captureScreenshot`으로 찍으면 780x1688로 나온다. 이용 가이드(`/guide`)는 비춘 곳 밖의 클릭을 모두 막으므로, 눌러 보려는 요소에 `data-guide-ui` 속성을 붙이면 통과한다.

## 2026-11-20 — 운영 DB 관계 설명 반영 SQL이 `::uuid`에서 실패(전체 롤백), 생성기·Windows 실행 주의

- 증상: `buildExplainSql`이 만든 SQL을 운영 DB에 적용하니 `operator does not exist: text = uuid`로 DO 블록 전체가 실패했다. DO 블록 하나라 전체가 롤백되어 쓰인 행은 0건이었다(조회로 확인).
- 원인: `relationships.id`가 uuid가 아니라 text인데 생성기가 `id = '...'::uuid`로 비교했다.
- 해결: 생성기에서 `::uuid`를 뺐다(`relation-explain.ts`). 같은 SQL을 다시 적용해 14건이 들어간 것을 조회로 확인했다(원문 한 줄이 근거 문단의 부분 문자열 14건, 기존 필드 변경 없음). 적용 전에는 SQL을 `BEGIN/COMMIT` 없이 DO 블록만 한 번에 보내는 편이 안전하다(오류 시 연결이 실패한 트랜잭션에 남지 않는다).
- Windows에서 Claude CLI 작업을 돌릴 때 `spawn claude ENOENT`가 난다. `CLAUDE_CLI_BIN`에 실제 실행 파일(`...\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`)을 넘기면 된다. 이 컴퓨터 `backend/.env`의 `OPENAI_API_KEY`는 무효(401)이고 `MOCK_MODE=true`라서, 생성은 `MOCK_MODE=false`와 Claude CLI 경로로 돌렸다.
- Bash 도구 heredoc 안에 쓴 JS 문자열의 `\s`가 `s`로 바뀌어 정규식이 깨진 적이 있다. 정규식을 파일에 쓸 때는 `String.fromCharCode(92)`로 역슬래시를 만들거나, 문자 클래스(`[ ]`)로 피한다.

## 2026-11-20 — 서버 배포가 lint(prettier) 오류로 막힘

- 증상: main 에 올린 뒤 `Deploy Backend to Fly.io`의 "Lint production sources"가 `prettier/prettier` 오류 19건으로 실패해 Fly 배포가 건너뛰어졌다. 화면(Pages)은 먼저 배포돼 몇 분 동안 새 화면이 옛 서버와 맞지 않았다.
- 원인: 서버 코드는 `tsc`·jest 만 돌리고 `backend npm run lint`(eslint + prettier 규칙)를 로컬에서 돌리지 않았다.
- 해결: `cd backend && npx eslint <바꾼 파일> --fix` 후 `npm run lint` 오류 0건 확인, 다시 올려 배포 성공. 배포 전에는 서버도 `npm run lint`를 돌린다. 화면과 서버 변경이 함께 나갈 때는 서버 배포 실패가 곧 운영 불일치라는 점을 기억한다.

## 2026-11-20 — 휴대폰에서 막대를 톡 누르면 옆 글자(label)로 터치가 옮겨 감

- 증상: 인물관계도 시점 되감기 막대를 직접 그리고 React `onPointerDown`을 달았는데, 끌기는 되지만 막대를 톡 누르면 반응이 없었다. 기록해 보니 pointerdown 대상이 막대가 아니라 위의 `<label for="graph-scrub">`였다.
- 원인: 휴대폰 브라우저의 터치 보정(touch adjustment)은 손가락 근처의 "눌러지는 요소"로 탭을 옮긴다. React 는 이벤트를 루트에서 받으므로 막대 div 자체에는 리스너가 없어 눌러지는 요소로 인식되지 않았고, label 이 이겼다.
- 해결: 막대에 `tabIndex={-1}`을 줘서 터치 대상으로 인식시켰다. Playwright + CDP `Input.dispatchTouchEvent`로 같은 탭이 막대에 닿아 p.3 으로 가는 것을 확인했다.
- 참고: 되감기로 관계도 높이가 바뀌면 막대가 위아래로 움직인다. 터치 확인 스크립트는 누를 때마다 막대 위치를 다시 재야 한다.

