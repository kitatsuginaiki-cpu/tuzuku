#!/usr/bin/env bash
# ローカルの PostgreSQL 16 で RLS を検証する（Docker 不要）。
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=$(mktemp -d)
PORT=${PGPORT_TEST:-55432}
cleanup() { su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $DIR/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
chown postgres "$DIR"
su postgres -s /bin/bash -c "$PGBIN/initdb -D $DIR/data -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null"
su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
for f in supabase/tests/auth_stub.sql supabase/migrations/0001_tsuzuku_v7.sql supabase/tests/rls_test.sql; do
  su postgres -s /bin/bash -c "psql -h $DIR -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $ROOT/$f" 
done
