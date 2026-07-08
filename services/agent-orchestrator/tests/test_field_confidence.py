"""
Phase 7: Field Confidence Framework Tests (FCONF-12)
=====================================================
Unit tests for field_confidence.py helpers + E2E integration test
covering the full extraction-to-review-queue pipeline (mocked).

Run with:
    cd services/agent-orchestrator && python -m pytest tests/test_field_confidence.py -v

All tests are self-contained — no live API or DB calls.
"""

import sys
import os

# Allow running from the agent-orchestrator root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from services.field_confidence import (
    build_field_confidence,
    merge_field_confidence,
    route_fields_by_threshold,
    compute_completeness_from_fc,
    should_auto_block,
    VISION_FIELDS,
)


# ===========================================================================
# Fixtures
# ===========================================================================


def _make_nested_wine(**fields):
    """Build a wine dict with nested {value, confidence, source} entries."""
    return {
        k: {"value": v, "confidence": c, "source": s} for k, (v, c, s) in fields.items()
    }


def _make_fc(field_confidences: dict) -> dict:
    """Directly build a field_confidence dict: {field: (value, confidence, source)}."""
    return {
        k: {"value": v, "confidence": c, "source": s}
        for k, (v, c, s) in field_confidences.items()
    }


# ===========================================================================
# FC-01: build_field_confidence — nested format
# ===========================================================================


def test_build_field_confidence_nested_format():
    """Nested {value, confidence, source} input preserved exactly."""
    wine = {
        "wine_name": {
            "value": "Barolo Riserva",
            "confidence": 0.97,
            "source": "visible",
        },
        "vintage": {"value": 2016, "confidence": 0.99, "source": "visible"},
        "region": {"value": "Piedmont", "confidence": 0.92, "source": "inferred"},
    }
    fc = build_field_confidence(wine)
    assert fc["wine_name"]["value"] == "Barolo Riserva"
    assert fc["wine_name"]["confidence"] == pytest.approx(0.97)
    assert fc["wine_name"]["source"] == "visible"
    assert fc["vintage"]["value"] == 2016
    assert fc["region"]["confidence"] == pytest.approx(0.92)
    assert fc["region"]["source"] == "inferred"


# ===========================================================================
# FC-02: build_field_confidence — flat (legacy) format
# ===========================================================================


def test_build_field_confidence_flat_format():
    """Flat-value input wrapped with confidence=0.5, source=visible."""
    wine = {
        "wine_name": "Château Margaux",
        "vintage": 2018,
        "price_bottle": 285.0,
    }
    fc = build_field_confidence(wine, source="visible")
    assert fc["wine_name"]["value"] == "Château Margaux"
    assert fc["wine_name"]["confidence"] == pytest.approx(0.5)
    assert fc["wine_name"]["source"] == "visible"
    assert fc["vintage"]["value"] == 2018
    assert fc["price_bottle"]["value"] == pytest.approx(285.0)


# ===========================================================================
# FC-03: merge_field_confidence — higher confidence wins
# ===========================================================================


def test_merge_field_confidence_higher_wins():
    """New FC replaces existing when new confidence >= existing confidence."""
    existing = _make_fc({"region": ("Bordeaux", 0.6, "inferred")})
    new = _make_fc({"region": ("Bordeaux", 0.85, "knowledge")})
    merged = merge_field_confidence(existing, new)
    assert merged["region"]["confidence"] == pytest.approx(0.85)
    assert merged["region"]["source"] == "knowledge"


# ===========================================================================
# FC-04: merge_field_confidence — lower confidence kept (Vision protected)
# ===========================================================================


def test_merge_field_confidence_lower_kept():
    """Existing FC kept when existing confidence > new confidence (D-08)."""
    existing = _make_fc({"wine_name": ("Barolo", 0.98, "visible")})
    new = _make_fc({"wine_name": ("Barolo", 0.7, "knowledge")})
    merged = merge_field_confidence(existing, new, overwrite_lower=True)
    assert merged["wine_name"]["confidence"] == pytest.approx(0.98)
    assert merged["wine_name"]["source"] == "visible"


# ===========================================================================
# FC-05: merge_field_confidence — fills gaps
# ===========================================================================


