# Requirements: WineOps Hybrid Extraction Pipeline

**Defined:** 2026-04-01
**Core Value:** Manager scans a menu → every wine identified, enriched, and onboarded at < $0.50/restaurant

## v1 Requirements

### Claude Vision Extraction (Onboarding Path)

- [ ] **CLVS-01**: System sends menu image pages to Claude Vision and receives structured wine JSON per page
- [ ] **CLVS-02**: Extraction JSON includes: wine_name, vintage, price_bottle, price_glass, region, country, grape_variety, section_name, bin_number
- [ ] **CLVS-03**: Multi-page menus processed in parallel (asyncio) — parallelism confirmed working (10 pages = same wall time as 1 page). API latency is 30–60s per batch depending on wine density. Latency target revised: < 60s for a 10-page menu (was < 10s — that target was pre-API-measurement and not achievable without model swap)
- [ ] **CLVS-04**: Per-extraction cost tracked and logged (input_tokens + output_tokens → USD)
- [ ] **CLVS-05**: Extraction result persisted to Supabase `master_wine_library_submissions` table with restaurant_id, page_count, total_cost, wines[]
- [ ] **CLVS-06**: Onboarding API endpoint `POST /api/v1/onboarding/extract` accepts image upload or base64, returns extracted wines
- [ ] **CLVS-07**: Field completeness score computed per wine (0–1), wines below 0.5 flagged for human review

### Gemini Flash Crawler (Background Pre-seeding)

- [ ] **GMFL-01**: Crawler sends HTML text and PDF text to Gemini Flash for extraction (not Claude Vision — cost optimization)
- [ ] **GMFL-02**: Web crawler pipeline: restaurant URL → HTML DOM extraction → Gemini Flash → structured wines
- [ ] **GMFL-03**: Crawled wines stored in `restaurant_menus` dataset with source_type = "crawled", confidence score
- [ ] **GMFL-04**: Crawler respects robots.txt and rate limits (max 100 sites/day default)
- [ ] **GMFL-05**: Duplicate detection: crawled wines matched against master library before inserting

### YOLO 2-class Preview (Real-time Camera Feed)

- [ ] **YOLO-01**: YOLO 2-class best.pt loaded in menu_analyzer_agent on startup
- [ ] **YOLO-02**: Camera frame → YOLO inference → bounding boxes returned in <200ms on CPU
- [ ] **YOLO-03**: Boxes drawn on frame with class label (wine_entry / section_header) — UI only
- [ ] **YOLO-04**: YOLO output does NOT trigger extraction — extraction is only triggered on user capture action
- [ ] **YOLO-05**: Graceful fallback if model file missing: camera preview still works, boxes disabled

### Claude Haiku Enrichment (Background)

- [ ] **HAIKU-01**: After onboarding extraction, wines with missing region/country/grape_variety queued for enrichment
- [ ] **HAIKU-02**: Haiku enrichment prompt: given wine_name + vintage, infer region, country, grape_variety, producer_bio
- [ ] **HAIKU-03**: Enrichment runs async in background (Celery task), does not block onboarding response
- [ ] **HAIKU-04**: Enrichment cost capped: skip if wine already exists in master library with full fields
- [ ] **HAIKU-05**: Enriched fields stored in Supabase `master_wine_library` with enrichment_source = "haiku"

### Cost & Quality Guardrails

- [ ] **COST-01**: Monthly API spend tracked per provider (anthropic, google) in Supabase `api_spend` table
- [ ] **COST-02**: Monthly soft cap: $50 Claude, $20 Gemini — alerts sent to MANAGER_EMAIL at 80% threshold
- [ ] **COST-03**: Per-restaurant cost cap: if single restaurant extraction exceeds $2.00, stop and alert
- [ ] **QUAL-01**: Human review queue: wines with completeness < 0.5 surfaced in dashboard for correction
- [ ] **QUAL-02**: Extraction accuracy tracked: per-field acceptance rate from human corrections

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
| CLVS-01 | Phase 1 | Pending |
| CLVS-02 | Phase 1 | Pending |
| CLVS-03 | Phase 1 | Pending |
| CLVS-04 | Phase 1 | Pending |
| CLVS-05 | Phase 1 | Pending |
| CLVS-06 | Phase 1 | Pending |
| CLVS-07 | Phase 1 | Pending |
| GMFL-01 | Phase 2 | Pending |
| GMFL-02 | Phase 2 | Pending |
| GMFL-03 | Phase 2 | Pending |
| GMFL-04 | Phase 2 | Pending |
| GMFL-05 | Phase 2 | Pending |
| YOLO-01 | Phase 3 | Pending |
| YOLO-02 | Phase 3 | Pending |
| YOLO-03 | Phase 3 | Pending |
| YOLO-04 | Phase 3 | Pending |
| YOLO-05 | Phase 3 | Pending |
| HAIKU-01 | Phase 4 | Pending |
| HAIKU-02 | Phase 4 | Pending |
| HAIKU-03 | Phase 4 | Pending |
| HAIKU-04 | Phase 4 | Pending |
| HAIKU-05 | Phase 4 | Pending |
| COST-01 | Phase 5 | Pending |
| COST-02 | Phase 5 | Pending |
| COST-03 | Phase 5 | Pending |
| QUAL-01 | Phase 5 | Pending |
| QUAL-02 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-04-01 after architecture pivot*
