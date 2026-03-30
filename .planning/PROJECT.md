# WineOps AI — Menu Scanning Pipeline

## What This Is

WineOps AI is an autonomous restaurant wine inventory and procurement system. This milestone focuses on perfecting the menu scanning pipeline: training a custom 13-class YOLOv8 model for wine entry detection and maximizing Surya OCR confidence on screenshots and scanned menus — eliminating the paid Gemini TEXT fallback by producing high-quality local extraction results.

## Core Value

A restaurant manager scans a menu and every wine is correctly identified and onboarded — without manual correction and without calling a paid API.

## Requirements

### Validated

- ✓ PDF scanning pipeline (PyPDF2 + Surya OCR) — working, high confidence — existing
- ✓ EasyOCR → Surya OCR swap in menu_analyzer_agent — implemented this session
- ✓ Image preprocessing for OCR (RGB normalize, upscale, contrast boost) — implemented this session
- ✓ 13-class YOLO dataset schema (data.yaml, annotation guidelines) — existing
- ✓ 262 labeled images with Wine Entry + Section Header annotations — existing
- ✓ 334 annotation images ready for sub-field labeling — existing

### Active

- [ ] Dataset conversion: Label Studio → YOLO format for Wine Entry + Section Header
- [ ] Auto-annotation of 11 sub-fields (vintage, price, wine_name, etc.) within Wine Entry boxes using Gemini Vision
- [ ] Full 13-class YOLO model trained to mAP50 > 0.95
- [ ] Surya OCR confidence maximized on annotation dataset (target: as high as achievable, reported accurately)
- [ ] Trained YOLO model wired into menu_analyzer_agent (replacing yolov8n.pt)
- [ ] End-to-end scan pipeline validated on screenshots and PDF pages

### Out of Scope

- EasyOCR — replaced by Surya, not revisited
- Gemini Vision path — untouched (photo upload, separate from menu scan)
- Invoice OCR (visual_verification_agent) — separate pipeline, not in scope
- Procurement/RFQ agents — unaffected
- Frontend/API changes — no UI work this milestone

## Context

**Existing dataset:** 262 labeled images (28 screenshots + 234 PDF pages) with 8,462 bounding boxes for Wine Entry and Section Header only. Sub-field classes (11 remaining) have no labels yet — will be auto-generated via Gemini Vision applied to each Wine Entry crop.

**Deployment constraint:** Railway (CPU-only). No GPU available. All models must run efficiently on CPU. Surya OCR is CPU-capable; YOLOv8n/s is CPU-capable.

**Current pipeline state:**
- PDF path: PyPDF2 (digital) → Surya OCR (scanned) — working well
- Screenshot path: EasyOCR (replaced with Surya this session) — needs YOLO region detection
- Fallback trigger: `parser_confidence < 0.5 AND total_wines == 0` → Gemini TEXT (paid)
- Root cause of fallback: base yolov8n.pt detects nothing useful → full-image OCR with poor text

**Mock mode default:** `menu_analyzer_agent` defaults to `mock_mode=True`. Production config must set this to False with the trained model path.

## Constraints

- **Deployment**: CPU-only (Railway) — model inference must be <5s per image on CPU
- **Architecture**: OCR changes only — YOLO detection layer is the new scope; parser, normalizer, Gemini structured parsing untouched
- **Data**: 262 labeled images for 2 classes; 11 sub-field classes require auto-annotation (no human labels yet)
- **Confidence target**: mAP50 > 0.95 for YOLO; Surya confidence maximized and reported (not blocked on a hard number)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace EasyOCR with Surya OCR | EasyOCR CPU performance poor on Railway — low confidence → Gemini fallback. Surya already proven in PDF path | ✓ Good |
| Add image preprocessing (upscale + contrast) | Low-res/dark screenshots fail OCR; preprocessing normalizes input | — Pending |
| 2-class → 13-class via auto-annotation | Only Wine Entry + Section Header labeled; other 11 classes auto-generated via Gemini Vision on Wine Entry crops | — Pending |
| YOLOv8 model size: start with YOLOv8s | CPU-deployable, sufficient capacity for 13-class detection, faster than YOLOv8m on CPU | — Pending |
| Surya confidence: maximize, report actual | 0.99 hard target unrealistic for complex menus; maximize and be honest about achieved numbers | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-30 after initialization*
