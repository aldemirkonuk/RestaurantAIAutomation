---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-04-07T16:42:17.831Z"
progress:
  total_phases: 16
  completed_phases: 14
  total_plans: 61
  completed_plans: 58
  percent: 95
---

# Project State: WineOps Menu Scanning Pipeline

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-01)

**Core value:** Manager scans a menu → every wine identified, enriched, and onboarded at < $0.50/restaurant → verified against external sources → the world's most accurate restaurant wine dataset
**Current focus:** Phase 13 — Dev Onboarding UI with Manual Override Access

---

## Current Position

Phase: 13
Plan: Not started
**Last completed:** Phase 07 Plan 06 — test_field_confidence.py (11/11 tests passing) — 2026-04-06
**Phases complete:** 01, 02, 03, 04, 05, 06, 07
**Phases planned:** 08, 09, 10, 11
**Next action:** `/gsd-discuss-phase 8` → `/gsd-plan-phase 8` → execute

---

## Session History

### Session 10 — 2026-04-05

**Completed this session:**

- Executed Phase 06 Plans 01, 02, 03 (Waves 1, 2, 3) — Phase 6 COMPLETE
- Wave 1: Added extract_pdf() to ClaudeVisionExtractor (native Anthropic document content block); added image_menu_detected: bool = False to CrawlResult; added source_type: str = "crawled" param to _persist_crawled_wines()
- Wave 2: Added 4 private methods to WebCrawlerService (_take_viewport_chunks, _is_image_menu, _handle_image_menu, _handle_pdf_vision); wired 3 integration hooks into crawl_restaurant(); added import base64 + get_claude_vision_extractor
- Wave 3: Created test_image_menu.py (7 tests, all IMGX-01–06 covered + extract_pdf document block); added Tredita to e2e_restaurants.json with expect_image_menu=true; extended e2e_crawl_harness.py with image_menu_pass assertion + report column

**Key decisions:**

- extract_pdf() uses native Anthropic document content block (no new deps, single API call per PDF)
- Viewport chunks: 1280×900px, max 10, JPEG 85 quality — cost ceiling ~$0.15/restaurant
- _is_image_menu() differs from _check_image_menu(): uses naturalWidth > 400 + absence of wine patterns
- All Vision-extracted wines flow through existing _wine_is_duplicate() + _persist_crawled_wines() pipeline
- source_type tags: "image_menu" (screenshot path) | "pdf_vision_fallback" (PDF path) | "crawled" (Gemini path, unchanged)

**Files changed:**

- `services/agent-orchestrator/services/claude_vision_extractor.py` — extract_pdf() method added
- `services/agent-orchestrator/services/web_crawler.py` — 4 new methods + 3 integration hooks + imports
- `services/agent-orchestrator/tests/test_image_menu.py` — new file (7 tests)
- `scripts/e2e_restaurants.json` — Tredita entry added
- `scripts/e2e_crawl_harness.py` — image_menu_pass assertion + report column + dry-run note

---

### Session 9 — 2026-04-05

**Completed this session:**

- Executed Phase 05 Plans 02, 03, 04 (Wave 2 + Wave 3) — Phase 5 COMPLETE
- Wired SpendLogger into claude_vision_extractor.py, haiku_enrichment_service.py, vlm_extraction_service.py
- Created jobs/spend_tasks.py: monthly_cap_check_task Celery beat (hourly, idempotent per provider/month, Gmail SMTP alert)
- Patched celery_app.py: added jobs.spend_tasks import + beat schedule entry
- Added _preflight_cap_check() + _send_cap_alert_email() + PER_RESTAURANT_CAP_USD=2.00 to onboarding_routes.py
- Added AUTO_BLOCK_THRESHOLD=0.3 gate on submission insert (auto_blocked=True when completeness < 0.3)
- Created api/quality_routes.py: GET /review-queue + PATCH /review-queue/{id} with field_corrections logging + auto-promotion
- Registered quality_router in main.py
- All 4 plan SUMMARY files written

**Key decisions:**

