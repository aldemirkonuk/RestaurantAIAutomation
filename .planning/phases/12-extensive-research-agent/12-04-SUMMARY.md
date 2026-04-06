---
phase: 12-extensive-research-agent
plan: "04"
subsystem: research-agent
tags: [tests, unit-tests, e2e, tdd, rsch-11, pytest, research-agent-helpers]
dependency_graph:
  requires:
    - "Phase 12 Plan 01: research_agent_helpers.py (pure functions under test)"
    - "Phase 12 Plan 02: research_tasks.py (Celery task / _research_async under E2E test)"
    - "Phase 12 Plan 03: research_routes.py (metrics endpoint under E2E test)"
  provides:
    - "test_research_agent_helpers.py: 24 unit tests covering all 8 pure helper functions"
    - "test_research_agent_e2e.py: RSCH-11 E2E test with mocked Serper + Gemini"
  affects: []
tech_stack:
  added:
    - "services/agent-orchestrator/tests/test_research_agent_helpers.py"
    - "services/agent-orchestrator/tests/test_research_agent_e2e.py"
  patterns:
    - "pytest.mark.parametrize for tier-map tests and confidence key mapping"
    - "yield fixture with implicit finally for E2E teardown (T-12-13)"
    - "AsyncMock + side_effect patching at I/O boundary (serper_search, _extract_field_candidates, _fetch_verify_value)"
    - "pytest.skip() on missing SUPABASE_URL — graceful, not failure"
key_files:
  created:
    - "services/agent-orchestrator/tests/test_research_agent_helpers.py"
    - "services/agent-orchestrator/tests/test_research_agent_e2e.py"
  modified: []
decisions:
  - "24 unit tests (≥20 required) — precise coverage, no redundant test stubs"
  - "E2E test calls _research_async() directly via asyncio.run() rather than research_agent_task() wrapper — avoids Celery overhead in CI while testing identical code path"
  - "Pre-fill 26 of 31 fc fields at 0.95 confidence, leave wine_name/producer/region/country/grape_variety as NULL — ensures exactly 5 target fields so stop-rule math is predictable"
  - "yield fixture teardown deletes evidence_citations, field_review_queue, research_run_stats, research_runs, submission row — unique UUID prevents test collisions"
metrics:
  duration_minutes: 3
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 12 Plan 04: Research Agent Tests — Unit + E2E Summary

**One-liner:** 24 unit tests covering all 8 pure helper functions (zero external dependencies) + RSCH-11 E2E integration test with mocked Serper/Gemini asserting null_rate improvement and all 5 metrics endpoint categories.

---

## What Was Built

### Task 1: `test_research_agent_helpers.py` — Unit Tests

24 test cases covering every exported function in `research_agent_helpers.py`:

| Function | Tests | Key Scenarios |
|----------|-------|---------------|
| `is_eligible_for_research` | 3 | Cooldown gate (3d vs 10d), human_resolved lock |
| `get_target_fields` | 2 | NULL field included, high-confidence field excluded |
| `build_serper_query` | 1 | Appellation query includes DOCG/DOC/AOC |
| `classify_source_tier` | 3 (2 parametrized) | Tier A (consorzio), tier B (wine-searcher), tier C (unknown) |
| `detect_conflict` | 3 | True (Syrah/Merlot), False (Syrah/Shiraz synonyms), False (single) |
| `should_auto_promote` | 4 | A_single, B_dual, same-domain→B_single, empty |
| `assign_confidence_by_tier` | 4 (parametrized) | A_single→0.95, B_dual→0.87, B_single→0.72, C_single→0.60 |
| `check_regression_guard` | 3 | Safe improvement, regression blocked, new field safe |
| `build_citation_record` | 1 | All required schema keys present |

**Result: 24 passed, 0 failures. Zero external dependencies.**

### Task 2: `test_research_agent_e2e.py` — RSCH-11 E2E Test

| Component | What It Tests |
|-----------|---------------|
| `research_submission` fixture | Creates test submission + teardown (T-12-13: yield+finally) |
| `test_research_agent_fills_null_fields` | Full pipeline: insert → agent → citations → FC update → metrics |

