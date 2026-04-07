"""
Unit tests for haiku_tasks._enrich_async (HAIKU-05 task layer).

Tests the async persistence logic in isolation:
- ai_enriched=True is written to master_wine_library_submissions
- No Supabase call when service.enrich() returns None (dedup skip)

Note: haiku_enrich_task (the Celery task wrapper) is not tested here —
it requires a running Celery worker with broker. That is covered by manual-only.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

pytestmark = pytest.mark.asyncio


def _make_enrichment_result(wine_id="test-uuid"):
    from services.haiku_enrichment_service import EnrichmentResult
    return EnrichmentResult(
        wine_id=wine_id,
        field_confidence={
            "region": {"value": "Burgundy", "confidence": 0.95, "source": "knowledge"},
            "country": {"value": "France", "confidence": 0.95, "source": "knowledge"},
            "grape_variety": {"value": "Pinot Noir", "confidence": 0.90, "source": "knowledge"},
            "producer_bio": {"value": "Historic Burgundy estate.", "confidence": 0.80, "source": "knowledge"},
        },
    )


def _make_mock_supabase():
    mock_supabase = MagicMock()
    mock_table = MagicMock()
    mock_supabase.table.return_value = mock_table
    mock_table.update.return_value = mock_table
    mock_table.eq.return_value = mock_table
    mock_table.execute.return_value = MagicMock()
    return mock_supabase, mock_table


async def test_enrich_async_persists_ai_enriched_true():
    """HAIKU-05: _enrich_async writes ai_enriched=True and enrichment_source='haiku' to Supabase."""
    from jobs.haiku_tasks import _enrich_async

    mock_result = _make_enrichment_result()
    mock_supabase, mock_table = _make_mock_supabase()

    with patch("jobs.haiku_tasks._get_supabase_client", return_value=mock_supabase):
        with patch("services.haiku_enrichment_service.HaikuEnrichmentService") as mock_cls:
            mock_cls.return_value.enrich = AsyncMock(return_value=mock_result)
            result = await _enrich_async("test-uuid", "Château Latour", "2018")

    assert result is not None, "Expected enrichment result dict, got None"
    assert "fields_enriched" in result, "Return dict must contain fields_enriched count"
    assert result["wine_id"] == "test-uuid"

    # _enrich_async calls table() twice: once to read existing FC, once to write update
    assert mock_supabase.table.call_count == 2
    mock_supabase.table.assert_called_with("master_wine_library_submissions")
    update_payload = mock_table.update.call_args[0][0]
    assert update_payload["ai_enriched"] is True
    assert update_payload["enrichment_source"] == "haiku"


async def test_enrich_async_skips_supabase_when_result_none():
    """HAIKU-02/04: _enrich_async makes no Supabase call when service returns None (already enriched)."""
    from jobs.haiku_tasks import _enrich_async

    mock_supabase, _ = _make_mock_supabase()

    with patch("jobs.haiku_tasks._get_supabase_client", return_value=mock_supabase):
        with patch("services.haiku_enrichment_service.HaikuEnrichmentService") as mock_cls:
            mock_cls.return_value.enrich = AsyncMock(return_value=None)
            result = await _enrich_async("test-uuid", "Château Latour", "2018")

    assert result is None, "Expected None when enrichment skipped"
    mock_supabase.table.assert_not_called()
