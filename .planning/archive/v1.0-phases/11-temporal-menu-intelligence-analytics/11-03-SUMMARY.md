---
phase: 11-temporal-menu-intelligence-analytics
plan: "03"
subsystem: service+jobs
tags: [celery, recrawl, diff-engine, scheduler, redis-dedup, temporal, TEMP-02]
dependency_graph:
  requires:
    - supabase/migrations/20260411000000_phase11_temporal.sql (Phase 11-01: crawl_schedule table)
    - services/agent-orchestrator/services/menu_diff_service.py (Phase 11-02: MenuDiffService.run_diff())
  provides:
    - CrawlResult.wines field (web_crawler.py) — accumulated wine list for diff engine
    - scheduled_recrawl_task (TEMP-02: daily beat, fans out per due restaurant)
    - crawl_and_diff_task (TEMP-02: per-restaurant crawl + diff + schedule update)
  affects:
    - Phase 11-04 (analytics endpoints read from menu_changes populated by this plan's diff calls)
    - Phase 11-05 (popularity/trending beat reads roster updated by crawl_and_diff_task)
tech_stack:
  added: []
  patterns:
    - Redis NX deduplication (crawl:{restaurant_id}, TTL=7200) — same pattern as score_tasks.py
    - Celery beat fan-out (beat → scheduled_recrawl_task → crawl_and_diff_task.delay per restaurant)
    - asyncio.run() wrapper for async crawl inside sync Celery task
    - Exponential backoff retry with max_retries=3
    - Consecutive failure threshold (CONSECUTIVE_FAILURE_THRESHOLD=3) → status='error'
key_files:
  created:
    - services/agent-orchestrator/jobs/recrawl_tasks.py
    - services/agent-orchestrator/tests/test_recrawl_tasks.py
  modified:
    - services/agent-orchestrator/services/web_crawler.py
    - services/agent-orchestrator/jobs/celery_app.py
decisions:
  - "CrawlResult.wines accumulates in-memory via _persist_crawled_wines() — no second DB read needed for diff"
  - "crawl_and_diff_task fetches crawl_frequency from crawl_schedule (D-04), not restaurant_directory"
  - "Redis NX TTL=7200s (2 hours) — sufficient crawl window, matches score_tasks.py pattern"
  - "Beat slot 4:30 AM UTC — safe slot (4:00 AM = calibration-daily, 3:00 AM = score-stale-nightly)"
  - "7 unit tests written (5 required) — added biweekly offset test + below-threshold status=active test"
metrics:
  duration_minutes: 6
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 11 Plan 03: Recrawl Scheduler + CrawlResult.wines Patch Summary

**One-liner:** Celery recrawl scheduler with Redis NX dedup, asyncio.run() crawl+diff pipeline, and CrawlResult.wines in-memory accumulation — 7 unit tests, all passing.

---

## What Was Built

### `web_crawler.py` — CrawlResult Patch (Part A)

| Change | Location | Purpose |
|--------|----------|---------|
| `wines: List[Dict[str, Any]] = field(default_factory=list)` | CrawlResult dataclass | Accumulates wine dicts from `_persist_crawled_wines()` for diff engine |
| `result: Optional["CrawlResult"] = None` param | `_persist_crawled_wines()` signature | Accepts result reference for in-memory accumulation |
| `if result is not None: result.wines.append(record)` | `_persist_crawled_wines()` body | Appends each persisted record to result.wines |
| `result=result` at all 3 call sites | HTML (line ~281), image_menu (line ~735), pdf_vision (line ~770) | Wires result accumulation through all extraction paths |

**Critical:** `signature_hash` computation (line 491) was NOT modified — only the result.wines accumulation was added after `f.write()`.

### `recrawl_tasks.py` — New File (Part B)

| Component | Purpose |
|-----------|---------|
| `scheduled_recrawl_task` (beat, `recrawl.scheduled`) | Selects `crawl_schedule` rows where `next_crawl_at <= NOW() AND status='active'`; fans out one `crawl_and_diff_task.delay(restaurant_id)` per row |
| `crawl_and_diff_task` (worker, `recrawl.crawl_and_diff`) | Redis NX lock → async crawl → `MenuDiffService.run_diff()` → `_update_crawl_schedule()` |
| `_crawl_and_diff_async()` | Async body: fetches restaurant URL from `restaurant_directory`, `crawl_frequency` from `crawl_schedule`, runs crawl, passes `result.wines` to diff engine |
| `_update_crawl_schedule()` | Sets `last_crawled_at`, `next_crawl_at` (via FREQUENCY_DAYS map), resets `consecutive_failures=0` |
| `_mark_crawl_error()` | Increments `consecutive_failures`; sets `status='error'` when `>= CONSECUTIVE_FAILURE_THRESHOLD (3)` |

**Threat mitigations implemented:**
- T-11-03-01 (concurrent crawl DoS): Redis NX lock `crawl:{restaurant_id}`, TTL=7200s
- T-11-03-02 (thundering herd): Individual `crawl_and_diff_task.delay()` per restaurant; Redis NX second layer
- T-11-03-04 (infinite retry): `max_retries=3` + `_mark_crawl_error` on final failure

### `celery_app.py` — Updates

- `"jobs.recrawl_tasks"` added to `imports` tuple
- `recrawl-scheduled-daily` beat entry: `recrawl.scheduled`, `crontab(hour=4, minute=30)`, `expires=3500`

### `test_recrawl_tasks.py` — 7 Unit Tests

| Test | Covers |
|------|--------|
| `test_scheduled_recrawl_fans_out` | 2 due restaurants → queued=2, delay called for each |
| `test_scheduled_no_due_restaurants` | Empty result → queued=0, delay not called |
| `test_crawl_and_diff_deduped_when_lock_not_acquired` | Redis NX returns None → task returns None, delete not called |
| `test_update_crawl_schedule_weekly` | Sets last_crawled_at, next_crawl_at, consecutive_failures=0, status=active |
| `test_mark_crawl_error_sets_error_status_at_threshold` | 2 failures + 1 → consecutive_failures=3, status=error |
| `test_update_crawl_schedule_biweekly_offset` | biweekly → 14-day delta between last_crawled_at and next_crawl_at |
| `test_mark_crawl_error_stays_active_below_threshold` | 1 failure + 1 → consecutive_failures=2, status=active |

---

## Verification

- `grep 'wines:' services/agent-orchestrator/services/web_crawler.py` — **MATCH** (CrawlResult.wines field)
- `grep -c 'result=result' services/agent-orchestrator/services/web_crawler.py` — **3** (all 3 call sites)
- `grep 'jobs.recrawl_tasks' services/agent-orchestrator/jobs/celery_app.py` — **MATCH**
- `grep 'hour=4, minute=30' services/agent-orchestrator/jobs/celery_app.py` — **MATCH**
- `pytest tests/test_recrawl_tasks.py -x` — **7 passed, 0 failed**

---

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `fce394b` | feat(11-03): patch CrawlResult.wines + _persist_crawled_wines; add recrawl_tasks.py |
| Task 2 | `d287170` | feat(11-03): wire recrawl_tasks into celery_app + add 7 unit tests |

---

## Deviations from Plan

### Auto-fix [Rule 1 - Bug] Mock patch targets changed to `supabase.create_client`

- **Found during:** Task 2 test execution (first pytest run)
- **Issue:** `create_client` is imported locally inside each function body (`from supabase import create_client`). `@patch("jobs.recrawl_tasks.create_client")` raised `AttributeError: module does not have attribute 'create_client'`.
- **Fix:** Changed all `@patch("jobs.recrawl_tasks.create_client")` to `@patch("supabase.create_client")` — targets the module where the name actually lives at patch time.
- **Files modified:** `tests/test_recrawl_tasks.py`

### Auto-added: 2 extra tests (Rule 2 — missing critical coverage)

- **Found during:** Task 2 test writing
- **Addition 1:** `test_update_crawl_schedule_biweekly_offset` — verifies FREQUENCY_DAYS["biweekly"]=14 actually produces a 14-day next_crawl_at offset (arithmetic correctness)
- **Addition 2:** `test_mark_crawl_error_stays_active_below_threshold` — verifies below-threshold failures keep status='active' (the opposite of the threshold test; both cases needed for full coverage)
- **Commit:** `d287170`

---

## Known Stubs

None — all production code paths are fully wired:
- `CrawlResult.wines` is populated by the real `_persist_crawled_wines()` method
- `crawl_and_diff_task` calls the real `MenuDiffService.run_diff()` (built in Plan 02)
- `_update_crawl_schedule` / `_mark_crawl_error` write to real Supabase `crawl_schedule` table (created in Plan 01)

---

## Threat Flags

None. This plan:
- Introduces no new network endpoints (Celery internal tasks only)
- Redis NX lock uses parameterized `f"crawl:{restaurant_id}"` key — no injection surface
- Supabase queries use supabase-py parameterized `.eq()` — no raw SQL
- T-11-03-01, T-11-03-02, T-11-03-04 mitigations all implemented and verified by tests

---

## Self-Check: PASSED

- `services/agent-orchestrator/jobs/recrawl_tasks.py` — FOUND ✓
- `services/agent-orchestrator/tests/test_recrawl_tasks.py` — FOUND ✓
- `services/agent-orchestrator/services/web_crawler.py` contains `CrawlResult.wines` — FOUND ✓
- `services/agent-orchestrator/jobs/celery_app.py` contains `jobs.recrawl_tasks` — FOUND ✓
- Commit `fce394b` — FOUND ✓
- Commit `d287170` — FOUND ✓
- 7 tests pass — CONFIRMED ✓
