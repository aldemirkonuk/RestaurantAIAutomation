---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_plan: "2 (Wave 2: POST /api/v1/preview/detect endpoint)"
status: unknown
last_updated: "2026-04-03T21:08:53.331Z"
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 11
  completed_plans: 8
---

# Project State: WineOps Menu Scanning Pipeline

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-01)

**Core value:** Manager scans a menu → every wine identified, enriched, and onboarded at < $0.50/restaurant
**Current focus:** Phase 04 — Claude Haiku Enrichment (next)

---

## Current Position

Phase: 03 (YOLO 2-class Real-time Preview) — COMPLETE
Plan: 2 of 2 (all plans complete)
**Last completed:** 03-02 — YOLO endpoint (router_preview, POST /api/v1/preview/detect, main.py registration) — 2026-04-03
**Next action:** Execute Phase 04 — Claude Haiku enrichment

---

## Session History

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

*State initialized: 2026-03-30*
*Last updated: 2026-04-03 - Session 5 complete. Phase 2 E2E harness PASS. 23-field Supabase-aligned JSONL schema live. 6 stubs pending for next session.*
