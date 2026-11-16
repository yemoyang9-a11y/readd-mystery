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
