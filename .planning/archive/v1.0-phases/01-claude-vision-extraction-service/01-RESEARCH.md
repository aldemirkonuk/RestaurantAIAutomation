# Phase 1: Claude Vision Extraction Service — Research

**Researched:** 2026-04-01
**Domain:** Anthropic Claude Vision API, asyncio parallel processing, FastAPI, Pydantic v2, Supabase persistence
**Confidence:** HIGH — all decisions are locked in CONTEXT.md, benchmark results exist in-project, canonical code patterns are readable on disk

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Service Architecture**
- `claude_vision_extractor.py` is a standalone new file — does NOT modify `vlm_extraction_service.py`
- `vlm_extraction_service.py` stays untouched (continues handling Gemini Flash crawling path)
- Claude Vision extractor follows the same Pydantic model pattern as `VLMExtractionResult` in vlm_extraction_service.py
- Use `anthropic.AsyncAnthropic` client (already proven in benchmark) for async parallel page processing

**API Endpoint**
- New endpoint: `POST /api/v1/onboarding/extract` added to `onboarding_routes.py`
- Accepts: `restaurant_id` (required), `images` (list of base64 strings, one per page) OR `pdf_base64`
- Returns: `{ scan_session_id, total_wines, total_cost_usd, wines[], pages_processed, needs_review_count }`
- Request model: new `MenuScanRequest` Pydantic model in onboarding_routes.py

**Persistence (Efficiency-first — no new migration)**
- Use existing `master_wine_library_submissions` table — no new migration
- Each extracted wine gets: `scan_session_id` (UUID, one per API call), `extraction_source = "claude_vision"`, `restaurant_id`
- `scan_session_id` is generated per request, stored on all wines in the batch — enables audit trail
- After extraction, wines flow through the existing submissions → `master_wine_library` approval path
- No new `wine_scans` table — lean and efficient

**Error Handling**
- Hard fail on Claude Vision API error: return HTTP 503 with error detail
- No silent Gemini fallback — cost transparency > silent recovery
- Per-page errors: if one page fails, mark it `{ page: N, error: "..." }` in response but continue other pages
- Partial success (some pages fail) → return what succeeded + error list, HTTP 207

**Cost Tracking**
- Per-page: `input_tokens + output_tokens → cost_usd` logged on each wine batch
- Total cost returned in response body (`total_cost_usd`)
- Per-wine: `extraction_cost_usd` field stored in submission row

**Field Completeness**
- Completeness score per wine: `filled_fields / total_fields` where fields = [wine_name, vintage, price_bottle, region, country, section_name]
- `needs_review: true` if completeness < 0.5
- Returned on each wine object and aggregated as `needs_review_count` in response

### Claude's Discretion
- Exact Pydantic model field names (follow vlm_extraction_service.py conventions)
- Extraction prompt design (reuse/extend the benchmark prompt that achieved 91–100% completeness)
- asyncio concurrency limit (use asyncio.Semaphore to cap at 5 concurrent pages — prevent rate limiting)
- scan_session_id generation (use `uuid.uuid4()`)

### Deferred Ideas (OUT OF SCOPE)
- Gemini Flash fallback — deferred. Hard fail is the decision for Phase 1. Fallback could be Phase 2 enhancement.
- wine_scans audit table — deferred. submissions table + scan_session_id is sufficient for now.
- PDF → image conversion pipeline — deferred to Phase 1 planning discretion (pdf2image or existing pdf_extraction_service.py can handle).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLVS-01 | System sends menu image pages to Claude Vision and receives structured wine JSON per page | `anthropic.AsyncAnthropic.messages.create` with base64 image + EXTRACTION_PROMPT; benchmark proves this works 8/8 pages |
| CLVS-02 | Extraction JSON includes: wine_name, vintage, price_bottle, price_glass, region, country, grape_variety, section_name, bin_number | Benchmark EXTRACTION_PROMPT already covers all 9 fields; model returns null for absent fields |
| CLVS-03 | Multi-page menus processed in parallel (asyncio) — total extraction < 10s for 10 pages | Proven: benchmark ran 8 pages in parallel via `asyncio.gather(*tasks)`, wall time ~6s; Semaphore(5) keeps within rate limits |
| CLVS-04 | Per-extraction cost tracked and logged (input_tokens + output_tokens → USD) | Benchmark formula: `(input_tokens * 3.0 / 1_000_000) + (output_tokens * 15.0 / 1_000_000)` used and proven |
| CLVS-05 | Extraction result persisted to Supabase — originally specified `wine_scans` table but CONTEXT.md locks this to `master_wine_library_submissions` with scan_session_id | `master_wine_library_submissions` schema documented; pattern exists in `onboarding_routes.py` lines 224–270 |
| CLVS-06 | `POST /api/v1/onboarding/extract` accepts image upload or base64, returns extracted wines | New route added to existing `onboarding_routes.py` router; `MenuScanRequest` Pydantic model to be added |
| CLVS-07 | Field completeness score per wine (0–1), wines below 0.5 flagged for human review | Formula: `filled_fields / total_fields` over [wine_name, vintage, price_bottle, region, country, section_name]; `needs_review = completeness < 0.5` |
</phase_requirements>

