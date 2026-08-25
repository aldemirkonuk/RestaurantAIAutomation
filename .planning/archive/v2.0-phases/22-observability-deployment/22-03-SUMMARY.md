---
phase: 22-observability-deployment
plan: "03"
subsystem: agent-orchestrator
tags: [health-endpoints, metrics, dockerfile, railway, observability]
dependency_graph:
  requires: [22-01]
  provides: [health_routes_api, railway_dockerfile]
  affects: [main.py, api/health_routes.py, Dockerfile]
tech_stack:
  added: []
  patterns: [lazy-import-circular-avoidance, httpx-asgi-transport-tests, x-admin-key-auth]
key_files:
  created:
    - services/agent-orchestrator/api/health_routes.py
    - services/agent-orchestrator/Dockerfile
    - services/agent-orchestrator/tests/test_health_routes.py
  modified:
    - services/agent-orchestrator/main.py
decisions:
  - "Used module-level get_orchestrator() lazy proxy in health_routes.py instead of per-handler imports — avoids circular import at load time while keeping the name patchable for tests"
  - "Rewrote tests to use httpx.AsyncClient+ASGITransport (not TestClient) — starlette 0.35.1 is incompatible with httpx 0.28.x TestClient; matches test_cors.py/test_analytics_routes.py pattern"
  - "Dockerfile uses requirements.prod.txt to exclude ~2GB ML/OCR stack (tesseract, YOLO weights) not needed in Railway"
metrics:
  completed_date: "2026-04-13"
  tasks_completed: 2
  tasks_total: 3
  files_created: 3
  files_modified: 1
---

# Phase 22 Plan 03: Health Routes + Railway Dockerfile Summary

**One-liner:** X-Admin-Key–protected health/metrics endpoints and python:3.11-slim Railway Dockerfile using requirements.prod.txt

## What Was Built

### Task 1: api/health_routes.py + main.py registration + test suite (7/7 passed)

**Endpoints created (`services/agent-orchestrator/api/health_routes.py`):**

| Route | Auth | Returns |
|-------|------|---------|
| `GET /api/v1/health/agents` | X-Admin-Key | `{"agents": [...], "count": N}` — calls `agent.get_health()` for each running agent |
| `GET /api/v1/health/agents/{name}` | X-Admin-Key | Full `agent.get_detailed_health()` with messages/timing/circuit_breaker |
| `GET /api/v1/metrics` | X-Admin-Key | `orchestrator.get_metrics()` augmented with `dlq_size` (dead_letter_queue) and `active_sagas` (saga_state WHERE status=running) |

**Auth pattern:** `verify_admin_key()` dependency — mirrors `research_routes.py:34-41`. Returns 401 if header missing or mismatched. Returns 401 if `ADMIN_API_KEY` env var is empty string.

**`GET /health` (public):** NOT redefined here — stays in `main.py:143`. Redefining it would cause FastAPI AssertionError.

**main.py change:** `health_router` imported and registered at the very bottom of `main.py` (after `pos_router`), avoiding circular import since `health_routes.py` lazily imports `get_orchestrator` from `main`.

### Task 2: Railway Dockerfile

```
FROM python:3.11-slim
COPY requirements.prod.txt .
RUN pip install --no-cache-dir -r requirements.prod.txt
COPY . .
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

- **Base:** `python:3.11-slim` (minimal Debian)
- **System deps:** `libpq-dev` (psycopg2), `libglib2.0-0/libsm6/libxext6/libxrender-dev` (pillow), `libgomp1` (numpy), `build-essential` (C extensions)
- **Requirements:** `requirements.prod.txt` — excludes `torch`, `ultralytics` (YOLO), `tesseract`, `weasyprint` (~2GB savings vs `requirements.txt`)
- **PORT:** Shell-form CMD with `${PORT:-8000}` — Railway injects `$PORT` at runtime
- **Secrets:** No `ENV` instructions — all secrets injected by Railway via env vars (T-22-03-03 mitigation)

### Task 3: CloudAMQP + Upstash Setup

**Status: AWAITING USER ACTION (checkpoint:human-action)**

This task requires the user to:
1. Create a CloudAMQP free-tier instance (Little Lemur) → copy `RABBITMQ_URL`
2. Create an Upstash Redis database (Regional, AOF=Yes, Eviction=No) → copy `REDIS_URL`

Both URLs are needed for Railway environment variables before deployment.

## Test Results

```
7 passed in 0.23s
```

| Test | Status |
|------|--------|
| `test_health_agents_requires_admin_key` | PASSED |
| `test_health_agents_wrong_key_returns_401` | PASSED |
| `test_health_agents_503_without_orchestrator` | PASSED |
| `test_health_agents_returns_agent_list` | PASSED |
| `test_health_agent_by_name_not_found` | PASSED |
| `test_metrics_requires_admin_key` | PASSED |
| `test_metrics_returns_dlq_size_key` | PASSED |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tests rewritten from TestClient to httpx.AsyncClient+ASGITransport**
- **Found during:** Task 1, Step A (TDD RED → GREEN)
- **Issue:** `starlette 0.35.1` + `httpx 0.28.x` incompatible with `TestClient` (`TypeError: Client.__init__() got an unexpected keyword argument 'app'`)
- **Fix:** Rewrote all 7 tests to use `async def` + `httpx.AsyncClient(transport=httpx.ASGITransport(app=app), ...)` — same pattern used by `test_cors.py` and `test_analytics_routes.py`
- **Files modified:** `tests/test_health_routes.py`
- **Commit:** `4039421`

**2. [Rule 1 - Bug] get_orchestrator() refactored to module-level lazy proxy**
- **Found during:** Task 1, Step B
- **Issue:** Plan's implementation imported `get_orchestrator` inside each handler via `from main import get_orchestrator`. Tests patch `api.health_routes.get_orchestrator` (module-level), but per-handler local imports don't populate the module namespace — patches would have no effect
- **Fix:** Defined a module-level `get_orchestrator()` wrapper function in `health_routes.py` that lazily calls `from main import get_orchestrator as _real; return _real()`. Handlers call `get_orchestrator()` directly without any local import. Module-level name is patchable; lazy body prevents circular import at load time.
- **Files modified:** `services/agent-orchestrator/api/health_routes.py`
- **Commit:** `4039421`

## Infrastructure Status

| Service | Status |
|---------|--------|
| CloudAMQP (RABBITMQ_URL) | Pending user setup |
| Upstash Redis (REDIS_URL) | Pending user setup |

## Commits

| Hash | Message |
|------|---------|
| `4039421` | `feat(22-03): add health & metrics endpoints with X-Admin-Key auth` |
| `7c9c5c3` | `feat(22-03): add Railway production Dockerfile` |

## Self-Check: PASSED

- `services/agent-orchestrator/api/health_routes.py` — FOUND
- `services/agent-orchestrator/Dockerfile` — FOUND
- `services/agent-orchestrator/tests/test_health_routes.py` — FOUND
- Commit `4039421` — FOUND
- Commit `7c9c5c3` — FOUND
