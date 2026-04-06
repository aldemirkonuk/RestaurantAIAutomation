# Roadmap: WineOps Hybrid Extraction Pipeline

## Overview

Eleven phases building the world's most sophisticated restaurant wine intelligence dataset. Phases 1–6 replaced the retired YOLO+Surya stack with a hybrid extraction pipeline. Phases 7–11 transform raw extraction into a verified, enriched, cross-referenced wine knowledge base with per-field confidence scoring, web-verified data, wine ontology validation, critic score aggregation, and temporal menu intelligence.

**Architecture pivot from:** YOLO 13-class → Surya OCR → local parser (mAP50 0.04 — retired 2026-03-31)
**Architecture pivot to:** Claude Vision (extraction) + Gemini Flash (crawling) + YOLO 2-class (preview) + Haiku (enrichment) + Web Search (verification) + Ontology (validation) + Temporal (intelligence)

## Phases

- [x] **Phase 1: Claude Vision Extraction Service** — Core extraction brain: PDF/photo → Claude Vision → structured wine JSON, with parallel page processing and cost tracking (completed 2026-04-01)
- [x] **Phase 2: Gemini Flash Crawler** — Background pre-seeding: web crawler sends HTML/PDF text to Gemini Flash, deduplicates against master library (completed 2026-04-02)
- [x] **Phase 3: YOLO 2-class Real-time Preview** — Wire 2-class best.pt into camera feed for visual box drawing only (not extraction) (completed 2026-04-03)
- [x] **Phase 4: Claude Haiku Enrichment** — Background enrichment of new wine records: region, country, grape_variety, producer_bio via Haiku (completed 2026-04-04)
- [x] **Phase 5: Cost & Quality Guardrails** — Monthly spend caps, per-extraction cost logging, human review queue for low-confidence wines (completed 2026-04-05)
- [x] **Phase 6: Image Menu Extraction via Claude Vision** — Detect image-embedded menus (ContentType.IMAGE_ONLY, HTML_MENU with 0 wines), screenshot via Playwright, extract via Claude Vision, persist through same dedup + JSONL pipeline (completed 2026-04-05)
- [ ] **Phase 7: Full-Field Extraction & Per-Field Confidence Framework** — Expand Vision extraction to 18+ fields, Haiku enrichment to 20+ fields, add per-field confidence scores with 3-tier threshold (reject < 0.5, review 0.5–0.8, accept > 0.8), field-level review queue, and calibration loop for 0.95 dataset-wide accuracy
- [ ] **Phase 8: Web Search Verification & Deep Enrichment** — Per-wine background web search agent: verify extracted data against Wine-Searcher/Vivino/producer sites, resolve contradictions, fill gaps with verified external data, build producer knowledge graph
- [ ] **Phase 9: Wine Ontology, Taxonomy & Cross-Validation** — Structured region hierarchy, grape family taxonomy, appellation classification rules, automated contradiction detection (e.g., "Barolo" + "France" = impossible), vintage plausibility checks
- [ ] **Phase 10: Critic Scores & Pricing Intelligence** — Aggregate critic ratings (Wine Advocate, Wine Spectator, Vivino, Decanter), retail price benchmarking via Wine-Searcher, restaurant markup calculation, price-tier classification with market context
- [ ] **Phase 11: Temporal Menu Intelligence & Analytics** — Periodic re-crawl scheduling, menu diff detection (additions/removals/price changes), cross-restaurant wine popularity tracking, regional trend analytics, wine availability signals

## Phase Details

### Phase 1: Claude Vision Extraction Service
**Goal**: Build `claude_vision_extractor.py` service that takes menu images (base64 or file path), sends each page to Claude Vision in parallel, returns structured wine JSON with field completeness scores. Wire into `POST /api/v1/onboarding/extract` endpoint. Persist results to Supabase.
**Depends on**: Nothing (first phase)
**Requirements**: CLVS-01, CLVS-02, CLVS-03, CLVS-04, CLVS-05, CLVS-06, CLVS-07
**Success Criteria** (what must be TRUE):
  1. `services/agent-orchestrator/services/claude_vision_extractor.py` exists and passes unit tests
  2. Given a real wine menu image, extraction returns ≥ 5 wines with wine_name, vintage, price_bottle populated
  3. 10-page menu extracted in < 10 seconds (parallel asyncio)
  4. Per-page cost logged: input_tokens + output_tokens → USD stored in result
  5. `POST /api/v1/onboarding/extract` endpoint returns 200 with wines array
  6. Wines persisted to Supabase `master_wine_library_submissions` table with scan_session_id
  7. Field completeness < 0.5 → wine flagged as `needs_review: true`
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — ClaudeVisionExtractor service: async parallel extraction engine + unit tests + requirements.txt fix (2026-04-01)
- [x] 01-02-PLAN.md — FastAPI endpoint + Supabase persistence: POST /api/v1/onboarding/extract wired to extractor and submissions table (completed 2026-04-01)

