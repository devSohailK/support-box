# syntax=docker/dockerfile:1

# ---- base: Node + toolchain for native modules (better-sqlite3) ----
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

# ---- build: all deps, build client + server ----
FROM base AS build
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build

# ---- prod-deps: server runtime deps only ----
FROM base AS prod-deps
RUN npm ci --omit=dev -w server

# ---- server runtime: no compilers, non-root ----
FROM node:22-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/server/dist server/dist
COPY server/drizzle server/drizzle
COPY server/package.json server/
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "dist/index.js"]

# ---- web: Caddy serving the client build and proxying /api ----
FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/client/dist /srv