---

## Summary

Phase 1 builds `claude_vision_extractor.py`, a standalone async service that parallelizes wine data extraction from menu images using Claude Vision. The architecture is entirely proven: the benchmark script `scripts/claude_vision_benchmark.py` already demonstrates 8/8 success rate, 91–100% field completeness, ~$0.045/page cost, and ~6s wall time for 8 concurrent pages using `asyncio.gather` with `anthropic.AsyncAnthropic`. The implementation is essentially a productionized version of that benchmark, wrapped in a FastAPI endpoint and wired to Supabase persistence.

The key patterns are all available on disk: `VLMExtractionResult` Pydantic model in `vlm_extraction_service.py` defines the model convention; `onboarding_routes.py` lines 224–270 show exactly how to insert into `master_wine_library_submissions`; the benchmark script shows the exact `AsyncAnthropic` call signature, token cost formula, and robust JSON parsing logic. No external research is needed — this is a translation exercise from proven scripts to production service.

One version discrepancy requires attention: `requirements.txt` pins `anthropic==0.14.0` but the system-installed version is `0.87.0`. The benchmark and new service should target `anthropic>=0.50.0` (the message API stabilized post-0.20). The planner must update requirements.txt as part of Wave 0.

**Primary recommendation:** Translate `scripts/claude_vision_benchmark.py` into a `ClaudeVisionExtractor` class mirroring `VLMExtractionService` structure, add `MenuScanRequest` and response Pydantic models to `onboarding_routes.py`, wire the POST endpoint, and bulk-insert to `master_wine_library_submissions` using the existing pattern.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anthropic | 0.87.0 (installed) / pin >=0.50.0 | Claude Vision async API client | `AsyncAnthropic` + `messages.create` is the only supported async path; proven in benchmark |
| fastapi | 0.109.0 | HTTP endpoint routing | Already in service; router pattern established |
| pydantic | 2.6.0 | Request/response validation and data models | Entire service uses Pydantic v2; `VLMExtractionResult` pattern to follow |
| supabase | 2.28.0 | Supabase persistence | Already in service; used in `onboarding_routes.py` |
| asyncio (stdlib) | Python 3.11 | Parallel page dispatch | `asyncio.gather` + `asyncio.Semaphore` proven in benchmark |
| python-dotenv | 1.0.0 | Load `CLAUDE_API_KEY` from `.env` | Used in benchmark; service should use `get_settings()` instead |
| uuid (stdlib) | Python 3.11 | `scan_session_id` generation | `uuid.uuid4()` — locked in CONTEXT.md |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pdf2image | 1.17.0 | PDF page → image bytes conversion | If `pdf_base64` input path is implemented (deferred but pdf2image is already installed) |
| base64 (stdlib) | Python 3.11 | Encode/decode image bytes | Used in benchmark for `base64.standard_b64encode` |
| re (stdlib) | Python 3.11 | Robust JSON extraction from Claude response | Benchmark's `parse_json_response` uses regex fallback |
| json (stdlib) | Python 3.11 | Parse Claude JSON response | Primary JSON parse |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `asyncio.gather` + `Semaphore(5)` | `asyncio.Queue` worker pool | gather is simpler, meets < 10s requirement; queue adds complexity for no gain at this scale |
| `master_wine_library_submissions` for persistence | new `wine_scans` table | Deferred by decision — no new migration, use existing staging table |

