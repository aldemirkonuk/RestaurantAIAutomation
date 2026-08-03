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

**Coverage (v1.0):**
- v1 requirements (Phases 1–6): 34 total — 34 complete ✓
- v1.5 requirements (Phases 7–11): 45 total — 45 complete ✓
- v1.0 expansion (Phases 12–17): 11 total — 11 complete ✓
- v1.0 grand total: 90 requirements — all complete ✓

---

## v2.0 Requirements — Backend Kitchen Architecture

**Defined:** 2026-04-09
**Core Value:** The system is so reliable that an average agent performs flawlessly because the infrastructure carries it.

### Infrastructure — BaseAgent Upgrade (Phase 18)

- [x] **INFRA-01**: BaseAgent provides idempotency mixin — `_check_idempotency(message_id)` checks Redis/PG `idempotency_keys` table, skips if already processed, `_mark_processed()` after success. Fails open (process twice rather than drop).
- [x] **INFRA-02**: BaseAgent provides `log_decision()` method — persists agent decisions to `decision_log` table with agent_name, decision_type, inputs, reasoning, output, confidence, correlation_id, restaurant_id.
- [x] **INFRA-03**: Structured JSON logging — all agent logs emitted as JSON with timestamp, level, logger, message, agent_name, correlation_id. `JSONFormatter` class in utils/logger.py.
- [x] **INFRA-04**: Distributed tracing — correlation_id extracted from incoming messages, propagated to all outgoing publishes. `self._current_correlation_id` set before every `process_message` call.
- [x] **INFRA-05**: Dead letter queue — after all retries exhausted, `_send_to_dlq()` persists failed message to `dead_letter_queue` table with agent_name, original exchange/routing_key, message body, error, retry_count.
- [x] **INFRA-06**: Saga state helpers — `start_saga(saga_type, context, deadline_minutes)`, `advance_saga(saga_id, step, compensation)`, `complete_saga(saga_id)`, `compensate_saga(saga_id, error)`. Backed by `saga_state` PG table.
- [x] **INFRA-07**: Transactional outbox table — `outbox` table (event_type, exchange, routing_key, payload, published boolean). Background publisher worker polls unpublished rows and dispatches to RabbitMQ.
- [x] **INFRA-08**: Event store table — append-only `event_store` table (aggregate_type, aggregate_id, event_type, payload, sequence_number, correlation_id). Unique constraint on (aggregate_type, aggregate_id, sequence_number).

### Infrastructure — Database Tables (Phase 18)

- [x] **INFRA-DB-01**: `idempotency_keys` table created via Supabase migration — message_id (PK), agent_name, processed_at, result (JSONB), expires_at (default NOW + 24h). Index on expires_at for cleanup.
- [x] **INFRA-DB-02**: `decision_log` table created — id (UUID PK), agent_name, decision_type, inputs (JSONB), reasoning (JSONB), output (JSONB), confidence (FLOAT), correlation_id, restaurant_id (FK), created_at. Indexes on (agent_name, created_at DESC) and (correlation_id).
- [x] **INFRA-DB-03**: `outbox` table created — id (BIGSERIAL PK), event_type, exchange, routing_key, payload (JSONB), published (BOOLEAN default FALSE), created_at, published_at. Partial index on (published, created_at) WHERE published = FALSE.
- [x] **INFRA-DB-04**: `saga_state` table created — saga_id (UUID PK), saga_type, current_step, status (default 'IN_PROGRESS'), context (JSONB), compensations (JSONB array), started_at, updated_at, deadline_at, error. Index on (status, saga_type).
- [x] **INFRA-DB-05**: `event_store` table created — event_id (UUID PK), aggregate_type, aggregate_id (UUID), event_type, payload (JSONB), sequence_number (BIGINT), correlation_id, created_at. Unique on (aggregate_type, aggregate_id, sequence_number). Index on (aggregate_type, aggregate_id, sequence_number).
- [x] **INFRA-DB-06**: `dead_letter_queue` table created — id (BIGSERIAL PK), agent_name, original_exchange, original_routing_key, message (JSONB), error, retry_count (INT), created_at, resolved_at, resolved_by.

### Bug Fixes — Wave 1 Agents (Phase 19)

