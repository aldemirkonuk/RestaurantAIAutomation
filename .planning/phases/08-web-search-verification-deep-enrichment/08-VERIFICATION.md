---
phase: 08-web-search-verification-deep-enrichment
verified: 2026-04-06T00:00:00Z
status: human_needed
score: 15/15 must-haves verified
re_verification: false
human_verification:
  - test: "Set SERPER_API_KEY and run web_verify_task.delay(wine_id) for a real wine with low-confidence region. Confirm task executes without error."
    expected: "Celery task completes, field_confidence updated in Supabase with verification_status='web_verified' or 'contradicted', web_verified_at timestamp written."
    why_human: "All HTTP calls to Serper are mocked in tests. Live API key and running Celery worker required to confirm real search results flow through the pipeline."
  - test: "Set GOOGLE_API_KEY and trigger parse_search_results() with real Serper snippets. Confirm WineVerificationResult is populated."
    expected: "Gemini 2.5 Flash returns JSON matching WineVerificationResult schema. At least 3 wine fields (region, country, grape_variety) populated for a known wine."
    why_human: "Gemini call is mocked in test suite. Live Google API key required to verify new SDK (from google import genai) + response_mime_type='application/json' work in production."
  - test: "Confirm supabase db push has applied the producers table migration. Check Supabase dashboard or run: SELECT table_name FROM information_schema.tables WHERE table_name='producers'."
    expected: "producers table exists with 17 columns including normalized_name, portfolio JSONB, verification_sources TEXT[]. UNIQUE INDEX producers_normalized_name_key present. web_verified_at column exists on master_wine_library_submissions."
    why_human: "SQL migration file exists and is correct, but supabase db push execution cannot be verified programmatically from this context."
  - test: "Onboard a restaurant menu with wines having low-confidence regions. Confirm that after haiku_enrich_task completes, web_verify_task is queued in Celery."
    expected: "Celery task queue shows web_verify.verify_wine tasks. After processing, field_confidence entries for region/country/producer contain verification_status field."
    why_human: "The trigger chain haiku_tasks → web_verify_task.delay() requires a running Celery worker and real Supabase connection to observe end-to-end."
---

# Phase 8: Web Search Verification & Deep Enrichment — Verification Report

**Phase Goal:** Implement web-search verification that automatically cross-references extracted wine data against live web sources, boosts field confidence on concordance, flags contradictions for review, and builds a producer knowledge graph — closing the "invisible data quality gap" between what was extracted and what is actually true.

