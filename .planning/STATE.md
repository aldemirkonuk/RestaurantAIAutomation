# Project State: WineOps Menu Scanning Pipeline

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-30)

**Core value:** Manager scans a menu → every wine identified and onboarded locally, no paid API fallback
**Current focus:** Phase 1 — Dataset Preparation & Auto-Annotation

---

## Current Position

**Active phase:** 01-claude-vision-extraction-service
**Current plan:** 01-02 (next)
**Last completed:** 01-01 Claude Vision Extractor — Core Engine (2026-04-01)
**Next action:** Execute Phase 1 Plan 02 — API endpoint + Supabase persistence

---

## Session History

### Session 4 — 2026-04-01

**Completed this session:**
- Executed Phase 01-claude-vision-extraction-service Plan 01: Build ClaudeVisionExtractor core engine
- Updated anthropic pin from ==0.14.0 to >=0.50.0 (AsyncAnthropic requires post-0.20)
- Implemented ClaudeVisionExtractor with async parallel page dispatch (asyncio.gather + Semaphore(5))
- Implemented ClaudePageResult + ClaudeExtractionResult Pydantic models
- Implemented parse_json_response (multi-strategy: fenced, brace, raw, fallback)
- Implemented compute_completeness over 6 fields with strict < 0.5 threshold for needs_review
- Per-page cost: (input * 3.0 + output * 15.0) / 1_000_000 USD
- 10/10 unit tests pass without live CLAUDE_API_KEY (all Anthropic calls mocked)

**Key findings:**
- Worktree had no services/ directory tracked — created directory structure and files fresh
- MAX_TOKENS=8192 constant used instead of literal (better practice, same effect)
- vlm_extraction_service.py (Gemini) untouched — architecture separation maintained

**Files changed:**
- `services/agent-orchestrator/requirements.txt` — anthropic pin updated
- `services/agent-orchestrator/services/claude_vision_extractor.py` — new extraction service
- `services/agent-orchestrator/tests/test_claude_vision_extractor.py` — 10 unit tests

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
| 2026-04-01 | response.content[0].text not response.text | Anthropic SDK pattern — response.text is Gemini-only; causes AttributeError silently |
| 2026-04-01 | MAX_TOKENS=8192 constant | Named constant preferred over literal; 8192 prevents truncation on dense pages |
| 2026-04-01 | COMPLETENESS_THRESHOLD strict < 0.5 | 3/6 fields (0.5) is acceptable; only below 0.5 triggers review |

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
*Last updated: 2026-04-01 — Completed 01-claude-vision-extraction-service/01-01-PLAN.md*
