---
phase: 14-comprehensive-e2e-testing-error-resilience
plan: "02"
subsystem: testing
tags: [e2e, pytest, studio-override, quality-pipeline, research-api, analytics-api]
dependency_graph:
  requires: [e2e-test-framework, conftest_e2e-fixtures]
  provides: [studio-pipeline-tests, quality-review-tests, research-api-tests, analytics-api-tests]
  affects: [services/agent-orchestrator/tests/e2e/]
tech_stack:
  added: []
  patterns: [per-table-supabase-mock, jwt-factory, mock-chain-patching, env-var-teardown]
key_files:
  created:
    - services/agent-orchestrator/tests/e2e/test_studio_pipeline.py
    - services/agent-orchestrator/tests/e2e/test_api_endpoints.py
  modified: []
decisions:
  - "Analytics _get_supabase uses supabase.create_client internally — patched at api.analytics_routes._get_supabase (whole function) not at supabase.create_client"
  - "Research trigger patches jobs.research_tasks.research_agent_task (source module) since the import happens inside trigger_research() at call time"
  - "CERTIFIED_CONTRIBUTOR_PAYLOAD defined in-test (not from conftest_e2e) because conftest has roles=['contributor'] not 'certified_contributor'"
  - "ADMIN_API_KEY env var set/restored in each research trigger test to avoid test pollution (T-14-04 mitigation)"
  - "override_events metrics mock uses two distinct mock chains: .limit.rv for main query, .gte.rv for active-contributors query"
metrics:
  duration_minutes: 7
  completed_date: "2026-04-08"
  tasks_completed: 2
  files_created: 2
---

# Phase 14 Plan 02: Studio Pipeline + API Endpoints E2E Tests Summary

**One-liner:** 20 mock-only E2E tests covering Studio override (3 role paths + admin approve/reject/409 + metrics + invite), Quality review pipeline (GET grouping + PATCH promotion + calibration), Research API (metrics empty/computed + trigger auth/concurrency), and Analytics API (scores + UUID validation + trends + timeline).

## What Was Built

### Task 1: Studio Override + Approval Queue E2E (`test_studio_pipeline.py`)

**8 tests in `TestStudioOverridePipeline`:**

1. **`test_developer_override_auto_promotes`** — Developer JWT + confidence=0.92 field + reason → `auto_promoted` (D-13 instant-promote path)
2. **`test_developer_override_requires_reason_for_high_confidence`** — Confidence=0.92: no reason → 422, 2-char reason → 422, valid reason → 200 (D-07 server-side enforcement)
3. **`test_contributor_override_lands_in_pending_queue`** — certified_contributor JWT + `promotion_policy=queue` → `pending` status (D-12 queue path)
4. **`test_admin_approves_pending_override`** — review_admin PATCH /queue/{id} `decision=approved` → 200, `decision=approved` in body (DEVUI-10)
5. **`test_admin_rejects_pending_override`** — Same flow with `decision=rejected` → 200, `decision=rejected`
6. **`test_already_decided_override_returns_409`** — PATCH on `promotion_status=approved` override → 409 conflict
7. **`test_studio_metrics_returns_kpis`** — GET /studio/metrics: 2 overrides (1 auto_promoted, 1 pending) → all KPI fields present, counts correct
8. **`test_invite_create_and_redeem_flow`** — Admin POST /invite → token; developer POST /invite/redeem → `role_granted=certified_contributor` (DEVUI-07, D-03/D-04)

**Mock architecture:** `_build_supabase(table_map)` helper dispatches `.table(name)` to per-table MagicMocks. Per-test patches: `config.settings.get_settings`, `api.studio_routes._get_supabase`, `api.studio_routes._get_user_studio_roles`, `api.studio_routes._apply_override_to_submission`, `api.studio_routes.check_and_update_trust`.

### Task 2: Quality + Research + Analytics E2E (`test_api_endpoints.py`)

**4 tests in `TestQualityPipeline`:**

1. **`test_review_queue_returns_pending_fields_grouped_by_wine`** — 3 pending rows (2 for sub A, 1 for sub B) → grouped response with 2 items, first has 2 `pending_fields`
2. **`test_review_queue_patch_correction_promotes_to_library`** — PATCH correction with 0 remaining pending + `should_auto_block=False` → `promoted_to_library=True`, `status=approved`, `master_wine_library.insert` called
3. **`test_review_queue_patch_does_not_promote_when_fields_remain`** — 1 remaining pending → `promoted_to_library=False`, `status=pending_review`
4. **`test_calibration_endpoint_returns_thresholds`** — GET /quality/calibration → `thresholds` (2 rows) + `calibration_stats` (1 row) + `fields_with_calibration_data=1`

**4 tests in `TestResearchAPI`:**

