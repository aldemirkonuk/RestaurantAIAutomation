---
phase: 10-critic-scores-pricing-intelligence
plan: "04"
subsystem: jobs
tags: [celery, redis, score-aggregation, chain-trigger, beat-schedule]
dependency_graph:
  requires:
    - "10-02 (critic_score_service.py — build_critic_score_queries, parse_serper_score_snippets, compute_markup_info)"
    - "10-03 (dataset_ingestion_service.py — DatasetIngestionService.enrich_wine)"
    - "jobs/web_verify_tasks.py — check_and_reserve_search_budget (budget cap)"
    - "jobs/ontology_tasks.py — _validate_sync() insertion point"
    - "jobs/celery_app.py — imports tuple + beat_schedule"
  provides:
    - "score_lookup_task — per-wine critic score aggregation Celery task"
    - "dataset_enrich_task — per-wine dataset metadata enrichment Celery task"
    - "rescore_stale_wines_task — nightly beat for stale score refresh"
    - "Chain trigger: every validated wine → score_lookup_task + dataset_enrich_task"
  affects:
    - "master_wine_library (critic_scores, retail_price_avg, scores_last_updated_at)"
    - "restaurant_inventory (markup_ratio, markup_classification)"
    - "field_review_queue (pricing_anomaly inserts)"
tech_stack:
  added: []
  patterns:
    - "Redis NX dedup (SET NX EX 3600) — same as ontology_tasks.py"
    - "asyncio.run() wrapper — one coroutine per task, all awaits inside (Pitfall 2 prevention)"
    - "check_and_reserve_search_budget() import from web_verify_tasks (atomic INCRBYFLOAT)"
    - "Non-fatal try/except chain trigger at end of _validate_sync()"
    - "Python-side stale filter (NOW()-INTERVAL workaround for supabase-py)"
key_files:
  created:
    - "services/agent-orchestrator/jobs/score_tasks.py"
  modified:
    - "services/agent-orchestrator/jobs/celery_app.py"
    - "services/agent-orchestrator/jobs/ontology_tasks.py"
decisions:
  - "autoretry_for removed from task decorators — manual retry handling via self.retry() in except block matches ontology_tasks.py pattern exactly (avoids double-retry ambiguity)"
  - "rescore_stale_wines_task uses Python-side stale filtering (fetch all wines, filter in loop) — supabase-py .or_() cannot express NOW()-INTERVAL natively (A4 assumption confirmed)"
  - "Pitfall 4 prevention: merged_scores preserves existing normalized_score entries; new data only overwrites keys where prior find was absent"
  - "Six Serper targets: wine_advocate, wine_spectator, vivino, decanter, jancis_robinson (5 critic), wine_searcher (retail) — each gated by check_and_reserve_search_budget() individually"
metrics:
  duration: "~12 minutes"
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
---

# Phase 10 Plan 04: Celery Score Tasks + Chain Trigger Summary

**One-liner:** Three Celery tasks for critic score aggregation (6 Serper sources), dataset enrichment, and nightly stale-score rescoring — wired into ontology validation chain via non-fatal try/except trigger.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create jobs/score_tasks.py | 50c4459 | jobs/score_tasks.py (new, 276 lines) |
| 2 | Wire celery_app.py + ontology_tasks.py | 7ef5ab0 | jobs/celery_app.py, jobs/ontology_tasks.py |

## What Was Built

### Task 1: `jobs/score_tasks.py`

Three Celery tasks implementing CRIT-01, CRIT-04, CRIT-05, CRIT-06:

**`score_lookup_task`** (`score.lookup_wine`):
- Redis NX dedup via `wine:scores:{wine_id}` lock (TTL=3600, released in `finally`)
- `asyncio.run(_score_async(wine_id))` — single event loop per task invocation
- `_score_async` queries 5 critic sources (WA, WS, Vivino, Decanter, JR) + Wine-Searcher retail
- Each Serper call gated by `check_and_reserve_search_budget()` (atomic INCRBYFLOAT)
- Merges new scores into existing JSONB (preserves prior `normalized_score` finds — Pitfall 4)
- Writes `critic_scores + retail_price_avg + scores_last_updated_at` to `master_wine_library`
- Triggers `_update_inventory_markup()` cascade when `retail_price_avg` is set
- `_update_inventory_markup()`: loops all `restaurant_inventory` rows for wine, calls `compute_markup_info()`, updates `markup_ratio + markup_classification`, flags `markup_ratio > 5.0 or < 0.8` into `field_review_queue` (source=`pricing_anomaly`)
- Exponential backoff retry: 60s → 120s → 240s; exhausted retries return None (non-fatal)

