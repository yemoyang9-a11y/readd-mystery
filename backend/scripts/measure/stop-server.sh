#!/bin/bash
# 측정용 로컬 서버 끄기
pkill -f "scripts/measure/serve-no-resume.ts"; sleep 1
pgrep -f "serve-no-resume.ts" >/dev/null && echo "still running" || echo "stopped"
