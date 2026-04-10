# Phase 6: Image Menu Extraction via Claude Vision — Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the image-menu blind spot in the Gemini crawler pipeline. Two failure cases currently return
0 wines:

1. **`ContentType.IMAGE_ONLY`** — menu page renders as `<img>` tags with no DOM text (Tredita-class).
   The crawler already detects this and captures `screenshot_bytes`, but does nothing with them.

2. **`ContentType.PDF_LINK` with 0 wines** — scanned PDFs contain images, not selectable text.
   The crawler already downloads `pdf_bytes`, but no extraction runs.

3. **`ContentType.HTML_MENU` with 0 wines + image signals** — page has a menu URL but Gemini
   finds no wine text because the menu is embedded as an `<img>` tag.

Phase 6 routes all three cases through the existing Claude Vision extraction brain
(`claude_vision_extractor.py`, Phase 1), then flows results through the existing dedup + JSONL
persist pipeline (`_persist_crawled_wines()`, Phase 2). No new extractor is written.

</domain>

<decisions>
## Implementation Decisions

### PDF Fallback — Native Anthropic PDF API (D-01)
- **D-01:** Pass raw PDF bytes directly to Claude as a `document` content block (Anthropic native PDF
  support). No new Python dependencies. Add `extract_pdf(pdf_bytes: bytes) -> ClaudeExtractionResult`
  method to `ClaudeVisionExtractor`. This is a sibling to `extract_menu()` — same response shape,
  same `ClaudeExtractionResult`, different content block type in the API call.
  - Content block: `{"type": "document", "source": {"type": "base64", "media_type":
    "application/pdf", "data": b64_pdf}}`
  - Single API call per PDF (not per-page) — Claude handles multi-page PDFs natively.
  - `source_type` tag in JSONL: `"pdf_vision_fallback"`.

### Screenshot Strategy — Viewport Chunks (D-02)
- **D-02:** For IMAGE_ONLY and HTML_MENU image-menu paths, do NOT use the already-captured
  full-page `screenshot_bytes` on `CrawlResult`. Instead, take N viewport-height screenshots
  by scrolling the live Playwright page. Pass them as a `List[str]` (base64) to the existing
  `extract_menu()` — reuses parallel per-page processing with no interface change.
  - Viewport: 1280×900px (matches typical monitor). Scroll step = 900px (no overlap needed).
  - Max chunks: 10 (caps cost at ~$0.15/restaurant for a 10-page equivalent).
  - Use `page.evaluate('window.scrollTo(0, offset)')` + `page.screenshot(clip=...)`.
  - New private helper: `_take_viewport_chunks(page) -> List[bytes]`.
  - `source_type` tag in JSONL: `"image_menu"`.

### 0-Wine HTML_MENU Fallback — Smart Detection (D-03)
- **D-03:** Before triggering Claude Vision for a 0-wine HTML_MENU page, check for image menu
  signals to avoid burning $0.05–0.15 per false positive.
  - Detection signals (either is sufficient to trigger Vision):
    1. Page contains `<img>` elements with `naturalWidth > 400px` (large images)
    2. No wine-pattern text found: `re.search(r'\d{4}|\$\d+', page_text)` returns None
  - New private helper: `_is_image_menu(page) -> bool`.
  - If signals present: call `_handle_image_menu()` (see D-04).
  - If no signals: accept 0-wine result, no Vision call.

### Code Placement — Extend web_crawler.py (D-04)
- **D-04:** All image-menu routing logic goes directly into `WebCrawlerService` in `web_crawler.py`.
  Two new private methods:
  - `_take_viewport_chunks(page) -> List[bytes]` — scrolling screenshot helper
  - `_is_image_menu(page) -> bool` — smart detection (D-03)
  - `_handle_image_menu(page, result, restaurant_name, website_url)` — orchestrator:
    calls `_take_viewport_chunks`, calls `get_claude_vision_extractor().extract_menu()`,
    deduplicates, calls `_persist_crawled_wines()` with `source_type="image_menu"`.

  Integration points in `crawl_restaurant()`:
  ```python
  # After IMAGE_ONLY detection:
  if result.content_type == ContentType.IMAGE_ONLY:
      await self._handle_image_menu(page, result, restaurant_name, website_url)

  # After Gemini HTML extraction returns 0 wines:
  elif (result.content_type == ContentType.HTML_MENU
        and not extraction.wines
        and await self._is_image_menu(page)):
      await self._handle_image_menu(page, result, restaurant_name, website_url)

  # PDF path — after pdf_bytes downloaded:
  elif result.content_type == ContentType.PDF_LINK and result.pdf_bytes:
      await self._handle_pdf_vision(result, restaurant_name, website_url)
  ```

  One more private method:
  - `_handle_pdf_vision(result, restaurant_name, website_url)` — calls
    `get_claude_vision_extractor().extract_pdf(result.pdf_bytes)`, dedup, persist.

### Claude's Discretion
- `image_menu_detected` bool field on `CrawlResult` (set True when Vision path was taken) — for
  logging + harness reporting
- Max viewport chunks cap (10 = safe cost ceiling)
- JSONL `source_type` values: `"image_menu"` and `"pdf_vision_fallback"` (follow existing
  Phase 2 convention where `source_type` is already set in `_persist_crawled_wines`)
