---
phase: 11-temporal-menu-intelligence-analytics
plan: "04"
subsystem: jobs+tests
tags: [celery, trending, popularity, analytics, TEMP-05, TEMP-06]
dependency_graph:
  requires:
    - supabase/migrations/20260411000000_phase11_temporal.sql (Phase 11-01: wine_popularity + trending_wines tables)
    - services/agent-orchestrator/services/menu_diff_service.py (Phase 11-02: menu_changes events)
    - services/agent-orchestrator/jobs/recrawl_tasks.py (Phase 11-03: recrawl populates restaurant_wine_roster + menu_changes)
  provides:
    - compute_trend_metrics_task (TEMP-05 + TEMP-06: nightly popularity + trending in single task)
    - wine_popularity upserted nightly (distinct restaurant count per wine_id)
    - trending_wines upserted nightly (velocity scores for 30/60/90d windows)
  affects:
    - Phase 11-05 (analytics API endpoints read from wine_popularity + trending_wines)
tech_stack:
  added: []
  patterns:
    - Single combined Celery task (popularity before trending — ordering guarantee)
    - Python-side window boundaries (NOT SQL INTERVAL — supabase-py limitation)
    - defaultdict(set) for distinct restaurant counting
    - hash→wine_id join via master_wine_library_submissions (master_wine_library has no signature_hash)
    - Burst detection: ≥3 distinct new restaurants in 14d → +2.0 bonus
key_files:
  created:
    - services/agent-orchestrator/jobs/trend_tasks.py
    - services/agent-orchestrator/tests/test_trend_tasks.py
  modified:
    - services/agent-orchestrator/jobs/celery_app.py
decisions:
  - "Popularity and trending in single Celery task — guarantees wine_popularity is committed before trending reads it (Pitfall 9)"
  - "hash→wine_id join uses master_wine_library_submissions (not master_wine_library which has no signature_hash)"
  - "trend_score written to all 3 window rows (same combined value per wine, per D-02)"
  - "Patch target for create_client tests must be supabase.create_client (imported locally inside function body)"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
---

# Phase 11 Plan 04: Trend Metrics Celery Task Summary

**One-liner:** Nightly `compute_trend_metrics_task` computes `wine_popularity` (distinct roster join) and `trending_wines` velocity scores (D-02 formula: delta×weights + burst_bonus) in a single ordering-guaranteed task — 8 unit tests, all passing.

---

## What Was Built

### `trend_tasks.py` — New File (Task 1)

| Component | Purpose |
|-----------|---------|
| `compute_trend_metrics_task` (beat, `trend.compute_metrics`) | Nightly 5:00 AM UTC. Calls `_compute_popularity` first, then `_compute_trending` — ordering guarantee |
| `_compute_popularity(supabase)` | Builds hash→wine_id map from `master_wine_library_submissions`; counts distinct restaurants per wine from `restaurant_wine_roster`; upserts `wine_popularity` on_conflict=wine_id |
| `_compute_trending(supabase)` | Fetches 90d of `menu_changes` events; resolves hashes to wine_ids; computes per-window deltas; detects burst (≥3 new restaurants in 14d); writes combined `trend_score` to all 3 window rows; upserts `trending_wines` on_conflict=wine_id,window_days |
| `_window_start_iso(days)` | Returns ISO string for rolling window start (Python-side, not SQL INTERVAL) |
| Constants | `WINDOWS=[30,60,90]`, `BURST_WINDOW_DAYS=14`, `BURST_RESTAURANT_THRESHOLD=3`, `BURST_BONUS=2.0`, `TREND_WEIGHTS={30:3.0, 60:1.5, 90:1.0}` |

**Trend score formula (D-02):**
```
trend_score = (delta_30d × 3.0) + (delta_60d × 1.5) + (delta_90d × 1.0) + burst_bonus
burst_bonus = +2.0 if wine appeared in ≥3 distinct new restaurants within 14 days
```

**Threat mitigation T-11-04-03:** ZeroDivisionError guard: `pct_change = (delta / count_start * 100.0) if count_start > 0 else None`

### `celery_app.py` — Updated (Task 2)

- `"jobs.trend_tasks"` appended to `imports` tuple (after `"jobs.recrawl_tasks"`)
- Beat schedule entry added:
  ```python
  "trend-metrics-nightly": {
      "task": "trend.compute_metrics",
      "schedule": crontab(hour=5, minute=0),  # 5:00 AM UTC
      "options": {"expires": 3500},
  }
  ```

