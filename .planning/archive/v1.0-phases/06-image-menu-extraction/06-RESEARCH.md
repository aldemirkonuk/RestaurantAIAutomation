# Phase 6: Image Menu Extraction via Claude Vision — Research

**Researched:** 2026-04-05
**Domain:** Playwright viewport screenshots, Anthropic PDF document API, ClaudeVisionExtractor extension, web_crawler.py integration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Native Anthropic PDF API**
Pass raw PDF bytes directly to Claude as a `document` content block (Anthropic native PDF support). No new Python dependencies. Add `extract_pdf(pdf_bytes: bytes) -> ClaudeExtractionResult` method to `ClaudeVisionExtractor`. Content block: `{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64_pdf}}`. Single API call per PDF. `source_type` tag in JSONL: `"pdf_vision_fallback"`.

**D-02: Viewport Chunks (Screenshot Strategy)**
For IMAGE_ONLY and HTML_MENU image-menu paths, take N viewport-height screenshots by scrolling the live Playwright page. Pass as `List[str]` (base64) to `extract_menu()`. Viewport: 1280×900px. Scroll step: 900px (no overlap). Max chunks: 10. Use `page.evaluate('window.scrollTo(0, offset)')` + `page.screenshot(clip=...)`. New private helper: `_take_viewport_chunks(page) -> List[bytes]`. `source_type` tag: `"image_menu"`.

**D-03: Smart Detection for 0-Wine HTML_MENU Fallback**
Detection signals (either sufficient): (1) `<img>` elements with `naturalWidth > 400px`; (2) `re.search(r'\d{4}|\$\d+', page_text)` returns None. New private helper: `_is_image_menu(page) -> bool`.

**D-04: All Logic in web_crawler.py**
New private methods: `_take_viewport_chunks(page)`, `_is_image_menu(page)`, `_handle_image_menu(page, result, restaurant_name, website_url)`, `_handle_pdf_vision(result, restaurant_name, website_url)`.

Integration points in `crawl_restaurant()`:
```python
if result.content_type == ContentType.IMAGE_ONLY:
    await self._handle_image_menu(page, result, restaurant_name, website_url)
elif (result.content_type == ContentType.HTML_MENU
      and not extraction.wines
      and await self._is_image_menu(page)):
    await self._handle_image_menu(page, result, restaurant_name, website_url)
elif result.content_type == ContentType.PDF_LINK and result.pdf_bytes:
    await self._handle_pdf_vision(result, restaurant_name, website_url)
```

### Claude's Discretion

- `image_menu_detected` bool field on `CrawlResult` (set True when Vision path was taken)
- Max viewport chunks cap: 10
- JSONL `source_type` values: `"image_menu"` | `"pdf_vision_fallback"`
- Spend logging already handled by `claude_vision_extractor.py` (Phase 5)
- `restaurant_id` is None in crawler path (correct for SpendLogger)

### Deferred Ideas (OUT OF SCOPE)

- Overlap between viewport chunks (100px overlap)
- Caching screenshots to avoid re-screenshots on re-crawl
- Concurrent image-menu extraction across multiple restaurants
- OCR confidence scoring for Vision-extracted image-menu wines
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IMGX-01 | `web_crawler.py` detects `ContentType.IMAGE_ONLY` and `HTML_MENU` with `wine_count==0`, sets `image_menu_detected=True` | `_check_image_menu()` already exists as detection basis; `CrawlResult` dataclass needs new `image_menu_detected` field |
| IMGX-02 | Playwright takes viewport-chunked screenshots of detected URL | `page.screenshot(clip={...})` + `page.evaluate('window.scrollTo(0, offset)')` — confirmed API exists in Playwright |
| IMGX-03 | Screenshots passed to `claude_vision_extractor.py` — no new extractor written | `extract_menu(pages: List[str])` already accepts base64 list; no interface change needed |
| IMGX-04 | Extracted wines flow through same dedup + JSONL persist path | `_persist_crawled_wines()` and `_wine_is_duplicate()` require no changes for this path |
| IMGX-05 | JSONL records include `source_type: "image_menu"` or `"pdf_vision_fallback"` | `data_enrichment["source_type"]` field in `_persist_crawled_wines` — currently hardcoded `"crawled"`; must be passed as parameter |
| IMGX-06 | `ContentType` handling updated; image menu route documented; existing paths not broken | Integration points are additive (elif branches); no existing branch is modified |
| IMGX-07 | E2E harness extended with image-menu restaurant (Tredita or equivalent); confirms ≥1 wine via Vision path | Harness reads `data_enrichment.source_type` from JSONL to verify `"image_menu"` |
</phase_requirements>

