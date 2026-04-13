# WineOps API Gateway — Railway Production Dockerfile
# Build context: monorepo root (set Railway service root dir to /)
# Railway Dockerfile Path setting: apps/api-gateway/Dockerfile
#
# Railway injects $PORT at runtime (default 3000).

FROM node:20-alpine AS base
RUN npm install -g pnpm@8.15.0

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

RUN npm install -g pnpm@8.15.0

# Copy the entire monorepo workspace (node_modules + built dist)
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api-gateway/package.json ./apps/api-gateway/
COPY --from=builder /app/apps/api-gateway/node_modules ./apps/api-gateway/node_modules
COPY --from=builder /app/apps/api-gateway/dist ./apps/api-gateway/dist

# Railway injects $PORT at runtime; NestJS default is 3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "node apps/api-gateway/dist/main.js"]
