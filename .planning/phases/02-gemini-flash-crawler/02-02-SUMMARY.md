---
phase: 02-gemini-flash-crawler
plan: 02
subsystem: web-crawler
tags: [gemini-flash, web-crawler, robots-txt, jsonl, deduplication, tdd]
dependency_graph:
  requires:
    - 02-01  # GeminiFlashCrawlerExtractor + VLMExtractionResult
  provides:
    - robots.txt gating before Playwright launch
    - Gemini Flash extraction wired into crawl pipeline
    - JSONL persistence to datasets/restaurant_menus/
    - Wine deduplication against master_wine_library
  affects:
    - services/agent-orchestrator/services/web_crawler.py
    - services/agent-orchestrator/tests/test_gemini_flash_crawler.py
tech_stack:
  added:
    - urllib.robotparser.RobotFileParser (stdlib, no new deps)
    - asyncio.to_thread for non-blocking robots.txt reads
  patterns:
    - fail-open pattern for both robots.txt and dedup (returns True/False on error to allow crawl)
    - JSONL append-mode persistence with source_type marker
key_files:
  created: []
  modified:
    - services/agent-orchestrator/services/web_crawler.py
    - services/agent-orchestrator/tests/test_gemini_flash_crawler.py
key_decisions:
  - "async_playwright moved to module-level import to enable test patching via patch('services.web_crawler.async_playwright')"
  - "_daily_count is in-memory only (resets on restart) — documented as known limitation per Phase 2 research"
  - "robots.txt and dedup both fail open — crawl proceeds if robots.txt unreadable or Supabase unavailable"
metrics:
  duration_minutes: 9
  completed_date: "2026-04-02"
  tasks_completed: 2
  files_modified: 2
  tests_added: 6
  tests_passing: 11
requirements:
  - GMFL-02
  - GMFL-03
  - GMFL-04
  - GMFL-05
---

# Phase 02 Plan 02: Gemini Flash Crawler Wiring Summary

**One-liner:** Wire GeminiFlashCrawlerExtractor into WebCrawlerService with robots.txt gate, JSONL persistence, and master_wine_library deduplication.

## What Was Built

This plan closed all four remaining Gemini Flash Crawler requirements (GMFL-02..05) by modifying `web_crawler.py` and completing the 6 xfail test stubs from Plan 01.

### Task 1: Replace xfail stubs with real failing tests (TDD RED)

Replaced 6 `@pytest.mark.xfail` stubs with full test implementations:

- `test_robots_txt_disallow_blocks_crawl` — patches `_is_crawl_allowed` to return False, asserts `ContentType.ERROR` + "robots.txt" in error message
- `test_rate_limit_enforced` — sets `_daily_count` to limit, asserts ERROR + "rate limit" in message
- `test_crawl_calls_gemini_after_html` — patches Playwright + GeminiFlashCrawlerExtractor, asserts `extract_from_text` called once
- `test_crawled_wines_written_to_dataset` — uses `tmp_path` + `monkeypatch` to redirect `RESTAURANT_MENUS_DIR`, asserts JSONL written with correct fields
- `test_duplicate_wine_skipped` — patches `_wine_is_duplicate` → True, asserts no JSONL written
- `test_non_duplicate_wine_inserted` — patches `_wine_is_duplicate` → False, asserts JSONL written with 1 record

### Task 2: Implement robots.txt gate, Gemini call, JSONL persistence, deduplication (TDD GREEN)

Added to `web_crawler.py`:

1. **`RESTAURANT_MENUS_DIR`** constant — `PROJECT_ROOT / "datasets" / "restaurant_menus"`

2. **`_is_crawl_allowed(url)`** (async) — RobotFileParser via asyncio.to_thread; fail open on error

3. **`_wine_is_duplicate(wine, restaurant_name)`** (sync) — Supabase `.ilike("name", ...)` + optional `.eq("vintage", ...)` query; fail open when supabase is None or errors

4. **`_persist_crawled_wines(wines, restaurant_name, source_url)`** (sync) — JSONL append to `datasets/restaurant_menus/<YYYYMMDD>_<slug>.jsonl`, each record has `source_type="crawled"`

5. **Wired robots.txt gate** in `crawl_restaurant()` BEFORE Playwright launch (after rate limit check)

6. **Wired Gemini extraction block** in `crawl_restaurant()` AFTER content hash, only when `content_type == HTML_MENU`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Moved async_playwright to module-level import**
- **Found during:** Task 2 GREEN phase — tests for `test_crawl_calls_gemini_after_html`, `test_crawled_wines_written_to_dataset`, etc. failed with `AttributeError: module 'services.web_crawler' does not have the attribute 'async_playwright'`
- **Issue:** The original code imported `async_playwright` inside `crawl_restaurant()` as a local import, making it impossible to patch via `patch("services.web_crawler.async_playwright")` — the standard unittest.mock approach requires the symbol to exist at module level
- **Fix:** Moved to top-level `try/except ImportError` block; updated `crawl_restaurant()` to check `if async_playwright is None` instead of the inner try/except
- **Files modified:** `services/agent-orchestrator/services/web_crawler.py`
- **Commit:** 44bcc06

## Commits

| Hash | Message |
|------|---------|
| 93b3dc4 | test(02-02): add failing tests for GMFL-02 GMFL-03 GMFL-04 GMFL-05 |
| 44bcc06 | feat(02-02): add robots.txt gate, Gemini extraction, JSONL storage, dedup to web_crawler |

## Verification Results

```
pytest tests/test_gemini_flash_crawler.py -k "not integration" -v
11 passed, 1 deselected

pytest tests/ -q
27 passed, 1 skipped
```

- `grep -n "_is_crawl_allowed" web_crawler.py` — definition at line 349 + call at line 173
- `grep -n "asyncio.to_thread" web_crawler.py` — returns line 362
- `grep -n "RobotFileParser" web_crawler.py` — import at line 34 + usage at line 358
- `grep -n "RESTAURANT_MENUS_DIR" web_crawler.py` — constant at line 47 + usage at lines 411, 414
- `grep -n "source_type.*crawled" web_crawler.py` — returns line 422
- `grep -n "master_wine_library" web_crawler.py` — dedup query at line 389
- `grep -n "get_gemini_crawler_extractor" web_crawler.py` — import at line 36 + call at line 258
- `grep -n "robots.txt disallows" web_crawler.py` — error message at line 174

## Known Stubs

None — all plan objectives are wired. The integration test (`test_integration_live_crawl`) intentionally skips without `GOOGLE_API_KEY` set and is marked `@pytest.mark.integration`.

## Requirements Satisfied

| ID | Requirement | Status |
|----|-------------|--------|
| GMFL-02 | crawl_restaurant() calls Gemini Flash extraction after HTML content | DONE |
| GMFL-03 | Crawled wines written to datasets/restaurant_menus/ JSONL with source_type=crawled | DONE |
| GMFL-04 | robots.txt check before Playwright launch; rate limit unchanged | DONE |
| GMFL-05 | _wine_is_duplicate() queries master_wine_library before persisting | DONE |
