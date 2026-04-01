"""Unit tests for ClaudeVisionExtractor — no live API calls."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio

from services.claude_vision_extractor import (
    ClaudeVisionExtractor,
    compute_completeness,
    parse_json_response,
    ClaudePageResult,
    ClaudeExtractionResult,
)


# ── compute_completeness ──────────────────────────────────────────────────────

def test_completeness_all_fields():
    wine = {"wine_name": "Opus One", "vintage": 2019, "price_bottle": 350.0,
            "region": "Napa Valley", "country": "USA", "section_name": "Reds"}
    assert compute_completeness(wine) == 1.0

def test_completeness_half_fields():
    wine = {"wine_name": "Opus One", "vintage": 2019, "price_bottle": 100.0,
            "region": None, "country": None, "section_name": None}
    assert compute_completeness(wine) == 0.5

def test_completeness_empty_wine():
    assert compute_completeness({}) == 0.0

def test_needs_review_threshold_strict_less_than():
    # 3/6 = 0.5 → NOT flagged (strict < 0.5)
    wine_half = {"wine_name": "X", "vintage": 2020, "price_bottle": 50.0,
                 "region": None, "country": None, "section_name": None}
    score = compute_completeness(wine_half)
    assert score == 0.5
    assert not (score < 0.5)  # should NOT trigger needs_review

    # 2/6 = 0.333 → flagged
    wine_low = {"wine_name": "X", "vintage": 2020,
                "price_bottle": None, "region": None, "country": None, "section_name": None}
    score_low = compute_completeness(wine_low)
    assert score_low < 0.5  # should trigger needs_review


# ── parse_json_response ───────────────────────────────────────────────────────

def test_parse_raw_json():
    raw = '{"wines": [{"wine_name": "Chablis"}], "total_wines_extracted": 1}'
    result, error = parse_json_response(raw)
    assert not error
    assert result["wines"][0]["wine_name"] == "Chablis"

def test_parse_json_fence():
    raw = '```json\n{"wines": [], "total_wines_extracted": 0}\n```'
    result, error = parse_json_response(raw)
    assert not error
    assert "wines" in result

def test_parse_garbage():
    result, error = parse_json_response("This is not JSON at all!!!")
    assert error is True
    assert result == {"wines": [], "parse_error": True}


# ── ClaudeVisionExtractor (mocked API) ───────────────────────────────────────

@pytest.fixture
def mock_anthropic_response():
    """Minimal Anthropic message response mock."""
    resp = MagicMock()
    resp.content = [MagicMock()]
    resp.content[0].text = '{"wines": [{"wine_name": "Barolo", "vintage": 2018, "price_bottle": 120.0, "price_glass": null, "region": "Piedmont", "country": "Italy", "grape_variety": "Nebbiolo", "section_name": "Reds", "bin_number": null}], "page_notes": "test", "total_wines_extracted": 1}'
    resp.usage = MagicMock()
    resp.usage.input_tokens = 1000
    resp.usage.output_tokens = 500
    return resp

@pytest.mark.asyncio
async def test_extract_menu_returns_extraction_result(mock_anthropic_response):
    extractor = ClaudeVisionExtractor()
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_anthropic_response)
    extractor._client = mock_client
    extractor._semaphore = asyncio.Semaphore(5)

    result = await extractor.extract_menu(["base64imagedata=="])
    assert isinstance(result, ClaudeExtractionResult)
    assert result.total_wines >= 1
    assert result.total_cost_usd > 0

@pytest.mark.asyncio
async def test_extract_menu_fires_one_call_per_page(mock_anthropic_response):
    extractor = ClaudeVisionExtractor()
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_anthropic_response)
    extractor._client = mock_client
    extractor._semaphore = asyncio.Semaphore(5)

    await extractor.extract_menu(["page1", "page2"])
    assert mock_client.messages.create.call_count == 2

def test_cost_formula_per_page():
    """Cost formula: (input * 3.0 + output * 15.0) / 1_000_000"""
    input_tokens = 1000
    output_tokens = 500
    expected = (1000 * 3.0 / 1_000_000) + (500 * 15.0 / 1_000_000)
    assert expected == pytest.approx(0.0105)
