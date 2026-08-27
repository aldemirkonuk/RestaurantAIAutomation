"""
`beverage_ontology_v1` — the hard rules, and the counting that makes them honest.

The rule tests come in pairs on purpose: a violation must fail, and the same
rule handed missing evidence must SKIP rather than pass. A rule that "passes"
when it could not run is the exact defect this oracle was written to avoid
inheriting from the wine path.
"""

import pytest

from services.beverage_ontology import (
    applies_to_row,
    check_abv_category_plausibility,
    check_abv_proof_consistency,
    check_age_statement_consistency,
    check_protected_origin,
    check_volume_plausibility,
    detect_categories,
    normalize_country,
    normalize_text,
    run_beverage_ontology_checks,
)


# ---------------------------------------------------------------------------
# 1. abv_proof — arithmetic
# ---------------------------------------------------------------------------


class TestAbvProof:
    def test_us_proof_is_twice_abv(self):
        ran, failure = check_abv_proof_consistency(43.0, 86.0)
        assert ran is True
        assert failure is None

    def test_mismatch_is_critical(self):
        ran, failure = check_abv_proof_consistency(43.0, 100.0)
        assert ran is True
        assert failure.severity == "critical"
        assert failure.check == "abv_proof"

    def test_rounding_is_not_a_failure(self):
        # Labels round. 45.3% ABV printed as 90 proof is rounding, not an error.
        ran, failure = check_abv_proof_consistency(45.3, 90.0)
        assert ran is True
        assert failure is None

    def test_imperial_proof_is_named_not_guessed(self):
        # 40% ABV under the imperial (sikes) convention is 70 proof. That is
        # still wrong in a US-proof column, but calling it a random mismatch
        # would lose the only clue about what actually went wrong.
        ran, failure = check_abv_proof_consistency(40.0, 70.0)
        assert ran is True
        assert "IMPERIAL" in failure.message

    def test_missing_proof_skips(self):
        assert check_abv_proof_consistency(43.0, None) == (False, None)

    def test_missing_abv_skips(self):
        assert check_abv_proof_consistency(None, 86.0) == (False, None)

    def test_unwrapped_confidence_dict_skips_rather_than_inventing_a_number(self):
        # `{value: 43, confidence: 0.95}` reaching the rule un-flattened must
        # not have 0.95 scraped out of its repr and read as an ABV.
        assert check_abv_proof_consistency({"value": 43, "confidence": 0.95}, 86.0) == (
            False,
            None,
        )


# ---------------------------------------------------------------------------
# 2. abv_category — a distilled spirit at 3% is not a distilled spirit
# ---------------------------------------------------------------------------


class TestAbvCategory:
    def test_spirit_at_beer_strength_is_critical(self):
        ran, failure = check_abv_category_plausibility(
            "Highland Single Malt Scotch", 4.5
        )
        assert ran is True
        assert failure.severity == "critical"
        assert failure.check == "abv_category"

    def test_ordinary_scotch_passes(self):
        ran, failure = check_abv_category_plausibility(
            "Highland Single Malt Scotch", 43.0
        )
        assert ran is True
        assert failure is None

    def test_freeze_concentrated_beer_is_admitted_not_flagged(self):
        # Brewmeister Snake Venom is a real 67.5% beer. A band that called it an
        # error would be a false positive, which is worse here than a gap.
        ran, failure = check_abv_category_plausibility("Snake Venom Ale", 67.5)
        assert ran is True
        assert failure is None

    def test_non_alcoholic_above_the_threshold_is_critical(self):
        ran, failure = check_abv_category_plausibility("Alcohol Free Sparkling", 12.0)
        assert ran is True
        assert failure.severity == "critical"

    def test_non_alcoholic_qualifier_beats_the_base_style_it_negates(self):
        # "Zero Proof Gin" names two categories. Skipping would blank the rule on
        # the whole NA range; the qualifier is a negation of the base style, not
        # a rival claim, so it wins — and a 12% "zero proof" bottle still fails.
        ran, failure = check_abv_category_plausibility(
            "Zero Proof Gin Alternative", 12.0
        )
        assert ran is True
        assert failure.severity == "critical"

    def test_a_genuine_non_alcoholic_beer_passes(self):
        ran, failure = check_abv_category_plausibility("Alcohol Free Lager", 0.4)
        assert ran is True
        assert failure is None

    def test_two_categories_skip_rather_than_guess(self):
        # "Sherry Cask Single Malt" names a spirit and a fortified wine. Picking
        # one would manufacture a verdict.
        assert check_abv_category_plausibility(
            "Sherry Cask Islay Single Malt", 46.0
        ) == (False, None)

    def test_no_category_token_skips(self):
        assert check_abv_category_plausibility("Domaine Leflaive", 13.0) == (
            False,
            None,
        )

    def test_no_abv_skips(self):
        assert check_abv_category_plausibility("Islay Single Malt", None) == (
            False,
            None,
        )