**Requirements.txt update needed:**
```bash
# Change: anthropic==0.14.0 → anthropic>=0.50.0
# (0.87.0 is installed; 0.14.0 predates AsyncAnthropic message API stability)
```

---

## Architecture Patterns

### Recommended Project Structure
```
services/agent-orchestrator/
├── services/
│   ├── vlm_extraction_service.py      # UNTOUCHED — Gemini path
│   └── claude_vision_extractor.py     # NEW — Claude Vision path
├── api/
│   └── onboarding_routes.py           # ADD MenuScanRequest + POST /extract endpoint
└── tests/
    └── test_claude_vision_extractor.py # NEW — unit tests
```

### Pattern 1: ClaudeVisionExtractor class mirroring VLMExtractionService

**What:** A class with lazy-init `AsyncAnthropic` client, `extract_page()` coroutine for single page, `extract_menu()` for parallel batch dispatch.
**When to use:** Single entry point for all Claude Vision calls; mirrors VLMExtractionService singleton pattern.

```python
# Source: services/agent-orchestrator/services/vlm_extraction_service.py (adapted)
class ClaudeVisionExtractor:
    def __init__(self):
        self._client: Optional[anthropic.AsyncAnthropic] = None
        self._semaphore: Optional[asyncio.Semaphore] = None

    def _get_client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            api_key = os.getenv("CLAUDE_API_KEY")
            self._client = anthropic.AsyncAnthropic(api_key=api_key)
            self._semaphore = asyncio.Semaphore(5)
        return self._client

    async def extract_page(self, b64_image: str, media_type: str, page_index: int) -> ClaudePageResult:
        """Send one page to Claude Vision. Returns wines + cost for this page."""
        async with self._semaphore:
            response = await self._get_client().messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=8192,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64_image}},
                        {"type": "text", "text": EXTRACTION_PROMPT},
                    ]
                }]
            )
        # ... parse response, compute cost, return ClaudePageResult

    async def extract_menu(self, pages: List[str]) -> ClaudeExtractionResult:
        """Parallel extraction of all pages. Returns aggregated result."""
        tasks = [self.extract_page(b64, "image/png", i) for i, b64 in enumerate(pages)]
        page_results = await asyncio.gather(*tasks, return_exceptions=True)
        # ... aggregate wines, costs, errors
```

### Pattern 2: Proven EXTRACTION_PROMPT (from benchmark)

**What:** The exact prompt that achieved 91–100% completeness. Use verbatim; only extend to add `bin_number` (already in prompt) and any missing fields.
**When to use:** Every Claude Vision call.

```python
# Source: scripts/claude_vision_benchmark.py — EXTRACTION_PROMPT
EXTRACTION_PROMPT = """You are a wine menu extraction expert. Extract ALL wines from this menu image into structured JSON.

For each wine, extract these fields:
- wine_name: Full name of the wine (producer + cuvée)
- vintage: Year as integer (null if NV or not shown)
- price_bottle: Bottle price as float (null if not shown)
- price_glass: Glass price as float (null if not shown)
- region: Wine region (e.g., "Bordeaux", "Napa Valley")
- country: Country of origin
- grape_variety: Grape/blend if stated
- section_name: The section/category this wine appears under
- bin_number: Bin/item number if shown

Return ONLY valid JSON in this exact format:
{
  "wines": [...],
  "page_notes": "brief note about this page",
  "total_wines_extracted": 0
}"""
```

### Pattern 3: Robust JSON Parsing (from benchmark)

**What:** Multi-strategy JSON extraction handles markdown fences, code blocks, and partial JSON. This is critical — Claude occasionally wraps output in ```json fences even when told not to.
**When to use:** Every response parse.

```python
# Source: scripts/claude_vision_benchmark.py — parse_json_response()
import re

