#!/bin/bash
# 측정용 로컬 서버(127.0.0.1:3100) — 기동 시 업로드 작업 이어 달리기를 끈다(serve-no-resume.ts).
# 사용: MEASURE_DIR=<결과 폴더> nohup backend/scripts/measure/start-server.sh >/dev/null 2>&1 &
# 서버 출력은 $MEASURE_DIR/features/server.log, 호출 기록은 $MEASURE_DIR/features/metrics.log. 키 값은 출력하지 않는다.
source "$(dirname "$0")/measure-env.sh"
F="$MEASURE_DIR/features"; mkdir -p "$F"
export LLM_METRICS_FILE="$F/metrics.log" PORT=3100
cd /home/user/readd-mystery/backend
echo "=== start $(date -u +%FT%TZ) ===" >> "$F/server.log"
exec npx ts-node --transpile-only scripts/measure/serve-no-resume.ts >> "$F/server.log" 2>&1
