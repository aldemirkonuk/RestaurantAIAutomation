"""
Tests for critic_score_service.py — Phase 10 Plan 02.
Written before implementation (TDD RED phase).

Covers CRIT-02 (normalization), CRIT-03 (composite), CRIT-04 (retail price parsing),
CRIT-05 (markup classification), and CRIT-06 (anomaly detection).
"""

import pytest
from services.critic_score_service import (
    normalize_score,
    compute_composite_score,
    build_critic_score_queries,
    parse_serper_score_snippets,
    classify_markup,
    compute_markup_info,
    CriticScoreService,
    SCORE_WEIGHTS,
)


# ---------------------------------------------------------------------------
# normalize_score
# ---------------------------------------------------------------------------

class TestNormalizeScore:
    def test_vivino_multiplied_by_20(self):
        assert normalize_score("vivino", 4.2) == 84.0

    def test_jancis_robinson_multiplied_by_5(self):
        assert normalize_score("jancis_robinson", 16.5) == 82.5

    def test_wine_advocate_passthrough(self):
        assert normalize_score("wine_advocate", 93.0) == 93.0

    def test_wine_spectator_passthrough(self):
        assert normalize_score("wine_spectator", 91.0) == 91.0

    def test_decanter_passthrough(self):
        assert normalize_score("decanter", 95.0) == 95.0


# ---------------------------------------------------------------------------
# SCORE_WEIGHTS
# ---------------------------------------------------------------------------

class TestScoreWeights:
    def test_five_sources(self):
        assert len(SCORE_WEIGHTS) == 5

    def test_weights_sum_to_one(self):
        total = sum(SCORE_WEIGHTS.values())
        assert abs(total - 1.0) < 1e-9

    def test_wine_advocate_weight(self):
        assert SCORE_WEIGHTS["wine_advocate"] == 0.30

    def test_vivino_weight(self):
        assert SCORE_WEIGHTS["vivino"] == 0.20


# ---------------------------------------------------------------------------
# compute_composite_score
# ---------------------------------------------------------------------------

class TestCompositeScore:
    def test_two_sources_returns_float(self):
        result = compute_composite_score({
            "wine_advocate": {"normalized_score": 93.0},
            "vivino": {"normalized_score": 84.0},
        })
        assert isinstance(result, float)

    def test_one_source_returns_none(self):
        result = compute_composite_score({
            "wine_advocate": {"normalized_score": 93.0},
        })
        assert result is None

    def test_empty_dict_returns_none(self):
        assert compute_composite_score({}) is None

    def test_weighted_result_correct(self):
        # WA(0.30)=93, Vivino(0.20)=84 → total_weight=0.50
        # weighted_sum = 0.30*93 + 0.20*84 = 27.9 + 16.8 = 44.7
        # composite = 44.7 / 0.50 = 89.4
        result = compute_composite_score({
            "wine_advocate": {"normalized_score": 93.0},
            "vivino": {"normalized_score": 84.0},
        })
        assert result == pytest.approx(89.4, abs=0.2)

    def test_ignores_none_normalized_score(self):
        result = compute_composite_score({
            "wine_advocate": {"normalized_score": 93.0},
            "vivino": {"normalized_score": None},
        })
        assert result is None  # only 1 valid source

    def test_ignores_unknown_source(self):
        # unknown source not in SCORE_WEIGHTS should be excluded
        result = compute_composite_score({
            "wine_advocate": {"normalized_score": 93.0},
            "unknown_source": {"normalized_score": 50.0},
        })
        assert result is None  # unknown_source not in WEIGHTS, only 1 valid


# ---------------------------------------------------------------------------
# build_critic_score_queries
# ---------------------------------------------------------------------------

class TestBuildCriticScoreQueries:
    def test_returns_six_keys(self):
        queries = build_critic_score_queries("Barolo", "Gaja", 2019)
        assert len(queries) == 6
        expected_keys = {
            "wine_advocate", "wine_spectator", "vivino",
            "decanter", "jancis_robinson", "wine_searcher",
        }
        assert set(queries.keys()) == expected_keys

    def test_vintage_in_query(self):
        queries = build_critic_score_queries("Barolo", "Gaja", 2019)
        assert "2019" in queries["wine_advocate"]

    def test_no_vintage_omits_year(self):
        queries = build_critic_score_queries("Champagne", None, None)
        assert "None" not in queries["wine_advocate"]
        assert "None" not in queries["wine_searcher"]

    def test_no_producer_query_still_works(self):
        queries = build_critic_score_queries("Champagne", None, None)
        assert "wine_advocate" in queries
        assert len(queries["wine_advocate"]) > 0

    def test_producer_included_when_present(self):
        queries = build_critic_score_queries("Barolo", "Gaja", 2019)
        assert "Gaja" in queries["vivino"]


# ---------------------------------------------------------------------------
# parse_serper_score_snippets
# ---------------------------------------------------------------------------

