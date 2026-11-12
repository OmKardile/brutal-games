#!/bin/sh
# Container boot (Render / any Docker host).
#  1. create/sync the SQLite schema (idempotent; DATABASE_URL decides where)
#  2. optionally seed the first admin (when ADMIN_EMAIL + ADMIN_PASSWORD are set)
#  3. serve the Next.js standalone build
set -e

mkdir -p /data
bun run db:push

if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  bun scripts/seed-admin.ts || echo "seed-admin skipped (see message above)"
fi

exec bun .next/standalone/server.js
