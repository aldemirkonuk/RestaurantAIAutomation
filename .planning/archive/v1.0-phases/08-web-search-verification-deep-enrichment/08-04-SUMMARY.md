---
phase: 08-web-search-verification-deep-enrichment
plan: 04
subsystem: celery-tasks, web-verification-pipeline
tags: [web-verify-task, celery, redis-dedup, budget-cap, concordance, producer-graph, wsrch-01, wsrch-07, wsrch-08]
dependency_graph:
  requires:
    - services/agent-orchestrator/services/web_verification_service.py (WineVerificationResult, concordance engine, producer graph ops)
    - services/agent-orchestrator/services/serper_client.py (serper_search)
    - services/agent-orchestrator/services/producer_normalization.py (normalize_producer_name, build_search_query)
    - services/agent-orchestrator/services/field_confidence.py (merge_field_confidence)
    - services/agent-orchestrator/services/spend_logger.py (get_spend_logger)
    - services/agent-orchestrator/config/settings.py (serper_api_key, web_search_daily_budget_usd, serper_cost_per_query, celery_broker_url)
    - supabase/migrations/20260407000000_producers_table.sql (web_verified_at column on master_wine_library_submissions)
    - jobs/celery_app.py (celery_app instance)
    - jobs/haiku_tasks.py (_enrich_async for trigger wiring)
  provides:
    - services/agent-orchestrator/jobs/web_verify_tasks.py (web_verify_task Celery task + budget cap + eligibility logic)
  affects:
    - Plan 05: test_web_verification.py tests web_verify_task, check_and_reserve_search_budget, _should_web_verify
    - haiku_tasks.py: now triggers web_verify_task.delay after enrichment merge
tech_stack:
  added: []
  patterns:
    - Redis SET NX EX dedup lock (wine:verify:{wine_id}, TTL=3600) — Pitfall 7 prevention
    - Redis INCRBYFLOAT for atomic daily budget cap (Pitfall 3 prevention)
    - Celery task bind=True + max_retries=3 + countdown escalation 60→120→240s (haiku_tasks.py pattern)
    - Late import in _verify_async to avoid circular deps at module load time
    - Late import in haiku_tasks trigger block (same circular dep pattern)
    - Try/except wrapping non-fatal trigger in haiku_tasks (enrichment must not fail due to web verify queue error)
    - Fail-open on Redis error in check_and_reserve_search_budget (infra failure never blocks verification)
key_files:
  created:
    - services/agent-orchestrator/jobs/web_verify_tasks.py
  modified:
    - services/agent-orchestrator/jobs/celery_app.py
    - services/agent-orchestrator/jobs/haiku_tasks.py
decisions:
  - "Late imports in _verify_async and haiku_tasks trigger block: web_verify_tasks imports celery_app; celery_app is imported by haiku_tasks — top-level import of web_verify_task in haiku_tasks would create a circular dependency at module load time"
  - "Fail-open on Redis error in check_and_reserve_search_budget: budget tracking must never block wine verification; Redis unavailability is infrastructure failure, not a business logic gate"
  - "budget check placed inside else branch (new producer path only): known-producer path uses instant producer graph enrichment with no API call, so no budget deduction is needed"
  - "web_verify_task trigger wrapped in try/except in haiku_tasks: haiku enrichment is already complete before this code runs; Celery broker outage or import error must never roll back the completed enrichment"
  - "autoretry_for=(Exception,) retained from haiku_tasks.py pattern: Redis lock released in finally before any retry, so retry will re-acquire a fresh lock correctly"
metrics:
  duration_seconds: 420
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
---

# Phase 08 Plan 04: web_verify_task Celery Task + Pipeline Wiring — Summary

**One-liner:** `web_verify_task` Celery task with Redis NX dedup lock + INCRBYFLOAT atomic budget cap + tiered eligibility check, wired into haiku_tasks.py as a non-fatal post-enrichment trigger and registered in celery_app.py imports.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create web_verify_tasks.py | 3afc9ff | services/agent-orchestrator/jobs/web_verify_tasks.py |
| 2 | Patch celery_app.py + haiku_tasks.py trigger | 7fd697d | services/agent-orchestrator/jobs/celery_app.py, services/agent-orchestrator/jobs/haiku_tasks.py |

## What Was Built

### Task 1: `services/agent-orchestrator/jobs/web_verify_tasks.py` (260 lines)

**`check_and_reserve_search_budget(cost_per_search=None) → bool`** (WSRCH-08):
- Uses `r.incrbyfloat(today_key, cost)` — atomic across distributed Celery workers (Pitfall 3 prevention)
- Key: `web_search:daily_spend:{YYYY-MM-DD}`; 2-day TTL for cleanup
- If new total > cap: undo increment (`r.incrbyfloat(today_key, -cost)`), return False
- Returns True on any Redis error (fail open — infra failure never blocks wine verification)
- Reads `settings.serper_cost_per_query` (0.001) and `settings.web_search_daily_budget_usd` (5.0)

**`_should_web_verify(fc, producer_in_graph) → bool`** (WSRCH-07):
- `(a)` Any FC field has confidence < 0.8 → True
- `(b)` Producer not in knowledge graph → True (always verify new producers)
- `(c)` No field has verification_status != "unverified" → True (never web-verified)
- Returns False only when producer known AND all fields ≥ 0.8 AND at least one field already verified

