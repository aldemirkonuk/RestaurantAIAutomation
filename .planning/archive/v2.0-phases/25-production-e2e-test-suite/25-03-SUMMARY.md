---
phase: 25-production-e2e-test-suite
plan: "03"
subsystem: e2e-test-waves
tags: [e2e, production, api-contracts, agent-health, pytest, httpx, railway]
dependency_graph:
  requires:
    - "25-02 (conftest_prod.py — prod_base_url, prod_jwt, prod_admin_headers, get_with_retry)"
  provides:
    - "wave_a_api_contracts.py — Wave A API contract tests (TEST-PROD-01)"
    - "wave_b_agent_health.py — Wave B agent health tests (TEST-PROD-02)"
  affects:
    - "services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py (new)"
    - "services/agent-orchestrator/tests/e2e/wave_b_agent_health.py (new)"
    - "services/agent-orchestrator/pytest.ini (prod_e2e marker registered)"
tech_stack:
  added: []
  patterns:
    - "pytestmark = pytest.mark.prod_e2e — session-level marker applied to all tests in file"
    - "asyncio_mode=auto — all async test methods collected without @pytest.mark.asyncio"
    - "get_with_retry from conftest_prod — 3-attempt exponential backoff on every production HTTP call"
    - "_extract_agents + _agent_is_healthy helpers — normalize heterogeneous health response shapes"
    - "Parametrized auth gate tests — single pytest.mark.parametrize covers all JWT/admin endpoints"
key_files:
  created:
    - "services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py"
    - "services/agent-orchestrator/tests/e2e/wave_b_agent_health.py"
  modified:
    - "services/agent-orchestrator/pytest.ini"
decisions:
  - "prod_e2e marker added to pytest.ini — --strict-markers would cause collection failure without it; auto-fixed as Rule 2 deviation"
  - "_extract_agents normalizes both list and dict({agents:[...]}) response shapes — health_routes.py returns {agents:[...], count:N}; helper future-proofs against shape changes"
  - "_agent_is_healthy accepts healthy:True (boolean) OR status in (active, healthy, running, ok) — accommodates both current BaseAgent.get_health() and any future convention"
  - "POST /onboarding/extract and /preview/detect send json=None → 422 to confirm router registration without writing data (T-25-03-02 threat mitigation)"
  - "per-agent health test accepts 200 or 404 — agent may be registered under a different key than the name string; 404 is not a failure, 500 is"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-05-02"
  tasks_completed: 2
  files_changed: 3
---

# Phase 25 Plan 03: Wave A & Wave B API Contract + Agent Health Tests Summary

**One-liner:** Wave A contract tests validate all 9 registered router prefixes (401 without auth, 200 with auth, zero 500s); Wave B verifies all 9 agents present in health endpoint response with ≥7/9 healthy pass bar enforced.

## What Was Built

### Task 1 — wave_a_api_contracts.py (new)

`services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py` created with `pytestmark = pytest.mark.prod_e2e` and three test classes:

**TestPublicEndpoints (2 tests)**
- `test_health_check_public`: GET /health → 200 with `{"status": "ok"}` — no auth, uses `get_with_retry`
- `test_unknown_route_404`: GET /api/v1/nonexistent-e2e-probe → 404 (FastAPI default)

**TestUnauthenticatedReturns401 (2 parametrized tests, 6 cases)**
- `test_user_jwt_endpoint_requires_auth`: parametrized over `/quality/review-queue`, `/analytics/trends`, `/studio/queue` → 401/403 without Bearer token
- `test_admin_key_endpoint_requires_auth`: parametrized over `/research/metrics`, `/health/agents`, `/metrics` → 401/403 without X-Admin-Key

**TestAuthenticatedEndpoints (5 tests)**
- `test_user_jwt_endpoints_accessible`: 3 JWT endpoints → 200/204 with valid Bearer token; no 500
- `test_admin_key_endpoints_accessible`: 3 admin endpoints → 200 with X-Admin-Key; no 500
- `test_onboarding_router_reachable`: POST /onboarding/extract with json=None → not 404, not 500 (confirms router registration)
- `test_preview_router_reachable`: POST /preview/detect with json=None → not 404 (no auth required for probe)
- `test_per_agent_health_detail`: GET /health/agents/inventory_engine → 200 or 404 (not 401, not 500)

