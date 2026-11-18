# 새 화면 참고 서비스 조사 — 로그인·첫 안내·완독·커뮤니티 (2026-11-18)

대표 지시(2026-11-18): "새로운 창 화면 만들 때도 미스터리 브랜딩 디자인으로 입혀. 그리고 어떤 새로운 창이나 기능을 새로 만들 때 다른 플랫폼들과 레퍼런스 사이트를 조사해서 화면 제작해." DESIGN.md Do's의 2026-11-18 두 규칙을 따른 조사 기록이다.

## 0. 조사 방법과 한계

- 웹 검색 결과(제목·요약)와, 열 수 있었던 공식 문서 원문(Apple HIG Onboarding)을 근거로 했다.
- **화면 이미지를 직접 본 서비스는 없다.** 이 세션은 앱 설치·로그인이 불가능하고, Mobbin·pageflows는 로그인 벽이 있으며, `nngroup.com` 등 일부 사이트는 세션 네트워크에서 열리지 않았다. 그래서 아래 "무엇을 하나"는 대부분 **2차 자료**(리뷰 기사, 사용자 글, 앱스토어 설명, 검색 요약)에 기댄다. 2차 자료만 본 항목은 표에 `2차`로 표시했다.
- 2차 자료는 날짜가 오래된 것(2013~2023)이 섞여 있다. 현재 앱 화면과 다를 수 있다.

## 1. 로그인·회원가입 (`frontend/src/pages/Login.tsx`)