- [x] **BUG-01**: InventoryEngine race condition fixed — `update_inventory_stock` uses optimistic locking with `WHERE version = expected_version` and `SET version = version + 1`. Retry on conflict.
- [x] **BUG-02**: InventoryEngine dead code removed — `update_queue` and `batch_size` deleted from __init__.
- [x] **BUG-03**: POSIntegrationAgent `hmac.new` replaced with `hmac.HMAC` (deprecated API fix).
- [x] **BUG-04**: POSIntegrationAgent wine detection upgraded — Toast menu category matching replaces keyword-only detection. Fallback to keyword for uncategorized items.
- [x] **BUG-05**: POSIntegrationAgent signature verification fixed — uses raw payload bytes, not re-serialized `json.dumps(webhook_data)`.
- [x] **BUG-06**: POSIntegrationAgent refund logic separated from void logic — refunds handle partial amounts and credit tracking.
- [x] **BUG-07**: NotificationAgent rate limit counters persisted in Redis — `INCR wineops:ratelimit:{restaurant_id}:{channel}:hour` with TTL 3600. Survives restarts.
- [x] **BUG-08**: NotificationAgent batch processor task reference stored — `self._batch_task = asyncio.create_task(...)` and monitored in health check.
- [x] **BUG-09**: ReportingAgent `self.db` → `self.database` fix — prevents runtime crash on report generation.
- [x] **BUG-10**: ReportingAgent SMS `channels_used.append("sms")` moved inside if-block — cosmetic fix for accurate reporting.
- [x] **BUG-11**: ReportingAgent real inventory + sales reports implemented — queries actual inventory data with stock levels, thresholds, wine details; aggregates pos_webhook_logs for sales.
- [x] **BUG-12**: ReportingAgent PDF export implemented — HTML template → PDF via weasyprint with restaurant branding.

### Hardening — Wave 1 Level 4 (Phase 20)

- [x] **HARD-01**: InventoryEngine at Level 4 — idempotency via BaseAgent, decision logging for every stock state change, event sourcing (aggregate_type='inventory'), optimistic locking. 15+ integration tests: happy path, idempotency, concurrent updates, delivery, manual correction, edge cases.
- [x] **HARD-02**: POSIntegrationAgent at Level 4 — webhook deduplication by (order_guid + event_type), idempotency via BaseAgent, decision logging for wine matching, Toast API polling fallback as saga. 15+ integration tests: webhook happy path, duplicate, non-wine, signature, wine matching, polling fallback.
- [x] **HARD-03**: NotificationAgent at Level 4 — delivery tracking table (notification_deliveries), idempotency by event_id, batch processor health monitoring, DLQ for failed notifications. 10+ integration tests: alert routing, rate limiting, delivery tracking, idempotency, channel fallback.
- [x] **HARD-04**: ReportingAgent at Level 4 — idempotency keyed by (restaurant_id + report_type + date), decision logging, real report generation, PDF export via weasyprint. 10+ integration tests: scheduled reports, on-demand, idempotency, timezone, PDF output.

### Golden Path E2E (Phase 21)

- [ ] **E2E-v2-01**: Toast webhook received → POSIntegrationAgent processes → publishes POSSaleCompleted event to `pos.events` exchange with `pos.sale.completed` routing key.
- [ ] **E2E-v2-02**: POSSaleCompleted event → InventoryEngine subscribes → stock decremented in `inventory_stock` table → publishes `stock.state.changed` event.
- [ ] **E2E-v2-03**: Stock below threshold → `stock.state.changed` event → NotificationAgent subscribes → manager receives SMS and/or email alert within 30 seconds.
- [ ] **E2E-v2-04**: All stock events → ReportingAgent subscribes → dashboard data updated in real-time for inventory reports.
- [ ] **E2E-v2-05**: Full golden path integration test with real Toast API data from friend's restaurant — historical order import + live webhook forwarding via ngrok.
- [ ] **E2E-v2-06**: Chaos testing — kill agent mid-flow → restart → verify saga resumes. RabbitMQ disconnect → reconnect → verify buffered messages processed. Supabase 503 → circuit breaker trips → recovery after timeout. Malformed webhook → DLQ capture. 100 concurrent webhooks → no race conditions.

