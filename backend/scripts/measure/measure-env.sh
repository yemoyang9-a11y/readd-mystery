#!/bin/bash
# AI 원가 측정 공통 환경 (NFR-OBS-004) — `source backend/scripts/measure/measure-env.sh` 로 불러온다.
# 키 값은 출력하지 않는다. .env 파일을 만들지 않는다. LLM_METRICS_FILE 은 부르는 쪽이 단계마다 정한다.
# 2026-11-24부터 API는 챗봇·리캡만 부른다. 책 등록 단계는 전부 Claude 구독(claude CLI)이라 API 키가 없어도 돈다.
: "${MEASURE_DIR:?MEASURE_DIR(측정 결과 폴더, 저장소 밖)를 먼저 정한다}"
case "$MEASURE_DIR" in /home/user/readd-mystery*) echo "MEASURE_DIR 은 저장소 밖이어야 한다" >&2; return 1 2>/dev/null || exit 1;; esac
mkdir -p "$MEASURE_DIR"
# 세션에는 키가 READD_ANTHROPIC_API_KEY 이름으로 있다. ANTHROPIC_API_KEY 가 이미 있으면 그대로 쓴다
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$READD_ANTHROPIC_API_KEY}"
export LLM_PROVIDER=anthropic ANTHROPIC_MODEL=claude-haiku-5-5 ANTHROPIC_EFFORT=low
export MOCK_MODE=false NODE_ENV=development
# 로컬 측정 DB만. DATABASE_URL 이 있으면 config/database.ts 가 그쪽을 먼저 쓰므로 지운다
unset DATABASE_URL
export DB_HOST=/tmp DB_PORT=5432 DB_NAME=readd_measure DB_USER=postgres DB_PASSWORD= DB_SSL=false
export TS_NODE_PROJECT=/home/user/readd-mystery/backend/tsconfig.json NODE_PATH=/home/user/readd-mystery/backend/node_modules