- Spend logging for the Vision calls in this path is already handled — `claude_vision_extractor.py`
  already calls `get_spend_logger().log()` after every page (Phase 5)
- `restaurant_id` is NOT available in the crawler path (`None` is correct for SpendLogger)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Primary Files to Extend
- `services/agent-orchestrator/services/web_crawler.py` — `WebCrawlerService`, `ContentType` enum,
  `CrawlResult` dataclass, `crawl_restaurant()` flow, `_persist_crawled_wines()`, `_check_image_menu()`.
  ALL Phase 6 logic extends this file. Full read required.
- `services/agent-orchestrator/services/claude_vision_extractor.py` — `ClaudeVisionExtractor`,
  `extract_menu(pages: List[str])`, `ClaudeExtractionResult`. Add `extract_pdf()` sibling here.
  Read the `extract_page()` method for the Anthropic client call pattern.

### Pipeline Reference
- `scripts/e2e_crawl_harness.py` — E2E harness that will be extended with Tredita test case.
  Read to understand `WebCrawlerService.crawl_restaurant()` usage pattern, `CrawlResult.content_type`
  reporting, and JSONL read/score flow.

### Phase 1 + Phase 2 Context
- `.planning/phases/01-claude-vision-extraction-service/01-CONTEXT.md` — Claude Vision API patterns
- `.planning/phases/05-cost-quality-guardrails/05-CONTEXT.md` — SpendLogger already wired into
  claude_vision_extractor.py; no additional spend wiring needed in Phase 6

### Requirements
- `.planning/ROADMAP.md` — Phase 6 section (requirements IMGX-01 through IMGX-07, success criteria)
- `.planning/PROJECT.md` — Cost constraint: < $0.50/restaurant total

</canonical_refs>

<code_context>
## Existing Code Insights

### What Already Exists (reuse, don't rebuild)
- `ContentType.IMAGE_ONLY` enum value — already in `web_crawler.py`
- `CrawlResult.screenshot_bytes` — already captured on IMAGE_ONLY path (full-page JPEG 85)
  BUT: D-02 replaces this with viewport chunks from the live page instead
- `CrawlResult.pdf_bytes` — already downloaded on PDF_LINK path
- `_check_image_menu(page)` — already detects image-heavy pages (bool check; returns bool)
- `_persist_crawled_wines(wines, restaurant_name, website_url)` — JSONL persist + dedup; just
  pass `source_type="image_menu"` or `"pdf_vision_fallback"` in the wine dict
- `get_claude_vision_extractor()` — singleton factory, already in claude_vision_extractor.py
- `extract_menu(pages: List[str])` — already handles List[base64] → ClaudeExtractionResult
- SpendLogger already wired into claude_vision_extractor.py (Phase 5 — automatic)

### ContentType States After Phase 6
```
IMAGE_ONLY   → _handle_image_menu()  → image_menu_detected=True
PDF_LINK     → _handle_pdf_vision()  → image_menu_detected=True
HTML_MENU+0  → _is_image_menu check → if True: _handle_image_menu(), image_menu_detected=True
HTML_MENU+0  → no image signals     → accept 0, image_menu_detected=False
HTML_MENU+N  → already working      → unchanged
NO_MENU      → unchanged            → unchanged
```

### Playwright Context Availability
- Both `_handle_image_menu()` and `_is_image_menu()` receive the live `page` object — they run
  INSIDE the `async with async_playwright()` context block in `crawl_restaurant()`.
  `_handle_pdf_vision()` does NOT need Playwright — it works from `result.pdf_bytes` already downloaded.

</code_context>

<specifics>
## Specific Requirements

- Max viewport chunks: **10** (cost ceiling: ~$0.15/restaurant max for 10-page equivalent)
- Viewport dimensions: **1280×900px**
- JSONL `source_type` tags: `"image_menu"` (screenshot path) | `"pdf_vision_fallback"` (PDF path)
- E2E harness: add **Tredita** (or equivalent known image-menu Chicago restaurant) as a test case;
  harness must confirm ≥ 1 wine extracted via Vision path with `source_type="image_menu"`
- `image_menu_detected: bool` field added to `CrawlResult` dataclass
- PDF fallback triggers on: `content_type == PDF_LINK AND pdf_bytes is not None`
  (does NOT require 0-wine check — all PDFs go through Vision, since PDF text extraction isn't
   implemented in the crawler anyway)
- Smart detection signals for HTML_MENU 0-wine path:
  - Large image: `<img>` with `naturalWidth > 400`
  - No wine patterns: `re.search(r'\d{4}|\$\d+', page_text)` is None

</specifics>

<deferred>
## Deferred Ideas

- Overlap between viewport chunks (e.g., 100px overlap to catch wines that span a chunk boundary)
  — accepted risk for MVP; Claude Vision is robust to partial items at image edges
- Caching screenshots to avoid re-screenshots on re-crawl — Phase 2 already has content_hash
  freshness tracking; acceptable for v1
- Concurrent image-menu extraction across multiple restaurants — current crawler is sequential
  per restaurant; parallelism is a future crawl-orchestration concern
- OCR confidence scoring for Vision-extracted image-menu wines — Phase 5 review queue already
  handles low-completeness wines; no special treatment needed here

</deferred>

---
*Phase: 06-image-menu-extraction*
*Context gathered: 2026-04-05 via discuss-phase*