**Verified:** 2026-04-06
**Status:** HUMAN_NEEDED — all automated checks pass; 4 live integration items need human testing
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | web_verify_task Celery task exists at `name='web_verify.verify_wine'`, accepts wine_id, deduplicates via Redis NX lock | ✓ VERIFIED | `web_verify_tasks.py` line 139: `name="web_verify.verify_wine"`, `nx=True, ex=3600` lock, `r.delete(lock_key)` in finally |
| 2 | Search query constructed from producer + wine_name + vintage; Serper API called with top-5 results | ✓ VERIFIED | `build_search_query()` in `producer_normalization.py`; `serper_search(query, num_results=5)` in `_verify_async()` |
| 3 | Search results parsed by Gemini 2.5 Flash using new `google-genai` SDK with `response_mime_type="application/json"` | ✓ VERIFIED | `web_verification_service.py` line 173: `client = genai.Client(api_key=...)`, model `"gemini-2.5-flash"`, `response_mime_type` config |
| 4 | Concordance engine: `check_concordance()` returns `'concordance' \| 'contradiction' \| 'new_data'` with region alias + numeric tolerance | ✓ VERIFIED | `check_concordance()` in `web_verification_service.py`; REGION_ALIASES dict; NUMERIC_FIELDS set; 5 passing unit tests |
| 5 | Concordance boost: `apply_concordance_result()` raises field confidence to `max(0.95, web_confidence)` and sets `verification_status='web_verified'` | ✓ VERIFIED | Line 312: `"confidence": max(0.95, web_confidence)`, `"verification_status": "web_verified"`; test `test_apply_concordance_boosts_confidence` passes |
| 6 | Contradiction flag: `apply_concordance_result()` sets `verification_status='contradicted'` and preserves `contradicted_value` without overwriting existing value | ✓ VERIFIED | Lines 316–330: contradiction path; `"contradicted_value": web_value`; test `test_apply_contradiction_flags_both_values` passes |
| 7 | `producers` knowledge graph table created with all 17 columns including UNIQUE INDEX on `normalized_name` | ✓ VERIFIED | `20260407000000_producers_table.sql`: `CREATE TABLE IF NOT EXISTS producers (17 cols)`, `CREATE UNIQUE INDEX IF NOT EXISTS producers_normalized_name_key` |
| 8 | Producer graph lookup runs BEFORE web search — known producer triggers `apply_producer_graph_enrichment()`, Serper skipped | ✓ VERIFIED | `_verify_async()` lines 252–277: `lookup_producer()` called first; `if producer_in_graph:` branch skips Serper entirely |
| 9 | `verification_status` is the 4th key inside each `field_confidence` JSONB entry; tracked as `'web_verified' \| 'contradicted' \| 'producer_graph'` | ✓ VERIFIED | All three statuses set in `apply_concordance_result()` and `apply_producer_graph_enrichment()`; WSRCH-06 invariant documented in module docstring |
| 10 | Tiered strategy: `_should_web_verify()` checks (a) any FC confidence < 0.8, (b) producer not in graph, (c) never web-verified | ✓ VERIFIED | `_should_web_verify()` lines 94–131; test `test_tiered_search_strategy` covers all 3 branches (pass/skip/always-new-producer) |
| 11 | Daily budget cap: `check_and_reserve_search_budget()` uses Redis `INCRBYFLOAT` (atomic), checked BEFORE Serper call, fails open on Redis error | ✓ VERIFIED | `check_and_reserve_search_budget()` lines 46–87: `incrbyfloat`, undo on overspend, `return True` on exception; test `test_budget_cap_enforced` covers cap/ok/fail-open cases |
| 12 | `web_verify_task.delay(wine_id)` triggered from `haiku_tasks.py` after enrichment merge, non-fatal (try/except) | ✓ VERIFIED | `haiku_tasks.py` lines 127–147: lazy import, `_should_web_verify()` check, `web_verify_task.delay(wine_id)`, wrapped in `try/except` |
| 13 | `celery_app.py` includes `"jobs.web_verify_tasks"` in imports tuple | ✓ VERIFIED | `celery_app.py` line 23: `imports=(..., "jobs.web_verify_tasks")` |
| 14 | SpendLogger called for Serper ($0.001 fixed) and Gemini Flash (token-based) costs | ✓ VERIFIED | `_verify_async()` lines 296–305: Serper spend log; `parse_search_results()` lines 193–200: Gemini spend log |
| 15 | All 11 pytest tests pass: 10 unit tests + 1 E2E mock pipeline (WSRCH-09) | ✓ VERIFIED | **`pytest tests/test_web_verification.py -x` → 11 passed in 0.97s** |