### Phase 2: Gemini Flash Crawler
**Goal**: Update `vlm_extraction_service.py` and `web_crawler.py` to use Gemini Flash (gemini-2.0-flash) for text/HTML extraction. Claude Vision is NOT used here — cost optimization. Add deduplication against master wine library.
**Depends on**: Phase 1 (master library structure)
**Requirements**: GMFL-01, GMFL-02, GMFL-03, GMFL-04, GMFL-05
**Success Criteria** (what must be TRUE):
  1. `vlm_extraction_service.py` uses `gemini-2.0-flash` for HTML/PDF text extraction (not Claude Vision)
  2. Crawler pipeline: URL → HTML DOM → Gemini Flash → structured wines → stored in restaurant_menus dataset
  3. Duplicate detection: wine_name + vintage + restaurant match → skip insert
  4. robots.txt respected; rate limiter enforced (default 100/day)
  5. Integration test: crawl one real restaurant URL and verify ≥ 1 wine extracted
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — GeminiFlashCrawlerExtractor: add AsyncClient + gemini-2.0-flash extractor class to vlm_extraction_service.py + GMFL-01 test scaffold (completed 2026-04-02)
- [x] 02-02-PLAN.md — web_crawler.py wiring: robots.txt gate, Gemini extraction call, JSONL persistence, deduplication (GMFL-02..05) (completed 2026-04-02)

### Phase 3: YOLO 2-class Real-time Preview
**Goal**: Wire `datasets/wine_menus_2class/runs/train2/weights/best.pt` into `menu_analyzer_agent.py` for camera-feed box drawing only. YOLO inference must return bounding boxes in <200ms. No extraction triggered from YOLO output.
**Depends on**: Nothing (can run in parallel with Phase 2)
**Requirements**: YOLO-01, YOLO-02, YOLO-03, YOLO-04, YOLO-05
**Success Criteria** (what must be TRUE):
  1. `menu_analyzer_agent.py` loads 2-class `best.pt` from `datasets/wine_menus_2class/runs/train2/weights/best.pt`
  2. YOLO inference on a 1280×720 frame returns boxes in < 200ms on CPU
  3. Boxes include class label (`wine_entry` or `section_header`) and confidence
  4. No code path exists where YOLO box detection triggers text extraction
  5. If model file missing: agent starts normally, logs warning, returns empty boxes
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — Settings patch + MenuAnalyzerAgent: 2-class class map, initialize() fix, detect_boxes() method, test scaffold (Wave 1)
- [x] 03-02-PLAN.md — scan_routes.py endpoint + main.py router registration + _get_yolo_model() fix (Wave 2)

### Phase 4: Claude Haiku Enrichment
**Goal**: After Claude Vision extracts wines in Phase 1, wines missing region/country/grape_variety are queued for async Haiku enrichment. Haiku infers these fields from wine_name + vintage. Skip if wine already exists in master library with full fields.
**Depends on**: Phase 1 (extraction), Supabase master_wine_library table
**Requirements**: HAIKU-01, HAIKU-02, HAIKU-03, HAIKU-04, HAIKU-05
**Success Criteria** (what must be TRUE):
  1. `services/agent-orchestrator/services/haiku_enrichment_service.py` exists
  2. Given wine_name + vintage, Haiku returns region, country, grape_variety, producer_bio
  3. Enrichment task runs as Celery background task (does not block POST /onboarding/extract response)
  4. Wines already in master library with complete fields: enrichment skipped (no API call)
  5. Enriched fields stored in `master_wine_library` with `enrichment_source = "haiku"`
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — HaikuEnrichmentService: pure service with two-table dedup check, Anthropic client, EnrichmentResult model, DB migration for producer_bio, 5 unit tests (Wave 1)
- [x] 04-02-PLAN.md — haiku_tasks.py Celery task + celery_app.py import update + onboarding_routes.py enrichment trigger (Wave 2)

### Phase 5: Cost & Quality Guardrails
**Goal**: Add spend tracking for all API calls (Claude + Gemini), monthly cap alerts, per-restaurant cost caps, and a human review queue for wines with completeness < 0.5.
**Depends on**: Phase 1, Phase 2, Phase 4 (all API-calling services)
**Requirements**: COST-01, COST-02, COST-03, QUAL-01, QUAL-02
**Success Criteria** (what must be TRUE):
  1. All Claude + Gemini API calls logged to Supabase `api_spend` table (provider, model, tokens, cost_usd, timestamp)
  2. Monthly spend sum query works: `SELECT SUM(cost_usd) FROM api_spend WHERE provider = 'anthropic'`
  3. Alert email sent to MANAGER_EMAIL when monthly spend crosses 80% of cap
  4. Single restaurant extraction > $2.00 → stops and sends alert
  5. Human review queue: `GET /api/v1/quality/review-queue` returns wines with `needs_review: true`
**Plans**: 4 plans

