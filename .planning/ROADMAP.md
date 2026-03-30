# Roadmap: WineOps Menu Scanning Pipeline

**Milestone:** v1 — Perfect Menu Scanning (YOLO + OCR)
**Started:** 2026-03-30
**Target:** Trained 13-class YOLO model (mAP50 > 0.95) + maximized Surya OCR confidence, fully integrated into menu_analyzer_agent

---

## Phase 1 — Dataset Preparation & Auto-Annotation

**Goal:** Convert raw Label Studio annotations to YOLO format, auto-generate sub-field labels for all 11 remaining classes, and build the complete 13-class training dataset ready for model training.

**Requirements covered:** DATA-01, DATA-02, DATA-03, DATA-04, DATA-05

**Deliverables:**
- `datasets/wine_menus/images/train/`, `val/`, `test/` populated with images
- `datasets/wine_menus/labels/train/`, `val/`, `test/` with YOLO-format `.txt` label files
- Auto-annotation script: `datasets/scripts/auto_annotate_subfields.py`
- Conversion script: `datasets/scripts/convert_labelstudio_to_yolo.py`
- `datasets/wine_menus/dataset_stats.json` (class distribution, image counts)

**Success criteria:**
- [ ] All 262 images converted with YOLO labels for class 0 (wine_entry) and class 1 (section_header)
- [ ] Sub-field auto-annotations generated for ≥ 80% of Wine Entry boxes
- [ ] train/val/test split verified: ~183/52/27 images
- [ ] data.yaml updated with correct absolute paths

**Status:** Pending

---

## Phase 2 — YOLO Model Training

**Goal:** Train YOLOv8s on the 13-class wine menu dataset and achieve mAP50 ≥ 0.95 on the Wine Entry class (primary target), with best-effort coverage of sub-field classes.

**Requirements covered:** YOLO-01, YOLO-02, YOLO-03, YOLO-04, YOLO-05, YOLO-06

**Deliverables:**
- Trained model: `datasets/wine_menus/runs/train/best.pt`
- Training config: `datasets/wine_menus/runs/train/args.yaml`
- Evaluation report: `datasets/wine_menus/runs/train/eval_report.md`
- Per-class mAP table for all 13 classes

**Success criteria:**
- [ ] mAP50 ≥ 0.95 on Wine Entry (class 0)
- [ ] mAP50 ≥ 0.90 on Section Header (class 1)
- [ ] CPU inference time < 5s for a 2352×1076 image
- [ ] `best.pt` saved and loadable

**Status:** Pending

---

## Phase 3 — Surya OCR Confidence Benchmark & Tuning

**Goal:** Measure Surya OCR confidence on all 334 annotation images, tune the preprocessing pipeline to maximize confidence, and produce a per-image-type report.

**Requirements covered:** OCR-01, OCR-02, OCR-03, OCR-04

**Deliverables:**
- Benchmark script: `datasets/scripts/benchmark_surya_ocr.py`
- Results: `datasets/ocr_benchmark_results.json`
- Report: `datasets/OCR_CONFIDENCE_REPORT.md` (baseline vs tuned, per image type)
- Updated `_preprocess_for_ocr()` in `menu_analyzer_agent.py` if improvements found

**Success criteria:**
- [ ] Baseline confidence measured across all 334 images
- [ ] Average confidence reported separately for screenshots vs PDF pages
- [ ] Preprocessing tuning applied if it improves average confidence by ≥ 0.02
- [ ] Report documents achieved numbers honestly (no target blocking)

**Status:** Pending

---

## Phase 4 — Integration & End-to-End Validation

**Goal:** Wire the trained YOLO model into menu_analyzer_agent, validate the full scan pipeline end-to-end on representative menu images, and confirm the Gemini TEXT fallback is no longer triggered.

**Requirements covered:** INT-01, INT-02, INT-03, INT-04

**Deliverables:**
- Updated `menu_analyzer_agent.py`: `menu_model_path` pointing to `best.pt`
- Integration test: `services/agent-orchestrator/tests/test_menu_scan_integration.py`
- E2E scan results on 5 representative images (2 screenshots + 3 PDF pages)

**Success criteria:**
- [ ] Trained model loads without error at initialization
- [ ] YOLO detects Wine Entry regions on 5 test images (no full_image fallback)
- [ ] Surya OCR runs per-region (not full image) when YOLO finds detections
- [ ] All 5 test scans complete without triggering Gemini TEXT fallback
- [ ] At least 1 wine entry extracted per test image

**Status:** Pending

---

## Progress

| Phase | Status | Completion |
|-------|--------|------------|
| 1 — Dataset Preparation | Pending | 0% |
| 2 — YOLO Training | Pending | 0% |
| 3 — Surya OCR Tuning | Pending | 0% |
| 4 — Integration | Pending | 0% |

**Overall:** 0% · 0/4 phases complete

---
*Roadmap created: 2026-03-30*
*Last updated: 2026-03-30*
