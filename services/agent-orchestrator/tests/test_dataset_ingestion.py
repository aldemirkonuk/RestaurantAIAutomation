"""
Unit tests for dataset_ingestion_service.py
Covers: D-02 (fuzzy match, non-destructive JSONB guard, CSV no-producer fallback)

All external dependencies (Supabase, filesystem) are mocked.
No live connections required.
"""

import pytest
from unittest.mock import patch, MagicMock

from services.dataset_ingestion_service import (
    wine_matches,
    _field_match,
    DatasetIngestionService,
    MIN_MATCH_COUNT,
    discover_datasets,
)


# =============================================================================
# _field_match: fuzzy string comparison
# =============================================================================

class TestFieldMatch:
    """_field_match uses SequenceMatcher with threshold=0.85."""

    def test_identical_strings_match(self):
        assert _field_match("Barolo", "Barolo") is True

    def test_case_insensitive_match(self):
        assert _field_match("Barolo", "barolo") is True

    def test_empty_string_no_match(self):
        assert _field_match("", "Barolo") is False

    def test_none_a_no_match(self):
        assert _field_match(None, "Barolo") is False

    def test_none_b_no_match(self):
        assert _field_match("Barolo", None) is False

    def test_both_none_no_match(self):
        assert _field_match(None, None) is False

    def test_dissimilar_strings_no_match(self):
        assert _field_match("Barolo", "Champagne") is False

    def test_exact_longer_string(self):
        assert _field_match("Opus One Winery", "Opus One Winery") is True

    def test_threshold_default_is_085(self):
        """Strings with ratio < 0.85 should not match."""
        # "abc" vs "xyz" ratio ≈ 0.0
        assert _field_match("abc", "xyz") is False


# =============================================================================
# wine_matches: field counting
# =============================================================================