Plans:
- [x] 05-01-PLAN.md — DB migrations (api_spend, auto_blocked column, field_corrections) + SpendLogger service + settings.py patch (Wave 1) (completed 2026-04-05)
- [x] 05-02-PLAN.md — SpendLogger wired into 3 API-calling services + spend_tasks.py Celery beat hourly cap check (Wave 2) (completed 2026-04-05)
- [x] 05-03-PLAN.md — onboarding_routes.py: pre-flight $2.00 cap check (HTTP 402) + auto_blocked quality gate (Wave 2) (completed 2026-04-05)
- [x] 05-04-PLAN.md — quality_routes.py: GET review-queue + PATCH correction + field_corrections logging + auto-promotion (Wave 3) (completed 2026-04-05)

### Phase 6: Image Menu Extraction via Claude Vision
**Goal**: Detect restaurants whose crawler result returned 0 wines due to image-embedded menus (`ContentType.IMAGE_ONLY` or `HTML_MENU` pages with `wine_count == 0`). Take a full-page Playwright screenshot of the rendered page, send it to the existing `claude_vision_extractor.py` service (the Phase 1 extraction brain), and wire the result back through the same dedup + JSONL persist pipeline already established in Phase 2. Extend the same vision path to cover PDF pages where text extraction yielded 0 wines, routing them through Claude Vision as a fallback. This closes the Tredita-class blind spot where menus are embedded as `<img>` tags and no DOM text is present.

**Rationale**: Deferred from Phase 2. Image-pasted menus (menus embedded as `<img>` tags in HTML) cannot be extracted via text scraping. Claude Vision is the established extraction brain (Phase 1, benchmarked higher than Gemini Vision for structured menu extraction). PDF fallback belongs in the same phase: both are non-text content that must reach Claude Vision rather than Gemini Flash.

**Depends on**: Phase 1 (claude_vision_extractor.py), Phase 2 (web_crawler.py, JSONL pipeline, dedup)
**Requirements**: IMGX-01, IMGX-02, IMGX-03, IMGX-04, IMGX-05, IMGX-06, IMGX-07
**Success Criteria** (what must be TRUE):
  1. `web_crawler.py` detects `ContentType.IMAGE_ONLY` and `HTML_MENU` results with `wine_count == 0`, sets `image_menu_detected = True`
  2. Playwright takes a full-page screenshot of the detected URL and saves to a temp path
  3. Screenshot is passed to `claude_vision_extractor.py` — no new extractor written, existing Phase 1 brain reused
  4. Extracted wines flow through the same dedup + JSONL persist path as the HTML extraction route
  5. JSONL records from this path include `source_type: "image_menu"` (or `"pdf_vision_fallback"` for PDFs)
  6. `ContentType` handling in `web_crawler.py` updated: image menu route is explicit, documented, and does not break existing HTML or PDF text paths
  7. E2E harness: at least one known image-menu restaurant (e.g., Tredita) added to test suite; harness confirms ≥ 1 wine extracted via Vision path
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — Wave 1: extract_pdf() on ClaudeVisionExtractor + image_menu_detected on CrawlResult + source_type param on _persist_crawled_wines (completed 2026-04-05)
- [x] 06-02-PLAN.md — Wave 2: 4 private methods + 3 crawl_restaurant() integration hooks (completed 2026-04-05)
- [x] 06-03-PLAN.md — Wave 3: unit tests (test_image_menu.py) + Tredita E2E harness extension (completed 2026-04-05)

### Phase 7: Full-Field Extraction & Per-Field Confidence Framework
**Goal**: Transform the extraction pipeline from a partial-field system (9 Vision fields + 4 Haiku fields) into a full-coverage system that populates ALL ~31 database columns with per-field confidence scores. Implement a 3-tier confidence threshold framework: fields below 0.5 are rejected (left NULL), fields between 0.5–0.8 are queued for human review at the field level (not wine level), and fields above 0.8 are auto-accepted. Build a calibration loop that measures actual accuracy per field per confidence bin after 500 human-reviewed wines, then auto-adjusts thresholds to maintain ≥ 0.95 dataset-wide accuracy. This is the foundational phase that every subsequent phase builds upon — without per-field confidence, web verification and ontology validation cannot function.

**Rationale**: Currently, Claude Vision extraction asks for only 9 fields (wine_name, vintage, price_bottle, price_glass, region, country, grape_variety, section_name, bin_number) and Haiku enrichment returns only 4 fields (region, country, grape_variety, producer_bio). The database has 27+ columns, the JSONL persist record has 23 fields, and Session 11 proved Haiku can reliably return 11 fields at $0.0005/wine. Fields like alcohol_pct, color, primary_type, sweetness_level, food_pairing, sub_region, appellation, tasting_notes, and producer are either visible on menus or inferable from wine knowledge — but nobody asks for them. The current completeness_score is wine-level (binary: < 0.5 = review, ≥ 0.5 = accept), which holds entire records hostage when only one field is uncertain. Per-field confidence unlocks surgical review: accept wine_name at 0.98, queue sub_region at 0.55 for review, reject sweetness_level at 0.3 — all on the same wine record.

