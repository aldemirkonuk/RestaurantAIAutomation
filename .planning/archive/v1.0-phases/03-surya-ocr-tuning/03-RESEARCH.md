# Phase 3: YOLO 2-class Real-time Preview — Research

**Researched:** 2026-04-03
**Domain:** Ultralytics YOLO inference, FastAPI endpoint design, Python async patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Replace the existing 13-class `yolov8n.pt` path entirely. No coexistence. The old path was never a real trained model — just a placeholder.
- **D-02:** Replace `MENU_CLASS_NAMES` with the 2-class map: `{0: "wine_entry", 1: "section_header"}`. Remove all 13 legacy class entries. No legacy alias kept.
- **D-03:** New endpoint `POST /api/v1/preview/detect` added to `scan_routes.py` (not a new file).
- **D-04:** No new standalone module. Inference logic lives in `MenuAnalyzerAgent`, called from the new scan_routes endpoint.
- **D-05:** Firewall guarantee — no code path from YOLO box detection to text extraction. The detect endpoint returns only boxes.
- **D-06:** Model path read from env var `YOLO_MODEL_PATH`. Default fallback: `datasets/wine_menus_2class/runs/train2/weights/best.pt`.
- **D-07:** `mock_mode` removed for the YOLO path entirely. Graceful degradation is model-not-found: log warning at startup, detect endpoint returns empty boxes `[]`.

### Claude's Discretion

- Box output format: normalized [0-1] coords vs pixel coords (normalized is conventional for YOLO outputs and better for canvas drawing)
- Confidence threshold for 2-class model (existing 0.3 is a reasonable starting point)
- Exact request/response Pydantic schema for the detect endpoint
- asyncio handling for inference (YOLO is sync — run in executor if needed)

### Deferred Ideas (OUT OF SCOPE)

- Multi-frame streaming (WebSocket for live camera) — new capability, own phase
- Confidence threshold tuning via config — can be added after Phase 3 if needed
- 13-class full-detection model revival — retired
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| YOLO-01 | YOLO 2-class best.pt loaded in menu_analyzer_agent on startup | Model file confirmed present; lazy-load pattern documented |
| YOLO-02 | Camera frame → YOLO inference → bounding boxes returned in <200ms on CPU | Eval report shows 0.048s on CPU for 2352x1076; 1280x720 will be faster |
| YOLO-03 | Boxes drawn on frame with class label (wine_entry / section_header) — UI only | model.names dict provides labels; Results.boxes.cls gives class IDs |
| YOLO-04 | YOLO output does NOT trigger extraction — extraction only triggered on user capture | Endpoint returns boxes only; no code path to extract methods documented |
| YOLO-05 | Graceful fallback if model file missing: camera preview still works, boxes disabled | Pattern: Path.exists() check + logger.warning + return [] |
</phase_requirements>

---

## Summary

Phase 3 wires the trained 2-class YOLO model (`best.pt` confirmed at `datasets/wine_menus_2class/runs/train2/weights/best.pt`) into `menu_analyzer_agent.py` and exposes it through a new `POST /api/v1/preview/detect` endpoint in `scan_routes.py`. The change is surgical: replace a 13-entry class map with a 2-entry one, update the model path, remove mock_mode from the YOLO path, and add a lean detect endpoint that returns boxes only.

The codebase already has a WebSocket YOLO preview at `GET /api/v1/scan/preview` (lines 1071-1169 of scan_routes.py) which demonstrates the exact pattern for running YOLO inference and formatting box output. The new `POST /api/v1/preview/detect` endpoint is the HTTP (single-frame) equivalent of that WebSocket handler — it is the simpler counterpart, not a duplicate.

A critical discovery: `config/settings.py` does not yet define `cv_menu_model_path`, `cv_yolov8_mock_mode`, or the `YOLO_MODEL_PATH` env var. These are accessed in scan_routes.py lines 220-222 and would currently raise `AttributeError`. The plan must add these attributes to `Settings` before the endpoint can work.