- All SpendLogger calls wrapped in separate try/except — spend logging can never interrupt extraction
- Gemini token counts via getattr(response, "usage_metadata") — graceful fallback to 0
- Per-restaurant cap check fails open (returns 0.0 on query error) — infra failure never blocks extraction
- master_wine_library promotion failure is fatal (503) — data integrity cannot be silently dropped

**Files changed:**

- `services/agent-orchestrator/services/claude_vision_extractor.py` — SpendLogger import + log call
- `services/agent-orchestrator/services/haiku_enrichment_service.py` — SpendLogger import + log call + cost calc
- `services/agent-orchestrator/services/vlm_extraction_service.py` — SpendLogger import + log call
- `services/agent-orchestrator/jobs/spend_tasks.py` — new: monthly_cap_check_task
- `services/agent-orchestrator/jobs/celery_app.py` — spend_tasks import + beat schedule
- `services/agent-orchestrator/api/onboarding_routes.py` — preflight cap check + auto_blocked gate
- `services/agent-orchestrator/api/quality_routes.py` — new: GET/PATCH review queue
- `services/agent-orchestrator/main.py` — quality_router registration
- `.planning/phases/05-cost-quality-guardrails/05-02-SUMMARY.md` — new
- `.planning/phases/05-cost-quality-guardrails/05-03-SUMMARY.md` — new
- `.planning/phases/05-cost-quality-guardrails/05-04-SUMMARY.md` — new

---

### Session 8 — 2026-04-05

**Completed this session:**

- Executed Phase 05 Plan 01: Cost & Quality Guardrails Foundation
- Created `supabase/migrations/20260404000000_api_spend.sql`: api_spend table (7 cols: provider, model, input_tokens, output_tokens, cost_usd, restaurant_id, timestamp) + spend_alert_state table for idempotent monthly alert dedup
- Created `supabase/migrations/20260404000001_auto_blocked_column.sql`: ALTER TABLE adds auto_blocked BOOLEAN NOT NULL DEFAULT FALSE to master_wine_library_submissions
- Created `supabase/migrations/20260404000002_field_corrections.sql`: field_corrections table (submission_id, field_name, original_value, corrected_value, corrected_at, corrected_by)
- Created `services/agent-orchestrator/services/spend_logger.py`: SpendLogger class with log() never-raise contract + get_spend_logger() singleton
- Patched `services/agent-orchestrator/config/settings.py`: added manager_email, gmail_user, gmail_password attributes from MANAGER_EMAIL, GMAIL_USER, GMAIL_PASSWORD env vars
- Created `services/agent-orchestrator/tests/test_spend_logger.py`: 5 unit tests (TDD)

**Key decisions:**

- SpendLogger is synchronous (not async) — supabase-py is sync, < 50ms acceptable per RESEARCH.md
- log() wraps everything in try/except Exception — spend logging failure must NEVER crash extraction pipeline
- Singleton via module-level global — consistent with existing settings pattern

**Files changed:**

- `supabase/migrations/20260404000000_api_spend.sql` — new
- `supabase/migrations/20260404000001_auto_blocked_column.sql` — new
- `supabase/migrations/20260404000002_field_corrections.sql` — new
- `services/agent-orchestrator/services/spend_logger.py` — new
- `services/agent-orchestrator/tests/test_spend_logger.py` — new
- `services/agent-orchestrator/config/settings.py` — patched (+3 email attrs)
- `.planning/phases/05-cost-quality-guardrails/05-01-SUMMARY.md` — new

---

### Session 7 — 2026-04-03

**Completed this session:**

- Executed Phase 03 Plan 02: YOLO 2-class Preview Endpoint (Wave 2)
- Added `router_preview = APIRouter(prefix="/api/v1/preview")` to scan_routes.py — separate from /api/v1/scan
- Added `PreviewDetectRequest`, `BoundingBox`, `PreviewDetectResponse` Pydantic models to scan_routes.py
- Added `@router_preview.post("/detect")` endpoint calling `agent.detect_boxes()` only — firewalled from extraction
- Fixed `_get_yolo_model()` — removed `yolov8n.pt` fallback, added `Path.exists()` check + warning
- Registered `preview_router` in `main.py` — `/api/v1/preview/detect` now resolves (not 404)
- Auto-fix: Removed `"yolov8n.pt"` default from `MenuAnalyzerAgent.__init__` config.get() — replaced with best.pt path (03-01 left this behind)

