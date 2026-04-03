# Phase 3: YOLO 2-class Real-time Preview — Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire `datasets/wine_menus_2class/runs/train2/weights/best.pt` into `menu_analyzer_agent.py` for camera-feed bounding box drawing only. YOLO is **UX preview** — it shows boxes on screen. It does NOT trigger extraction. Claude Vision is the extraction brain (Phase 1). This phase produces a new `POST /api/v1/preview/detect` endpoint that takes a camera frame and returns boxes.
</domain>

<decisions>
## Implementation Decisions

### 13-class Path Replacement
- **D-01:** Replace the existing 13-class `yolov8n.pt` path **entirely**. No coexistence. The old path was never a real trained model — just a placeholder (`yolov8n.pt` base model, untrained on menus).
- **D-02:** Replace `MENU_CLASS_NAMES` with the 2-class map: `{0: "wine_entry", 1: "section_header"}`. Remove all 13 legacy class entries. No legacy alias kept.

### Integration Point
- **D-03:** New endpoint `POST /api/v1/preview/detect` added to **`scan_routes.py`** (not a new file). Camera feed/frontend calls this endpoint with a base64 frame and gets back bounding boxes.
- **D-04:** No new standalone module. The inference logic lives in `MenuAnalyzerAgent` (reusing its existing lazy YOLO load pattern), called from the new scan_routes endpoint.
- **D-05:** Firewall guarantee — **no code path from YOLO box detection to text extraction**. The detect endpoint returns only boxes. Any extraction must go through `POST /api/v1/onboarding/extract`.

### Config & Model Path
- **D-06:** Model path read from env var `YOLO_MODEL_PATH`. Default fallback: `datasets/wine_menus_2class/runs/train2/weights/best.pt`. Consistent with how Google/Anthropic keys are handled in `.env`.
- **D-07:** `mock_mode` removed for the YOLO path entirely. Graceful degradation is model-not-found: log warning at startup, detect endpoint returns empty boxes `[]`. No mock needed — empty boxes is the correct degraded behavior.

### Claude's Discretion
- Box output format (normalized [0-1] coords vs pixel coords) — pick whichever is more useful for a frontend that draws on a canvas; normalized is conventional for YOLO outputs
- Confidence threshold for 2-class model (existing 0.3 is a reasonable starting point)
- Exact request/response Pydantic schema for the detect endpoint
- asyncio handling for inference (YOLO is sync — run in executor if needed)
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Code to Modify
- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — File to modify. Current MENU_CLASS_NAMES (lines 52-67), YOLO lazy-load pattern (lines 42-49, 97-98), config pattern (lines 88-90). Replace 13-class path, update class map.
- `services/agent-orchestrator/api/scan_routes.py` — File to modify. Add POST /api/v1/preview/detect endpoint here (not a new file).

### Model Asset
- `datasets/wine_menus_2class/runs/train2/weights/best.pt` — The trained 2-class model. Confirmed present. This is the ONLY YOLO model used after this phase.

### Architecture Decisions
- `.planning/PROJECT.md` — Key Decisions table. "YOLO is UX preview, Claude Vision is the extraction brain" is a non-negotiable architectural boundary.
- `.planning/REQUIREMENTS.md` — YOLO-01 through YOLO-05 acceptance criteria.

### Phase 1 Context (Patterns to Follow)
- `.planning/phases/01-claude-vision-extraction-service/01-CONTEXT.md` — Established patterns: hard fail on errors, no silent fallbacks, cost transparency, separate concerns.
</canonical_refs>

<specifics>
## Specific References

- `best.pt` confirmed at: `datasets/wine_menus_2class/runs/train2/weights/best.pt`
- ROADMAP timing: < 200ms inference on CPU for 1280×720 frame (YOLO-02)
- ROADMAP success criteria 5: "If model file missing: agent starts normally, logs warning, returns empty boxes" — this is the full graceful degradation spec
- Current agent `mock_mode = True` default must NOT remain — D-07 removes mock_mode for YOLO path
</specifics>

<deferred>
## Deferred Ideas

- Multi-frame streaming (WebSocket for live camera) — new capability, own phase
- Confidence threshold tuning via config — can be added as a quick task after Phase 3 if needed
- 13-class full-detection model revival — retired. The 2-class model is the YOLO story going forward.
</deferred>

---
*Phase: 03-yolo-2class-preview (directory: 03-surya-ocr-tuning — legacy directory from retired pipeline)*
*Context gathered: 2026-04-03 via discuss-phase*
