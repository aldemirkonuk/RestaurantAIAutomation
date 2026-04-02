"""Unit tests for GeminiFlashCrawlerExtractor and web_crawler Phase 2 behaviour."""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

pytestmark = pytest.mark.asyncio

MOCK_WINES_JSON = json.dumps({
    "wines": [
        {"wine_name": "Château Margaux", "vintage": 2018, "price_bottle": 450.0, "confidence": 0.9},
        {"wine_name": "Opus One", "vintage": 2019, "price_bottle": 300.0, "confidence": 0.85},
    ],
    "sections": [],
})


def _make_mock_client(response_text: str = MOCK_WINES_JSON) -> MagicMock:
    """Build a mock AsyncClient whose aio.models.generate_content returns response_text."""
    mock_response = MagicMock()
    mock_response.text = response_text
    mock_aio = MagicMock()
    mock_aio.models.generate_content = AsyncMock(return_value=mock_response)
    mock_client = MagicMock()
    mock_client.aio = mock_aio
    return mock_client


# =============================================================================
# GMFL-01 tests — real implementations (not stubs)
# =============================================================================

async def test_model_is_gemini_2_0_flash():
    """GMFL-01: extractor must call generate_content with model='gemini-2.0-flash'."""
    mock_client = _make_mock_client()
    with patch("services.vlm_extraction_service.AsyncClient", return_value=mock_client):
        from services.vlm_extraction_service import GeminiFlashCrawlerExtractor
        extractor = GeminiFlashCrawlerExtractor()
        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test-key"}):
            result = await extractor.extract_from_text("Château Margaux 2018 $450", "Test Restaurant")
    mock_client.aio.models.generate_content.assert_called_once()
    call_kwargs = mock_client.aio.models.generate_content.call_args
    assert call_kwargs.kwargs.get("model") == "gemini-2.0-flash" or call_kwargs[1].get("model") == "gemini-2.0-flash" or call_kwargs[0][0] == "gemini-2.0-flash"


async def test_uses_async_client():
    """GMFL-01: GeminiFlashCrawlerExtractor must import and use AsyncClient, not genai.Client."""
    import inspect
    import importlib
    import services.vlm_extraction_service as mod
    importlib.reload(mod)
    # Verify the module imports AsyncClient from google.genai.client
    source = inspect.getsource(mod)
    assert "from google.genai.client import AsyncClient" in source, (
        "AsyncClient must be imported from google.genai.client"
    )
    # Verify GeminiFlashCrawlerExtractor uses AsyncClient (not genai.Client) in _get_client
    assert "AsyncClient(api_key=" in source, (
        "GeminiFlashCrawlerExtractor._get_client() must instantiate AsyncClient"
    )


async def test_extract_from_text_returns_wines():
    """GMFL-01: extract_from_text with 2-wine mock response returns 2 wines and correct model."""
    mock_client = _make_mock_client(MOCK_WINES_JSON)
    with patch("services.vlm_extraction_service.AsyncClient", return_value=mock_client):
        from services.vlm_extraction_service import GeminiFlashCrawlerExtractor
        extractor = GeminiFlashCrawlerExtractor()
        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test-key"}):
            result = await extractor.extract_from_text(
                "Château Margaux 2018 $450\nOpus One 2019 $300",
                "Test Restaurant",
            )
    assert len(result.wines) == 2, f"Expected 2 wines, got {len(result.wines)}"
    assert result.model_used == "gemini-2.0-flash"


async def test_extract_empty_html_returns_empty_result():
    """GMFL-01: empty wine list in response → total_wines == 0, no warnings."""
    empty_json = json.dumps({"wines": [], "sections": []})
    mock_client = _make_mock_client(empty_json)
    with patch("services.vlm_extraction_service.AsyncClient", return_value=mock_client):
        from services.vlm_extraction_service import GeminiFlashCrawlerExtractor
        extractor = GeminiFlashCrawlerExtractor()
        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test-key"}):
            result = await extractor.extract_from_text("", "Empty Restaurant")
    assert result.total_wines == 0
    assert result.warnings == []


async def test_extract_api_error_returns_warning():
    """GMFL-01: when generate_content raises Exception, result.warnings must be non-empty."""
    mock_aio = MagicMock()
    mock_aio.models.generate_content = AsyncMock(side_effect=Exception("timeout"))
    mock_client = MagicMock()
    mock_client.aio = mock_aio

    with patch("services.vlm_extraction_service.AsyncClient", return_value=mock_client):
        from services.vlm_extraction_service import GeminiFlashCrawlerExtractor
        extractor = GeminiFlashCrawlerExtractor()
        with patch.dict("os.environ", {"GOOGLE_API_KEY": "test-key"}):
            result = await extractor.extract_from_text("Some text", "Test Restaurant")
    assert len(result.warnings) > 0, "Expected at least one warning on API error"


# =============================================================================
# GMFL-02 through GMFL-05 stubs — Plan 02 will implement these
# =============================================================================

@pytest.mark.xfail(reason="Implemented in Plan 02")
@pytest.mark.integration
async def test_crawl_calls_gemini_after_html():
    """GMFL-02: HTML crawler fetches page HTML then passes it to GeminiFlashCrawlerExtractor."""
    raise NotImplementedError


@pytest.mark.xfail(reason="Implemented in Plan 02")
async def test_crawled_wines_written_to_dataset():
    """GMFL-03: extracted wines from crawl are written to JSONL dataset file."""
    raise NotImplementedError


@pytest.mark.xfail(reason="Implemented in Plan 02")
async def test_robots_txt_disallow_blocks_crawl():
    """GMFL-04: when robots.txt disallows crawling, the pipeline returns empty result."""
    raise NotImplementedError


@pytest.mark.xfail(reason="Implemented in Plan 02")
async def test_rate_limit_enforced():
    """GMFL-04: rate limiter enforces minimum delay between crawl requests."""
    raise NotImplementedError


@pytest.mark.xfail(reason="Implemented in Plan 02")
async def test_duplicate_wine_skipped():
    """GMFL-05: wine already in library is not re-inserted."""
    raise NotImplementedError


@pytest.mark.xfail(reason="Implemented in Plan 02")
async def test_non_duplicate_wine_inserted():
    """GMFL-05: wine not in library is inserted."""
    raise NotImplementedError