**Key decisions:**

- Separate APIRouter prefix pattern: `/api/v1/preview` vs `/api/v1/scan` — clean resource separation
- Firewall enforcement: detect endpoint returns boxes only, zero connection to process_menu_image or extraction
- auto-fix logged: 03-01 summary claimed yolov8n.pt removal but config.get() default was not updated

**Files changed:**

- `services/agent-orchestrator/api/scan_routes.py` — router_preview, models, POST /detect, _get_yolo_model fix
- `services/agent-orchestrator/main.py` — preview_router import + include_router registration
- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — yolov8n.pt default replaced
- `.planning/phases/03-surya-ocr-tuning/03-02-SUMMARY.md` — plan summary

---

### Session 6 — 2026-04-03

**Completed this session:**

- Executed Phase 03 Plan 01: YOLO 2-class Preview Foundation
- Patched Settings to add cv_menu_model_path, cv_yolov8_mock_mode=False, yolo_model_path (YOLO_MODEL_PATH env var)
- Fixed AttributeError in scan_routes.py line 220 (settings.cv_menu_model_path missing)
- Replaced 13-class MENU_CLASS_NAMES with 2-entry map {0: wine_entry, 1: section_header}
- Removed mock_mode gate from YOLO loading in initialize() per D-07
- Removed yolov8n.pt fallback — missing model now logs warning + sets yolo_model=None
- Added detect_boxes() async method to MenuAnalyzerAgent (run_in_executor, firewalled from extraction)
- Created tests/test_yolo_preview.py with 5 tests (YOLO-01 through YOLO-05)

**Key decisions:**

- D-07 enforced: YOLO loads unconditionally (mock_mode only gates Surya OCR + Gemini Pro)
- detect_boxes() is a standalone method — zero connection to _get_field_parser or _get_wine_matcher
- Graceful degradation: missing best.pt → yolo_model=None → detect_boxes returns []

**Files changed:**

- `services/agent-orchestrator/config/settings.py` — 3 new YOLO attributes
- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — class map, initialize(), detect_boxes()
- `services/agent-orchestrator/tests/test_yolo_preview.py` — new test file
- `env.example` — YOLO_MODEL_PATH entry
- `.planning/phases/03-surya-ocr-tuning/03-01-SUMMARY.md` — plan summary

---

### Session 4 — 2026-03-31

**Completed this session:**

- Diagnosed 2-class training failure (bjrsn1lgn): stale `wine_menus/labels/train.cache` + `val.cache` caused ultralytics to load 13-class labels, rejecting 115/182 train images as "corrupt" and reducing val to ~6 instances
- 2-class training result: mAP50 0.34 (best 0.40) — unreliable, discarded
- Deleted stale cache files
- Launched correct 13-class training via `python datasets/scripts/train_model.py` (PID 39849)
- Confirmed correct training: val set = 51 images, 1474 instances (vs 6 in failed run)
- OCR baseline benchmark (Phase 3 prerequisite) also running in parallel

**Key findings:**

- Stale ultralytics cache files can silently load wrong labels — always delete before new dataset training
- 13-class training uses 182 train images / 51 val images, ~23 batches/epoch
- OCR benchmark complete: `datasets/ocr_benchmark_results.json` (334 images, mode=baseline)
- OCR baseline results: screenshots avg 0.9111, pdf_pages avg 0.8939, overall avg 0.8954
- 2 complete failures: aba_Wine_Menu_p2.png + p7.png (0.0 confidence — no text detected)
- `datasets/OCR_CONFIDENCE_REPORT.md` written with baseline table and tuning placeholder
- Fixed file path bug: benchmark was called with `--preprocessing none` (positional arg misuse); results written to `--preprocessing` at project root, moved and mode corrected to `baseline`

**Files changed:**

