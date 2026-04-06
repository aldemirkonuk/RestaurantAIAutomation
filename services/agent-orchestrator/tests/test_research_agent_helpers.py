"""
Phase 12: Research Agent Helper Tests (RSCH-01..09)
===================================================
Unit tests for research_agent_helpers.py — all pure functions, no infrastructure.

Covers all 8 helper functions:
  - is_eligible_for_research
  - get_target_fields
  - build_serper_query
  - classify_source_tier
  - detect_conflict
  - should_auto_promote
  - assign_confidence_by_tier
  - check_regression_guard
  - build_citation_record

Run with:
    cd services/agent-orchestrator && python -m pytest tests/test_research_agent_helpers.py -v

All tests are self-contained — no Supabase, no HTTP, no Celery.
"""

import sys
import os

# Allow running from the agent-orchestrator root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone, timedelta

import pytest

from services.research_agent_helpers import (
    FIELD_VALUE_SYNONYMS,
    HAIKU_FIELDS,
    RESEARCH_PRIORITY_FIELDS,
    SONNET_ESCALATION_FIELDS,
    BoundedLRUCache,
    _cache_key_producer,
    _cache_key_wine,
    _should_infer,
    assign_confidence_by_tier,
    build_citation_record,
    build_serper_query,
    check_regression_guard,
    classify_source_tier,
    detect_conflict,
    get_entity_cache,
    get_target_fields,
    is_eligible_for_research,
    merge_conflict_candidates,
    put_entity_cache,
    resolve_conflict,
    run_layer1_inference,
    select_model,
    should_auto_promote,
)


# ===========================================================================
# is_eligible_for_research (RSCH-01)
# ===========================================================================

def test_is_eligible_skips_recent_record():
    """Submission with last_research_run_at 3 days ago → not eligible (cooldown = 7 days)."""
    recent = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    submission = {
        "last_research_run_at": recent,
        "field_confidence": {"region": {"value": None, "confidence": 0.3, "source": "inferred"}},
    }
    assert is_eligible_for_research(submission) is False


def test_is_eligible_passes_old_record():
    """Submission 10 days old with a low-confidence field → eligible."""
    old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    submission = {
        "last_research_run_at": old,
        "field_confidence": {"region": {"value": "Bordeaux", "confidence": 0.5, "source": "inferred"}},
    }
    assert is_eligible_for_research(submission) is True


def test_is_eligible_skips_human_resolved():
    """
    All priority fields locked as human_resolved → no researchable field → not eligible.
    Tests RSCH-06: human_resolved fields are locked; agent skips them entirely.
    """
    old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    fc = {
        f: {"value": "locked", "confidence": 1.0, "source": "human_resolved"}
        for f in RESEARCH_PRIORITY_FIELDS
    }
    submission = {"last_research_run_at": old, "field_confidence": fc}
    assert is_eligible_for_research(submission) is False


# ===========================================================================
# get_target_fields (RSCH-01)
# ===========================================================================

def test_get_target_fields_returns_null_fields():
    """Field absent from fc → included in target list."""
    fc = {}
    targets = get_target_fields(fc, priority_fields=["producer", "region"])
    assert "producer" in targets
    assert "region" in targets


def test_get_target_fields_excludes_high_confidence():
    """Field with confidence 0.95 (≥ DEFAULT_ACCEPT_THRESHOLD 0.8) → excluded from targets."""
    fc = {"region": {"value": "Burgundy", "confidence": 0.95, "source": "visible"}}
    targets = get_target_fields(fc, priority_fields=["region", "country"])
    assert "region" not in targets
    assert "country" in targets  # absent → always included


# ===========================================================================
# build_serper_query (RSCH-01)
# ===========================================================================

def test_build_serper_query_appellation():
    """Appellation query must include official regulatory acronyms (DOCG DOC AOC)."""
    query = build_serper_query(
        "appellation",
        "Brunello di Montalcino",
        producer="Biondi-Santi",
        vintage="2018",
    )
    assert "DOCG" in query
    assert "DOC" in query
    assert "AOC" in query


# ===========================================================================
# classify_source_tier (RSCH-04)
# ===========================================================================

@pytest.mark.parametrize("url,expected_tier", [
    ("https://www.consorziobrunellomontalcino.it/en/the-brunello/", "A"),  # Italian appellation body
    ("https://www.wine-searcher.com/find/biondi+santi", "B"),             # Trade press — tier-B
])
def test_classify_source_tier_known_domains(url, expected_tier):
    """Known tier-A (official appellation body) and tier-B (trade press) domains classified correctly."""
    assert classify_source_tier(url) == expected_tier


