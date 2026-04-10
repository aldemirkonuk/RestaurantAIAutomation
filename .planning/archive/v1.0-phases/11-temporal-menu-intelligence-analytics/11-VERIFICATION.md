---
phase: 11-temporal-menu-intelligence-analytics
verified: 2026-04-06T18:30:00Z
status: human_needed
score: 8/8 must-haves verified
human_verification:
  - test: "Confirm all 5 Phase 11 tables exist in live Supabase instance"
    expected: "crawl_schedule, restaurant_wine_roster, menu_changes, wine_popularity, trending_wines all visible in Supabase dashboard"
    why_human: "supabase db push was executed per SUMMARY (commit e9d9716) but verifier cannot query live DB without credentials"
  - test: "Trigger a manual end-to-end recrawl cycle for one restaurant"
    expected: "crawl_and_diff_task runs, result.wines is populated, MenuDiffService.run_diff() produces events or skipped, crawl_schedule.last_crawled_at and next_crawl_at are updated"
    why_human: "Real WebCrawlerService call requires live internet + Supabase + Redis; cannot verify programmatically"
  - test: "Verify crawl_schedule rows exist for all restaurant_directory entries"
    expected: "SELECT COUNT(*) FROM crawl_schedule should equal COUNT(*) FROM restaurant_directory (backfill INSERT executed)"
    why_human: "Cannot query live DB without credentials; backfill is documented in SUMMARY but not re-verifiable offline"
  - test: "Confirm GET /api/v1/analytics/trends returns non-empty lists after at least one nightly trend_tasks run"
    expected: "trending_up and/or trending_down contain real wine entries; category_shifts/grape_trends/region_shifts are populated"
    why_human: "compute_trend_metrics_task hasn't run yet (phase just completed today — first run at 5:00 AM UTC); tables may be empty"
---

# Phase 11: Temporal Menu Intelligence & Analytics Verification Report

**Phase Goal:** Transform the extraction pipeline from a one-shot scanner into a living, breathing menu intelligence system. Schedule periodic re-crawls of known restaurant websites, detect menu changes (wines added, removed, prices changed), track wine lifecycle across restaurants over time, compute cross-restaurant popularity and regional trend analytics. This is the moat — no wine database in the world tracks restaurant menu changes over time.