### Observability (Phase 22)

- [x] **OBS-01**: Sentry SDK integrated — `sentry_sdk.init()` in main.py with `traces_sample_rate=0.1`. Per-agent Sentry tags. Alert rules: error rate > 5%, response time > 10s.
- [x] **OBS-02**: Per-agent health dashboard — `GET /api/v1/health/agents` returns all agent health statuses. `GET /api/v1/health/agents/{name}` returns detailed metrics. React admin page at /admin/health.
- [x] **OBS-03**: Structured JSON log aggregation — all agents emit JSON logs, viewable via `GET /api/v1/metrics` with messages processed, error rates, DLQ size, active sagas, circuit breaker states.
- [ ] **OBS-04**: Business metrics tracked — stock updates/second, notification delivery rate, report generation time, webhook processing latency.

### Deployment (Phase 22)

- [x] **DEP-01**: Frontend deployed to Vercel — auto-deploy from git, free tier.
- [x] **DEP-02**: Supabase Cloud database — all v1.0 + v2.0 migrations applied, production data accessible.
- [x] **DEP-03**: Python agent-orchestrator service on Railway or Fly.io — Dockerfile, uvicorn, $5-10/mo.
- [x] **DEP-04**: RabbitMQ on CloudAMQP — free tier instance configured.
- [x] **DEP-05**: Redis on Upstash — free tier with AOF persistence.
- [x] **DEP-06**: Toast API credentials configured — friend's restaurant Toast webhook URL pointed to production endpoint.

### Production E2E (Phase 25)

- [ ] **TEST-PROD-01**: Wave A — API contract: all `/api/v1/` endpoints on the live Railway agent-orchestrator return expected HTTP status codes with valid JWT (`Authorization: Bearer`) or `X-Admin-Key` header. Public `/health` returns 200. Auth-protected routes return 401 without credentials. Zero 500 errors.
- [ ] **TEST-PROD-02**: Wave B — Agent health: `GET /api/v1/health/agents` with `X-Admin-Key` returns all 9 agents (pos_integration, buffer_manager, inventory_engine, inequality_detector, state_invariant_enforcer, notification, procurement, calendar, reporting) with at least 7 showing `healthy: true` or `status: "Active"`.
- [ ] **TEST-PROD-03**: Wave C — Agent trigger: each of the 9 agents can receive a test RabbitMQ message published to its routing key; the agent remains healthy (does not crash or enter error state) within 5 seconds of receiving the message.
- [ ] **TEST-PROD-04**: Wave D — Toast pipeline: a HMAC-signed test Toast webhook delivered to `POST /api/v1/pos/webhook/toast` flows through POSIntegrationAgent → InventoryEngine → NotificationAgent using `restaurant_id: "e2e-test-restaurant"` staging data. Supabase records created with deterministic IDs, verified, and torn down in session teardown.
- [ ] **TEST-PROD-05**: Wave E — Gmail pipeline: a low-stock alert triggered via the NotificationAgent produces a `notification_deliveries` row in Supabase with `channel: "email"` and `status: "sent"` or `"delivered"` within 30 seconds.
- [ ] **TEST-PROD-06**: Wave F — Frontend smoke (Playwright headless Chromium against production Vercel URL): login redirect succeeds, `/admin/health` displays ≥7 agent cards with Active status, dashboard loads without JS console errors in < 5s, one `/studio` write-flow completes and is torn down.
- [ ] **TEST-PROD-07**: Wave G — Calendar: a `calendar_events` row with `event_date = today + 7 days` and `id = "e2e-cal-001"` is upserted into Supabase; a corresponding scheduled reminder record is verified to exist — confirming CalendarAgent will dispatch the T-7 day reminder without needing to wait 7 days.
- [ ] **TEST-PROD-08**: All 7 wave test results exported as JUnit XML via `pytest --junitxml=test-results/wave_{X}.xml` and uploaded as GitHub Actions artifacts. Wave F Playwright JUnit XML also captured and uploaded.
- [ ] **TEST-PROD-09**: Every production E2E test failure fires a `sentry_sdk.capture_message` call from `conftest_prod.py` with tags `{"e2e-failure": "true", "deploy-gate": "<true|false>"}` and `level="error"`. Sentry initialized in the test runner process (separate from the FastAPI app process) using `SENTRY_DSN` env var.
- [ ] **TEST-PROD-10**: Full test suite (Waves A–G) completes in < 10 minutes. Waves B+C run in parallel via `pytest -n 2`. GitHub Actions `timeout-minutes: 15` hard cap. `PYTEST_RUNNING` is NEVER set in the e2e-prod.yml CI environment (would disable Sentry).
- [ ] **TEST-PROD-11**: Nightly cron at `0 2 * * *` UTC triggers `e2e-prod.yml` (observability-only mode). Production deploys trigger the same workflow via Vercel deploy hook → GitHub Actions `workflow_dispatch` (blocking mode: failure → Sentry `deploy-gate: true` tag + PR comment if `pr_number` input is provided).
- [ ] **TEST-PROD-12**: All test writes use `restaurant_id: "e2e-test-restaurant"` (permanent anchor). Records created with deterministic `e2e-*` IDs and Supabase upserts for idempotency. Session teardown deletes all rows matching `restaurant_id = 'e2e-test-restaurant' AND id LIKE 'e2e-%'` (except the anchor record itself). Teardown failures reported to Sentry with tag `e2e-orphan: true` — teardown errors NEVER raise exceptions or fail tests.

