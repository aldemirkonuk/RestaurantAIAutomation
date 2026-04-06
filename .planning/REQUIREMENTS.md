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

### Full-Field Extraction & Per-Field Confidence (Phase 7)

- [ ] **FCONF-01**: Claude Vision EXTRACTION_PROMPT expanded to request 18 fields (wine_name, producer, vintage, primary_type, color, country, region, sub_region, appellation, grape_variety, alcohol_pct, price_bottle, price_glass, tasting_notes, description, section_name, bin_number, sweetness_level) with per-field confidence (0.0–1.0) and source ("visible" | "inferred")
- [ ] **FCONF-02**: Haiku EnrichmentResult expanded to 20+ fields including producer, region, sub_region, appellation, country, grape_variety, color, primary_type, sweetness_level, food_pairing, producer_bio, tasting_notes, alcohol_pct, description + 6 JSONB enrichments (grape_family, wine_structure, sensory_profile, practical_attributes, region_hierarchy, critic_scores stub), each with per-field confidence and source="knowledge"
- [ ] **FCONF-03**: `field_confidence` JSONB column added to master_wine_library_submissions storing per-field `{value, confidence, source}` for every extracted/enriched field
- [ ] **FCONF-04**: 3-tier confidence threshold enforced at persist time: confidence < 0.5 → field value set to NULL (rejected); 0.5–0.8 → field persisted AND row inserted into `field_review_queue` with status="pending"; > 0.8 → field auto-accepted, no review flag
- [ ] **FCONF-05**: `field_review_queue` table created: id, submission_id, field_name, current_value, confidence, source, status (pending|approved|corrected|rejected), reviewer, reviewed_at
- [ ] **FCONF-06**: `GET /api/v1/quality/review-queue` upgraded to return field-level review items grouped by wine — only fields needing review, not entire records
- [ ] **FCONF-07**: `PATCH /api/v1/quality/review-queue/{id}` accepts per-field corrections: `{"corrections": {"sub_region": "...", "appellation": "..."}}`, logs each correction to field_corrections table
- [ ] **FCONF-08**: DB migration adds 6 JSONB columns to master_wine_library: grape_family, wine_structure, sensory_profile, practical_attributes, region_hierarchy, critic_scores
- [ ] **FCONF-09**: `field_calibration` table created: field_name, confidence_bin (e.g., "0.7-0.8"), total_reviewed, total_correct, actual_accuracy, measured_at — populated by calibration task
- [ ] **FCONF-10**: `confidence_thresholds` table created: field_name, review_threshold (default 0.5), accept_threshold (default 0.8), last_calibrated_at — auto-adjusted by calibration loop
- [ ] **FCONF-11**: Calibration Celery periodic task (daily): reads field_corrections for all reviewed wines, computes actual accuracy per field per confidence bin, adjusts thresholds in confidence_thresholds table to maintain ≥ 0.95 accuracy; `GET /api/v1/quality/calibration` returns current thresholds and accuracy stats
- [ ] **FCONF-12**: E2E test: extract a known menu → verify field_confidence JSONB populated for 18+ fields → verify fields routed correctly through 3-tier threshold → verify review queue contains only sub-threshold fields

### Web Search Verification & Deep Enrichment (Phase 8)

- [ ] **WSRCH-01**: `web_verify_task` Celery background task: accepts wine_id, constructs search query from producer + wine_name + vintage, executes web search via Serper or Tavily API
- [ ] **WSRCH-02**: Search results (top 5) parsed by Gemini Flash with structured extraction prompt matching master_wine_library schema fields
- [ ] **WSRCH-03**: Concordance engine compares web-verified fields against existing field_confidence: concordance → boost confidence to 0.95+ with verification_source="web_verified"; contradiction → flag for review with verification_status="contradicted" and both values shown
- [ ] **WSRCH-04**: `producers` knowledge graph table created: id, name, normalized_name, country, region, sub_region, appellation, founding_year, winemaker_name, production_volume_cases, certifications JSONB, website_url, portfolio JSONB, verified_at, verification_sources TEXT[]
- [ ] **WSRCH-05**: Producer graph lookup runs BEFORE web search — if producer already verified in `producers` table, instant enrichment applied (skip web search API call)
- [ ] **WSRCH-06**: `verification_status` added to field_confidence JSONB entries: "unverified" | "web_verified" | "contradicted" | "producer_graph" — tracks provenance of each field value
- [ ] **WSRCH-07**: Tiered search strategy: only web-search wines where (a) any field confidence < 0.8, OR (b) producer not in knowledge graph, OR (c) wine never web-verified — skip already-verified wines
- [ ] **WSRCH-08**: Daily web search budget cap: configurable in settings (default $5/day), enforced before executing search tasks; tasks queued but paused when cap reached
- [ ] **WSRCH-09**: E2E test: submit wine with low-confidence region → web_verify_task searches → field_confidence updated with verification_source and boosted confidence