def test_merge_field_confidence_fills_gaps():
    """New FC adds fields absent from existing FC."""
    existing = _make_fc({"wine_name": ("Barolo", 0.99, "visible")})
    new = _make_fc({"food_pairing": ("lamb, beef", 0.8, "knowledge")})
    merged = merge_field_confidence(existing, new)
    assert "wine_name" in merged
    assert "food_pairing" in merged
    assert merged["food_pairing"]["value"] == "lamb, beef"


# ===========================================================================
# FC-06: route_fields_by_threshold — 3 tiers
# ===========================================================================


def test_route_fields_3_tiers():
    """Fields routed correctly to accepted / review / rejected tiers."""
    fc = _make_fc(
        {
            "wine_name": ("Barolo", 0.97, "visible"),  # > 0.8 → accepted
            "sub_region": ("Serralunga", 0.65, "inferred"),  # 0.5-0.8 → review
            "sweetness_level": ("dry", 0.3, "inferred"),  # < 0.5 → rejected
        }
    )
    accepted, review, rejected = route_fields_by_threshold(fc)
    assert "wine_name" in accepted
    assert accepted["wine_name"] == "Barolo"
    review_fields = [r["field_name"] for r in review]
    assert "sub_region" in review_fields
    assert "sweetness_level" in rejected
    assert rejected["sweetness_level"] is None


# ===========================================================================
# FC-07: route_fields_by_threshold — review tier fields also persisted
# ===========================================================================


def test_route_fields_review_also_persisted():
    """Review-tier fields appear in BOTH accepted and review list (value persisted, flagged)."""
    fc = _make_fc(
        {
            "sub_region": ("Pauillac", 0.62, "inferred"),
        }
    )
    accepted, review, rejected = route_fields_by_threshold(fc)
    # Value must be in accepted (persisted to DB)
    assert "sub_region" in accepted
    assert accepted["sub_region"] == "Pauillac"
    # And also flagged in review
    review_fields = [r["field_name"] for r in review]
    assert "sub_region" in review_fields
    # Not rejected
    assert "sub_region" not in rejected


# ===========================================================================
# FC-08: compute_completeness_from_fc
# ===========================================================================


def test_compute_completeness_from_fc():
    """Completeness = average confidence across all present fields."""
    fc = _make_fc(
        {
            "wine_name": ("Barolo", 0.9, "visible"),
            "region": ("Piedmont", 0.8, "inferred"),
            "sub_region": ("Langhe", 0.6, "inferred"),
            "country": ("Italy", 0.4, "inferred"),
        }
    )
    score = compute_completeness_from_fc(fc)
    expected = round((0.9 + 0.8 + 0.6 + 0.4) / 4, 3)
    assert score == pytest.approx(expected)


# ===========================================================================
# FC-09: should_auto_block — mostly bad
# ===========================================================================


def test_should_auto_block_mostly_bad():
    """Wine is blocked when > 50% of fields have confidence < 0.5."""
    # 12 fields all at 0.3 → 100% below threshold → blocked
    fc = {
        f: {"value": "x", "confidence": 0.3, "source": "inferred"}
        for f in VISION_FIELDS[:12]
    }
    assert should_auto_block(fc) is True


# ===========================================================================
# FC-10: should_auto_block — mostly good
# ===========================================================================


def test_should_auto_block_mostly_good():
    """Wine is NOT blocked when <= 50% of fields have confidence < 0.5."""
    # 16 good fields + 2 bad = 2/18 ≈ 11% below threshold → not blocked
    fc = {
        f: {"value": "x", "confidence": 0.9, "source": "visible"}
        for f in VISION_FIELDS[:16]
    }
    fc[VISION_FIELDS[16]] = {"value": None, "confidence": 0.3, "source": "inferred"}
    fc[VISION_FIELDS[17]] = {"value": None, "confidence": 0.2, "source": "inferred"}
    assert should_auto_block(fc) is False


# ===========================================================================
# FC-11 (E2E): full extraction → field_confidence → routing pipeline
# ===========================================================================