---

## Summary

Phase 6 adds three short-circuit paths to `web_crawler.py`: screenshot-then-Vision for IMAGE_ONLY pages, smart-detected screenshot-then-Vision for 0-wine HTML_MENU pages, and PDF-to-Vision for PDF_LINK pages. All three funnel into existing services — `ClaudeVisionExtractor.extract_menu()` for image paths, and a new `extract_pdf()` sibling for PDFs — then write through the existing `_persist_crawled_wines()` persist pipeline.

The code audit of `web_crawler.py` and `claude_vision_extractor.py` reveals the integration surface is clean and well-scoped. The three key findings are: (1) `_persist_crawled_wines()` currently hardcodes `source_type="crawled"` — it needs a `source_type` parameter to support `"image_menu"` and `"pdf_vision_fallback"`; (2) the existing `_check_image_menu()` checks keyword-matching on img `alt`/`src` but does NOT check `naturalWidth` — so `_is_image_menu()` is a new method that replaces/supplements this for the D-03 detection signals; (3) `extract_menu()` accepts `List[str]` of base64 strings, not bytes — `_take_viewport_chunks()` must encode bytes to base64 strings before passing.

**Primary recommendation:** Implement in two waves — Wave 1: add `extract_pdf()` to `ClaudeVisionExtractor` + `image_menu_detected` to `CrawlResult` + `source_type` param to `_persist_crawled_wines()`; Wave 2: add the four new `WebCrawlerService` private methods + integration wiring in `crawl_restaurant()` + E2E harness extension.

---

## Standard Stack

### Core (Already Installed — No New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `anthropic` | current (AsyncAnthropic) | Anthropic API client for PDF document blocks | Already used in `claude_vision_extractor.py` |
| `playwright` (async_api) | current | Playwright browser for screenshot capture | Already used in `web_crawler.py` |
| `base64` (stdlib) | — | Encode screenshot bytes to base64 strings | Standard library |
| `asyncio` (stdlib) | — | Async/await throughout the crawler | Standard library |

**No new pip installs required.** All dependencies are present.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `re` (stdlib) | — | Wine pattern detection in `_is_image_menu()` | `re.search(r'\d{4}|\$\d+', page_text)` |

---

## Architecture Patterns

### Existing Integration Points (Confirmed by Code Audit)

#### `_persist_crawled_wines()` — Current Signature
```python
def _persist_crawled_wines(
    self, wines: list, restaurant_name: str, source_url: str
):
```
**CRITICAL FINDING:** `source_type` is currently hardcoded on line 479:
```python
"source_type": "crawled",
```
This must be changed to a parameter. Required modification:
```python
def _persist_crawled_wines(
    self, wines: list, restaurant_name: str, source_url: str,
    source_type: str = "crawled"
):
    # ...
    "source_type": source_type,
```
All existing callers pass no `source_type` — they will continue to work with the default `"crawled"`.

#### `_wine_is_duplicate()` — No Changes Required
```python
def _wine_is_duplicate(self, wine: dict, restaurant_name: str) -> bool:
```
This is synchronous, fails open (returns False when supabase is None), and operates purely on `wine_name` + `vintage`. No async constraint, no interface change needed for the image-menu path.