### Wine Ontology, Taxonomy & Cross-Validation (Phase 9)

- [ ] **ONTO-01**: `wine_regions` table created with tree structure (country → region → sub_region → appellation → commune), seeded with ≥ 2,000 entries covering all major global wine regions; fields: id, name, level, parent_id, country_code, classification_system
- [ ] **ONTO-02**: `grape_varieties` table created with ≥ 400 varieties; fields: id, name, color, family, aliases TEXT[], typical_regions TEXT[], typical_blending_partners TEXT[]; alias normalization (Shiraz → Syrah) applied at enrichment time
- [ ] **ONTO-03**: `appellation_rules` table created with grape requirements, min aging months, min vintage release delay, allowed colors, classification levels for ≥ 100 major appellations (Barolo, Chianti Classico, Champagne, Burgundy Grand Cru, etc.)
- [ ] **ONTO-04**: `vintage_rules` table encodes per-appellation/region release-delay rules for vintage plausibility checks (e.g., Barolo 2024 cannot exist in 2026; Brunello Riserva requires 5 years)
- [ ] **ONTO-05**: Cross-validation engine runs post-enrichment on every wine: checks region↔country consistency, grape↔appellation compatibility, vintage↔appellation plausibility, color↔grape consistency
- [ ] **ONTO-06**: `ontology_validation` JSONB stored per wine record: checks_passed, checks_failed, checks_total, failures array with check name, expected value, found value, severity (critical|warning|info)
- [ ] **ONTO-07**: Critical ontology failures (wrong country, impossible grape-appellation) auto-flag wine for review regardless of field confidence score
- [ ] **ONTO-08**: Deterministic auto-fills from ontology (appellation → country, appellation → region, grape → color) applied with confidence=1.0 and source="ontology" — these are facts, not inferences

### Critic Scores & Pricing Intelligence (Phase 10)

- [ ] **CRIT-01**: `score_lookup_task` Celery background task: searches for critic scores per wine+vintage across Wine Advocate, Wine Spectator, Vivino, Decanter, JancisRobinson.com (≥ 3 sources attempted per wine)
- [ ] **CRIT-02**: Scores normalized to 0–100 scale (Vivino 5-point → 100-point, JR 20-point → 100-point) and stored in `critic_scores` JSONB with source name, raw score, normalized score, reviewer name, review date
- [ ] **CRIT-03**: Composite score computed as weighted average (WA 30%, WS 25%, Vivino 20%, Decanter 15%, JR 10%) when ≥ 2 sources available; stored as `composite` key in critic_scores JSONB
- [ ] **CRIT-04**: `retail_price_avg` column populated from Wine-Searcher average market price for wines with valid vintage; stored on master_wine_library
- [ ] **CRIT-05**: `markup_ratio` computed per restaurant_inventory entry: menu_price / retail_price_avg; classified as "value" (< 1.5x), "standard" (1.5–2.5x), "premium" (2.5–4x), "luxury_markup" (> 4x)
- [ ] **CRIT-06**: Price anomaly detection: markup_ratio > 5x or < 0.8x auto-flagged for review (likely data error or exceptional pricing)
- [ ] **CRIT-07**: `GET /api/v1/analytics/wine/{id}/scores` returns aggregated critic scores, composite score, retail price, and markup ratio for a wine

### Temporal Menu Intelligence & Analytics (Phase 11)