class TestParseSerperScoreSnippets:
    def test_empty_results_returns_none(self):
        assert parse_serper_score_snippets([], "wine_advocate") is None

    def test_wine_advocate_extracts_score(self):
        results = [
            {
                "title": "Barolo 2019 - 93 Points Wine Advocate",
                "link": "https://www.wineadvocate.com/wine/barolo",
                "snippet": "93 pts. This 2019 Barolo is exceptional.",
                "position": 1,
            }
        ]
        result = parse_serper_score_snippets(results, "wine_advocate")
        assert result is not None
        assert result["raw_score"] == 93.0
        assert result["normalized_score"] == 93.0
        assert "link" in result
        assert "snippet" in result

    def test_vivino_extracts_score(self):
        results = [
            {
                "title": "Gaja Barolo 2019 - Vivino",
                "link": "https://www.vivino.com/wines/123",
                "snippet": "4.2 out of 5 stars. Excellent Barolo.",
                "position": 1,
            }
        ]
        result = parse_serper_score_snippets(results, "vivino")
        assert result is not None
        assert result["raw_score"] == 4.2
        assert result["normalized_score"] == 84.0

    def test_wine_searcher_extracts_price(self):
        results = [
            {
                "title": "Barolo 2019 prices | wine-searcher",
                "link": "https://www.wine-searcher.com/find/barolo",
                "snippet": "Average retail price $45.00 per bottle.",
                "position": 1,
            }
        ]
        result = parse_serper_score_snippets(results, "wine_searcher")
        assert result is not None
        assert result["raw_score"] == 45.0

    def test_no_matching_score_returns_none(self):
        results = [
            {
                "title": "Some wine page",
                "link": "https://www.wineadvocate.com/wine/barolo",
                "snippet": "No score information available on this page.",
                "position": 1,
            }
        ]
        result = parse_serper_score_snippets(results, "wine_advocate")
        assert result is None

    def test_jancis_robinson_extracts_score(self):
        results = [
            {
                "title": "Penfolds Grange 2017 - JancisRobinson.com",
                "link": "https://www.jancisrobinson.com/articles/penfolds",
                "snippet": "17.5/20. A magnificent wine.",
                "position": 1,
            }
        ]
        result = parse_serper_score_snippets(results, "jancis_robinson")
        assert result is not None
        assert result["raw_score"] == 17.5
        assert result["normalized_score"] == pytest.approx(87.5, abs=0.1)


# ---------------------------------------------------------------------------
# classify_markup
# ---------------------------------------------------------------------------

class TestClassifyMarkup:
    def test_below_1_5_is_value(self):
        assert classify_markup(1.2) == "value"

    def test_1_5_to_2_5_is_standard(self):
        assert classify_markup(2.0) == "standard"
        assert classify_markup(1.5) == "standard"

    def test_2_5_to_4_is_premium(self):
        assert classify_markup(3.0) == "premium"
        assert classify_markup(4.0) == "premium"

    def test_above_4_is_luxury(self):
        assert classify_markup(4.1) == "luxury_markup"
        assert classify_markup(6.0) == "luxury_markup"


# ---------------------------------------------------------------------------
# compute_markup_info
# ---------------------------------------------------------------------------

class TestComputeMarkupInfo:
    def test_standard_markup(self):
        result = compute_markup_info(120.0, 50.0)
        assert result is not None
        assert result["markup_ratio"] == pytest.approx(2.4, abs=0.001)
        assert result["markup_classification"] == "standard"
        assert result["is_anomaly"] is False

    def test_anomaly_above_5x(self):
        result = compute_markup_info(300.0, 50.0)
        assert result is not None
        assert result["markup_ratio"] == pytest.approx(6.0, abs=0.001)
        assert result["markup_classification"] == "luxury_markup"
        assert result["is_anomaly"] is True

    def test_anomaly_below_0_8x(self):
        result = compute_markup_info(30.0, 50.0)
        assert result is not None
        assert result["markup_ratio"] == pytest.approx(0.6, abs=0.001)
        assert result["markup_classification"] == "value"
        assert result["is_anomaly"] is True

    def test_none_menu_price_returns_none(self):
        assert compute_markup_info(None, 50.0) is None

    def test_none_retail_returns_none(self):
        assert compute_markup_info(120.0, None) is None

    def test_zero_retail_returns_none(self):
        assert compute_markup_info(120.0, 0) is None


# ---------------------------------------------------------------------------
# CriticScoreService (facade)
# ---------------------------------------------------------------------------

class TestCriticScoreServiceFacade:
    def test_normalize_score_via_service(self):
        svc = CriticScoreService()
        assert svc.normalize_score("vivino", 4.2) == 84.0

    def test_compute_composite_via_service(self):
        svc = CriticScoreService()
        result = svc.compute_composite_score({
            "wine_advocate": {"normalized_score": 93.0},
        })
        assert result is None

    def test_compute_markup_via_service(self):
        svc = CriticScoreService()
        result = svc.compute_markup_info(300.0, 50.0)
        assert result["is_anomaly"] is True
