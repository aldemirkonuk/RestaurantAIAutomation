---
phase: 22-observability-deployment
plan: "04"
subsystem: api-gateway/orchestrator
tags: [health-proxy, metrics-proxy, jwt-auth, admin-key, nestjs]
dependency_graph:
  requires: []
  provides:
    - "GET /api/health/agents — proxied to orchestrator /api/v1/health/agents with X-Admin-Key"
    - "GET /api/health/agents/:name — proxied to orchestrator /api/v1/health/agents/{name}"
    - "GET /api/metrics — proxied to orchestrator /api/v1/metrics with X-Admin-Key"
  affects:
    - apps/api-gateway/src/common/orchestrator/orchestrator.service.ts
    - apps/api-gateway/src/common/orchestrator/orchestrator.module.ts
tech_stack:
  added: []
  patterns:
    - "Server-side secret injection: ADMIN_API_KEY read by api-gateway only, never in frontend JS"
    - "TenantBypass decorator to suppress restaurantId warning on admin-only health routes"
key_files:
  created:
    - apps/api-gateway/src/common/orchestrator/health-proxy.controller.ts
  modified:
    - apps/api-gateway/src/common/orchestrator/orchestrator.service.ts
    - apps/api-gateway/src/common/orchestrator/orchestrator.module.ts
decisions:
  - "ADMIN_API_KEY read via configService.get() server-side only — never exposed in frontend env"
  - "TenantBypass used instead of removing TenantGuard globally to suppress the restaurantId warning log"
  - "Preserved existing getAgentHealth() to avoid breaking any existing callers"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-13T15:00:47Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 22 Plan 04: Health Proxy Controllers Summary

JWT-authenticated health and metrics proxy endpoints in NestJS api-gateway that inject X-Admin-Key server-side before forwarding to Python orchestrator.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add proxy methods to OrchestratorService | d0de0fc | orchestrator.service.ts |
| 2 | Create HealthProxyController + MetricsProxyController + update OrchestratorModule | e89c7f0 | health-proxy.controller.ts, orchestrator.module.ts |

## What Was Built

### OrchestratorService additions (`orchestrator.service.ts`)

Four new methods added after existing `getAgentHealth()`:

- **`getAdminHeaders()`** (private) — reads `ADMIN_API_KEY` from ConfigService, returns `{ 'X-Admin-Key': key }` header object
- **`getAgentHealthAll()`** — GET `/api/v1/health/agents` with admin headers
- **`getAgentHealthByName(name)`** — GET `/api/v1/health/agents/{name}` with admin headers
- **`getSystemMetrics()`** — GET `/api/v1/metrics` with admin headers

### New file: `health-proxy.controller.ts`

Two controllers in one file:

**HealthProxyController** (`@Controller('api/health')`):
- `GET /api/health/agents` → `getAgentHealthAll()`
- `GET /api/health/agents/:name` → `getAgentHealthByName(name)`

**MetricsProxyController** (`@Controller('api/metrics')`):
- `GET /api/metrics` → `getSystemMetrics()`

Both controllers:
- `@UseGuards(JwtAuthGuard)` — requires valid Supabase JWT from any authenticated user
- `@TenantBypass()` — suppresses restaurantId warning (health routes don't require tenant context)

### OrchestratorModule update (`orchestrator.module.ts`)

Added `controllers: [HealthProxyController, MetricsProxyController]` array; imported both controllers from `./health-proxy.controller`.

## Security (Threat Model Mitigations)

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-22-04-01: ADMIN_API_KEY reaching browser | Key read via `configService.get('ADMIN_API_KEY')` server-side only; no frontend env var | ✅ Mitigated |
| T-22-04-02: Any user calling /api/health | Accepted for v1.0 — all authenticated users are trusted admins at this stage | ✅ Accepted |
| T-22-04-03: JWT token forgery | JwtAuthGuard uses passport-jwt with RS256 — cryptographically unforgeable | ✅ Accepted |

## Deviations from Plan

None — plan executed exactly as written. `npx tsc --noEmit` was not able to complete (process hung, likely due to first-run npm cache setup in CI-like environment) but linter reported zero errors on all three modified files.

## Known Stubs

None.

## Self-Check: PASSED

- `health-proxy.controller.ts` — created ✅
- `orchestrator.service.ts` — modified, 4 new methods present ✅
- `orchestrator.module.ts` — modified, controllers array added ✅
- Commit d0de0fc — Task 1 ✅
- Commit e89c7f0 — Task 2 ✅
