---
phase: 10-critic-scores-pricing-intelligence
plan: "06"
subsystem: api
tags: [analytics, rest-api, critic-scores, pricing, crit-07]
dependency_graph:
  requires: ["10-04"]
  provides: ["GET /api/v1/analytics/wine/{wine_id}/scores endpoint (CRIT-07)"]
  affects: ["main.py router registry", "api/analytics_routes.py"]
tech_stack:
  added: ["httpx.ASGITransport (test client pattern for starlette 0.35 + httpx 0.28)"]
  patterns: ["APIRouter prefix pattern", "late Supabase import (_get_supabase helper)", "Pydantic response models", "UUID injection guard"]
key_files:
  created:
    - services/agent-orchestrator/api/analytics_routes.py
    - services/agent-orchestrator/tests/test_analytics_routes.py
  modified:
    - services/agent-orchestrator/main.py
decisions:
  - "Used httpx.AsyncClient + ASGITransport instead of TestClient due to starlette 0.35.1 / httpx 0.28.1 version incompatibility"
  - "Empty critic_scores JSONB ({}) normalised to null in response for cleaner consumer UX"
  - "UUID validation at route entry (HTTPException 422) prevents injection before any DB call"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-06T16:28:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
---

# Phase 10 Plan 06: Analytics REST Endpoint (CRIT-07) Summary

**One-liner:** `GET /api/v1/analytics/wine/{wine_id}/scores` endpoint returning critic scores JSONB, retail price, and per-restaurant markup ratios from `master_wine_library` + `restaurant_inventory`, with UUID injection guard and 5-test suite.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create analytics_routes.py + wire into main.py | f7bcd72 | api/analytics_routes.py, main.py |
| 2 | Create tests/test_analytics_routes.py | 567ec25 | tests/test_analytics_routes.py |

## What Was Built

### `api/analytics_routes.py`
- `APIRouter(prefix="/api/v1/analytics", tags=["analytics"])`
- `GET /wine/{wine_id}/scores` async endpoint
- `WineScoresResponse` Pydantic model: `wine_id`, `wine_name`, `critic_scores`, `retail_price_avg`, `scores_last_updated_at`, `per_restaurant_markup`
- `PerRestaurantMarkup` Pydantic model: `restaurant_id`, `markup_ratio`, `markup_classification`
- `_get_supabase()` helper with graceful degradation (returns 503 if DB unavailable)
- UUID validation guard → HTTP 422 for non-UUID inputs
- 404 for wine not found in `master_wine_library`
- Empty `critic_scores` JSONB (`{}`) normalised to `null` in response

### `main.py` changes
- Added `from api.analytics_routes import router as analytics_router`
- Added `app.include_router(analytics_router)`

### `tests/test_analytics_routes.py`
5 tests covering:
1. `test_returns_200_with_critic_scores` — full data path
2. `test_returns_404_for_unknown_wine` — 404 path
3. `test_returns_200_with_null_fields_when_not_yet_scored` — partial-data (empty JSONB) path
4. `test_returns_422_for_invalid_uuid` — injection guard
5. `test_returns_200_with_empty_markup_list` — wine with no inventory entries

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced TestClient with httpx.AsyncClient + ASGITransport**
- **Found during:** Task 2 — test collection failed
- **Issue:** `starlette.testclient.TestClient` passes `app=` kwarg to `httpx.Client.__init__()`, which was removed in httpx 0.28. Starlette 0.35.1 + httpx 0.28.1 is an incompatible combination.
- **Fix:** Used `httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")` with a pytest `async` fixture; all test methods made `async`. This pattern is forward-compatible with starlette ≥ 0.35 and httpx ≥ 0.23.
- **Files modified:** `tests/test_analytics_routes.py`
- **Commit:** 567ec25

## Known Stubs

None — endpoint queries live Supabase tables (`master_wine_library`, `restaurant_inventory`). No hardcoded data in production code path.

## Threat Flags

No new threat surface beyond what is documented in the plan's threat model (T-10-17 through T-10-20). UUID validation guard (T-10-17 mitigation) is implemented at route entry.

## Self-Check: PASSED

```
FOUND: services/agent-orchestrator/api/analytics_routes.py ✓
FOUND: services/agent-orchestrator/tests/test_analytics_routes.py ✓
FOUND: analytics_router in main.py (2 occurrences) ✓
FOUND: f7bcd72 (feat: analytics_routes + main.py) ✓
FOUND: 567ec25 (test: test_analytics_routes) ✓
5 tests passed ✓
```