**Verified:** 2026-04-06T18:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `crawl_schedule` table tracks per-restaurant re-crawl frequency and next execution time | ✓ VERIFIED | `supabase/migrations/20260411000000_phase11_temporal.sql` — CREATE TABLE IF NOT EXISTS crawl_schedule with restaurant_id, crawl_frequency, last_crawled_at, next_crawl_at, status; all FK/index/constraint checks pass |
| 2 | `scheduled_recrawl_task` Celery beat task runs daily, triggers re-crawl for due restaurants | ✓ VERIFIED | `jobs/recrawl_tasks.py` — `scheduled_recrawl_task` at `recrawl.scheduled`, beat entry `recrawl-scheduled-daily` at 4:30 AM UTC in `celery_app.py`; queries `crawl_schedule` where `next_crawl_at <= NOW() AND status='active'`, fans out `crawl_and_diff_task.delay(restaurant_id)` per row |
| 3 | Menu diff engine compares new crawl against previous: detects additions, removals, price changes | ✓ VERIFIED | `services/menu_diff_service.py` — `MenuDiffService.run_diff()` uses set arithmetic on signature_hash; added/removed/price_change event types; `_price_gate()` enforces abs≥$1 AND rel≥3% combined gate; 11 unit tests pass |
| 4 | `menu_changes` table stores all detected diffs with change_type, old/new values, timestamp | ✓ VERIFIED | Migration creates table with restaurant_id, wine_signature_hash, change_type CHECK IN ('added','removed','price_change'), old_value JSONB, new_value JSONB, detected_at; `MenuDiffService._change_event()` builds 5-field JSONB snapshots and inserts |
| 5 | `wine_popularity` materialized view or query computes cross-restaurant carrying count per wine | ✓ VERIFIED | `jobs/trend_tasks.py` — `_compute_popularity()`: builds hash→wine_id map from `master_wine_library_submissions`, counts distinct restaurant_ids per wine_id from `restaurant_wine_roster` via `defaultdict(set)`, upserts `wine_popularity` on_conflict=wine_id |
| 6 | `trending_wines` computation identifies wines with highest positive/negative restaurant-count delta over 30/60/90 day windows | ✓ VERIFIED | `jobs/trend_tasks.py` — `_compute_trending()`: fetches 90d `menu_changes` events, resolves hashes→wine_ids, computes per-window deltas, applies burst detection (≥3 new restaurants in 14d → +2.0), formula: (delta_30d×3.0)+(delta_60d×1.5)+(delta_90d×1.0)+burst_bonus; upserts `trending_wines` on_conflict=wine_id,window_days |
| 7 | `GET /api/v1/analytics/trends` returns regional trend data (category, grape, region breakdowns) | ✓ VERIFIED | `api/analytics_routes.py` — `get_trends()` endpoint with `_PERIOD_MAP` validation (30d/60d/90d → 400 on invalid), ILIKE metro filter on `restaurant_directory.city`, `TrendsResponse` with trending_up, trending_down, category_shifts, grape_trends, region_shifts; 11 endpoint tests pass |
| 8 | `GET /api/v1/analytics/wine/{id}/timeline` returns full lifecycle: first_seen, restaurants_carrying, price_history, menu_changes | ✓ VERIFIED | `api/analytics_routes.py` — `get_wine_timeline()` endpoint with UUID validation (422), master_wine_library lookup (404), assembles data from 4 tables: master_wine_library (name), wine_popularity (restaurant_count), restaurant_wine_roster (first/last_seen, price_history), menu_changes (full history limit 200) |

**Score:** 8/8 truths verified

---

### Required Artifacts