**Primary recommendation:** Add `YOLO_MODEL_PATH` to Settings, replace MENU_CLASS_NAMES and model path in menu_analyzer_agent.py, add the POST detect endpoint following the existing WebSocket pattern, add a standalone `detect_boxes()` method to MenuAnalyzerAgent that the endpoint calls directly.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ultralytics | 8.x (confirmed in venv) | YOLO model load + predict | Already installed; used by existing WebSocket preview |
| Pillow (PIL) | Already installed | Image decode from base64 | Used throughout menu_analyzer_agent.py |
| FastAPI | Already installed | Endpoint framework | Project standard; all routes use it |
| pydantic | v2 | Request/response models | Project standard; BaseModel already in scan_routes.py |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| asyncio.get_event_loop().run_in_executor | stdlib | Run sync YOLO predict on thread pool | YOLO.predict() is synchronous; FastAPI routes are async |
| pathlib.Path | stdlib | Model file existence check | Used in existing initialize() — same pattern |
| numpy | Already installed | img_array for YOLO predict | Existing WebSocket already uses `np.array(img)` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `run_in_executor` for YOLO | Direct sync call | Sync call blocks the event loop; executor keeps FastAPI responsive |
| Normalized coords (xyxyn) | Pixel coords (xyxy) | Frontend canvas math is simpler with normalized; YOLO provides both |

**Installation:** No new packages needed. All dependencies already present in venv.

---

## Architecture Patterns

### Existing YOLO Pattern (WebSocket — lines 1048-1169 of scan_routes.py)

The project already contains a working YOLO-over-HTTP implementation in the WebSocket at `/api/v1/scan/preview`. This is the canonical reference:

```python
# Source: services/agent-orchestrator/api/scan_routes.py lines 1126-1151
results = model.predict(
    img_array,
    conf=0.25,
    verbose=False,
    imgsz=640,
)

boxes = []
if results and len(results) > 0:
    result = results[0]
    if result.boxes is not None:
        for box in result.boxes:
            xyxy = box.xyxy[0].cpu().numpy()
            conf = float(box.conf[0].cpu().numpy())
            cls_id = int(box.cls[0].cpu().numpy())
            label = model.names.get(cls_id, f"class_{cls_id}")
            boxes.append({
                "x": float(xyxy[0]),
                "y": float(xyxy[1]),
                "width": float(xyxy[2] - xyxy[0]),
                "height": float(xyxy[3] - xyxy[1]),
                "label": label,
                "confidence": round(conf, 3),
                "classId": cls_id,
            })
```