# ---------------------------------------------------------------------------
# 3. protected_origin — law, not taste
# ---------------------------------------------------------------------------


class TestProtectedOrigin:
    def test_bourbon_from_japan_is_critical(self):
        ran, failure = check_protected_origin("Kentucky Straight Bourbon", "Japan")
        assert ran is True
        assert failure.severity == "critical"
        assert failure.expected == "US"

    def test_bourbon_from_the_usa_passes(self):
        ran, failure = check_protected_origin("Kentucky Straight Bourbon", "USA")
        assert ran is True
        assert failure is None

    def test_scotch_from_scotland_passes_through_the_gb_alias(self):
        ran, failure = check_protected_origin("Islay Single Malt Scotch", "Scotland")
        assert ran is True
        assert failure is None

    def test_tequila_from_spain_is_critical(self):
        ran, failure = check_protected_origin("Tequila Blanco", "Spain")
        assert ran is True
        assert failure.expected == "MX"

    def test_irish_whiskey_allows_both_jurisdictions(self):
        # The Technical File covers Ireland and Northern Ireland; Bushmills is
        # in the latter, so a GB row is lawful and must not fail.
        for country in ("Ireland", "United Kingdom"):
            ran, failure = check_protected_origin("Irish Whiskey", country)
            assert ran is True
            assert failure is None

    def test_unmapped_country_skips_rather_than_failing(self):
        # An unrecognised country string is OUR table's gap. Failing on it would
        # punish the row for our incompleteness.
        assert check_protected_origin("Kentucky Bourbon", "Kentuckystan") == (
            False,
            None,
        )

    def test_missing_country_skips(self):
        assert check_protected_origin("Kentucky Bourbon", None) == (False, None)

    def test_portugal_does_not_trip_the_port_designation(self):
        # Substring matching would find "port" inside "Portugal". Whole-word
        # boundaries are load-bearing, not stylistic.
        assert check_protected_origin("Quinta do Vale", "Portugal") == (False, None)

    def test_unprotected_spirits_are_absent_from_the_table(self):
        # Rum, gin and vodka have no designation of origin. Claiming otherwise
        # would be a fabricated rule.
        for name in ("Caribbean Rum", "London Dry Gin", "Polish Vodka"):
            assert check_protected_origin(name, "Japan") == (False, None)


# ---------------------------------------------------------------------------
# 4. age_statement — a row contradicting itself
# ---------------------------------------------------------------------------


class TestAgeStatement:
    def test_name_and_column_disagreeing_is_critical(self):
        ran, failure = check_age_statement_consistency("Lagavulin 16 Year Old", 12)
        assert ran is True
        assert failure.severity == "critical"
        assert failure.expected == "16"

    def test_agreement_passes(self):
        ran, failure = check_age_statement_consistency("Lagavulin 16 Year Old", 16)
        assert ran is True
        assert failure is None

    @pytest.mark.parametrize(
        "name",
        ["Macallan 12yr", "Macallan 12 yrs", "Macallan 12yo", "Macallan 12-year-old"],
    )
    def test_unit_spellings_all_parse(self, name):
        ran, failure = check_age_statement_consistency(name, 12)
        assert ran is True
        assert failure is None

    def test_bare_integer_is_never_read_as_an_age(self):
        # BEVERAGE_CATALOGUE_ARCHITECTURE.md:190 — "Weller 107 is a proof,
        # Macallan 12 is an age", one token shape, four meanings. Without a unit
        # this rule must not run.
        assert check_age_statement_consistency("Macallan 12", 18) == (False, None)

    def test_a_year_in_the_name_is_not_an_age(self):
        assert check_age_statement_consistency("Buffalo Trace 1792", 8) == (False, None)

    def test_two_age_statements_skip(self):
        assert check_age_statement_consistency("12 yr and 18 yr blend", 12) == (
            False,
            None,
        )

    def test_missing_age_column_skips(self):
        assert check_age_statement_consistency("Lagavulin 16 Year Old", None) == (
            False,
            None,
        )


