"""Unit tests for GeminiFlashCrawlerExtractor and web_crawler Phase 2 behaviour."""

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio

MOCK_WINES_JSON = json.dumps(
    {
        "wines": [
            {
                "wine_name": "Château Margaux",
                "vintage": 2018,
                "price_bottle": 450.0,
                "confidence": 0.9,
            },
            {
                "wine_name": "Opus One",
                "vintage": 2019,
                "price_bottle": 300.0,
                "confidence": 0.85,
            },
        ],
        "sections": [],
    }
)


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


async def test_model_is_gemini_2_5_flash():
    """GMFL-01: extractor must call generate_content with model='gemini-2.5-flash'."""
    from services.vlm_extraction_service import GeminiFlashCrawlerExtractor

    mock_client = _make_mock_client()
    extractor = GeminiFlashCrawlerExtractor()
    extractor._client = (
        mock_client  # bypass _get_client — lazy init skips when _client set
    )
    await extractor.extract_from_text("Château Margaux 2018 $450", "Test Restaurant")
    mock_client.aio.models.generate_content.assert_called_once()
    call_kwargs = mock_client.aio.models.generate_content.call_args
    model_used = (
        call_kwargs.kwargs.get("model")
        or (call_kwargs[1].get("model") if call_kwargs[1] else None)
        or (call_kwargs[0][0] if call_kwargs[0] else None)
    )
    assert (
        model_used == "gemini-2.5-flash"
    ), f"Expected gemini-2.5-flash, got {model_used}"


async def test_client_lazy_init_and_model():
    """GMFL-01: _get_client() raises without API key; extract_from_text uses gemini-2.5-flash."""
    from services.vlm_extraction_service import GeminiFlashCrawlerExtractor

    # Verify lazy init raises without API key
    extractor = GeminiFlashCrawlerExtractor()
    with patch.dict("os.environ", {}, clear=True):
        os.environ.pop("GEMINI_API_KEY", None)
        with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
            extractor._get_client()

    # Verify correct model string
    assert GeminiFlashCrawlerExtractor.MODEL_ID == "gemini-2.5-flash"

    # Verify extract_from_text returns model_used = gemini-2.5-flash on success
    mock_client = _make_mock_client()
    extractor2 = GeminiFlashCrawlerExtractor()
    extractor2._client = mock_client
    result = await extractor2.extract_from_text("Some wine text", "Test Restaurant")
    assert result.model_used == "gemini-2.5-flash"


async def test_extract_from_text_returns_wines():
    """GMFL-01: extract_from_text with 2-wine mock response returns 2 wines and correct model."""
    from services.vlm_extraction_service import GeminiFlashCrawlerExtractor

    mock_client = _make_mock_client(MOCK_WINES_JSON)
    extractor = GeminiFlashCrawlerExtractor()
    extractor._client = mock_client
    result = await extractor.extract_from_text(
        "Château Margaux 2018 $450\nOpus One 2019 $300",
        "Test Restaurant",
    )
    assert len(result.wines) == 2, f"Expected 2 wines, got {len(result.wines)}"
    assert result.model_used == "gemini-2.5-flash"


async def test_extract_empty_html_returns_empty_result():
    """GMFL-01: empty wine list in response → total_wines == 0, no warnings."""
    from services.vlm_extraction_service import GeminiFlashCrawlerExtractor

    empty_json = json.dumps({"wines": [], "sections": []})
    mock_client = _make_mock_client(empty_json)
    extractor = GeminiFlashCrawlerExtractor()
    extractor._client = mock_client
    result = await extractor.extract_from_text("", "Empty Restaurant")
    assert result.total_wines == 0
    assert result.warnings == []


async def test_extract_api_error_returns_warning():
    """GMFL-01: when generate_content raises Exception, result.warnings must be non-empty."""
    from services.vlm_extraction_service import GeminiFlashCrawlerExtractor

    mock_aio = MagicMock()
    mock_aio.models.generate_content = AsyncMock(side_effect=Exception("timeout"))
    mock_client = MagicMock()
    mock_client.aio = mock_aio
    extractor = GeminiFlashCrawlerExtractor()
    extractor._client = mock_client
    result = await extractor.extract_from_text("Some text", "Test Restaurant")
    assert len(result.warnings) > 0, "Expected at least one warning on API error"


