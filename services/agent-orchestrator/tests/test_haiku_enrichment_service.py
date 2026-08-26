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


# ── OD-75: outcome must reflect the PARSE, not just the HTTP call ────────────


def _haiku_mocks(text: str):
    """Anthropic client + spend-logger mocks for the OD-75 grading tests."""
    mock_response = MagicMock()
    mock_response.content = [MagicMock()]
    mock_response.content[0].text = text
    mock_response.usage.input_tokens = 1200
    mock_response.usage.output_tokens = 300

    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=mock_response)

    logger_mock = MagicMock()
    return client, logger_mock


@pytest.mark.asyncio
async def test_unparseable_haiku_response_records_partial_not_success():
    """
    OD-75: a prose answer is NOT a completed enrichment.

    The emit used to sit above json.loads, so this call — which raises
    ValueError and enriches nothing — was written to api_spend and
    neural_footprint_event as outcome='success' on the call_level_v0 basis.
    It must now record 'partial' on the stronger 'parse_v1' basis, and the
    row must still be written exactly once because the tokens were billed.
    """
    service = HaikuEnrichmentService()
    client, logger_mock = _haiku_mocks("I'm happy to help with that wine!")

    with patch.object(
        service, "_is_already_enriched", new=AsyncMock(return_value=False)
    ), patch.object(service, "_get_anthropic", return_value=client), patch(
        "services.haiku_enrichment_service.get_spend_logger",
        return_value=logger_mock,
    ):
        with pytest.raises(ValueError, match="Haiku returned non-JSON"):
            await service.enrich(
                wine_id="wine-od75",
                wine_name="Mystery Wine",
                vintage=None,
            )

    # Exactly one row — the spend is owed, but must not be double-counted.
    assert logger_mock.log.call_count == 1
    kwargs = logger_mock.log.call_args.kwargs
    assert kwargs["outcome"] == "partial"
    assert kwargs["outcome"] != "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is True
    # Cost survives the parse failure — the call was paid for either way.
    assert kwargs["input_tokens"] == 1200
    assert kwargs["output_tokens"] == 300
    assert kwargs["cost_usd"] > 0


@pytest.mark.asyncio
async def test_parsed_haiku_response_records_success_on_parse_basis():
    """OD-75: the happy path keeps 'success' but upgrades the basis to parse_v1."""
    service = HaikuEnrichmentService()
    client, logger_mock = _haiku_mocks(
        '{"region": {"value": "Rioja", "confidence": 0.9, "source": "knowledge"}}'
    )

    with patch.object(
        service, "_is_already_enriched", new=AsyncMock(return_value=False)
    ), patch.object(service, "_get_anthropic", return_value=client), patch(
        "services.haiku_enrichment_service.get_spend_logger",
        return_value=logger_mock,
    ):
        result = await service.enrich(
            wine_id="wine-od75-ok",
            wine_name="Rioja Reserva",
            vintage="2016",
        )

    assert result is not None
    assert logger_mock.log.call_count == 1
    kwargs = logger_mock.log.call_args.kwargs
    assert kwargs["outcome"] == "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is False


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