def parse_json_response(raw_text: str) -> tuple[dict, bool]:
    # Strategy 1 & 2: strip ```json ... ``` or ``` ... ```
    for pattern in [r"```json\s*([\s\S]*?)```", r"```\s*([\s\S]*?)```"]:
        m = re.search(pattern, raw_text)
        if m:
            try:
                return json.loads(m.group(1).strip()), False
            except json.JSONDecodeError:
                pass
    # Strategy 3: find outermost { ... }
    m = re.search(r"\{[\s\S]*\}", raw_text)
    if m:
        try:
            return json.loads(m.group(0)), False
        except json.JSONDecodeError:
            pass
    # Strategy 4: raw parse
    try:
        return json.loads(raw_text.strip()), False
    except json.JSONDecodeError:
        return {"wines": [], "parse_error": True}, True
```

### Pattern 4: Cost formula (from benchmark)

```python
# Source: scripts/claude_vision_benchmark.py — extract_wines_async()
# Sonnet pricing: $3/M input tokens, $15/M output tokens
input_tokens = response.usage.input_tokens
output_tokens = response.usage.output_tokens
cost_usd = (input_tokens * 3.0 / 1_000_000) + (output_tokens * 15.0 / 1_000_000)
```

### Pattern 5: Supabase submissions insert (from onboarding_routes.py)

**What:** Existing pattern for inserting wines into `master_wine_library_submissions`. The new endpoint reuses this exact pattern, adding `scan_session_id` and `extraction_source` to the payload.

```python
# Source: services/agent-orchestrator/api/onboarding_routes.py lines 224–270
sig_str = f"{wine.wine_name or ''}-{wine.producer or ''}-{wine.vintage or ''}".lower().strip()
signature_hash = hashlib.sha256(sig_str.encode()).hexdigest()

supabase.table("master_wine_library_submissions").insert({
    "restaurant_id": restaurant_id,
    "submitted_by": "claude_vision",   # was "onboarding" in original
    "payload": {
        **wine_fields,
        "scan_session_id": scan_session_id,
        "extraction_source": "claude_vision",
        "extraction_cost_usd": per_wine_cost,
        "needs_review": wine.needs_review,
        "completeness_score": wine.completeness_score,
    },
    "signature_hash": signature_hash,
    "status": "pending_review",
    "created_at": datetime.utcnow().isoformat(),
}).execute()
```

### Pattern 6: MenuScanRequest Pydantic model (new model in onboarding_routes.py)

```python
# New model — follows RestaurantProfile/WineImportItem pattern in onboarding_routes.py
class MenuScanRequest(BaseModel):
    restaurant_id: str
    images: Optional[List[str]] = None        # list of base64 strings, one per page
    pdf_base64: Optional[str] = None          # alternative: full PDF as base64

    class Config:
        populate_by_name = True
```

### Pattern 7: HTTP 207 for partial success

**What:** When some pages fail but others succeed, return HTTP 207 Multi-Status.
**When to use:** `len(page_errors) > 0 and len(wines) > 0`.

```python
# FastAPI returning non-200 with body
from fastapi.responses import JSONResponse

if page_errors and wines:
    return JSONResponse(status_code=207, content={...})
elif not wines:
    raise HTTPException(status_code=503, detail="All pages failed")
else:
    return {...}  # 200 implicit
