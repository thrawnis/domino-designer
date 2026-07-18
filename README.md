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

## Domino model

These are pipless stacking/tricks dominoes (solid-color faces, no dots), stood on
edge so one face shows. The app treats **one domino as one mosaic cell/pixel** (a
roughly 1:2 width:height tile) accordingly.

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

3. **Reverse proxy (nginx on a separate Proxmox LXC)**: since nginx isn't on the
   same host as Docker, it can't reach the app over a shared Docker network — the
   app's port has to be published on the Docker host's LAN so the nginx LXC can
   reach it over the network. `docker-compose.yml` publishes port 4000 bound to
   `APP_BIND_ADDRESS` (set this in `.env` to the Docker host's LAN IP, e.g.
   `192.168.1.50`) — deliberately *not* `0.0.0.0`, so the app isn't reachable from
   outside your LAN, only from that specific interface.

   A ready-to-adapt nginx server block is in
   [`deploy/nginx/domino-designer.conf`](deploy/nginx/domino-designer.conf) — copy
   it to the LXC, replace the upstream IP, `server_name`, and certificate paths,
   then reload nginx (`nginx -t && systemctl reload nginx`). It terminates TLS at
   nginx and forwards `X-Forwarded-Proto`, which the app relies on to mark session
   cookies `Secure` and to trust proxy headers (`trust proxy` is already enabled
   server-side, so no code changes needed here).

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