## Testing Campaign Requirements (Phases 36–43)

**Defined:** 2026-07-27 — locked via 3 rounds of user Q&A. Testing-first foundation before Waves 2-6.

### Testing Foundation (Phase 36)

- [x] **TFND-01**: `.planning/testing/FUNCTIONALITY-REGISTRY.md` maps every api-gateway module, web page, orchestrator agent, and database domain to exactly one of 11 functionality groups
- [x] **TFND-02**: T0–T4 coverage rubric defined (T0 untested → T4 ground-truth/golden-set verified), mirroring the agent Level system
- [x] **TFND-03**: Existing-test inventory: every spec/pytest/Playwright file catalogued (group, runs?, passes?) — kept as-is, built around
- [x] **TFND-04**: `.planning/testing/TESTING-SCORECARD.md` initialized with baseline score + evidence per group
- [x] **TFND-05**: GitHub Actions: unit + integration on push, E2E nightly (extends Phase 25 e2e-prod.yml patterns)
- [x] **TFND-06**: Synthetic tenant isolation: `sim-*` restaurant_id convention, RLS-safe seeding, idempotent teardown

### Synthetic Restaurant Engine (Phase 37)

- [x] **SYNTH-01**: Parameterized generator: cuisine, size, wine-program depth, sales volume, price tier, ordering rhythm → full restaurant profile
- [x] **SYNTH-02**: Menus sourced from real web menus (reuse v1.0 crawler/extraction) — real SKU diversity across archetypes
- [x] **SYNTH-03**: Generated restaurant seeded into cloud Supabase: org, restaurant, team (owner/manager/staff), menu, opening inventory
- [x] **SYNTH-04**: Ground-truth ledger records every generated fact in queryable form — the oracle for analytics assertions
- [x] **SYNTH-05**: ≥ 5 distinct archetypes live (fine dining, bistro, high-volume bar, cafe, Turkish restaurant clone)

### SimPOS Provider & Simulator (Phase 38)

- [ ] **SIMPOS-01**: SimPOS registered in pos-hub provider registry, emitting canonical checks through the standard ingestion pipeline
- [ ] **SIMPOS-02**: Simulator emits realistic order streams from restaurant profile distributions across simulated days
- [ ] **SIMPOS-03**: Accelerated controllable clock: configurable speed, pause, step, jump-to-day
- [ ] **SIMPOS-04**: Control panel: pick restaurant → view menu → click items → order fires through pos-hub
- [ ] **SIMPOS-05**: Control panel: start/stop/speed + chaos injection (burst, void, refund, duplicate, malformed)
- [ ] **SIMPOS-06**: Deployed on Railway; events reach deployed api-gateway like a real POS
- [ ] **SIMPOS-07**: Every emitted event mirrored to the ground-truth ledger

### Breadth Passes (Phases 39–40)

