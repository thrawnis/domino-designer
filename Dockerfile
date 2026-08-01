# syntax=docker/dockerfile:1
# (pins the BuildKit frontend version so RUN --mount=type=cache below is
# guaranteed supported, regardless of the host's installed buildx version)

## Build the client (Vite -> static assets emitted into server/public)
FROM node:20-alpine AS client-build
WORKDIR /repo
COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
# Cache mount: persists npm's download cache across builds (in BuildKit's own
# cache store, not the image), even when package.json changes and the normal
# layer cache can't be reused — only genuinely new packages hit the network.
RUN --mount=type=cache,target=/root/.npm \
    npm install --workspace client --include-workspace-root=false --ignore-scripts
COPY client client
RUN npm run build --workspace client

## Build the server (TypeScript -> dist, plus Prisma client)
FROM node:20-alpine AS server-build
WORKDIR /repo
# Prisma's engine binaries need libssl to detect the correct build target and
# to load at all; without it "prisma generate" silently picks the wrong engine.
RUN apk add --no-cache openssl
COPY package.json ./
COPY server/package.json server/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm install --workspace server --include-workspace-root=false
COPY server server
COPY --from=client-build /repo/server/public server/public
# Also cache Prisma's downloaded engine binaries and version-check state
# (~/.cache/prisma and ~/.cache/prisma-nodejs), for the same reason.
RUN --mount=type=cache,target=/root/.cache \
    npm run build --workspace server

## Runtime image
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache libc6-compat vips-dev openssl
RUN addgroup -S app && adduser -S app -G app
COPY --from=server-build /repo/server/package.json ./package.json
# npm workspaces hoists dependencies to the repo root, not server/node_modules.
COPY --from=server-build /repo/node_modules ./node_modules
COPY --from=server-build /repo/server/dist ./dist
COPY --from=server-build /repo/server/public ./public
COPY --from=server-build /repo/server/prisma ./prisma
COPY server/docker-entrypoint.sh ./docker-entrypoint.sh
# COPY defaults to root:root ownership; prisma migrate deploy needs write access
# under node_modules/@prisma/engines at runtime, so hand the whole app dir to
# the unprivileged user it actually runs as.
RUN chmod +x ./docker-entrypoint.sh && chown -R app:app /app

USER app

EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