```

### Anti-Patterns to Avoid
- **Using `anthropic==0.14.0`:** The pinned version in requirements.txt predates stable AsyncAnthropic. The installed system version (0.87.0) is what the benchmark uses. Update the pin.
- **Parsing response as `response.text`:** Gemini uses `response.text`; Anthropic uses `response.content[0].text`. Do not copy Gemini parsing pattern into Claude service.
- **max_tokens=4096:** Benchmark proved this truncates dense pages mid-JSON. Use 8192.
- **No Semaphore:** `asyncio.gather` without rate limiting will hit Anthropic rate limits on large menus. Always wrap with `asyncio.Semaphore(5)`.
- **Silent JSON parse failure:** If parse fails, the wine list is empty but no error surfaces. Use the multi-strategy parser and set `parse_error: True` in result.
- **Modifying vlm_extraction_service.py:** Locked decision — do not touch it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting / concurrency cap | Custom token bucket | `asyncio.Semaphore(5)` | One line, proven in benchmark, sufficient for 10-page menus |
| JSON parsing from LLM response | Custom parser | Multi-strategy regex (from benchmark) | LLMs produce malformed JSON, code blocks, partial output; benchmark already solved this |
| Cost calculation | Custom formula | Hardcoded Sonnet pricing formula from benchmark | `(input * 3.0 + output * 15.0) / 1_000_000` matches Anthropic pricing as of 2026-04-01 |
| Dedup / signature hash | Custom hash | `hashlib.sha256(sig_str.encode()).hexdigest()` | Already used in onboarding_routes.py; consistency required |
| UUID generation | Custom ID | `str(uuid.uuid4())` | Locked in CONTEXT.md, Python stdlib |
| HTTP async client | httpx directly | `anthropic.AsyncAnthropic` | SDK handles retries, auth header, connection pooling |

**Key insight:** The benchmark script is a complete proof of concept. The implementation is translating battle-tested script logic into a class structure — not solving new problems.

---

## Common Pitfalls

### Pitfall 1: anthropic response format vs. Gemini
**What goes wrong:** Developer copies `response.text` from VLMExtractionService (Gemini pattern) into Claude extractor. `AttributeError: 'Message' object has no attribute 'text'`.
**Why it happens:** Gemini returns `response.text`; Anthropic SDK returns `response.content[0].text`.
**How to avoid:** Always use `response.content[0].text` for Claude Vision responses. Benchmark script line 135 shows the correct pattern.
**Warning signs:** `AttributeError` on response object during first integration test.

### Pitfall 2: max_tokens=4096 truncates dense pages
**What goes wrong:** Dense wine pages (e.g., RL Restaurant p9, AVEC p2) produce truncated JSON — the response cuts off mid-array, causing a JSON parse error.
**Why it happens:** 4096 output tokens is insufficient for pages with 20+ wines when Claude formats the JSON with indentation.
**How to avoid:** Always use `max_tokens=8192`. Benchmark fixed this explicitly; notes in script header confirm it.
**Warning signs:** `parse_error: True` in result + `output_tokens_hit_limit: True` (output_tokens >= 8100).

### Pitfall 3: `submitted_by` column type mismatch
**What goes wrong:** `master_wine_library_submissions.submitted_by` was originally `UUID` type (migration 013), then altered to `TEXT` (migration 015 via `ADD COLUMN IF NOT EXISTS submitted_by TEXT`). If the existing column is UUID type, inserting string `"claude_vision"` will fail.
**Why it happens:** Migration 015 uses `ADD COLUMN IF NOT EXISTS` — if the column already exists as UUID (from the original schema), the ALTER is a no-op and the column remains UUID.
**How to avoid:** Insert `submitted_by` as `"claude_vision"` (string) and handle the potential DB error gracefully. Alternatively, check actual Supabase column type before implementation. If UUID-typed, pass `NULL` and use payload JSONB for source tracking.
**Warning signs:** `invalid input syntax for type uuid` Supabase error on insert.

### Pitfall 4: asyncio.Semaphore must be created inside async context
**What goes wrong:** `asyncio.Semaphore(5)` instantiated at class `__init__` time raises `RuntimeError: no running event loop` in some FastAPI startup contexts.
**Why it happens:** Semaphore requires a running event loop to be bound to.
**How to avoid:** Create the semaphore lazily inside the first async call (or in the first `async def` method), not in `__init__`. The benchmark creates the client inside `run_benchmark()` which is already inside `asyncio.run()`.
**Warning signs:** `RuntimeError: no running event loop` on class instantiation.

### Pitfall 5: `needs_review` threshold logic gap
**What goes wrong:** Completeness computed over 6 fields. If wine has `wine_name` + `vintage` + `price_bottle` all populated but `region`, `country`, `section_name` null → completeness = 3/6 = 0.50. The condition `< 0.5` means 0.50 is NOT flagged — but this wine has no regional data. Planner/implementer must decide if threshold is `< 0.5` (strict less-than) or `<= 0.5`.
**Why it happens:** Boundary condition ambiguity.
**How to avoid:** CONTEXT.md says `< 0.5`. Implement exactly `completeness < 0.5` (not <=).
**Warning signs:** Manually verify edge cases in unit tests.

### Pitfall 6: PDF base64 path not fully specified
**What goes wrong:** `MenuScanRequest` accepts `pdf_base64` but the conversion to per-page images is deferred. If a caller sends a PDF, the endpoint will silently ignore it or throw an unhandled error.
**Why it happens:** PDF path is deferred per CONTEXT.md.
**How to avoid:** In the endpoint handler, explicitly reject `pdf_base64` in Phase 1 with HTTP 422: `"pdf_base64 not yet supported — send pre-converted page images"`. This is better than silent failure.
**Warning signs:** Callers sending PDFs get 500 instead of clear error.

---

## Code Examples

### Full async page extraction (production-ready pattern)

```python
# Source: scripts/claude_vision_benchmark.py — extract_wines_async() + class wrapper
import anthropic
import asyncio
import base64
import json
import re
import os
from typing import Optional