**Score: 15/15 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260407000000_producers_table.sql` | producers table DDL + UNIQUE INDEX + updated_at trigger + `web_verified_at` column on submissions | ✓ VERIFIED | 60 lines; all 17 columns; `producers_normalized_name_key` UNIQUE INDEX; trigger function; `ALTER TABLE master_wine_library_submissions ADD COLUMN IF NOT EXISTS web_verified_at` |
| `services/agent-orchestrator/config/settings.py` | `serper_api_key`, `web_search_daily_budget_usd`, `serper_cost_per_query` attributes | ✓ VERIFIED | Lines 44–49: all 3 Phase 8 attributes present; `serper_cost_per_query = 0.001`; lru_cache and get_settings() untouched |
| `services/agent-orchestrator/requirements.txt` | `python-slugify[unidecode]==8.0.4` | ✓ VERIFIED | Confirmed present |
| `services/agent-orchestrator/services/serper_client.py` | `serper_search()` async coroutine + `SerperResult` TypedDict | ✓ VERIFIED | 98 lines; `httpx.AsyncClient`; X-API-KEY header; tenacity retry (3 attempts); timeout=10.0; returns `list[SerperResult]` |
| `services/agent-orchestrator/services/producer_normalization.py` | `normalize_producer_name()` + `build_search_query()` | ✓ VERIFIED | 89 lines; `unidecode` + `re.sub`; no async/DB; test confirms `"Château Müller-Catoir"` → `"chateau-muller-catoir"` |
| `services/agent-orchestrator/services/web_verification_service.py` | 9 exports: `WineVerificationResult`, `REGION_ALIASES`, `NUMERIC_FIELDS`, `parse_search_results`, `check_concordance`, `apply_concordance_result`, `apply_producer_graph_enrichment`, `lookup_producer`, `upsert_producer` | ✓ VERIFIED | 489 lines; all 9 symbols present; `WineVerificationResult` has 17 fields; Gemini new SDK; `merge_field_confidence` import wired |
| `services/agent-orchestrator/jobs/web_verify_tasks.py` | `web_verify_task` Celery task + `_verify_async()` + `check_and_reserve_search_budget()` + `_should_web_verify()` | ✓ VERIFIED | 390 lines; Redis NX lock; INCRBYFLOAT budget; tiered eligibility; concordance loop; SpendLogger calls |
| `services/agent-orchestrator/jobs/celery_app.py` | `"jobs.web_verify_tasks"` in imports tuple | ✓ VERIFIED | Line 23: imports tuple updated |
| `services/agent-orchestrator/jobs/haiku_tasks.py` | `web_verify_task.delay(wine_id)` trigger after enrichment | ✓ VERIFIED | Lines 127–147: late import, `_should_web_verify()` check, `.delay(wine_id)`, non-fatal try/except |
| `services/agent-orchestrator/tests/test_web_verification.py` | 11 tests covering WSRCH-01 through WSRCH-09 | ✓ VERIFIED | 356 lines; 10 unit + 1 E2E; all pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `settings.py` | `SERPER_API_KEY` env var | `os.getenv("SERPER_API_KEY")` | ✓ WIRED | Line 44: `self.serper_api_key: Optional[str] = os.getenv("SERPER_API_KEY")` |
| `serper_client.py` | `https://google.serper.dev/search` | `httpx.AsyncClient.post()` | ✓ WIRED | Line 71: URL string; line 79: `client.post(url, headers=headers, json=payload)` |
| `producer_normalization.py` | `unidecode` library | `from unidecode import unidecode` | ✓ WIRED | Line 25: direct import; called in `normalize_producer_name()` |
| `web_verification_service.py` | `gemini-2.5-flash` via google-genai SDK | `genai.Client().models.generate_content()` | ✓ WIRED | Lines 172–180: `genai.Client(api_key=...)`, `model="gemini-2.5-flash"`, structured JSON config |
| `apply_concordance_result()` | `merge_field_confidence()` | `from services.field_confidence import merge_field_confidence` | ✓ WIRED | Line 28 import; called at lines 339 and 510 |
| `lookup_producer()` | `producers` table | `supabase.table("producers").select().eq("normalized_name")` | ✓ WIRED | Lines 403–407: `.eq("normalized_name", normalized_name).maybe_single().execute()` |
| `upsert_producer()` | `producers` table | `supabase.table("producers").upsert(on_conflict="normalized_name")` | ✓ WIRED | Line 476: `.upsert(row, on_conflict="normalized_name")` |
| `haiku_tasks._enrich_async()` | `web_verify_task` | `web_verify_task.delay(wine_id)` | ✓ WIRED | Line 137: `web_verify_task.delay(wine_id)` inside non-fatal try block |
| `check_and_reserve_search_budget()` | Redis | `redis_lib.from_url(...).incrbyfloat(today_key, cost)` | ✓ WIRED | Line 73: `float(r.incrbyfloat(today_key, cost))`; undo on line 78 |
| `celery_app.py` | `web_verify_tasks` module | `imports=(..., "jobs.web_verify_tasks")` | ✓ WIRED | Line 23: tuple includes `"jobs.web_verify_tasks"` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `web_verify_tasks._verify_async()` | `existing_fc` | Supabase `.select("field_confidence").eq("id", wine_id)` | Yes — real DB query | ✓ FLOWING |
| `web_verify_tasks._verify_async()` | `snippets` | `serper_search(query, num_results=5)` | Yes — live Serper API call (mocked in tests) | ✓ FLOWING (mock-verified) |
| `web_verification_service.parse_search_results()` | `WineVerificationResult` | `genai.Client(...).models.generate_content(...)` | Yes — live Gemini call (mocked in tests) | ✓ FLOWING (mock-verified) |
| `web_verify_tasks._verify_async()` | `updated_fc` | `apply_concordance_result()` / `apply_producer_graph_enrichment()` + Supabase `.update()` | Yes — non-empty dict written back to DB | ✓ FLOWING |
| `web_verification_service.lookup_producer()` | `producer_row` | Supabase `.table("producers").eq("normalized_name")` | Yes — real DB query; returns None when not found | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 11 Phase 8 tests pass | `python3 -m pytest tests/test_web_verification.py -x` | `11 passed in 0.97s` | ✓ PASS |
| normalize_producer_name Unicode | `test_normalize_producer_name_unicode` | `"Château Müller-Catoir"` → `"chateau-muller-catoir"` | ✓ PASS |
| Concordance boost to 0.95 | `test_apply_concordance_boosts_confidence` | `confidence=0.95`, `verification_status='web_verified'` | ✓ PASS |
| Contradiction flags without overwrite | `test_apply_contradiction_flags_both_values` | `verification_status='contradicted'`, `contradicted_value='Burgundy'`, original value preserved | ✓ PASS |
| Redis budget cap atomic check | `test_budget_cap_enforced` | `5.1 > 5.0 → False` (undo called); `0.5 → True`; Redis error → `True` (fail open) | ✓ PASS |
| Tiered strategy all 3 branches | `test_tiered_search_strategy` | low-confidence → True; all ≥0.8+web_verified → False; new producer → True; never-verified → True | ✓ PASS |
| E2E mock pipeline (WSRCH-09) | `test_e2e_web_verify_flow` | `field_confidence["region"]["confidence"] >= 0.95`, `verification_status='web_verified'` | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| WSRCH-01 | 08-02, 08-04, 08-05 | `web_verify_task` Celery task accepts wine_id, constructs search query, executes Serper web search | ✓ SATISFIED | `web_verify_tasks.py`: `web_verify.verify_wine` task; `build_search_query()`; `serper_search()` call |
| WSRCH-02 | 08-03, 08-05 | Top-5 search results parsed by Gemini Flash with structured extraction | ✓ SATISFIED | `parse_search_results()`: `gemini-2.5-flash`; `response_mime_type="application/json"`; `WineVerificationResult` Pydantic schema |
| WSRCH-03 | 08-03, 08-05 | Concordance engine: boost to 0.95+ on concordance; flag `verification_status='contradicted'` on mismatch | ✓ SATISFIED | `check_concordance()` + `apply_concordance_result()`; region aliases (Burgundy=Bourgogne); numeric tolerance; 5 unit tests |
| WSRCH-04 | 08-01, 08-03 | `producers` table created with all required columns | ✓ SATISFIED | `20260407000000_producers_table.sql`: 17 columns; UNIQUE INDEX; updated_at trigger |
| WSRCH-05 | 08-02, 08-03, 08-05 | Producer graph lookup before web search; instant enrichment if producer known | ✓ SATISFIED | `lookup_producer()` called first in `_verify_async()`; `apply_producer_graph_enrichment()` path skips Serper |
| WSRCH-06 | 08-03, 08-05 | `verification_status` added as 4th key in field_confidence JSONB entries | ✓ SATISFIED | All three statuses (`web_verified`, `contradicted`, `producer_graph`) set by service functions; module docstring enforces invariant |
| WSRCH-07 | 08-04, 08-05 | Tiered strategy: only verify when (a) confidence < 0.8, (b) new producer, or (c) never verified | ✓ SATISFIED | `_should_web_verify()` all 3 conditions; triggered from `haiku_tasks.py` after merge |
| WSRCH-08 | 08-01, 08-04, 08-05 | Daily budget cap $5/day; atomic Redis INCRBYFLOAT; checked before Serper call; fails open | ✓ SATISFIED | `check_and_reserve_search_budget()`; `settings.web_search_daily_budget_usd` default 5.0; `serper_cost_per_query=0.001` |
| WSRCH-09 | 08-05 | E2E test: low-confidence wine → web search → FC updated with verification_status | ✓ SATISFIED | `test_e2e_web_verify_flow` passes: `confidence >= 0.95`, `verification_status='web_verified'` confirmed |

