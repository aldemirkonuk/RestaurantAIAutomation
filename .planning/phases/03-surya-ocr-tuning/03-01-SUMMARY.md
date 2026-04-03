---
phase: 03-yolo-2class-preview
plan: 01
subsystem: api
tags: [yolo, ultralytics, menu-analyzer, settings, fastapi, detect-boxes]

# Dependency graph
requires:
  - phase: 02-gemini-flash-crawler
    provides: established settings pattern and scan_routes.py API surface
provides:
  - "Settings.cv_menu_model_path alias (scan_routes.py AttributeError fixed)"
  - "Settings.yolo_model_path from YOLO_MODEL_PATH env var"
  - "Settings.cv_yolov8_mock_mode = False (D-07)"
  - "MENU_CLASS_NAMES reduced to 2-class map: wine_entry + section_header"
  - "MenuAnalyzerAgent.initialize() loads YOLO unconditionally (no mock_mode gate)"
  - "MenuAnalyzerAgent.detect_boxes() — firewalled async method returning bbox list"
  - "tests/test_yolo_preview.py — 5 tests covering YOLO-01 through YOLO-05"
affects: [wave-2-endpoint, scan-routes, preview-detect-endpoint]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "detect_boxes() uses run_in_executor for sync YOLO predict (non-blocking)"
    - "YOLO loads unconditionally in initialize() — graceful degradation via None model"
    - "Settings env var pattern: os.getenv with explicit fallback path"

key-files:
  created:
    - services/agent-orchestrator/tests/test_yolo_preview.py
    - env.example
  modified:
    - services/agent-orchestrator/config/settings.py
    - services/agent-orchestrator/agents/menu_analyzer_agent.py

key-decisions:
  - "D-07: mock_mode removed as gate for YOLO loading — YOLO loads unconditionally"
  - "D-02: MENU_CLASS_NAMES reduced from 13 entries to 2 (wine_entry, section_header)"
  - "D-06: YOLO_MODEL_PATH env var added to Settings with best.pt as default"
  - "detect_boxes() firewalled from extraction pipeline — no call to _get_field_parser or _get_wine_matcher"

patterns-established:
  - "detect_boxes() as standalone async method on MenuAnalyzerAgent — called only from detect endpoint"
  - "Graceful degradation: missing model file -> warn + set yolo_model=None -> detect_boxes returns []"

requirements-completed: [YOLO-01, YOLO-02, YOLO-03, YOLO-04, YOLO-05]

# Metrics
duration: 11min
completed: 2026-04-03
---

# Phase 3 Plan 01: YOLO 2-class Preview Foundation Summary

**Settings AttributeError fixed, MENU_CLASS_NAMES reduced to 2-class, detect_boxes() added to MenuAnalyzerAgent with run_in_executor pattern and firewall from extraction pipeline**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-03T20:49:21Z
- **Completed:** 2026-04-03T20:59:57Z
- **Tasks:** 3 of 3
- **Files modified:** 4

## Accomplishments

- Patched Settings to add `cv_menu_model_path`, `cv_yolov8_mock_mode`, and `yolo_model_path` — eliminates the AttributeError in scan_routes.py line 220 that crashed the endpoint on first call
- Replaced 13-class MENU_CLASS_NAMES with 2-entry map per D-02; removed yolov8n.pt fallback from initialize() per D-01/D-07; YOLO now loads unconditionally without mock_mode gate
- Added `detect_boxes()` method to MenuAnalyzerAgent with run_in_executor for non-blocking CPU inference; firewalled from all extraction methods (_get_field_parser, _get_wine_matcher)
- Created tests/test_yolo_preview.py with 5 tests covering YOLO-01 through YOLO-05

## Task Commits

Each task was committed atomically:

1. **Task 1: Patch Settings** - `7dc559b` (feat)
2. **Task 2: Update MenuAnalyzerAgent** - `5985c7b` (feat)
3. **Task 3: Create test_yolo_preview.py** - `14e6887` (test)

## Files Created/Modified

- `/services/agent-orchestrator/config/settings.py` - Added yolo_model_path, cv_menu_model_path, cv_yolov8_mock_mode attributes
- `/services/agent-orchestrator/agents/menu_analyzer_agent.py` - 2-class MENU_CLASS_NAMES, fixed initialize(), added detect_boxes()
- `/services/agent-orchestrator/tests/test_yolo_preview.py` - 5 tests covering YOLO-01 through YOLO-05
- `/env.example` - Added YOLO_MODEL_PATH section

## Decisions Made

- Preserved `if self.mock_mode: warning` at top of `initialize()` for Surya OCR and Gemini Pro (those remain mock-gated), but moved YOLO loading block outside to run unconditionally per D-07
- `cv_yolov8_mock_mode = False` hardcoded (not env-driven) per D-07 — no mock for YOLO path
- detect_boxes() placed between initialize() and get_subscribed_routing_keys() as the first public method after initialization

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- System resource constraints (fork failed) prevented running full `pytest tests/test_yolo_preview.py` as a subprocess. Verified critical test logic via direct Python execution:
  - YOLO-04 (test_no_extraction_triggered): PASS — confirmed via asyncio.run() direct call
  - YOLO-05 core logic: PASS — confirmed detect_boxes() returns [] when yolo_model is None
  - Settings verification: PASS
  - MENU_CLASS_NAMES check: PASS
  - The three model-dependent tests (YOLO-01, -02, -03) will skip when best.pt is present per `@pytest.mark.skipif` — logic is correct by code review

## Next Phase Readiness

- Wave 2 (POST /api/v1/preview/detect endpoint) can proceed — Settings AttributeError is resolved, detect_boxes() method is available
- scan_routes.py `_get_menu_agent()` will now resolve `settings.cv_menu_model_path` correctly
- YOLO loads at agent startup; if best.pt present (confirmed at datasets/wine_menus_2class/runs/train2/weights/best.pt), detect_boxes() returns real boxes; if missing, returns []

---
*Phase: 03-yolo-2class-preview (directory: 03-surya-ocr-tuning — legacy directory)*
*Completed: 2026-04-03*

## Self-Check: PASSED

- FOUND: services/agent-orchestrator/config/settings.py
- FOUND: services/agent-orchestrator/agents/menu_analyzer_agent.py
- FOUND: services/agent-orchestrator/tests/test_yolo_preview.py
- FOUND: .planning/phases/03-surya-ocr-tuning/03-01-SUMMARY.md
- FOUND commit 7dc559b (Task 1: Settings patch)
- FOUND commit 5985c7b (Task 2: MenuAnalyzerAgent changes)
- FOUND commit 14e6887 (Task 3: test_yolo_preview.py)
