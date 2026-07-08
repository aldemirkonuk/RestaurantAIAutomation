"""
Phase 9 Ontology Validation Unit Tests
========================================
Tests: ONTO-01 through ONTO-08

All Supabase and DB calls are mocked — no live connections required.
Run: pytest services/agent-orchestrator/tests/test_ontology_validation.py -x -q
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helper: create OntologyValidationService bypassing __init__ DB connection
# ---------------------------------------------------------------------------


def _make_service(mock_supabase=None):
    """Create OntologyValidationService without __init__ to avoid real DB/settings calls."""
    from services.ontology_validation_service import OntologyValidationService

    svc = OntologyValidationService.__new__(OntologyValidationService)
    svc.supabase = mock_supabase or MagicMock()
    return svc


# ---------------------------------------------------------------------------
# Test: check_region_country_consistency (ONTO-01, ONTO-05)
# ---------------------------------------------------------------------------


class TestRegionCountryConsistency:

    def test_country_mismatch_is_critical(self):
        """ONTO-01, ONTO-05: Barolo (Italy) + France country → CRITICAL failure"""
        service = _make_service()

        # check_region_country_consistency uses lookup_region_by_name from ontology_normalization
        # Mock the region row to return country_code='IT' directly on the row
        mock_region_row = {
            "id": "region-barolo",
            "name": "Barolo",
            "country_code": "IT",
            "level": "appellation",
        }

        with patch(
            "services.ontology_normalization.lookup_region_by_name",
            return_value=mock_region_row,
        ):
            result = service.check_region_country_consistency("Barolo", "France")

        assert result is not None
        assert result.severity == "critical"
        assert result.check == "region_country"
        assert "IT" in result.expected

    def test_matching_country_passes(self):
        """ONTO-01: Barolo + Italy → check passes (returns None)"""
        service = _make_service()

        mock_region_row = {
            "id": "region-barolo",
            "name": "Barolo",
            "country_code": "IT",
            "level": "appellation",
        }

        with patch(
            "services.ontology_normalization.lookup_region_by_name",
            return_value=mock_region_row,
        ):
            result = service.check_region_country_consistency("Barolo", "Italy")

        assert result is None

    def test_no_appellation_skips_check(self):
        """ONTO-05: No appellation → skip (None returned, no DB call)"""
        service = _make_service()
        result = service.check_region_country_consistency(None, "France")
        assert result is None

    def test_appellation_not_in_db_skips_check(self):
        """ONTO-05: Appellation not found in DB → skip (no false positives)"""
        service = _make_service()

        with patch(
            "services.ontology_normalization.lookup_region_by_name", return_value=None
        ):
            result = service.check_region_country_consistency(
                "Unknown Appellation XYZ", "France"
            )

        assert result is None


# ---------------------------------------------------------------------------
# Test: normalize_grape_name (ONTO-02)
# ---------------------------------------------------------------------------


class TestGrapeAliasNormalization:

    def test_shiraz_resolves_to_syrah(self):
        """ONTO-02: 'Shiraz' alias → canonical 'Syrah' via cache"""
        import services.ontology_normalization as norm_module

        mock_cache = {"shiraz": "Syrah", "syrah": "Syrah", "petite_syrah": "Syrah"}

        with patch.object(norm_module, "_GRAPE_CACHE", mock_cache):
            with patch.object(norm_module, "_get_supabase", return_value=MagicMock()):
                result = norm_module.normalize_grape_name("Shiraz")

        assert result == "Syrah"

    def test_case_insensitive_alias_match(self):
        """ONTO-02: Alias lookup is case-insensitive"""
        import services.ontology_normalization as norm_module

        mock_cache = {"grenache": "Grenache", "garnacha": "Grenache"}

        with patch.object(norm_module, "_GRAPE_CACHE", mock_cache):
            with patch.object(norm_module, "_get_supabase", return_value=MagicMock()):
                result = norm_module.normalize_grape_name("GARNACHA")

        assert result == "Grenache"

    def test_unknown_grape_returns_none(self):
        """ONTO-02: No alias match → None (no crash)"""
        import services.ontology_normalization as norm_module

        mock_cache = {"syrah": "Syrah"}
        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.ilike.return_value.limit.return_value.execute.return_value.data = (
            []
        )
        mock_supabase.table.return_value.select.return_value.contains.return_value.limit.return_value.execute.return_value.data = (
            []
        )

        with patch.object(norm_module, "_GRAPE_CACHE", mock_cache):
            with patch.object(norm_module, "_get_supabase", return_value=mock_supabase):
                result = norm_module.normalize_grape_name("Unknown Grape XYZ")

        assert result is None


# ---------------------------------------------------------------------------
# Test: check_grape_appellation_compatibility (ONTO-03, ONTO-05)
# ---------------------------------------------------------------------------


class TestAppellationRuleEnforcement:

    def test_wrong_grape_for_barolo_is_critical(self):
        """ONTO-03, ONTO-05: Barolo requires Nebbiolo; Cabernet Sauvignon → CRITICAL"""
        service = _make_service()
        mock_rules = {
            "required_grapes": [{"grape": "Nebbiolo", "min_pct": 100}],
            "allowed_grapes": [],
        }

        with patch(
            "services.ontology_normalization.lookup_appellation_rules",
            return_value=mock_rules,
        ):
            with patch(
                "services.ontology_normalization.normalize_grape_name",
                return_value="Cabernet Sauvignon",
            ):
                result = service.check_grape_appellation_compatibility(
                    "Barolo", "Cabernet Sauvignon"
                )

        assert result is not None
        assert result.severity == "critical"
        assert result.check == "grape_appellation"
        assert "Nebbiolo" in result.message

    def test_correct_grape_for_barolo_passes(self):
        """ONTO-03: Barolo + Nebbiolo → passes (None)"""
        service = _make_service()
        mock_rules = {
            "required_grapes": [{"grape": "Nebbiolo", "min_pct": 100}],
            "allowed_grapes": [],
        }

        with patch(
            "services.ontology_normalization.lookup_appellation_rules",
            return_value=mock_rules,
        ):
            with patch(
                "services.ontology_normalization.normalize_grape_name",
                return_value="Nebbiolo",
            ):
                result = service.check_grape_appellation_compatibility(
                    "Barolo", "Nebbiolo"
                )

        assert result is None

    def test_no_appellation_rule_skips_check(self):
        """ONTO-05: Appellation not in rules DB → skip (no false positives)"""
        service = _make_service()

        with patch(
            "services.ontology_normalization.lookup_appellation_rules",
            return_value=None,
        ):
            with patch(
                "services.ontology_normalization.normalize_grape_name",
                return_value="Merlot",
            ):
                result = service.check_grape_appellation_compatibility(
                    "Unknown Appellation", "Merlot"
                )

        assert result is None


# ---------------------------------------------------------------------------
# Test: check_vintage_plausibility (ONTO-04, ONTO-05)
# ---------------------------------------------------------------------------


class TestVintagePlausibility:

    def test_impossible_vintage_is_critical(self):
        """ONTO-04, ONTO-05: vintage=2099 with min_release_delay_months=1 → CRITICAL regardless of current date

        2099 + 1 month delay = earliest release Nov 2099.
        This is always in the future, making it CRITICAL without any datetime mocking.
        """
        from services.ontology_validation_service import OntologyValidationService

        s = OntologyValidationService.__new__(OntologyValidationService)
        s.supabase = MagicMock()

        mock_rules = {
            "min_release_delay_months": 1,
            "allows_nv": False,
            "rule_type": "standard",
        }
        # check_vintage_plausibility uses .limit(1).execute() (not maybe_single)
        s.supabase.table.return_value.select.return_value.ilike.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            mock_rules
        ]

        result = s.check_vintage_plausibility("2099", "Barolo")

        assert result is not None
        assert result.severity == "critical"
        assert result.check == "vintage_plausibility"

    def test_nv_vintage_always_passes(self):
        """ONTO-04: NV (non-vintage) always passes without DB lookup"""
        service = _make_service()
        result = service.check_vintage_plausibility("NV", "Champagne")
        assert result is None

    def test_nv_variants_pass(self):
        """ONTO-04: 'N/V' and 'NON-VINTAGE' also pass without DB lookup"""
        service = _make_service()
        assert service.check_vintage_plausibility("N/V", "Champagne") is None
        assert service.check_vintage_plausibility("NON-VINTAGE", "Champagne") is None

    def test_no_appellation_skips_check(self):
        """ONTO-05: No appellation → skip vintage check (no false positives)"""
        service = _make_service()
        result = service.check_vintage_plausibility("2020", None)
        assert result is None

    def test_no_vintage_rule_skips_check(self):
        """ONTO-05: Vintage present but no DB rule for appellation → skip"""
        service = _make_service()
        service.supabase.table.return_value.select.return_value.ilike.return_value.eq.return_value.limit.return_value.execute.return_value.data = (
            []
        )

        result = service.check_vintage_plausibility("2020", "UnknownAppellation")
        assert result is None


# ---------------------------------------------------------------------------
# Test: color/grape consistency severity (ONTO-02, ONTO-05, D-03)
# ---------------------------------------------------------------------------


class TestColorGrapeWarning:

    def test_color_grape_mismatch_is_warning_not_critical(self):
        """ONTO-02, D-03: Syrah (red) + color=white → WARNING severity (not CRITICAL)"""
        service = _make_service()

        with patch(
            "services.ontology_normalization.normalize_grape_name", return_value="Syrah"
        ):
            with patch(
                "services.ontology_normalization.get_grape_color", return_value="red"
            ):
                result = service.check_color_grape_consistency("white", "Syrah")

        assert result is not None
        assert result.severity == "warning"
        assert result.check == "color_grape"

    def test_matching_color_grape_passes(self):
        """D-03: Syrah (red) + color=red → passes (None)"""
        service = _make_service()

        with patch(
            "services.ontology_normalization.normalize_grape_name", return_value="Syrah"
        ):
            with patch(
                "services.ontology_normalization.get_grape_color", return_value="red"
            ):
                result = service.check_color_grape_consistency("red", "Syrah")

        assert result is None

    def test_unknown_grape_color_skips_check(self):
        """ONTO-05: Grape color unknown → skip (no false positives)"""
        service = _make_service()

        with patch(
            "services.ontology_normalization.normalize_grape_name",
            return_value="ExoticGrape",
        ):
            with patch(
                "services.ontology_normalization.get_grape_color", return_value=None
            ):
                result = service.check_color_grape_consistency("red", "ExoticGrape")

        assert result is None


# ---------------------------------------------------------------------------
# Test: deterministic autofill (ONTO-08, D-04)
# ---------------------------------------------------------------------------


class TestOntologyAutofill:

    def test_autofill_applied_when_confidence_low(self):
        """ONTO-08, D-04: country confidence=0.6 (<0.8) → autofill applied at confidence=1.0"""
        service = _make_service()
        fc = {"country": {"value": "Unknown", "confidence": 0.6, "source": "inferred"}}

        with patch(
            "services.ontology_normalization.get_country_for_appellation",
            return_value="FR",
        ):
            with patch(
                "services.ontology_normalization.get_region_for_appellation",
                return_value=None,
            ):
                with patch(
                    "services.ontology_normalization.get_grape_color", return_value=None
                ):
                    updated_fc, count = service._apply_ontology_autofills(
                        fc, "Pauillac", None
                    )

        assert count >= 1
        assert updated_fc["country"]["confidence"] == 1.0
        assert updated_fc["country"]["source"] == "ontology"

    def test_autofill_skipped_when_confidence_high(self):
        """ONTO-08, D-04: country confidence=0.9 (>=0.8) → autofill NOT applied"""
        service = _make_service()
        fc = {
            "country": {"value": "France", "confidence": 0.9, "source": "web_verified"}
        }

        with patch(
            "services.ontology_normalization.get_country_for_appellation",
            return_value="FR",
        ):
            with patch(
                "services.ontology_normalization.get_region_for_appellation",
                return_value=None,
            ):
                with patch(
                    "services.ontology_normalization.get_grape_color", return_value=None
                ):
                    updated_fc, count = service._apply_ontology_autofills(
                        fc, "Pauillac", None
                    )

        # Country should NOT be overwritten (high confidence)
        assert updated_fc["country"]["confidence"] == 0.9
        assert updated_fc["country"]["source"] == "web_verified"

    def test_autofill_fills_absent_field(self):
        """ONTO-08, D-04: absent field (not in FC) → autofill applied"""
        service = _make_service()
        fc = {}  # country not present

        with patch(
            "services.ontology_normalization.get_country_for_appellation",
            return_value="IT",
        ):
            with patch(
                "services.ontology_normalization.get_region_for_appellation",
                return_value=None,
            ):
                with patch(
                    "services.ontology_normalization.get_grape_color", return_value=None
                ):
                    updated_fc, count = service._apply_ontology_autofills(
                        fc, "Barolo", None
                    )

        assert "country" in updated_fc
        assert updated_fc["country"]["confidence"] == 1.0
        assert updated_fc["country"]["source"] == "ontology"
