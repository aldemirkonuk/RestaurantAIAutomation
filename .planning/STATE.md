---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_plan: Not started
status: unknown
last_updated: "2026-04-02T18:37:20.475Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 11
  completed_plans: 6
---

# Project State: WineOps Menu Scanning Pipeline

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-01)

**Core value:** Manager scans a menu → every wine identified, enriched, and onboarded at < $0.50/restaurant
**Current focus:** Phase 02 — gemini-flash-crawler

---

## Current Position

Phase: 03
Plan: 1 of 2
**Active phase:** Phase 1 — Claude Vision Extraction Service
**Current plan:** Not started
**Last completed:** GSD re-initialized for hybrid pipeline (2026-04-01)
**Next action:** Run `/gsd:plan-phase 1` → build claude_vision_extractor.py

**Benchmark status:** Claude Vision benchmark running on 8 real Chicago restaurant menus (scripts/claude_vision_benchmark.py). Results will be in scripts/benchmark_results/.

---

## Session History

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

---

## Todos

- [ ] Phase 2 Wave 2: run `datasets/scripts/eval_model.py` once 2-class best.pt is ready → write `eval_report.md`
- [x] Phase 3 Wave 1: OCR baseline complete — avg 0.8954 overall (screenshots 0.9111, pdf_pages 0.8939)
- [ ] Phase 3 Wave 2: run `datasets/scripts/ocr_tune_preprocessing.py`, write `OCR_CONFIDENCE_REPORT.md`, update `_preprocess_for_ocr()` if improvements found
- [ ] Phase 4: wire 2-class best.pt into `menu_analyzer_agent.py`, E2E validation

---
*State initialized: 2026-03-30*
*Last updated: 2026-04-02 - Completed quick task 260402-kj0: Phase 2 E2E crawl harness built (scripts/e2e_crawl_harness.py + scripts/e2e_restaurants.json). Set GOOGLE_API_KEY to run live against real restaurant URLs.*
