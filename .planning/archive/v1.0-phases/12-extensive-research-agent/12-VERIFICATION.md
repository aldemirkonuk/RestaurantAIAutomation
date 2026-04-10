---
phase: 12-extensive-research-agent
verified: 2026-04-06T00:00:00Z
status: human_needed
score: 11/11 automated must-haves verified
re_verification: false
human_verification:
  - test: "Run the E2E test suite against a live Supabase test environment"
    expected: "test_research_agent_fills_null_fields passes: ≥3 evidence_citation rows written, field_confidence updated with research_agent source, null_rate_after < null_rate_before, GET /api/v1/research/metrics returns 200 with all 5 categories and citation_completeness > 0"
    why_human: "pytest.mark.e2e test skips automatically when SUPABASE_URL / SUPABASE_KEY are not set. Requires a real Supabase test instance to exercise the DB write pipeline (research_runs, evidence_citations, research_run_stats, master_wine_library_submissions)"
  - test: "POST /api/v1/research/trigger with a running research_run row present"
    expected: "Returns HTTP 429 with message 'A research run is already in progress' (T-12-11 DoS mitigation)"
    why_human: "Cannot verify HTTP 429 behaviour without a running service + live research_runs row with status='running'"
  - test: "POST /api/v1/research/trigger with batch_size=101 in request body"
    expected: "Request rejected by Pydantic validation (Field(le=100)) before dispatching any tasks (T-12-10 Elevation mitigation)"
    why_human: "Requires a running FastAPI service to exercise Pydantic validation at the HTTP layer"
  - test: "Verify Playwright fallback triggers for a tier-A JS-heavy regulatory site (e.g. inao.gouv.fr)"
    expected: "Fetch-verify pipeline upgrades to Playwright when httpx body < 2KB or no wine keywords found, page text is cached in evidence_url_cache"
    why_human: "Requires live HTTP + Playwright browser installation; cannot verify without executing against a real URL"
---

# Phase 12: Extensive Research Agent Verification Report

