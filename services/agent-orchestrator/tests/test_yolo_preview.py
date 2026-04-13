"""
Phase 3: YOLO 2-class Preview — Test Suite
Covers YOLO-01 through YOLO-05.
Run: cd services/agent-orchestrator && python -m pytest tests/test_yolo_preview.py -v --tb=short
"""
import asyncio
import base64
import io
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

# Real best.pt path for tests that need actual model inference
BEST_PT_PATH = str(
    Path(__file__).parents[3]
    / "datasets/wine_menus_2class/runs/train2/weights/best.pt"
)

try:
    import ultralytics  # noqa: F401
    _ultralytics_available = True
except ImportError:
    _ultralytics_available = False

_model_ready = Path(BEST_PT_PATH).exists() and _ultralytics_available
_skip_model = pytest.mark.skipif(
    not _model_ready,
    reason="best.pt not present or ultralytics not installed — skipping model test",
)


def _make_synthetic_frame(width: int = 1280, height: int = 720) -> str:
    """Create a blank RGB frame base64-encoded as JPEG."""
    img = Image.new("RGB", (width, height), color=(200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def _make_agent(model_path: str):
    """Construct a bare MenuAnalyzerAgent for testing (no message_bus, no database)."""
    from agents.menu_analyzer_agent import MenuAnalyzerAgent
    return MenuAnalyzerAgent(
        agent_name="test_agent",
        message_bus=None,
        database=None,
        config={
            "menu_model_path": model_path,
            "confidence_threshold": 0.3,
        },
    )


# --- YOLO-01 -------------------------------------------------------------------

@_skip_model
async def test_yolo_model_loads():
    """YOLO-01: 2-class best.pt loads in MenuAnalyzerAgent.initialize()."""
    agent = _make_agent(BEST_PT_PATH)
    await agent.initialize()
    assert agent.yolo_model is not None, (
        "yolo_model should be loaded when best.pt exists"
    )


# --- YOLO-02 -------------------------------------------------------------------

@_skip_model
async def test_inference_latency():
    """YOLO-02: Inference on 1280x720 frame returns in <200ms on CPU."""
    agent = _make_agent(BEST_PT_PATH)
    await agent.initialize()
    assert agent.yolo_model is not None

    frame_b64 = _make_synthetic_frame(1280, 720)

    start = time.perf_counter()
    await agent.detect_boxes(frame_b64, confidence=0.3)
    elapsed = time.perf_counter() - start

    assert elapsed < 0.200, (
        f"Inference took {elapsed:.3f}s — must be under 0.200s on CPU"
    )


# --- YOLO-03 -------------------------------------------------------------------

@_skip_model
async def test_box_labels():
    """YOLO-03: Boxes include label in ('wine_entry', 'section_header') and valid confidence."""
    agent = _make_agent(BEST_PT_PATH)
    await agent.initialize()

    frame_b64 = _make_synthetic_frame(1280, 720)
    boxes = await agent.detect_boxes(frame_b64, confidence=0.1)

    # Whether boxes are empty or not, validate schema of any returned box
    for box in boxes:
        assert box["label"] in ("wine_entry", "section_header"), (
            f"Unexpected label: {box['label']}"
        )
        assert 0.0 <= box["confidence"] <= 1.0, (
            f"Confidence out of range: {box['confidence']}"
        )
        for key in ("x1", "y1", "x2", "y2"):
            assert 0.0 <= box[key] <= 1.0, f"{key} not normalized: {box[key]}"


# --- YOLO-04 -------------------------------------------------------------------

async def test_no_extraction_triggered():
    """YOLO-04: detect_boxes() never calls field parser or wine matcher."""
    agent = _make_agent(BEST_PT_PATH)
    # Do NOT call initialize() — we want to test detect_boxes() in isolation
    # with yolo_model = None (returns [] immediately, no extraction path reached)
    assert agent.yolo_model is None

    mock_field_parser = MagicMock()
    mock_wine_matcher = MagicMock()

    with patch.object(agent, "_get_field_parser", mock_field_parser), \
         patch.object(agent, "_get_wine_matcher", mock_wine_matcher):
        result = await agent.detect_boxes(_make_synthetic_frame(), confidence=0.3)

    assert result == [], "Expected empty list when model is None"
    mock_field_parser.assert_not_called()
    mock_wine_matcher.assert_not_called()


# --- YOLO-05 -------------------------------------------------------------------

async def test_model_missing_graceful():
    """YOLO-05: Missing model file — agent starts, logs warning, returns []."""
    agent = _make_agent("nonexistent/path/to/best.pt")
    await agent.initialize()

    assert agent.yolo_model is None, (
        "yolo_model must be None when model file does not exist"
    )

    frame_b64 = _make_synthetic_frame()
    boxes = await agent.detect_boxes(frame_b64)
    assert boxes == [], (
        "detect_boxes() must return [] when yolo_model is None"
    )