def test_classify_source_tier_unknown():
    """URL not in tier_map and not matching producer domain → tier-C."""
    result = classify_source_tier("https://randomwinesite.io/wines/chardonnay")
    assert result == "C"


# ===========================================================================
# detect_conflict (RSCH-05)
# ===========================================================================

def test_detect_conflict_true():
    """Two candidates with genuinely different (non-synonym) values → conflict True."""
    candidates = [
        {"value": "Syrah", "source_url": "https://a.com", "source_tier": "B"},
        {"value": "Merlot", "source_url": "https://b.com", "source_tier": "B"},
    ]
    assert detect_conflict(candidates) is True


def test_detect_conflict_false_synonyms():
    """Syrah and Shiraz are known synonyms (FIELD_VALUE_SYNONYMS) → no conflict."""
    # Verify the synonym pair exists in the constants
    synonym_pairs = {(a, b) for a, b in FIELD_VALUE_SYNONYMS}
    assert ("syrah", "shiraz") in synonym_pairs, "Test precondition: syrah/shiraz must be synonyms"

    candidates = [
        {"value": "Syrah",  "source_url": "https://a.com", "source_tier": "B"},
        {"value": "Shiraz", "source_url": "https://b.com", "source_tier": "B"},
    ]
    assert detect_conflict(candidates) is False


def test_detect_conflict_false_single():
    """Single candidate can never constitute a conflict (need ≥2 candidates)."""
    candidates = [{"value": "Pinot Noir", "source_url": "https://a.com", "source_tier": "A"}]
    assert detect_conflict(candidates) is False


# ===========================================================================
# should_auto_promote (RSCH-03)
# ===========================================================================

def test_should_auto_promote_tier_a():
    """Single tier-A source → auto-promote with confidence key 'A_single'."""
    citations = [{"source_url": "https://www.inao.gouv.fr/wine", "source_tier": "A"}]
    can_promote, key = should_auto_promote(citations)
    assert can_promote is True
    assert key == "A_single"


def test_should_auto_promote_dual_b():
    """Two independent tier-B sources (different domains) → 'B_dual' (corroborated)."""
    citations = [
        {"source_url": "https://www.wine-searcher.com/find/barolo", "source_tier": "B"},
        {"source_url": "https://www.decanter.com/wine-reviews/barolo", "source_tier": "B"},
    ]
    can_promote, key = should_auto_promote(citations)
    assert can_promote is True
    assert key == "B_dual"


def test_should_auto_promote_same_domain():
    """Two tier-B sources from the SAME domain → single-source 'B_single', NOT 'B_dual'."""
    citations = [
        {"source_url": "https://www.wine-searcher.com/find/barolo-1", "source_tier": "B"},
        {"source_url": "https://www.wine-searcher.com/find/barolo-2", "source_tier": "B"},
    ]
    can_promote, key = should_auto_promote(citations)
    assert can_promote is True
    assert key == "B_single"


def test_should_auto_promote_empty():
    """No citations → cannot promote."""
    can_promote, key = should_auto_promote([])
    assert can_promote is False
    assert key == ""


# ===========================================================================
# assign_confidence_by_tier (RSCH-03)
# ===========================================================================

@pytest.mark.parametrize("confidence_key,expected", [
    ("A_single", 0.95),
    ("B_dual",   0.87),
    ("B_single", 0.72),
    ("C_single", 0.60),
])
def test_assign_confidence_by_tier(confidence_key, expected):
    """Each corroboration key maps to the correct confidence float (STRATEGY.md Step 6)."""
    assert assign_confidence_by_tier(confidence_key) == pytest.approx(expected)


# ===========================================================================
# check_regression_guard (T-12-07)
# ===========================================================================

def test_check_regression_guard_safe():
    """Proposed 0.87 > existing 0.73 → improvement, safe to write (True)."""
    existing_fc = {"region": {"value": "Burgundy", "confidence": 0.73, "source": "inferred"}}
    assert check_regression_guard("region", 0.87, existing_fc) is True


def test_check_regression_guard_regression():
    """Proposed 0.60 < existing 0.88 → regression detected, must block (False)."""
    existing_fc = {"region": {"value": "Burgundy", "confidence": 0.88, "source": "inferred"}}
    assert check_regression_guard("region", 0.60, existing_fc) is False