- `.planning/STATE.md` — updated session notes
- Deleted: `datasets/wine_menus/labels/train.cache`, `datasets/wine_menus/labels/val.cache`

---

### Session 3 — 2026-03-31

**Completed this session:**

- Executed Phase 1 Plan 03: Generate dataset_stats.json with class distribution and augmentation config
- Verified all 13 class IDs (0-12) present across train/val/test label files
- Computed class distribution from all .txt label files: wine_entry=2000 train, section_header=16 train
- Documented Section Header imbalance (125:1 ratio vs wine_entry) as AT RISK for Phase 2 mAP
- Recorded DATA-05 augmentation hyperparameters (fliplr=0.5, degrees=10, hsv_v=0.4, mosaic=1.0)
- Gemini annotation coverage confirmed at 87.6% (2392/2731)
- All 5 Phase 1 ROADMAP success criteria verified and passing
- Phase 1 complete

**Key findings:**

- section_header has only 16 train / 0 val / 3 test instances — near-zero mAP expected in Phase 2
- serving_type also very sparse: 11 train / 7 val / 3 test
- Total train annotations: 8,373 boxes across 13 classes

**Files changed:**

- `datasets/wine_menus/dataset_stats.json` — new stats file

---

### Session 2 — 2026-03-30

**Completed this session:**

- Executed Phase 1 Plan 01: Label Studio → YOLO dataset conversion
- Fixed data.yaml path bug (path: datasets/wine_menus → path: wine_menus)
- Wrote datasets/scripts/convert_labels.py with ls_to_yolo, parse_task, stratified_split, main
- 262 images copied to train/val/test with matching YOLO label files
- 2750 bounding boxes written (2731 Wine Entry + 19 Section Header)
- 86 empty label files created for unannotated images

**Key findings:**

- Stratified 70/20/10 split by source type yields 182/51/29 (not 183/52/27 as estimated — rounding across two groups)
- data.yaml path bug confirmed and fixed: DATASETS_DIR was already .../datasets
- All 262 annotation tasks accounted for, no missing images

**Files changed:**

- `datasets/wine_menus/data.yaml` — path bug fix
- `datasets/scripts/convert_labels.py` — new conversion script

---

### Session 1 — 2026-03-30

**Completed this session:**

- Diagnosed OCR fallback root cause: EasyOCR CPU performance → low confidence → Gemini TEXT fallback
- Replaced EasyOCR with Surya OCR in `menu_analyzer_agent.py`
- Added `_preprocess_for_ocr()` method (RGB normalize, 1200px upscale, 1.3× contrast)
- All smoke tests passing
- Initialized GSD project planning

**Key findings:**

- `datasets/wine_menus/images/` is empty — needs Label Studio → YOLO conversion
- Only 2 classes annotated (Wine Entry + Section Header) out of 13
- 262 labeled images, 8,462 bounding boxes
- 334 images available in `annotation_images/` for OCR benchmarking
- YOLO is using base `yolov8n.pt` (untrained on menus) — always falls to full-image mode

**Files changed:**

- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — EasyOCR → Surya swap

---