def test_e2e_extraction_to_review_queue():
    """
    E2E integration: simulates 3 wines from a Claude Vision response
    and verifies the full field_confidence → route → auto_block pipeline.

    Wine 1: all high-confidence  → no review items, not blocked
    Wine 2: mixed confidence     → sub_region in review, appellation rejected, not blocked
    Wine 3: most fields very low → auto_blocked = True
    """
    # --- Wine 1: premium Barolo, all fields confident ---
    wine1_raw = {
        "wine_name": {
            "value": "Barolo Riserva",
            "confidence": 0.99,
            "source": "visible",
        },
        "producer": {
            "value": "Giacomo Conterno",
            "confidence": 0.97,
            "source": "visible",
        },
        "vintage": {"value": 2016, "confidence": 0.99, "source": "visible"},
        "primary_type": {"value": "red", "confidence": 0.95, "source": "inferred"},
        "color": {"value": "red", "confidence": 0.95, "source": "inferred"},
        "country": {"value": "Italy", "confidence": 0.96, "source": "inferred"},
        "region": {"value": "Piedmont", "confidence": 0.94, "source": "inferred"},
        "sub_region": {"value": "Langhe", "confidence": 0.88, "source": "inferred"},
        "appellation": {
            "value": "Barolo DOCG",
            "confidence": 0.85,
            "source": "inferred",
        },
        "grape_variety": {
            "value": "Nebbiolo",
            "confidence": 0.93,
            "source": "inferred",
        },
        "price_bottle": {"value": 145.0, "confidence": 0.99, "source": "visible"},
        "section_name": {
            "value": "Italian Reds",
            "confidence": 0.99,
            "source": "visible",
        },
    }
    fc1 = build_field_confidence(wine1_raw)
    accepted1, review1, rejected1 = route_fields_by_threshold(fc1)

    assert len(review1) == 0, f"Wine 1 should have 0 review fields, got {review1}"
    assert len(rejected1) == 0, "Wine 1 should have 0 rejected fields"
    assert should_auto_block(fc1) is False

    # --- Wine 2: mixed confidence (some inferred, some uncertain) ---
    wine2_raw = {
        "wine_name": {"value": "Sassicaia", "confidence": 0.97, "source": "visible"},
        "vintage": {"value": 2019, "confidence": 0.98, "source": "visible"},
        "price_bottle": {"value": 220.0, "confidence": 0.99, "source": "visible"},
        "country": {"value": "Italy", "confidence": 0.89, "source": "inferred"},
        "region": {"value": "Tuscany", "confidence": 0.86, "source": "inferred"},
        "sub_region": {
            "value": "Bolgheri",
            "confidence": 0.62,
            "source": "inferred",
        },  # review tier
        "appellation": {
            "value": "Bolgheri DOC",
            "confidence": 0.42,
            "source": "inferred",
        },  # rejected
        "grape_variety": {
            "value": "Cabernet Sauvignon",
            "confidence": 0.82,
            "source": "inferred",
        },
        "section_name": {
            "value": "Super Tuscans",
            "confidence": 0.99,
            "source": "visible",
        },
    }
    fc2 = build_field_confidence(wine2_raw)
    accepted2, review2, rejected2 = route_fields_by_threshold(fc2)

    review2_fields = [r["field_name"] for r in review2]
    assert (
        "sub_region" in review2_fields
    ), f"sub_region (0.62) should be in review: {review2_fields}"
    assert (
        "appellation" in rejected2
    ), f"appellation (0.42 < 0.5) should be rejected: {rejected2}"
    # sub_region should also be in accepted (persisted)
    assert (
        "sub_region" in accepted2
    ), "review-tier fields must be persisted (in accepted)"
    assert should_auto_block(fc2) is False

    # --- Wine 3: mostly uncertain fields → auto_blocked ---
    wine3_raw = {
        k: {"value": "unknown", "confidence": 0.25, "source": "inferred"}
        for k in VISION_FIELDS
    }
    # Only wine_name is legible
    wine3_raw["wine_name"] = {
        "value": "House Red",
        "confidence": 0.95,
        "source": "visible",
    }

    fc3 = build_field_confidence(wine3_raw)
    # 17/18 fields at 0.25 = 94% below threshold → auto_blocked
    assert should_auto_block(fc3) is True

    # Verify field counts
    assert len(fc1) >= 12, f"fc1 should have 12+ fields, got {len(fc1)}"
    assert len(fc2) >= 9, f"fc2 should have 9+ fields, got {len(fc2)}"
    assert len(fc3) == len(
        VISION_FIELDS
    ), f"fc3 should have all {len(VISION_FIELDS)} fields"