**Two-pass architecture**:
- **Pass 1 (Vision extraction)**: Expanded EXTRACTION_PROMPT asks for 18 fields that could be **visible** on the menu. Each field returned with `confidence` (0.0–1.0) and `source` ("visible" = printed on menu, "inferred" = Claude's best guess from context). Fields: wine_name, producer, vintage, primary_type, color, country, region, sub_region, appellation, grape_variety, alcohol_pct, price_bottle, price_glass, tasting_notes, description, section_name, bin_number, sweetness_level.
- **Pass 2 (Haiku enrichment)**: Expanded enrichment prompt asks for 20+ fields from wine knowledge. Haiku fills gaps left by Vision AND cross-checks Vision's inferences. Each field returned with `confidence` and `source: "knowledge"`. Fields: producer, region, sub_region, appellation, country, grape_variety, color, primary_type, sweetness_level, food_pairing, producer_bio, tasting_notes, alcohol_pct, description + 6 JSONB enrichments (grape_family, wine_structure, sensory_profile, practical_attributes, region_hierarchy, critic_scores_stub).

**Confidence framework**:
- `field_confidence` JSONB column on master_wine_library_submissions: `{"wine_name": {"value": "Barolo Riserva", "confidence": 0.97, "source": "visible"}, "sub_region": {"value": "Serralunga d'Alba", "confidence": 0.62, "source": "inferred"}, ...}`
- 3-tier threshold: < 0.5 → NULL (rejected), 0.5–0.8 → field queued for review, > 0.8 → auto-accepted
- Review queue upgraded: `GET /api/v1/quality/review-queue` returns wines with pending field-level reviews, showing only the fields that need human attention (not the whole record)
- `PATCH /api/v1/quality/review-queue/{id}` accepts field-level corrections: `{"corrections": {"sub_region": "Serralunga d'Alba", "appellation": "Barolo DOCG"}}`

**Calibration loop**:
- After 500 wines pass through human review, compute per-field accuracy at each confidence bin (0.5–0.6, 0.6–0.7, 0.7–0.8, 0.8–0.9, 0.9–1.0)
- Store calibration data in `field_calibration` Supabase table: field_name, confidence_bin, total_reviewed, total_correct, actual_accuracy, measured_at
- If actual accuracy in a bin falls below 0.95, raise the auto-accept threshold for that field
- If actual accuracy in a bin exceeds 0.98, lower the review threshold for that field (reduce review burden)
- Calibration runs as a Celery periodic task (daily) — reads field_corrections + original values, computes accuracy, updates thresholds in a `confidence_thresholds` config table
- Dashboard endpoint: `GET /api/v1/quality/calibration` returns current per-field thresholds and accuracy stats

**JSONB columns (6 structured enrichments)**: Kept as JSONB (not flat columns) because they are naturally nested:
- `grape_family`: `{"primary": "Nebbiolo", "blend": false, "percentages": null, "family": "Italian Reds"}`
- `wine_structure`: `{"body": "full", "tannin": "high", "acidity": "medium", "finish": "long"}`
- `sensory_profile`: `{"aromas": ["tar", "roses", "cherry"], "palate": ["dark fruit", "leather", "spice"], "color_descriptor": "garnet"}`
- `practical_attributes`: `{"serving_temp_c": 18, "decant_minutes": 60, "aging_potential_years": "10-20", "glass_type": "Burgundy"}`
- `region_hierarchy`: `{"country": "Italy", "region": "Piedmont", "sub_region": "Langhe", "appellation": "Barolo DOCG", "classification": "DOCG", "commune": "Serralunga d'Alba"}`
- `critic_scores`: `{}` (stub — populated by Phase 10)

**Depends on**: Phase 1 (claude_vision_extractor.py), Phase 4 (haiku_enrichment_service.py), Phase 5 (quality_routes.py, field_corrections table, review queue)
**Requirements**: FCONF-01, FCONF-02, FCONF-03, FCONF-04, FCONF-05, FCONF-06, FCONF-07, FCONF-08, FCONF-09, FCONF-10, FCONF-11, FCONF-12
**Success Criteria** (what must be TRUE):
  1. `EXTRACTION_PROMPT` asks for 18 fields with per-field confidence + source attribution
  2. `EnrichmentResult` expanded to 20+ fields including 6 JSONB enrichments, each with confidence
  3. Every wine record in master_wine_library_submissions has a `field_confidence` JSONB column storing per-field `{value, confidence, source}`
  4. Fields with confidence < 0.5 are stored as NULL in the record (rejected)
  5. Fields with confidence 0.5–0.8 are persisted but flagged in `field_review_queue` table with status="pending"
  6. Fields with confidence > 0.8 are auto-accepted (persisted, no review flag)
  7. `GET /api/v1/quality/review-queue` returns field-level review items (field_name, current_value, confidence, wine context) — not whole-wine records
  8. `PATCH /api/v1/quality/review-queue/{id}` accepts per-field corrections and logs each to field_corrections
  9. DB migration adds: `field_confidence` JSONB column, `field_review_queue` table, `field_calibration` table, `confidence_thresholds` table, 6 JSONB columns on master_wine_library
  10. Calibration task runs daily: reads field_corrections for reviewed wines, computes actual accuracy per field per confidence bin, updates confidence_thresholds
  11. `GET /api/v1/quality/calibration` returns current per-field thresholds, accuracy stats, and sample sizes
  12. E2E test: extract a known menu → verify field_confidence JSONB populated for all 18+ fields → verify fields routed correctly by threshold tier

### Phase 8: Web Search Verification & Deep Enrichment
**Goal**: Build a per-wine background web search agent that verifies AI-extracted/inferred data against authoritative external sources (Wine-Searcher, Vivino, producer websites, wine databases) and fills remaining gaps with verified external data. Construct a `producers` knowledge graph table that accelerates future enrichment — once a producer is verified, every future wine from that producer gets instant enrichment without web search. This phase transforms "Claude thinks this is Burgundy" into "Wine-Searcher confirms this is Burgundy" — the difference between an AI-generated dataset and a verified knowledge base.

**Rationale**: Phase 7 gives us full-field extraction with confidence scores, but even high-confidence AI inferences are still inferences. A 0.85-confidence "region: Burgundy" from Haiku is Claude's best guess from training data — it could be wrong for obscure producers or unusual wines. Web verification provides ground truth. Additionally, fields like retail_price_avg, critic_scores, producer founding year, winemaker name, and organic certification are NOT inferable from wine name alone — they require external lookup. The producer knowledge graph is a multiplier: verify "Domaine Leflaive" once, and every Leflaive wine ever scanned gets instant verified enrichment for producer, region (Burgundy), sub_region (Puligny-Montrachet), country (France), and certifications (biodynamic).

**Web search pipeline (per wine, async Celery task)**:
1. **Query construction**: `"{producer} {wine_name} {vintage}"` — search Wine-Searcher, Vivino, producer site
2. **Search execution**: Use Serper API (or Tavily) for web search, return top 5 results
3. **Result parsing**: Send search results + snippets to Gemini Flash (cost-optimized) with structured extraction prompt
4. **Concordance check**: Compare web-verified fields against existing field_confidence values
   - Concordance (web agrees with AI): boost field confidence to 0.95+ and set `verification_source: "web_verified"`
   - Contradiction (web disagrees): flag for human review with both values shown, set `verification_status: "contradicted"`
   - New data (web has field AI didn't): add field with `source: "web_search"` and confidence from source reliability
5. **Producer graph update**: If producer not in `producers` table, create entry with verified data. If exists, update with new findings.

**Producer knowledge graph** (`producers` table):
- `id`, `name`, `normalized_name`, `country`, `region`, `sub_region`, `appellation`
- `founding_year`, `winemaker_name`, `production_volume_cases`
- `certifications` JSONB: `{"organic": true, "biodynamic": true, "sustainable": false}`
- `website_url`, `portfolio` JSONB: list of known wines
- `verified_at`, `verification_sources` TEXT[]: ["wine-searcher", "producer_website"]
- Lookup: before web search, check if producer already in graph → instant enrichment, skip search

**Cost management**:
- Web search is expensive relative to Haiku ($0.003–0.01/wine vs $0.0005/wine)
- Tiered search strategy: only search wines where (a) any field has confidence < 0.8, OR (b) wine is from a new/unknown producer, OR (c) wine has never been web-verified
- Producer graph amortizes cost: after ~500 unique producers verified, most new wines match an existing producer → skip search
- Daily search budget cap: configurable in settings (default $5/day)

**Depends on**: Phase 7 (field_confidence JSONB, per-field thresholds)
**Requirements**: WSRCH-01, WSRCH-02, WSRCH-03, WSRCH-04, WSRCH-05, WSRCH-06, WSRCH-07, WSRCH-08, WSRCH-09
**Success Criteria** (what must be TRUE):
  1. Background Celery task `web_verify_task` accepts wine_id, queries web for verification data
  2. Search queries constructed from producer + wine_name + vintage, executed via Serper/Tavily API
  3. Search results parsed by Gemini Flash into structured fields matching master_wine_library schema
  4. Concordance engine compares web results against field_confidence values: concordance → boost to 0.95+, contradiction → flag for review
  5. `producers` table created with normalized_name, country, region, certifications, portfolio, verification metadata
  6. Producer graph lookup runs BEFORE web search — known producer = instant enrichment, no API call
  7. `verification_status` field added to field_confidence JSONB: "unverified" | "web_verified" | "contradicted" | "producer_graph"
  8. Daily search budget cap enforced (default $5/day) — search tasks queued but not executed once cap reached
  9. E2E test: submit a wine with low-confidence region → web search verifies correct region → field_confidence updated to 0.95+ with verification_source

### Phase 9: Wine Ontology, Taxonomy & Cross-Validation
**Goal**: Build a structured wine knowledge system — region hierarchies, grape family taxonomies, appellation classification rules, and vintage plausibility matrices — that enables automated cross-validation of every field on every wine record. When a record says "Barolo" from "France", the ontology catches it instantly. When a record says "2024 vintage Brunello di Montalcino", the vintage rules know that's impossible (DOCG requires 2+ years aging, 4+ for Riserva). This phase turns the dataset from "we trust Claude" into "we trust Claude AND verified it against the rules of winemaking."

**Rationale**: AI models hallucinate. Even at 0.95 confidence, 5% of fields could be wrong — and some errors are catastrophic for dataset credibility (wrong country, impossible vintage, mismatched grape-appellation). Rule-based validation catches errors that statistical confidence cannot. A region hierarchy means that if we know the appellation, we can auto-fill region, sub_region, and country with 1.0 confidence — these are facts, not inferences. A grape-appellation matrix means that if a wine is labeled "Châteauneuf-du-Pape" but the grape says "Riesling", we know something is wrong. This is the layer that pushes accuracy from 0.95 to 0.99.

**Wine ontology components**:

1. **Region hierarchy table** (`wine_regions`):
   - Tree structure: country → region → sub_region → appellation → commune/vineyard
   - ~3,000 rows covering all major wine regions worldwide
   - Fields: `id`, `name`, `level` (country|region|sub_region|appellation|commune), `parent_id`, `country_code`, `classification_system` (AOC|DOC|AVA|GI|etc.)
   - Use case: given appellation "Pauillac", auto-fill: sub_region="Haut-Médoc", region="Bordeaux", country="France", classification="AOC"
   - Use case: validate that "Barossa Valley" is in Australia, not France

2. **Grape family taxonomy** (`grape_varieties`):
   - ~500 major varieties with family groupings, color, typical regions
   - Fields: `id`, `name`, `color` (red|white|rosé), `family` (e.g., "Bordeaux Reds"), `aliases` TEXT[] (e.g., Syrah = Shiraz), `typical_regions` TEXT[], `typical_blending_partners` TEXT[]
   - Use case: if grape_variety = "Shiraz", normalize to "Syrah" with alias mapping
   - Use case: if wine is "Barolo" and grape says "Cabernet Sauvignon", flag contradiction (Barolo = Nebbiolo)

3. **Appellation rules** (`appellation_rules`):
   - Encodes legal requirements per appellation: required grapes, min percentages, aging minimums, production zones
   - Fields: `appellation_id` FK, `required_grapes` JSONB, `min_aging_months`, `min_vintage_release_delay_months`, `allowed_colors` TEXT[], `max_yield_hl_ha`, `classification_levels` TEXT[]
   - Use case: "Chianti Classico" requires ≥80% Sangiovese — if grape says "100% Merlot", flag
   - Use case: "Barolo" requires 38 months aging → 2024 vintage cannot be released before mid-2027

4. **Vintage plausibility matrix** (`vintage_rules`):
   - Per-region earliest-possible release year, given aging requirements
   - Handles NV (non-vintage) for Champagne/sparkling
   - Use case: "2025 Brunello di Montalcino" in 2026 is impossible (requires 5 years aging for Riserva, 2 for base)
   - Use case: "1985 Beaujolais Nouveau" is suspicious (Nouveau is meant for same-year consumption)

**Cross-validation engine**:
- Runs as a post-enrichment step (after Phase 7 + Phase 8)
- For each wine record, checks: region↔country consistency, grape↔appellation compatibility, vintage↔appellation plausibility, color↔grape consistency
- Validation result stored as `ontology_validation` JSONB on the wine record: `{"checks_passed": 5, "checks_failed": 1, "checks_total": 6, "failures": [{"check": "grape_appellation", "expected": "Nebbiolo", "found": "Cabernet Sauvignon", "severity": "critical"}]}`
- Critical failures (wrong country, impossible grape-appellation combo) → auto-flag for review regardless of confidence
- When ontology provides deterministic auto-fill (appellation → country), boost confidence to 1.0 with `source: "ontology"`

**Seeding strategy**: Initial ontology tables seeded from structured prompts to Claude Opus (one-time cost, ~$2–5 total), then verified against Wine-Searcher region data. Community contributions and human corrections feed back into ontology over time.

**Depends on**: Phase 7 (field_confidence framework), Phase 8 (web-verified data to seed ontology)
**Requirements**: ONTO-01, ONTO-02, ONTO-03, ONTO-04, ONTO-05, ONTO-06, ONTO-07, ONTO-08
**Success Criteria** (what must be TRUE):
  1. `wine_regions` table exists with tree structure (country → region → sub_region → appellation), seeded with ≥ 2,000 entries covering all major wine regions
  2. `grape_varieties` table exists with ≥ 400 varieties, color, family, aliases, typical regions
  3. `appellation_rules` table exists with grape requirements, aging minimums, allowed colors for ≥ 100 major appellations
  4. `vintage_rules` table encodes release-delay rules per appellation/region for plausibility checks
  5. Cross-validation engine runs on every wine record (post-enrichment): checks region↔country, grape↔appellation, vintage↔appellation, color↔grape
  6. Validation results stored as `ontology_validation` JSONB per wine: checks_passed, checks_failed, failure details with severity
  7. Critical ontology failures auto-flag wine for review regardless of field confidence
  8. Deterministic auto-fills from ontology (e.g., appellation → country) set confidence to 1.0 with source="ontology"

### Phase 10: Critic Scores & Pricing Intelligence
**Goal**: Aggregate professional critic ratings from multiple sources (Wine Advocate/Robert Parker, Wine Spectator, Vivino community, Decanter, JancisRobinson.com) per wine, benchmark restaurant menu prices against retail market averages (Wine-Searcher), and compute restaurant markup ratios. This phase transforms the dataset from "what wines are on menus" into "what wines are on menus, how good are they, and how much is the restaurant marking them up" — intelligence no other wine database provides in the restaurant context.

**Rationale**: A wine dataset without scores and pricing context is just a catalog. Restaurant operators, sommeliers, and wine distributors need to know: Is this wine well-reviewed? Is the restaurant pricing it fairly? How does this wine compare to others in the same price tier? Critic scores are the universal language of wine quality. Retail price benchmarking reveals which restaurants are price-competitive and which are over-marking. Combined with the menu-position data from extraction (section_name, order within section), this creates a uniquely powerful dataset: "This 92-point Wine Advocate wine is priced at 2.1x retail markup, listed first in the 'Red Burgundy' section at 14 Chicago restaurants."

**Critic score aggregation**:
- Per wine, search for scores from: Wine Advocate (100-point), Wine Spectator (100-point), Vivino (5-point community), Decanter (100-point), JancisRobinson (20-point)
- Normalize all scores to 0–100 scale for comparison
- Store as `critic_scores` JSONB (the Phase 7 stub): `{"wine_advocate": {"score": 93, "reviewer": "Lisa Perrotti-Brown", "review_date": "2024-03"}, "vivino": {"score": 4.2, "ratings_count": 1847}, "wine_spectator": {"score": 91}, "composite": 91.5}`
- `composite` score = weighted average (WA 30%, WS 25%, Vivino 20%, Decanter 15%, JR 10%) — only computed when ≥ 2 sources available
- Score lookup runs as background Celery task, respects daily budget cap

**Retail pricing intelligence**:
- Query Wine-Searcher average retail price per wine+vintage
- Store as `retail_price_avg` on master_wine_library: verified market price
- Compute `markup_ratio` = menu_price / retail_price_avg (stored per restaurant_inventory record)
- Markup classification: < 1.5x = "value", 1.5–2.5x = "standard", 2.5–4x = "premium", > 4x = "luxury_markup"
- Price anomaly detection: if markup_ratio > 5x or < 0.8x, flag for review (likely data error)

**Restaurant-level analytics** (computed, not stored per-wine):
- Average markup ratio across all wines on menu
- Score distribution: what % of wines are 90+ rated?
- Price-quality scatter: are high-scoring wines appropriately priced?

**Depends on**: Phase 8 (web search infrastructure, Serper/Tavily API), Phase 9 (wine_regions for region-specific scoring context)
**Requirements**: CRIT-01, CRIT-02, CRIT-03, CRIT-04, CRIT-05, CRIT-06, CRIT-07
**Success Criteria** (what must be TRUE):
  1. Background task `score_lookup_task` searches for critic scores per wine across ≥ 3 rating sources
  2. Scores normalized to 0–100 scale and stored in `critic_scores` JSONB with source attribution and date
  3. Composite score computed as weighted average when ≥ 2 sources available
  4. `retail_price_avg` populated from Wine-Searcher for wines with valid vintage
  5. `markup_ratio` computed per restaurant_inventory entry (menu_price / retail_price_avg)
  6. Price anomaly detection flags wines with markup_ratio > 5x or < 0.8x for review
  7. `GET /api/v1/analytics/wine/{id}/scores` returns aggregated critic scores + pricing intelligence for a wine

### Phase 11: Temporal Menu Intelligence & Analytics
**Goal**: Transform the extraction pipeline from a one-shot scanner into a living, breathing menu intelligence system. Schedule periodic re-crawls of known restaurant websites, detect menu changes (wines added, removed, prices changed), track wine lifecycle across restaurants over time, compute cross-restaurant popularity and regional trend analytics. This is the moat — no wine database in the world tracks restaurant menu changes over time. Wine-Searcher tracks retail pricing. Vivino tracks consumer ratings. WineOps tracks what sommeliers actually put on their lists, when they add it, when they remove it, and what replaces it.

**Rationale**: A static dataset is a snapshot. A temporal dataset is intelligence. When a wine appears on 15 restaurant menus in Chicago in Q1 but drops to 3 by Q3, that signals an allocation problem, a vintage transition, or a taste shift. When a restaurant raises the price of a specific wine by 20% but keeps all others flat, that signals supplier cost pressure on that producer. When orange wines go from 2% to 12% of new menu additions in a metro area over 6 months, that's a trend that distributors and producers need to know about. This data does not exist anywhere. Restaurant menu intelligence is the unique asset.

**Re-crawl scheduling**:
- `crawl_schedule` table: restaurant_id, crawl_frequency (weekly|biweekly|monthly), last_crawled_at, next_crawl_at, status
- Celery beat task: `scheduled_recrawl_task` runs daily, picks restaurants where next_crawl_at ≤ now()
- Re-crawl uses same WebCrawlerService pipeline (Phase 2 + Phase 6) — no new extraction code
- Cost: re-crawl is Gemini Flash ($0.0001/wine) — amortized < $0.01/restaurant/month

**Menu diff detection**:
- After re-crawl, compare new wine list against previous crawl using signature_hash
- Detect: `added` (new signature_hash not in previous), `removed` (previous hash not in new), `price_changed` (same hash, different price_reference)
- Store diffs in `menu_changes` table: restaurant_id, wine_signature_hash, change_type (added|removed|price_change), old_value, new_value, detected_at
- Aggregate: `wine_tenure_days` = days between first_seen and last_seen (or NULL if still active)

**Cross-restaurant analytics**:
- `wine_popularity`: how many restaurants carry wine X in a given metro/region?
- `trending_wines`: wines with highest positive delta in restaurant count over trailing 30/60/90 days
- `declining_wines`: wines being removed from multiple menus (allocation issues, vintage exhaustion)
- `category_trends`: % of menu additions by primary_type, grape_variety, region over time
- `price_trend`: average menu price for wine X across all restaurants, tracked monthly

**Analytics API endpoints**:
- `GET /api/v1/analytics/trends?metro=chicago&period=90d` — regional trends
- `GET /api/v1/analytics/wine/{id}/timeline` — wine lifecycle across all restaurants
- `GET /api/v1/analytics/restaurant/{id}/changes` — menu change history for a restaurant
- `GET /api/v1/analytics/popularity?limit=50` — most-carried wines across all restaurants

**Depends on**: Phase 2 (web_crawler.py), Phase 7 (field_confidence for dedup quality), Phase 8 (verified data for accurate matching)
**Requirements**: TEMP-01, TEMP-02, TEMP-03, TEMP-04, TEMP-05, TEMP-06, TEMP-07, TEMP-08
**Success Criteria** (what must be TRUE):
  1. `crawl_schedule` table tracks per-restaurant re-crawl frequency and next execution time
  2. `scheduled_recrawl_task` Celery beat task runs daily, triggers re-crawl for due restaurants
  3. Menu diff engine compares new crawl against previous: detects additions, removals, price changes
  4. `menu_changes` table stores all detected diffs with change_type, old/new values, timestamp
  5. `wine_popularity` materialized view or query computes cross-restaurant carrying count per wine
  6. `trending_wines` computation identifies wines with highest positive/negative restaurant-count delta over 30/60/90 day windows
  7. `GET /api/v1/analytics/trends` returns regional trend data (category, grape, region breakdowns)
  8. `GET /api/v1/analytics/wine/{id}/timeline` returns full lifecycle: first_seen, restaurants_carrying, price_history, menu_changes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Claude Vision Extraction | 2/2 | Complete | 2026-04-01 |
| 2. Gemini Flash Crawler | 2/2 | Complete | 2026-04-02 |
| 3. YOLO 2-class Preview | 2/2 | Complete | 2026-04-03 |
| 4. Claude Haiku Enrichment | 2/2 | Complete | 2026-04-04 |
| 5. Cost & Quality Guardrails | 4/4 | Complete | 2026-04-05 |
| 6. Image Menu Extraction via Claude Vision | 3/3 | Complete | 2026-04-05 |
| 7. Full-Field Extraction & Per-Field Confidence | 0/? | Planned | — |
| 8. Web Search Verification & Deep Enrichment | 0/? | Planned | — |
| 9. Wine Ontology, Taxonomy & Cross-Validation | 0/? | Planned | — |
| 10. Critic Scores & Pricing Intelligence | 0/? | Planned | — |
| 11. Temporal Menu Intelligence & Analytics | 0/? | Planned | — |

## Archived Phases (Previous Milestone — Retired)

The following phases were part of the YOLO+Surya pipeline (milestone 1.0) and are now superseded:
- ~~Phase 1: Dataset Preparation~~ — COMPLETE 2026-03-31 (Label Studio → YOLO conversion)
- ~~Phase 2: YOLO Model Training~~ — RETIRED (13-class mAP50 too low; 2-class only for preview)
- ~~Phase 3: Surya OCR Tuning~~ — RETIRED (Claude Vision reads text directly)
- ~~Phase 4: Integration (YOLO+Surya)~~ — SUPERSEDED (replaced by hybrid pipeline)

---
*Roadmap created: 2026-04-01*
*Previous roadmap archived: YOLO+Surya pipeline (2026-03-30 to 2026-03-31)*
*Phase 1 planned: 2026-04-01 — 2 plans, 2 waves*
*Phase 2 planned: 2026-04-02 — 2 plans, 2 waves*
*Phase 3 planned: 2026-04-03 — 2 plans, 2 waves*
*Phase 4 planned: 2026-04-03 — 2 plans, 2 waves*
*Phase 5 planned: 2026-04-04 — 4 plans, 3 waves*
*Phase 6 added: 2026-04-03 — Image Menu Extraction via Claude Vision (deferred from Phase 2)*
*Phases 7–11 added: 2026-04-05 — World-class wine dataset pipeline: full-field confidence, web verification, ontology, critic scores, temporal intelligence*
