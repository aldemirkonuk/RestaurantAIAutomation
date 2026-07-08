"""
Phase 4: Claude Haiku Enrichment — Unit Tests
Covers HAIKU-01 through HAIKU-05 (dedup skip, Haiku call, error handling).
Run: cd services/agent-orchestrator && python -m pytest tests/test_haiku_enrichment_service.py -v
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.haiku_enrichment_service import HaikuEnrichmentService, EnrichmentResult


# ── Test 1: skip when submission already complete ─────────────────────────────


@pytest.mark.asyncio
async def test_skip_when_submission_complete():
    """HAIKU-01: enrich() returns None when submission row already has all 3 fields."""
    service = HaikuEnrichmentService()
    with patch.object(
        service, "_is_already_enriched", new=AsyncMock(return_value=True)
    ):
        result = await service.enrich(
            wine_id="wine-001",
            wine_name="Opus One",
            vintage="2019",
        )
    assert result is None


# ── Test 2: skip when master library already complete ─────────────────────────


@pytest.mark.asyncio
async def test_skip_when_master_library_complete():
    """HAIKU-02: enrich() returns None when master_wine_library row already has all 3 fields."""
    service = HaikuEnrichmentService()
    with patch.object(
        service, "_is_already_enriched", new=AsyncMock(return_value=True)
    ):
        result = await service.enrich(
            wine_id="wine-002",
            wine_name="Barolo",
            vintage="2018",
        )
    assert result is None


# ── Test 3: calls Haiku and returns EnrichmentResult ─────────────────────────


@pytest.mark.asyncio
async def test_enrich_calls_haiku_and_returns_result():
    """HAIKU-03: enrich() calls Haiku when not enriched and returns full EnrichmentResult."""
    service = HaikuEnrichmentService()

    # Mock _is_already_enriched to return False (needs enrichment)
    mock_response = MagicMock()
    mock_response.content = [MagicMock()]
    mock_response.content[0].text = (
        '{"region": {"value": "Burgundy", "confidence": 0.95, "source": "knowledge"}, '
        '"country": {"value": "France", "confidence": 0.95, "source": "knowledge"}, '
        '"grape_variety": {"value": "Pinot Noir", "confidence": 0.90, "source": "knowledge"}, '
        '"producer_bio": {"value": "Historic domaine", "confidence": 0.80, "source": "knowledge"}}'
    )

    mock_anthropic_client = AsyncMock()
    mock_anthropic_client.messages.create = AsyncMock(return_value=mock_response)

    with patch.object(
        service, "_is_already_enriched", new=AsyncMock(return_value=False)
    ), patch.object(service, "_get_anthropic", return_value=mock_anthropic_client):
        result = await service.enrich(
            wine_id="wine-003",
            wine_name="Chambolle-Musigny",
            vintage="2017",
        )

    assert result is not None
    assert isinstance(result, EnrichmentResult)
    assert result.wine_id == "wine-003"
    assert result.field_confidence["region"]["value"] == "Burgundy"
    assert result.field_confidence["country"]["value"] == "France"
    assert result.field_confidence["grape_variety"]["value"] == "Pinot Noir"
    assert result.field_confidence["producer_bio"]["value"] == "Historic domaine"
    assert result.enrichment_source == "haiku"


# ── Test 4: raises ValueError on malformed JSON ───────────────────────────────


@pytest.mark.asyncio
async def test_enrich_raises_on_malformed_json():
    """HAIKU-04: enrich() raises ValueError when Haiku returns non-JSON text."""
    service = HaikuEnrichmentService()

    mock_response = MagicMock()
    mock_response.content = [MagicMock()]
    mock_response.content[0].text = "not json at all"

    mock_anthropic_client = AsyncMock()
    mock_anthropic_client.messages.create = AsyncMock(return_value=mock_response)

    with patch.object(
        service, "_is_already_enriched", new=AsyncMock(return_value=False)
    ), patch.object(service, "_get_anthropic", return_value=mock_anthropic_client):
        with pytest.raises(ValueError, match="Haiku returned non-JSON"):
            await service.enrich(
                wine_id="wine-004",
                wine_name="Mystery Wine",
                vintage=None,
            )


# ── Test 5: EnrichmentResult default enrichment_source ───────────────────────


def test_enrichment_result_default_source():
    """HAIKU-05: EnrichmentResult.enrichment_source defaults to 'haiku'."""
    result = EnrichmentResult(
        wine_id="x",
        field_confidence={
            "region": {"value": "R", "confidence": 0.9, "source": "knowledge"},
            "country": {"value": "C", "confidence": 0.9, "source": "knowledge"},
        },
    )
    assert result.enrichment_source == "haiku"
