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

### Physical reference dimensions

Recorded here (and as the single source of truth in `client/src/utils/dominoSpec.ts`,
mirrored in `server/src/utils/dominoSpec.ts`) for any future feature that needs real
measurements — weight/footprint estimates, materials lists, etc:

| Dimension | Value |
| --- | --- |
| Length (visible face height, standing) | 1.88 in / 48 mm |
| Width (side-to-side along a row/chain)  | 0.945 in / 24 mm |
| Thickness (front-to-back, standing)     | 0.29 in / 7.5 mm |
| Weight                                  | 0.30 oz / 8.5 g |

**Spacing**: these are stacking/toppling dominoes, so adjacent dominoes must not
touch. The editor and image importer both space placed dominoes by a gap of
**twice the domino thickness (~0.58 in / 15 mm)**, applied the same way both along
a chain ("one in front of the other") and between adjacent parallel toppling rows.
This is a fixed default, not currently user-adjustable.

## Image import algorithms

The importer (`server/src/services/imageProcessing.ts`) offers 8 algorithms to
compare side by side, up to 6 at a time:

- **Nearest color** — no dithering, flat blocks of the closest available color.
- **Floyd–Steinberg, Atkinson, Stucki, Sierra, Burkes, Jarvis-Judice-Ninke** — error-diffusion
  dithering algorithms (increasingly wide diffusion kernels, from Atkinson's
  narrow/high-contrast to Jarvis-Judice-Ninke's wide/smooth).
- **Bayer (ordered)** — a fixed crosshatch threshold pattern instead of diffused
  noise; more predictable/repeatable to build by hand than the diffusion algorithms.

Any algorithm can also be run with **perceptual (Lab-space, CIE76) color
distance** instead of plain RGB Euclidean distance, which more closely matches
how humans perceive color similarity — helpful with a small/muted domino palette
where RGB distance sometimes picks a visually-wrong nearest color.

## Known v1 limitations

- Inventory quantity remaining is tracked **per design**, not across all of your
  designs combined. If you build multiple designs from the same physical inventory,
  you're responsible for not double-booking dominoes across designs — this isn't
  enforced globally yet.
- Image import is capped at 12,000 dominoes total per design (each domino is an
  interactive element in the editor); the importer keeps the image's proportions
  by deriving the height from the width and the 1:2 domino shape. Ask if you need
  larger designs.

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
   Or, for later redeploys, use `./rebuild.sh` — it pulls the latest `dev` branch,
   rebuilds, and restarts `db`/`app` without tearing down the Postgres volume.

   This builds one `app` image (Express server serving both the API and the built
   React static assets) and a `db` (Postgres) service with a named volume for
   persistence. On startup the app container automatically runs
   `prisma migrate deploy` before starting the server.

3. **Network exposure**: `docker-compose.yml` publishes port 4000 on all
   interfaces (`4000:4000`), so it's reachable from any machine on your LAN, your
   nginx LXC, and a Cloudflare Tunnel (`cloudflared`) pointed at the Docker host —
   whichever paths you want, simultaneously. The app itself does not terminate TLS,
   so anything reaching it over plain HTTP gets plain HTTP; anything reaching it
   via a proxy that terminates HTTPS (nginx, Cloudflare Tunnel) gets HTTPS. Session
   cookies use `secure: 'auto'` server-side, so login works correctly either way —
   marked `Secure` only on requests that were actually HTTPS.

   An optional, ready-to-adapt nginx server block (if you still want nginx in
   front of some access paths) is in
   [`deploy/nginx/domino-designer.conf`](deploy/nginx/domino-designer.conf) — copy
   it to the LXC, replace the upstream IP, `server_name`, and certificate paths,
   then reload nginx (`nginx -t && systemctl reload nginx`).

4. **Cloudflare Tunnel**: point `cloudflared` at `http://<docker-host-ip>:4000`
   (or `http://app:4000` if you run `cloudflared` as a container on the same
   Docker network). Cloudflare terminates TLS at its edge and forwards
   `X-Forwarded-Proto: https` to the tunnel, which the app already trusts
   (`trust proxy` is enabled) to mark cookies `Secure` correctly. If you chain
   **both** Cloudflare Tunnel and nginx in front of the app (two proxy hops),
   set `TRUST_PROXY_HOPS=2` in `.env` so login rate limiting keys on the real
   client IP instead of the proxy's.

   One thing to be aware of: exposing the app publicly via Cloudflare Tunnel means
   the login/register endpoints are reachable from the internet. Login attempts
   are rate-limited (10 / 15 min per IP) and passwords are Argon2id-hashed, but for
   extra protection you may still want to put this app behind Cloudflare Access
   (or a similar auth gate) if you'd rather not expose even the login screen
   publicly.

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
