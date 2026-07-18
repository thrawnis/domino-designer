# Domino Designer

Keep an inventory of physical dominoes (color, quantity, notes) and use it to design
mosaic-style domino art — either by hand-placing dominoes on a canvas, or by
uploading an image that gets converted into a domino layout using the colors you
actually own.

## Stack

- **Client**: React + TypeScript + Vite, `@uiw/react-color-wheel` for color selection.
- **Server**: Node.js + Express + TypeScript, Prisma ORM, PostgreSQL.
- **Auth**: multi-user accounts, cookie-based sessions (`express-session` +
  `connect-pg-simple`), passwords hashed with Argon2id. No secrets or payment
  data are handled — the only sensitive data is the login credentials themselves.

## Design assumption worth confirming

Physical domino mosaic art works by standing dominoes on edge so only one solid-color
face shows. This app therefore treats **one domino as one mosaic cell/pixel** (a
roughly 1:2 width:height tile), not as a two-ended pipped domino. If that's not what
you meant, let me know and the data model / renderer will need to change.

## Known v1 limitations

- Inventory quantity remaining is tracked **per design**, not across all of your
  designs combined. If you build multiple designs from the same physical inventory,
  you're responsible for not double-booking dominoes across designs — this isn't
  enforced globally yet.
- Image import grid is capped at 200x200 cells (40,000 dominoes) per request to keep
  processing fast; ask if you need larger.

## Local development

Requires Node 20+ and a local PostgreSQL instance.

```bash
npm install --workspaces
createdb domino   # or your own DATABASE_URL target

# Server (in server/.env or exported):
export DATABASE_URL="postgresql://user:pass@localhost:5432/domino"
export SESSION_SECRET="any-long-random-string-for-dev"
npm run dev:server   # http://localhost:4000

# In a second terminal:
npm run dev:client   # http://localhost:5173, proxies /api to :4000
```

The first time (or after schema changes), run migrations from `server/`:

```bash
cd server
npx prisma migrate dev
```

> Note: `npm run dev:client` runs Vite's dev server, which has a few known
> dev-server-only advisories (local file server / sourcemap handling). Only run it
> on a trusted local network — this does not affect the production build, which
> ships as static files with no dev server involved.

## Deploying with Docker Compose (self-hosted)

1. Copy `.env.example` to `.env` and fill in real values:
   ```bash
   cp .env.example .env
   openssl rand -base64 48   # use output for SESSION_SECRET
   openssl rand -base64 24   # use output for POSTGRES_PASSWORD
   ```
2. Build and start:
   ```bash
   docker compose up -d --build
   ```
   This builds one `app` image (Express server serving both the API and the built
   React static assets) and a `db` (Postgres) service with a named volume for
   persistence. On startup the app container automatically runs
   `prisma migrate deploy` before starting the server.

3. **Reverse proxy**: the `app` service does not publish a port by default and has
   no built-in TLS — it's meant to sit behind the reverse proxy you already run
   (Traefik / nginx / Caddy). Two ways to wire it up:
   - **Same Docker network**: attach `app` to your proxy's Docker network (add an
     `external` network in `docker-compose.yml` and reference it under `app`), then
     point your proxy at `app:4000` using your proxy's normal service-discovery
     config (Traefik labels, nginx `proxy_pass`, Caddy `reverse_proxy`, etc.).
   - **Published port**: uncomment the `ports: ["4000:4000"]` line under `app` in
     `docker-compose.yml` and point your proxy at `localhost:4000` (or the host IP)
     instead.

   Tell me which proxy you use and I can add the exact config (Traefik labels,
   an nginx `server {}` block, or a Caddyfile snippet).

4. The app trusts `X-Forwarded-*` headers from a proxy (`trust proxy` is enabled)
   and marks session cookies `Secure` whenever `NODE_ENV=production` — make sure
   your reverse proxy terminates TLS, since the app itself does not.

## Security notes

- Passwords: Argon2id, never stored or logged in plaintext.
- Sessions: httpOnly, `SameSite=Lax` cookies backed by a Postgres-stored session
  table (not JWTs, so sessions can be revoked server-side).
- CSRF: same-origin SPA + custom header requirement (`X-Requested-With`) on all
  state-changing requests, which cross-site requests cannot set without CORS
  opt-in (which the server does not grant in production).
- Rate limiting on `/api/auth/login` and `/api/auth/register` (10 requests / 15 min
  per IP).
- `helmet` sets a restrictive Content-Security-Policy and standard security headers.
- Image uploads are limited to 8MB and validated by MIME type; processed in-memory
  via `sharp` (no files written to disk, no shell-outs).
