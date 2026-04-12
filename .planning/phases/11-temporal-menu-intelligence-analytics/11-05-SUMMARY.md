---
phase: 11-temporal-menu-intelligence-analytics
plan: "05"
subsystem: analytics-api
tags: [analytics, trends, temporal, api, endpoints, pydantic, tests]
dependency_graph:
  requires: ["11-04"]
  provides: ["GET /analytics/trends", "GET /analytics/wine/{id}/timeline", "TEMP-07", "TEMP-08"]
  affects: ["services/agent-orchestrator/api/analytics_routes.py", "services/agent-orchestrator/tests/test_temporal_analytics.py"]
tech_stack:
  added: []
  patterns: ["FastAPI router extension", "Pydantic response models", "UUID validation guard (V5)", "ILIKE metro filter", "defaultdict aggregation", "httpx.AsyncClient + ASGITransport tests"]
key_files:
  created: ["services/agent-orchestrator/tests/test_temporal_analytics.py"]
  modified: ["services/agent-orchestrator/api/analytics_routes.py"]
decisions:
  - "Used httpx.AsyncClient + ASGITransport for tests instead of TestClient (starlette 0.35/httpx 0.28 incompatibility — TestClient passes 'app' kwarg which httpx 0.28 rejects)"
  - "Moved 'from collections import defaultdict' to module-level import for cleaner code"
  - "Metro filter degrades gracefully: exception → metro_wine_ids=None → no filter applied (never blocks response)"
  - "Aggregation breakdowns (category/grape/region) built from defaultdict pass with net_delta = additions - removals"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-06T18:09:37Z"
  tasks_completed: 2
  files_changed: 2
---

# Phase 11 Plan 05: Temporal Analytics API Endpoints Summary

**One-liner:** Two FastAPI analytics endpoints (`GET /trends` + `GET /wine/{id}/timeline`) with 7 Pydantic models and 11 passing unit tests covering TEMP-07 and TEMP-08.

## Objective Achieved

Extended `analytics_routes.py` with two user-facing endpoints that expose the Phase 11 temporal intelligence data:

- `GET /api/v1/analytics/trends?metro=chicago&period=90d` — returns velocity-ranked trending wines with `trending_up`, `trending_down`, `category_shifts`, `grape_trends`, and `region_shifts`
- `GET /api/v1/analytics/wine/{id}/timeline` — returns a wine's full temporal lifecycle (name, first/last seen, restaurants carrying, price history, menu changes)

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Add GET /analytics/trends + Pydantic models | `313cfa1` | `analytics_routes.py` |
| 2 | Add GET /wine/{id}/timeline + test_temporal_analytics.py | `95bb0fa` | `analytics_routes.py`, `test_temporal_analytics.py` |

## Implementation Details

### New Pydantic Models (7)

| Model | Purpose |
|-------|---------|
| `TrendingWineItem` | Single wine entry in trending_up or trending_down list |
| `CategoryShiftItem` | Per-type aggregation with additions/removals/net_delta |
| `GrapeTrendItem` | Per-grape-variety aggregation |
| `RegionShiftItem` | Per-region aggregation |
| `TrendsResponse` | Top-level response wrapping all 5 trend lists |
| `WineTimelineResponse` | Full lifecycle: name, dates, carrying count, price history, menu changes |
| *(existing)* `WineScoresResponse` | Unchanged — CRIT-07 endpoint untouched |

### GET /analytics/trends

- Period validation: `_PERIOD_MAP = {"30d": 30, "60d": 60, "90d": 90}` — invalid period → `400`
- Metro filter: ILIKE on `restaurant_directory.city` → roster lookup → submission resolve → filter trending_wines
- Metro filter degrades gracefully on exception (logs warning, ignores metro)
- Breakdown aggregations via `defaultdict`: iterates trending_wines rows, classifies by `primary_type`, `grape_variety`, `region` from `master_wine_library` join
- Results sorted by net_delta descending

### GET /analytics/wine/{id}/timeline

- UUID validation guard → `422` for non-UUID (matches `get_wine_scores` pattern)
- `master_wine_library` lookup → `404` for unknown wine
- Signature hash resolution via `master_wine_library_submissions`
- `wine_popularity` → `restaurants_currently_carrying`
- `restaurant_wine_roster` → `first_seen_at`, `last_seen_at`, `price_history`
- `menu_changes` → full event history (limit 200, ordered by `detected_at` desc)

### Threat Mitigations Applied

| Threat | Mitigation |
|--------|-----------|
| T-11-05-01: SQL injection via metro | supabase-py `.ilike()` uses parameterized binding |
| T-11-05-02: UUID injection | `uuid.UUID(wine_id)` guard raises 422 |
| T-11-05-03: arbitrary period string | `if period not in _PERIOD_MAP` → 400 |
| T-11-05-04: DoS via large metro set | 100-row limit on trending_wines query |

## Test Coverage (11 tests — all passing)

| Test | Coverage |
|------|---------|
| `test_trends_returns_200_with_valid_period` | 200 with period=30d |
| `test_trends_invalid_period_returns_400` | 400 for period=7d |
| `test_trends_invalid_period_14d_returns_400` | 400 for period=14d |
| `test_trends_with_metro_param_returns_200` | metro=chicago, 200 with empty lists |
| `test_trends_response_has_all_schema_fields` | All 5 trend lists present in response |
| `test_trends_breakdown_fields_structure` | name/additions/removals/net_delta per breakdown item |
| `test_trends_default_period_is_90d` | Omitting period defaults to 90d |
| `test_timeline_returns_200_for_valid_wine` | 200 with wine_id and wine_name |
| `test_timeline_returns_404_for_unknown_wine` | 404 for missing wine |
| `test_timeline_returns_422_for_non_uuid` | 422 for "not-a-uuid" |
| `test_timeline_returns_422_for_short_string` | 422 for "12345" |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TestClient incompatible with httpx 0.28**
- **Found during:** Task 2 test execution
- **Issue:** `TestClient(app)` raises `TypeError: Client.__init__() got an unexpected keyword argument 'app'` — starlette 0.35.1 passes `app=` kwarg to httpx 0.28 Client which no longer accepts it
- **Fix:** Rewrote tests using `httpx.AsyncClient(transport=httpx.ASGITransport(app=_app))` — same pattern as existing `test_analytics_routes.py`; switched to async test functions with `asyncio: mode=Mode.AUTO` (already configured in pytest.ini)
- **Files modified:** `services/agent-orchestrator/tests/test_temporal_analytics.py`
- **Commit:** `95bb0fa`

**2. [Rule 1 - Cleanup] Moved defaultdict import to module level**
- **Found during:** Task 1 code review
- **Issue:** Plan placed `from collections import defaultdict` inside the function body
- **Fix:** Moved to module-level import alongside other `from` imports — cleaner and consistent with Python conventions
- **Commit:** `313cfa1`

## Known Stubs

None — both endpoints read from pre-computed tables (`trending_wines`, `wine_popularity`, `restaurant_wine_roster`, `menu_changes`) and return real data. Empty lists are valid responses when no data exists.

## Threat Flags

None — no new trust boundaries introduced beyond what the plan's threat model covers.

## Self-Check: PASSED

- `services/agent-orchestrator/api/analytics_routes.py` exists: FOUND
- `services/agent-orchestrator/tests/test_temporal_analytics.py` exists: FOUND
- Commits `313cfa1` and `95bb0fa`: FOUND
- 11 tests passing: VERIFIED (pytest exit 0)
