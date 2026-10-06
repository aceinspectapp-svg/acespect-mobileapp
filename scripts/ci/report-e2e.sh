#!/usr/bin/env bash
# Report generation end-to-end check (used by .github/workflows/report-checks.yml, runnable locally).
#
# Needs: an EMPTY Postgres database in $DATABASE_URL (it is migrated and filled with the
# published templates -- never point this at a real database), node, poppler (pdftotext,
# pdfinfo, pdfimages), and `npm ci` already run in acespect-backend and acespect-web.
#
#   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public scripts/ci/report-e2e.sh
#
# Optional: BACKEND_PORT (4010), WEB_PORT (5190).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL must point at an empty scratch database}"
BACKEND_PORT="${BACKEND_PORT:-4010}"
WEB_PORT="${WEB_PORT:-5190}"
SMOKE_EMAIL="report-smoke@example.com"
SMOKE_PASSWORD="Smoke-Test-Pass-123!"
LOGS="$(mktemp -d)"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

dump_logs() { echo "--- backend log ---"; tail -40 "$LOGS/backend.log" || true; echo "--- web log ---"; tail -20 "$LOGS/web.log" || true; }

wait_for() { # url, name
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 2
  done
  echo "timed out waiting for $2 ($1)"; dump_logs; exit 1
}

export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-ci-access-secret-0123456789abcdef}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-ci-refresh-secret-0123456789abcdef}"
export RATE_LIMIT_OFF=1 QC_JOBS=off EGNYTE_DOMAIN="" EGNYTE_API_TOKEN=""

echo "== database: migrate, restore the published templates, add a sign-in"
cd "$ROOT/acespect-backend"
npx prisma generate >/dev/null
npx prisma migrate deploy
SMOKE_EMAIL="$SMOKE_EMAIL" SMOKE_PASSWORD="$SMOKE_PASSWORD" node -e "
  const { PrismaClient } = require('@prisma/client');
  const bcrypt = require('bcryptjs');
  const prisma = new PrismaClient();
  bcrypt.hash(process.env.SMOKE_PASSWORD, 10)
    .then((passwordHash) => prisma.user.create({ data: { email: process.env.SMOKE_EMAIL, role: 'ADMIN', passwordHash, name: 'Report Smoke' } }))
    .then(() => prisma.\$disconnect());
"

# the restore attributes the templates to an admin, so it runs after the sign-in is seeded
npx tsx src/scripts/restore-templates-snapshot.ts

echo "== starting the backend on :$BACKEND_PORT and the web app on :$WEB_PORT"
PORT="$BACKEND_PORT" NODE_ENV=development CORS_ORIGIN="*" \
  PUBLIC_BASE_URL="http://localhost:$BACKEND_PORT" WEB_APP_URL="http://localhost:$WEB_PORT" \
  npx tsx src/server.ts >"$LOGS/backend.log" 2>&1 &
PIDS+=($!)
cd "$ROOT/acespect-web"
VITE_API_URL="http://localhost:$BACKEND_PORT/api/v1" npx vite --port "$WEB_PORT" --strictPort >"$LOGS/web.log" 2>&1 &
PIDS+=($!)
wait_for "http://localhost:$BACKEND_PORT/health" "the backend"
wait_for "http://localhost:$WEB_PORT/" "the web app"

echo "== building an inspection, generating the PDF and checking what it says"
ACESPECT_API="http://localhost:$BACKEND_PORT/api/v1" ACESPECT_WEB="http://localhost:$WEB_PORT" \
  SMOKE_EMAIL="$SMOKE_EMAIL" SMOKE_PASSWORD="$SMOKE_PASSWORD" \
  node scripts/ci-report-smoke.mjs || { dump_logs; exit 1; }
