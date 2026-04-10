---
plan: 06-03
phase: 06-image-menu-extraction
wave: 3
status: complete
completed: 2026-04-05
---

# Summary: Wave 3 — Unit Tests + E2E Harness Extension

## What Was Built

### Unit Tests — `services/agent-orchestrator/tests/test_image_menu.py`

7 tests covering all 6 IMGX requirements + extract_pdf document block:

| Test | Requirement |
|------|-------------|
| `test_take_viewport_chunks_returns_jpeg_bytes` | IMGX-02 — viewport chunk capture |
| `test_image_only_sets_detected` | IMGX-01 — IMAGE_ONLY path sets image_menu_detected=True |
| `test_extract_menu_called_with_b64_strings` | IMGX-03 — bytes encoded to base64 str before extract_menu |
| `test_persist_called_with_image_menu_source_type` | IMGX-04+05 — source_type="image_menu" in persist call |
| `test_html_menu_source_type_is_crawled` | IMGX-06 — existing Gemini HTML path unchanged, source_type="crawled" |
| `test_extract_pdf_uses_document_content_block` | IMGX-01 — extract_pdf sends document content block with application/pdf |

All tests use `AsyncMock` for Playwright pages and mock `get_claude_vision_extractor`. No live API calls.

### E2E Harness — `scripts/e2e_restaurants.json`

Added 5th entry:
```json
{"name": "Tredita", "url": "https://tredita.com/menus/", "expect_image_menu": true}
```

### E2E Harness — `scripts/e2e_crawl_harness.py`

- `results.append()` extended with `image_menu_detected` and `image_menu_pass` keys
- Post-append block: for `expect_image_menu` restaurants, filters `new_wines` for `data_enrichment.source_type == "image_menu"`, sets `image_menu_pass = len(...) >= 1`
- `write_report()` summary table extended with "Image Menu" column (PASS/FAIL/—)
- `_run_dry_run()` prints CLAUDE_API_KEY note alongside GOOGLE_API_KEY note

## Key Files

- `services/agent-orchestrator/tests/test_image_menu.py` (new)
- `scripts/e2e_restaurants.json` (Tredita + expect_image_menu flag)
- `scripts/e2e_crawl_harness.py` (IMGX-07 assertion + report column)

## Self-Check: PASSED

- All 6+ test functions exist with correct names
- `expect_image_menu: true` in e2e_restaurants.json for Tredita
- `image_menu_pass` appears in results dict + write_report table
- `source_type.*image_menu` filter expression in harness
- All 3 files are syntactically valid Python/JSON
- IMGX-07 live verification: run harness with GOOGLE_API_KEY + CLAUDE_API_KEY set to confirm ≥1 wine via image_menu path
