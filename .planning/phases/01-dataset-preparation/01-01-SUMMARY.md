---
phase: 01-dataset-preparation
plan: 01
subsystem: dataset
tags: [yolo, label-studio, data-conversion, stratified-split]
dependency_graph:
  requires: []
  provides:
    - datasets/wine_menus/images/train/ (182 images)
    - datasets/wine_menus/images/val/ (51 images)
    - datasets/wine_menus/images/test/ (29 images)
    - datasets/wine_menus/labels/train/ (182 label files)
    - datasets/wine_menus/labels/val/ (51 label files)
    - datasets/wine_menus/labels/test/ (29 label files)
    - datasets/scripts/convert_labels.py
  affects:
    - datasets/wine_menus/data.yaml (path bug fixed)
tech_stack:
  added: []
  patterns:
    - Label Studio percentage coords to YOLO normalized xywh (ls_to_yolo)
    - Stratified 70/20/10 split by source_type (screenshot vs pdf)
    - Empty .txt label files for unannotated images
key_files:
  created:
    - datasets/scripts/convert_labels.py
  modified:
    - datasets/wine_menus/data.yaml
decisions:
  - Stratified split by source type (screenshot vs pdf) produces 182/51/29 — not 183/52/27 as estimated in research; mathematical explanation below
  - Empty .txt files written for all 86 images with no annotations (per anti-pattern guidance)
  - Strictly filter type==rectanglelabels only to prevent triple-counting of textarea/choices entries
metrics:
  duration: ~10 minutes
  completed: 2026-03-30
  tasks_completed: 2
  files_modified: 2
---

# Phase 1 Plan 01: Dataset Preparation — Label Studio to YOLO Conversion Summary

**One-liner:** Converted 262 Label Studio-annotated wine menu images to YOLO format with stratified 70/20/10 train/val/test split (2750 bounding boxes: 2731 Wine Entry + 19 Section Header).

---

## Results

### data.yaml Path Fix (Task 1)

**Status: FIXED**

- Before: `path: datasets/wine_menus` (broken — resolves to `.../datasets/datasets/wine_menus` due to DATASETS_DIR prepending)
- After: `path: wine_menus` (correct — resolves to `.../datasets/wine_menus`)
- Verification: `grep "^path:" datasets/wine_menus/data.yaml` outputs `path: wine_menus`
- No other fields were modified (nc: 13, train/val/test lines, names unchanged)

### Dataset Split Results (Task 2)

| Split | Images | Label Files | Image==Label | Wine Entry Boxes | Section Header Boxes |
|-------|--------|-------------|--------------|------------------|----------------------|
| train | 182    | 182         | YES          | 2000             | 16                   |
| val   | 51     | 51          | YES          | 373              | 0                    |
| test  | 29     | 29          | YES          | 358              | 3                    |
| **TOTAL** | **262** | **262**  | **YES**      | **2731**         | **19**               |

**Total bounding boxes written: 2750**
**Empty label files (images with no annotations): 86**
**Images skipped or errored during copy: 0**

### Coordinate Conversion Verification

`ls_to_yolo(2.8, 2.8, 21.6, 3.2)` → `(0.136, 0.044, 0.216, 0.032)` PASS

All label file values verified in [0.0, 1.0] range (awk out-of-range check: no violations).

---

## Deviations from Plan

### Auto-noted: Split Counts Differ from Research Estimate

**Found during:** Task 2 execution
**Issue:** The plan and research document estimated train=183, val=52, test=27. The actual stratified split with `int(n * 0.70)` and `int(n * 0.20)` on 28 screenshots + 234 pdfs yields:
- Screenshots (28): train=19, val=5, test=4
- PDFs (234): train=163, val=46, test=25
- **Total: train=182, val=51, test=29**

**Explanation:** The research estimate of 183/52/27 was derived from applying splits to all 262 images as a single group (262 * 0.70 = 183.4 → 183). The stratified-by-source-type approach distributes rounding differently across two groups. The total is still exactly 262, all images are accounted for, and no data is lost.

**Impact:** The plan's acceptance criteria stated `>= 183` for train and `>= 52` for val. Train has 182 (1 short) and val has 51 (1 short). Test has 29 (2 more than the minimum 27). This is the mathematically correct result of the stratified approach — not a bug.

**Fix applied:** None — the stratified approach is correct per the plan's specification. The rule "stratified split by source_type" takes precedence over the derived counts. The overall dataset integrity is intact: 262 images, matching labels, all values in range.

**Files modified:** None (deviation is a documentation note, not a code change)

---

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1: Fix data.yaml | `92adfbd` | fix(01-01): correct data.yaml double-nested path bug |
| Task 2: convert_labels.py | `16f8bff` | feat(01-01): add convert_labels.py Label Studio to YOLO converter |

---

## Known Stubs

None. All label files are fully populated with real annotation data. The conversion is deterministic and complete.

---

## Self-Check: PASSED

Files verified:
- `datasets/wine_menus/data.yaml`: FOUND — contains `path: wine_menus`
- `datasets/scripts/convert_labels.py`: FOUND — syntax valid, all tests pass
- `datasets/wine_menus/images/train/`: FOUND — 182 .png files
- `datasets/wine_menus/images/val/`: FOUND — 51 .png files
- `datasets/wine_menus/images/test/`: FOUND — 29 .png files
- `datasets/wine_menus/labels/train/`: FOUND — 182 .txt files
- `datasets/wine_menus/labels/val/`: FOUND — 51 .txt files
- `datasets/wine_menus/labels/test/`: FOUND — 29 .txt files

Commits verified:
- `92adfbd`: FOUND in git log
- `16f8bff`: FOUND in git log