#### `_check_image_menu()` — Existing, Insufficient for D-03
Current implementation (lines 602–616):
```python
async def _check_image_menu(self, page) -> bool:
    try:
        images = await page.query_selector_all("img")
        for img in images:
            alt = await img.get_attribute("alt") or ""
            src = await img.get_attribute("src") or ""
            if any(kw in (alt + src).lower() for kw in ["menu", "wine", "list", "carta"]):
                return True
    except Exception:
        pass
    return False
```
This checks keyword presence in `alt`/`src` attributes. It does NOT check `naturalWidth > 400` or absence of wine-pattern text. The new `_is_image_menu()` is distinct — it implements D-03 signals. `_check_image_menu()` is still used to route `IMAGE_ONLY` detection on the empty-text path (lines 243–250) and should NOT be removed.

#### `extract_menu()` — Accepts `List[str]` (base64 strings)
```python
async def extract_menu(
    self,
    pages: List[str],
    media_type: Optional[str] = None,
) -> ClaudeExtractionResult:
```
`pages` must be **strings** (base64-encoded), not bytes. `_take_viewport_chunks()` returns `List[bytes]` from `page.screenshot()` — the caller `_handle_image_menu()` must encode each bytes chunk: `base64.b64encode(chunk).decode("utf-8")`.

The `get_media_type()` helper uses the first 10 chars of the base64 string to auto-detect JPEG vs PNG. Playwright screenshots with `type="jpeg"` produce `/9j/` prefix → `image/jpeg`. No need to pass `media_type` explicitly.

#### `get_claude_vision_extractor()` — Singleton Available
```python
def get_claude_vision_extractor() -> ClaudeVisionExtractor:
```
Available at module level in `claude_vision_extractor.py`. Must be imported in `web_crawler.py` alongside the existing `get_gemini_crawler_extractor` import.

---

### Pattern 1: Viewport Chunk Screenshot

**What:** Scroll the page in 900px increments, capture the visible viewport at each position.
**When to use:** IMAGE_ONLY pages and HTML_MENU 0-wine pages where `_is_image_menu()` returns True.

```python
# Source: Playwright async API — confirmed clip dict syntax
async def _take_viewport_chunks(self, page) -> List[bytes]:
    VIEWPORT_HEIGHT = 900
    VIEWPORT_WIDTH = 1280
    MAX_CHUNKS = 10

    try:
        await page.set_viewport_size({"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT})
        total_height = await page.evaluate("document.body.scrollHeight")
    except Exception:
        total_height = VIEWPORT_HEIGHT

    chunks = []
    offset = 0
    while offset < total_height and len(chunks) < MAX_CHUNKS:
        try:
            await page.evaluate(f"window.scrollTo(0, {offset})")
            await asyncio.sleep(0.3)  # allow lazy-loaded images to render
            chunk = await page.screenshot(
                clip={
                    "x": 0,
                    "y": offset,
                    "width": VIEWPORT_WIDTH,
                    "height": min(VIEWPORT_HEIGHT, total_height - offset),
                },
                type="jpeg",
                quality=85,
            )
            chunks.append(chunk)
        except Exception as e:
            logger.debug(f"Viewport chunk {len(chunks)} failed: {e}")
            break
        offset += VIEWPORT_HEIGHT

    return chunks
```

**Note on `clip` coordinates:** The `clip` dict uses page-absolute coordinates (not viewport-relative). When `y=offset`, the clip region captures the page at that scroll position regardless of current scroll state. However, since `window.scrollTo()` is called first, the two approaches are equivalent. Using page-absolute `y=offset` is correct.

**Verification:** Playwright Python `page.screenshot()` clip parameter accepts `{"x": float, "y": float, "width": float, "height": float}` — confirmed by official Playwright documentation and multiple sources.

---

### Pattern 2: _is_image_menu() Smart Detection

**What:** Check for image-menu signals before burning Vision API credits on a 0-wine HTML_MENU page.
**When to use:** Only on `HTML_MENU` pages that Gemini returned 0 wines for.

