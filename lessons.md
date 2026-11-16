# lessons.md

## 2026-11-16 — Windows에서 한글이 든 Python 치환 스크립트가 조용히 아무것도 안 바꿈

- 증상: `python - <<EOF`로 소스 파일의 한글 문자열을 `str.replace`했는데 오류 없이 끝났고, `git diff`가 비어 있었다. 이후 분할 결과도 그대로였다.
- 원인: Windows Python이 표준입력 스크립트를 로캘 코드페이지(cp949)로 읽어 한글 패턴이 파일 내용과 일치하지 않았다. `replace`는 일치하지 않아도 예외를 내지 않는다.
- 해결: 스크립트를 파일로 저장해 `PYTHONUTF8=1 python 파일.py`로 실행하고, 치환 전에 `assert 패턴 in 본문`을 둔다. 적용 뒤에는 `git diff --stat`으로 실제 변경을 확인한다. 한두 군데 수정은 Edit 도구가 더 안전하다.
