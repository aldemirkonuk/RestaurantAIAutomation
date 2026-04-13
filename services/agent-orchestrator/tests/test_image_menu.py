"""
Unit tests for Phase 6: Image Menu Extraction via Claude Vision.
Covers IMGX-01 through IMGX-06 and extract_pdf() document block.

All Playwright page interactions are mocked via AsyncMock.
All extractor calls are mocked to avoid live API calls.
"""
import json
import pytest
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch, call

# Path setup: allow importing from services/agent-orchestrator
PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT_ROOT / "services" / "agent-orchestrator"))

from services.web_crawler import WebCrawlerService, CrawlResult, ContentType


# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------

def make_crawler() -> WebCrawlerService:
    """Return a WebCrawlerService with no supabase (dedup fails open)."""
    return WebCrawlerService(supabase_client=None)


def make_mock_page(total_height: int = 1800) -> AsyncMock:
    """Return an AsyncMock Playwright page."""
    page = AsyncMock()

    async def evaluate_side_effect(expr, *args):
        if "scrollHeight" in expr:
            return total_height
        if "naturalWidth" in str(args):
            return 500  # large image by default
        return ""

    page.evaluate = AsyncMock(side_effect=evaluate_side_effect)
    page.screenshot = AsyncMock(return_value=b"\xff\xd8\xff" + b"0" * 100)  # JPEG magic bytes
    page.set_viewport_size = AsyncMock()
    page.query_selector_all = AsyncMock(return_value=[])
    page.inner_text = AsyncMock(return_value="")
    return page


def make_extraction_result(wines=None):
    """Return a mock ClaudeExtractionResult with given wines."""
    from services.claude_vision_extractor import ClaudeExtractionResult
    w = wines or [{"wine_name": "Chateau Test", "vintage": 2020, "completeness_score": 0.8, "needs_review": False}]
    return ClaudeExtractionResult(
        scan_session_id="test-session-id",
        wines=w,
        total_wines=len(w),
        pages_processed=1,
        total_cost_usd=0.001,
    )


# ---------------------------------------------------------------------------
# IMGX-02: _take_viewport_chunks returns jpeg bytes
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_take_viewport_chunks_returns_jpeg_bytes():
    """_take_viewport_chunks returns a list of bytes, one per 900px scroll step."""
    crawler = make_crawler()
    page = make_mock_page(total_height=1800)  # expect 2 chunks

    chunks = await crawler._take_viewport_chunks(page)

    assert isinstance(chunks, list)
    assert len(chunks) == 2
    for chunk in chunks:
        assert isinstance(chunk, bytes)
    # Verify screenshot called with y=0 then y=900
    calls = page.screenshot.call_args_list
    assert calls[0].kwargs["clip"]["y"] == 0
    assert calls[1].kwargs["clip"]["y"] == 900


# ---------------------------------------------------------------------------
# IMGX-01: image_menu_detected set to True on IMAGE_ONLY path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_image_only_sets_detected():
    """_handle_image_menu sets result.image_menu_detected=True."""
    crawler = make_crawler()
    page = make_mock_page(total_height=900)
    result = CrawlResult(
        restaurant_name="Tredita",
        website_url="https://tredita.com/menus/",
        content_type=ContentType.IMAGE_ONLY,
    )

    mock_extraction = make_extraction_result()

    with patch(
        "services.web_crawler.get_claude_vision_extractor"
    ) as mock_factory:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=mock_extraction)
        mock_factory.return_value = mock_extractor

        with patch.object(crawler, "_persist_crawled_wines"):
            await crawler._handle_image_menu(page, result, "Tredita", "https://tredita.com/menus/")

    assert result.image_menu_detected is True


