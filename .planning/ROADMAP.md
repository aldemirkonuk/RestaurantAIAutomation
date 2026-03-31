# Roadmap: WineOps Menu Scanning Pipeline

## Overview

Four phases to go from an empty YOLO training directory to a fully integrated, high-confidence menu scanning pipeline: convert and auto-annotate the dataset, train a 13-class YOLOv8 model to mAP50 ≥ 0.95, maximize Surya OCR confidence, and wire everything into the production agent.

## Phases

- [ ] **Phase 1: Dataset Preparation** - Convert Label Studio annotations to YOLO format and auto-generate 11 sub-field class labels
- [ ] **Phase 2: YOLO Model Training** - Train 13-class YOLOv8s model to mAP50 ≥ 0.95 on wine menu detection
- [ ] **Phase 3: Surya OCR Tuning** - Benchmark and maximize Surya OCR confidence across all annotation images
- [ ] **Phase 4: Integration** - Wire trained model into menu_analyzer_agent and validate end-to-end pipeline

## Phase Details

### Phase 1: Dataset Preparation
**Goal**: Convert 262 Label Studio-annotated images to YOLO format, auto-generate bounding box labels for all 11 sub-field classes using Gemini Vision on Wine Entry crops, and produce a complete train/val/test split ready for model training.
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05
**Success Criteria** (what must be TRUE):
  1. `datasets/wine_menus/images/train/` contains ≥ 183 images
  2. `datasets/wine_menus/labels/train/` contains matching `.txt` YOLO label files for all images
  3. Each label file contains class IDs 0–12 with normalized xywh coordinates
  4. Sub-field annotations generated for ≥ 80% of Wine Entry bounding boxes
  5. `datasets/wine_menus/dataset_stats.json` exists with class distribution counts
**Plans**: TBD

### Phase 2: YOLO Model Training
**Goal**: Train a YOLOv8s model on the 13-class wine menu dataset and achieve mAP50 ≥ 0.95 for the Wine Entry class and ≥ 0.90 for Section Header, with CPU inference under 5 seconds per image.
**Depends on**: Phase 1
**Requirements**: YOLO-01, YOLO-02, YOLO-03, YOLO-04, YOLO-05, YOLO-06
**Success Criteria** (what must be TRUE):
  1. `datasets/wine_menus/runs/train/best.pt` exists and loads without error
  2. Validation mAP50 ≥ 0.95 for class 0 (wine_entry) in eval report
  3. Validation mAP50 ≥ 0.90 for class 1 (section_header) in eval report
  4. CPU inference time < 5s for a 2352×1076 image (measured in eval report)
  5. `datasets/wine_menus/runs/train/eval_report.md` contains per-class mAP table
**Plans**: TBD

### Phase 3: Surya OCR Tuning
**Goal**: Benchmark Surya OCR confidence on all 334 annotation images, tune the preprocessing pipeline to maximize average confidence, and produce a per-image-type report with honest achieved numbers.
**Depends on**: Nothing (can run in parallel with Phase 2)
**Requirements**: OCR-01, OCR-02, OCR-03, OCR-04
**Success Criteria** (what must be TRUE):
  1. `datasets/ocr_benchmark_results.json` contains per-image confidence scores for all 334 images
  2. `datasets/OCR_CONFIDENCE_REPORT.md` reports average confidence separately for screenshots vs PDF pages
  3. Baseline vs tuned confidence comparison documented
  4. Any preprocessing change that reduces average confidence is reverted
**Plans**: TBD

### Phase 4: Integration
**Goal**: Wire the trained YOLOv8 model into menu_analyzer_agent, validate the full scan pipeline on 5 representative test images, and confirm the Gemini TEXT fallback is no longer triggered for high-quality inputs.
**Depends on**: Phase 2, Phase 3
**Requirements**: INT-01, INT-02, INT-03, INT-04
**Success Criteria** (what must be TRUE):
  1. `menu_analyzer_agent.py` `menu_model_path` points to trained `best.pt`
  2. YOLO detects at least one Wine Entry region in each of 5 test images (no full_image fallback)
  3. All 5 test scans complete without triggering `gemini_text_fallback` extraction method
  4. At least 1 wine entry extracted per test image with `extraction_method == "free_local_parser"`
  5. Integration test file exists at `services/agent-orchestrator/tests/test_menu_scan_integration.py`
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Dataset Preparation | 0/TBD | Not started | - |
| 2. YOLO Model Training | 0/TBD | Not started | - |
| 3. Surya OCR Tuning | 0/TBD | Not started | - |
| 4. Integration | 0/TBD | Not started | - |

---
*Roadmap created: 2026-03-30*
*Last updated: 2026-03-30*
