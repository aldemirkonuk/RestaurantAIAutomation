---
phase: 06-image-menu-extraction
verified: 2026-04-05T00:00:00Z
status: passed
score: 15/15 must-haves verified
re_verification: false
---

# Phase 6: Image Menu Extraction Verification Report

**Phase Goal:** Close the image-menu blind spot in the Gemini crawler pipeline. Three failure cases previously returned 0 wines: IMAGE_ONLY (screenshot captured, not extracted), PDF_LINK (bytes downloaded, not extracted), HTML_MENU+0-wines with image signals. Phase 6 routes all three through existing Claude Vision extraction brain.
**Verified:** 2026-04-05T00:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                     | Status     | Evidence                                                                                          |
|----|-------------------------------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------------|
| 1  | IMAGE_ONLY pages route through Claude Vision and return extracted wines                   | VERIFIED   | `crawl_restaurant()` lines 249-256: IMAGE_ONLY path calls `_handle_image_menu()`                |
| 2  | PDF_LINK pages route through Claude Vision native PDF extraction                          | VERIFIED   | `crawl_restaurant()` lines 240-241: PDF_LINK path calls `_handle_pdf_vision()`                  |
| 3  | HTML_MENU+0-wine pages with image signals fall through to Vision path                    | VERIFIED   | `crawl_restaurant()` lines 281-284: 0-wine check calls `_is_image_menu()` then `_handle_image_menu()` |
| 4  | Claude Vision extractor has native PDF support via document content block                 | VERIFIED   | `extract_pdf()` at line 318; uses `"type": "document"` + `"media_type": "application/pdf"`      |
| 5  | Image-menu wines are tagged with `source_type="image_menu"` in JSONL                     | VERIFIED   | `_handle_image_menu()` line 726-728 passes `source_type="image_menu"` to `_persist_crawled_wines()` |
| 6  | PDF-vision wines are tagged with `source_type="pdf_vision_fallback"` in JSONL            | VERIFIED   | `_handle_pdf_vision()` line 761-764 passes `source_type="pdf_vision_fallback"`                   |
| 7  | Existing Gemini HTML_MENU path is unchanged (no source_type argument, uses default)      | VERIFIED   | `crawl_restaurant()` line 276: `self._persist_crawled_wines(non_dupes, ...)` — no source_type arg |
| 8  | `CrawlResult.image_menu_detected` tracks when Vision path was taken                      | VERIFIED   | Dataclass field at line 88: `image_menu_detected: bool = False`                                  |
| 9  | Unit tests cover IMAGE_ONLY, PDF, and source_type tagging                                 | VERIFIED   | `test_image_menu.py` contains 6 test functions including `test_image_only_sets_detected`         |
| 10 | E2E harness validates image-menu path for Tredita restaurant                              | VERIFIED   | `e2e_restaurants.json` has 5 entries, Tredita entry has `"expect_image_menu": true`              |

**Score:** 10/10 truths verified (15/15 specific artifact checks — see below)

---

### Required Artifacts

| Artifact                                                                 | Expected                                      | Status     | Details                                                                                              |
|--------------------------------------------------------------------------|-----------------------------------------------|------------|------------------------------------------------------------------------------------------------------|
| `services/agent-orchestrator/services/claude_vision_extractor.py`        | `extract_pdf(bytes) -> ClaudeExtractionResult` | VERIFIED   | Method at line 318; returns `ClaudeExtractionResult` with `extraction_method="claude_pdf"`          |
| `services/agent-orchestrator/services/web_crawler.py`                    | All Phase 6 routing logic                      | VERIFIED   | All 4 new methods present; `CrawlResult` has `image_menu_detected` field                           |
| `services/agent-orchestrator/tests/test_image_menu.py`                   | Unit tests for IMGX-01 through IMGX-06         | VERIFIED   | File exists; 6 test functions covering all required cases                                            |
| `scripts/e2e_restaurants.json`                                           | 5 entries, Tredita with `expect_image_menu`    | VERIFIED   | Exactly 5 entries; Tredita at index 4 has `"expect_image_menu": true`                              |
| `scripts/e2e_crawl_harness.py`                                           | `image_menu_pass` assertion logic              | VERIFIED   | Lines 336-348: reads `expect_image_menu`, counts `source_type="image_menu"` wines, sets pass/fail  |