- [ ] **BRD-01**: Identity & Access ≥ T2 — automated suites + manual checklist
- [ ] **BRD-02**: Catalog & Extraction ≥ T2 — automated suites + manual checklist
- [ ] **BRD-03**: Inventory Operations ≥ T2 — automated suites + manual checklist
- [ ] **BRD-04**: POS & Sales Ingestion ≥ T2 — automated suites + manual checklist
- [ ] **BRD-05**: Procurement & Vendors ≥ T2 — automated suites + manual checklist
- [ ] **BRD-06**: Communications & Email Intelligence ≥ T2 — automated suites (LLM mocked) + manual checklist
- [ ] **BRD-07**: Calendar & Scheduling ≥ T2 — automated suites + manual checklist
- [ ] **BRD-08**: Notifications & Alerts ≥ T2 — automated suites + manual checklist

### Analytics & Insights Truth Suite (Phase 41)

- [ ] **TRUTH-01**: Every dashboard KPI matches the ground-truth oracle exactly for sim tenants after N simulated days
- [ ] **TRUTH-02**: Reports (inventory, sales, PDF exports) match oracle line-by-line
- [ ] **TRUTH-03**: Analytic-answer question bank (≥ 25 questions) verified numerically exact against oracle
- [ ] **TRUTH-04**: Drift detection: full simulated month incl. chaos → `stock_live` == oracle stock (zero silent leakage)
- [ ] **TRUTH-05**: Failures emit expected-vs-actual diffs as CI artifacts; Analytics group reaches T4

### AI Eval Suites (Phase 42)

- [ ] **EVAL-AI-01**: Wine extraction golden set (≥ 30 labeled menus) scored per field; thresholds set from baseline
- [ ] **EVAL-AI-02**: Email intelligence golden set scored on classification + promo extraction accuracy
- [ ] **EVAL-AI-03**: Agent decision evals (procurement suggestions, threshold alerts) scored against sim scenarios with known answers
- [ ] **EVAL-AI-04**: Analytic-answer eval bank shares the eval harness (unified scoring + history)
- [ ] **EVAL-AI-05**: Weekly CI eval runs with cost caps + score history; regressions flag the scorecard

### E2E Journeys & Final Scorecard (Phase 43)

- [ ] **JRNY-01**: Playwright journeys green on cloud stack: onboard → menu import → inventory → sim sale → alert → report + all-pages nav smoke
- [ ] **JRNY-02**: Scanner flows harnessed + manual checklist executed by user
- [ ] **JRNY-03**: Admin/health surfaces verified against live chaos injection
- [ ] **JRNY-04**: User manual pathway passes (web, scanner, admin) captured with structured feedback + triage
- [ ] **JRNY-05**: Final scorecard: all 11 groups ≥ T2, Analytics T4; sub-T2 gaps promoted to backlog

**Coverage (Testing Campaign):**
- Foundation (Phase 36): 6 — TFND-01..06
- Synthetic engine (Phase 37): 5 — SYNTH-01..05
- SimPOS + simulator (Phase 38): 7 — SIMPOS-01..07
- Breadth passes (Phases 39–40): 8 — BRD-01..08
- Truth suite (Phase 41): 5 — TRUTH-01..05
- AI evals (Phase 42): 5 — EVAL-AI-01..05
- Journeys + scorecard (Phase 43): 5 — JRNY-01..05
- Campaign total: 41 requirements mapped to 8 phases
- Unmapped: 0 ✓

---

**Coverage (v2.0):**
- Infrastructure (Phase 18): 14 requirements — INFRA-01..08, INFRA-DB-01..06
- Bug fixes (Phase 19): 12 requirements — BUG-01..12
- Hardening (Phase 20): 4 requirements — HARD-01..04
- Golden path E2E (Phase 21): 6 requirements — E2E-v2-01..06
- Observability + Deployment (Phase 22): 10 requirements — OBS-01..04, DEP-01..06
- Production E2E (Phase 25): 12 requirements — TEST-PROD-01..12
- v2.0 total: 58 requirements mapped to 6 phases
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-07-27 — Testing Campaign TFND/SYNTH/SIMPOS/BRD/TRUTH/EVAL-AI/JRNY added (41 new requirements, Phases 36–43)*