5. **`test_research_metrics_handles_empty_tables`** — All tables empty → all metric values 0/0.0, `safety.pii_policy_flags=0`
6. **`test_research_metrics_computes_from_data`** — 2 stat_rows (14/20 fields filled) + 4 citations (2A+2B) → `promotion_rate=0.7`, `source_tier_mix {A:50.0, B:50.0, C:0.0}`
7. **`test_research_trigger_requires_admin_key`** — No key → 401, wrong key → 401, correct key with mock Celery → 200, `queued≥1`
8. **`test_research_trigger_blocks_concurrent_runs`** — research_runs count=1 (status=running) → 429 (T-12-11)

**4 tests in `TestAnalyticsAPI`:**

9. **`test_wine_scores_returns_critic_data`** — critic_scores JSONB + inventory markup → 200, `critic_scores` populated, `per_restaurant_markup[0].markup_ratio=2.5`
10. **`test_wine_scores_invalid_uuid_returns_422`** — GET /analytics/wine/not-a-uuid/scores → 422 (UUID validation guard)
11. **`test_trends_returns_trending_wines`** — 2 trending rows (delta=+5 and delta=-3) → `trending_up` and `trending_down` both populated
12. **`test_wine_timeline_returns_lifecycle`** — signature_hash resolution → roster rows → `first_seen_at` set, `restaurants_currently_carrying=5`, `price_history` has 2 entries

## Test Results

```
20 passed in 0.83s
```

Both files individually:
- `test_studio_pipeline.py`: 8 passed in 3.42s
- `test_api_endpoints.py`: 12 passed in 0.85s

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] CERTIFIED_CONTRIBUTOR_PAYLOAD defined in-test**
- **Found during:** Task 1, test 3
- **Issue:** `conftest_e2e.CONTRIBUTOR_JWT_PAYLOAD` has `roles=["contributor"]` (not `"certified_contributor"`), which fails `require_studio_role("developer", "certified_contributor", "review_admin")` with 403
- **Fix:** Defined `CERTIFIED_CONTRIBUTOR_PAYLOAD = {..., "app_metadata": {"roles": ["certified_contributor"]}}` directly in `test_studio_pipeline.py`
- **Files modified:** `test_studio_pipeline.py`

**2. [Rule 2 - Missing Critical Functionality] ADMIN_API_KEY env var save/restore**
- **Found during:** Task 2, research trigger tests
- **Issue:** Setting `ADMIN_API_KEY` env var would leak into subsequent tests if not restored; T-14-04 threat requires cleanup
- **Fix:** Added try/finally pattern that saves `old_key = os.environ.get("ADMIN_API_KEY")` and restores it (or pops if was absent) in every research trigger test
- **Files modified:** `test_api_endpoints.py`

**3. [Rule 1 - Bug] Analytics uses create_client internally, not supabase_client attribute**
- **Found during:** Task 2 pre-analysis (reading analytics_routes.py)
- **Issue:** Plan noted analytics might use `supabase.create_client` directly; confirmed `_get_supabase()` does `from supabase import create_client; return create_client(...)`. Patching `supabase.create_client` would be fragile.
- **Fix:** Patched `api.analytics_routes._get_supabase` (the whole function) to return the mock directly — cleaner and more isolated than patching the underlying create_client
- **Files modified:** `test_api_endpoints.py`

## Key Decisions

| Decision | Reason |
|----------|--------|
| Patch `api.analytics_routes._get_supabase` entirely | analytics `_get_supabase()` calls `create_client(...)` internally; patching the function directly is safer and avoids supabase library coupling |
| Patch `jobs.research_tasks.research_agent_task` at source | Import happens inside `trigger_research()` at call time — patching the source module attribute ensures the mock is picked up when the function does `from jobs.research_tasks import research_agent_task` |
| `should_auto_block` patched via `api.quality_routes.should_auto_block` | Imported at module level in quality_routes, so patching the name binding in the module is the correct approach |
| Two distinct mock chains for override_events in metrics test | `.select.rv.limit.rv` for main overrides query vs `.select.rv.gte.rv` for active contributors — MagicMock attribute chains are independent, no collision |

## Known Stubs

None — all tests produce real structured assertions and verify actual HTTP response behavior.

## Threat Flags

None — test files contain no new network endpoints, auth paths, file access, or schema changes.

## Self-Check: PASSED

Files verified:
- `tests/e2e/test_studio_pipeline.py` ✓ (exists, 407 lines)
- `tests/e2e/test_api_endpoints.py` ✓ (exists, 618 lines)

Commits verified:
- `87edd03`: feat(14-02): Studio override + approval queue E2E tests ✓
- `6547337`: feat(14-02): Quality, Research, and Analytics API E2E tests ✓