# =============================================================================
# GMFL-02 through GMFL-05 — real implementations (Plan 02)
# =============================================================================


async def test_robots_txt_disallow_blocks_crawl():
    """GMFL-04: when robots.txt disallows crawling, the pipeline returns ERROR result."""
    from services.web_crawler import WebCrawlerService, ContentType

    service = WebCrawlerService(rate_limit=100)

    with patch.object(service, "_is_crawl_allowed", new=AsyncMock(return_value=False)):
        result = await service.crawl_restaurant(
            "https://blocked.example.com/wine", "Blocked Restaurant"
        )

    assert result.content_type == ContentType.ERROR
    assert result.error is not None
    assert "robots.txt" in result.error.lower()


async def test_rate_limit_enforced():
    """GMFL-04: when daily count is at limit, crawl_restaurant returns error without crawling."""
    from services.web_crawler import WebCrawlerService, ContentType

    service = WebCrawlerService(rate_limit=2)
    service._daily_count = 2  # at limit

    result = await service.crawl_restaurant(
        "https://example.com/wine", "Some Restaurant"
    )

    assert result.content_type == ContentType.ERROR
    assert result.error is not None
    assert "rate limit" in result.error.lower()


async def test_crawl_calls_gemini_after_html():
    """GMFL-02: HTML crawler fetches page HTML then passes it to GeminiFlashCrawlerExtractor."""
    from services.web_crawler import WebCrawlerService
    from services.vlm_extraction_service import VLMExtractionResult

    service = WebCrawlerService(rate_limit=100)

    # Mock _is_crawl_allowed to return True
    with patch.object(service, "_is_crawl_allowed", new=AsyncMock(return_value=True)):
        # Mock async_playwright context to return HTML text
        mock_page = AsyncMock()
        mock_page.goto = AsyncMock(return_value=MagicMock(status=200))
        mock_page.query_selector_all = AsyncMock(return_value=[])
        mock_page.query_selector = AsyncMock(return_value=None)

        mock_body = AsyncMock()
        mock_body.inner_text = AsyncMock(
            return_value="Château Margaux 2018 $450\n" * 20
        )
        mock_page.query_selector = AsyncMock(
            side_effect=lambda sel: mock_body if sel == "body" else None
        )

        mock_context = AsyncMock()
        mock_browser = AsyncMock()
        mock_browser.new_context = AsyncMock(return_value=mock_context)
        mock_context.new_page = AsyncMock(return_value=mock_page)
        mock_p = AsyncMock()
        mock_p.chromium.launch = AsyncMock(return_value=mock_browser)

        extraction_result = VLMExtractionResult(
            wines=[{"wine_name": "Château Margaux", "vintage": 2018}],
            total_wines=1,
            model_used="gemini-2.5-flash",
        )

        mock_extractor = AsyncMock()
        mock_extractor.extract_from_text = AsyncMock(return_value=extraction_result)

        with patch("services.web_crawler.async_playwright") as mock_playwright_cm:
            mock_playwright_cm.return_value.__aenter__ = AsyncMock(return_value=mock_p)
            mock_playwright_cm.return_value.__aexit__ = AsyncMock(return_value=None)
            with patch(
                "services.web_crawler.get_gemini_crawler_extractor",
                return_value=mock_extractor,
            ):
                # Also patch _persist_crawled_wines and _wine_is_duplicate
                with patch.object(service, "_wine_is_duplicate", return_value=False):
                    with patch.object(service, "_persist_crawled_wines"):
                        with patch.object(service, "_cache_result"):
                            with patch.object(service, "_log_crawl_to_db"):
                                await service.crawl_restaurant(
                                    "https://example.com/wine", "Test Restaurant"
                                )

        mock_extractor.extract_from_text.assert_called_once()