**All 9 WSRCH requirements satisfied programmatically. REQUIREMENTS.md currently shows `[ ]` (unchecked) for all — recommend updating to `[x]` after confirming live integration.**

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | No TODO/FIXME, no placeholder returns, no empty handlers | — | All implementations are substantive |

---

### Human Verification Required

#### 1. Live Serper API Integration

**Test:** Set `SERPER_API_KEY` env var. Run a Celery worker. Call `web_verify_task.delay("<real_wine_id>")` where the wine has a low-confidence region field (confidence < 0.8) and a non-graph producer.

**Expected:** Task completes without error. Supabase row for the wine shows `field_confidence` updated with `verification_status='web_verified'` (or `'contradicted'`) and `web_verified_at` timestamp written.

**Why human:** All Serper calls are mocked in the test suite. A live `SERPER_API_KEY` and running Celery worker are required to confirm the `X-API-KEY` header, endpoint, and response parsing work end-to-end against the real Serper API.

---

#### 2. Live Gemini 2.5 Flash Integration

**Test:** Set `GOOGLE_API_KEY`. Call `parse_search_results()` directly with 2–3 real Serper snippets for a known wine (e.g., Domaine Leflaive Puligny-Montrachet 2019).

**Expected:** `WineVerificationResult` returned with `region`, `country`, and at least 2 other fields populated. `source_confidence` between 0.6–0.95 depending on snippet quality.