def test_check_regression_guard_new_field():
    """Field absent from existing_fc → new field, always safe to write (True)."""
    assert check_regression_guard("appellation", 0.87, {}) is True


# ===========================================================================
# build_citation_record (RSCH-02)
# ===========================================================================

def test_build_citation_record_completeness():
    """
    Built record must contain all required evidence_citations schema keys.
    Every auto-promoted fill must produce one citation record (RSCH-02).
    """
    record = build_citation_record(
        wine_id="wine-001",
        run_id="run-001",
        field_name="grape_variety",
        proposed_value="Sangiovese",
        source_url="https://www.consorziobrunellomontalcino.it/en/",
        source_tier="A",
        snippet="produced exclusively from Sangiovese Grosso",
        fetch_verified=True,
    )

    required_keys = {
        "wine_id",
        "field_name",
        "source_url",
        "snippet",
        "retrieved_at",
        "source_tier",
        "fetch_verified",
    }
    for key in required_keys:
        assert key in record, f"Citation record missing required key: {key}"

    assert record["wine_id"] == "wine-001"
    assert record["field_name"] == "grape_variety"
    assert record["source_url"] == "https://www.consorziobrunellomontalcino.it/en/"
    assert record["source_tier"] == "A"
    assert record["fetch_verified"] is True
    assert record["snippet"] == "produced exclusively from Sangiovese Grosso"
    assert record["retrieved_at"] is not None


# ===========================================================================
# Phase 12.1 additions — run_layer1_inference (D-01, D-08)
# ===========================================================================

def test_run_layer1_inference_returns_empty_when_no_ontology():
    """Layer 1 returns {} gracefully when ontology tables are unavailable (T-12.1-01)."""
    result = run_layer1_inference({}, "Some Unknown Wine XYZ 9999")
    assert isinstance(result, dict)
    # No appellation in fc → no appellation rules → fills is empty (graceful degradation)
    assert "country" not in result or isinstance(result.get("country"), dict)


def test_run_layer1_inference_skips_high_confidence_fields():
    """Fields with confidence >= DEFAULT_ACCEPT_THRESHOLD are NOT overwritten (D-08)."""
    fc = {"country": {"value": "France", "confidence": 0.95, "source": "visible"}}
    result = run_layer1_inference(fc, "Château Margaux", vintage="2015")
    # country already at high confidence → _should_infer returns False → not in fills
    assert "country" not in result


def test_run_layer1_inference_infers_when_field_absent():
    """_should_infer returns True for absent/low-confidence fields, False for high-confidence."""
    assert _should_infer({}, "country") is True
    assert _should_infer({"country": {"value": "X", "confidence": 0.3}}, "country") is True
    assert _should_infer({"country": {"value": "France", "confidence": 0.95}}, "country") is False


# ===========================================================================
# Phase 12.1 additions — select_model (D-02)
# ===========================================================================

def test_select_model_haiku_for_color():
    """Color is a simple categorization field → Haiku (HAIKU_FIELDS set)."""
    assert "color" in HAIKU_FIELDS
    assert select_model("color") == "haiku"


def test_select_model_flash_default():
    """Standard research fields on first attempt → Flash."""
    assert select_model("region") == "flash"
    assert select_model("grape_variety") == "flash"


def test_select_model_sonnet_on_retry():
    """Any field on attempt >= 2 → Sonnet escalation."""
    assert select_model("region", attempt=2) == "sonnet"
    assert select_model("country", attempt=2) == "sonnet"


def test_select_model_haiku_high_ontology_hint():
    """High ontology hint confidence (>0.7) → Haiku (cheap verification, D-02)."""
    assert select_model("country", ontology_hint_conf=0.8) == "haiku"
    assert select_model("region", ontology_hint_conf=0.71) == "haiku"


# ===========================================================================
# Phase 12.1 additions — BoundedLRUCache (D-04, D-06 bug #10)
# ===========================================================================

def test_bounded_lru_cache_eviction():
    """Cache with max_size=3 evicts oldest non-recently-accessed entry on 4th insert."""
    cache = BoundedLRUCache(max_size=3)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    cache.get("a")            # promote 'a' to most-recent; order: b, c, a
    cache.put("d", 4)         # 4th insert → evicts 'b' (oldest)
    assert len(cache) == 3
    assert cache.get("a") == 1
    assert cache.get("c") == 3
    assert cache.get("d") == 4
    assert cache.get("b") is None   # evicted