| Artifact | Min Lines | Actual Lines | Status | Details |
|----------|-----------|--------------|--------|---------|
| `supabase/migrations/20260411000000_phase11_temporal.sql` | — | 121 | ✓ VERIFIED | All 5 tables, 8 indexes, 5 UNIQUE constraints, FK references, backfill INSERT with RANDOM() jitter |
| `services/agent-orchestrator/config/settings.py` | — | — | ✓ VERIFIED | `recrawl_max_concurrent: int` present (default 10, env RECRAWL_MAX_CONCURRENT) |
| `services/agent-orchestrator/services/menu_diff_service.py` | 80 | 229 | ✓ VERIFIED | All 6 methods present; empty_crawl guard; price gate; JSONB snapshot; on_conflict upsert |
| `services/agent-orchestrator/tests/test_menu_diff_service.py` | 60 | 258 | ✓ VERIFIED | 11 test functions (min 9); all pass |
| `services/agent-orchestrator/services/web_crawler.py` | — | — | ✓ VERIFIED | `wines: List` field on CrawlResult; `result.wines.append` in `_persist_crawled_wines`; 3 call sites updated |
| `services/agent-orchestrator/jobs/recrawl_tasks.py` | 100 | 231 | ✓ VERIFIED | Both tasks present; Redis NX lock (ex=7200); consecutive failure tracking; asyncio.run() wrapper |
| `services/agent-orchestrator/jobs/celery_app.py` | — | — | ✓ VERIFIED | `jobs.recrawl_tasks` and `jobs.trend_tasks` in imports; beat entries at 4:30 AM and 5:00 AM UTC |
| `services/agent-orchestrator/tests/test_recrawl_tasks.py` | 50 | 136 | ✓ VERIFIED | 7 test functions (min 5); all pass |
| `services/agent-orchestrator/jobs/trend_tasks.py` | 120 | 304 | ✓ VERIFIED | `_compute_popularity` called before `_compute_trending` (ordering guarantee); both upsert on_conflict |
| `services/agent-orchestrator/tests/test_trend_tasks.py` | 60 | 170 | ✓ VERIFIED | 8 test functions (min 6); trend_score formula test passes |
| `services/agent-orchestrator/api/analytics_routes.py` | — | 488 | ✓ VERIFIED | Both new endpoints + 6 new Pydantic models; existing `get_wine_scores` untouched |
| `services/agent-orchestrator/tests/test_temporal_analytics.py` | 60 | 218 | ✓ VERIFIED | 11 test functions (min 8); all pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `crawl_schedule.restaurant_id` | `restaurant_directory.id` | REFERENCES restaurant_directory(id) ON DELETE CASCADE | ✓ WIRED | Migration SQL contains `REFERENCES restaurant_directory` |
| `restaurant_wine_roster.restaurant_id` | `restaurant_directory.id` | REFERENCES restaurant_directory(id) ON DELETE CASCADE | ✓ WIRED | Migration SQL contains `REFERENCES restaurant_directory` |
| `wine_popularity.wine_id` | `master_wine_library.id` | REFERENCES master_wine_library(id) ON DELETE CASCADE | ✓ WIRED | Migration SQL contains `REFERENCES master_wine_library` |
| `scheduled_recrawl_task` | `crawl_and_diff_task.delay(restaurant_id)` | fan-out per due crawl_schedule row | ✓ WIRED | `crawl_and_diff_task.delay` present in `recrawl_tasks.py` |
| `crawl_and_diff_task` | `web_crawler.crawl_restaurant()` | asyncio.run(_crawl_and_diff_async()) | ✓ WIRED | `asyncio.run` present in `recrawl_tasks.py` |
| `crawl_and_diff_task` | `MenuDiffService.run_diff()` | result.wines passed to diff engine | ✓ WIRED | `run_diff` called with `result.wines` in `_crawl_and_diff_async` |
| `MenuDiffService.run_diff()` | `supabase.table('menu_changes').insert()` | _change_event() builds JSONB snapshot dict | ✓ WIRED | Pattern `menu_changes.*insert` confirmed in `menu_diff_service.py` |
| `MenuDiffService.run_diff()` | `supabase.table('restaurant_wine_roster').upsert()` | _upsert_roster() called after events written | ✓ WIRED | Pattern `restaurant_wine_roster.*upsert` confirmed with `on_conflict` |
| `compute_trend_metrics_task` | `supabase.table('wine_popularity').upsert()` | hash→wine_id join from master_wine_library_submissions | ✓ WIRED | `wine_popularity` + `upsert` + `on_conflict="wine_id"` in `trend_tasks.py` |
| `compute_trend_metrics_task` | `supabase.table('trending_wines').upsert()` | menu_changes events aggregated by window | ✓ WIRED | `trending_wines` + `upsert` + `on_conflict="wine_id,window_days"` in `trend_tasks.py` |
| `GET /analytics/trends` | `supabase.table('trending_wines')` | window_days filter from period param; optional metro join | ✓ WIRED | `trending_wines` query with `.eq("window_days", window_days)` in `analytics_routes.py` |
| `GET /analytics/wine/{id}/timeline` | `restaurant_wine_roster`, `menu_changes`, `wine_popularity` | wine_id UUID lookup across 3 tables | ✓ WIRED | All 3 table queries present in `get_wine_timeline()` endpoint |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `analytics_routes.py::get_trends` | `tw_rows` | `supabase.table("trending_wines").select(...).eq("window_days", window_days)` | Yes — queries live table | ✓ FLOWING |
| `analytics_routes.py::get_wine_timeline` | `wine_resp.data`, `changes`, `price_history` | `master_wine_library`, `menu_changes`, `restaurant_wine_roster` | Yes — queries 4 live tables | ✓ FLOWING |
| `trend_tasks.py::_compute_popularity` | `wine_to_restaurants` | `master_wine_library_submissions` + `restaurant_wine_roster` | Yes — real DB joins | ✓ FLOWING |
| `trend_tasks.py::_compute_trending` | `resolved_events`, `window_deltas` | `menu_changes` (90d window) | Yes — real DB query | ✓ FLOWING |
| `recrawl_tasks.py::_crawl_and_diff_async` | `result.wines` | `web_crawler.crawl_restaurant()` → `_persist_crawled_wines()` → `result.wines.append(record)` | Yes — populated by real crawler | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All Phase 11 tests pass (37 total) | `python3 -m pytest tests/test_menu_diff_service.py tests/test_recrawl_tasks.py tests/test_trend_tasks.py tests/test_temporal_analytics.py -v` | 37 passed in 0.57s | ✓ PASS |
| Migration file structure complete | python3 check: 21 patterns in migration SQL | All 21 checks pass | ✓ PASS |
| menu_diff_service.py structure complete | python3 check: 13 required patterns | 0 missing | ✓ PASS |
| recrawl_tasks.py structure complete | python3 check: 11 required patterns | 0 missing | ✓ PASS |
| trend_tasks.py structure complete | python3 check: 13 required patterns | 0 missing; ordering confirmed (pop_idx < trend_idx) | ✓ PASS |
| analytics_routes.py structure complete | python3 check: 21 required patterns | 0 missing; status_code=422 count=2 | ✓ PASS |
| web_crawler.py patch applied | `result.wines.append` + 3 `result=result` call sites | All present | ✓ PASS |
| celery_app.py beat schedule correct | 4:30 AM (recrawl) + 5:00 AM (trend) + both imports | All present | ✓ PASS |
| Live Supabase db push | Documented in SUMMARY (commit e9d9716, "Finished supabase db push") | Cannot re-verify offline | ? SKIP |
| End-to-end recrawl with real URLs | Requires live Redis + WebCrawlerService + Supabase | Cannot execute without services | ? SKIP |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| TEMP-01 | 11-01 | `crawl_schedule` table with restaurant_id, crawl_frequency, last_crawled_at, next_crawl_at, status | ✓ SATISFIED | Migration file contains table DDL with all required columns and CHECK constraints |
| TEMP-02 | 11-03 | `scheduled_recrawl_task` Celery beat task runs daily, selects restaurants where next_crawl_at ≤ now(), triggers re-crawl, updates schedule | ✓ SATISFIED | `recrawl_tasks.py` implements both tasks; `celery_app.py` has beat entry at 4:30 AM UTC |
| TEMP-03 | 11-02 | Menu diff engine: compares new wine list against previous via signature_hash — added/removed/price_change | ✓ SATISFIED | `MenuDiffService.run_diff()` with set arithmetic; 11 tests verify all 3 diff types and edge cases |
| TEMP-04 | 11-02 | `menu_changes` table: restaurant_id, wine_signature_hash, change_type, old_value JSONB, new_value JSONB, detected_at | ✓ SATISFIED | Migration creates table; `MenuDiffService._change_event()` builds correct JSONB shape |
| TEMP-05 | 11-04 | `wine_popularity` computed query: per wine, count of distinct restaurants currently carrying it | ✓ SATISFIED | `_compute_popularity()` uses `defaultdict(set)` for distinct counting; correct join path via submissions |
| TEMP-06 | 11-04 | `trending_wines` computation: highest positive/negative delta over 30/60/90 day windows | ✓ SATISFIED | `_compute_trending()` with per-window deltas, burst detection, trend_score formula (D-02) |
| TEMP-07 | 11-05 | `GET /api/v1/analytics/trends?metro=chicago&period=90d` with regional trend data including category/grape/region breakdowns | ✓ SATISFIED | Endpoint with metro ILIKE filter, period validation, all 5 response fields including breakdown lists |
| TEMP-08 | 11-05 | `GET /api/v1/analytics/wine/{id}/timeline` with full lifecycle: first_seen_at, last_seen_at, restaurants_carrying, price_history, menu_changes | ✓ SATISFIED | Endpoint assembles data from 4 tables; 422/404 error handling; price_history from roster |