**Phase Goal:** Build an autonomous, multi-step research agent that achieves near-perfect dataset coverage by targeting wine records with NULL or low-confidence fields after Phases 7–11. The agent uses deep multi-source evidence gathering with independent corroboration requirements, producing citable fills with url+snippet+timestamp provenance.
**Verified:** 2026-04-06T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                           | Status     | Evidence                                                                                      |
|----|--------------------------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------|
| 1  | SQL migrations for research_runs, research_run_stats, evidence_citations exist and are idempotent | ✓ VERIFIED | All 5 migration files present; use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` |
| 2  | research_agent_helpers.py exports all 7 required helper functions                               | ✓ VERIFIED | All 7 functions present: is_eligible_for_research, build_serper_query, classify_source_tier, detect_conflict, should_auto_promote, check_regression_guard, build_citation_record |
| 3  | research_agent_task Celery task exists with dry_run support and STRIDE mitigations              | ✓ VERIFIED | `@celery_app.task(name="research.agent_task")`, `dry_run: bool = False` param; T-12-05 through T-12-09 all implemented |
| 4  | Celery beat entry for daily budget check registered                                              | ✓ VERIFIED | `"research-daily-budget-check"` entry in `celery_app.conf.beat_schedule`, task=`research.daily_budget_check` |
| 5  | GET /api/v1/research/metrics returns all 5 metric categories                                    | ✓ VERIFIED | Endpoint defined; response_model has gap_closure, quality, evidence_hygiene, throughput_cost, safety |
| 6  | GET /api/v1/research/runs returns paginated run history                                         | ✓ VERIFIED | Endpoint defined with limit/offset params, ordered by started_at DESC                        |
| 7  | GET /api/v1/research/conflicts returns wines with conflict_candidates                           | ✓ VERIFIED | Queries master_wine_library_submissions where conflict_candidates IS NOT NULL AND != '{}'     |
| 8  | POST /api/v1/research/trigger dispatches research_agent_task.delay()                           | ✓ VERIFIED | `research_agent_task.delay(sid)` called for each submission_id in batch                      |
| 9  | research_router registered in main.py                                                           | ✓ VERIFIED | Line 13: `from api.research_routes import research_router`; line 29: `app.include_router(research_router)` |
| 10 | 24 unit tests pass for research_agent_helpers.py                                                | ✓ VERIFIED | `pytest tests/test_research_agent_helpers.py` → 24 passed in 0.04s                          |
| 11 | E2E test with RSCH-11 corroboration exists in test_research_agent_e2e.py                       | ✓ VERIFIED | `@pytest.mark.e2e test_research_agent_fills_null_fields` present; mocks Serper/Gemini at I/O boundary; asserts ≥3 citations, FC update, null_rate improvement, 5-category metrics |

**Score:** 11/11 truths verified (automated)

---

## Required Artifacts

| Artifact                                                               | Expected                                        | Status     | Details                                                                   |
|------------------------------------------------------------------------|-------------------------------------------------|------------|---------------------------------------------------------------------------|
| `supabase/migrations/20260412000000_research_runs.sql`                 | research_runs table, idempotent                 | ✓ VERIFIED | IF NOT EXISTS throughout; status CHECK constraint; 2 indexes               |
| `supabase/migrations/20260412000001_research_run_stats.sql`            | research_run_stats table, idempotent            | ✓ VERIFIED | FK to research_runs ON DELETE CASCADE; per-record null_rate fields         |
| `supabase/migrations/20260412000002_evidence_citations.sql`            | evidence_citations + evidence_url_cache tables  | ✓ VERIFIED | source_tier A/B/C CHECK; 7-day URL cache table; 4 indexes                  |
| `supabase/migrations/20260412000003_research_submissions_columns.sql`  | conflict_candidates + last_research_run_at cols | ✓ VERIFIED | ADD COLUMN IF NOT EXISTS; cooldown index                                   |
| `supabase/migrations/20260412000004_resolution_challenges.sql`         | resolution_challenges table                     | ✓ VERIFIED | Tier-A-only challenge model; status CHECK constraint                       |
| `services/agent-orchestrator/services/research_agent_helpers.py`       | Pure helper functions, all 7 exported           | ✓ VERIFIED | 449 lines; all 7 functions + RESEARCH_ALL_FIELDS (31 fields); no I/O      |
| `services/agent-orchestrator/jobs/research_tasks.py`                   | Celery task + full evidence loop                | ✓ VERIFIED | 992 lines; STRIDE T-12-05..09 all implemented; dry_run support             |
| `services/agent-orchestrator/jobs/celery_app.py`                       | Beat schedule entry for research                | ✓ VERIFIED | `research-daily-budget-check` registered hourly                            |
| `services/agent-orchestrator/api/research_routes.py`                   | 4 API endpoints                                 | ✓ VERIFIED | metrics, runs, conflicts, trigger all defined with correct prefix           |
| `services/agent-orchestrator/main.py`                                  | research_router included                        | ✓ VERIFIED | Line 13 (import), line 29 (include_router)                                 |
| `services/agent-orchestrator/tests/test_research_agent_helpers.py`     | 24 unit tests                                   | ✓ VERIFIED | 20 test functions, 24 collected (4 parametrized); all 24 pass              |
| `services/agent-orchestrator/tests/test_research_agent_e2e.py`         | RSCH-11 E2E corroboration test                  | ✓ VERIFIED | `@pytest.mark.e2e`; mocked I/O boundary; 3 DB assertions + metrics check  |

---

## Key Link Verification

| From                         | To                                         | Via                                          | Status     | Details                                                          |
|------------------------------|--------------------------------------------|----------------------------------------------|------------|------------------------------------------------------------------|
| `research_routes.py`         | `research_agent_task`                      | `from jobs.research_tasks import`; `.delay()` | ✓ WIRED   | Line 453 import, line 510 dispatch call                          |
| `research_tasks.py`          | `research_agent_helpers`                   | `from services.research_agent_helpers import` | ✓ WIRED   | All 7 helpers imported and used in `_process_record`             |
| `research_tasks.py`          | `field_confidence` service                 | `from services.field_confidence import`       | ✓ WIRED   | `merge_field_confidence`, `route_fields_by_threshold` called     |
| `research_tasks.py`          | `evidence_citations` table                 | `supabase.table("evidence_citations").insert` | ✓ WIRED   | `_write_results()` step (d)                                      |
| `research_tasks.py`          | `research_run_stats` table                 | `supabase.table("research_run_stats").insert` | ✓ WIRED   | After `_process_record()` in `_research_async`                   |
| `research_tasks.py`          | `conflict_candidates` JSONB                | `update_payload["conflict_candidates"]`       | ✓ WIRED   | Only written when `detect_conflict()` returns True               |
| `main.py`                    | `research_router`                          | `app.include_router(research_router)`         | ✓ WIRED   | Line 29; router prefix `/api/v1/research`                        |
| `celery_app.py`              | `research_tasks`                           | `imports` tuple includes `jobs.research_tasks` | ✓ WIRED  | Line 23                                                          |

---

## Data-Flow Trace (Level 4)

| Artifact                                | Data Variable     | Source                                                          | Produces Real Data | Status       |
|-----------------------------------------|-------------------|-----------------------------------------------------------------|--------------------|--------------|
| `research_routes.py` GET /metrics       | `stats_rows`      | `supabase.table("research_run_stats").select(...).execute()`    | Yes — DB query     | ✓ FLOWING   |
| `research_routes.py` GET /metrics       | `cit_rows`        | `supabase.table("evidence_citations").select(...).execute()`    | Yes — DB query     | ✓ FLOWING   |
| `research_routes.py` GET /runs          | `runs`            | `supabase.table("research_runs").select(...).range(...).execute()` | Yes — DB query  | ✓ FLOWING   |
| `research_routes.py` GET /conflicts     | `conflicts`       | `supabase.table("master_wine_library_submissions").select(...)` | Yes — DB query     | ✓ FLOWING   |
| `research_tasks.py` `_process_record()` | `citation_records` | Serper → Gemini → classify_source_tier → build_citation_record | Yes — pipeline    | ✓ FLOWING   |

---

## Behavioral Spot-Checks

| Behavior                                   | Command                                                                                                        | Result                                                    | Status    |
|--------------------------------------------|----------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------|-----------|
| 24 unit tests pass                          | `cd services/agent-orchestrator && python3 -m pytest tests/test_research_agent_helpers.py -v --tb=short`      | 24 passed in 0.04s                                       | ✓ PASS    |
| research_agent_task exported from module   | `grep "@celery_app.task" services/agent-orchestrator/jobs/research_tasks.py`                                  | `@celery_app.task(name="research.agent_task")` found     | ✓ PASS    |
| E2E test file contains RSCH-11 test        | `grep "@pytest.mark.e2e" services/agent-orchestrator/tests/test_research_agent_e2e.py`                        | `@pytest.mark.e2e` decorator on test_research_agent_fills_null_fields | ✓ PASS |
| research_router is registered in main.py   | `grep "research_router" services/agent-orchestrator/main.py`                                                  | Lines 13 (import) and 29 (include_router)                | ✓ PASS    |
| Beat schedule registers budget check       | `grep "research.daily_budget_check" services/agent-orchestrator/jobs/celery_app.py`                           | Found in beat_schedule dict                              | ✓ PASS    |
| E2E test (RSCH-11) live run               | `pytest tests/test_research_agent_e2e.py -m e2e` (requires Supabase)                                         | SKIP — SUPABASE_URL not set                              | ? SKIP    |

---

## Requirements Coverage

| Requirement | Implementation Evidence                                                                           | Status            |
|-------------|---------------------------------------------------------------------------------------------------|-------------------|
| RSCH-01     | `is_eligible_for_research` (cooldown + confidence gate), `get_target_fields`, `build_serper_query` | ✓ SATISFIED      |
| RSCH-02     | `build_citation_record` called for every promoted fill; batch inserted to `evidence_citations`   | ✓ SATISFIED       |
| RSCH-03     | `should_auto_promote` enforces tier-A or dual-independent-B/C corroboration                      | ✓ SATISFIED       |
| RSCH-04     | `classify_source_tier` with 60+ authoritative tier-A domains + dynamic producer detection        | ✓ SATISFIED       |
| RSCH-05     | Conflict → `conflict_candidates` JSONB (NOT field_confidence); `detect_conflict` with synonym exclusion | ✓ SATISFIED  |
| RSCH-06     | `is_eligible_for_research` skips `human_resolved` fields; `get_target_fields` excludes them      | ✓ SATISFIED       |
| RSCH-07     | `research_run_stats` insert after every `_process_record()` call                                 | ✓ SATISFIED       |
| RSCH-08     | `null_rate_before` / `null_rate_after` computed and stored in `research_run_stats`               | ✓ SATISFIED       |
| RSCH-09     | `_write_results` calls `merge_field_confidence()` then `route_fields_by_threshold()`; review-tier rows written to `field_review_queue` | ✓ SATISFIED |
| RSCH-10     | `resolution_challenges` table migration with tier-A-only challenge model                         | ✓ SATISFIED       |
| RSCH-11     | `test_research_agent_fills_null_fields` in `test_research_agent_e2e.py` with 3 DB assertions    | ✓ CODE EXISTS — live run needs human (SUPABASE_URL) |
| T-12-05     | `_is_safe_url()`: https-only + private IP range block; called in `_fetch_verify_value`          | ✓ SATISFIED       |
| T-12-06     | `call_counter >= max` stop rule + `record_cost >= ceiling` ceiling, both checked per field       | ✓ SATISFIED       |
| T-12-07     | `merge_field_confidence()` called in `_write_results` before every Supabase write               | ✓ SATISFIED       |
| T-12-08     | `_check_daily_budget()` as pre-flight in `_research_async`; advisory hourly beat task            | ✓ SATISFIED       |
| T-12-09     | `_has_pii()` regex filter; blocked snippets never reach `evidence_citations`                     | ✓ SATISFIED       |
| T-12-10     | `batch_size: int = Field(default=10, ge=1, le=100)` in TriggerRequest                           | ✓ SATISFIED (code); needs HTTP-layer human test |
| T-12-11     | GET check for `status='running'` before dispatch; raises 429 on conflict                         | ✓ SATISFIED (code); needs live HTTP human test  |
| T-12-12     | Accepted — conflicts endpoint is admin-facing, snippets are wine data only                       | ✓ ACCEPTED        |
| T-12-13     | E2E test uses `yield` fixture with `finally`-equivalent cleanup block                            | ✓ SATISFIED       |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `research_tasks.py:582` | `gemini_cost = 0.0001` — hardcoded cost constant | ℹ️ Info | Non-blocking; actual Gemini cost is logged via SpendLogger from API usage metadata; hardcoded value is a budget ceiling, not the only cost record |
| `research_tasks.py:820` | `_url_cache: dict` — module-level in-memory cache | ℹ️ Info | Benign; cache is non-persistent across worker restarts; Supabase `evidence_url_cache` is the authoritative store |

No blockers. No stubs. No empty implementations.

---

## Human Verification Required

### 1. E2E Test — RSCH-11 Live Run

**Test:** Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` env vars pointing at a test Supabase project that has all Phase 12 migrations applied, then run:
```bash
cd services/agent-orchestrator
pytest tests/test_research_agent_e2e.py -m e2e -v
```
**Expected:**
- Test inserts a submission with 5 NULL fields
- Mocked Serper/Gemini/fetch-verify pipeline fills ≥3 fields
- `evidence_citations` gets ≥3 rows with `source_url`, `snippet`, `retrieved_at` all populated
- `field_confidence` on the submission shows ≥3 fields with `source: "research_agent"` and `confidence > 0.5`
- `research_run_stats` row has `null_rate_after < null_rate_before`
- `GET /api/v1/research/metrics` returns 200 with `citation_completeness > 0`
- Teardown removes all inserted test rows

