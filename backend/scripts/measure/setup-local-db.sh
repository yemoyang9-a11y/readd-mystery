#!/bin/bash
# AI 원가 측정용 로컬 PostgreSQL 16 + pgvector 준비 (클라우드 세션 컨테이너, root). 여러 번 돌려도 된다.
# 운영 DB에는 접속하지 않는다. Docker 데몬이 없는 컨테이너를 기준으로 apt 설치를 쓴다.
set -euo pipefail
PGDATA="${PGDATA:-/home/user/pgdata}"
PGBIN=/usr/lib/postgresql/16/bin
cd "$(dirname "$0")/../.."   # backend/

if [ ! -f /usr/share/postgresql/16/extension/vector.control ]; then
  apt-get install -y postgresql-16-pgvector >/dev/null 2>&1 || { apt-get update >/dev/null && apt-get install -y postgresql-16-pgvector >/dev/null; }
fi
if [ ! -d "$PGDATA" ]; then
  mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
fi
if ! pg_isready -h /tmp -p 5432 >/dev/null 2>&1; then
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l $PGDATA/server.log -o '-p 5432 -k /tmp' start" >/dev/null
  sleep 2
fi
psql -h /tmp -U postgres -tAc "select 1 from pg_database where datname='readd_measure'" | grep -q 1 \
  || psql -h /tmp -U postgres -c "create database readd_measure" >/dev/null
psql -h /tmp -U postgres -d readd_measure -c "create extension if not exists vector" >/dev/null
[ -d node_modules ] || npm ci >/dev/null
DB_HOST=/tmp DB_PORT=5432 DB_NAME=readd_measure DB_USER=postgres DB_PASSWORD= DB_SSL=false node scripts/migrate.js | tail -1
echo "pgvector $(psql -h /tmp -U postgres -d readd_measure -tAc "select extversion from pg_extension where extname='vector'")"