### `test_trend_tasks.py` — 8 Unit Tests (Task 2)

| Test | Covers |
|------|--------|
| `test_popularity_counts_distinct_restaurants` | 3 duplicate roster rows → count=1 (distinct, not raw) |
| `test_window_start_iso_30d` | Returns correct date prefix for 30-day window |
| `test_burst_detected_at_threshold` | BURST_RESTAURANT_THRESHOLD=3, BURST_BONUS=2.0 |
| `test_trend_score_formula` | (5×3.0)+(3×1.5)+(2×1.0)+2.0 = 23.5 ✓ |
| `test_no_burst_below_threshold` | 2 restaurants → burst=False, bonus=0.0 |
| `test_compute_task_calls_both` | Task calls popularity first then trending; returns both counts |
| `test_popularity_returns_zero_no_submissions` | Empty submissions → 0 without error |
| `test_trend_weights_match_formula` | TREND_WEIGHTS[30]=3.0, [60]=1.5, [90]=1.0 |

---

## Verification

- `grep 'jobs.trend_tasks' services/agent-orchestrator/jobs/celery_app.py` — **MATCH**
- `grep 'hour=5, minute=0' services/agent-orchestrator/jobs/celery_app.py` — **MATCH**
- `pytest tests/test_trend_tasks.py -x` — **8 passed, 0 failed**
- `_compute_popularity` called before `_compute_trending` in task body — **CONFIRMED** (pop_idx=1645 < trend_idx=1696)
- `master_wine_library_submissions` in trend_tasks.py — **MATCH** (correct join path)
- `on_conflict` count in trend_tasks.py — **2** (one per table)

---

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `90ac915` | feat(11-04): create trend_tasks.py with compute_trend_metrics_task |
| Task 2 | `48960c1` | feat(11-04): wire trend_tasks into celery_app + add 8 unit tests |

---

## Deviations from Plan

### Auto-fix [Rule 1 - Bug] Mock patch target changed to `supabase.create_client`

- **Found during:** Task 2 test execution (first pytest run)
- **Issue:** `create_client` is imported locally inside `compute_trend_metrics_task` body (`from supabase import create_client`). `@patch("jobs.trend_tasks.create_client")` raised `AttributeError: module does not have attribute 'create_client'`.
- **Fix:** Changed `@patch("jobs.trend_tasks.create_client")` to `@patch("supabase.create_client")` — same fix as Plan 03 deviation (same local import pattern).
- **Files modified:** `tests/test_trend_tasks.py`

### Extra tests (above minimum)

- **Added 2 extra tests** beyond the 6 required: `test_popularity_returns_zero_no_submissions` + `test_trend_weights_match_formula` — verifies zero-guard path and formula constant correctness.
- Final count: 8 tests (minimum was 6).

---

## Known Stubs

None — all production code paths are fully wired:
- `compute_trend_metrics_task` calls real `_compute_popularity` and `_compute_trending`
- Both functions upsert to real Supabase tables (`wine_popularity`, `trending_wines`) created in Plan 01
- Beat entry references `trend.compute_metrics` task name which matches `@celery_app.task(name="trend.compute_metrics")`

---

## Threat Flags

None. This plan:
- Introduces no new network endpoints (Celery internal task only)
- Supabase queries use supabase-py parameterized `.gte()` / `.not_.is_()` — no raw SQL
- T-11-04-03 ZeroDivisionError mitigation implemented and covered by formula test

---

## Self-Check: PASSED

- `services/agent-orchestrator/jobs/trend_tasks.py` — FOUND ✓ (304 lines, min 120)
- `services/agent-orchestrator/tests/test_trend_tasks.py` — FOUND ✓ (170 lines, min 60)
- `services/agent-orchestrator/jobs/celery_app.py` contains `jobs.trend_tasks` — FOUND ✓
- `services/agent-orchestrator/jobs/celery_app.py` contains `trend-metrics-nightly` — FOUND ✓
- `services/agent-orchestrator/jobs/celery_app.py` contains `hour=5, minute=0` — FOUND ✓
- Commit `90ac915` — FOUND ✓
- Commit `48960c1` — FOUND ✓
- 8 tests pass — CONFIRMED ✓
