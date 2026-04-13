---
phase: 22
slug: observability-deployment
created: "2026-04-13"
updated: "2026-04-13"
status: ready-for-planning
---

# Phase 22: Observability & Deployment — Context

## Phase Goal

Make the system visible and ship it to production. After this phase, the golden path is running live for the friend's Turkish restaurant in San Francisco.

## Requirements In Scope

**Observability (OBS-01..05):**
- OBS-01: Sentry SDK in main.py — `sentry_sdk.init()` with `traces_sample_rate=0.1`, per-agent tags, alert rules (error rate > 5%, response time > 10s)
- OBS-02: Per-agent health endpoints — `GET /api/v1/health/agents` (all), `GET /api/v1/health/agents/{name}` (detailed metrics: messages processed, error rate, circuit breaker state)
- OBS-03: `GET /api/v1/metrics` — DLQ size, active sagas, per-agent message counts
- OBS-04: Business metrics — stock updates/sec, notification delivery rate, report generation time, webhook processing latency
- OBS-05: Public `GET /health` endpoint — minimal `{"status": "ok"}`, no internal details, for Railway healthcheck and uptime monitors

**POS Abstraction (POS-ABSTRACT):**
- Refactor `POST /api/v1/pos/webhook/toast` → generic `POST /api/v1/pos/webhook/{provider}`
- Define `POSProvider` protocol with `verify_webhook()` and `normalize_event()` → common `POSEvent` schema
- `ToastAdapter` implements `POSProvider` — all existing Toast HMAC + normalization logic moves here
- Agent only works with normalized `POSEvent` — no POS-specific code in agent layer

**Frontend (DEP-01):**
- React admin page at `/admin/health` showing agent status cards
- Frontend deployed to Vercel (auto-deploy from git)

**Infrastructure (DEP-02..06):**
- DEP-02: Supabase Cloud — all v1.0 + v2.0 migrations applied
- DEP-03: agent-orchestrator on Railway via Docker ($5-10/mo)
- DEP-04: RabbitMQ on CloudAMQP (free tier)
- DEP-05: Redis on Upstash (free tier, AOF persistence)
- DEP-06: Toast API credentials configured in Railway dashboard, connectivity test via read-only call