```python
# Source: D-03 spec from CONTEXT.md
async def _is_image_menu(self, page) -> bool:
    try:
        # Signal 1: large images present
        images = await page.query_selector_all("img")
        for img in images:
            natural_width = await page.evaluate(
                "(el) => el.naturalWidth", img
            )
            if natural_width and natural_width > 400:
                return True

        # Signal 2: no wine patterns in page text
        page_text = await page.evaluate("document.body.innerText")
        if not re.search(r'\d{4}|\$\d+', page_text or ""):
            return True

    except Exception as e:
        logger.debug(f"_is_image_menu check failed: {e}")

    return False
```

**Warning:** Signal 2 (no wine patterns) will return True for ANY page without dollar amounts or 4-digit years — including NO_MENU pages. This is acceptable per the spec ("either is sufficient to trigger") since the Vision path is low-cost and the result will be 0 wines anyway for a true no-menu page. The MAX_CHUNKS=10 cost ceiling prevents runaway spend.

---

### Pattern 3: extract_pdf() — New Method on ClaudeVisionExtractor

**What:** Send a full PDF as a single `document` content block. Single API call covers all pages.
**When to use:** `ContentType.PDF_LINK` with `pdf_bytes` available.

```python
# Source: Official Anthropic docs — platform.claude.com/docs/en/docs/build-with-claude/pdf-support
async def extract_pdf(self, pdf_bytes: bytes) -> ClaudeExtractionResult:
    scan_session_id = str(uuid.uuid4())
    b64_pdf = base64.standard_b64encode(pdf_bytes).decode("utf-8")

    try:
        async with self._get_semaphore():
            response = await self._get_client().messages.create(
                model=MODEL_ID,
                max_tokens=MAX_TOKENS,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": b64_pdf,
                            },
                        },
                        {"type": "text", "text": EXTRACTION_PROMPT},
                    ],
                }],
            )
    except Exception as e:
        logger.error(f"Claude Vision PDF API error: {e}")
        return ClaudeExtractionResult(
            scan_session_id=scan_session_id,
            page_errors=[{"page": "pdf", "error": str(e)}],
        )

    raw_text = response.content[0].text
    parsed, parse_error = parse_json_response(raw_text)
    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    cost_usd = (input_tokens * PRICE_INPUT_PER_M / 1_000_000) + (output_tokens * PRICE_OUTPUT_PER_M / 1_000_000)

    try:
        get_spend_logger().log(
            provider="anthropic", model=MODEL_ID,
            input_tokens=input_tokens, output_tokens=output_tokens, cost_usd=cost_usd,
        )
    except Exception:
        pass

    wines = parsed.get("wines", [])
    for wine in wines:
        score = compute_completeness(wine)
        wine["completeness_score"] = score
        wine["needs_review"] = score < COMPLETENESS_THRESHOLD

    return ClaudeExtractionResult(
        scan_session_id=scan_session_id,
        wines=wines,
        total_wines=len(wines),
        pages_processed=1,
        total_cost_usd=round(cost_usd, 6),
        total_input_tokens=input_tokens,
        total_output_tokens=output_tokens,
        needs_review_count=sum(1 for w in wines if w.get("needs_review", False)),
        page_errors=[{"page": "pdf", "error": "parse_error"}] if parse_error else [],
        extraction_method="claude_pdf",
    )
```

---

### Pattern 4: _handle_image_menu() Orchestrator

```python
async def _handle_image_menu(
    self, page, result: CrawlResult, restaurant_name: str, website_url: str
):
    chunks = await self._take_viewport_chunks(page)
    if not chunks:
        logger.warning(f"No viewport chunks captured for {restaurant_name}")
        return

    b64_pages = [base64.b64encode(c).decode("utf-8") for c in chunks]

    extractor = get_claude_vision_extractor()
    try:
        extraction = await extractor.extract_menu(b64_pages)
    except RuntimeError as e:
        logger.error(f"Image menu extraction failed for {restaurant_name}: {e}")
        return

    if extraction.wines:
        non_dupes = [
            w for w in extraction.wines
            if not self._wine_is_duplicate(w, restaurant_name)
        ]
        if non_dupes:
            self._persist_crawled_wines(
                non_dupes, restaurant_name, website_url,
                source_type="image_menu"
            )
        logger.info(
            f"Image menu {restaurant_name}: {len(extraction.wines)} wines, "
            f"{len(extraction.wines) - len(non_dupes)} dupes skipped"
        )

    result.image_menu_detected = True
```