def test_bounded_lru_cache_ttl_expiry():
    """Entry with ttl_seconds=0 is always considered expired → get returns None."""
    cache = BoundedLRUCache(max_size=10)
    cache.put("key", "value")
    result = cache.get("key", ttl_seconds=0)
    assert result is None


# ===========================================================================
# Phase 12.1 additions — resolve_conflict (D-05)
# ===========================================================================

def test_resolve_conflict_auto_tier_a_vs_c():
    """Tier-A fetch_verified vs Tier-C → auto-resolve with Tier-A winner."""
    candidates = [
        {"value": "Italy", "source_url": "https://civb.com/x", "source_tier": "A", "fetch_verified": True},
        {"value": "Spain", "source_url": "https://random.com/y", "source_tier": "C", "fetch_verified": False},
    ]
    resolution, reason, winner = resolve_conflict(candidates, "country")
    assert resolution == "auto"
    assert winner is not None
    assert winner["value"] == "Italy"


def test_resolve_conflict_escalates_a_vs_a():
    """Two tier-A sources disagreeing → human escalation required."""
    candidates = [
        {"value": "Italy", "source_url": "https://civb.com", "source_tier": "A", "fetch_verified": True},
        {"value": "France", "source_url": "https://inao.gouv.fr", "source_tier": "A", "fetch_verified": True},
    ]
    resolution, reason, winner = resolve_conflict(candidates, "country")
    assert resolution == "human"
    assert winner is None


def test_resolve_conflict_b_consensus():
    """2+ Tier-B sources agreeing on same value vs 1 Tier-C → auto-resolve B consensus."""
    candidates = [
        {"value": "Burgundy", "source_url": "https://wine-searcher.com/x", "source_tier": "B", "fetch_verified": True},
        {"value": "Burgundy", "source_url": "https://vivino.com/y", "source_tier": "B", "fetch_verified": True},
        {"value": "Bordeaux", "source_url": "https://random.com/z", "source_tier": "C", "fetch_verified": False},
    ]
    resolution, reason, winner = resolve_conflict(candidates, "region")
    assert resolution == "auto"
    assert winner is not None
    assert winner["value"] == "Burgundy"


def test_resolve_conflict_escalates_b_vs_b():
    """Two Tier-B sources with different values → human escalation."""
    candidates = [
        {"value": "Burgundy", "source_url": "https://wine-searcher.com/x", "source_tier": "B", "fetch_verified": True},
        {"value": "Bordeaux", "source_url": "https://vivino.com/y", "source_tier": "B", "fetch_verified": True},
    ]
    resolution, reason, winner = resolve_conflict(candidates, "region")
    assert resolution == "human"
    assert winner is None


# ===========================================================================
# Phase 12.1 additions — merge_conflict_candidates (D-06 bug #3)
# ===========================================================================

def test_merge_conflict_candidates_deep_merge():
    """Existing conflicts on 'region' + new conflicts on 'country' → both preserved."""
    existing = {"region": [{"value": "A", "source_url": "https://a.com"}]}
    new = {"country": [{"value": "B", "source_url": "https://b.com"}]}
    merged = merge_conflict_candidates(existing, new)
    assert "region" in merged
    assert "country" in merged
    assert len(merged["region"]) == 1
    assert len(merged["country"]) == 1


def test_merge_conflict_candidates_deduplicates():
    """Same source_url for same field is not added twice."""
    existing = {"region": [{"value": "A", "source_url": "https://a.com"}]}
    new = {"region": [
        {"value": "A", "source_url": "https://a.com"},    # duplicate
        {"value": "B", "source_url": "https://b.com"},    # new
    ]}
    merged = merge_conflict_candidates(existing, new)
    assert len(merged["region"]) == 2  # original + one new unique URL


# ===========================================================================
# Phase 12.1 additions — cache key helpers (D-04)
# ===========================================================================

def test_cache_key_wine_deterministic():
    """Same inputs produce identical cache key (SHA-256 determinism)."""
    k1 = _cache_key_wine("Barolo", "2018", "Giacomo Conterno")
    k2 = _cache_key_wine("Barolo", "2018", "Giacomo Conterno")
    assert k1 == k2
    assert k1.startswith("research:wine:")


def test_cache_key_producer_normalization():
    """Producer names differing only in casing and punctuation produce the same key."""
    k1 = _cache_key_producer("Domaine Leflaive")
    k2 = _cache_key_producer("domaine-leflaive")
    assert k1 == k2
    assert k1.startswith("research:producer:")
