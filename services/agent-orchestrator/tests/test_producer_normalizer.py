"""
Unit tests for normalize_wine_fields() — producer field cleanup.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.claude_vision_extractor import normalize_wine_fields


def _make_wine(producer: str, vintage=None, region=None, country=None) -> dict:
    """Helper: create a minimal wine dict with nested {value, confidence, source} entries."""
    wine = {
        "producer": {"value": producer, "confidence": 0.85, "source": "visible"},
        "vintage": {"value": vintage, "confidence": 0.99 if vintage else 0.0, "source": "visible"},
    }
    if region is not None:
        wine["region"] = {"value": region, "confidence": 0.80, "source": "visible"}
    if country is not None:
        wine["country"] = {"value": country, "confidence": 0.80, "source": "visible"}
    return wine


def _get(wine: dict, field: str):
    e = wine.get(field)
    if isinstance(e, dict):
        return e.get("value")
    return e


# ── Vintage prefix stripping ──────────────────────────────────────────────────

def test_strips_vintage_prefix_from_producer():
    wine = _make_wine("2022 Bodegas y Viñedos Toledo")
    result = normalize_wine_fields(wine)
    assert _get(result, "producer") == "Bodegas y Viñedos Toledo"
    assert _get(result, "vintage") == 2022


def test_strips_vintage_prefix_domaine():
    wine = _make_wine("2019 Domaine de Justices")
    result = normalize_wine_fields(wine)
    assert _get(result, "producer") == "Domaine de Justices"
    assert _get(result, "vintage") == 2019


def test_does_not_overwrite_existing_vintage():
    """If vintage is already set, year prefix should be removed from producer but vintage preserved."""
    wine = _make_wine("2019 Domaine Leflaive", vintage=2020)
    result = normalize_wine_fields(wine)
    assert _get(result, "producer") == "Domaine Leflaive"
    # existing vintage (2020) is NOT overwritten by the prefix year (2019)
    assert _get(result, "vintage") == 2020


def test_no_year_prefix_unchanged():
    wine = _make_wine("Château Margaux")
    result = normalize_wine_fields(wine)
    assert _get(result, "producer") == "Château Margaux"


# ── Region / country stripping ────────────────────────────────────────────────

def test_strips_region_suffix_from_producer():
    wine = _make_wine("Domaine de Justices Loire Valley")
    result = normalize_wine_fields(wine)
    assert _get(result, "producer") == "Domaine de Justices"


def test_strips_country_suffix_from_producer():
    wine = _make_wine("Masi Spain")
    result = normalize_wine_fields(wine)
    assert _get(result, "producer") == "Masi"


def test_strips_combined_vintage_and_region():
    """Full pipeline: '2022 Domaine de Justices Loire Valley Spain'."""
    wine = _make_wine("2022 Domaine de Justices Loire Valley Spain")
    result = normalize_wine_fields(wine)
    assert _get(result, "producer") == "Domaine de Justices"
    assert _get(result, "vintage") == 2022


def test_producer_not_entirely_stripped():
    """Should not strip a producer whose name IS a region word."""
    wine = _make_wine("Bordeaux Cellars")
    result = normalize_wine_fields(wine)
    # "Cellars" is not a region — only tail tokens are stripped so "Bordeaux Cellars" stays
    assert _get(result, "producer") == "Bordeaux Cellars"


# ── Clean inputs unchanged ────────────────────────────────────────────────────

def test_clean_producer_unchanged():
    wine = _make_wine("Antinori", vintage=2018)
    result = normalize_wine_fields(wine)
    assert _get(result, "producer") == "Antinori"
    assert _get(result, "vintage") == 2018


def test_nv_wine_unchanged():
    wine = _make_wine("Veuve Clicquot", vintage=None)
    result = normalize_wine_fields(wine)
    assert _get(result, "producer") == "Veuve Clicquot"
    assert _get(result, "vintage") is None


def test_plain_string_producer_also_normalized():
    """Normalizer works when producer is a plain string (not nested dict)."""
    wine = {"producer": "2021 Ridge Monte Bello", "vintage": None}
    result = normalize_wine_fields(wine)
    assert result["producer"] == "Ridge Monte Bello"
    assert result["vintage"] == 2021