- [ ] **TEMP-01**: `crawl_schedule` table: restaurant_id, crawl_frequency (weekly|biweekly|monthly), last_crawled_at, next_crawl_at, status (active|paused|error) — configurable per restaurant
- [ ] **TEMP-02**: `scheduled_recrawl_task` Celery beat task runs daily, selects restaurants where next_crawl_at ≤ now(), triggers WebCrawlerService.crawl_restaurant() for each, updates last_crawled_at and next_crawl_at
- [ ] **TEMP-03**: Menu diff engine: after re-crawl, compares new wine list against previous crawl via signature_hash — detects additions (new hash), removals (missing hash), price changes (same hash, different price_reference)
- [ ] **TEMP-04**: `menu_changes` table: restaurant_id, wine_signature_hash, change_type (added|removed|price_change), old_value, new_value, detected_at; tracks full menu evolution history
- [ ] **TEMP-05**: `wine_popularity` materialized view or computed query: per wine, count of distinct restaurants currently carrying it, computed from latest crawl per restaurant
- [ ] **TEMP-06**: `trending_wines` computation: wines with highest positive/negative delta in restaurant carrying count over configurable windows (30/60/90 days)
- [ ] **TEMP-07**: `GET /api/v1/analytics/trends?metro=chicago&period=90d` returns regional trend data: top added wines, top removed wines, category distribution shifts, grape variety trends, region popularity changes
- [ ] **TEMP-08**: `GET /api/v1/analytics/wine/{id}/timeline` returns full wine lifecycle: first_seen_at, last_seen_at, restaurants_currently_carrying, price_history across restaurants, menu_changes history

### Extensive Gap-Filling Research Agent (Phase 12)

- [ ] **RSCH-01**: `research_agent_task` Celery background task processes eligible wine submissions: records where any priority field has confidence < 0.8 AND `last_research_run_at` is NULL or older than 7 days. On first full batch run, `null_rate_after` < `null_rate_before` by ≥ 20% (measured in `research_run_stats`).
- [ ] **RSCH-02**: Every auto-promoted field fill has ≥ 1 row in `evidence_citations` with non-null `source_url`, `snippet`, and `retrieved_at`. Auto-promotion without a citation record is not permitted.
- [ ] **RSCH-03**: `independent_corroboration_rate` ≥ 60%: fraction of auto-promoted fills where `evidence_citations.corroboration_count` ≥ 2 OR `evidence_citations.source_tier` = 'A'. Measurable via `GET /api/v1/research/metrics` under `evidence_hygiene`.
- [ ] **RSCH-04**: `fetch_verify_pass_rate` ≥ 80%: fraction of evidence citations where `fetch_verified = true` (proposed value confirmed present on live page at retrieval time). Tiered fetch-verify: aiohttp first, Playwright fallback for empty/minimal responses.
- [ ] **RSCH-05**: Conflict detection enforced: when ≥ 2 evidence-backed candidates propose non-synonym values for the same field, the field is written to `conflict_candidates` JSONB on `master_wine_library_submissions` and NOT written to `field_confidence`. Conflicted fields surface in `GET /api/v1/research/conflicts`.
- [ ] **RSCH-06**: `human_override_rate` computed and surfaced: fraction of research-agent-promoted values later corrected in `field_corrections` by a human reviewer. Appears in `GET /api/v1/research/metrics` under `quality`. Leading indicator of silent wrong fills.
- [ ] **RSCH-07**: `cost_per_filled_field` surfaced in `GET /api/v1/research/metrics` under `throughput_cost`. Daily research budget cap (`RESEARCH_DAILY_BUDGET_USD`, default $5.00) enforced before each task run. Per-record ceiling (`RESEARCH_MAX_COST_PER_RECORD_USD`, default $0.25) enforced mid-task; task aborts gracefully with `status = partial` if exceeded.
- [ ] **RSCH-08**: `attempts_per_filled_field` bounded by stop rule: `call_counter` incremented before every Serper, Gemini, or fetch-verify call; task aborts current record when `call_counter >= RESEARCH_MAX_CALLS_PER_RECORD` (default 8). `attempts` column in `research_run_stats` records actual call count per record.
- [ ] **RSCH-09**: `regression_rate` = 0% enforced mechanically: `merge_field_confidence()` (from Phase 7 `field_confidence.py`) called before every `field_confidence` write, refusing to overwrite an existing entry with lower confidence. `check_regression_guard()` called explicitly before each merge with result logged.
- [ ] **RSCH-10**: `GET /api/v1/research/metrics` returns all 5 metric categories in a single JSON response: `gap_closure` (null_rate_before/after, fields_filled distribution, time_to_fill), `quality` (promotion_rate, human_override_rate, conflict_rate, source_tier_mix), `evidence_hygiene` (citation_completeness, independent_corroboration_rate, fetch_verify_pass_rate), `throughput_cost` (records_per_day, cost_per_filled_field, attempts_per_filled_field), `safety` (pii_policy_flags, regression_rate).
- [ ] **RSCH-11**: E2E test: insert a wine submission with 5 NULL priority fields → call `research_agent_task(submission_id)` with mocked Serper + Gemini → assert ≥ 3 `evidence_citations` rows exist with url + snippet + retrieved_at → assert `field_confidence` updated on submission → assert `GET /api/v1/research/metrics` returns non-zero `evidence_hygiene.citation_completeness`.