---

### Pattern 5: Integration Wiring in crawl_restaurant()

The HTML_MENU extraction block currently (lines 257–272) runs Gemini and persists. It must be extended:

```python
# EXISTING block — after Gemini extraction:
if result.content_type == ContentType.HTML_MENU and result.extracted_text:
    extractor = get_gemini_crawler_extractor()
    extraction = await extractor.extract_from_text(result.extracted_text, restaurant_name)
    if extraction.wines:
        non_dupes = [w for w in extraction.wines if not self._wine_is_duplicate(w, restaurant_name)]
        if non_dupes:
            self._persist_crawled_wines(non_dupes, restaurant_name, website_url)
        ...
    # NEW: fallback to image-menu path if 0 wines
    elif await self._is_image_menu(page):
        await self._handle_image_menu(page, result, restaurant_name, website_url)

# After the HTML_MENU block — IMAGE_ONLY path:
if result.content_type == ContentType.IMAGE_ONLY:
    await self._handle_image_menu(page, result, restaurant_name, website_url)

# PDF path (after content hash, outside the HTML block):
elif result.content_type == ContentType.PDF_LINK and result.pdf_bytes:
    await self._handle_pdf_vision(result, restaurant_name, website_url)
```

**CRITICAL PLACEMENT NOTE:** `_handle_image_menu()` and `_is_image_menu()` MUST be called inside the `async with async_playwright()` block because they use the live `page` object. `_handle_pdf_vision()` does NOT need Playwright — it reads from `result.pdf_bytes` already downloaded before the browser closes.

---

### Pattern 6: E2E Harness Extension

The harness currently reads `content_type` from `result1.content_type` (string). The new assertion for Tredita:

```python
# New restaurant entry in e2e_restaurants.json:
{"name": "Tredita", "url": "https://tredita.com/menus/"}
# (or equivalent known image-menu Chicago restaurant)

# New assertion in run_crawl() after scoring:
if restaurant.get("expect_image_menu"):
    # verify JSONL contains source_type = "image_menu"
    image_menu_wines = [
        w for w in new_wines
        if w.get("data_enrichment", {}).get("source_type") == "image_menu"
    ]
    image_menu_pass = len(image_menu_wines) >= 1
    results[-1]["image_menu_pass"] = image_menu_pass
    results[-1]["image_menu_detected"] = getattr(result1, "image_menu_detected", False)
```

**`image_menu_detected` on CrawlResult:** Adding a new bool field to the `CrawlResult` dataclass does NOT break existing harness code. The harness reads `result1.content_type` and `result1.content_hash` — neither changes. The new field is additive.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF text extraction | Custom PyPDF/pdfminer parser | Claude PDF document block | Scanned PDFs have no selectable text; vision is the only approach |
| Page total height | Manual HTML parsing | `page.evaluate("document.body.scrollHeight")` | Playwright has direct JS eval access |
| Base64 encoding | Custom byte serializer | `base64.standard_b64encode(b).decode("utf-8")` | stdlib, one line |
| Image type detection | Manual magic byte check | `get_media_type()` in `claude_vision_extractor.py` | Already implemented; reuse it |
| Wine dedup in new path | New dedup logic | `_wine_is_duplicate()` unchanged | Synchronous, fails open, no changes needed |

**Key insight:** Every problem in this phase already has a solved component. The phase is pure wiring — connecting existing services at the right integration points.

---

## Common Pitfalls

