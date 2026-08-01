#!/usr/bin/env bash
# rebuild.sh — Pull latest dev branch and redeploy with Docker
# Usage: ./rebuild.sh [--pull-base-images]
# Run from the repository root on your server.
#
# By default this does NOT re-check the base image (node:20-alpine) against
# the registry — that check happens on every run and is pure network latency
# for essentially zero benefit, since the base image rarely changes. Pass
# --pull-base-images occasionally (e.g. monthly) to actually refresh it.

set -euo pipefail

PULL_BASE_IMAGES=false
for arg in "$@"; do
  if [ "$arg" = "--pull-base-images" ]; then
    PULL_BASE_IMAGES=true
  fi
done

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH="dev"

echo "==> Pulling latest code from branch: $BRANCH"
cd "$REPO_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

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
BUILDX_ARGS=(build --tag domino-designer-app:latest --load "$REPO_DIR")
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