async def test_crawled_wines_written_to_dataset(tmp_path, monkeypatch):
    """GMFL-03: extracted wines from crawl are written to JSONL dataset file."""
    import services.web_crawler as wc_mod

    monkeypatch.setattr(wc_mod, "RESTAURANT_MENUS_DIR", tmp_path)

    from services.web_crawler import WebCrawlerService
    from services.vlm_extraction_service import VLMExtractionResult

    service = WebCrawlerService(rate_limit=100)

    with patch.object(service, "_is_crawl_allowed", new=AsyncMock(return_value=True)):
        mock_page = AsyncMock()
        mock_page.goto = AsyncMock(return_value=MagicMock(status=200))
        mock_page.query_selector_all = AsyncMock(return_value=[])

        mock_body = AsyncMock()
        mock_body.inner_text = AsyncMock(return_value="Opus One 2019 $300\n" * 20)
        mock_page.query_selector = AsyncMock(
            side_effect=lambda sel: mock_body if sel == "body" else None
        )

        mock_context = AsyncMock()
        mock_browser = AsyncMock()
        mock_browser.new_context = AsyncMock(return_value=mock_context)
        mock_context.new_page = AsyncMock(return_value=mock_page)
        mock_p = AsyncMock()
        mock_p.chromium.launch = AsyncMock(return_value=mock_browser)

        extraction_result = VLMExtractionResult(
            wines=[{"wine_name": "Opus One", "vintage": 2019}],
            total_wines=1,
            model_used="gemini-2.5-flash",
        )

        mock_extractor = AsyncMock()
        mock_extractor.extract_from_text = AsyncMock(return_value=extraction_result)

        with patch("services.web_crawler.async_playwright") as mock_playwright_cm:
            mock_playwright_cm.return_value.__aenter__ = AsyncMock(return_value=mock_p)
            mock_playwright_cm.return_value.__aexit__ = AsyncMock(return_value=None)
            with patch(
                "services.web_crawler.get_gemini_crawler_extractor",
                return_value=mock_extractor,
            ):
                with patch.object(service, "_wine_is_duplicate", return_value=False):
                    with patch.object(service, "_cache_result"):
                        with patch.object(service, "_log_crawl_to_db"):
                            await service.crawl_restaurant(
                                "https://example.com/wine", "Opus Restaurant"
                            )

    # Find the JSONL file written in tmp_path
    jsonl_files = list(tmp_path.glob("*.jsonl"))
    assert len(jsonl_files) == 1, f"Expected 1 JSONL file, found {len(jsonl_files)}"

    lines = jsonl_files[0].read_text().strip().splitlines()
    assert len(lines) == 1, f"Expected 1 wine record, got {len(lines)}"

    record = json.loads(lines[0])
    assert record["wine_name"] == "Opus One"
    assert record["data_enrichment"]["source_type"] == "crawled"


async def test_duplicate_wine_skipped(tmp_path, monkeypatch):
    """GMFL-05: wine already in master_wine_library is not written to JSONL."""
    import services.web_crawler as wc_mod

    monkeypatch.setattr(wc_mod, "RESTAURANT_MENUS_DIR", tmp_path)

    from services.web_crawler import WebCrawlerService
    from services.vlm_extraction_service import VLMExtractionResult

    service = WebCrawlerService(rate_limit=100)

    with patch.object(service, "_is_crawl_allowed", new=AsyncMock(return_value=True)):
        mock_page = AsyncMock()
        mock_page.goto = AsyncMock(return_value=MagicMock(status=200))
        mock_page.query_selector_all = AsyncMock(return_value=[])

        mock_body = AsyncMock()
        mock_body.inner_text = AsyncMock(
            return_value="Château Pétrus 2015 $1200\n" * 20
        )
        mock_page.query_selector = AsyncMock(
            side_effect=lambda sel: mock_body if sel == "body" else None
        )

        mock_context = AsyncMock()
        mock_browser = AsyncMock()
        mock_browser.new_context = AsyncMock(return_value=mock_context)
        mock_context.new_page = AsyncMock(return_value=mock_page)
        mock_p = AsyncMock()
        mock_p.chromium.launch = AsyncMock(return_value=mock_browser)

        extraction_result = VLMExtractionResult(
            wines=[{"wine_name": "Château Pétrus", "vintage": 2015}],
            total_wines=1,
            model_used="gemini-2.5-flash",
        )

        mock_extractor = AsyncMock()
        mock_extractor.extract_from_text = AsyncMock(return_value=extraction_result)

        with patch("services.web_crawler.async_playwright") as mock_playwright_cm:
            mock_playwright_cm.return_value.__aenter__ = AsyncMock(return_value=mock_p)
            mock_playwright_cm.return_value.__aexit__ = AsyncMock(return_value=None)
            with patch(
                "services.web_crawler.get_gemini_crawler_extractor",
                return_value=mock_extractor,
            ):
                # Wine IS a duplicate — should be skipped
                with patch.object(service, "_wine_is_duplicate", return_value=True):
                    with patch.object(service, "_cache_result"):
                        with patch.object(service, "_log_crawl_to_db"):
                            await service.crawl_restaurant(
                                "https://example.com/wine", "Petrus Restaurant"
                            )

    # No JSONL file should be written (all wines are duplicates)
    jsonl_files = list(tmp_path.glob("*.jsonl"))
    assert (
        len(jsonl_files) == 0
    ), f"Expected 0 JSONL files (all duplicates), found {len(jsonl_files)}"


