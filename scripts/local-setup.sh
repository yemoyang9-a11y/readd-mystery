#!/usr/bin/env bash
# 로컬(대표 컴퓨터) 개발 환경 한 번에 준비 — 2026-11-20
# 사용: 저장소 최상위에서  bash scripts/local-setup.sh
# 하는 일: 작업 브랜치로 맞추기 → 서버·화면 패키지 설치 → .env 없으면 예시에서 복사 → 화면 캡처용 브라우저 설치
# 이미 있는 .env 는 건드리지 않는다. 실제 키(OpenAI·DB)는 직접 채운다.
set -euo pipefail

BRANCH="${BRANCH:-claude/handoff-docs-review-4cehil}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say() { printf '\n== %s\n' "$1"; }

say "Node 버전 확인 (20 이상, 운영 CI는 22)"
if ! command -v node >/dev/null 2>&1; then
  echo "Node 가 없습니다. https://nodejs.org 에서 22 버전을 설치한 뒤 다시 실행하세요." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node $(node -v) 는 너무 낮습니다. 20 이상(권장 22)을 설치하세요." >&2
  exit 1
fi
node -v

say "작업 브랜치 $BRANCH 로 맞추기"
if [ -n "$(git status --porcelain)" ]; then
  echo "커밋하지 않은 변경이 있어 브랜치를 바꾸지 않습니다. 정리한 뒤 다시 실행하세요." >&2
  git status --short >&2
  exit 1
fi
git fetch origin "$BRANCH"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git checkout "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
else
  git checkout -b "$BRANCH" "origin/$BRANCH"
fi
git log --oneline -1

say "서버 패키지 설치 (backend)"
(cd backend && npm ci)

say "화면 패키지 설치 (frontend)"
(cd frontend && npm ci)

say ".env 준비 (있으면 그대로 둔다)"
for dir in backend frontend; do
  if [ -f "$dir/.env" ]; then
    echo "$dir/.env 있음 — 그대로 둠"
  else
    cp "$dir/.env.example" "$dir/.env"
    echo "$dir/.env 새로 만듦 (예시 값). 실제 키는 직접 채우세요"
  fi
done

say "화면 캡처용 브라우저 (Playwright Chromium)"
if [ "${SKIP_BROWSER:-0}" = "1" ]; then
  echo "SKIP_BROWSER=1 — 건너뜀"
else
  (cd frontend && npx playwright install chromium)
fi

say "끝"
cat <<'EOF'
다음 단계
  1) 서버 없이 화면만 보기:  cd frontend && VITE_USE_MOCK=true npx vite --port 5191
     → http://localhost:5191  (로그인 reader@example.com / password123)
  2) 시험:  (cd backend && npm test -- --runInBand) ; (cd frontend && npm test)
  3) Claude 새 세션 첫 메시지:  docs/context/handoff-2026-11-20.md 읽고 이어서
EOF
