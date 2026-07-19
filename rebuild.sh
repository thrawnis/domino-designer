#!/usr/bin/env bash
# rebuild.sh — Pull latest dev branch and redeploy with Docker
# Usage: ./rebuild.sh
# Run from the repository root on your server.

set -euo pipefail

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

# Docker Compose looks for the buildx plugin under ~/.docker/cli-plugins first;
# on some hosts it's only installed system-wide, which Compose won't find on its
# own, causing multi-stage builds to silently fall back to the legacy builder and
# fail. Symlink it in if needed.
if [ ! -x "$HOME/.docker/cli-plugins/docker-buildx" ]; then
  for candidate in /usr/libexec/docker/cli-plugins/docker-buildx /usr/lib/docker/cli-plugins/docker-buildx; do
    if [ -x "$candidate" ]; then
      echo "==> Linking docker-buildx into ~/.docker/cli-plugins so Compose can find it"
      mkdir -p "$HOME/.docker/cli-plugins"
      ln -sf "$candidate" "$HOME/.docker/cli-plugins/docker-buildx"
      break
    fi
  done
fi

# -- Build and start containers -----------------------------------------------

echo "==> Building containers"
docker compose build --pull

# Bring up db without --force-recreate so existing connections are preserved.
echo "==> Starting db"
docker compose up -d db

# Only force-recreate the app container; it runs `prisma migrate deploy` on
# startup (see server/docker-entrypoint.sh) before the server starts.
echo "==> Deploying app"
docker compose up -d --force-recreate --remove-orphans app

echo "==> Removing dangling images"
docker image prune -f

echo "==> Done. App is running on port 4000 (all interfaces)."
docker compose ps
