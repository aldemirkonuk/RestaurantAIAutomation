"""
Unit Tests for Auction Wine Research Service
Tests AI-powered wine research with Gemini and OpenAI
"""

from unittest.mock import MagicMock, patch

import pytest
from services.auction_wine_service import get_auction_wine_service


@pytest.fixture
def auction_service():
    """Get auction wine service instance"""
    return get_auction_wine_service()


@pytest.mark.asyncio
async def test_research_wine_success(auction_service):
    """Test successful wine research via the (mocked) Gemini client."""
    gemini_response = MagicMock()
    gemini_response.text = (
        '{"name": "Dom Perignon 2012", "producer": "Moet & Chandon", '
        '"vintage": 2012, "type": "sparkling", "estimated_price": 250.0, '
        '"confidence": "high"}'
    )
    mock_model = MagicMock()
    mock_model.generate_content.return_value = gemini_response

    with patch.object(auction_service, "gemini_available", True), patch.object(
        auction_service, "gemini_model", mock_model, create=True
    ):
        result = await auction_service.research_wine("Dom Perignon 2012")

    assert result["success"] is True
    assert "name" in result
    assert "producer" in result
    assert "estimated_price" in result
    assert result["confidence"] in ["low", "medium", "high"]
    assert result["source"] in ["gemini", "openai"]


@pytest.mark.asyncio
async def test_gemini_query_format(auction_service):
    """Test that Gemini query includes all required fields"""
    prompt = auction_service._build_research_prompt("Château Lafite Rothschild 2010")

    assert "producer" in prompt.lower()
    assert "vintage" in prompt.lower()
    assert "wine type" in prompt.lower()
    assert "estimated market price" in prompt.lower()
    assert "confidence level" in prompt.lower()


def test_wine_type_normalization(auction_service):
    """Test wine type normalization"""
    assert auction_service._normalize_wine_type("red") == "red"
    assert auction_service._normalize_wine_type("champagne") == "sparkling"
    assert auction_service._normalize_wine_type("prosecco") == "sparkling"
    assert auction_service._normalize_wine_type("rosé") == "rose"
    assert auction_service._normalize_wine_type("port") == "dessert"


def test_parse_vintage(auction_service):
    """Test vintage parsing"""
    assert auction_service._parse_vintage(2020) == 2020
    assert auction_service._parse_vintage("2019") == 2019
    assert auction_service._parse_vintage("NV") is None
    assert auction_service._parse_vintage(None) is None


@pytest.mark.asyncio
async def test_batch_research(auction_service):
    """Test batch wine research"""
    wine_names = ["Dom Perignon 2012", "Opus One 2018", "Screaming Eagle Cabernet 2015"]

    results = await auction_service.batch_research(wine_names)

    assert len(results) == 3
    for result in results:
        assert "name" in result or "error" in result


@pytest.mark.asyncio
async def test_fallback_to_openai(auction_service):
    """Test OpenAI fallback when Gemini is unavailable."""
    openai_response = MagicMock()
    openai_response.choices = [MagicMock()]
    openai_response.choices[0].message.content = (
        '{"name": "Test Wine 2020", "producer": "Unknown", '
        '"estimated_price": 50.0, "confidence": "medium"}'
    )
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = openai_response

    # Gemini unavailable -> service must fall back to the (mocked) OpenAI client
    with patch.object(auction_service, "gemini_available", False), patch.object(
        auction_service, "openai_available", True
    ), patch.object(auction_service, "openai_client", mock_client, create=True):
        result = await auction_service.research_wine("Test Wine 2020")

    # Should still get a result via OpenAI fallback
    assert "source" in result
    assert result["source"] == "openai"


def test_parse_json_response(auction_service):
    """Test JSON response parsing"""
    json_response = """{
        "name": "Dom Perignon 2012",
        "producer": "Moët & Chandon",
        "vintage": 2012,
        "type": "sparkling",
        "estimated_price": 250.00,
        "confidence": "high"
    }"""

    result = auction_service._parse_ai_response(json_response, "Dom Perignon 2012")

    assert result["success"] is True
    assert result["name"] == "Dom Perignon 2012"
    assert result["vintage"] == 2012
    assert result["type"] == "sparkling"


def test_text_response_fallback(auction_service):
    """Test fallback text parsing when JSON fails"""
    text_response = """
    Producer: Château Lafite Rothschild
    Vintage: 2010
    Type: Red
    Grape: Cabernet Sauvignon
    Region: Pauillac
    Country: France
    Price: $500
    """

    result = auction_service._parse_text_response(text_response, "Lafite 2010")

    assert result["producer"] == "Château Lafite Rothschild"
    assert result["vintage"] == 2010
    assert result["type"] == "red"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
