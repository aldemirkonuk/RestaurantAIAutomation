# Requirements: WineOps Hybrid Extraction Pipeline

**Defined:** 2026-04-01
**Core Value:** Manager scans a menu → every wine identified, enriched, and onboarded at < $0.50/restaurant

## v1 Requirements

### Claude Vision Extraction (Onboarding Path)

- [x] **CLVS-01**: System sends menu image pages to Claude Vision and receives structured wine JSON per page
- [x] **CLVS-02**: Extraction JSON includes: wine_name, vintage, price_bottle, price_glass, region, country, grape_variety, section_name, bin_number
- [x] **CLVS-03**: Multi-page menus processed in parallel (asyncio) — parallelism confirmed working (10 pages = same wall time as 1 page). API latency is 30–60s per batch depending on wine density. Latency target revised: < 60s for a 10-page menu (was < 10s — that target was pre-API-measurement and not achievable without model swap)
- [x] **CLVS-04**: Per-extraction cost tracked and logged (input_tokens + output_tokens → USD)
- [x] **CLVS-05**: Extraction result persisted to Supabase `master_wine_library_submissions` table with restaurant_id, scan_session_id, extraction_source, signature_hash, needs_review, completeness_score
- [x] **CLVS-06**: Onboarding API endpoint `POST /api/v1/onboarding/extract` accepts image upload or base64, returns extracted wines
- [x] **CLVS-07**: Field completeness score computed per wine (0–1), wines below 0.5 flagged for human review

### Gemini Flash Crawler (Background Pre-seeding)

- [x] **GMFL-01**: Crawler sends HTML text and PDF text to Gemini Flash for extraction (not Claude Vision — cost optimization)
- [x] **GMFL-02**: Web crawler pipeline: restaurant URL → HTML DOM extraction → Gemini Flash → structured wines
- [x] **GMFL-03**: Crawled wines stored in JSONL with source_type = "crawled", confidence score, and 23-field Supabase-aligned schema
- [x] **GMFL-04**: Crawler respects robots.txt and rate limits (max 100 sites/day default)
- [x] **GMFL-05**: Duplicate detection: crawled wines matched against master library before inserting

### YOLO 2-class Preview (Real-time Camera Feed)

- [x] **YOLO-01**: YOLO 2-class best.pt loaded in menu_analyzer_agent on startup
- [x] **YOLO-02**: Camera frame → YOLO inference → bounding boxes returned in <200ms on CPU
- [x] **YOLO-03**: Boxes drawn on frame with class label (wine_entry / section_header) — UI only
- [x] **YOLO-04**: YOLO output does NOT trigger extraction — extraction is only triggered on user capture action
- [x] **YOLO-05**: Graceful fallback if model file missing: camera preview still works, boxes disabled

### Claude Haiku Enrichment (Background)

- [x] **HAIKU-01**: After onboarding extraction, wines with missing region/country/grape_variety queued for enrichment
- [x] **HAIKU-02**: Haiku enrichment prompt: given wine_name + vintage, infer region, country, grape_variety, producer_bio
- [x] **HAIKU-03**: Enrichment runs async in background (Celery task via haiku_enrich_task.delay()), does not block onboarding response
- [x] **HAIKU-04**: Enrichment cost capped: skip if wine already exists in master library with full fields
- [x] **HAIKU-05**: Enriched fields stored in Supabase `master_wine_library` with enrichment_source = "haiku"

### Cost & Quality Guardrails

- [x] **COST-01**: Monthly API spend tracked per provider (anthropic, google) in Supabase `api_spend` table
- [x] **COST-02**: Monthly soft cap: $50 Claude, $20 Gemini — alerts sent to MANAGER_EMAIL at 80% threshold
- [x] **COST-03**: Per-restaurant cost cap: if single restaurant extraction exceeds $2.00, stop and alert (HTTP 402)
- [x] **QUAL-01**: Human review queue: wines with completeness < 0.5 surfaced via `GET /api/v1/quality/review-queue` for correction
- [x] **QUAL-02**: Extraction accuracy tracked: per-field corrections logged to `field_corrections` table; acceptance rate computable via aggregation

### Image Menu Extraction (Claude Vision Fallback)