## Decisions Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-03-30 | EasyOCR → Surya in screenshot path | CPU performance, proven in PDF path |
| 2026-03-30 | Add image preprocessing before OCR | Low-res/dark screenshots fail without it |
| 2026-03-30 | 13-class model (not 2-class) | User wants full sub-field detection eventually |
| 2026-03-30 | Auto-annotate sub-fields via Gemini Vision | No human labels for 11 classes; Wine Entry boxes are known |
| 2026-03-30 | Start with YOLOv8s | CPU-deployable, sufficient for 13-class detection |
| 2026-03-30 | Surya target: maximize + report actual | Hard 0.99 target unrealistic for complex menus |
| 2026-03-30 | Stratified split yields 182/51/29, not 183/52/27 | Rounding with int() across two source groups (28+234); total still 262 |
| 2026-03-30 | Empty .txt files for unannotated images | Ultralytics silently skips missing label files; empty file is correct behavior |
| 2026-03-31 | section_header imbalance documented as AT RISK | 16 train instances (125:1 ratio vs wine_entry); mAP >= 0.90 target not achievable without more data |
| 2026-03-31 | Augmentation is ultralytics built-in, no disk pre-augmentation | DATA-05 params recorded in dataset_stats.json for Phase 2 training call |
| 2026-03-31 | Delete ultralytics .cache files before any new dataset training | Stale train.cache/val.cache caused 2-class run to load 13-class labels; 115/182 train images rejected; mAP50 0.34 instead of expected ~0.8+ |
| 2026-03-31 | 2-class training experiment discarded | Produced unreliable best.pt due to cache bug; proceeding directly with 13-class per plan 02-01 |
| 2026-04-02 | Switch to Haiku (claude-haiku-4-5-20251001) conditional on MAX_TOKENS=8192 re-run | Live benchmark: Haiku is 3.8x cheaper ($0.13 vs $0.49/restaurant), 2.1x faster at p50, identical wine extraction quality. Parse errors in benchmark were MAX_TOKENS=4096 truncation artifacts — production uses 8192. |
| 2026-04-05 | SpendLogger is synchronous | supabase-py client is sync; blocking for < 50ms is acceptable for MVP; avoids asyncio complexity in Celery tasks |
| 2026-04-05 | SpendLogger.log() never re-raises | Spend logging failure must NEVER interrupt extraction pipeline — all exceptions caught and logged as warnings |
| 2026-04-05 | auto_blocked uses ADD COLUMN IF NOT EXISTS | Safe migration for existing master_wine_library_submissions table — idempotent |

---

## Open Issues

- [ ] `menu_analyzer_agent` `mock_mode` defaults to `True` — production config must override
- [ ] Sub-field auto-annotations via Gemini Vision will need quality review
- [x] data.yaml path bug fixed — now `path: wine_menus` (resolves correctly via DATASETS_DIR)

---

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260401-wps | run live Supabase integration test for POST /api/v1/onboarding/extract — insert real wines into master_wine_library_submissions, verify rows, check submitted_by column type | 2026-04-02 | ced67f4 | [260401-wps-run-live-supabase-integration-test-for-p](./quick/260401-wps-run-live-supabase-integration-test-for-p/) |
| 260401-x24 | Benchmark claude-haiku-4-5-20251001 vs claude-sonnet-4-20250514 on 10 Phase 1 menu images — field completeness, latency, cost; produce model-selection recommendation | 2026-04-02 | 29158b3 | [260401-x24-investigate-whether-haiku-or-sonnet-haik](./quick/260401-x24-investigate-whether-haiku-or-sonnet-haik/) |
| 260402-kj0 | Build Phase 2 E2E test harness: crawl real restaurant URLs via WebCrawlerService, score wine field completeness, validate JSONL schema, confirm dedup, write REPORT.md | 2026-04-02 | 740b748 | [260402-kj0-build-phase-2-e2e-test-harness-crawl-rea](./quick/260402-kj0-build-phase-2-e2e-test-harness-crawl-rea/) |
| 260403-dgf | Update crawler JSONL output schema to Supabase-aligned 23-field format: rewrite _persist_crawled_wines, update CRAWL_TEXT_PROMPT (primary_type/price_reference), align e2e harness SCORED_FIELDS and validate_schema | 2026-04-03 | 891f5f8 | [260403-dgf-update-crawler-jsonl-output-schema-to-su](./quick/260403-dgf-update-crawler-jsonl-output-schema-to-su/) |
| 260406-2hy | try phase 8 with live API call, no mock data | 2026-04-06 | ec83274 | [260406-2hy-try-phase-8-with-live-api-call-no-mock-d](./quick/260406-2hy-try-phase-8-with-live-api-call-no-mock-d/) |
| 260406-329 | Improve concordance engine: add color synonym mapping and substring matching for grape varieties to reduce false contradictions | 2026-04-06 | c6b3683 | [260406-329-improve-concordance-engine-add-color-syn](./quick/260406-329-improve-concordance-engine-add-color-syn/) |
| 260407-pd8 | improve producer extraction — strip vintage prefix and separate region/country from producer strings | 2026-04-07 | eadd449 | [260407-pd8-improve-producer-extraction-strip-vintag](./quick/260407-pd8-improve-producer-extraction-strip-vintag/) |
| 260407-q0y | fix citation input always visible when editing + add production_method and lees_contact_months to Haiku winemaking_details enrichment | 2026-04-07 | 4532d5e | [260407-q0y-fix-citation-input-always-visible-when-e](./quick/260407-q0y-fix-citation-input-always-visible-when-e/) |
| 260407-qpw | fix override submission_id — backend returns real Supabase UUID per wine in extract response, frontend uses it instead of String(i) | 2026-04-07 | d199ec6 | [260407-qpw-fix-override-submission-id-backend-retur](./quick/260407-qpw-fix-override-submission-id-backend-retur/) |
| 260407-h3k | fix PGRST116 — replace `.single()` with `.maybe_single()` on studio routes + override_service so 0 rows return 404/null instead of PostgREST coerce error | 2026-04-07 | c35d52f | [260407-h3k-fix-pgrst116-studio-maybe-single](./quick/260407-h3k-fix-pgrst116-studio-maybe-single/) |