### Pitfall 1: `_persist_crawled_wines()` Hardcoded source_type
**What goes wrong:** All image-menu and PDF-vision wines are written with `source_type="crawled"` instead of `"image_menu"` or `"pdf_vision_fallback"`. IMGX-05 fails. E2E harness cannot verify the path.
**Why it happens:** Line 479 hardcodes `"source_type": "crawled"`. Easy to miss.
**How to avoid:** Add `source_type: str = "crawled"` parameter to `_persist_crawled_wines()` in Wave 1, before writing any new callers.
**Warning signs:** E2E harness `data_enrichment.source_type == "image_menu"` assertion returns 0 results.

### Pitfall 2: Passing bytes instead of base64 strings to extract_menu()
**What goes wrong:** `TypeError: expected str, got bytes` when `asyncio.gather()` calls `extract_page()`.
**Why it happens:** `page.screenshot()` returns `bytes`; `extract_menu()` expects `List[str]`.
**How to avoid:** In `_handle_image_menu()`: `b64_pages = [base64.b64encode(c).decode("utf-8") for c in chunks]` before calling `extract_menu()`.
**Warning signs:** `extract_page()` crashes on `b64_image[:10]` slice when passed bytes.

### Pitfall 3: Calling _handle_image_menu() after browser.close()
**What goes wrong:** `Error: Target page, context or browser has been closed` when `page.evaluate()` runs inside `_take_viewport_chunks()`.
**Why it happens:** Integration code placed after the `finally: await browser.close()` block.
**How to avoid:** Both Vision calls (image and PDF) MUST be inside the `async with async_playwright()` block, before `finally`. PDF path reads from `result.pdf_bytes` but for consistency should also be placed inside the browser context.
**Warning signs:** `playwright._impl._errors.Error: Target page closed`.

### Pitfall 4: _is_image_menu() Signal 2 Over-Triggering
**What goes wrong:** Pages with no dollar amounts or years (e.g., a pure cocktail menu, a "coming soon" page) trigger the Vision path unnecessarily.
**Why it happens:** Signal 2 (`re.search(r'\d{4}|\$\d+', page_text)` is None) matches any page without prices/vintages, not just image menus.
**How to avoid:** Per the spec, this is an accepted trade-off (max 10 chunks = ~$0.15 ceiling). The Vision call on a non-wine page returns 0 wines and `_persist_crawled_wines()` is never called. No data corruption results.
**Warning signs:** High Vision API spend on restaurants that genuinely have no wine menu. Monitor `source_type="image_menu"` wines with wine_count = 0 in spend log.

### Pitfall 5: Haiku (claude-haiku-4-5-20251001) and PDF Support
**What goes wrong:** Assumption that PDF document blocks only work on Sonnet/Opus.
**Why it happens:** Some older docs or blog posts imply PDF support is Sonnet-only.
**How to avoid:** Official Anthropic docs explicitly state "All active models support PDF processing." Haiku is an active model. PDF document blocks work with `claude-haiku-4-5-20251001` — confirmed HIGH confidence.
**Warning signs:** None — this pitfall is a false concern. No code change needed vs. the image path.

### Pitfall 6: clip coordinates are page-absolute, not viewport-relative
**What goes wrong:** Screenshots at offset > 0 capture the wrong region, yielding black/blank chunks.
**Why it happens:** Misunderstanding `clip.y` — it is a page coordinate, not relative to the current scroll position.
**How to avoid:** Call `window.scrollTo(0, offset)` first, then set `clip.y = offset`. Both the scroll and the clip y value should equal `offset`. This is what the reference implementation in Pattern 1 does.
**Warning signs:** All chunks after the first look identical or blank.

---

## Code Examples

### Import Addition to web_crawler.py
```python
# Source: claude_vision_extractor.py module, existing singleton pattern
import base64
from services.claude_vision_extractor import get_claude_vision_extractor
```

