---
phase: 14-comprehensive-e2e-testing-error-resilience
plan: "04"
subsystem: testing
tags: [e2e, pytest, studio-promotion, error-resilience, coverage-map, master-wine-library]
dependency_graph:
  requires: [e2e-test-framework, studio-pipeline-tests, quality-review-tests]
  provides: [studio-library-promotion-path, error-resilience-tests, coverage-map]
  affects:
    - services/agent-orchestrator/services/override_service.py
    - services/agent-orchestrator/api/studio_routes.py
    - services/agent-orchestrator/tests/e2e/test_promotion_path.py
    - services/agent-orchestrator/tests/e2e/test_error_resilience.py
    - services/agent-orchestrator/test-results/.gitkeep
tech_stack:
  added: []
  patterns: [non-fatal-try-except, fail-open-pattern, per-table-supabase-mock, confidence-gate-check]
key_files:
  created:
    - services/agent-orchestrator/tests/e2e/test_promotion_path.py
    - services/agent-orchestrator/tests/e2e/test_error_resilience.py
    - services/agent-orchestrator/test-results/.gitkeep
  modified:
    - services/agent-orchestrator/services/override_service.py
    - services/agent-orchestrator/api/studio_routes.py
decisions:
  - "_fc_value() re-implemented locally in override_service.py to avoid circular import with quality_routes.py"
  - "_maybe_promote_submission() wrapped in top-level try/except — promotion failure is non-fatal (T-14-08)"
  - "test_extraction_cap_check_fails_open tests actual fail-open behavior (api_spend raises inside _preflight_cap_check, which has internal try/except returning 0.0), not the patched function raise approach (which would propagate uncaught)"
  - "Coverage map placed as module docstring in test_error_resilience.py for co-location with resilience tests"
metrics:
  duration_minutes: 12
  completed_date: "2026-04-08"
  tasks_completed: 2
  files_created: 3
  files_modified: 2
---

# Phase 14 Plan 04: Studio→Library Promotion Gap Fix + Error Resilience Summary

**One-liner:** Fixed architectural gap where studio-approved wines never reached master_wine_library via `_maybe_promote_submission` with three-gate promotion logic, plus 8 error resilience E2E tests verifying graceful 503/degradation and a full endpoint coverage map.

## What Was Built

### Task 1: Studio→Library Promotion Gap Fix

**`services/override_service.py` — new functions:**

**`_fc_value(fc, field_name)`** — local helper (3 lines) that extracts `value` from a field_confidence entry. Re-implemented locally rather than importing from `quality_routes.py` to avoid circular imports.

**`_maybe_promote_submission(supabase, submission_id) → bool`** — closes the D-05 architectural gap where wines approved via studio overrides never reached `master_wine_library`.

Three promotion gates (all must pass):
1. `submission.status == "pending_review"` — not already decided
2. `field_review_queue` count of pending rows == 0 — no fields still awaiting review
3. `should_auto_block(fc) == False` — field confidence ratio is acceptable

If all gates pass: builds `promo_row` mirroring `quality_routes.patch_review_queue` mapping, inserts into `master_wine_library`, updates submission status to `"approved"`, returns `True`. Entire function wrapped in `try/except` — promotion failure is non-fatal (T-14-08).

**`services/api/studio_routes.py` — integration:**
- Added `_maybe_promote_submission` to imports from `override_service`
- `submit_override()`: after `_apply_override_to_submission()` on the `auto_promoted` path, calls `_maybe_promote_submission(supabase, body.submission_id)` in a non-fatal `try/except`
- `decide_override()`: after `_apply_override_to_submission()` on the `approved` path, calls `_maybe_promote_submission(supabase, ov["submission_id"])` in a non-fatal `try/except`

**`tests/e2e/test_promotion_path.py`** — 4 E2E tests:
1. `test_auto_promoted_override_triggers_library_promotion` — all gates pass → `master_wine_library.insert` called
2. `test_promotion_skipped_when_fields_still_pending` — field_review_queue count=2 → insert NOT called
3. `test_promotion_skipped_when_auto_blocked` — 3/4 fields below 0.5 confidence → `should_auto_block` True → insert NOT called
4. `test_admin_approve_triggers_library_promotion` — admin PATCH /queue/{id} approved → promotion triggered → insert called

### Task 2: Error Resilience Tests + Coverage Map

**`tests/e2e/test_error_resilience.py`** — 8 tests in `TestErrorResilience`:

