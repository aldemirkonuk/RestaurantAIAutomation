---
plan: 06-01
phase: 06-image-menu-extraction
wave: 1
status: complete
completed: 2026-04-05
---

# Summary: Wave 1 — Interface Foundations

## What Was Built

Added two interface foundations that Wave 2 depends on:

1. **`extract_pdf()` on `ClaudeVisionExtractor`** (`claude_vision_extractor.py`)
   - Accepts `pdf_bytes: bytes`, encodes to base64, sends as Anthropic native document content block
   - Single API call covers all pages — Claude handles multi-page PDFs natively
   - Logs spend via `get_spend_logger()` (non-fatal)
   - Returns `ClaudeExtractionResult` with `extraction_method="claude_pdf"`
   - Source type tag `"pdf_vision_fallback"` set by caller in `web_crawler.py` (Wave 2)

2. **`image_menu_detected: bool = False` on `CrawlResult`** (`web_crawler.py`)
   - Added as last field in the dataclass
   - Wave 2 sets this to `True` when Vision path is taken

3. **`source_type: str = "crawled"` parameter on `_persist_crawled_wines()`** (`web_crawler.py`)
   - Default `"crawled"` preserves backward compatibility — existing caller at line 269 unchanged
   - Hardcoded `"source_type": "crawled"` in `data_enrichment` dict changed to `source_type` variable
   - Wave 2 passes `"image_menu"` and `"pdf_vision_fallback"` explicitly

## Key Files

- `services/agent-orchestrator/services/claude_vision_extractor.py` — added `extract_pdf()` method (lines 318–392)
- `services/agent-orchestrator/services/web_crawler.py` — added `image_menu_detected` field (line 86) and `source_type` param (line 409)

## Self-Check: PASSED

- `extract_pdf()` method exists with correct signature
- `document` content block with `application/pdf` media type used
- `extraction_method="claude_pdf"` returned
- `image_menu_detected: bool = False` added to `CrawlResult`
- `source_type: str = "crawled"` default parameter on `_persist_crawled_wines()`
- Hardcoded `"crawled"` replaced with `source_type` variable
- Existing caller at line 269 passes no `source_type` — backward compatible
- No new imports added (uuid, base64, uuid already imported)
- No existing methods modified