async def test_non_duplicate_wine_inserted(tmp_path, monkeypatch):
    """GMFL-05: wine not in master_wine_library is written to JSONL."""
    import services.web_crawler as wc_mod

    monkeypatch.setattr(wc_mod, "RESTAURANT_MENUS_DIR", tmp_path)

    from services.web_crawler import WebCrawlerService
    from services.vlm_extraction_service import VLMExtractionResult

    service = WebCrawlerService(rate_limit=100)

    with patch.object(service, "_is_crawl_allowed", new=AsyncMock(return_value=True)):
        mock_page = AsyncMock()
        mock_page.goto = AsyncMock(return_value=MagicMock(status=200))
        mock_page.query_selector_all = AsyncMock(return_value=[])

        mock_body = AsyncMock()
        mock_body.inner_text = AsyncMock(
            return_value="Hidden Gem Winery 2020 $45\n" * 20
        )
        mock_page.query_selector = AsyncMock(
            side_effect=lambda sel: mock_body if sel == "body" else None
        )

        mock_context = AsyncMock()
        mock_browser = AsyncMock()
        mock_browser.new_context = AsyncMock(return_value=mock_context)
        mock_context.new_page = AsyncMock(return_value=mock_page)
        mock_p = AsyncMock()
        mock_p.chromium.launch = AsyncMock(return_value=mock_browser)

        extraction_result = VLMExtractionResult(
            wines=[{"wine_name": "Hidden Gem Winery", "vintage": 2020}],
            total_wines=1,
            model_used="gemini-2.5-flash",
        )

        mock_extractor = AsyncMock()
        mock_extractor.extract_from_text = AsyncMock(return_value=extraction_result)

        with patch("services.web_crawler.async_playwright") as mock_playwright_cm:
            mock_playwright_cm.return_value.__aenter__ = AsyncMock(return_value=mock_p)
            mock_playwright_cm.return_value.__aexit__ = AsyncMock(return_value=None)
            with patch(
                "services.web_crawler.get_gemini_crawler_extractor",
                return_value=mock_extractor,
            ):
                # Wine is NOT a duplicate — should be inserted
                with patch.object(service, "_wine_is_duplicate", return_value=False):
                    with patch.object(service, "_cache_result"):
                        with patch.object(service, "_log_crawl_to_db"):
                            await service.crawl_restaurant(
                                "https://example.com/wine", "Hidden Gem Restaurant"
                            )

    # JSONL file should be written
    jsonl_files = list(tmp_path.glob("*.jsonl"))
    assert (
        len(jsonl_files) == 1
    ), f"Expected 1 JSONL file (non-duplicate), found {len(jsonl_files)}"

    lines = jsonl_files[0].read_text().strip().splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["wine_name"] == "Hidden Gem Winery"
    assert record["data_enrichment"]["source_type"] == "crawled"


@pytest.mark.integration
async def test_integration_live_crawl():
    """Live integration: crawl real URL, verify >= 1 wine extracted. Run with GEMINI_API_KEY set."""
    pytest.skip("Integration test — run manually with: pytest -m integration -s")
