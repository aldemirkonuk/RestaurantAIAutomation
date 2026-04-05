---
phase: 2
slug: gemini-flash-crawler
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-02
audited: 2026-04-05
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
| 02-01-01 | 01 | 1 | GMFL-01 | unit | `pytest tests/test_gemini_flash_crawler.py::test_model_is_gemini_2_5_flash -q` | ✅ | ✅ green |
| 02-01-02 | 01 | 1 | GMFL-01 | unit | `pytest tests/test_gemini_flash_crawler.py::test_client_lazy_init_and_model -q` | ✅ | ✅ green |
| 02-01-03 | 01 | 1 | GMFL-01 | unit | `pytest tests/test_gemini_flash_crawler.py::test_extract_from_text_returns_wines -q` | ✅ | ✅ green |
| 02-01-04 | 01 | 1 | GMFL-01 | unit | `pytest tests/test_gemini_flash_crawler.py::test_extract_empty_html_returns_empty_result -q` | ✅ | ✅ green |
| 02-01-05 | 01 | 1 | GMFL-01 | unit | `pytest tests/test_gemini_flash_crawler.py::test_extract_api_error_returns_warning -q` | ✅ | ✅ green |
| 02-02-01 | 02 | 2 | GMFL-04 | unit | `pytest tests/test_gemini_flash_crawler.py::test_robots_txt_disallow_blocks_crawl -q` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | GMFL-04 | unit | `pytest tests/test_gemini_flash_crawler.py::test_rate_limit_enforced -q` | ✅ | ✅ green |
| 02-02-03 | 02 | 2 | GMFL-02 | unit | `pytest tests/test_gemini_flash_crawler.py::test_crawl_calls_gemini_after_html -q` | ✅ | ✅ green |
| 02-02-04 | 02 | 2 | GMFL-03 | unit | `pytest tests/test_gemini_flash_crawler.py::test_crawled_wines_written_to_dataset -q` | ✅ | ✅ green |
| 02-02-05 | 02 | 2 | GMFL-05 | unit | `pytest tests/test_gemini_flash_crawler.py::test_duplicate_wine_skipped -q` | ✅ | ✅ green |
| 02-02-06 | 02 | 2 | GMFL-05 | unit | `pytest tests/test_gemini_flash_crawler.py::test_non_duplicate_wine_inserted -q` | ✅ | ✅ green |
| 02-02-07 | 02 | 2 | GMFL-05 | integration | manual (live URL) | N/A | manual-only |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `services/agent-orchestrator/tests/test_gemini_flash_crawler.py` — 11 tests covering GMFL-01 through GMFL-05
- [x] Fixtures: direct `extractor._client` injection (robust, no module-level patching), `tmp_path` for JSONL, `monkeypatch` for dir redirect

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
| 1. Happy path | ✅ | test_extract_from_text_returns_wines, test_crawl_calls_gemini_after_html |
| 2. Edge cases | ✅ | test_extract_empty_html_returns_empty_result, test_duplicate_wine_skipped |
| 3. Error paths | ✅ | test_extract_api_error_returns_warning, test_robots_txt_disallow_blocks_crawl, test_rate_limit_enforced |
| 4. Integration | manual | test_integration_live_crawl — skipped without GOOGLE_API_KEY (correct) |
| 5. Regression | ✅ | Full suite runs green (27 passed) |
| 6. Performance | ✅ | robots.txt gate checked before Playwright launch |
| 7. Security | N/A | No auth surface in this phase |
| 8. Observability | ✅ | spend_logger.log() called per crawl in extract_from_text |

---

## Validation Audit 2026-04-05

| Metric | Count |
|--------|-------|
| Gaps found | 6 |
| Resolved | 6 |
| Escalated to manual | 1 (live integration — correct) |

**Changes made:**
- Rewrote GMFL-01 tests to inject `extractor._client = mock_client` directly (no fragile module-level patch)
- `test_uses_async_client` → `test_client_lazy_init_and_model`: verifies RuntimeError on missing key + MODEL_ID + model_used
- Model string updated to `gemini-2.5-flash` throughout (implementation upgraded via quick task)
- `source_type` assertions updated to `record["data_enrichment"]["source_type"]` (Supabase-aligned nested structure)
- Result: **11 passed, 1 skipped** (live integration skip is intentional)