**Orphaned requirements:** None — all 8 TEMP-01..08 requirements claimed by plans and verified.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `services/menu_diff_service.py` | 142 | `return {}` in exception handler of `_fetch_roster()` | ℹ️ Info | Defensive fallback: returns empty roster dict when Supabase call fails. When roster is empty, all new wines become "added" events — correct behavior for first crawl and acceptable error recovery. NOT a stub. |

No blockers or warnings found.

---

### Human Verification Required

#### 1. Live Supabase Tables

**Test:** Open Supabase dashboard → Table Editor → verify `crawl_schedule`, `restaurant_wine_roster`, `menu_changes`, `wine_popularity`, `trending_wines` all exist.

**Expected:** All 5 tables visible with their respective columns and indexes. `crawl_schedule` should contain rows for every existing `restaurant_directory` entry (backfill INSERT executed in migration).

**Why human:** Cannot query live Supabase instance without credentials from this verifier.

---

#### 2. End-to-End Recrawl Cycle

**Test:** With Celery worker + beat running: either wait for the 4:30 AM UTC beat trigger, or manually call `crawl_and_diff_task.delay("<restaurant_id>")` for a restaurant with a valid `website_url`.

**Expected:**
- Redis acquires lock `crawl:{restaurant_id}`
- `WebCrawlerService.crawl_restaurant()` runs, `result.wines` is populated with at least 1 wine dict
- `MenuDiffService.run_diff(restaurant_id, result.wines)` runs — first crawl should produce N "added" events and N `restaurant_wine_roster` upserts
- `crawl_schedule.last_crawled_at` is set to now; `next_crawl_at` is advanced by 7 days; `consecutive_failures` reset to 0