# ---------------------------------------------------------------------------
# IMGX-03: extract_menu called with base64 strings, not bytes
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extract_menu_called_with_b64_strings():
    """_handle_image_menu encodes chunks to base64 str before calling extract_menu."""
    crawler = make_crawler()
    page = make_mock_page(total_height=900)
    result = CrawlResult(restaurant_name="Test", website_url="https://example.com")

    captured_pages = []

    async def capture_extract_menu(pages, **kwargs):
        captured_pages.extend(pages)
        return make_extraction_result()

    with patch(
        "services.web_crawler.get_claude_vision_extractor"
    ) as mock_factory:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = capture_extract_menu
        mock_factory.return_value = mock_extractor

        with patch.object(crawler, "_persist_crawled_wines"):
            await crawler._handle_image_menu(page, result, "Test", "https://example.com")

    assert len(captured_pages) >= 1
    for page_arg in captured_pages:
        assert isinstance(page_arg, str), f"Expected str, got {type(page_arg)}"


# ---------------------------------------------------------------------------
# IMGX-04 + IMGX-05: _persist_crawled_wines called with source_type="image_menu"
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_persist_called_with_image_menu_source_type():
    """_handle_image_menu calls _persist_crawled_wines with source_type='image_menu'."""
    crawler = make_crawler()
    page = make_mock_page(total_height=900)
    result = CrawlResult(restaurant_name="Test", website_url="https://example.com")

    persist_calls = []

    def capture_persist(wines, restaurant_name, source_url, source_type="crawled"):
        persist_calls.append({"wines": wines, "source_type": source_type})

    with patch(
        "services.web_crawler.get_claude_vision_extractor"
    ) as mock_factory:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=make_extraction_result())
        mock_factory.return_value = mock_extractor

        with patch.object(crawler, "_persist_crawled_wines", side_effect=capture_persist):
            await crawler._handle_image_menu(page, result, "Test", "https://example.com")

    assert len(persist_calls) == 1
    assert persist_calls[0]["source_type"] == "image_menu"


# ---------------------------------------------------------------------------
# IMGX-06: Existing HTML_MENU path (wines > 0) still persists with source_type="crawled"
# ---------------------------------------------------------------------------

def test_html_menu_source_type_is_crawled(tmp_path, monkeypatch):
    """_persist_crawled_wines with no source_type writes data_enrichment.source_type='crawled'."""
    import services.web_crawler as wc_module

    # Point RESTAURANT_MENUS_DIR to tmp_path
    monkeypatch.setattr(wc_module, "RESTAURANT_MENUS_DIR", tmp_path)

    crawler = make_crawler()
    wines = [{"wine_name": "Test Wine", "vintage": 2020, "primary_type": "red", "country": "France"}]
    crawler._persist_crawled_wines(wines, "TestRest", "https://example.com")

    jsonl_files = list(tmp_path.glob("*.jsonl"))
    assert len(jsonl_files) == 1
    records = [json.loads(line) for line in jsonl_files[0].read_text().splitlines() if line]
    assert len(records) == 1
    assert records[0]["data_enrichment"]["source_type"] == "crawled"


# ---------------------------------------------------------------------------
# extract_pdf document block test
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extract_pdf_uses_document_content_block():
    """extract_pdf() sends a document content block with media_type application/pdf."""
    from services.claude_vision_extractor import ClaudeVisionExtractor

    extractor = ClaudeVisionExtractor()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text='{"wines": [], "page_notes": "test", "total_wines_extracted": 0}')]
    mock_response.usage.input_tokens = 100
    mock_response.usage.output_tokens = 50

    captured_messages = []

    async def mock_create(**kwargs):
        captured_messages.append(kwargs)
        return mock_response

    mock_messages = MagicMock()
    mock_messages.create = mock_create

    mock_client = MagicMock()
    mock_client.messages = mock_messages

    extractor._client = mock_client

    with patch("services.claude_vision_extractor.get_spend_logger"):
        result = await extractor.extract_pdf(b"%PDF-1.4 fake content")

    assert len(captured_messages) == 1
    content_blocks = captured_messages[0]["messages"][0]["content"]
    doc_block = next((b for b in content_blocks if b.get("type") == "document"), None)
    assert doc_block is not None, "No document content block found in API call"
    assert doc_block["source"]["media_type"] == "application/pdf"
    assert result.extraction_method == "claude_pdf"