# ---------------------------------------------------------------------------
# 5. volume_unit — a unit error, not a bottle
# ---------------------------------------------------------------------------


class TestVolume:
    def test_litres_typed_as_millilitres_is_a_warning(self):
        ran, failure = check_volume_plausibility(0.75)
        assert ran is True
        assert failure.severity == "warning"

    def test_standard_bottle_passes(self):
        assert check_volume_plausibility(750) == (True, None)

    def test_melchizedek_passes(self):
        assert check_volume_plausibility(30000) == (True, None)

    def test_absurd_volume_is_a_warning(self):
        ran, failure = check_volume_plausibility(750000)
        assert ran is True
        assert failure is not None

    def test_missing_volume_skips(self):
        assert check_volume_plausibility(None) == (False, None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class TestHelpers:
    def test_accents_are_stripped_for_matching(self):
        assert normalize_text("Cachaça Épica") == "cachaca epica"

    def test_country_aliases_resolve_to_iso(self):
        assert normalize_country("United States of America") == "us"
        assert normalize_country("Scotland") == "gb"
        assert normalize_country("Mars") is None

    def test_category_detection_is_whole_word(self):
        assert detect_categories("Chardonnay") == []
        assert "beer" in detect_categories("Pale Ale")


# ---------------------------------------------------------------------------
# The counting — the whole reason this module exists separately
# ---------------------------------------------------------------------------


class TestCountingIsHonest:
    def test_a_row_nothing_can_be_checked_on_reports_zero_checks(self):
        # This is the case the wine path gets wrong: it would report 4/4 passed.
        result = run_beverage_ontology_checks(
            {"name": "Lagavulin 16 Year Old", "producer": "Lagavulin"}
        )
        assert result["checks_total"] == 0
        assert result["checks_passed"] == 0
        assert result["checks_failed"] == 0

    def test_checks_total_counts_only_rules_that_ran(self):
        result = run_beverage_ontology_checks(
            {
                "name": "Kentucky Straight Bourbon",
                "country": "USA",
                "alcohol_pct": 45.0,
            }
        )
        # abv_category (bourbon + abv) and protected_origin (bourbon + country)
        # can run; proof, age_years and volume_ml are absent.
        assert result["checks_total"] == 2
        assert sorted(result["checks_applied"]) == ["abv_category", "protected_origin"]
        assert sorted(result["checks_skipped"]) == [
            "abv_proof",
            "age_statement",
            "volume_unit",
        ]

    def test_a_real_violation_is_counted_and_described(self):
        result = run_beverage_ontology_checks(
            {
                "name": "Kentucky Straight Bourbon",
                "country": "Japan",
                "alcohol_pct": 45.0,
            }
        )
        assert result["checks_failed"] == 1
        assert result["failures"][0]["check"] == "protected_origin"

    def test_abv_pct_is_read_when_alcohol_pct_is_absent(self):
        # `alcohol_pct` is the enrichment field name; `abv_pct` is the
        # `public.beverages` column. One reader must serve both sources.
        result = run_beverage_ontology_checks(
            {"name": "Islay Single Malt", "abv_pct": 46.0}
        )
        assert "abv_category" in result["checks_applied"]


class TestAppliesToRow:
    def test_a_wine_is_declined(self):
        assert applies_to_row({"name": "Barolo", "grape_variety": "Nebbiolo"}) is False
        assert applies_to_row({"name": "x", "appellation": "Barolo"}) is False
        assert applies_to_row({"name": "x", "vintage": "2016"}) is False

    def test_a_spirit_is_accepted(self):
        assert applies_to_row({"name": "Lagavulin 16 Year Old"}) is True

    def test_nv_is_not_a_vintage_and_does_not_decline_the_row(self):
        # "NV" appears on sparkling wine and on nothing else this oracle grades;
        # it is not a four-digit year, so it must not be treated as one.
        assert applies_to_row({"name": "Solera Sherry", "vintage": "NV"}) is True
