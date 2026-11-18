# 조사 — 쪽 이동 뒤 "원래 읽던 곳으로 돌아가기"와 인물 이름 강조 (2026-11-18)

대표 지시: 아모 답변의 인물 언급은 색으로 강조하고, 쪽 언급(p.13)을 누르면 그 쪽으로 이동했다가 원래 읽던 곳으로 돌아오는 장치를 만든다. 새 기능 전 다른 플랫폼 3곳 이상 조사 규칙에 따라 남긴다.

## 본 것

| 플랫폼 | 이동 뒤 돌아가기 | 이름 강조 | 출처 |
| --- | --- | --- | --- |
| Apple Books (iPhone) | 쪽을 건너뛴 뒤 화면을 누르면 왼쪽 위에 둥근 화살표가 생기고, 누르면 이전 읽던 곳으로 간다. 다시 누르면(오른쪽 위) 건너뛴 곳으로 돌아간다 — 왕복 | 없음 | [Apple iPhone 사용 설명서](https://support.apple.com/fr-ca/HT201478), [DEVONthink 포럼](https://discourse.devontechnologies.com/t/pdf-navigation-back-button-in-dt2go-ipad/64623) |
| Kindle | 책 안 검색 뒤 아래에 "현재 읽던 위치로 돌아가기" 버튼. 앱 쪽 각주 이동 뒤 돌아가기는 버전마다 다르고 불편하다는 사용자 불만이 많다 — 외부 링크를 다녀오면 다녀온 곳을 현재 위치로 기억해 버리는 사례 | X-Ray: 인물·장소 이름을 굵게, 누르면 설명. 언급 위치 목록에서 그 쪽으로 이동. **읽지 않은 부분의 발췌는 숨기는 설정**이 있다 | [MobileRead](https://www.mobileread.com/forums/showthread.php?p=3105420), [UX 리뷰](https://uxdesign.cc/things-that-really-bug-me-about-the-kindle-app-a-ux-review-582b210e11cd), [MakeUseOf X-Ray](https://www.makeuseof.com/how-to-use-kindle-x-ray/), [SlashGear](https://www.slashgear.com/1475659/kindle-x-ray-feature-explained/) |
| Google Play Books | 전용 돌아가기 버튼은 확인하지 못했다. 사용자들은 북마크로 버틴다("목차로 한 장씩 넘겨 돌아가야 한다"는 불만) | 없음 | [Google Play 지원 스레드](https://support.google.com/googleplay/thread/236628830), [9to5Google 빠른 북마크](https://9to5google.com/2014/10/30/google-play-books-gains-new-skim-feature-for-quickly-jumping-through-books-improved-bookmarking-and-more/?extended-comments=1) |
| KOReader | Kindle의 "현재 읽던 위치로 돌아가기"를 비교 대상으로 들며 같은 기능을 요청 | — | [MobileRead](https://www.mobileread.com/forums/showthread.php?p=4465722) |

## 정리

1. 돌아가기는 **이동 직후 눈에 보이는 버튼 하나**가 표준이다(Apple·Kindle 검색). 북마크로 대신하게 하면 불만이 남는다(Play Books).
2. 돌아갈 곳은 **이동 직전 위치를 그대로 기억**해야 한다. 다녀온 곳을 현재 위치로 덮어쓰면 실패한다(Kindle 앱 불만). RE:ADD는 이미 목차·노트 이동에 `jumpOrigin`으로 이렇게 한다.
3. 이름 강조는 Kindle X-Ray가 가장 가깝고, **읽지 않은 부분은 숨기는 설정**을 따로 둔다. RE:ADD는 기준점 이하로 서버가 이미 거른 인물만 쓰므로 같은 효과를 구조로 얻는다(FR-SPL-002).
4. 검색 결과는 대부분 사용자 글·제3자 안내라 현재 앱 동작과 다를 수 있다.
