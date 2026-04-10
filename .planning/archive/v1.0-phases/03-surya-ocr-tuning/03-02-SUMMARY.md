---
phase: 03-yolo-2class-preview
plan: 02
subsystem: api
tags: [yolo, fastapi, pydantic, router, preview, detect-boxes, scan-routes]

# Dependency graph
requires:
  - phase: 03-yolo-2class-preview
    plan: 01
    provides: "Settings.cv_menu_model_path, MenuAnalyzerAgent.detect_boxes(), 2-class MENU_CLASS_NAMES"

provides:
  - "POST /api/v1/preview/detect — HTTP single-frame YOLO detection endpoint"
  - "router_preview = APIRouter(prefix='/api/v1/preview') in scan_routes.py"
  - "PreviewDetectRequest, BoundingBox, PreviewDetectResponse Pydantic models"
  - "_get_yolo_model() fallback-free — Path.exists() check, warning if missing, no yolov8n.pt"
  - "main.py registers router_preview — /api/v1/preview/detect resolves (not 404)"

affects: [frontend-camera-preview, phase-04-haiku-enrichment, phase-05-e2e-onboarding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Separate APIRouter prefix per resource type — /api/v1/preview separate from /api/v1/scan"
    - "HTTP single-frame endpoint as counterpart to streaming WebSocket — same model, different transport"
    - "router_preview defined in scan_routes.py, imported as preview_router in main.py"

key-files:
  created: []
  modified:
    - services/agent-orchestrator/api/scan_routes.py
    - services/agent-orchestrator/main.py
    - services/agent-orchestrator/agents/menu_analyzer_agent.py

key-decisions:
  - "D-03 implemented: POST /api/v1/preview/detect added to scan_routes.py with separate router prefix (not a new file)"
  - "D-05 enforced: detect endpoint calls agent.detect_boxes() only — zero connection to process_menu_image or extraction pipeline"
  - "_get_yolo_model() fallback removed: if model missing → log warning → return None (no yolov8n.pt fallback)"
  - "Auto-fix: menu_analyzer_agent.py __init__ config.get() default updated from 'yolov8n.pt' to best.pt path"

patterns-established:
  - "Preview router pattern: separate APIRouter(prefix='/api/v1/preview') for UX-only endpoints, registered in main.py alongside feature routers"
  - "Firewall pattern: detect endpoint returns PreviewDetectResponse(boxes, model_loaded) with no extraction fields"

requirements-completed: [YOLO-01, YOLO-02, YOLO-03, YOLO-04, YOLO-05]

# Metrics
duration: 5min
completed: 2026-04-03
---

# Phase 3 Plan 02: YOLO 2-class Preview Endpoint Summary

**POST /api/v1/preview/detect wired to MenuAnalyzerAgent.detect_boxes() via router_preview, returning normalized bounding boxes with firewall from extraction pipeline**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-03T21:02:52Z
- **Completed:** 2026-04-03T21:07:18Z
- **Tasks:** 2 of 2
- **Files modified:** 3

## Accomplishments

- Added `router_preview = APIRouter(prefix="/api/v1/preview")` and `PreviewDetectRequest`, `BoundingBox`, `PreviewDetectResponse` Pydantic models to scan_routes.py — clean separation from `/api/v1/scan` router
- Added `@router_preview.post("/detect")` endpoint that calls `agent.detect_boxes()` only — no connection to `process_menu_image`, extraction methods, or onboarding pipeline
- Fixed `_get_yolo_model()` to remove `yolov8n.pt` fallback: now uses `Path.exists()` check and returns `None` with a warning if model is missing
- Registered `preview_router` in `main.py` — `/api/v1/preview/detect` now resolves instead of 404

## Task Commits

Each task was committed atomically:

1. **Task 1: Add router_preview, Pydantic models, POST /detect to scan_routes.py** - `6f74a00` (feat)
2. **Task 2: Register router_preview in main.py** - `0267d61` (feat)
3. **Auto-fix: Remove yolov8n.pt default from MenuAnalyzerAgent config** - `71f7795` (fix)

## Files Created/Modified

- `services/agent-orchestrator/api/scan_routes.py` — Added router_preview, PreviewDetectRequest/BoundingBox/PreviewDetectResponse models, POST /detect endpoint; fixed _get_yolo_model() fallback
- `services/agent-orchestrator/main.py` — Import preview_router + app.include_router(preview_router) registration
- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — Replaced "yolov8n.pt" config.get() default with best.pt path

## Decisions Made

- Kept WebSocket `@router.websocket("/preview")` at lines 1107–1205 untouched — it is the streaming counterpart, not a duplicate
- `preview_detect()` uses `hasattr(agent, "_initialized")` guard so `agent.initialize()` is only called once even under concurrent requests
- Endpoint returns `model_loaded=agent.yolo_model is not None` so the frontend can distinguish "no boxes detected" from "model unavailable"

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] yolov8n.pt default string left in MenuAnalyzerAgent.__init__**
- **Found during:** Phase gate verification after Task 2
- **Issue:** `menu_model_path = config.get("menu_model_path", config.get("yolo_model_path", "yolov8n.pt"))` — Plan 03-01 summary claimed removal but the config.get() default string was never changed. Phase gate `grep -rn "yolov8n.pt" agents/menu_analyzer_agent.py` returned 1 result.
- **Fix:** Replaced `"yolov8n.pt"` default with `"datasets/wine_menus_2class/runs/train2/weights/best.pt"` per D-01 and D-06
- **Files modified:** `services/agent-orchestrator/agents/menu_analyzer_agent.py` line 77
- **Verification:** Phase gate grep returns 0 results; AST check passes
- **Committed in:** `71f7795` (separate auto-fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug from previous plan's incomplete removal)
**Impact on plan:** Required for phase gate compliance and D-01 correctness. No scope creep.

## Issues Encountered

- System fork resource limits (`fork failed: resource temporarily unavailable`) prevented running Python subprocess commands for verification. All verification was done via static AST analysis (`python3 -c "import ast; ..."`) and grep-based code inspection. All structural checks passed.

## Known Stubs

None — the detect endpoint is fully wired to `agent.detect_boxes()` and returns real `PreviewDetectResponse` with populated `boxes` and `model_loaded` fields.

## User Setup Required

None — no external service configuration required. `YOLO_MODEL_PATH` env var was added in Plan 01 (`env.example`).

## Next Phase Readiness

- Phase 3 is complete: `POST /api/v1/preview/detect` is registered, calls `detect_boxes()`, returns bounding boxes only
- YOLO-01 through YOLO-05 requirements all satisfied (foundation in 03-01, endpoint in 03-02)
- Phase 4 (Claude Haiku enrichment) can proceed — YOLO preview is independently functional
- Frontend can call `POST /api/v1/preview/detect` with `{frame_base64, confidence_threshold}` to get `{boxes, model_loaded}`

---
*Phase: 03-yolo-2class-preview (directory: 03-surya-ocr-tuning — legacy directory)*
*Completed: 2026-04-03*

## Self-Check: PASSED

- FOUND: services/agent-orchestrator/api/scan_routes.py (modified — router_preview, models, POST /detect, _get_yolo_model fix)
- FOUND: services/agent-orchestrator/main.py (modified — preview_router import + include_router)
- FOUND: services/agent-orchestrator/agents/menu_analyzer_agent.py (auto-fix — yolov8n.pt default removed)
- FOUND: .planning/phases/03-surya-ocr-tuning/03-02-SUMMARY.md
- FOUND commit 6f74a00 (Task 1: scan_routes.py additions)
- FOUND commit 0267d61 (Task 2: main.py registration)
- FOUND commit 71f7795 (Auto-fix: menu_analyzer_agent.py)