## v2 Requirements (Future)

### Advanced Extraction

- **ADV-01**: Fine-tuned Claude Haiku model on WineOps extraction data (when >10K labeled samples)
- **ADV-02**: Multi-modal menu understanding: extract from handwritten specials boards
- **ADV-03**: Vintage verification against wine database (Wine-Searcher API or similar) — partially addressed by Phase 9 vintage_rules

### Crawler Enhancements

- **CRAWL-01**: OpenTable discovery → auto-queue restaurant websites for crawling
- **CRAWL-02**: Change detection: re-crawl only when restaurant website changes — partially addressed by Phase 11 menu diff engine
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
| FCONF-01 | Phase 7 | Planned |
| FCONF-02 | Phase 7 | Planned |
| FCONF-03 | Phase 7 | Planned |
| FCONF-04 | Phase 7 | Planned |
| FCONF-05 | Phase 7 | Planned |
| FCONF-06 | Phase 7 | Planned |
| FCONF-07 | Phase 7 | Planned |
| FCONF-08 | Phase 7 | Planned |
| FCONF-09 | Phase 7 | Planned |
| FCONF-10 | Phase 7 | Planned |
| FCONF-11 | Phase 7 | Planned |
| FCONF-12 | Phase 7 | Planned |
| WSRCH-01 | Phase 8 | Planned |
| WSRCH-02 | Phase 8 | Planned |
| WSRCH-03 | Phase 8 | Planned |
| WSRCH-04 | Phase 8 | Planned |
| WSRCH-05 | Phase 8 | Planned |
| WSRCH-06 | Phase 8 | Planned |
| WSRCH-07 | Phase 8 | Planned |
| WSRCH-08 | Phase 8 | Planned |
| WSRCH-09 | Phase 8 | Planned |
| ONTO-01 | Phase 9 | Planned |
| ONTO-02 | Phase 9 | Planned |
| ONTO-03 | Phase 9 | Planned |
| ONTO-04 | Phase 9 | Planned |
| ONTO-05 | Phase 9 | Planned |
| ONTO-06 | Phase 9 | Planned |
| ONTO-07 | Phase 9 | Planned |
| ONTO-08 | Phase 9 | Planned |
| CRIT-01 | Phase 10 | Planned |
| CRIT-02 | Phase 10 | Planned |
| CRIT-03 | Phase 10 | Planned |
| CRIT-04 | Phase 10 | Planned |
| CRIT-05 | Phase 10 | Planned |
| CRIT-06 | Phase 10 | Planned |
| CRIT-07 | Phase 10 | Planned |
| TEMP-01 | Phase 11 | Planned |
| TEMP-02 | Phase 11 | Planned |
| TEMP-03 | Phase 11 | Planned |
| TEMP-04 | Phase 11 | Planned |
| TEMP-05 | Phase 11 | Planned |
| TEMP-06 | Phase 11 | Planned |
| TEMP-07 | Phase 11 | Planned |
| TEMP-08 | Phase 11 | Planned |
|| RSCH-01 | Phase 12 | Planned |
|| RSCH-02 | Phase 12 | Planned |
|| RSCH-03 | Phase 12 | Planned |
|| RSCH-04 | Phase 12 | Planned |
|| RSCH-05 | Phase 12 | Planned |
|| RSCH-06 | Phase 12 | Planned |
|| RSCH-07 | Phase 12 | Planned |
|| RSCH-08 | Phase 12 | Planned |
|| RSCH-09 | Phase 12 | Planned |
|| RSCH-10 | Phase 12 | Planned |
|| RSCH-11 | Phase 12 | Planned |

**Coverage:**
- v1 requirements (Phases 1–6): 34 total — 34 complete ✓
- v1.5 requirements (Phases 7–11): 45 total — 0 complete, 45 planned
- v2.0 requirements (Phase 12): 11 total — 0 complete, 11 planned
- Grand total: 90 requirements mapped to phases
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-04-06 — Phase 12 requirements added (RSCH-01..11); 11 new requirements*
*Previously: 2026-04-05 — Phases 7–11 requirements added (FCONF-01..12, WSRCH-01..09, ONTO-01..08, CRIT-01..07, TEMP-01..08); 45 new requirements across 5 phases*