All network calls go through `get_with_retry` (3-attempt tenacity backoff, 2–10s delay per conftest_prod.py).

### Task 2 — wave_b_agent_health.py (new)

`services/agent-orchestrator/tests/e2e/wave_b_agent_health.py` created with `pytestmark = pytest.mark.prod_e2e` and one test class:

**TestAgentHealth (4 tests)**
- `test_health_endpoint_returns_200`: GET /api/v1/health/agents with X-Admin-Key → 200; diagnostic messages distinguish 503 (orchestrator down) from 401 (key mismatch)
- `test_all_9_agents_present`: extracts agent list from response, asserts all 9 names present; reports missing names and actual names on failure
- `test_minimum_7_agents_healthy`: enforces D-10 pass bar — ≥7/9 agents with `healthy: True` or `status in (active, healthy, running, ok)`; reports unhealthy agent names and full response on failure
- `test_per_agent_health_detail`: parametrized over all 9 agent names; GET /health/agents/{name} → 200 or 404 (not 500); 9 individual test cases

**Helper functions:**
- `_extract_agents(data)`: normalizes `{"agents": [...]}`, `{"data": [...]}`, `{"health": [...]}`, `{"results": [...]}`, and plain `list` shapes
- `_agent_is_healthy(agent)`: accepts `healthy: True` (boolean) OR `status` string in `("active", "healthy", "running", "ok")`; case-insensitive

### Rule 2 Deviation — pytest.ini prod_e2e marker

`pytest.ini` markers section updated to register `prod_e2e`. Without this, `--strict-markers` (in `addopts`) would cause collection failure for both wave files. This is a correctness requirement, not a feature.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Registered prod_e2e marker in pytest.ini**
- **Found during:** Task 1 (pre-write review of pytest.ini)
- **Issue:** pytest.ini has `--strict-markers` in addopts. `prod_e2e` was not registered. Both wave files set `pytestmark = pytest.mark.prod_e2e`. Collection would fail with `PytestUnknownMarkWarning` → error.
- **Fix:** Added `prod_e2e: marks tests as production E2E tests requiring live Railway + Supabase credentials` to the markers section
- **Files modified:** `services/agent-orchestrator/pytest.ini`
- **Commit:** `7fb5d90`

## Known Stubs

None — test files make live HTTP calls to production endpoints; no hardcoded response stubs.

## Threat Surface

Verified mitigations from plan threat register:

| Threat ID | Mitigation | Evidence |
|-----------|------------|---------|
| T-25-03-01 | prod_admin_headers fixture reads ADMIN_API_KEY from env; key never asserted on or printed in failure messages | `prod_admin_headers` dict passed to headers only; failure messages print `resp.text[:200/300]` (response body, not request headers) |
| T-25-03-02 | Wave A uses GET-only for auth-protected endpoints; POST probes send `json=None` → 422 (no data written) | `client.post("/api/v1/onboarding/extract", json=None)` and `client.post("/api/v1/preview/detect", json=None)` |
| T-25-03-03 | get_with_retry: max 3 attempts, 2–10s exponential backoff (from conftest_prod.py); all probes use 15–20s timeout | `get_with_retry` from `conftest_prod.py:make_retry_decorator()` applied on every call |

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1 | `7fb5d90` | `services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py`, `services/agent-orchestrator/pytest.ini` |
| Task 2 | `03ffc08` | `services/agent-orchestrator/tests/e2e/wave_b_agent_health.py` |

## Self-Check: PASSED

- `services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py` ✓ (exists, syntax OK, 154 lines)
- `services/agent-orchestrator/tests/e2e/wave_b_agent_health.py` ✓ (exists, syntax OK, 134 lines)
- `services/agent-orchestrator/pytest.ini` ✓ (prod_e2e marker registered)
- `.planning/phases/25-production-e2e-test-suite/25-03-SUMMARY.md` ✓ (this file)
- `7fb5d90` ✓ (visible in `git log --oneline -5`)
- `03ffc08` ✓ (visible in `git log --oneline -5`)