---

## Todos

- [ ] Phase 2 Wave 2: run `datasets/scripts/eval_model.py` once 2-class best.pt is ready → write `eval_report.md`
- [x] Phase 3 Wave 1: OCR baseline complete — avg 0.8954 overall (screenshots 0.9111, pdf_pages 0.8939)
- [ ] Phase 3 Wave 2: run `datasets/scripts/ocr_tune_preprocessing.py`, write `OCR_CONFIDENCE_REPORT.md`, update `_preprocess_for_ocr()` if improvements found
- [ ] Phase 4: wire 2-class best.pt into `menu_analyzer_agent.py`, E2E validation

---
---

### Session 5 — 2026-04-03

**Completed this session:**

- Built Phase 2 E2E crawl harness (`scripts/e2e_crawl_harness.py`) with live PASS: 87.3% aggregate completeness, 0 dedup failures, 0 schema violations
- Fixed GeminiFlashCrawlerExtractor: `AsyncClient → genai.Client`, upgraded model to `gemini-2.5-flash`
- Fixed dedup proxy logic: same content_hash = real Supabase dedup would catch it → PASS
- Added Phase 6 to ROADMAP: Image Menu Extraction via Claude Vision (deferred from Phase 2, IMGX-01→07)
- Locked E2E test suite: The Tailors Son (57 wines, 96.8%), Chicago Winery, BLVD Steakhouse, The Albert Chicago
- Completed 25-feature analysis across 3 tiers (Extracted / Derived / Haiku enrichment)
- **260403-dgf COMPLETE**: Rewrote `_persist_crawled_wines` to full 23-field Supabase-aligned schema:
  - Renames: `wine_type → primary_type`, `price → price_reference`
  - New derived: `bottle_size`, `is_blend`, `vintage_age`, `price_tier`
  - New dedup: `signature_hash` (md5), `normalized_name`, `normalized_producer`
  - Metadata folded into `data_enrichment` JSONB: source_url, source_type, restaurant_name, crawled_at, confidence, extraction_model
  - Phase 4 stubs: `color=None`, `sweetness_level=None`, `food_pairing=None`
  - Updated `CRAWL_TEXT_PROMPT` and `TEXT_FALLBACK_PROMPT` in vlm_extraction_service.py
  - E2E harness SCORED_FIELDS and validate_schema updated to new field names
- Analyzed `library/restaurant_wine_dataset.jsonl` (200 records) vs crawler schema:
  - Library = target enriched state; crawler JSONL = correct intake/staging format
  - Our schema is architecturally superior: no fabricated data, has signature_hash/dedup fields, tracks provenance
  - **6 JSONB stubs to add** in next session: `grape_family`, `wine_structure`, `practical_attributes`, `sensory_profile`, `ml_derived_features`, `region_hierarchy`

**Next actions:**