---

### Detailed Must-Have Checks (15/15)

| # | Must-Have                                                                      | Status   | File Location                               | Evidence                                                      |
|---|--------------------------------------------------------------------------------|----------|---------------------------------------------|---------------------------------------------------------------|
| 1 | `extract_pdf(pdf_bytes)` exists and returns `ClaudeExtractionResult`           | VERIFIED | `claude_vision_extractor.py` line 318       | Signature: `async def extract_pdf(self, pdf_bytes: bytes)`; return type `ClaudeExtractionResult` |
| 2 | `extract_pdf` uses native `"type": "document"` block with `"media_type": "application/pdf"` | VERIFIED | `claude_vision_extractor.py` lines 337-343  | Content block: `{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", ...}}` |
| 3 | `_persist_crawled_wines()` accepts `source_type` param defaulting to `"crawled"` | VERIFIED | `web_crawler.py` lines 418-421              | Signature: `source_type: str = "crawled"` — explicit keyword arg with default |
| 4 | `CrawlResult` dataclass has `image_menu_detected: bool = False`                | VERIFIED | `web_crawler.py` line 88                    | `image_menu_detected: bool = False  # True when Vision path was taken (Phase 6)` |
| 5 | `_take_viewport_chunks(page)` exists (max 10 chunks, 1280x900)                 | VERIFIED | `web_crawler.py` lines 631-669              | `MAX_CHUNKS = 10`, `VIEWPORT_HEIGHT = 900`, `VIEWPORT_WIDTH = 1280` |
| 6 | `_is_image_menu(page)` exists (naturalWidth > 400 + wine pattern check)        | VERIFIED | `web_crawler.py` lines 671-695              | Checks `natural_width > 400` (Signal 1) and `re.search(r'\d{4}|\$\d+', ...)` (Signal 2) |
| 7 | `_handle_image_menu()` calls `extract_menu()` with b64 strings, persists with `source_type="image_menu"` | VERIFIED | `web_crawler.py` lines 697-735  | `b64_pages = [base64.b64encode(c).decode("utf-8") ...]`; `_persist_crawled_wines(..., source_type="image_menu")` |
| 8 | `_handle_pdf_vision()` calls `extract_pdf()`, persists with `source_type="pdf_vision_fallback"` | VERIFIED | `web_crawler.py` lines 737-770 | `await extractor.extract_pdf(result.pdf_bytes)`; `_persist_crawled_wines(..., source_type="pdf_vision_fallback")` |
| 9 | `crawl_restaurant()` wires IMAGE_ONLY to `_handle_image_menu()`                | VERIFIED | `web_crawler.py` lines 249-256              | `if has_images: result.content_type = ContentType.IMAGE_ONLY; await self._handle_image_menu(...)` |
| 10 | `crawl_restaurant()` wires HTML_MENU+0-wine to `_is_image_menu` then `_handle_image_menu()` | VERIFIED | `web_crawler.py` lines 281-284 | `elif await self._is_image_menu(page): await self._handle_image_menu(...)` in the 0-wine branch |
| 11 | `crawl_restaurant()` wires PDF_LINK to `_handle_pdf_vision()`                  | VERIFIED | `web_crawler.py` lines 240-241              | `if result.pdf_bytes: await self._handle_pdf_vision(result, ...)` |
| 12 | Existing Gemini HTML_MENU caller unchanged (no `source_type` arg at line ~276) | VERIFIED | `web_crawler.py` line 276                   | `self._persist_crawled_wines(non_dupes, restaurant_name, website_url)` — no source_type arg; uses default `"crawled"` |
| 13 | Unit tests exist in `test_image_menu.py` with `test_image_only_sets_detected`  | VERIFIED | `tests/test_image_menu.py` line 89          | `async def test_image_only_sets_detected():` present; asserts `result.image_menu_detected is True` |
| 14 | `scripts/e2e_restaurants.json` has Tredita with `expect_image_menu=true` and 5 entries total | VERIFIED | `scripts/e2e_restaurants.json` lines 1-7  | 5 entries confirmed; `{"name": "Tredita", "url": "https://tredita.com/menus/", "expect_image_menu": true}` |
| 15 | `scripts/e2e_crawl_harness.py` has `image_menu_pass` assertion logic           | VERIFIED | `scripts/e2e_crawl_harness.py` lines 336-348 | Checks `restaurant.get("expect_image_menu")`, counts wines with `source_type="image_menu"`, sets `image_menu_pass = len(image_menu_wines) >= 1` |