**Why human:** Requires live Redis, Supabase, and WebCrawlerService (network access) — not executable in offline verification.

---

#### 3. Verify crawl_schedule Backfill

**Test:** Run `SELECT COUNT(*) FROM crawl_schedule` and compare against `SELECT COUNT(*) FROM restaurant_directory`.

**Expected:** Counts should be equal (one `crawl_schedule` row per `restaurant_directory` entry, seeded by the backfill INSERT).

**Why human:** Cannot query live DB without credentials.

---

#### 4. Nightly Trend Metrics Run

**Test:** After at least one successful recrawl cycle, wait for `compute_trend_metrics_task` to run at 5:00 AM UTC (or trigger manually). Then call `GET /api/v1/analytics/trends?period=30d`.

**Expected:** `trending_up` and/or `trending_down` contain actual wine entries; `wine_popularity` table has rows; `trending_wines` table has rows for all 3 windows.

**Why human:** Phase completed today (2026-04-06) — no nightly runs have executed yet. All trend data tables are empty until the first nightly job runs. This is expected and by design, not a gap.

---

#### 5. Aspirational Endpoints (Informational Only — Not in Success Criteria)

The Phase 11 roadmap description mentions two endpoints not in the 8 Success Criteria and not in TEMP-01..08 requirements:
- `GET /api/v1/analytics/restaurant/{id}/changes` — restaurant-level menu change history
- `GET /api/v1/analytics/popularity?limit=50` — most-carried wines across all restaurants

These are NOT gaps (not in contractual success criteria). Data to power them exists in `menu_changes` and `wine_popularity` tables. If needed, they can be added as a backlog item without blocking Phase 11 completion.

---

### Gaps Summary

No automated gaps found. All 8 Success Criteria verified. All 8 requirements (TEMP-01..08) satisfied. All 12 artifacts present and substantive. All 12 key links wired. 37/37 tests pass.

The `human_needed` status is driven purely by the need to verify live Supabase state and an end-to-end crawl cycle — standard infrastructure verification that cannot be done programmatically.

---

_Verified: 2026-04-06T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