| 서비스 | 무엇을 하나 | 근거 |
| --- | --- | --- |
| 밀리의서재 | 가입 중 선택 항목을 바텀 시트로 받아 터치 면적을 넓히고, 입력 포커스가 다음 칸으로 빠르게 넘어간다 | [요즘IT 분석](https://yozm.wishket.com/magazine/detail/1162) `2차` |
| 리디 | 앱스토어 설명에는 로그인 화면 설명이 없다. 간편 로그인 구성은 확인하지 못했다 | [앱스토어](https://apps.apple.com/kr/app/%EB%A6%AC%EB%94%94%EB%B6%81%EC%8A%A4-%EC%A0%84%EC%9E%90%EC%B1%85-ridibooks-ebook/id338813698) `2차, 확인 못 함` |
| Goodreads | "Continue with Amazon / Apple / Sign up with email" — 외부 계정 버튼을 위에, 이메일을 마지막 선택지로 둔다 | [Business Insider](https://www.businessinsider.in/tech/how-to/how-to-log-in-to-goodreads-on-desktop-or-mobile-so-you-can-catalog-your-reading-list-online/articleshow/82110994.cms), [iClarified 2013](https://www.iclarified.com/36510/goodreads-app-gets-revamped-sign-inup-screens-other-improvements) `2차` |
| StoryGraph | 가입은 이메일·사용자 이름·비밀번호 셋만 받고, 취향 설문·가져오기는 그 뒤에 건너뛸 수 있게 둔다 | [TCK Publishing](https://www.tckpublishing.com/storygraph-review/), [개발자 뉴스레터](https://buttondown.com/nodunayo/archive/144-an-excellent-onboarding) `2차` |
| Duolingo | 가입을 뒤로 미뤄(먼저 써 보게) 일간 이용자가 약 20% 늘었다는 성장팀 인터뷰 | [First Round Review](https://review.firstround.com/the-tenets-of-a-b-testing-from-duolingos-master-growth-hacker/) `2차` |
| Apple HIG | "Delay sign-in as long as possible", 필요 없는 정보를 묻지 말 것 | [Sign in with Apple](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple), [Managing accounts](https://developer-mdn.apple.com/design/human-interface-guidelines/patterns/managing-accounts) |

**가져온 것**
- 로그인·회원가입을 한 화면의 두 탭으로 두고, 가입 칸은 셋(이메일·비밀번호·닉네임)만 — StoryGraph처럼 최소 입력. 이미 그렇게 만들어져 있어 구조는 그대로 둔다.
- 오류는 입력 바로 아래 한 줄, 원인별 문구(이미 있음).
- 외부 계정 버튼은 테두리형으로 낮게 두고 이메일 폼을 주 동작으로(서버가 켠 방식만 보인다).

**버린 것**
- Duolingo식 "가입 미루기": 대표 지시가 "처음 접속하면 로그인·회원가입 창"이고, 구독형 유료 출시(결정 30)라 계정이 먼저 필요하다. 다만 첫 안내(가이드)는 가입 직후 데모 책으로 바로 써 보게 해 같은 효과(먼저 해 보기)를 낸다.
- 밀리의서재식 바텀 시트 선택 항목: 우리 가입은 고를 항목이 없다.
- Goodreads식 외부 계정 우선 배치: 지금 서버 기본값은 이메일뿐이다.

## 2. 첫 이용 안내 (`frontend/src/guide/`)

| 참고 | 무엇을 하나 | 근거 |
| --- | --- | --- |
| Apple HIG Onboarding | "Teach through interactivity" — 직접 해 보게, 짧고 건너뛸 수 있게, 건너뛰면 다시 띄우지 말 것 | [원문](https://developer.apple.com/design/human-interface-guidelines/onboarding) (직접 읽음) |
| Material Design (Feature discovery) | 한 요소에 시선을 모으는 원형 탭 표적 + 둘레의 다른 배경색 | [Material 1 growth & communications](https://m1.material.io/growth-communications/onboarding.html), [TapTargetView](https://sourceforge.net/projects/taptargetview.mirror/) `2차` |
| NN/g | 카드 넘기기 튜토리얼은 본 사람과 건너뛴 사람의 과제 성공률 차이가 거의 없고(91% 대 94%) 오히려 어렵게 느꼈다. 코치 마크·오버레이도 같은 경향 | [Mobile tutorials](https://www.nngroup.com/articles/mobile-tutorials/) `2차 — 사이트가 이 세션에서 열리지 않아 검색 요약만 봄` |
| Adobe Spectrum Coach mark | 한 번에 한 요점, 단계 표시, 건너뛰기 | [Spectrum](https://spectrum.adobe.com/page/coach-mark) `2차` |
| Duolingo | 마스코트가 말을 걸며 첫 레슨을 바로 시작 | [Appcues GoodUX](https://goodux.appcues.com/blog/duolingo-user-onboarding) `2차` |
| Return of the Obra Dinn | 진행을 기록하는 항해일지(로그북)가 유일한 안내자. 튜토리얼이 부족하다는 비판도 있다 | [Wikipedia](https://en.wikipedia.org/wiki/Return_of_the_Obra_Dinn), [Game Wisdom](https://game-wisdom.com/analysis/return-obra-dinn) `2차` |

**가져온 것**
- 실제 화면을 직접 눌러 보는 구조(이미 있음 — HIG "interactivity")와 한 단계 한 동작, 항상 보이는 건너뛰기, 단계 수 표시.
- 비춘 곳 둘레의 표시를 흰 테두리에서 버건디 계열 링으로 — Material의 "표적 둘레 다른 색"을 미스터리 톤으로. 어둡게 덮는 막은 브랜드 검정(`#0d0a0b`) 계열로 더 깊게.
- 말풍선은 아모가 수첩에 적어 주는 쪽지처럼: 어두운 카드 + 아모 글꼴 + 타자기(DM Mono) 단계 번호.
- 마지막 카드는 Obra Dinn 로그북처럼 "기록"의 느낌 — 사건 파일 머리표 + 작은 도장 한 개.

**버린 것**
- 카드 넘기기식 앞 설명(NN/g 근거).
- 회색 부연 설명 문구(DESIGN.md 금지).
- 게임식 효과음·보상 애니메이션(Duolingo): 차분한 에디토리얼 톤과 맞지 않다.

## 3. 완독 화면 (`frontend/src/mobile/community/CompletionScreen.tsx`)

| 서비스 | 무엇을 하나 | 근거 |
| --- | --- | --- |
| Kindle "Before You Go" | 책 끝에서 별점·리뷰 버튼과 같은 작가 다른 책을 띄운다. 뒤로 가기·쓸어내리기로 닫는다. 작가들은 본문 뒤 부록보다 앞에 뜬다고 불평했다 | [BB eBooks](https://bbebooksthailand.com/blog/amazon-before-you-go.html), [MobileRead](https://www.mobileread.com/forums/showthread.php?p=2490931) `2차` |
| StoryGraph | 다 읽음 표시 → 리뷰 쓰기 제안(건너뛸 수 있음). 잘못 눌러도 되돌리기 어렵다는 사용자 요청이 있다 | [Book Riot](https://bookriot.com/storygraph-review/), [로드맵 요청](https://roadmap.thestorygraph.com/requests-ideas/posts/undo-marking-book-as-finished) `2차` |
| Goodreads(Kindle 연동) | 기기에서 바로 별점·공유 | [BookBrowse 2013](https://www.bookbrowse.com/news/detail/index.cfm/news_item_number/1468/news/new-kindle-paperwhite-lets-goodreads-members-rate-and-share-directly-from-kindle) `2차` |
| Fable | 다 읽은 뒤 북클럽 토론방으로 이어진다 | [앱스토어](https://apps.apple.com/us/app/fable-books-tv/id1488170618) `2차` |

**가져온 것**
- 한 화면에 축하 + 다음 행동 하나(커뮤니티)를 주 버튼으로, 홈은 보조 버튼, 닫기는 늘 오른쪽 위(Kindle의 "쉽게 닫힘").
- 숫자는 이미 받은 값 두 개(읽은 쪽, 추리 노트 수)만.
- 미스터리 은유: 완독 = "사건 종결". 표지 모서리에 비스듬한 도장 한 개(버건디 테두리), 숫자 칸은 사건 파일 기록표처럼(타자기 라벨).

**버린 것**
- 별점·리뷰 강요(StoryGraph·Kindle): 우리 목적은 추리 대화. 커뮤니티 글쓰기가 그 자리를 맡는다.
- 다른 책 추천을 이 화면에 끼우기(Kindle): 작품 수가 적고, 여운을 깨지 않는다.
- 이 화면에서 완독 여부 계산: 서버 `is_complete`만 따른다(FR-BRF-005 🚦).

## 4. 커뮤니티 허브·도서별 커뮤니티 (`MobileCommunityHub.tsx`, `MobileCommunity.tsx`)

| 서비스 | 무엇을 하나 | 근거 |
| --- | --- | --- |
| Fable 북클럽 | 장별 "스포일러 없는 방"을 자동으로 만들고, 마일스톤으로 진도를 맞춘다 | [앱스토어](https://apps.apple.com/us/app/fable-books-tv/id1488170618), [사용자 글](https://weirdobookclub.substack.com/p/weirdo-book-club-is-moving) `2차` |
| Goodreads 그룹 | 폴더 → 주제 → 글 구조, 스포일러 태그로 본문을 "(view spoiler)" 뒤에 숨긴다. 앱에서 태그가 안 먹는 사례가 있다 | [Goodreads 블로그](https://www.goodreads.com/blog/show/261-spoiler-tags), [Book Riot](https://bookriot.com/?p=137500) `2차` |
| Reddit 스포일러 관례 | `>!…!<` 표시, 제목에는 스포일러 금지(태그와 무관하게 보이므로) | [r/asoiaf 정책](https://lr.eu.psf.lt/r/asoiaf/wiki/spoilerpolicy) 등 `2차, r/mystery 규칙은 확인 못 함` |
| StoryGraph | 커뮤니티 피드에 완독 기록이 쌓인다 | [로드맵](https://roadmap.thestorygraph.com/requests-ideas/posts/undo-marking-book-as-finished) `2차` |

**가져온 것**
- 우리 방식은 Fable의 "읽은 데까지만 열리는 방"을 가장 엄격하게 한 것(완독자만 입장, 서버 판정). 허브에서 열린 방과 잠긴 방을 나눠 보여 주는 구조는 그대로.
- 잠긴 방은 "봉인" 느낌으로: 점선 테두리 + 자물쇠, 글 수·내용 없음(서버가 보내지 않음).
- 글 카드는 흰 카드에서 어두운 카드(`#1e1618`)로 바꿔 홈·브리핑과 같은 밤 톤으로. 글 종류(추리·감상) 꼬리표는 사건 파일 분류 표처럼 작게.

**버린 것**
- 스포일러 태그·가림 처리(Goodreads·Reddit): 방 전체가 완독자 전용이라 필요 없다. 오히려 가림 처리가 있으면 "아직 덜 읽은 사람도 볼 수 있다"는 잘못된 신호가 된다.
- 장별 방(Fable): 완독 전 토론은 스포일러 위험(R1·R11)이 있어 지금 범위 밖.

## 5. 미스터리 시각 참고

| 참고 | 무엇을 하나 | 근거 |
| --- | --- | --- |
| Her Story | 1990년대 경찰 데이터베이스 화면 자체가 무대. 검색창이 곧 수사 도구 | [PC Gamer](https://www.pcgamer.com/the-story-behind-her-story/3), [Game Informer](https://gameinformer.com/b/features/archive/2015/07/03/inside-her-story-the-indie-mystery-game-that-people-can-t-stop-analyzing) `2차` |
| Return of the Obra Dinn | 흑백 디더링 + 로그북. 인터페이스가 정성스럽다는 평과 헷갈린다는 평이 함께 있다 | [RPGFan](https://www.rpgfan.com/review/return-of-the-obra-dinn-2), [Game Wisdom](https://game-wisdom.com/analysis/return-obra-dinn) `2차` |
| 역전재판 법정 기록 | 증거·인물 두 칸의 "법정 기록" 파일, 항목 하나에 짧은 설명 | [StrategyWiki](https://strategywiki.org/wiki/Phoenix_Wright%3A_Ace_Attorney/Gameplay), [Tenten UX study](https://ghostcms.tenten.co/learning/ux-study-ace-attorney-en/) `2차` |
| 누아르 표지 | 흑백 + 빨강 한 점, 활자만으로 된 표지(Paul Bacon), 사건 파일을 손글씨로 옮긴 표지 | [The Big Sleep 표지 연구](https://www.behance.net/gallery/8207907/The-Big-Sleep), [Obsession](https://www.behance.net/gallery/12066909/Obsession), [99designs 누아르](https://99designs.com/inspiration/book-covers/noir) `2차` |

**가져온 것**
- 검정 바탕 + 버건디 한 색(누아르 "빨강 한 점")과 활자 중심 — 이미 홈·브리핑의 `data-night` 토큰과 같다.
- 사건 파일 모티프 세 가지만, 작게: ① 타자기 글꼴(DM Mono) 머리표("CASE FILE", 단계 번호) ② 서류철 탭(로그인·회원가입 탭을 카드 위에 붙은 서류철 탭으로) ③ 도장 한 개(완독 "사건 종결", 안내 마지막 "수사 개시"). 모두 장식이고 스크린리더에서는 `aria-hidden` 또는 제목과 중복되지 않게 처리.

**버린 것**
- 디더링·노이즈 질감·화면 반사(Obra Dinn, Her Story): 휴대폰 작은 화면에서 글자 대비를 떨어뜨린다.
- 먹칠(검열 막대)로 글자를 가리는 장식: 실제 정보를 가리는 것처럼 보여 "읽지 않은 부분을 숨긴다"는 우리 기능과 헷갈린다.
- 역전재판식 큰 효과 문구("이의 있음!"): 톤이 시끄럽다.

## 6. 적용 결과

- 화면 캡처: `docs/validation/2026-11-18-branding/`
- 색: `data-night` 토큰(바탕 `#0d0a0b`, 카드 `#1e1618`, 선 `#35292c`, 글자 `#ece6e0`, 보조 `#a89e9a`, 버건디 `#c4475f`·`#e58a9b`, 주 버튼 채움 `#8f1d35`). 제목 `font-dashSerif`, 아모 말 `font-amo`, 머리표 `font-dashMono`.
