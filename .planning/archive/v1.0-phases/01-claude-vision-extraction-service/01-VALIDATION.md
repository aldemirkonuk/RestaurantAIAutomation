---
phase: 1
slug: claude-vision-extraction-service
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-05
audited: 2026-04-05
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (services/agent-orchestrator/tests/) |
| **Config file** | services/agent-orchestrator/pytest.ini |
| **Quick run command** | `cd services/agent-orchestrator && python3 -m pytest tests/test_claude_vision_extractor.py -x -q` |
| **Full suite command** | `cd services/agent-orchestrator && python3 -m pytest tests/test_claude_vision_extractor.py tests/test_onboarding_extract_endpoint.py -q` |
| **Estimated runtime** | ~2 seconds (unit only, no live API key required) |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | CLVS-01 | unit | `pytest tests/test_claude_vision_extractor.py::test_extract_menu_returns_extraction_result -q` | ✅ | ✅ green |
| 01-01-02 | 01 | 1 | CLVS-01 | unit | `pytest tests/test_claude_vision_extractor.py::test_extract_menu_fires_one_call_per_page -q` | ✅ | ✅ green |
| 01-01-03 | 01 | 1 | CLVS-02 | unit | `pytest tests/test_claude_vision_extractor.py::test_parse_raw_json -q` | ✅ | ✅ green |
| 01-01-04 | 01 | 1 | CLVS-02 | unit | `pytest tests/test_claude_vision_extractor.py::test_parse_json_fence -q` | ✅ | ✅ green |
| 01-01-05 | 01 | 1 | CLVS-02 | unit | `pytest tests/test_claude_vision_extractor.py::test_parse_garbage -q` | ✅ | ✅ green |
| 01-01-06 | 01 | 1 | CLVS-03 | unit | `pytest tests/test_claude_vision_extractor.py::test_cost_formula_per_page -q` | ✅ | ✅ green |
| 01-01-07 | 01 | 1 | CLVS-07 | unit | `pytest tests/test_claude_vision_extractor.py::test_completeness_all_fields -q` | ✅ | ✅ green |
| 01-01-08 | 01 | 1 | CLVS-07 | unit | `pytest tests/test_claude_vision_extractor.py::test_completeness_half_fields -q` | ✅ | ✅ green |
| 01-01-09 | 01 | 1 | CLVS-07 | unit | `pytest tests/test_claude_vision_extractor.py::test_completeness_empty_wine -q` | ✅ | ✅ green |
| 01-01-10 | 01 | 1 | CLVS-07 | unit | `pytest tests/test_claude_vision_extractor.py::test_needs_review_threshold_strict_less_than -q` | ✅ | ✅ green |
| 01-02-01 | 02 | 2 | CLVS-05 | unit | `pytest tests/test_onboarding_extract_endpoint.py::test_extract_missing_restaurant_id -q` | ✅ | ✅ green |
| 01-02-02 | 02 | 2 | CLVS-05 | unit | `pytest tests/test_onboarding_extract_endpoint.py::test_extract_pdf_base64_rejected -q` | ✅ | ✅ green |
| 01-02-03 | 02 | 2 | CLVS-05 | unit | `pytest tests/test_onboarding_extract_endpoint.py::test_extract_empty_images_rejected -q` | ✅ | ✅ green |
| 01-02-04 | 02 | 2 | CLVS-05 | unit | `pytest tests/test_onboarding_extract_endpoint.py::test_extract_success_200 -q` | ✅ | ✅ green |
| 01-02-05 | 02 | 2 | CLVS-06 | unit | `pytest tests/test_onboarding_extract_endpoint.py::test_extract_partial_failure_207 -q` | ✅ | ✅ green |
| 01-02-06 | 02 | 2 | CLVS-06 | unit | `pytest tests/test_onboarding_extract_endpoint.py::test_extract_all_pages_fail_503 -q` | ✅ | ✅ green |
| 01-02-07 | 02 | 2 | CLVS-05 | integration | manual (live CLAUDE_API_KEY + Supabase) | N/A | manual-only |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST /extract with real image returns wines | CLVS-05 | Requires live CLAUDE_API_KEY + Supabase | `CLAUDE_API_KEY=... SUPABASE_URL=... pytest -m integration -s` |
| Supabase insert persists wine to master_wine_library_submissions | CLVS-06 | Requires live Supabase | As above — check table after run |

---

## Nyquist Dimensions Coverage

| Dimension | Status | Notes |
|-----------|--------|-------|
| 1. Happy path | ✅ | test_extract_success_200, test_extract_menu_returns_extraction_result |
| 2. Edge cases | ✅ | test_parse_garbage, test_completeness_empty_wine, test_extract_empty_images_rejected |
| 3. Error paths | ✅ | test_extract_partial_failure_207, test_extract_all_pages_fail_503, test_parse_garbage |
| 4. Integration | manual | Live API + Supabase test — correct to skip without keys |
| 5. Regression | ✅ | Full suite 16 passed; Settings fix resolves celery_broker_url gap from Phase 4 |
| 6. Performance | ✅ | Semaphore(5) concurrency cap tested via test_extract_menu_fires_one_call_per_page |
| 7. Security | N/A | No auth surface in this phase (API key via env only) |
| 8. Observability | ✅ | cost_usd tracked per page (test_cost_formula_per_page) |

---

## Validation Audit 2026-04-05

| Metric | Count |
|--------|-------|
| Gaps found | 6 |
| Resolved | 6 |
| Escalated to manual | 1 (live integration — correct) |

**Root cause:** `Settings` class missing `celery_broker_url` / `celery_backend_url` — added by Phase 4 Celery integration but never backfilled. `onboarding_routes.py` imports `haiku_enrich_task` at module level, which transitively imports `celery_app`, which reads the missing attribute.

**Fix:** Added `celery_broker_url` and `celery_backend_url` to `config/settings.py` with env var defaults (`CELERY_BROKER_URL`, `CELERY_BACKEND_URL`). No test changes required.

**Result: 16 passed, 0 failed**