### CrawlResult Dataclass Extension
```python
# Source: Confirmed by reading CrawlResult in web_crawler.py lines 71–86
@dataclass
class CrawlResult:
    restaurant_name: str
    website_url: str
    content_type: ContentType = ContentType.NO_MENU
    extracted_text: str = ""
    pdf_urls: List[str] = field(default_factory=list)
    pdf_bytes: Optional[bytes] = None
    screenshot_bytes: Optional[bytes] = None
    content_hash: str = ""
    menu_page_url: str = ""
    crawl_duration_ms: int = 0
    error: Optional[str] = None
    restaurant_id: Optional[str] = None
    visited_urls: List[VisitedUrl] = field(default_factory=list)
    image_menu_detected: bool = False   # NEW — Phase 6
```

### PDF b64 encoding for extract_pdf()
```python
# Source: Official Anthropic docs — base64 PDF content block
import base64
b64_pdf = base64.standard_b64encode(pdf_bytes).decode("utf-8")
content_block = {
    "type": "document",
    "source": {
        "type": "base64",
        "media_type": "application/pdf",
        "data": b64_pdf,
    },
}
```

### page.evaluate() for naturalWidth
```python
# Source: Playwright evaluate() API — executes JS in browser context
natural_width = await page.evaluate("(el) => el.naturalWidth", img)
# img is an ElementHandle from page.query_selector_all("img")
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anthropic PDF: Sonnet-only assumption | All active models including Haiku support PDF document blocks | 2024 (Anthropic rolled out broadly) | No model upgrade needed for extract_pdf() |
| Playwright screenshots: full_page=True for whole-page | clip parameter for viewport-precise chunks | Playwright v1.x+ | Enables cost-controlled chunking |

**Deprecated/outdated:**
- Assumption that PDF support requires a beta header: PDF document blocks via the standard Messages API do NOT require a beta header (only the Files API requires `anthropic-beta: files-api-2025-04-14`). The base64 document block is GA.

---

## Open Questions

1. **Tredita URL for E2E harness**
   - What we know: Tredita is a known image-menu Chicago restaurant. The CONTEXT.md specifies "Tredita (or equivalent known image-menu Chicago restaurant)."
   - What's unclear: Whether `https://tredita.com/menus/` (or similar) is currently live and returns an IMAGE_ONLY ContentType under the crawler's detection logic.
   - Recommendation: The implementer should verify the Tredita URL live before adding to `e2e_restaurants.json`. If the URL has changed or the menu is no longer image-only, substitute any Chicago restaurant known to embed menus as `<img>` tags.

2. **_handle_pdf_vision() placement — inside or outside Playwright context**
   - What we know: `_handle_pdf_vision()` reads from `result.pdf_bytes` (already downloaded) and does not need the `page` object.
   - What's unclear: Whether `result.pdf_bytes` is populated before or after `browser.close()` in the current flow. Checking the code: PDF bytes are downloaded at line 230 via `_download_pdf(context, pdf_urls[0])` inside the browser context, assigned to `result.pdf_bytes` — the value persists on the CrawlResult even after browser closes.
   - Recommendation: `_handle_pdf_vision()` can safely be called either inside or outside the browser context. For simplicity and symmetry with `_handle_image_menu()`, place it inside the try block before the finally clause.

3. **`extraction.wines` reference in the HTML_MENU 0-wine elif**
   - What we know: The spec shows `and not extraction.wines` — but `extraction` is a local variable defined inside the `if result.content_type == ContentType.HTML_MENU` block.
   - What's unclear: Scoping — the `elif` for image-menu fallback needs to be nested inside the HTML_MENU if-block, not as a top-level elif.
   - Recommendation: Nest the `_is_image_menu` elif as:
     ```python
     if result.content_type == ContentType.HTML_MENU and result.extracted_text:
         extraction = await extractor.extract_from_text(...)
         if extraction.wines:
             ...persist...
         elif await self._is_image_menu(page):
             await self._handle_image_menu(page, result, restaurant_name, website_url)
     ```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Playwright async_api | `_take_viewport_chunks()` | Installed (imported at top of web_crawler.py) | current | Falls back to `ImageOnly` path with no Vision call if None |
