"""
Tests for POST /api/v1/onboarding/extract endpoint.

Uses httpx.AsyncClient + ASGITransport (starlette 0.35 / httpx 0.28 compatible).
"""

import sys
import os
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure services/agent-orchestrator is on the path
_ORCHESTRATOR_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ORCHESTRATOR_ROOT not in sys.path:
    sys.path.insert(0, _ORCHESTRATOR_ROOT)


@pytest.fixture
def mock_extractor_result():
    from services.claude_vision_extractor import ClaudeExtractionResult

    return ClaudeExtractionResult(
        scan_session_id="test-session-uuid",
        wines=[
            {
                "wine_name": "Barolo Cannubi",
                "vintage": 2018,
                "price_bottle": 120.0,
                "price_glass": None,
                "region": "Piedmont",
                "country": "Italy",
                "grape_variety": "Nebbiolo",
                "section_name": "Reds",
                "bin_number": None,
                "completeness_score": 0.833,
                "needs_review": False,
            }
        ],
        total_wines=1,
        pages_processed=1,
        total_cost_usd=0.045,
        total_input_tokens=10000,
        total_output_tokens=2000,
        needs_review_count=0,
        page_errors=[],
    )


async def _post(app, path, json_body):
    """Helper: async POST via httpx.ASGITransport."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        return await client.post(path, json=json_body)


@pytest.mark.asyncio
async def test_extract_missing_restaurant_id():
    import main

    resp = await _post(
        main.app, "/api/v1/onboarding/extract", {"images": ["base64data"]}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_extract_pdf_base64_rejected():
    import main

    resp = await _post(
        main.app,
        "/api/v1/onboarding/extract",
        {
            "restaurant_id": "rest-123",
            # Malformed base64 (length not a multiple of 4) — pdf_base64 is a
            # supported input, but invalid encoding must be rejected with 422.
            "pdf_base64": "pdfbase64data",
        },
    )
    assert resp.status_code == 422
    assert "Invalid base64" in resp.json().get("detail", "")


@pytest.mark.asyncio
async def test_extract_empty_images_rejected():
    import main

    resp = await _post(
        main.app,
        "/api/v1/onboarding/extract",
        {
            "restaurant_id": "rest-123",
            "images": [],
        },
    )
    assert resp.status_code == 422
    assert "Provide either" in resp.json().get("detail", "")


@pytest.mark.asyncio
async def test_extract_success_200(mock_extractor_result):
    import main

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=mock_extractor_result)
        mock_getter.return_value = mock_extractor
        with patch("api.onboarding_routes.get_supabase_client", return_value=None):
            resp = await _post(
                main.app,
                "/api/v1/onboarding/extract",
                {
                    "restaurant_id": "rest-123",
                    "images": ["base64page1"],
                },
            )
    assert resp.status_code == 200
    body = resp.json()
    assert "scan_session_id" in body
    assert "wines" in body
    assert "total_cost_usd" in body
    assert "needs_review_count" in body
    assert body["total_wines"] == 1


@pytest.mark.asyncio
async def test_extract_partial_failure_207(mock_extractor_result):
    partial_result = mock_extractor_result.model_copy(
        update={"page_errors": [{"page": 1, "error": "API timeout"}]}
    )
    import main

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=partial_result)
        mock_getter.return_value = mock_extractor
        with patch("api.onboarding_routes.get_supabase_client", return_value=None):
            resp = await _post(
                main.app,
                "/api/v1/onboarding/extract",
                {
                    "restaurant_id": "rest-123",
                    "images": ["page1", "page2"],
                },
            )
    assert resp.status_code == 207


@pytest.mark.asyncio
async def test_extract_all_pages_fail_503():
    import main

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(
            side_effect=RuntimeError("All 2 pages failed")
        )
        mock_getter.return_value = mock_extractor
        resp = await _post(
            main.app,
            "/api/v1/onboarding/extract",
            {
                "restaurant_id": "rest-123",
                "images": ["page1", "page2"],
            },
        )
    assert resp.status_code == 503