**Why human:** Gemini call is mocked in tests. Confirms that the `from google import genai` (new SDK) + `response_mime_type="application/json"` + `response_json_schema` configuration work with the live Gemini 2.5 Flash API (which may differ in JSON schema handling from the mock).

---

#### 3. Supabase Migration Applied

**Test:** Run `supabase db push` or check Supabase dashboard for:
- `producers` table with 17 columns
- `producers_normalized_name_key` UNIQUE INDEX on `producers(normalized_name)`
- `web_verified_at TIMESTAMPTZ` column on `master_wine_library_submissions`
- `mwls_web_verified_at_idx` sparse index

**Expected:** All DDL objects present. `upsert_producer()` can insert a test row and re-inserting with same `normalized_name` updates rather than duplicates.

**Why human:** The migration file exists and is correct SQL, but `supabase db push` execution cannot be verified from this context. The UNIQUE INDEX is load-bearing — without it, `upsert_producer()` silently inserts duplicate rows (documented as Pitfall 4 in RESEARCH.md).

---

#### 4. End-to-End Pipeline Trigger Chain

**Test:** Onboard a restaurant menu via `POST /api/v1/onboarding/extract`. Observe Celery task queue after `haiku_enrich_task` completes.

**Expected:** `web_verify.verify_wine` tasks appear in Celery queue for wines that passed `_should_web_verify()`. After processing, `field_confidence` entries contain `verification_status` field.

**Why human:** The trigger chain requires a running Celery worker, Redis, live Supabase connection, and haiku enrichment to complete before the web verify trigger fires. The non-fatal `try/except` wrapper means a silently failed trigger (e.g., import error in a misconfigured deployment) would not surface in logs unless specifically monitored.

---

### Gaps Summary

**No gaps found.** All 9 WSRCH requirements are satisfied by substantive, wired, data-flowing implementations. The 4 human verification items above are integration checks — they do not represent missing code, but rather live-system confirmation that cannot be automated without credentials and running services.

---

_Verified: 2026-04-06_
_Verifier: Claude (gsd-verifier)_
