---
phase: 22
slug: observability-deployment
created: "2026-04-13"
status: ready-for-planning
---

# Phase 22: Observability & Deployment — Context

## Phase Goal

Make the system visible and ship it to production. After this phase, the golden path is running live for the friend's Turkish restaurant in San Francisco.

## Requirements In Scope

**Observability (OBS-01..04):**
- OBS-01: Sentry SDK in main.py — `sentry_sdk.init()` with `traces_sample_rate=0.1`, per-agent tags, alert rules (error rate > 5%, response time > 10s)
- OBS-02: Per-agent health endpoints — `GET /api/v1/health/agents` (all), `GET /api/v1/health/agents/{name}` (detailed metrics: messages processed, error rate, circuit breaker state)
- OBS-03: `GET /api/v1/metrics` — DLQ size, active sagas, per-agent message counts
- OBS-04: Business metrics — stock updates/sec, notification delivery rate, report generation time, webhook processing latency

**Frontend (DEP-01):**
- React admin page at `/admin/health` showing agent status cards
- Frontend deployed to Vercel (auto-deploy from git)

**Infrastructure (DEP-02..06):**
- DEP-02: Supabase Cloud — all v1.0 + v2.0 migrations applied
- DEP-03: agent-orchestrator on Railway or Fly.io via Docker ($5-10/mo)
- DEP-04: RabbitMQ on CloudAMQP (free tier)
- DEP-05: Redis on Upstash (free tier, AOF persistence)
- DEP-06: Toast API credentials configured, webhook URL → production endpoint

## Success Criteria (from ROADMAP)

1. Sentry SDK initialized in main.py with per-agent tags and alert rules
2. `GET /api/v1/health/agents` returns health status for all running agents
3. `GET /api/v1/health/agents/{name}` returns detailed metrics (messages processed, error rate, circuit breaker state)
4. `GET /api/v1/metrics` returns DLQ size, active sagas, per-agent message counts
5. React admin page at /admin/health shows agent status cards
6. Frontend live on Vercel (auto-deploy from git)
7. Supabase Cloud database with all v1.0 + v2.0 migrations applied
8. Agent-orchestrator service running on Railway/Fly.io via Docker
9. RabbitMQ running on CloudAMQP, queues created and bound
10. Redis running on Upstash with AOF persistence
11. Toast API credentials configured, webhook URL pointed to production endpoint
12. Friend's restaurant receiving live inventory alerts

## Decisions

### Deployment Platform
- **Python service:** Railway (preferred over Fly.io — simpler GitHub deploy, no CLI required for initial setup). Dockerfile already exists at services/agent-orchestrator or will be created.
- **Frontend:** Vercel — auto-deploy from git, free tier. Monorepo root with `apps/web` as build target.
- **Database:** Supabase Cloud — already in use for local dev; promote to production project.
- **RabbitMQ:** CloudAMQP free tier (Little Lemur — 1M messages/mo, 20 connections).
- **Redis:** Upstash free tier (10K commands/day, AOF persistence enabled).
- **Target cost:** ~$10-20/mo total.

### Observability Approach
- **Sentry:** Add `sentry-sdk[fastapi]` to requirements.txt. Init in main.py before app creation. Per-agent scope via `sentry_sdk.set_tag("agent", agent_name)` in BaseAgent. DSN from env var `SENTRY_DSN`.
- **Health endpoints:** Add `api/health_routes.py` — reads live state from running agent instances via `get_orchestrator()`. Returns agent name, status (running/stopped), messages_processed, error_rate, circuit_breaker_state.
- **Metrics endpoint:** Aggregates from orchestrator: DLQ table count, saga_state active count, per-agent message counters.
- **React health dashboard:** New page `apps/web/src/pages/AdminHealth.tsx` with agent status cards. Polls `GET /api/v1/health/agents` every 30s. Route: `/admin/health`.

### Docker / Deployment
- Dockerfile in `services/agent-orchestrator/` — Python 3.11-slim base, uvicorn entrypoint.
- Environment variables injected via Railway/Fly.io dashboard (not committed).
- `env.example` already documents all required vars (updated in Phase 21).

### Migration Strategy
- Run all supabase migrations against Supabase Cloud project (not local).
- Order: v1.0 migrations (phases 1-17) → v2.0 migrations (phases 18-21).
- Verify with `supabase db push --linked` against production project.

## Canonical Refs

- `.planning/REQUIREMENTS.md` — OBS-01..04, DEP-01..06 requirement specs
- `.planning/ROADMAP.md` — Phase 22 success criteria (12 items)
- `services/agent-orchestrator/main.py` — lifespan hook, FastAPI app (integration point for Sentry + health router)
- `services/agent-orchestrator/api/pos_routes.py` — pattern for new health_routes.py
- `services/agent-orchestrator/config/settings.py` — add SENTRY_DSN, RAILWAY_URL env vars
- `services/agent-orchestrator/core/orchestrator.py` — agent registry (source of truth for health data)
- `apps/web/src/pages/` — existing page pattern for AdminHealth.tsx
- `supabase/migrations/` — all migration files to apply to Supabase Cloud

## Deferred / Out of Scope

- Wave 2-6 agent hardening (future milestone)
- Multi-restaurant support
- Production monitoring alerting beyond Sentry (PagerDuty, etc.)
- CI/CD pipeline beyond Vercel auto-deploy