**`web_verify_task(self, wine_id: str)`** Celery task (WSRCH-01):
- `name="web_verify.verify_wine"`, `bind=True`, `max_retries=3`, `autoretry_for=(Exception,)`, `default_retry_delay=60`
- Redis lock: `r.set(lock_key, "1", nx=True, ex=3600)` — dedup; returns None immediately if not acquired
- Lock released in `finally` block — TTL is safety net, explicit delete is correct (Pitfall 7)
- Retry countdown: 60→120→240s matching haiku_tasks.py pattern
- Calls `asyncio.run(_verify_async(wine_id))`

**`_verify_async(wine_id) → Optional[dict]`**:
- Fetches wine from `master_wine_library_submissions` (id, payload, field_confidence)
- Extracts wine_name, producer_raw, vintage from FC values (preferred) or payload fallback
- Calls `normalize_producer_name()` → `lookup_producer()` to check knowledge graph
- Runs `_should_web_verify()` eligibility check
- **Known producer path**: `apply_producer_graph_enrichment()` — instant enrichment, no API call
- **New producer path**:
  - `check_and_reserve_search_budget()` before Serper call
  - `build_search_query()` → `serper_search(query, num_results=5)`
  - SpendLogger: `cost_usd=settings.serper_cost_per_query` ($0.001) logged against `restaurant_id=wine_id`
  - `parse_search_results()` → Gemini 2.5 Flash structured extraction → `WineVerificationResult`
  - Concordance loop over 11 verifiable fields: `check_concordance()` → `apply_concordance_result()`
  - Contradiction logging at INFO level
  - `upsert_producer()` when `producer_raw` and `verification_result.country` are non-empty
- Supabase update: `field_confidence` + `web_verified_at` timestamp
- Returns `{"wine_id", "fields_verified", "producer_in_graph"}` summary dict

### Task 2: Pipeline Wiring

**`celery_app.py`** — added `"jobs.web_verify_tasks"` to imports tuple:
```python
imports=("jobs.tasks", "jobs.haiku_tasks", "jobs.spend_tasks", "jobs.calibration_tasks", "jobs.web_verify_tasks"),
```

**`haiku_tasks.py`** — trigger block inserted after `supabase.update(...).execute()`, before final `logger.info()`:
```python
try:
    from jobs.web_verify_tasks import web_verify_task, _should_web_verify
    from services.producer_normalization import normalize_producer_name
    from services.web_verification_service import lookup_producer

    producer_value = merged_fc.get("producer", {}).get("value") or ""
    normalized_producer = normalize_producer_name(producer_value)
    producer_in_graph = lookup_producer(normalized_producer) is not None if normalized_producer else False

    if _should_web_verify(merged_fc, producer_in_graph):
        web_verify_task.delay(wine_id)
        logger.info("haiku_tasks: queued web_verify_task for wine_id=%s ...")
except Exception as exc:
    logger.warning("haiku_tasks: failed to queue web_verify_task for wine_id=%s: %s", ...)
```
Late imports prevent circular dependency at module load time. `try/except` ensures enrichment result is never lost due to a Celery broker outage or import error.

## Deviations from Plan

None — plan executed exactly as written. Both tasks implemented per specification. All 6 `must_haves.truths` and 3 `must_haves.artifacts` criteria satisfied.

## Known Stubs

None — all functions make real service calls. No hardcoded empty values, no TODO/FIXME markers, no placeholder text. `_verify_async` wires all imported service functions with actual data flow.

## Threat Surface Scan

All threats from plan's threat model are mitigated in implementation:

| Flag | File | Status |
|------|------|--------|
| T-08-10 DoS: check_and_reserve_search_budget | web_verify_tasks.py | ✅ INCRBYFLOAT is atomic; cap enforced before Serper call; task returns None (not error) on cap |
| T-08-11 DoS: Redis lock TTL | web_verify_tasks.py | ✅ TTL=3600 safety net; explicit r.delete(lock_key) in finally for prompt release |
| T-08-12 Tampering: web_verified_at | web_verify_tasks.py | ✅ Internal timestamp; column added in Plan 01 migration |

No new network endpoints introduced. `web_verify_task` is an internal Celery task, not user-facing.

## Self-Check

Checking created/modified files and commits exist...

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `services/agent-orchestrator/jobs/web_verify_tasks.py` | ✅ FOUND |
| `services/agent-orchestrator/jobs/celery_app.py` | ✅ FOUND |
| `services/agent-orchestrator/jobs/haiku_tasks.py` | ✅ FOUND |
| Commit `3afc9ff` (web_verify_tasks.py) | ✅ FOUND |
| Commit `7fd697d` (celery_app + haiku_tasks patches) | ✅ FOUND |
| `name="web_verify.verify_wine"` in web_verify_tasks.py | ✅ VERIFIED |
| `r.set(lock_key, nx=True, ex=3600)` in web_verify_tasks.py | ✅ VERIFIED |
| `r.incrbyfloat` in web_verify_tasks.py | ✅ VERIFIED |
| `r.delete(lock_key)` in finally block | ✅ VERIFIED |
| `"jobs.web_verify_tasks"` in celery_app.py imports tuple | ✅ VERIFIED |
| `web_verify_task.delay(wine_id)` in haiku_tasks.py | ✅ VERIFIED |
| `_should_web_verify` check in haiku_tasks.py trigger | ✅ VERIFIED |
