---
phase: 2
slug: gemini-flash-crawler
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-02
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (existing, services/agent-orchestrator/tests/) |
| **Config file** | services/agent-orchestrator/pytest.ini or pyproject.toml |
| **Quick run command** | `cd services/agent-orchestrator && python -m pytest tests/test_gemini_flash_crawler.py -x -q` |
| **Full suite command** | `cd services/agent-orchestrator && python -m pytest tests/ -q` |
| **Estimated runtime** | ~15 seconds (unit only, no live API) |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | GMFL-01 | unit | `pytest tests/test_gemini_flash_crawler.py::test_model_is_gemini_2_0_flash -q` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | GMFL-01 | unit | `pytest tests/test_gemini_flash_crawler.py::test_uses_async_client -q` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | GMFL-02 | unit | `pytest tests/test_gemini_flash_crawler.py::test_html_extraction_pipeline -q` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | GMFL-03 | unit | `pytest tests/test_gemini_flash_crawler.py::test_dedup_skips_existing_wine -q` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 1 | GMFL-04 | unit | `pytest tests/test_gemini_flash_crawler.py::test_robots_txt_respected -q` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 1 | GMFL-05 | integration | manual (live URL) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `services/agent-orchestrator/tests/test_gemini_flash_crawler.py` — stubs for GMFL-01 through GMFL-05
- [ ] Fixtures: mock `google.genai.AsyncClient`, mock HTTP responses, mock JSONL write

*Existing pytest infrastructure (conftest.py, pytest-asyncio) confirmed installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Crawl one real restaurant URL → ≥ 1 wine extracted | GMFL-05 | Requires live internet + real Google API key | Run `python -m pytest tests/test_gemini_flash_crawler.py::test_integration_live -s` with `GOOGLE_API_KEY` set in .env |
| robots.txt disallow blocks crawl | GMFL-04 | Needs a real disallow URL | Point crawler at a URL with `Disallow: /` and verify empty result |

---

## Nyquist Dimensions Coverage

| Dimension | Status | Notes |
|-----------|--------|-------|
| 1. Happy path | ⬜ | GMFL-01 model string test |
| 2. Edge cases | ⬜ | Empty HTML, no wines found |
| 3. Error paths | ⬜ | API timeout, parse failure |
| 4. Integration | ⬜ | GMFL-05 live test |
| 5. Regression | ⬜ | Existing vlm_extraction tests must still pass |
| 6. Performance | ⬜ | robots.txt check < 1s |
| 7. Security | N/A | No auth surface in this phase |
| 8. Observability | ⬜ | Cost logging per crawl |