**`dataset_enrich_task`** (`score.dataset_enrich_wine`):
- Redis NX dedup via `wine:dataset:{wine_id}` lock (separate key space from scores)
- Calls `DatasetIngestionService.enrich_wine(wine_id)` (Plan 10-03 service)
- Same retry pattern as score_lookup_task

**`rescore_stale_wines_task`** (`score.rescore_stale_wines`):
- Fetches all `master_wine_library` rows (select id, critic_scores, scores_last_updated_at)
- Python-side filter: `is_empty` (scores=={}) OR `is_stale` (last_updated < NOW()-30d)
- Queues `score_lookup_task.delay(wine_id)` for each stale wine
- Returns `{queued: N, stale_cutoff: ISO timestamp}`

### Task 2: `celery_app.py` + `ontology_tasks.py`

**`celery_app.py`** — two edits:
1. `imports` tuple extended: added `"jobs.score_tasks"` as last entry
2. `beat_schedule` extended: `"score-stale-nightly"` → `crontab(hour=3, minute=0)`, expires=3500

**`ontology_tasks._validate_sync()`** — chain trigger inserted:
```python
try:
    from jobs.score_tasks import score_lookup_task, dataset_enrich_task
    score_lookup_task.delay(wine_id)
    dataset_enrich_task.delay(wine_id)
    logger.info("_validate_sync: queued score_lookup_task + dataset_enrich_task for wine_id=%s", wine_id)
except Exception as exc:
    logger.warning("_validate_sync: failed to queue score tasks for wine_id=%s: %s", wine_id, exc)
```
Inserted after `logger.info(...)`, before `return {` — exactly at the documented insertion point. Non-fatal per T-10-15.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed `autoretry_for=(Exception,)` from task decorators**
- **Found during:** Task 1 — comparing against ontology_tasks.py pattern
- **Issue:** Plan code included `autoretry_for=(Exception,)` alongside manual `self.retry()` calls. In Celery, `autoretry_for` intercepts uncaught exceptions before the `except` block in theory (if re-raised), creating potential double-retry ambiguity. `ontology_tasks.py` (canonical pattern) does NOT use `autoretry_for`.
- **Fix:** Removed `autoretry_for=(Exception,)` from both `score_lookup_task` and `dataset_enrich_task` decorators. Manual retry logic in `except` blocks unchanged. Behavior is identical to the plan's intent — same 60/120/240s countdown, same max_retries=3.
- **Files modified:** `services/agent-orchestrator/jobs/score_tasks.py`
- **Commit:** 50c4459

## Known Stubs

None — all code paths are wired to real services. `score_lookup_task` calls real `serper_search`, `_update_inventory_markup` performs real DB updates, `dataset_enrich_task` calls real `DatasetIngestionService.enrich_wine`.

## Threat Flags

No new security surface introduced beyond what the plan's `<threat_model>` already covers:
- T-10-11 (DOS via large rescore batch): mitigated by `worker_prefetch_multiplier=1` already in `celery_app.py`
- T-10-12 (budget cap race): mitigated by `check_and_reserve_search_budget()` atomic INCRBYFLOAT
- T-10-13 (JSONB overwrite on retry): mitigated by Pitfall 4 merge logic in `_score_async`
- T-10-14 (markup write scope): mitigated — `_update_inventory_markup` queries by `master_wine_id`, updates by row `id`
- T-10-15 (chain trigger failure): accepted — wrapped in non-fatal `try/except`

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| `score_tasks.py` created with 3 tasks | ✅ |
| Redis NX dedup `wine:scores:{id}` | ✅ |
| Redis NX dedup `wine:dataset:{id}` (separate key) | ✅ |
| 6 Serper targets (5 critic + wine_searcher retail) | ✅ |
| `_update_inventory_markup()` cascade | ✅ |
| `markup_ratio + markup_classification` updated | ✅ |
| Anomaly flag in `field_review_queue` (source=pricing_anomaly) | ✅ |
| `rescore_stale_wines_task` at `crontab(hour=3, minute=0)` | ✅ |
| `celery_app.py` includes `"jobs.score_tasks"` in imports | ✅ |
| `ontology_tasks._validate_sync()` chains both tasks | ✅ |
| Chain trigger in non-fatal `try/except` before `return` | ✅ |
| `python3 -c "from jobs.score_tasks import ..."` exits 0 | ✅ |
| `celery_app.conf.beat_schedule` has `"score-stale-nightly"` | ✅ |

## Self-Check: PASSED

Files created:
- ✅ `services/agent-orchestrator/jobs/score_tasks.py` — exists
- ✅ `.planning/phases/10-critic-scores-pricing-intelligence/10-04-SUMMARY.md` — this file

Commits verified:
- ✅ `50c4459` — feat(10-04): create score_tasks.py
- ✅ `7ef5ab0` — feat(10-04): wire score_tasks into celery_app + ontology_tasks chain trigger
