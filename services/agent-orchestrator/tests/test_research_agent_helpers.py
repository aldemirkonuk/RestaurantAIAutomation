"""
Phase 12: Research Agent Helpers Unit Tests (RSCH-01..09)
=========================================================
Pure unit tests for all functions in research_agent_helpers.py.

No I/O, no mocking required — every function is a pure helper.
Tests cover the full eligibility gate, query construction, tier classification,
conflict detection, corroboration, regression guard, and citation building.

Run with:
    cd services/agent-orchestrator && python -m pytest tests/test_research_agent_helpers.py -v
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone, timedelta

import pytest

from services.research_agent_helpers import (
    CONFIDENCE_BY_TIER,
    FIELD_VALUE_SYNONYMS,
    RESEARCH_PRIORITY_FIELDS,
    assign_confidence_by_tier,
    build_citation_record,
    build_serper_query,
    check_regression_guard,
    classify_source_tier,
    detect_conflict,
    get_target_fields,
    is_eligible_for_research,
    should_auto_promote,
)
from services.field_confidence import DEFAULT_ACCEPT_THRESHOLD


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _days_ago(n: int) -> str:
    """ISO timestamp string for N days ago (UTC)."""
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


def _fc_entry(value, confidence, source="inferred"):
    return {"value": value, "confidence": confidence, "source": source}


# ---------------------------------------------------------------------------
# is_eligible_for_research
# ---------------------------------------------------------------------------

def test_is_eligible_skips_recent_record():
    """Submission with last_research_run_at 3 days ago is NOT eligible (cooldown = 7 days)."""
    fc = {"region": _fc_entry("Tuscany", 0.5)}
    submission = {"last_research_run_at": _days_ago(3), "field_confidence": fc}
    assert is_eligible_for_research(submission) is False


def test_is_eligible_passes_old_record():
    """Submission with last_research_run_at 10 days ago AND a low-confidence field → eligible."""
    fc = {"wine_name": _fc_entry("Brunello", 0.99, "visible"),
          "region": _fc_entry("Tuscany", 0.6)}   # 0.6 < DEFAULT_ACCEPT_THRESHOLD (0.8)
    submission = {"last_research_run_at": _days_ago(10), "field_confidence": fc}
    assert is_eligible_for_research(submission) is True


def test_is_eligible_skips_human_resolved():
    """All priority fields with source='human_resolved' → no researchable fields → not eligible."""
    fc = {f: _fc_entry("x", 0.3, "human_resolved") for f in RESEARCH_PRIORITY_FIELDS}
    submission = {"last_research_run_at": None, "field_confidence": fc}
    assert is_eligible_for_research(submission) is False


def test_is_eligible_null_last_run():
    """last_research_run_at = None skips cooldown check; NULL field_confidence → eligible."""
    submission = {"last_research_run_at": None, "field_confidence": {}}
    assert is_eligible_for_research(submission) is True


# ---------------------------------------------------------------------------
# get_target_fields
# ---------------------------------------------------------------------------

def test_get_target_fields_returns_null_fields():
    """fc missing 'producer' key → 'producer' in target_fields."""
    fc = {}
    targets = get_target_fields(fc, ["producer", "region"])
    assert "producer" in targets


def test_get_target_fields_excludes_high_confidence():
    """Field with confidence 0.95 (>= DEFAULT_ACCEPT_THRESHOLD) excluded from targets."""
    fc = {
        "region": _fc_entry("Tuscany", 0.95),   # high → excluded
        "producer": _fc_entry("Biondi-Santi", 0.5),  # low → included
    }
    targets = get_target_fields(fc, ["region", "producer"])
    assert "region" not in targets
    assert "producer" in targets


def test_get_target_fields_excludes_human_resolved():
    """Field with source='human_resolved' is excluded even if confidence is low."""
    fc = {"region": _fc_entry("Tuscany", 0.2, "human_resolved")}
    targets = get_target_fields(fc, ["region", "producer"])
    assert "region" not in targets
    # 'producer' is NULL → included
    assert "producer" in targets


# ---------------------------------------------------------------------------
# build_serper_query
# ---------------------------------------------------------------------------

def test_build_serper_query_appellation():
    """Appellation field query includes DOCG DOC AOC official terms."""
    query = build_serper_query("appellation", "Brunello di Montalcino", "Biondi-Santi", "2018")
    assert "DOCG" in query
    assert "DOC" in query
    assert "AOC" in query


def test_build_serper_query_falls_back_for_unknown_field():
    """Unknown field_name uses generic fallback with wine name."""
    query = build_serper_query("critic_scores", "Opus One", "Mondavi", "2020")
    assert "Opus One" in query
    assert "critic_scores" in query


# ---------------------------------------------------------------------------
# classify_source_tier
# ---------------------------------------------------------------------------

def test_classify_source_tier_b():
    """wine-searcher.com is tier B."""
    tier = classify_source_tier("https://www.wine-searcher.com/find/brunello")
    assert tier == "B"


def test_classify_source_tier_a():
    """consorziobrunellomontalcino.it is tier A."""
    tier = classify_source_tier("https://www.consorziobrunellomontalcino.it/en/the-brunello/")
    assert tier == "A"


def test_classify_source_tier_unknown():
    """Unrecognized domain defaults to tier C."""
    tier = classify_source_tier("https://randomwinesite.io/wine/brunello")
    assert tier == "C"


def test_classify_source_tier_subdomain():
    """Subdomain of a known tier-A domain is also tier A."""
    tier = classify_source_tier("https://regions.inao.gouv.fr/appellations")
    assert tier == "A"


def test_classify_source_tier_producer_dynamic():
    """URL whose domain contains the normalized producer name → tier A."""
    tier = classify_source_tier(
        "https://www.biondisanti.it/wine",
        producer="Biondi-Santi",
    )
    assert tier == "A"


# ---------------------------------------------------------------------------
# detect_conflict
# ---------------------------------------------------------------------------

def test_detect_conflict_true():
    """Two candidates with different, non-synonym values → conflict detected."""
    candidates = [{"value": "Syrah"}, {"value": "Merlot"}]
    assert detect_conflict(candidates) is True


def test_detect_conflict_false_synonyms():
    """Syrah / Shiraz are known synonyms → NOT a conflict."""
    candidates = [{"value": "Syrah"}, {"value": "Shiraz"}]
    assert detect_conflict(candidates) is False


def test_detect_conflict_false_single():
    """Single candidate → not enough to form a conflict."""
    candidates = [{"value": "Pinot Noir"}]
    assert detect_conflict(candidates) is False


def test_detect_conflict_false_all_same():
    """Two candidates with the same value → no conflict."""
    candidates = [{"value": "Bordeaux"}, {"value": "Bordeaux"}]
    assert detect_conflict(candidates) is False


# Parametrize over all synonym pairs to ensure none are flagged as conflicts
@pytest.mark.parametrize("a, b", FIELD_VALUE_SYNONYMS)
def test_detect_conflict_all_synonym_pairs(a, b):
    """All synonym pairs in FIELD_VALUE_SYNONYMS must NOT produce a conflict."""
    candidates = [{"value": a}, {"value": b}]
    assert detect_conflict(candidates) is False


# ---------------------------------------------------------------------------
# should_auto_promote
# ---------------------------------------------------------------------------

def test_should_auto_promote_tier_a():
    """Single tier-A citation → (True, 'A_single')."""
    citations = [
        {"source_tier": "A", "source_url": "https://www.consorziobrunellomontalcino.it/"}
    ]
    can_promote, key = should_auto_promote(citations)
    assert can_promote is True
    assert key == "A_single"


def test_should_auto_promote_dual_b():
    """Two independent tier-B citations (different domains) → (True, 'B_dual')."""
    citations = [
        {"source_tier": "B", "source_url": "https://www.wine-searcher.com/brunello"},
        {"source_tier": "B", "source_url": "https://www.vivino.com/brunello"},
    ]
    can_promote, key = should_auto_promote(citations)
    assert can_promote is True
    assert key == "B_dual"


def test_should_auto_promote_same_domain():
    """Two tier-B citations from the SAME domain → 'B_single', not 'B_dual'."""
    citations = [
        {"source_tier": "B", "source_url": "https://www.wine-searcher.com/brunello-1"},
        {"source_tier": "B", "source_url": "https://www.wine-searcher.com/brunello-2"},
    ]
    can_promote, key = should_auto_promote(citations)
    assert can_promote is True
    assert key == "B_single"  # same domain → not dual


def test_should_auto_promote_empty():
    """No citations → (False, '')."""
    can_promote, key = should_auto_promote([])
    assert can_promote is False
    assert key == ""


def test_should_auto_promote_single_b():
    """Single tier-B citation → (True, 'B_single')."""
    citations = [{"source_tier": "B", "source_url": "https://www.decanter.com/brunello"}]
    can_promote, key = should_auto_promote(citations)
    assert can_promote is True
    assert key == "B_single"


# ---------------------------------------------------------------------------
# assign_confidence_by_tier
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("confidence_key, expected", [
    ("A_single", 0.95),
    ("B_dual",   0.87),
    ("B_single", 0.72),
    ("C_single", 0.60),
])
def test_assign_confidence_by_tier(confidence_key, expected):
    """Confidence keys map to their documented float values."""
    assert assign_confidence_by_tier(confidence_key) == pytest.approx(expected)


def test_assign_confidence_unknown_key():
    """Unknown confidence_key falls back to 0.60 (C_single floor)."""
    assert assign_confidence_by_tier("X_unknown") == pytest.approx(0.60)


# ---------------------------------------------------------------------------
# check_regression_guard
# ---------------------------------------------------------------------------

def test_check_regression_guard_safe():
    """Proposed 0.87 vs existing 0.73 → True (improvement, safe to write)."""
    existing_fc = {"region": _fc_entry("Tuscany", 0.73)}
    assert check_regression_guard("region", 0.87, existing_fc) is True


def test_check_regression_guard_regression():
    """Proposed 0.60 vs existing 0.88 → False (would regress, do NOT write)."""
    existing_fc = {"region": _fc_entry("Tuscany", 0.88)}
    assert check_regression_guard("region", 0.60, existing_fc) is False


def test_check_regression_guard_new_field():
    """Field not present in existing_fc (new field) → True (safe to write)."""
    existing_fc = {"wine_name": _fc_entry("Brunello", 0.99)}
    assert check_regression_guard("region", 0.75, existing_fc) is True


def test_check_regression_guard_equal_confidence():
    """Proposed confidence == existing confidence → True (equal is not a regression)."""
    existing_fc = {"region": _fc_entry("Tuscany", 0.80)}
    assert check_regression_guard("region", 0.80, existing_fc) is True


# ---------------------------------------------------------------------------
# build_citation_record
# ---------------------------------------------------------------------------

def test_build_citation_record_completeness():
    """Citation record includes all required evidence_citations table keys."""
    record = build_citation_record(
        wine_id="wine-uuid-123",
        run_id="run-uuid-456",
        field_name="region",
        proposed_value="Tuscany",
        source_url="https://www.consorziobrunellomontalcino.it/",
        source_tier="A",
        snippet="Brunello di Montalcino DOCG, Tuscany, Italy.",
        fetch_verified=True,
        corroboration_count=2,
    )
    required_keys = {"wine_id", "field_name", "source_url", "snippet", "retrieved_at", "source_tier", "fetch_verified"}
    for key in required_keys:
        assert key in record, f"Missing required key: {key}"


def test_build_citation_record_tier_uppercase():
    """source_tier is normalized to uppercase regardless of input case."""
    record = build_citation_record(
        wine_id="w",
        run_id="r",
        field_name="region",
        proposed_value="Tuscany",
        source_url="https://example.com",
        source_tier="a",   # lowercase input
        snippet="test",
    )
    assert record["source_tier"] == "A"


def test_build_citation_record_retrieved_at_auto():
    """retrieved_at is auto-populated when not provided."""
    record = build_citation_record(
        wine_id="w",
        run_id="r",
        field_name="region",
        proposed_value="Tuscany",
        source_url="https://example.com",
        source_tier="B",
        snippet="test",
    )
    assert record["retrieved_at"] is not None
    # Should be parseable as ISO datetime
    datetime.fromisoformat(record["retrieved_at"].replace("Z", "+00:00"))
