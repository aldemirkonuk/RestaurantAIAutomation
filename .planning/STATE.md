# Project State: WineOps Menu Scanning Pipeline

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-30)

**Core value:** Manager scans a menu → every wine identified and onboarded locally, no paid API fallback
**Current focus:** Phase 1 — Dataset Preparation & Auto-Annotation

---

## Current Position

**Active phase:** 01-dataset-preparation
**Current plan:** 01-02 (next)
**Last completed:** 01-01 Dataset Preparation — Label Studio to YOLO Conversion (2026-03-30)
**Next action:** Execute Phase 1 Plan 02 (auto-annotate sub-fields via Gemini Vision)

---

## Session History

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

---

## Open Issues

- [ ] `menu_analyzer_agent` `mock_mode` defaults to `True` — production config must override
- [ ] Sub-field auto-annotations via Gemini Vision will need quality review
- [x] data.yaml path bug fixed — now `path: wine_menus` (resolves correctly via DATASETS_DIR)

---

## Todos

*(none captured yet)*

---
*State initialized: 2026-03-30*
*Last updated: 2026-03-30 — completed 01-01*