async def extract_page(
    client: anthropic.AsyncAnthropic,
    semaphore: asyncio.Semaphore,
    b64_image: str,
    media_type: str,
    page_index: int,
) -> dict:
    """Extract wines from one page. Returns page result dict."""
    async with semaphore:
        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8192,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64_image}},
                    {"type": "text", "text": EXTRACTION_PROMPT},
                ]
            }]
        )

    raw_text = response.content[0].text   # NOTE: not response.text (that's Gemini)
    parsed, parse_error = parse_json_response(raw_text)

    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    cost_usd = (input_tokens * 3.0 / 1_000_000) + (output_tokens * 15.0 / 1_000_000)

    return {
        "page_index": page_index,
        "wines": parsed.get("wines", []),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": cost_usd,
        "parse_error": parse_error,
        "output_tokens_hit_limit": output_tokens >= 8100,
    }
```

### Field completeness calculation

```python
# Source: scripts/claude_vision_benchmark.py — compute_quality_metrics() (adapted)
COMPLETENESS_FIELDS = ["wine_name", "vintage", "price_bottle", "region", "country", "section_name"]

def compute_completeness(wine: dict) -> float:
    """Returns 0.0–1.0 completeness score for one wine."""
    filled = sum(
        1 for f in COMPLETENESS_FIELDS
        if wine.get(f) is not None and wine.get(f) != ""
    )
    return round(filled / len(COMPLETENESS_FIELDS), 3)
```

### master_wine_library_submissions insert with scan_session_id

```python
# Source: services/agent-orchestrator/api/onboarding_routes.py lines 228–258 (adapted)
import hashlib
from datetime import datetime

def build_submission_payload(wine: dict, scan_session_id: str, restaurant_id: str, cost_per_wine: float) -> dict:
    sig_str = f"{wine.get('wine_name','')}-{wine.get('producer','')}-{wine.get('vintage','')}"
    sig_str = sig_str.lower().strip()
    signature_hash = hashlib.sha256(sig_str.encode()).hexdigest()

    return {
        "restaurant_id": restaurant_id,
        "submitted_by": "claude_vision",
        "payload": {
            **wine,
            "scan_session_id": scan_session_id,
            "extraction_source": "claude_vision",
            "extraction_cost_usd": cost_per_wine,
        },
        "signature_hash": signature_hash,
        "status": "pending_review",
        "created_at": datetime.utcnow().isoformat(),
    }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| anthropic==0.14.0 (in requirements.txt) | anthropic==0.87.0 (installed) | requirements.txt never updated after initial pin | requirements.txt must be updated; mismatch will cause issues in fresh venv |
| Gemini Vision as primary extractor | Claude Vision as primary extractor (new) | Architecture decision 2026-03-31 | claude_vision_extractor.py is new; Gemini path unchanged |
| max_tokens=4096 | max_tokens=8192 | benchmark v2 fix (2026-04-01) | Dense pages no longer truncate mid-JSON |
| Sequential page processing | asyncio.gather parallel | benchmark v2 (2026-04-01) | 10 pages in ~6s instead of ~250s |

**Deprecated/outdated in this codebase:**
- `requirements.txt` pin `anthropic==0.14.0`: Predates `AsyncAnthropic` stability. Update to `anthropic>=0.50.0` or pin to `0.87.0`.

---

## Open Questions

