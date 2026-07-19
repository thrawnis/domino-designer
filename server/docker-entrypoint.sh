#!/bin/sh
set -e

# Build DATABASE_URL from separate fields, percent-encoding user/password/db so
# that reserved URL characters (@, :, /, %, ...) in a generated Postgres
# password can't corrupt the connection string. Skipped if DATABASE_URL is
# already set explicitly (e.g. local/non-Compose usage).
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="$(node -e '
    const enc = encodeURIComponent;
    const user = enc(process.env.POSTGRES_USER || "domino");
    const pass = enc(process.env.POSTGRES_PASSWORD || "");
    const host = process.env.POSTGRES_HOST || "db";
    const port = process.env.POSTGRES_PORT || "5432";
    const db = enc(process.env.POSTGRES_DB || "domino");
    console.log(`postgresql://${user}:${pass}@${host}:${port}/${db}`);
  ')"
fi

npx prisma migrate deploy
exec node dist/index.js
