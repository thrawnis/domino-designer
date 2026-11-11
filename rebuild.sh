#!/usr/bin/env bash
# rebuild.sh — Always discard any local changes and sync to the latest main
# branch, then redeploy with Docker, but only rebuild/restart if there's
# actually something new to deploy.
# Usage: ./rebuild.sh [--pull-base-images] [--force]
# Run from the repository root on your server.
#
# The git sync step (checkout + hard reset + clean) always runs, unconditionally,
# every time: whatever is on disk — hand edits, stray commits, leftover merge
# state, untracked files — is discarded in favor of exactly what's on
# origin/main. .env is untouched (it's gitignored, so `git clean` leaves it
# alone) and is the only thing on the server this script doesn't overwrite.
#
# By default this does NOT re-check the base image (node:20-alpine) against
# the registry — that check happens on every run and is pure network latency
# for essentially zero benefit, since the base image rarely changes. Pass
# --pull-base-images occasionally (e.g. monthly) to actually refresh it.
#
# By default, if origin/main has no new commits since the last run AND the
# currently running app container was itself built from that same commit,
# the build/deploy steps are skipped entirely (they're not free: a full
# image build and container restart even when nothing changed). The second
# check matters on its own — git being up to date doesn't prove the
# container is: a previous run could have reset the checkout but then
# failed partway through the build/deploy, or someone could have fiddled
# with git or Docker state by hand — so a mismatch there forces a rebuild
# even with no new commit. Pass --force to rebuild and redeploy regardless,
# e.g. after editing docker-compose.yml, the Dockerfile, or .env by hand.

set -euo pipefail

PULL_BASE_IMAGES=false
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --pull-base-images) PULL_BASE_IMAGES=true ;;
    --force) FORCE=true ;;
  esac
done

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH="main"

cd "$REPO_DIR"

echo "==> Fetching branch: $BRANCH"
git fetch origin "$BRANCH"

OLD_COMMIT="$(git rev-parse HEAD)"

# Always discard any local changes (hand edits, stray commits, merge leftovers,
# whatever) and land exactly on origin/$BRANCH, regardless of whether a
# rebuild ends up happening below — this runs unconditionally, every time.
echo "==> Discarding local changes and syncing to origin/$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd

NEW_COMMIT="$(git rev-parse HEAD)"

# What commit is the currently running app container actually built from?
# Empty if the container doesn't exist yet (e.g. first deploy) or predates
# this label being introduced, either of which should force a build.
RUNNING_CID="$(docker compose ps -q app 2>/dev/null || true)"
RUNNING_COMMIT=""
if [ -n "$RUNNING_CID" ]; then
  RUNNING_COMMIT="$(docker inspect --format '{{ index .Config.Labels "domino.gitCommit" }}' "$RUNNING_CID" 2>/dev/null || true)"
fi

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ] && [ "$RUNNING_COMMIT" = "$NEW_COMMIT" ] && [ "$FORCE" != true ]; then
  echo "==> Already up to date ($OLD_COMMIT) and running that build — nothing to do. Pass --force to rebuild anyway."
  exit 0
fi

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ] && [ "$RUNNING_COMMIT" != "$NEW_COMMIT" ]; then
  echo "==> Code is up to date, but the running container is built from '${RUNNING_COMMIT:-<none>}', not $NEW_COMMIT — rebuilding."
else
  echo "==> New code: $OLD_COMMIT -> $NEW_COMMIT"
fi

if [ ! -f "$REPO_DIR/.env" ]; then
  echo "ERROR: .env not found in $REPO_DIR (copy .env.example to .env and fill it in first)"
  exit 1
fi

# -- Build and start containers -----------------------------------------------

# Built directly with `docker buildx build` rather than `docker compose build`:
# on this host (and apparently not uniquely — this has bitten us more than
# once), Compose's own detection of the buildx plugin is unreliable and
# silently falls back to the legacy (non-BuildKit) builder, which can't
# handle the Dockerfile's `RUN --mount=type=cache` syntax at all and fails
# outright. `docker buildx build` goes through the docker CLI's own plugin
# resolution instead, which has proven reliable here. The image name below
# must match docker-compose.yml's `app.image` so Compose picks up exactly
# this build instead of trying (and failing) to build it again itself.
# Use --tag (not -t): the -t shorthand has failed here with "unknown
# shorthand flag: 't' in -t" from the *root* docker command, meaning it
# wasn't reaching buildx's own flag parser at all in this exact invocation
# context, even though `docker buildx version` and manual runs worked fine.
# Confirmed --tag avoids it: a manual `docker buildx build --tag ... --load`
# run completed successfully. Root cause not fully understood; --tag is a
# verified-working, zero-downside substitute, so use it.
echo "==> Building app image"
BUILDX_ARGS=(build --tag domino-designer-app:latest --label "domino.gitCommit=$NEW_COMMIT" --load "$REPO_DIR")
if [ "$PULL_BASE_IMAGES" = true ]; then
  echo "==> (--pull-base-images: also re-checking base images against the registry)"
  BUILDX_ARGS+=(--pull)
fi
docker buildx "${BUILDX_ARGS[@]}"

# Bring up db without --force-recreate so existing connections are preserved.
echo "==> Starting db"
docker compose up -d db

# Only force-recreate the app container; it runs `prisma migrate deploy` on
# startup (see server/docker-entrypoint.sh) before the server starts.
echo "==> Deploying app"
docker compose up -d --force-recreate --remove-orphans --no-build app

echo "==> Removing dangling images"
docker image prune -f

echo "==> Done. App is running on port 4000 (all interfaces)."
docker compose ps