1. **`submitted_by` column type in live Supabase**
   - What we know: Migration 013 defined it as `UUID NOT NULL`; Migration 015 ran `ADD COLUMN IF NOT EXISTS submitted_by TEXT` — which is a no-op if column already exists.
   - What's unclear: The actual column type in the live Supabase instance depends on migration application order.
   - Recommendation: In Wave 0 or task 1, query `information_schema.columns` for `master_wine_library_submissions.submitted_by` column type. If UUID, either cast or insert `NULL` and track source in payload JSONB only.

2. **Anthropic rate limits for concurrent requests**
   - What we know: `Semaphore(5)` worked in benchmark with 8 pages; no rate limit errors observed.
   - What's unclear: Anthropic Tier 1/2/3 rate limits — exact RPM limits for `claude-sonnet-4-20250514` on the project's API key tier.
   - Recommendation: Keep `Semaphore(5)` as locked in CONTEXT.md. If rate limit errors appear during testing, reduce to `Semaphore(3)`.

3. **pdf2image / poppler availability on deployment target (Railway)**
   - What we know: `pdf2image` is installed locally (1.17.0). PDF input is deferred per CONTEXT.md.
   - What's unclear: Whether `poppler-utils` (system dependency of pdf2image) is available on Railway deployment.
   - Recommendation: Since PDF path is deferred, return HTTP 422 for `pdf_base64` in Phase 1. No action needed now.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.11 | All | ✓ | 3.11.0 | — |
| anthropic SDK | CLVS-01, CLVS-03, CLVS-04 | ✓ | 0.87.0 (installed) / 0.14.0 (pinned) | — |
| CLAUDE_API_KEY | CLVS-01 | ✓ | Present in .env | — |
| fastapi | CLVS-06 | ✓ | 0.109.0 | — |
| pydantic v2 | CLVS-02, CLVS-06 | ✓ | 2.6.0 | — |
| supabase Python client | CLVS-05 | ✓ | 2.28.0 | — |
| pytest + pytest-asyncio | Unit tests | ✓ | 7.4.4 + 0.23.3 | — |
| pdf2image | pdf_base64 path | ✓ locally | 1.17.0 | N/A — PDF deferred, return 422 |

**Missing dependencies with no fallback:** None — all Phase 1 dependencies are available.

**Requirements.txt version gap (action required):**
- `anthropic==0.14.0` (pinned) vs `0.87.0` (installed). This will break a fresh `pip install -r requirements.txt`. Update pin in Wave 0.

---

## Sources

### Primary (HIGH confidence)
- `scripts/claude_vision_benchmark.py` — Exact working implementation: AsyncAnthropic call signature, EXTRACTION_PROMPT, parse_json_response, cost formula, asyncio.gather pattern
- `services/agent-orchestrator/services/vlm_extraction_service.py` — Pydantic model convention (`VLMExtractionResult`), service class structure, lazy-init pattern, singleton pattern
- `services/agent-orchestrator/api/onboarding_routes.py` — `master_wine_library_submissions` insert pattern (lines 224–270), Pydantic model conventions, router structure
- `services/database/migrations/013_master_wine_library_dedup_and_events.sql` — `master_wine_library_submissions` schema: columns, types, constraints
- `services/database/migrations/015_governance_tiers_and_aliases.sql` — `submitted_by TEXT` column addition, `reviewed_at` column
- `scripts/benchmark_results/benchmark_v2_20260401_133504.json` (referenced) — 8/8 success, 91–100% completeness, $0.045/page avg

### Secondary (MEDIUM confidence)
- `services/agent-orchestrator/requirements.txt` — Confirmed installed package versions; version pin discrepancy identified
- `services/agent-orchestrator/pytest.ini` — Test framework: pytest with asyncio_mode=auto, testpaths=tests
- `services/agent-orchestrator/tests/conftest.py` — Existing `mock_supabase_client` fixture available for unit tests

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified installed with versions
- Architecture: HIGH — patterns are directly readable from existing code on disk; benchmark proves the approach
- Pitfalls: HIGH — pitfalls derived from actual code analysis (Gemini vs Claude response format, migration type discrepancy, benchmark notes)
- Persistence schema: MEDIUM — `submitted_by` column type in live Supabase is uncertain due to migration order ambiguity

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (Anthropic pricing stable; library versions stable)