**E2E test flow:**
1. Insert test submission with 5 NULL target fields (wine_name, producer, region, country, grape_variety), 26 other fields pre-filled at confidence 0.95
2. Patch `serper_search` → returns 2 results per query (Consorzio Brunello + Wine-Searcher)
3. Patch `_extract_field_candidates` → returns tier-A/B candidates for the 5 target fields, `[]` for all others
4. Patch `_fetch_verify_value` → always returns `True`
5. Call `_research_async(submission_id, dry_run=False)` directly via `asyncio.run()`
6. Assert: `len(evidence_citations) >= 3` — each row has source_url + snippet + retrieved_at
7. Assert: field_confidence has ≥3 fields with source="research_agent" and confidence > 0.5
8. Assert: `null_rate_after < null_rate_before` in research_run_stats (5/31 → 2/31)
9. Assert: `GET /api/v1/research/metrics` → 200, all 5 categories present, citation_completeness > 0
10. Teardown: deletes all test rows (evidence_citations, field_review_queue, research_run_stats, research_runs, submission)

**Stop-rule math:** With max_calls=8 and 5 target fields:
- Field 1 (wine_name): Serper+Gemini+FetchVerify = 3 calls → counter=3, fills at A_single (0.95)
- Field 2 (producer): 3 more calls → counter=6, fills at B_single (0.72)
- Field 3 (region): Serper+Gemini (counter=7→8), fetch-verify skipped (8 < 7 is False), fills at B_single (0.72)
- Field 4 (country): STOP (counter=8 >= 8)

Result: **3 fields filled, 3 citation rows, null_rate 5/31→2/31** ✓

---

## Verification Results

```
Unit tests:
pytest tests/test_research_agent_helpers.py -v → 24 passed, 0 failed ✓

Syntax check:
python3 -c "import ast; ast.parse(open('tests/test_research_agent_e2e.py').read())" → SYNTAX OK ✓

Grep checks:
grep "test_research_agent_fills_null_fields" tests/test_research_agent_e2e.py → match ✓
grep "gap_closure" tests/test_research_agent_e2e.py → match ✓
grep "evidence_citations" tests/test_research_agent_e2e.py → match ✓
grep "pytest.mark.e2e" tests/test_research_agent_e2e.py → match ✓

E2E without SUPABASE_URL:
pytest tests/test_research_agent_e2e.py -v → 1 skipped (graceful) ✓
```

---

## Deviations from Plan

None — plan executed exactly as written. Prior execution (commits 10e3d5b, 5a50808) had already fixed the `lstrip("www.")` → `removeprefix("www.")` bug in `research_agent_helpers.py` and registered the `e2e` pytest marker. This execution verified those fixes hold and produced clean test runs on the first attempt.

---

## Known Stubs

None. Unit tests are complete with no stubs. E2E test skips (not stubs) when Supabase is unconfigured — correct behavior for an integration test.

---

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced in this plan.

T-12-13 mitigated: test fixture uses `yield` + unconditional cleanup block; all test rows are deleted via unique UUID submission_id regardless of test outcome.

---

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1: Unit tests for research_agent_helpers | `d829111` | test(12-04): add 24 unit tests for research_agent_helpers.py |
| Task 2: E2E integration test (RSCH-11) | `069f13a` | test(12-04): add E2E integration test for RSCH-11 |

---

## Self-Check: PASSED

- [x] `services/agent-orchestrator/tests/test_research_agent_helpers.py` — exists (24 tests)
- [x] `services/agent-orchestrator/tests/test_research_agent_e2e.py` — exists
- [x] `pytest tests/test_research_agent_helpers.py` → 24 passed, 0 failed
- [x] `python3 ast.parse(test_research_agent_e2e.py)` → SYNTAX OK
- [x] `grep "test_research_agent_fills_null_fields"` → match
- [x] `grep "gap_closure"` → match
- [x] `grep "evidence_citations"` → match
- [x] `grep "pytest.mark.e2e"` → match
- [x] E2E test skips gracefully without SUPABASE_URL (1 skipped, 0 failed)
- [x] Commit `d829111` — exists
- [x] Commit `069f13a` — exists