**Why human:** E2E test uses `pytest.skip()` when `SUPABASE_URL` is not set. Cannot run in this verification environment.

### 2. POST /trigger HTTP 429 Concurrency Guard (T-12-11)

**Test:** With a running research_run row (status='running') in the DB, call:
```bash
curl -X POST http://localhost:8000/api/v1/research/trigger -H "Content-Type: application/json" -d '{"batch_size": 5}'
```
**Expected:** HTTP 429 with detail: `"A research run is already in progress. Wait for it to complete before triggering another."`
**Why human:** Requires a running FastAPI service + a live `research_runs` row with `status='running'`.

### 3. POST /trigger Batch Size Cap (T-12-10)

**Test:** Send a trigger request with `batch_size: 101`:
```bash
curl -X POST http://localhost:8000/api/v1/research/trigger -H "Content-Type: application/json" -d '{"batch_size": 101}'
```
**Expected:** HTTP 422 Unprocessable Entity (Pydantic `le=100` validation error before any task dispatch)
**Why human:** Requires a running FastAPI service.

### 4. Playwright Fallback for JS-Heavy Tier-A Sites

**Test:** Trigger research for a wine with a known tier-A JS-heavy source (e.g. `inao.gouv.fr`). Observe logs for `Playwright fetch` and check `evidence_url_cache` for the URL entry.
**Expected:** Log line `"playwright"` in `fetch_method`; `evidence_url_cache` has a row with the URL and 50KB-capped `page_text`.
**Why human:** Requires Playwright installed (`pip install playwright && playwright install chromium`), live HTTP access to regulatory sites, and a running research agent.

---

## Gaps Summary

No gaps found. All 11 automated must-haves are verified. The 4 human verification items are live-system behaviours that require a running service, Supabase test connection, or network access to external sites — none can be verified programmatically.

The phase goal is architecturally complete: the autonomous multi-step research agent is built with all required components wired end-to-end. The RSCH-11 E2E test validates the full pipeline with mocked I/O and only requires a Supabase test instance to run the live assertions.

---

_Verified: 2026-04-06T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