- [x] **IMGX-01**: `web_crawler.py` detects `ContentType.IMAGE_ONLY` and `HTML_MENU` results with `wine_count == 0`, sets `image_menu_detected = True`
- [x] **IMGX-02**: Playwright takes a full-page screenshot of the detected URL and saves to a temp path
- [x] **IMGX-03**: Screenshot passed to existing `claude_vision_extractor.py` — no new extractor written, Phase 1 brain reused
- [x] **IMGX-04**: Extracted wines flow through the same dedup + JSONL persist path as the HTML extraction route
- [x] **IMGX-05**: JSONL records from this path include `source_type: "image_menu"` (or `"pdf_vision_fallback"` for PDFs)
- [x] **IMGX-06**: `ContentType` handling updated: image menu route is explicit, documented, does not break existing HTML or PDF text paths
- [x] **IMGX-07**: E2E harness: Tredita added to test suite; harness confirms ≥ 1 wine extracted via Vision path

## v2 Requirements

### Advanced Extraction

- **ADV-01**: Fine-tuned Claude Haiku model on WineOps extraction data (when >10K labeled samples)
- **ADV-02**: Multi-modal menu understanding: extract from handwritten specials boards
- **ADV-03**: Vintage verification against wine database (Wine-Searcher API or similar)

### Crawler Enhancements

- **CRAWL-01**: OpenTable discovery → auto-queue restaurant websites for crawling
- **CRAWL-02**: Change detection: re-crawl only when restaurant website changes
- **CRAWL-03**: Yelp/Google Maps integration for restaurant discovery

## Out of Scope

| Feature | Reason |
|---------|--------|
| 13-class YOLO detection | mAP50 0.04 on sub-fields — fundamentally limited by image resolution |
| Surya OCR as extraction path | Claude Vision reads text directly — Surya adds no value here |
| Self-hosted extraction (no API) | Original goal superseded — API cost negligible for B2B SaaS at $0.13/menu (Haiku) |
| GPU deployment | Railway is CPU-only; YOLO 2-class runs fine on CPU |
| Invoice OCR changes | Separate pipeline, not this milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLVS-01 | Phase 1 | Complete |
| CLVS-02 | Phase 1 | Complete |
| CLVS-03 | Phase 1 | Complete |
| CLVS-04 | Phase 1 | Complete |
| CLVS-05 | Phase 1 | Complete |
| CLVS-06 | Phase 1 | Complete |
| CLVS-07 | Phase 1 | Complete |
| GMFL-01 | Phase 2 | Complete |
| GMFL-02 | Phase 2 | Complete |
| GMFL-03 | Phase 2 | Complete |
| GMFL-04 | Phase 2 | Complete |
| GMFL-05 | Phase 2 | Complete |
| YOLO-01 | Phase 3 | Complete |
| YOLO-02 | Phase 3 | Complete |
| YOLO-03 | Phase 3 | Complete |
| YOLO-04 | Phase 3 | Complete |
| YOLO-05 | Phase 3 | Complete |
| HAIKU-01 | Phase 4 | Complete |
| HAIKU-02 | Phase 4 | Complete |
| HAIKU-03 | Phase 4 | Complete |
| HAIKU-04 | Phase 4 | Complete |
| HAIKU-05 | Phase 4 | Complete |
| COST-01 | Phase 5 | Complete |
| COST-02 | Phase 5 | Complete |
| COST-03 | Phase 5 | Complete |
| QUAL-01 | Phase 5 | Complete |
| QUAL-02 | Phase 5 | Complete |
| IMGX-01 | Phase 6 | Complete |
| IMGX-02 | Phase 6 | Complete |
| IMGX-03 | Phase 6 | Complete |
| IMGX-04 | Phase 6 | Complete |
| IMGX-05 | Phase 6 | Complete |
| IMGX-06 | Phase 6 | Complete |
| IMGX-07 | Phase 6 | Complete |

**Coverage:**
- v1 requirements: 34 total (27 original + 7 IMGX added 2026-04-05)
- Mapped to phases: 34
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-04-05 — all Phase 1–6 requirements marked Complete; IMGX-01..07 added for Phase 6*
