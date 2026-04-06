"""
Tests for DatasetIngestionService — Phase 10 Plan 03.

TDD RED phase: tests written before implementation.
Covers behavior spec from 10-03-PLAN.md <behavior> section.
Full test suite lives in Plan 10-05 (test_dataset_ingestion.py).
"""

import pytest
from unittest.mock import MagicMock, patch


# ─── _field_match ────────────────────────────────────────────────────────────

def test_field_match_case_insensitive():
    from services.dataset_ingestion_service import _field_match
    assert _field_match("Barolo", "barolo") is True


def test_field_match_empty_a_returns_false():
    from services.dataset_ingestion_service import _field_match
    assert _field_match("", "Barolo") is False


def test_field_match_none_a_returns_false():
    from services.dataset_ingestion_service import _field_match
    assert _field_match(None, "Barolo") is False


def test_field_match_none_b_returns_false():
    from services.dataset_ingestion_service import _field_match
    assert _field_match("Barolo", None) is False


def test_field_match_identical_strings():
    from services.dataset_ingestion_service import _field_match
    assert _field_match("Opus One", "Opus One") is True


def test_field_match_very_different_returns_false():
    from services.dataset_ingestion_service import _field_match
    assert _field_match("Barolo", "Dom Perignon") is False


# ─── wine_matches ────────────────────────────────────────────────────────────

def test_wine_matches_perfect_four_fields():
    from services.dataset_ingestion_service import wine_matches
    library = {
        "name": "Opus One",
        "producer": "Opus One Winery",
        "vintage": 2019,
        "appellation": "Oakville",
    }
    db = {
        "name": "Opus One",
        "producer": "Opus One Winery",
        "vintage": "2019",
        "appellation": "Oakville",
    }
    assert wine_matches(library, db) == 4


def test_wine_matches_no_overlap_returns_zero():
    from services.dataset_ingestion_service import wine_matches
    library = {"name": "Champagne Brut", "vintage": 2015}
    db = {"name": "Dom Perignon", "vintage": "2018"}
    assert wine_matches(library, db) == 0


def test_wine_matches_csv_no_producer_3_field_match():
    """CSV rows have no producer — match on (name, vintage, appellation) only."""
    from services.dataset_ingestion_service import wine_matches
    csv_record = {
        "name": "Barolo",
        "producer": None,   # CSV has no producer
        "vintage": "2019",
        "appellation": "Barolo DOCG",
    }
    db = {
        "name": "Barolo",
        "producer": "Giacomo Conterno",
        "vintage": "2019",
        "appellation": "Barolo DOCG",
    }
    assert wine_matches(csv_record, db) >= 2


def test_wine_matches_vintage_int_vs_string():
    """Vintage must match regardless of int/str type."""
    from services.dataset_ingestion_service import wine_matches
    library = {"name": "Opus One", "producer": "Opus One", "vintage": 2019, "appellation": "Oakville"}
    db = {"name": "Opus One", "producer": "Opus One", "vintage": "2019", "appellation": "Oakville"}
    assert wine_matches(library, db) == 4


def test_wine_matches_min_count_threshold():
    """MIN_MATCH_COUNT is 2."""
    from services.dataset_ingestion_service import MIN_MATCH_COUNT
    assert MIN_MATCH_COUNT == 2


# ─── discover_datasets ───────────────────────────────────────────────────────

def test_discover_datasets_returns_list():
    from services.dataset_ingestion_service import discover_datasets
    result = discover_datasets()
    assert isinstance(result, list)


def test_discover_datasets_has_path_and_format_keys():
    from services.dataset_ingestion_service import discover_datasets
    result = discover_datasets()
    for entry in result:
        assert "path" in entry
        assert "format" in entry
        assert entry["format"] in ("jsonl", "csv")


def test_discover_datasets_no_exception_when_empty(tmp_path, monkeypatch):
    """discover_datasets returns empty list (not exception) if no files found."""
    import services.dataset_ingestion_service as dis
    # Patch DATASET_SOURCES to point at empty tmp dirs
    monkeypatch.setattr(dis, "DATASET_SOURCES", [
        {"glob": str(tmp_path / "*.jsonl"), "format": "jsonl"},
        {"glob": str(tmp_path / "*.csv"), "format": "csv"},
    ])
    result = dis.discover_datasets()
    assert result == []


# ─── enrich_wine ─────────────────────────────────────────────────────────────

def test_enrich_wine_not_found():
    """enrich_wine("fake-uuid") returns not_found without raising."""
    from services.dataset_ingestion_service import DatasetIngestionService

    mock_resp = MagicMock()
    mock_resp.data = None

    mock_supabase = MagicMock()
    (
        mock_supabase.table.return_value
        .select.return_value
        .eq.return_value
        .maybe_single.return_value
        .execute.return_value
    ) = mock_resp

    with patch("services.dataset_ingestion_service._get_supabase_client", return_value=mock_supabase):
        svc = DatasetIngestionService()
        result = svc.enrich_wine("fake-uuid")

    assert result == {"wine_id": "fake-uuid", "status": "not_found"}


def test_enrich_wine_non_destructive_skips_populated_columns(tmp_path, monkeypatch):
    """If wine_structure already populated, service must NOT overwrite it."""
    import services.dataset_ingestion_service as dis

    existing_wine = {
        "id": "wine-abc",
        "name": "Dalla Balla Treviso Prosecco",
        "producer": "Antonio Facchin & Figli",
        "vintage": "2019",
        "appellation": "Prosecco DOC",
        "wine_structure": {"body": "light", "acidity": "high"},   # already populated
        "sensory_profile": {},
        "quality_signals": {},
    }

    mock_resp = MagicMock()
    mock_resp.data = existing_wine

    mock_supabase = MagicMock()
    (
        mock_supabase.table.return_value
        .select.return_value
        .eq.return_value
        .maybe_single.return_value
        .execute.return_value
    ) = mock_resp

    # Point discover_datasets at real library path so we get a match
    monkeypatch.setattr(dis, "DATASET_SOURCES", [
        {"glob": str(tmp_path / "*.jsonl"), "format": "jsonl"},
    ])

    with patch("services.dataset_ingestion_service._get_supabase_client", return_value=mock_supabase):
        svc = dis.DatasetIngestionService()
        result = svc.enrich_wine("wine-abc")

    # With no dataset files → skipped or no_match; crucially NOT an error
    assert result["wine_id"] == "wine-abc"
    # wine_structure must NOT appear in any update call
    for call_args in mock_supabase.table.return_value.update.call_args_list:
        update_payload = call_args[0][0] if call_args[0] else call_args[1].get("data", {})
        assert "wine_structure" not in update_payload