| anthropic (AsyncAnthropic) | `extract_pdf()`, `extract_menu()` | Installed (used in claude_vision_extractor.py) | current | N/A — required |
| CLAUDE_API_KEY env var | Anthropic client init | Set (used in Phase 1–5) | — | RuntimeError raised in `_get_client()` |
| base64 (stdlib) | b64 encoding | Always available | Python stdlib | N/A |

No missing dependencies.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest (existing in project) |
| Config file | pytest.ini or pyproject.toml (check project root) |
| Quick run command | `pytest services/agent-orchestrator/tests/test_image_menu.py -x` |
| Full suite command | `pytest services/agent-orchestrator/tests/ -x` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IMGX-01 | `image_menu_detected=True` set on IMAGE_ONLY result | unit | `pytest tests/test_image_menu.py::test_image_only_sets_detected -x` | Wave 0 |
| IMGX-02 | `_take_viewport_chunks()` returns list of jpeg bytes | unit (mock page) | `pytest tests/test_image_menu.py::test_take_viewport_chunks -x` | Wave 0 |
| IMGX-03 | `extract_menu()` called with base64 strings not bytes | unit (mock extractor) | `pytest tests/test_image_menu.py::test_extract_menu_called_with_b64 -x` | Wave 0 |
| IMGX-04 | `_persist_crawled_wines()` called with non-dupe wines | unit | `pytest tests/test_image_menu.py::test_persist_called_for_image_menu -x` | Wave 0 |
| IMGX-05 | JSONL `data_enrichment.source_type` == `"image_menu"` | unit | `pytest tests/test_image_menu.py::test_source_type_tag -x` | Wave 0 |
| IMGX-06 | Existing HTML_MENU path still persists wines (no regression) | unit | `pytest tests/test_image_menu.py::test_html_menu_path_unbroken -x` | Wave 0 |
| IMGX-07 | E2E: Tredita ≥1 wine with source_type `"image_menu"` | e2e (live) | `python scripts/e2e_crawl_harness.py` | Wave 0 (extend existing) |

### Wave 0 Gaps

- [ ] `services/agent-orchestrator/tests/test_image_menu.py` — new file covering IMGX-01 through IMGX-06 with mocked Playwright page and mocked extractor
- [ ] `scripts/e2e_restaurants.json` — add Tredita entry with `"expect_image_menu": true`
- [ ] `extract_pdf()` unit test — add to `test_image_menu.py` or alongside existing extractor tests

---

## Sources

### Primary (HIGH confidence)
- Official Anthropic docs: `platform.claude.com/docs/en/docs/build-with-claude/pdf-support` — PDF document block syntax, model support ("all active models"), base64 encoding, 32MB request limit, 600 page limit
- `services/agent-orchestrator/services/web_crawler.py` — direct code read: `_persist_crawled_wines()` signature, `_check_image_menu()` implementation, `CrawlResult` dataclass, `crawl_restaurant()` flow, `_wine_is_duplicate()` contract
- `services/agent-orchestrator/services/claude_vision_extractor.py` — direct code read: `extract_menu(pages: List[str])` signature, `extract_page()` Anthropic client call pattern, `get_media_type()` helper, SpendLogger wiring
- `scripts/e2e_crawl_harness.py` — direct code read: `run_crawl()` pattern, `validate_schema()` required keys, `data_enrichment` field structure

### Secondary (MEDIUM confidence)
- Playwright Python docs screenshot page: `clip` parameter confirmed as `{"x": float, "y": float, "width": float, "height": float}` — cross-referenced by multiple Playwright guides
- `page.evaluate()` for `naturalWidth` and `document.body.scrollHeight` — standard Playwright JS evaluation pattern, consistent across all Playwright docs

### Tertiary (LOW confidence)
- None — all critical claims verified by official docs or direct code read.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies confirmed present in codebase
- Architecture: HIGH — all integration points verified by direct code read
- Pitfalls: HIGH — pitfalls derived from exact code line readings, not inference
- PDF model support: HIGH — official Anthropic docs confirm all active models including Haiku

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (Anthropic API PDF support is GA; Playwright clip API is stable)
