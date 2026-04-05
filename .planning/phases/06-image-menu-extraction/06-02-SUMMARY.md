---
plan: 06-02
phase: 06-image-menu-extraction
wave: 2
status: complete
completed: 2026-04-05
---

# Summary: Wave 2 — Core Vision Routing Logic

## What Was Built

Extended `WebCrawlerService` with 4 new private methods and wired 3 integration hooks into `crawl_restaurant()`.

### New Imports
- `import base64` (stdlib)
- `from services.claude_vision_extractor import get_claude_vision_extractor`

### New Private Methods

1. **`_take_viewport_chunks(page) -> List[bytes]`**
   - Scrolls page in 900px increments (1280×900 viewport)
   - Captures JPEG screenshots (quality=85) at each position
   - Max 10 chunks (cost ceiling ~$0.15/restaurant)
   - Returns `List[bytes]`

2. **`_is_image_menu(page) -> bool`**
   - Signal 1: any `<img>` with `naturalWidth > 400px`
   - Signal 2: no wine patterns (`\d{4}|\$\d+`) in page text
   - Either signal triggers Vision; fails open (returns False on error)
   - Different from `_check_image_menu()` (keyword-based)

3. **`_handle_image_menu(page, result, restaurant_name, website_url)`**
   - Calls `_take_viewport_chunks()` → encodes bytes to base64 strings
   - Calls `get_claude_vision_extractor().extract_menu(b64_pages)`
   - Deduplicates via `_wine_is_duplicate()`
   - Persists with `source_type="image_menu"`
   - Sets `result.image_menu_detected = True`

4. **`_handle_pdf_vision(result, restaurant_name, website_url)`**
   - No Playwright needed — reads from `result.pdf_bytes`
   - Calls `get_claude_vision_extractor().extract_pdf(result.pdf_bytes)`
   - Deduplicates via `_wine_is_duplicate()`
   - Persists with `source_type="pdf_vision_fallback"`
   - Sets `result.image_menu_detected = True`

### Integration Hooks in crawl_restaurant()

- **IMAGE_ONLY path:** After `result.screenshot_bytes =` assignment → calls `_handle_image_menu()`
- **PDF_LINK path:** After `for purl in pdf_urls:` loop → gates on `result.pdf_bytes` → calls `_handle_pdf_vision()`
- **HTML_MENU 0-wine path:** `elif await self._is_image_menu(page)` → calls `_handle_image_menu()`

All hooks are inside the `try:` block before `finally: await browser.close()` (page object still live).

## Key Files

- `services/agent-orchestrator/services/web_crawler.py` — 4 new methods + 3 integration hooks

## Self-Check: PASSED

- All 4 private methods exist in WebCrawlerService
- `import base64` and `get_claude_vision_extractor` imports added
- `base64.b64encode(c).decode("utf-8")` encodes bytes → str for `extract_menu()`
- `source_type="image_menu"` and `source_type="pdf_vision_fallback"` passed at correct call sites
- Existing Gemini caller at line 276 unchanged (no `source_type` arg, defaults to "crawled")
- All 3 hooks inside try block before finally
- No existing methods modified
