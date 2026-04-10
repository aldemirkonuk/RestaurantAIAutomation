# Phase 1: Claude Vision Extraction Service — Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `claude_vision_extractor.py` — a standalone new service that accepts menu images (base64 or file path), sends each page to Claude Vision (claude-sonnet-4) in parallel via asyncio, and returns structured wine JSON with field completeness scores. Wire into a new `POST /api/v1/onboarding/extract` endpoint in `onboarding_routes.py`. Extracted wines are stored via `master_wine_library_submissions` (existing table, no migration needed), tagged with a `scan_session_id` for audit trail.
</domain>

<decisions>
## Implementation Decisions

### Service Architecture
- `claude_vision_extractor.py` is a **standalone new file** — does NOT modify `vlm_extraction_service.py`
- `vlm_extraction_service.py` stays untouched (continues handling Gemini Flash crawling path)
- Claude Vision extractor follows the same Pydantic model pattern as `VLMExtractionResult` in vlm_extraction_service.py
- Use `anthropic.AsyncAnthropic` client (already proven in benchmark) for async parallel page processing

### API Endpoint
- New endpoint: `POST /api/v1/onboarding/extract` added to `onboarding_routes.py`
- Accepts: `restaurant_id` (required), `images` (list of base64 strings, one per page) OR `pdf_base64`
- Returns: `{ scan_session_id, total_wines, total_cost_usd, wines[], pages_processed, needs_review_count }`
- Request model: new `MenuScanRequest` Pydantic model in onboarding_routes.py

### Persistence (Efficiency-first — no new migration)
- Use existing `master_wine_library_submissions` table — no new migration
- Each extracted wine gets: `scan_session_id` (UUID, one per API call), `extraction_source = "claude_vision"`, `restaurant_id`
- `scan_session_id` is generated per request, stored on all wines in the batch — enables audit trail
- After extraction, wines flow through the existing submissions → `master_wine_library` approval path
- No new `wine_scans` table — lean and efficient

### Error Handling
- Hard fail on Claude Vision API error: return HTTP 503 with error detail
- No silent Gemini fallback — cost transparency > silent recovery
- Per-page errors: if one page fails, mark it `{ page: N, error: "..." }` in response but continue other pages
- Partial success (some pages fail) → return what succeeded + error list, HTTP 207

### Cost Tracking
- Per-page: `input_tokens + output_tokens → cost_usd` logged on each wine batch
- Total cost returned in response body (`total_cost_usd`)
- Per-wine: `extraction_cost_usd` field stored in submission row

### Field Completeness
- Completeness score per wine: `filled_fields / total_fields` where fields = [wine_name, vintage, price_bottle, region, country, section_name]
- `needs_review: true` if completeness < 0.5
- Returned on each wine object and aggregated as `needs_review_count` in response

### Claude's Discretion
- Exact Pydantic model field names (follow vlm_extraction_service.py conventions)
- Extraction prompt design (reuse/extend the benchmark prompt that achieved 91–100% completeness)
- asyncio concurrency limit (use asyncio.Semaphore to cap at 5 concurrent pages — prevent rate limiting)
- scan_session_id generation (use `uuid.uuid4()`)
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Service Patterns
- `services/agent-orchestrator/services/vlm_extraction_service.py` — VLMExtractionResult model, Gemini Vision prompt structure, cost tracking pattern to replicate
- `services/agent-orchestrator/api/onboarding_routes.py` — existing router, RestaurantProfile model, master_wine_library_submissions insert pattern (lines ~224–270)
- `services/agent-orchestrator/api/scan_routes.py` — extract_from_photo() pattern, restaurant_id handling, enrichment queue helper

### Database
- `supabase/migrations/20260208030000_wine_specific_tables.sql` — master_wine_library and master_wine_library_submissions schema

### Benchmark (Proof of Approach)
- `scripts/benchmark_results/benchmark_v2_20260401_133504.json` — actual Claude Vision results: 8/8 success, 91–100% completeness on wine pages, $0.045/page avg

### Architecture Decision
- `.planning/PROJECT.md` — Key Decisions table, Core Value, constraints
- `.planning/REQUIREMENTS.md` — CLVS-01 through CLVS-07 acceptance criteria
</canonical_refs>

<specifics>
## Specific References

- Extraction prompt that worked: `scripts/claude_vision_benchmark.py` EXTRACTION_PROMPT (achieved 91–100% field completeness)
- Model: `claude-sonnet-4-20250514`, `max_tokens=8192` (8192 required — 4096 truncates dense pages)
- Cost: ~$0.045/page at current Sonnet pricing ($3/M input, $15/M output)
- Proven parallel pattern: `asyncio.gather(*tasks)` in benchmark script — use same pattern
- Concurrency: cap at 5 simultaneous pages via `asyncio.Semaphore(5)` to respect rate limits
</specifics>

<deferred>
## Deferred Ideas

- Gemini Flash fallback — deferred. Hard fail is the decision for Phase 1. Fallback could be Phase 2 enhancement.
- wine_scans audit table — deferred. submissions table + scan_session_id is sufficient for now.
- PDF → image conversion pipeline — deferred to Phase 1 planning discretion (pdf2image or existing pdf_extraction_service.py can handle).
</deferred>

---
*Phase: 01-claude-vision-extraction-service*
*Context gathered: 2026-04-01 via discuss-phase*
