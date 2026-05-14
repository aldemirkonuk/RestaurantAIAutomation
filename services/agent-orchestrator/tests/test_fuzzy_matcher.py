"""
Unit tests for FuzzyMatcher (D-32-15 invoice matching).
"""
import pytest
from services.fuzzy_matcher import get_fuzzy_matcher


@pytest.fixture
def fm():
    return get_fuzzy_matcher()


def test_provider_name_high_similarity(fm):
    score = fm.match_provider_name("Burgundy Imports LLC", "Burgundy Imports")
    assert score >= 0.85


def test_provider_name_low_similarity(fm):
    score = fm.match_provider_name("Smith & Sons Wines", "Jones Beverages Inc")
    assert score <= 0.50


def test_wine_name_handles_vintage_suffix(fm):
    score = fm.match_wine_name("Pommard 2019 1er Cru", "Pommard")
    assert score >= 0.70


def test_wine_name_low_similarity(fm):
    score = fm.match_wine_name("Pouilly-Fumé", "Napa Cabernet")
    assert score <= 0.35


def test_compute_match_score_high(fm):
    score = fm.compute_match_score(0.90, 0.85, True, True)
    assert score >= 0.80


def test_compute_match_score_medium(fm):
    score = fm.compute_match_score(0.60, 0.65, True, False)
    assert 0.50 <= score < 0.80


def test_compute_match_score_low(fm):
    score = fm.compute_match_score(0.20, 0.25, False, False)
    assert score < 0.50


def test_classify_match_auto_suggest(fm):
    score = fm.compute_match_score(0.90, 0.85, True, True)
    assert fm.classify_match(score) == "auto_suggest"


def test_classify_match_possible(fm):
    score = fm.compute_match_score(0.60, 0.65, True, False)
    assert fm.classify_match(score) == "possible_match"


def test_classify_match_no_match(fm):
    score = fm.compute_match_score(0.10, 0.20, False, False)
    assert fm.classify_match(score) == "no_match"


def test_singleton_returns_same_instance(fm):
    fm2 = get_fuzzy_matcher()
    assert fm is fm2