---

### Key Link Verification

| From                      | To                           | Via                                              | Status   | Details                                                       |
|---------------------------|------------------------------|--------------------------------------------------|----------|---------------------------------------------------------------|
| `crawl_restaurant()`      | `_handle_image_menu()`       | `IMAGE_ONLY` branch + `_check_image_menu()`      | WIRED    | Lines 248-256: explicit await call when `has_images=True`     |
| `crawl_restaurant()`      | `_handle_image_menu()`       | HTML_MENU+0-wine branch + `_is_image_menu()`     | WIRED    | Lines 281-284: explicit await call in Gemini 0-wine fallback  |
| `crawl_restaurant()`      | `_handle_pdf_vision()`       | `PDF_LINK` branch + `pdf_bytes` present check    | WIRED    | Lines 240-241: called immediately after PDF download          |
| `_handle_image_menu()`    | `extract_menu()`             | `get_claude_vision_extractor()` singleton        | WIRED    | Lines 713-715: singleton import at top of file; `await extractor.extract_menu(b64_pages)` |
| `_handle_pdf_vision()`    | `extract_pdf()`              | `get_claude_vision_extractor()` singleton        | WIRED    | Lines 748-750: `await extractor.extract_pdf(result.pdf_bytes)` |
| `_handle_image_menu()`    | `_persist_crawled_wines()`   | `source_type="image_menu"`                       | WIRED    | Lines 726-729: explicit source_type kwarg passed              |
| `_handle_pdf_vision()`    | `_persist_crawled_wines()`   | `source_type="pdf_vision_fallback"`              | WIRED    | Lines 761-764: explicit source_type kwarg passed              |
| `e2e_crawl_harness.py`    | `image_menu_pass` assertion  | `expect_image_menu` flag in `e2e_restaurants.json` | WIRED  | Lines 336-343: flag read, `source_type="image_menu"` filter applied, result set |

---

### Data-Flow Trace (Level 4)

| Artifact               | Data Variable      | Source                              | Produces Real Data                         | Status    |
|------------------------|--------------------|-------------------------------------|--------------------------------------------|-----------|
| `_handle_image_menu()` | `extraction.wines` | `extractor.extract_menu(b64_pages)` | Claude Vision API response (not hardcoded) | FLOWING   |
| `_handle_pdf_vision()` | `extraction.wines` | `extractor.extract_pdf(pdf_bytes)`  | Claude Vision API response (not hardcoded) | FLOWING   |
| `_persist_crawled_wines()` | `data_enrichment.source_type` | `source_type` parameter | Caller-provided string, not a constant | FLOWING |

Notes:
- Both Vision handlers guard against empty wines (`if extraction.wines:`) before persisting — no empty writes.
- `result.image_menu_detected = True` is set unconditionally at the end of both handlers regardless of wine count, which correctly tracks that the Vision path was invoked.

---

### Behavioral Spot-Checks

Step 7b: SKIPPED for live Playwright/API calls (no runnable entry points without network). Unit tests in `test_image_menu.py` serve as the behavioral coverage layer with full mocking.