This pattern uses pixel coords. For the new POST endpoint, normalized coords (`box.xyxyn`) are preferred for canvas drawing (Claude's discretion per CONTEXT.md). The Results object has both.

### Lazy-Load Pattern (menu_analyzer_agent.py — lines 42-49, 88-98, 319-333)

```python
# Source: services/agent-orchestrator/agents/menu_analyzer_agent.py lines 42-49
def _check_yolo():
    global YOLO_AVAILABLE
    try:
        from ultralytics import YOLO
        YOLO_AVAILABLE = True
        return True
    except Exception:
        return False
```

The `initialize()` method (lines 310-358) calls `_check_yolo()`, checks `Path(model_path).exists()`, loads the model, and logs a warning if not found. Phase 3 removes the fallback to `yolov8n.pt` — if `best.pt` is missing, log warning and leave `self.yolo_model = None`.

### MenuAnalyzerAgent Config Pattern (lines 84-99)

```python
# Source: services/agent-orchestrator/agents/menu_analyzer_agent.py lines 88-90
self.menu_model_path = config.get("menu_model_path", config.get("yolo_model_path", "yolov8n.pt"))
self.confidence_threshold = config.get("confidence_threshold", 0.3)
self.mock_mode = config.get("mock_mode", True)
```

For Phase 3: `menu_model_path` default changes to `"datasets/wine_menus_2class/runs/train2/weights/best.pt"`. `mock_mode` is removed from the YOLO code path per D-07 (the field can remain in config for other uses, but `initialize()` must NOT gate YOLO loading on `mock_mode`).

### Settings Pattern (config/settings.py)

Current Settings class defines only `claude_api_key`, `supabase_url`, `supabase_key`. The `cv_menu_model_path` and `cv_yolov8_mock_mode` referenced in scan_routes.py lines 220-222 do not yet exist. Pattern to follow (consistent with existing `os.getenv` style):

```python
# To add to config/settings.py Settings.__init__:
self.yolo_model_path: str = os.getenv(
    "YOLO_MODEL_PATH",
    "datasets/wine_menus_2class/runs/train2/weights/best.pt"
)
# Properties scan_routes.py already references:
self.cv_menu_model_path: str = self.yolo_model_path
self.cv_yolov8_mock_mode: bool = False  # D-07: no mock for YOLO
```

### New POST Endpoint Pattern (following existing endpoints in scan_routes.py)

```python
# Pattern — lines 276-328 of scan_routes.py show the shape
class PreviewDetectRequest(BaseModel):
    frame_base64: str  # base64-encoded JPEG/PNG of camera frame
    confidence_threshold: float = 0.3

class BoundingBox(BaseModel):
    x1: float  # normalized [0-1]
    y1: float
    x2: float
    y2: float
    label: str   # "wine_entry" or "section_header"
    confidence: float

class PreviewDetectResponse(BaseModel):
    boxes: List[BoundingBox]
    model_loaded: bool

# New router prefix: /api/v1/preview (separate from /api/v1/scan)
router_preview = APIRouter(prefix="/api/v1/preview", tags=["preview"])

@router_preview.post("/detect", response_model=PreviewDetectResponse)
async def detect_boxes(request: PreviewDetectRequest):
    agent = _get_menu_agent()
    boxes = await agent.detect_boxes(request.frame_base64, request.confidence_threshold)
    return PreviewDetectResponse(boxes=boxes, model_loaded=agent.yolo_model is not None)
```

### New detect_boxes() Method on MenuAnalyzerAgent

This is the method the endpoint calls — it lives inside MenuAnalyzerAgent per D-04:

```python
async def detect_boxes(
    self,
    frame_base64: str,
    confidence: float = 0.3,
) -> List[Dict[str, Any]]:
    """
    Run YOLO 2-class inference on a single camera frame.
    Returns bounding boxes only. NEVER triggers extraction.
    """
    if self.yolo_model is None:
        return []

    loop = asyncio.get_event_loop()

    def _run_inference():
        from PIL import Image
        import numpy as np
        img_bytes = base64.b64decode(frame_base64)
        img = Image.open(io.BytesIO(img_bytes))
        img_array = np.array(img)
        results = self.yolo_model.predict(
            img_array, conf=confidence, verbose=False
        )
        boxes = []
        if results and results[0].boxes is not None:
            for box in results[0].boxes:
                xyxyn = box.xyxyn[0].cpu().numpy()  # normalized coords
                cls_id = int(box.cls[0].cpu().numpy())
                conf_val = float(box.conf[0].cpu().numpy())
                label = MENU_CLASS_NAMES.get(cls_id, f"class_{cls_id}")
                boxes.append({
                    "x1": float(xyxyn[0]),
                    "y1": float(xyxyn[1]),
                    "x2": float(xyxyn[2]),
                    "y2": float(xyxyn[3]),
                    "label": label,
                    "confidence": round(conf_val, 3),
                })
        return boxes

    return await loop.run_in_executor(None, _run_inference)
```

### Anti-Patterns to Avoid

- **Calling `detect_boxes()` from within `_detect_wine_regions()`:** This would connect YOLO preview to the extraction pipeline. They must remain completely separate — `detect_boxes()` is a new standalone method only called from the detect endpoint.
- **Falling back to `yolov8n.pt` when best.pt is missing:** Per D-01 and D-07, if the file is missing, return `[]`. Do NOT load any YOLO model as a fallback.
- **Mock mode gate on YOLO load:** The existing `initialize()` wraps YOLO loading inside `if not self.mock_mode`. Per D-07, this gate must be removed for the YOLO block. The model loads (or logs warning and returns) regardless of mock_mode.
- **Blocking event loop with synchronous predict:** Always use `run_in_executor` — YOLO.predict() is CPU-bound and synchronous.

---

## Critical Discovery: Settings AttributeError

`scan_routes.py` line 220 references `settings.cv_menu_model_path` and line 222 references `settings.cv_yolov8_mock_mode`. The current `config/settings.py` Settings class does NOT define these attributes. If the scan_routes module is imported without these properties, it will raise `AttributeError` at runtime when `_get_menu_agent()` is first called.

The plan MUST include a task to add these to `Settings.__init__` before or alongside the endpoint task. Failing to do so means the new endpoint crashes on first call.

Also: `orchestrator.py` line 262 still uses `"yolo_model_path": getattr(self.settings, "yolo_model_path", "yolov8n.pt")` — after this phase it should resolve to the 2-class best.pt path. The `getattr` fallback `"yolov8n.pt"` would still apply if the attribute is missing, so Settings must expose `yolo_model_path` (which scan_routes aliases as `cv_menu_model_path`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image decode from base64 | Custom byte parser | `base64.b64decode` + `PIL.Image.open(BytesIO(...))` | Already used in `_detect_wine_regions()` lines 558-559 |
| Box normalization | Manual division by W/H | `box.xyxyn` from ultralytics | YOLO Results object provides normalized coords natively |
| Thread safety for model | Lock/semaphore | Module-level `_yolo_model` singleton (existing pattern) | Already used for `_get_yolo_model()` at line 1048 — same pattern for `_get_menu_agent()` |
| Async YOLO | Custom thread pool | `asyncio.get_event_loop().run_in_executor(None, fn)` | Same pattern used for Surya OCR at lines 666-668 |

---

## Model Asset Details

| Property | Value |
|----------|-------|
| Path | `datasets/wine_menus_2class/runs/train2/weights/best.pt` |
| File confirmed | Yes (via Glob) |
| Architecture | YOLOv8s (from training_config.json) |
| Classes | 2 — `wine_entry` (0), `section_header` (1) |
| Training image size | 640px |
| Training device | CPU |
| CPU inference time | 0.048s on 2352x1076 (train/weights eval report) |
| Expected <200ms | Confirmed — measured 48ms on a larger-than-spec frame |

Note: The `train/` eval report measured `train/weights/best.pt` (the cache-bug run, mAP50=0.34). The `train2/weights/best.pt` is the correct retrained model. Inference latency will be similar since both use YOLOv8s architecture with imgsz=640.

---

## Common Pitfalls

### Pitfall 1: mock_mode Gate Blocks YOLO Load
**What goes wrong:** `initialize()` currently has `if self.mock_mode: ... else: [YOLO load]`. If `mock_mode=True` (the current default), YOLO never loads, and `detect_boxes()` always returns `[]` even when best.pt is present.
**Why it happens:** The mock_mode gate was for the full 4-layer pipeline, not YOLO specifically.
**How to avoid:** Per D-07, remove `mock_mode` as a gate for the YOLO loading block in `initialize()`. Load YOLO unconditionally (falling back gracefully if file not found).
**Warning signs:** `agent.yolo_model is None` even though best.pt exists.

### Pitfall 2: Settings AttributeError Crashes the Endpoint
**What goes wrong:** `_get_menu_agent()` calls `settings.cv_menu_model_path` — AttributeError on first request.
**Why it happens:** `config/settings.py` is minimal (3 attributes) and does not yet define cv_* properties.
**How to avoid:** Add `cv_menu_model_path`, `cv_yolov8_mock_mode` (= False), and `yolo_model_path` to `Settings.__init__` in the same wave as the endpoint task.
**Warning signs:** HTTP 500 on POST /api/v1/preview/detect; traceback shows AttributeError in scan_routes.py line 220.

### Pitfall 3: Router Prefix Collision
**What goes wrong:** Adding `POST /api/v1/preview/detect` to the existing `router` (prefix `/api/v1/scan`) results in the URL being `POST /api/v1/scan/preview/detect` instead of `/api/v1/preview/detect`.
**Why it happens:** The existing router at line 75 has `prefix="/api/v1/scan"`.
**How to avoid:** Create a second `APIRouter(prefix="/api/v1/preview")` within scan_routes.py and register it in the app's main.py. OR add the route to the existing router with a path of `/preview/detect` (producing `/api/v1/scan/preview/detect`). The CONTEXT.md specifies `POST /api/v1/preview/detect`, so a new router prefix is needed unless the URL convention is reconsidered.
**Warning signs:** 404 on POST /api/v1/preview/detect; route shows under /api/v1/scan/preview/detect in FastAPI docs.

### Pitfall 4: YOLO imgsz Must Match Training
**What goes wrong:** Passing a 1280x720 image without specifying `imgsz` — YOLO auto-resizes but with the wrong inference size.
**Why it happens:** Training used `imgsz=640`. Inference should match.
**How to avoid:** Always pass `imgsz=640` in the `predict()` call. YOLO handles the resize internally.
**Warning signs:** Lower mAP / poor boxes on camera frames; latency higher than expected.

### Pitfall 5: 13-class Class Names Leaking into detect_boxes()
**What goes wrong:** `MENU_CLASS_NAMES` still has 13 entries; the 2-class model returns `cls_id` 0 or 1 only, but MENU_CLASS_NAMES lookup for ids > 1 would fail silently.
**Why it happens:** Forgetting to replace the dict as part of the change.
**How to avoid:** Per D-02, replace the entire `MENU_CLASS_NAMES` dict at lines 52-67 of menu_analyzer_agent.py. It is global — `_detect_wine_regions()` also reads it, so the replacement is backward-compatible for the 0/1 entries.

---

## Code Examples

### Ultralytics YOLO Results Object — Normalized Boxes
```python
# Results.boxes properties (ultralytics 8.x)
# box.xyxy   — [x1, y1, x2, y2] pixel coords (float tensor)
# box.xyxyn  — [x1, y1, x2, y2] normalized [0-1] coords
# box.conf   — confidence scalar
# box.cls    — class id scalar
# box.xywhn  — [cx, cy, w, h] normalized (center format)

results = model.predict(img_array, conf=0.3, verbose=False, imgsz=640)
result = results[0]
for box in result.boxes:
    xyxyn = box.xyxyn[0].cpu().numpy()   # shape (4,)
    conf  = float(box.conf[0])
    cls   = int(box.cls[0])
    label = result.names[cls]             # "wine_entry" or "section_header"
```

### Graceful Degradation — model-not-found
```python
# In MenuAnalyzerAgent.initialize():
from pathlib import Path
model_path = self.menu_model_path  # from config or env
if not Path(model_path).exists():
    logger.warning(
        f"YOLO model not found at {model_path}. "
        "YOLO detection disabled — detect_boxes() will return []."
    )
    self.yolo_model = None
else:
    from ultralytics import YOLO
    self.yolo_model = YOLO(model_path)
    logger.info(f"YOLO 2-class model loaded: {model_path}")
```

### env.example Addition
```bash
# ============================================================================
# YOLO PREVIEW MODEL
# ============================================================================
YOLO_MODEL_PATH=datasets/wine_menus_2class/runs/train2/weights/best.pt
```

### main.py Router Registration (if new router prefix needed)
```python
# In services/agent-orchestrator/main.py (or wherever routers are registered):
from api.scan_routes import router as scan_router, router_preview as preview_router
app.include_router(scan_router)
app.include_router(preview_router)
```

---

## Existing WebSocket Preview (Do Not Duplicate)

scan_routes.py already has `@router.websocket("/preview")` at line 1071, which runs YOLO inference for live camera feed. This WebSocket is NOT being replaced or removed — it is the streaming path. The new `POST /api/v1/preview/detect` is the single-frame HTTP path (e.g., for mobile clients that want to send one frame and get boxes back without maintaining a WebSocket connection).

The two share the same model file and box format. The WebSocket uses `_get_yolo_model()` (a separate singleton at line 1048). The POST endpoint uses `_get_menu_agent()` which holds `self.yolo_model`. Both will point to the same best.pt after this phase.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| ultralytics | YOLO inference | Confirmed in venv | 8.x (venv/lib/python3.11/site-packages) | None — plan must ensure venv is active |
| Pillow (PIL) | Image decode | Confirmed in venv | Already in use | None |
| numpy | img_array conversion | Confirmed in venv | Already in use | None |
| best.pt model file | YOLO-01, YOLO-02 | Confirmed present | train2 weights | Returns [] (graceful per YOLO-05) |
| FastAPI | Endpoint | Confirmed | Already running | None |

**Missing dependencies with no fallback:** None — all required packages confirmed in venv.

**Environment note:** The venv is at `services/agent-orchestrator/venv/`. The pytest.ini testpaths is `tests/`. All test commands must be run from `services/agent-orchestrator/` with the venv activated.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (pytest.ini confirmed) |
| Config file | `services/agent-orchestrator/pytest.ini` |
| Async mode | `asyncio_mode = auto` |
| Quick run command | `cd services/agent-orchestrator && python -m pytest tests/test_yolo_preview.py -v --tb=short` |
| Full suite command | `cd services/agent-orchestrator && python -m pytest tests/ -v --tb=short` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| YOLO-01 | 2-class best.pt loads in MenuAnalyzerAgent.initialize() | unit | `pytest tests/test_yolo_preview.py::test_yolo_model_loads -x` | No — Wave 0 |
| YOLO-02 | Inference on simulated 1280x720 frame returns in <200ms | unit (timed) | `pytest tests/test_yolo_preview.py::test_inference_latency -x` | No — Wave 0 |
| YOLO-03 | Boxes include label "wine_entry" or "section_header" and confidence | unit | `pytest tests/test_yolo_preview.py::test_box_labels -x` | No — Wave 0 |
| YOLO-04 | detect_boxes() result is only boxes — no extraction call | unit | `pytest tests/test_yolo_preview.py::test_no_extraction_triggered -x` | No — Wave 0 |
| YOLO-05 | Missing model file: agent starts, logs warning, returns [] | unit | `pytest tests/test_yolo_preview.py::test_model_missing_graceful -x` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `cd services/agent-orchestrator && python -m pytest tests/test_yolo_preview.py -v --tb=short`
- **Per wave merge:** `cd services/agent-orchestrator && python -m pytest tests/ -v --tb=short`
- **Phase gate:** All 5 YOLO-* tests green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_yolo_preview.py` — covers YOLO-01 through YOLO-05. Must be created as Wave 0 of the plan.

**Test implementation guidance for each requirement:**

**YOLO-01:** Instantiate `MenuAnalyzerAgent` with `menu_model_path` pointing to the real best.pt path. Call `await agent.initialize()`. Assert `agent.yolo_model is not None`.

**YOLO-02:** Create a synthetic 1280x720 RGB PIL Image (blank or noise), base64-encode it. Record `time.perf_counter()` before/after calling `await agent.detect_boxes(frame_b64)`. Assert elapsed < 0.200.

**YOLO-03:** Use the same synthetic frame as YOLO-02 (real YOLO call). For any returned box, assert `box["label"] in ("wine_entry", "section_header")` and `0.0 <= box["confidence"] <= 1.0`. If boxes list is empty (model returns no detections on synthetic frame), use a real menu image from `datasets/annotation_images/` — at least one exists.

**YOLO-04:** Mock `_get_field_parser()` and `_get_wine_matcher()` on the agent. Call `detect_boxes()` and verify the return value is a list of dicts, never a coroutine that touches field parsing. Assertion: `_get_field_parser` was never called during the detect_boxes invocation (`MagicMock.assert_not_called()`).

**YOLO-05:** Instantiate `MenuAnalyzerAgent` with `menu_model_path="nonexistent/path/best.pt"`. Call `await agent.initialize()`. Assert `agent.yolo_model is None`. Assert `await agent.detect_boxes(some_frame_b64) == []`.

---

## Project Constraints (from CLAUDE.md)

No `CLAUDE.md` was found at the project root. No overriding project-wide constraints to document beyond what is in CONTEXT.md above.

---

## Open Questions

1. **Router prefix for the new endpoint**
   - What we know: Existing router has `prefix="/api/v1/scan"`. CONTEXT.md specifies `POST /api/v1/preview/detect`.
   - What's unclear: Whether main.py can register a second router from scan_routes.py, or whether the URL should be `/api/v1/scan/preview/detect` instead.
   - Recommendation: Find main.py and check how routers are registered. If adding a second router is straightforward, keep `/api/v1/preview/detect`. If not, use `/api/v1/scan/preview/detect` and note the URL in the plan. The plan should confirm before implementing.

2. **_get_yolo_model() singleton vs. MenuAnalyzerAgent.yolo_model**
   - What we know: WebSocket uses `_get_yolo_model()` module-level singleton. POST endpoint will use `_get_menu_agent().yolo_model`. Both load best.pt.
   - What's unclear: After this phase, `_get_yolo_model()` still points to the old logic (`yolov8n.pt` fallback at line 1063). Should it be updated to also use best.pt, or left alone?
   - Recommendation: Update `_get_yolo_model()` to use `settings.cv_menu_model_path` (no fallback to `yolov8n.pt`) for consistency. This is a 2-line change and prevents the WebSocket from using the wrong model.

---

## Sources

### Primary (HIGH confidence)
- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — full file read, all YOLO patterns, class map, initialize(), lazy-load, mock_mode usage
- `services/agent-orchestrator/api/scan_routes.py` — full file read, existing WebSocket YOLO preview (lines 1071-1169), _get_menu_agent() config (lines 219-225), established Pydantic patterns
- `services/agent-orchestrator/config/settings.py` — full read, confirmed missing cv_menu_model_path attribute
- `datasets/wine_menus_2class/runs/train2/training_config.json` — confirmed: nc=2, classes=[wine_entry, section_header], architecture=yolov8s, imgsz=640, device=cpu
- `datasets/wine_menus_2class/runs/train/eval_report.md` — CPU inference time 0.048s confirmed (well under 200ms)
- `services/agent-orchestrator/pytest.ini` — asyncio_mode=auto, testpaths=tests

### Secondary (MEDIUM confidence)
- File glob confirming `best.pt` exists at `datasets/wine_menus_2class/runs/train2/weights/best.pt`
- `env.example` — env var naming convention (UPPER_SNAKE_CASE, grouped by service)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed in venv, no new dependencies
- Architecture patterns: HIGH — read directly from source files, not inferred
- Pitfalls: HIGH — identified from actual code inspection (AttributeError, mock_mode gate, router prefix)
- Test approach: HIGH — pytest.ini exists, asyncio_mode=auto confirmed

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable libraries; model file path is static)

---

## RESEARCH COMPLETE