1. `test_extract_returns_503_when_extractor_fails` — RuntimeError from Claude Vision → 503 with informative detail (no stack trace leak)
2. `test_quality_review_queue_returns_503_when_supabase_down` — `_get_supabase()=None` → 503 "Database not available"
3. `test_studio_override_returns_503_when_supabase_down` — JWT auth passes, DB unavailable → 503
4. `test_research_metrics_handles_partial_table_failures` — `research_run_stats` query raises, other tables empty → 200 with all-zero metrics (not a 500)
5. `test_analytics_unavailable_returns_503` — `_get_supabase()=None` → 503 "Database unavailable"
6. `test_health_always_returns_200` — no mocking, GET /health → 200 `{status: ok}`
7. `test_studio_me_roles_returns_empty_on_error` — JWT signed with wrong secret → 200 `{roles: [], promotion_policy: "queue"}` (graceful degradation)
8. `test_extraction_cap_check_fails_open` — `api_spend` query raises inside `_preflight_cap_check` → internal try/except returns 0.0 → extraction proceeds → 200

**Coverage map** documented as module docstring in `test_error_resilience.py`:
- 25+ HTTP endpoints mapped to specific E2E tests
- Untested surfaces explicitly called out: Python agents (no HTTP routes), Celery beat jobs

**`test-results/.gitkeep`** — ensures the report output directory is tracked in git.

## Test Results

```
# Task 1: 4 promotion path tests
4 passed in 4.17s

# Task 2: 8 error resilience tests
8 passed in 1.97s

# Full E2E suite
45 passed in 4.08s
```

JSON report: `test-results/e2e-report.json` — 45 tests, all passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] _fc_value re-implemented locally**
- **Found during:** Task 1 analysis
- **Issue:** Plan suggested importing `_fc_value` from `quality_routes.py`. This would create a circular import: `override_service` → `quality_routes` → (indirectly) `override_service` via shared settings.
- **Fix:** Re-implemented the 3-line `_fc_value` helper directly in `override_service.py` as a local function.
- **Files modified:** `services/override_service.py`
- **Commit:** `1388f0a`

**2. [Rule 1 - Bug] test_extraction_cap_check_fails_open tests actual internal fail-open behavior**
- **Found during:** Task 2, pre-implementation analysis
- **Issue:** Plan said "Mock `_preflight_cap_check` to raise Exception → POST /onboarding/extract → proceeds (fail-open per design)". However, the onboarding endpoint calls `_preflight_cap_check(supabase, ...)` without a surrounding try/except. If the whole function is patched to raise, the exception propagates to a 500.
- **Actual fail-open design:** `_preflight_cap_check` has an internal try/except that catches DB errors and returns 0.0. The test was rewritten to mock the `api_spend` table query to raise (which `_preflight_cap_check` handles internally), demonstrating the actual fail-open behavior.
- **Files modified:** `tests/e2e/test_error_resilience.py`
- **Commit:** `af2f494`

## Key Decisions

| Decision | Reason |
|----------|--------|
| `_fc_value` re-implemented locally | Avoids circular import between override_service ↔ quality_routes |
| `_maybe_promote_submission` wrapped in top-level try/except | Promotion failure must never crash the override response (T-14-08) |
| test_extraction_cap_check_fails_open mocks `api_spend` table (not the function) | Exercises actual fail-open behavior in `_preflight_cap_check`; patching the whole function would create an uncaught exception |
| Coverage map in test_error_resilience.py docstring | Co-located with resilience tests for discoverability; generated at test completion per D-07 |

## Known Stubs

None — all code paths are wired to real logic; no hardcoded empty values or placeholder returns in the implementation.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-insert-path | services/override_service.py | `_maybe_promote_submission` adds a new code path that inserts into `master_wine_library`. Values come from server-side `field_confidence` JSONB (T-14-09 mitigated). Only called after `require_studio_role()` has verified the actor (T-14-07 mitigated). |

## Self-Check: PASSED

Files verified:
- `services/agent-orchestrator/tests/e2e/test_promotion_path.py` ✓ (exists, 312 lines)
- `services/agent-orchestrator/tests/e2e/test_error_resilience.py` ✓ (exists, 352 lines)
- `services/agent-orchestrator/test-results/.gitkeep` ✓ (exists)
- `services/agent-orchestrator/services/override_service.py` ✓ (`_maybe_promote_submission` present)
- `services/agent-orchestrator/api/studio_routes.py` ✓ (`_maybe_promote_submission` imported and called)

Commits verified:
- `1388f0a`: feat(14-04): fix Studio→Library promotion gap + promotion E2E tests ✓
- `af2f494`: feat(14-04): error resilience tests + coverage map + test-results dir ✓