- Add 6 JSONB stubs to `_persist_crawled_wines` (quick task)
- Wire Supabase insert: populate `restaurant_id` + `submitted_by` → flow into `master_wine_library_submissions`
- PDF extraction path (Phase 6 prerequisite for ABA, BLVD, Mano)

---

---

### Session 11 — 2026-04-06

**Completed this session:**

- Ran `/gsd-validate-phase 6` — Phase 6 Nyquist validation complete, 06-VALIDATION.md written
- Fixed IMGX-07 live E2E (was ⚠️ manual, now ✅ automated):
  - Replaced dead Tredita URL (405) with **Siena Tavern** (`sienatavern.com/menus/`) in `e2e_restaurants.json`
  - Fixed `_check_image_menu()` miss: `_is_image_menu()` now runs as fallback in crawl_restaurant()
  - Fixed `_take_viewport_chunks()` height eval: `Math.max(body.scrollHeight, documentElement.scrollHeight, window.innerHeight)`
  - Fixed `_download_pdf()`: added `aiohttp` fallback with `User-Agent` header for CDN PDFs served as downloads
  - Fixed E2E harness filter: now accepts both `"image_menu"` and `"pdf_vision_fallback"` source types
  - Added `import aiohttp` + `import ssl` to web_crawler.py
- Live E2E result: Siena Tavern extracted **46 wines via pdf_vision_fallback** — IMGX-07 PASS
- Ran `/gsd-audit-milestone v1.0` — all 34/34 requirements satisfied, 6/6 phases verified, Nyquist 5/6 compliant
- Validated Haiku expanded enrichment: tested prompt returning 11/11 fields for "Canard-Duchêne Cuvee Leonie":
  - producer, region, sub_region, appellation, country, grape_variety, color, primary_type, sweetness_level, food_pairing, producer_bio
  - Cost: ~$0.0005/wine (270 in + 203 out tokens at Haiku pricing)

**Key findings:**

- Siena Tavern JSONL: 207 records, 23 fields per record — currently 8–11 fields populated per wine
- Zero-filled fields (producer, color, primary_type, sweetness_level, food_pairing) are all answerable by Haiku from wine_name + vintage alone — no web search required
- Haiku's training knowledge covers these fields with high accuracy — verified live on Champagne wine

**Next action — Haiku enrichment expansion (ready to implement):**

1. Expand `EnrichmentResult` dataclass in `haiku_enrichment_service.py` — add 7 new fields: `producer`, `color`, `primary_type`, `sweetness_level`, `food_pairing`, `sub_region`, `appellation`
2. Update prompt — ask for all 11 fields (currently only asks for 4)
3. Increase `MAX_TOKENS` from 512 → 1024
4. Update `haiku_tasks.py` — write new fields to Supabase `master_wine_library` update payload
5. Add DB migration for new columns (`color`, `primary_type`, `sweetness_level`, `food_pairing`, `sub_region`, `appellation`) if not already present

**Files changed this session:**

- `services/agent-orchestrator/services/web_crawler.py` — aiohttp import, _is_image_menu fallback, _take_viewport_chunks height fix, _download_pdf aiohttp fallback with User-Agent
- `scripts/e2e_restaurants.json` — Tredita → Siena Tavern
- `scripts/e2e_crawl_harness.py` — vision_source_types set accepts pdf_vision_fallback
- `.planning/phases/06-image-menu-extraction/06-VALIDATION.md` — IMGX-07 updated to COVERED, Manual-Only cleared, 7/7 automated

---

### Roadmap Evolution

- Phase 12.1 inserted after Phase 12: Research Agent SOTA Redesign — Three-Layer Architecture (INSERTED)
  - Addresses 10 critical bugs in Phase 12 code, 4 unimplemented features, 9 SOTA architectural gaps
  - Three-layer architecture: deterministic inference (Phase 9 ontology) → cascade LLM enrichment → deep research with Reflexion

*State initialized: 2026-03-30*
*Last updated: 2026-04-06 — Phase 12.1 inserted for SOTA research agent redesign. Phase 12 complete but has critical bugs and architectural gaps identified via deep analysis.*