| Behavior                                              | Approach     | Status  |
|-------------------------------------------------------|--------------|---------|
| `extract_pdf` sends document content block            | Unit test    | COVERED (`test_extract_pdf_uses_document_content_block`) |
| `_handle_image_menu` sets `image_menu_detected=True`  | Unit test    | COVERED (`test_image_only_sets_detected`) |
| `_take_viewport_chunks` returns JPEG bytes per chunk  | Unit test    | COVERED (`test_take_viewport_chunks_returns_jpeg_bytes`) |
| `_persist_crawled_wines` defaults `source_type="crawled"` | Unit test | COVERED (`test_html_menu_source_type_is_crawled`) |
| `_handle_image_menu` calls `extract_menu` with str args | Unit test  | COVERED (`test_extract_menu_called_with_b64_strings`) |
| `_handle_image_menu` persists with `source_type="image_menu"` | Unit test | COVERED (`test_persist_called_with_image_menu_source_type`) |

---

### Requirements Coverage

| Requirement | Description                                                   | Status    | Evidence                                                    |
|-------------|---------------------------------------------------------------|-----------|-------------------------------------------------------------|
| IMGX-01     | IMAGE_ONLY sets `image_menu_detected=True`                    | SATISFIED | `_handle_image_menu()` line 735; unit test at line 89       |
| IMGX-02     | Viewport chunking: 900px steps, 1280px wide, max 10 chunks    | SATISFIED | `_take_viewport_chunks()` constants at lines 637-639        |
| IMGX-03     | `extract_menu()` receives base64 strings (not bytes)          | SATISFIED | `b64_pages` encoding at line 711; unit test at line 119     |
| IMGX-04     | `_persist_crawled_wines` accepts `source_type` param          | SATISFIED | Signature at line 421: `source_type: str = "crawled"`       |
| IMGX-05     | Image-menu wines tagged `source_type="image_menu"`            | SATISFIED | `_handle_image_menu()` line 728; unit test at line 151      |
| IMGX-06     | Existing Gemini path unchanged (default `source_type="crawled"`) | SATISFIED | Line 276 call has no source_type arg; unit test at line 181 |
| IMGX-07     | E2E harness validates `image_menu_pass` for Tredita           | SATISFIED | `e2e_crawl_harness.py` lines 336-348; `e2e_restaurants.json` Tredita entry |

---

### Anti-Patterns Found

| File             | Line | Pattern              | Severity | Impact |
|------------------|------|----------------------|----------|--------|
| No blockers found | —   | —                    | —        | —      |

Notable observations (non-blocking):
- `_is_image_menu()` (line 671): Signal 2 (no wine patterns in page text) can return `True` even when no large images are present. This is an intentional "fail open" design (documented in the docstring), but could increase Vision API calls on text-light pages. Not a bug — acceptable as a cost/accuracy trade-off.
- `_handle_pdf_vision()` sets `result.image_menu_detected = True` (line 770) even for PDF paths. This is semantically slightly overloaded (PDF is not an image menu), but harmless — the `source_type` tag in JSONL (`"pdf_vision_fallback"`) is the authoritative discriminator.

---

### Human Verification Required

None for code correctness. The following require a live environment to confirm end-to-end:

**1. Tredita Live E2E**
- **Test:** Run `python scripts/e2e_crawl_harness.py` with `GOOGLE_API_KEY` and `CLAUDE_API_KEY` set.
- **Expected:** Tredita entry shows `image_menu_pass: PASS` and at least 1 wine with `data_enrichment.source_type == "image_menu"` in the output JSONL.
- **Why human:** Requires live Playwright browser, network access to tredita.com, and both API keys.

**2. PDF Vision path on a live PDF menu**
- **Test:** Provide a restaurant URL that serves a PDF wine list; run `crawl_restaurant()`.
- **Expected:** JSONL output contains wines with `source_type="pdf_vision_fallback"` and `extraction_method="claude_pdf"`.
- **Why human:** Requires a live PDF-serving restaurant URL and CLAUDE_API_KEY.

---

### Gaps Summary

No gaps. All 15 must-have checks pass against actual codebase state. The three previously-blind failure cases (IMAGE_ONLY, PDF_LINK, HTML_MENU+0-wine) are each wired to Claude Vision extraction through the correct methods. Source-type tagging is correct and the existing Gemini path is provably unchanged. Unit tests cover all 6 IMGX requirements plus the PDF document-block assertion.

---

_Verified: 2026-04-05T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
