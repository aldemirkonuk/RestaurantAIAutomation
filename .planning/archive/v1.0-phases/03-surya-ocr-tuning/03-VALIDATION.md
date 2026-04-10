---
phase: 3
phase_slug: yolo-2class-preview
date: 2026-04-03
---

# Phase 3 — Validation Strategy

## Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest |
| Config | `services/agent-orchestrator/pytest.ini` |
| Async mode | `asyncio_mode = auto` |
| Test file | `services/agent-orchestrator/tests/test_yolo_preview.py` |
| Run command | `cd services/agent-orchestrator && python -m pytest tests/test_yolo_preview.py -v --tb=short` |

## Requirements → Test Map

| Req ID | Behavior | Test | Command |
|--------|----------|------|---------|
| YOLO-01 | 2-class best.pt loads in MenuAnalyzerAgent.initialize() | `test_yolo_model_loads` | `pytest tests/test_yolo_preview.py::test_yolo_model_loads -x` |
| YOLO-02 | Inference on 1280×720 frame returns in <200ms | `test_inference_latency` | `pytest tests/test_yolo_preview.py::test_inference_latency -x` |
| YOLO-03 | Boxes include label + confidence | `test_box_labels` | `pytest tests/test_yolo_preview.py::test_box_labels -x` |
| YOLO-04 | detect_boxes() never triggers text extraction | `test_no_extraction_triggered` | `pytest tests/test_yolo_preview.py::test_no_extraction_triggered -x` |
| YOLO-05 | Missing model: agent starts, logs warning, returns [] | `test_model_missing_graceful` | `pytest tests/test_yolo_preview.py::test_model_missing_graceful -x` |

## Sampling Cadence

- **Per task:** `pytest tests/test_yolo_preview.py -v --tb=short`
- **Per wave:** `pytest tests/ -v --tb=short`
- **Phase gate:** All 5 YOLO-* tests green before `/gsd:verify-work`

## Wave 0 Gaps

- [ ] `tests/test_yolo_preview.py` must be created as part of the plan (Wave 1)

## Test Implementation Guidance

**YOLO-01:** Instantiate `MenuAnalyzerAgent` with `menu_model_path` pointing to the real best.pt path. Call `await agent.initialize()`. Assert `agent.yolo_model is not None`.

**YOLO-02:** Create a synthetic 1280×720 RGB PIL Image, base64-encode it. Record `time.perf_counter()` before/after calling `await agent.detect_boxes(frame_b64)`. Assert elapsed < 0.200.

**YOLO-03:** Same synthetic frame (real YOLO call). For any returned box, assert `box["label"] in ("wine_entry", "section_header")` and `0.0 <= box["confidence"] <= 1.0`. If no detections on synthetic frame, use a real menu image from `datasets/annotation_images/`.

**YOLO-04:** Mock `_get_field_parser()` and `_get_wine_matcher()` on the agent. Call `detect_boxes()`. Assert `_get_field_parser.assert_not_called()` — no extraction pipeline touched.

**YOLO-05:** Instantiate `MenuAnalyzerAgent` with `menu_model_path="nonexistent/path/best.pt"`. Call `await agent.initialize()`. Assert `agent.yolo_model is None`. Assert `await agent.detect_boxes(some_frame_b64) == []`.
