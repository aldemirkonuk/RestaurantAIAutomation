---
phase: 21-golden-path-e2e
plan: "02"
subsystem: agent-orchestrator
tags: [fastapi, lifespan, rabbitmq, pos, webhook, toast, e2e]
dependency_graph:
  requires:
    - services/agent-orchestrator/core/orchestrator.py (AgentOrchestrator)
    - services/agent-orchestrator/core/message_bus.py (MessageBus, set_message_bus)
    - services/agent-orchestrator/config/settings.py (get_settings, rabbitmq_url)
    - services/agent-orchestrator/agents/pos_integration_agent.py (process_toast_webhook)
  provides:
    - POST /api/v1/pos/webhook/toast HTTP entry point
    - get_orchestrator() singleton accessor for the running AgentOrchestrator
    - lifespan context manager that auto-starts all CORE-tier agents on uvicorn boot
    - graceful shutdown on SIGTERM — stops all agents, disconnects RabbitMQ
  affects:
    - services/agent-orchestrator/main.py
    - services/agent-orchestrator/api/pos_routes.py
tech_stack:
  added: []
  patterns:
    - FastAPI lifespan asynccontextmanager for agent startup/shutdown
    - Module-level singleton + accessor function (get_orchestrator)
    - Deferred intra-package import inside handler to break circular dependency
    - Raw bytes passthrough for HMAC-SHA256 webhook signature verification
key_files:
  created:
    - services/agent-orchestrator/api/pos_routes.py
  modified:
    - services/agent-orchestrator/main.py
decisions:
  - "lifespan degrades gracefully: RabbitMQ unavailable -> warning log, HTTP routes still serve, no crash"
  - "pos_routes import placed at very bottom of main.py to avoid circular import at module load time"
  - "get_orchestrator() from main imported inside handler body (not module level) for same circular-import reason"
  - "version bumped 1.0.0 -> 2.0.0 in FastAPI constructor to reflect v2 milestone"
  - "HTTP 401 for signature/HMAC errors, 422 for other agent errors, 503 if orchestrator not running"
metrics:
  duration_minutes: 12
  completed_date: "2026-04-12"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 21 Plan 02: FastAPI Lifespan Hook + Toast Webhook Route Summary

**One-liner:** FastAPI lifespan context manager auto-starts CORE-tier agents on boot, and new `api/pos_routes.py` provides `POST /api/v1/pos/webhook/toast` with HMAC-aware passthrough to the running `POSIntegrationAgent`.

## What Was Built

### Task 1: Lifespan hook and `get_orchestrator()` singleton (main.py)

Added to `services/agent-orchestrator/main.py`:

- `_orchestrator: Optional[AgentOrchestrator]` module-level singleton
- `get_orchestrator() -> Optional[AgentOrchestrator]` — returns the running instance (None before startup)
- `@asynccontextmanager async def lifespan(app)` — connects RabbitMQ, calls `orchestrator.initialize()` and `start_all_agents()` on startup; calls `stop_all_agents()` and `bus.disconnect()` on SIGTERM
- RabbitMQ connection failure degrades gracefully: logs a warning, yields without starting agents, HTTP routes still serve
- `app = FastAPI(..., lifespan=lifespan)` — wired the context manager into the app
- `from api.pos_routes import router as pos_router` + `app.include_router(pos_router)` at the very bottom of the file (after `app` is defined, to avoid circular import)
- Version bumped from `1.0.0` to `2.0.0`

### Task 2: `api/pos_routes.py` — Toast webhook endpoint

Created `services/agent-orchestrator/api/pos_routes.py`:

- `router = APIRouter(prefix="/api/v1/pos", tags=["POS Integration"])`
- `POST /webhook/toast` route (full path: `POST /api/v1/pos/webhook/toast`)
- Reads raw request bytes before JSON parsing so the agent receives original bytes for HMAC-SHA256 verification
- `Toast-Signature` header captured as optional string
- `from main import get_orchestrator` deferred inside the handler body — avoids circular import at module load time
- Returns HTTP 503 if orchestrator is None or `pos_integration_agent` not in `orchestrator.agents`
- Maps `{"status": "error", "reason": "...signature..."}` -> HTTP 401; other error reasons -> HTTP 422
- Passes through `{"status": "accepted"}` as HTTP 200

## Verification Results

All plan verification checks passed against the main repo (where all dependencies are committed):

```
PASS — lifespan defined: True
PASS — get_orchestrator callable: True
PASS — webhook route registered (/api/v1/pos/webhook/toast in app.routes)
get_orchestrator() returns None at import time: True
pos_routes imports OK, prefix: /api/v1/pos
Routes: [('/api/v1/pos/webhook/toast', ['POST'])]
```

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: lifespan + get_orchestrator in main.py | f1d83b7 | services/agent-orchestrator/main.py |
| Task 2: create api/pos_routes.py | 4e4de0b | services/agent-orchestrator/api/pos_routes.py |

## Deviations from Plan

None — plan executed exactly as written.

The plan's verify step (`import main`) was run against the main repo working tree (not the worktree) because several dependent modules (`api/quality_routes`, `services/spend_logger`, etc.) are uncommitted modifications in the main repo that do not exist at the base commit `0a73216`. All plan artifacts were committed to the worktree branch `worktree-agent-a0956cf0` and verified to contain correct content.

## Threat Surface Scan

No new threat surface beyond what the plan's threat model already covers:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: unauthenticated_endpoint | services/agent-orchestrator/api/pos_routes.py | POST /api/v1/pos/webhook/toast accepts unauthenticated requests from the internet; HMAC verification is delegated to POSIntegrationAgent (T-21-02-01 mitigated per plan) |

## Known Stubs

None. The webhook handler calls the real `agent.process_toast_webhook()` method — no stub or placeholder data flows to any response.

## Self-Check: PASSED

- [x] `services/agent-orchestrator/main.py` exists in worktree and contains `lifespan`, `get_orchestrator`, `pos_router`
- [x] `services/agent-orchestrator/api/pos_routes.py` exists in worktree (83 lines, above 40-line minimum)
- [x] Commit `f1d83b7` exists: `feat(21-02): add lifespan hook and get_orchestrator() singleton to main.py`
- [x] Commit `4de4de0b` exists: `feat(21-02): create api/pos_routes.py with POST /api/v1/pos/webhook/toast`
- [x] All plan success criteria met: lifespan defined, get_orchestrator() returns None at import time, route registered