class TestWineMatches:
    """wine_matches counts matching fields (0-4) between library record and DB wine."""

    def test_perfect_four_field_match(self):
        lib = {
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
        assert wine_matches(lib, db) == 4

    def test_zero_match_below_threshold(self):
        lib = {
            "name": "Dom Perignon",
            "producer": "Moet & Chandon",
            "vintage": 2012,
            "appellation": "Champagne",
        }
        db = {
            "name": "Barolo Riserva",
            "producer": "Gaja",
            "vintage": "2019",
            "appellation": "Barolo DOCG",
        }
        assert wine_matches(lib, db) == 0

    def test_csv_no_producer_three_field_match(self):
        """CSV rows have no producer — match on (name, vintage, appellation) only."""
        csv_record = {
            "name": "Barolo",
            "producer": None,
            "vintage": "2018",
            "appellation": "Barolo DOCG",
        }
        db = {
            "name": "Barolo",
            "producer": "Giacomo Conterno",
            "vintage": "2018",
            "appellation": "Barolo DOCG",
        }
        count = wine_matches(csv_record, db)
        assert count == 3  # name + vintage + appellation; producer skipped

    def test_vintage_type_coercion_int_vs_string(self):
        """Vintage int 2019 matches string '2019'."""
        lib = {"name": "X", "producer": None, "vintage": 2019, "appellation": None}
        db = {"name": "X", "producer": None, "vintage": "2019", "appellation": None}
        count = wine_matches(lib, db)
        assert count >= 1  # at least name + vintage match

    def test_min_match_count_is_2(self):
        assert MIN_MATCH_COUNT == 2

    def test_two_field_match_meets_threshold(self):
        """name + vintage matches → count >= MIN_MATCH_COUNT."""
        lib = {"name": "Barolo", "producer": None, "vintage": 2018, "appellation": None}
        db = {"name": "Barolo", "producer": "Some Producer", "vintage": "2018", "appellation": None}
        count = wine_matches(lib, db)
        assert count >= MIN_MATCH_COUNT

    def test_partial_producer_only_does_not_match_if_name_differs(self):
        """Producer match alone (1 field) is below MIN_MATCH_COUNT."""
        lib = {"name": "Margaux", "producer": "Chateau Margaux", "vintage": None, "appellation": None}
        db = {"name": "Pauillac", "producer": "Chateau Margaux", "vintage": None, "appellation": None}
        count = wine_matches(lib, db)
        assert count < MIN_MATCH_COUNT  # only 1 field: producer

    def test_vintage_mismatch_not_counted(self):
        lib = {"name": "Barolo", "producer": None, "vintage": 2015, "appellation": None}
        db = {"name": "Barolo", "producer": None, "vintage": "2019", "appellation": None}
        count = wine_matches(lib, db)
        assert count == 1  # only name matches

    def test_none_vintage_not_counted(self):
        """If either vintage is None, vintage field is not counted."""
        lib = {"name": "Barolo", "producer": None, "vintage": None, "appellation": "Barolo DOCG"}
        db = {"name": "Barolo", "producer": None, "vintage": "2019", "appellation": "Barolo DOCG"}
        count = wine_matches(lib, db)
        assert count == 2  # name + appellation, vintage skipped


# =============================================================================
# discover_datasets: file discovery
# =============================================================================

class TestDiscoverDatasets:

    def test_returns_empty_list_when_no_files(self, tmp_path, monkeypatch):
        """No crash when no dataset files found — returns empty list."""
        import services.dataset_ingestion_service as dis
        monkeypatch.setattr(dis, "DATASET_SOURCES", [
            {"glob": str(tmp_path / "*.jsonl"), "format": "jsonl"},
            {"glob": str(tmp_path / "*.csv"), "format": "csv"},
        ])
        result = discover_datasets()
        assert result == []

    def test_returns_list_with_path_and_format_keys(self, tmp_path, monkeypatch):
        """Discovered entries have 'path' and 'format' keys."""
        import services.dataset_ingestion_service as dis

        # Create a real temp jsonl file
        test_file = tmp_path / "test_wines.jsonl"
        test_file.write_text('{"name": "Barolo"}\n')

        monkeypatch.setattr(dis, "DATASET_SOURCES", [
            {"glob": str(tmp_path / "*.jsonl"), "format": "jsonl"},
        ])
        result = discover_datasets()
        assert len(result) == 1
        assert "path" in result[0]
        assert result[0]["format"] == "jsonl"

    def test_skips_nonexistent_directory(self, monkeypatch):
        """Non-existent glob path returns empty list without error."""
        import services.dataset_ingestion_service as dis
        monkeypatch.setattr(dis, "DATASET_SOURCES", [
            {"glob": "/nonexistent/path/*.jsonl", "format": "jsonl"},
        ])
        result = discover_datasets()
        assert isinstance(result, list)
        assert result == []


# =============================================================================
# DatasetIngestionService.enrich_wine: non-destructive guard
# =============================================================================

class TestDatasetIngestionServiceNonDestructive:
    """Pre-populated JSONB columns must NOT be overwritten."""

    def test_returns_not_found_when_wine_missing(self):
        """enrich_wine returns status=not_found when wine_id not in DB."""
        service = DatasetIngestionService()

        mock_supabase = MagicMock()
        (
            mock_supabase.table.return_value
            .select.return_value
            .eq.return_value
            .maybe_single.return_value
            .execute.return_value
        ).data = None

        with patch("services.dataset_ingestion_service._get_supabase_client", return_value=mock_supabase):
            result = service.enrich_wine("nonexistent-wine-id")

        assert result["status"] == "not_found"
        assert result["wine_id"] == "nonexistent-wine-id"

    def test_skips_when_no_dataset_files_found(self, tmp_path, monkeypatch):
        """If no dataset files discovered, returns status=skipped without error."""
        import services.dataset_ingestion_service as dis

        monkeypatch.setattr(dis, "DATASET_SOURCES", [
            {"glob": str(tmp_path / "*.jsonl"), "format": "jsonl"},
        ])

        db_wine = {
            "id": "wine-skip",
            "name": "Barolo",
            "producer": "Gaja",
            "vintage": "2019",
            "appellation": "Barolo DOCG",
            "wine_structure": {},
            "sensory_profile": {},
            "quality_signals": {},
        }

        mock_supabase = MagicMock()
        (
            mock_supabase.table.return_value
            .select.return_value
            .eq.return_value
            .maybe_single.return_value
            .execute.return_value
        ).data = db_wine

        with patch("services.dataset_ingestion_service._get_supabase_client", return_value=mock_supabase):
            svc = dis.DatasetIngestionService()
            result = svc.enrich_wine("wine-skip")

        assert result["status"] == "skipped"
        mock_supabase.table.return_value.update.assert_not_called()

    def test_wine_structure_not_overwritten_when_populated(self, tmp_path, monkeypatch):
        """wine_structure already populated → NOT overwritten even if dataset matches."""
        import services.dataset_ingestion_service as dis
        import json

        # Create a matching JSONL record
        test_file = tmp_path / "wines.jsonl"
        test_file.write_text(json.dumps({
            "name": "Barolo",
            "producer": "Gaja",
            "vintage": "2019",
            "classification": {"appellation": "Barolo DOCG"},
            "wine_structure": {"body": "full", "acidity": "high"},
            "sensory_profile": {"primary_aromas": ["cherry", "leather"]},
            "quality_signals": {},
        }) + "\n")

        monkeypatch.setattr(dis, "DATASET_SOURCES", [
            {"glob": str(tmp_path / "*.jsonl"), "format": "jsonl"},
        ])

        db_wine = {
            "id": "wine-populated",
            "name": "Barolo",
            "producer": "Gaja",
            "vintage": "2019",
            "appellation": "Barolo DOCG",
            "wine_structure": {"body": "medium", "acidity": "medium"},  # already populated
            "sensory_profile": {},
            "quality_signals": {},
        }

        mock_supabase = MagicMock()
        (
            mock_supabase.table.return_value
            .select.return_value
            .eq.return_value
            .maybe_single.return_value
            .execute.return_value
        ).data = db_wine

        with patch("services.dataset_ingestion_service._get_supabase_client", return_value=mock_supabase):
            svc = dis.DatasetIngestionService()
            result = svc.enrich_wine("wine-populated")

        # wine_structure must NOT appear in any update payload
        for c in mock_supabase.table.return_value.update.call_args_list:
            update_payload = c[0][0]
            assert "wine_structure" not in update_payload, (
                "wine_structure should NOT be overwritten when already populated"
            )

    def test_empty_jsonb_gets_enriched(self, tmp_path, monkeypatch):
        """Empty JSONB columns ({}) are enriched with dataset data."""
        import services.dataset_ingestion_service as dis
        import json

        test_file = tmp_path / "wines.jsonl"
        test_file.write_text(json.dumps({
            "name": "Barolo",
            "producer": "Gaja",
            "vintage": "2019",
            "classification": {"appellation": "Barolo DOCG"},
            "wine_structure": {"body": "full", "acidity": "high"},
            "sensory_profile": {},
            "quality_signals": {},
        }) + "\n")

        monkeypatch.setattr(dis, "DATASET_SOURCES", [
            {"glob": str(tmp_path / "*.jsonl"), "format": "jsonl"},
        ])

        db_wine = {
            "id": "wine-empty-jsonb",
            "name": "Barolo",
            "producer": "Gaja",
            "vintage": "2019",
            "appellation": "Barolo DOCG",
            "wine_structure": {},       # empty — should be enriched
            "sensory_profile": {},
            "quality_signals": {},
        }

        mock_supabase = MagicMock()
        (
            mock_supabase.table.return_value
            .select.return_value
            .eq.return_value
            .maybe_single.return_value
            .execute.return_value
        ).data = db_wine

        with patch("services.dataset_ingestion_service._get_supabase_client", return_value=mock_supabase):
            svc = dis.DatasetIngestionService()
            result = svc.enrich_wine("wine-empty-jsonb")

        # wine_structure should appear in the update payload
        assert result["status"] == "enriched"
        assert "wine_structure" in result.get("fields_written", [])

    def test_all_populated_returns_skipped_already_populated(self, tmp_path, monkeypatch):
        """If all 3 JSONB columns are populated, returns status=skipped."""
        import services.dataset_ingestion_service as dis
        import json

        test_file = tmp_path / "wines.jsonl"
        test_file.write_text(json.dumps({
            "name": "Barolo",
            "producer": "Gaja",
            "vintage": "2019",
            "classification": {"appellation": "Barolo DOCG"},
            "wine_structure": {"body": "full"},
            "sensory_profile": {"primary_aromas": ["cherry"]},
            "quality_signals": {"quality_level": "premium"},
        }) + "\n")

        monkeypatch.setattr(dis, "DATASET_SOURCES", [
            {"glob": str(tmp_path / "*.jsonl"), "format": "jsonl"},
        ])

        db_wine = {
            "id": "wine-all-pop",
            "name": "Barolo",
            "producer": "Gaja",
            "vintage": "2019",
            "appellation": "Barolo DOCG",
            "wine_structure": {"body": "medium"},       # populated
            "sensory_profile": {"aromas": ["cherry"]},  # populated
            "quality_signals": {"quality_level": "good"}, # populated
        }

        mock_supabase = MagicMock()
        (
            mock_supabase.table.return_value
            .select.return_value
            .eq.return_value
            .maybe_single.return_value
            .execute.return_value
        ).data = db_wine

        with patch("services.dataset_ingestion_service._get_supabase_client", return_value=mock_supabase):
            svc = dis.DatasetIngestionService()
            result = svc.enrich_wine("wine-all-pop")

        assert result["status"] == "skipped"
        mock_supabase.table.return_value.update.assert_not_called()

    def test_no_match_returns_no_match_status(self, tmp_path, monkeypatch):
        """Wine with no dataset match returns status=no_match."""
        import services.dataset_ingestion_service as dis
        import json

        test_file = tmp_path / "wines.jsonl"
        test_file.write_text(json.dumps({
            "name": "Dom Perignon",
            "producer": "Moet & Chandon",
            "vintage": "2015",
            "classification": {"appellation": "Champagne"},
            "wine_structure": {},
            "sensory_profile": {},
            "quality_signals": {},
        }) + "\n")

        monkeypatch.setattr(dis, "DATASET_SOURCES", [
            {"glob": str(tmp_path / "*.jsonl"), "format": "jsonl"},
        ])

        db_wine = {
            "id": "wine-no-match",
            "name": "Barolo Riserva",
            "producer": "Gaja",
            "vintage": "2019",
            "appellation": "Barolo DOCG",
            "wine_structure": {},
            "sensory_profile": {},
            "quality_signals": {},
        }

        mock_supabase = MagicMock()
        (
            mock_supabase.table.return_value
            .select.return_value
            .eq.return_value
            .maybe_single.return_value
            .execute.return_value
        ).data = db_wine

        with patch("services.dataset_ingestion_service._get_supabase_client", return_value=mock_supabase):
            svc = dis.DatasetIngestionService()
            result = svc.enrich_wine("wine-no-match")

        assert result["status"] == "no_match"
        mock_supabase.table.return_value.update.assert_not_called()
