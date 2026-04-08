---
phase: 14-comprehensive-e2e-testing-error-resilience
plan: "01"
subsystem: testing
tags: [e2e, pytest, extraction-pipeline, health-checks, report-generator]
dependency_graph:
  requires: []
  provides: [e2e-test-framework, extraction-pipeline-tests, health-tests, json-report]
  affects: [services/agent-orchestrator/tests/e2e/]
tech_stack:
  added: []
  patterns: [pytest-plugin-pattern, mock-supabase-factory, jwt-factory, parametrized-router-tests]
key_files:
  created:
    - services/agent-orchestrator/tests/e2e/__init__.py
    - services/agent-orchestrator/tests/e2e/conftest_e2e.py
    - services/agent-orchestrator/tests/e2e/conftest.py
    - services/agent-orchestrator/tests/e2e/report_generator.py
    - services/agent-orchestrator/tests/e2e/test_health.py
    - services/agent-orchestrator/tests/e2e/test_extraction_pipeline.py
  modified: []
decisions:
  - "conftest.py (not conftest_e2e.py) registers E2EReportGenerator — pytest auto-loads conftest.py files; conftest_e2e.py is a reusable fixture module"
  - "tests/e2e/ uses e2e.* import paths (tests/ on sys.path) instead of tests.e2e.* (no tests/__init__.py)"
  - "Router registration tests probe real endpoints (e.g. /api/v1/quality/review-queue) not prefix roots — prefix roots have no index route"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-08"
  tasks_completed: 2
  files_created: 6
---

# Phase 14 Plan 01: E2E Test Infrastructure + Extraction Pipeline Summary

**One-liner:** Mock-only E2E test framework with per-table Supabase factory, JWT factory, JSON report plugin, plus 13 tests covering health checks and the full extraction → field_confidence → review_queue → Haiku pipeline.

## What Was Built

### Task 1: E2E Test Infrastructure

**`tests/e2e/__init__.py`** — Empty package marker enabling `e2e.*` imports.

**`tests/e2e/conftest_e2e.py`** — Reusable fixture module providing:
- `mock_supabase_tables(table_map)` — factory that builds a Supabase MagicMock dispatching `.table(name)` to per-table mocks
- `jwt_factory` — closure returning `make_jwt(payload, secret="e2e-secret") → str`; module-level constants: `DEVELOPER_JWT_PAYLOAD`, `ADMIN_JWT_PAYLOAD`, `CONTRIBUTOR_JWT_PAYLOAD`
- `e2e_settings` — mock settings with `supabase_jwt_secret`, `supabase_url`, `supabase_key`, email fields
- `mock_extraction_result` — 3-wine `ClaudeExtractionResult` with field_confidence at 4 confidence tiers (0.95/0.88/0.65/0.45)

**`tests/e2e/conftest.py`** — Auto-loaded by pytest; re-exports all `conftest_e2e` fixtures; registers `E2EReportGenerator` plugin via `pytest_configure`.

**`tests/e2e/report_generator.py`** — `E2EReportGenerator` pytest plugin:
- `pytest_runtest_makereport`: captures nodeid, outcome, duration, error (message + traceback)
- `pytest_sessionfinish`: writes `test-results/e2e-report.json` with generated_at, total/passed/failed/skipped counts, and per-test records
- Threat T-14-01: Authorization headers never written to report

### Task 2: Health Checks + Extraction Pipeline Tests

**`tests/e2e/test_health.py`** — 8 tests:
- `test_health_endpoint_returns_ok`: GET /health → 200 `{status: ok}`
- `test_unknown_route_returns_404`: GET /api/v1/nonexistent → 404
- `test_all_router_prefixes_reachable[*]` × 6: parametrized across all router prefixes confirming non-404

**`tests/e2e/test_extraction_pipeline.py`** — 5 tests in `TestExtractionPipelineE2E`:
1. `test_extraction_creates_submission_with_field_confidence`: verifies insert called with `field_confidence` JSONB + `auto_blocked` + Haiku delay
2. `test_extraction_routes_mid_confidence_to_review_queue`: verifies `field_review_queue.insert()` called with region (0.65) entry having `status=pending`
3. `test_extraction_rejects_below_threshold`: verifies country (0.35) present in `field_confidence` JSONB but absent from flat payload
4. `test_extraction_per_restaurant_cap_returns_402`: mocks $3.00 spend → 402 with "cap" in detail
5. `test_extraction_missing_images_returns_422`: null images + null pdf_base64 → 422

## Test Results

```
13 passed in 3.67s
```

JSON report: `test-results/e2e-report.json` — 13 tests, all passed, per-test duration and timestamps.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] conftest.py auto-load wrapper**
- **Found during:** Task 1
- **Issue:** pytest does not auto-load `conftest_e2e.py` (non-standard name); fixtures would be invisible to test files without a proper `conftest.py`
- **Fix:** Created `tests/e2e/conftest.py` that re-exports all fixtures from `conftest_e2e.py` and registers the plugin via `pytest_configure`
- **Files modified:** `tests/e2e/conftest.py` (new)

**2. [Rule 1 - Bug] Router prefix test used prefix roots (returned 404)**
- **Found during:** Task 2, first test run
- **Issue:** GET `/api/v1/onboarding` returned 404 — routers don't have index routes at their prefix root
- **Fix:** Changed parametrize list to probe real sub-endpoints (e.g. `/api/v1/quality/review-queue`) using the correct HTTP method
- **Files modified:** `tests/e2e/test_health.py`

**3. [Rule 1 - Bug] `tests.e2e.*` import path failed without `tests/__init__.py`**
- **Found during:** Task 1 import verification
- **Issue:** Python 3 namespace packages require a `tests/__init__.py` for `tests.e2e.report_generator` style imports to work
- **Fix:** Used `tests/` on sys.path → `e2e.report_generator` import style instead; consistent with how conftest.py adds project root to sys.path
- **Files modified:** `tests/e2e/conftest.py`

## Key Decisions

| Decision | Reason |
|----------|--------|
| conftest.py registers plugin (not conftest_e2e.py) | pytest only auto-loads files named `conftest.py`; `conftest_e2e.py` is a reusable fixture module imported explicitly |
| Probe real endpoints, not prefix roots | Router prefix roots (e.g. `/api/v1/onboarding`) have no index route — return 404 even when router is registered |
| e2e.* import paths (tests/ on sys.path) | Avoids requiring tests/__init__.py which could affect existing test discovery |

## Known Stubs

None — all fixtures produce real structured data and all assertions verify actual behavior.

## Threat Flags

None — test files contain no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

Files verified:
- `tests/e2e/__init__.py` ✓
- `tests/e2e/conftest_e2e.py` ✓
- `tests/e2e/conftest.py` ✓
- `tests/e2e/report_generator.py` ✓
- `tests/e2e/test_health.py` ✓
- `tests/e2e/test_extraction_pipeline.py` ✓

Commits verified:
- `42b1b3b`: feat(14-01): E2E test infrastructure — conftest, report generator, package init
- `050b721`: feat(14-01): health checks + extraction pipeline E2E tests
