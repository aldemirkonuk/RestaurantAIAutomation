# Roadmap: WineOps Hybrid Extraction Pipeline

## Overview

Five phases to replace the retired YOLO+Surya+parser extraction stack with a production hybrid pipeline: Claude Vision for onboarding extraction, Gemini Flash for background crawling, YOLO 2-class for real-time preview, Claude Haiku for enrichment, and a full cost+quality guardrail layer.

**Architecture pivot from:** YOLO 13-class → Surya OCR → local parser (mAP50 0.04 — retired 2026-03-31)
**Architecture pivot to:** Claude Vision (extraction) + Gemini Flash (crawling) + YOLO 2-class (preview) + Haiku (enrichment)

## Phases

- [ ] **Phase 1: Claude Vision Extraction Service** — Core extraction brain: PDF/photo → Claude Vision → structured wine JSON, with parallel page processing and cost tracking
- [ ] **Phase 2: Gemini Flash Crawler** — Background pre-seeding: web crawler sends HTML/PDF text to Gemini Flash, deduplicates against master library
- [ ] **Phase 3: YOLO 2-class Real-time Preview** — Wire 2-class best.pt into camera feed for visual box drawing only (not extraction)
- [ ] **Phase 4: Claude Haiku Enrichment** — Background enrichment of new wine records: region, country, grape_variety, producer_bio via Haiku
- [ ] **Phase 5: Cost & Quality Guardrails** — Monthly spend caps, per-extraction cost logging, human review queue for low-confidence wines

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
- [ ] 01-02-PLAN.md — FastAPI endpoint + Supabase persistence: POST /api/v1/onboarding/extract wired to extractor and submissions table

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
**Plans**: TBD

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
**Plans**: TBD

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
**Plans**: TBD

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
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Claude Vision Extraction | 1/2 | In Progress | - |
| 2. Gemini Flash Crawler | 0/TBD | Not started | - |
| 3. YOLO 2-class Preview | 0/TBD | Not started | - |
| 4. Claude Haiku Enrichment | 0/TBD | Not started | - |
| 5. Cost & Quality Guardrails | 0/TBD | Not started | - |

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
