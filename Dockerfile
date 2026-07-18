## Build the client (Vite -> static assets emitted into server/public)
FROM node:20-alpine AS client-build
WORKDIR /repo
COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm install --workspace client --include-workspace-root=false --ignore-scripts
COPY client client
RUN npm run build --workspace client

## Build the server (TypeScript -> dist, plus Prisma client)
FROM node:20-alpine AS server-build
WORKDIR /repo
COPY package.json ./
COPY server/package.json server/package.json
RUN npm install --workspace server --include-workspace-root=false
COPY server server
COPY --from=client-build /repo/server/public server/public
RUN npm run build --workspace server

## Runtime image
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache libc6-compat vips-dev
COPY --from=server-build /repo/server/package.json ./package.json
COPY --from=server-build /repo/server/node_modules ./node_modules
COPY --from=server-build /repo/server/dist ./dist
COPY --from=server-build /repo/server/public ./public
COPY --from=server-build /repo/server/prisma ./prisma
COPY server/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