**Infrastructure Fixes (found in audit):**
- INFRA-01: CORSMiddleware on FastAPI (defense-in-depth for local dev + direct access)
- INFRA-02: `vercel.json` for monorepo build configuration (root dir → `apps/web`)
- INFRA-03: Create `.env.example` (the file doesn't exist — only `.env` does; prior context was wrong)
- INFRA-04: api-gateway health proxy routes (NestJS → agent-orchestrator)

## Success Criteria (from ROADMAP + discuss updates)

1. Sentry SDK initialized in main.py with per-agent tags and alert rules
2. `GET /health` returns `{"status": "ok"}` — public, no auth, used by Railway healthcheck
3. `GET /api/v1/health/agents` returns health status for all running agents (requires `X-Admin-Key`)
4. `GET /api/v1/health/agents/{name}` returns detailed metrics (requires `X-Admin-Key`)
5. `GET /api/v1/metrics` returns DLQ size, active sagas, per-agent message counts (requires `X-Admin-Key`)
6. React admin page at /admin/health shows agent status cards (behind ProtectedRoute — login required)
7. Frontend live on Vercel (auto-deploy from git) with `vercel.json` configuring monorepo build
8. Supabase Cloud database with all v1.0 + v2.0 migrations applied
9. Agent-orchestrator service running on Railway via Docker (GitHub auto-deploy on push to main)
10. RabbitMQ running on CloudAMQP, queues created and bound
11. Redis running on Upstash with AOF persistence
12. Toast API connectivity verified via read-only GET call with production credentials
13. `POST /api/v1/pos/webhook/{provider}` generic route live with ToastAdapter as first impl
14. Friend's restaurant receiving live inventory alerts
15. CORSMiddleware configured on FastAPI with production origins
16. api-gateway proxies `/api/health/*` and `/api/metrics` to agent-orchestrator
17. `.env.example` documents all required env vars

## Decisions

### Network Architecture (API gateway pattern — locked in audit)
- **Frontend → api-gateway → agent-orchestrator** — all frontend requests go through the existing NestJS api-gateway. Frontend only knows `VITE_API_GATEWAY_URL`. No new env vars needed for the health dashboard.
- **Vercel rewrites** — `vercel.json` rewrites `/api/*` to the api-gateway URL. Browser sees same origin. Eliminates CORS for production.
- **CORSMiddleware on FastAPI** — defense-in-depth for local dev and any direct access. `ALLOWED_ORIGINS` env var, defaults to `["http://localhost:5173"]` in development.
- **api-gateway health proxy** — NestJS gets proxy routes for `/api/health/*` and `/api/metrics` → forwards to agent-orchestrator's Railway URL with `X-Admin-Key` header (server-to-server). Frontend user auth is handled by NestJS middleware (Supabase JWT).

### Auth (3-layer approach — locked in discuss + refined in audit)
- **`GET /health`** — public, no auth. Railway healthcheck + uptime monitors use this.
- **`GET /api/v1/health/agents`, `/agents/{name}`, `/api/v1/metrics`** — require `X-Admin-Key` header matching `ADMIN_API_KEY` env var (same pattern as `research_routes.py` line 35). Returns 401 if missing/wrong. This is for server-to-server (api-gateway → orchestrator).
- **`/admin/health` frontend** — wrapped in `ProtectedRoute` (any authenticated user). Calls api-gateway URL (not orchestrator directly). Gateway verifies Supabase JWT + adds `X-Admin-Key` before proxying to orchestrator.
- **ADMIN_API_KEY never touches frontend JS** — it lives in api-gateway's server-side env vars only.

### Sentry Init (fail in prod, warn in dev — locked in discuss)
- Add `sentry-sdk[fastapi]` to requirements.txt
- Init in main.py before app creation. DSN from `SENTRY_DSN` env var.
- Per-agent scope: `sentry_sdk.set_tag("agent", agent_name)` in BaseAgent
- **Startup behavior:**
  - `ENVIRONMENT=production` + no `SENTRY_DSN` → raise `ValueError` at startup (fail fast)
  - `ENVIRONMENT=development` + no `SENTRY_DSN` → `logger.warning("SENTRY_DSN not set — Sentry disabled")`, continue
- `settings.py` line 116 already has `self.environment` from `ENVIRONMENT` env var — reuse it.
- Alert rules: error rate > 5%, response time > 10s

### POS Abstraction (generic interface — locked in discuss)
- **Route change:** `POST /api/v1/pos/webhook/toast` → `POST /api/v1/pos/webhook/{provider}`
- **Protocol definition:** `POSProvider` (Python `Protocol`) with two methods:
  - `async def verify_webhook(self, raw: bytes, signature: str) -> bool`
  - `async def normalize_event(self, raw: dict) -> POSEvent`
- **`POSEvent` schema:** normalized event model (common fields: event_type, restaurant_guid, timestamp, items, raw_payload)
- **`ToastAdapter`:** implements `POSProvider` — all existing HMAC + event logic from `pos_routes.py` + `POSIntegrationAgent` moves here
- **POSIntegrationAgent:** works only with `POSEvent`, no Toast-specific code
- **Future:** Square/Clover add their adapter + register in provider registry. No agent changes needed.
- **File locations:** `api/pos_routes.py` (route + provider dispatch), `core/pos_provider.py` (Protocol + POSEvent), `adapters/toast_adapter.py` (ToastAdapter)

### Deployment Platform
- **Python service:** Railway via GitHub integration (auto-deploy on push to main). Dockerfile in `services/agent-orchestrator/` — Python 3.11-slim base, uvicorn entrypoint, port 8000.
- **Railway healthcheck path:** `GET /health` (the public minimal endpoint)
- **Frontend:** Vercel — auto-deploy from git, free tier. `vercel.json` at repo root configures `apps/web` as build target, framework preset `vite`, and `/api/*` rewrites to api-gateway URL.
- **api-gateway:** Deploy to Railway (or Vercel serverless functions if NestJS supports it). Needs `AGENT_ORCHESTRATOR_URL` and `ADMIN_API_KEY` env vars to proxy health routes.
- **Database:** Supabase Cloud — promote local dev project to production.
- **RabbitMQ:** CloudAMQP free tier (Little Lemur — 1M messages/mo, 20 connections).
- **Redis:** Upstash free tier (10K commands/day, AOF persistence enabled).
- **Target cost:** ~$10-20/mo total.

### Toast Credentials (DEP-06)
- Credentials (`TOAST_API_URL`, `TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`, `TOAST_RESTAURANT_GUID`) go into Railway dashboard env vars ONLY. Never committed to git.
- Production endpoint: `https://ws-api.toasttab.com`
- Connectivity test in execution phase: `GET /restaurants/{guid}/v2/restaurantGeneral` — read-only, no data modification.
- Success: restaurant name/address returned from Toast API → credential validation complete.

### Health Endpoints
- Add `api/health_routes.py` — reads live state from `get_orchestrator()`.
- `GET /health` — public, returns `{"status": "ok"}` only.
- `GET /api/v1/health/agents` — requires `X-Admin-Key`, returns all agent statuses.
- `GET /api/v1/health/agents/{name}` — requires `X-Admin-Key`, returns per-agent details: name, status (running/stopped), messages_processed, error_rate, circuit_breaker_state.
- `GET /api/v1/metrics` — requires `X-Admin-Key`, returns DLQ table count, saga_state active count, per-agent message counters.
- Auth pattern: reuse `research_routes.py` line 35 pattern (`X-Admin-Key` header vs `ADMIN_API_KEY` env var).

### React Health Dashboard
- New page `apps/web/src/pages/AdminHealth.tsx` with agent status cards.
- Polls via api-gateway (`VITE_API_GATEWAY_URL`) at `/api/health/agents` every 30s. No ADMIN_API_KEY in frontend — gateway handles auth proxy.
- Route: `/admin/health` — wrapped in `ProtectedRoute`.
- Style: match existing AdminPanel.tsx patterns (motion, lucide icons, sonner toasts).

### Docker / Deployment
- Dockerfile: `services/agent-orchestrator/Dockerfile` — Python 3.11-slim, pip install from requirements.txt, uvicorn entrypoint on port 8000.
- Environment variables injected via Railway dashboard (not committed).
- Create `.env.example` (does NOT exist yet — only `.env` does). Include all required vars: `SENTRY_DSN`, `ENVIRONMENT`, `ADMIN_API_KEY`, `RABBITMQ_URL`, `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_KEY`, all Toast vars.

### Vercel Configuration (new — found in audit)
- Create `vercel.json` at repo root:
  - `framework`: `vite`
  - `buildCommand`: build for `apps/web`
  - `outputDirectory`: `apps/web/dist`
  - `rewrites`: `/api/*` → api-gateway URL (env var `API_GATEWAY_URL`)
- Vercel env vars: `VITE_API_GATEWAY_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

### Migration Strategy
- Run all supabase migrations against Supabase Cloud project (not local).
- Order: v1.0 migrations (phases 1-17) → v2.0 migrations (phases 18-21).
- Verify with `supabase db push --linked` against production project.

## Canonical Refs

- `.planning/REQUIREMENTS.md` — OBS-01..04, DEP-01..06 requirement specs
- `.planning/ROADMAP.md` — Phase 22 success criteria
- `services/agent-orchestrator/main.py` — lifespan hook, FastAPI app (Sentry + health router integration point)
- `services/agent-orchestrator/api/pos_routes.py` — route to refactor for generic provider
- `services/agent-orchestrator/api/research_routes.py:35` — `X-Admin-Key` auth pattern to reuse
- `services/agent-orchestrator/config/settings.py:116` — `self.environment` already exists, reuse for Sentry
- `services/agent-orchestrator/core/orchestrator.py` — agent registry (source of truth for health data)
- `apps/web/src/pages/AdminPanel.tsx` — style/component pattern for AdminHealth.tsx
- `apps/web/src/App.tsx:129` — existing `/admin` route; add `/admin/health` adjacent
- `apps/web/src/components/ProtectedRoute.tsx` — existing auth guard to reuse
- `apps/web/src/services/api/client.ts:11` — `VITE_API_GATEWAY_URL` usage pattern
- `apps/api-gateway/` — NestJS api-gateway (add health proxy module here)
- `supabase/migrations/` — all migration files to apply to Supabase Cloud

## Deferred / Out of Scope

- Wave 2-6 agent hardening (future milestone)
- Multi-restaurant support
- Production monitoring alerting beyond Sentry (PagerDuty, etc.)
- CI/CD pipeline beyond Vercel auto-deploy and Railway GitHub integration
- Square/Clover adapters (POSProvider protocol built now; adapters when needed)
- Toast webhook simulation/load testing against production
- Rate limiting on public /health endpoint (acceptable risk for v1.0)
