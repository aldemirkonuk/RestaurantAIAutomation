# WineOps API Gateway — Railway Production Dockerfile
# Build context: monorepo root (set Railway service root dir to /)
# Railway Dockerfile Path setting: apps/api-gateway/Dockerfile
#
# Railway injects $PORT at runtime (default 3000).

FROM node:20-alpine AS base
RUN npm install -g pnpm@9.15.9

# ── deps layer: install with frozen lockfile ──────────────────────────────────
FROM base AS deps
WORKDIR /app

# Copy monorepo manifests first (maximises Docker layer cache hits)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json ./apps/api-gateway/

# Install only the api-gateway dependency closure (+ hoisted workspace packages)
RUN pnpm install --frozen-lockfile --filter @wineops/api-gateway...

# ── build layer ───────────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

COPY apps/api-gateway ./apps/api-gateway/
RUN pnpm --filter @wineops/api-gateway build

# ── runtime layer (lean) ──────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN npm install -g pnpm@9.15.9

# Copy the entire monorepo workspace (node_modules + built dist)
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api-gateway/package.json ./apps/api-gateway/
COPY --from=builder /app/apps/api-gateway/node_modules ./apps/api-gateway/node_modules
COPY --from=builder /app/apps/api-gateway/dist ./apps/api-gateway/dist

# ── build provenance ──────────────────────────────────────────────────────────
#
# WHICH REVISION IS THIS IMAGE? The answer has to be frozen INTO the artifact at
# the moment it is built, because nothing at runtime can reconstruct it: there is
# no `.git` in this image (only `apps/api-gateway` and `dist` are copied), and a
# branch tip read later has moved on since.
#
# Railway passes a service's variables to the Docker build as build args, so
# setting `GIT_COMMIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}}` on the api-gateway service
# bakes the deployed revision in here. `/api/v1/health/live` reads it, and
# `scripts/check_deployed_sha.py` compares it against the merged sha.
#
# If no build arg is supplied this bakes an EMPTY string, never a plausible
# default — `build-provenance.ts` treats blank as absent and reports the literal
# "unknown", which fails the deploy audit loudly instead of certifying a guess.
# The runtime `RAILWAY_GIT_COMMIT_SHA`, when Railway sets it, is read first and
# overrides this, so the two paths are independent rather than competing.
ARG GIT_COMMIT_SHA=""
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA

# Railway injects $PORT at runtime; NestJS default is 3000
ENV NODE_ENV=production
EXPOSE 3000

WORKDIR /app/apps/api-gateway
CMD ["node", "dist/main"]
