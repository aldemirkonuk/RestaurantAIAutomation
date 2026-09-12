"""
Tests for Phase 8: Web Search Verification & Deep Enrichment

Covers WSRCH-01 through WSRCH-09.
All external dependencies (Supabase, Redis, Serper API, Gemini) are mocked.
No live API calls or DB connections required.

Run: pytest tests/test_web_verification.py -x --timeout=30
"""

import asyncio
import sys
import os
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Ensure agent-orchestrator is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.web_verification_service import (
    check_concordance,
    apply_concordance_result,
    WineVerificationResult,
    REGION_ALIASES,
    NUMERIC_FIELDS,
)
from services.producer_normalization import normalize_producer_name, build_search_query
from jobs.web_verify_tasks import _should_web_verify


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def existing_fc_burgundy() -> Dict[str, Any]:
    """FC entry where region=Burgundy at confidence 0.85."""
    return {
        "region": {
            "value": "Burgundy",
            "confidence": 0.85,
            "source": "knowledge",
        }
    }


@pytest.fixture
def existing_fc_all_verified() -> Dict[str, Any]:
    """FC where all fields are high-confidence and web_verified — should be skipped."""
    return {
        "wine_name": {
            "value": "Puligny-Montrachet",
            "confidence": 0.97,
            "source": "visible",
            "verification_status": "web_verified",
        },
        "region": {
            "value": "Burgundy",
            "confidence": 0.95,
            "source": "web_verified",
            "verification_status": "web_verified",
        },
        "country": {
            "value": "France",
            "confidence": 0.97,
            "source": "web_verified",
            "verification_status": "web_verified",
        },
    }


@pytest.fixture
def existing_fc_low_confidence() -> Dict[str, Any]:
    """FC with one low-confidence field — should trigger web search."""
    return {
        "wine_name": {
            "value": "Barolo Riserva",
            "confidence": 0.97,
            "source": "visible",
        },
        "region": {"value": "Piedmont", "confidence": 0.60, "source": "knowledge"},
    }


# ---------------------------------------------------------------------------
# WSRCH-03: Concordance engine — unit tests (Tests 1–5)
# ---------------------------------------------------------------------------


def test_concordance_exact_match(existing_fc_burgundy):
    """Test 1: Exact string match → concordance."""
    result = check_concordance(
        "region",
        existing_fc_burgundy["region"],
        "Burgundy",
    )
    assert result == "concordance", f"Expected 'concordance', got {result!r}"


def test_concordance_contradiction(existing_fc_burgundy):
    """Test 2: Different value → contradiction."""
    result = check_concordance(
        "region",
        existing_fc_burgundy["region"],
        "Bordeaux",
    )
    assert result == "contradiction", f"Expected 'contradiction', got {result!r}"


def test_concordance_new_data():
    """Test 3: Existing entry has None value → new_data."""
    result = check_concordance(
        "region",
        {"value": None, "confidence": 0.5, "source": "knowledge"},
        "Burgundy",
    )
    assert result == "new_data", f"Expected 'new_data', got {result!r}"


def test_concordance_region_alias():
    """Test 4 (WSRCH-03 + Pitfall 1): Bourgogne == Burgundy via REGION_ALIASES → concordance."""
    # Both "bourgogne" and "burgundy" map to "bourgogne" canonical
    assert "bourgogne" in REGION_ALIASES, "REGION_ALIASES must have 'bourgogne'"
    assert "burgundy" in REGION_ALIASES, "REGION_ALIASES must have 'burgundy'"
    result = check_concordance(
        "region",
        {"value": "Bourgogne", "confidence": 0.85, "source": "knowledge"},
        "Burgundy",
    )
    assert (
        result == "concordance"
    ), f"Expected 'concordance' for Bourgogne vs Burgundy alias, got {result!r}"


def test_concordance_numeric_tolerance():
    """Test 5 (Pitfall 6): alcohol_pct 13.5 vs 13.50 → concordance via float tolerance."""
    assert "alcohol_pct" in NUMERIC_FIELDS, "alcohol_pct must be in NUMERIC_FIELDS"
    result = check_concordance(
        "alcohol_pct",
        {"value": "13.5", "confidence": 0.85, "source": "visible"},
        "13.50",
    )
    assert (
        result == "concordance"
    ), f"Expected 'concordance' for 13.5 vs 13.50 (numeric tolerance), got {result!r}"


def test_concordance_color_synonyms():
    """Test: Color synonym matching — 'deep garnet' vs 'red' → concordance via COLOR_SYNONYMS."""
    from services.web_verification_service import COLOR_SYNONYMS

    # Verify COLOR_SYNONYMS has expected mappings
    assert "deep garnet" in COLOR_SYNONYMS, "COLOR_SYNONYMS must have 'deep garnet'"
    assert COLOR_SYNONYMS["deep garnet"] == "red", "deep garnet must map to red"
    assert "ruby" in COLOR_SYNONYMS, "COLOR_SYNONYMS must have 'ruby'"
    assert COLOR_SYNONYMS["ruby"] == "red", "ruby must map to red"
    assert "pale yellow" in COLOR_SYNONYMS, "COLOR_SYNONYMS must have 'pale yellow'"
    assert COLOR_SYNONYMS["pale yellow"] == "white", "pale yellow must map to white"

    # Test concordance with color synonyms
    result = check_concordance(
        "color",
        {"value": "red", "confidence": 0.85, "source": "knowledge"},
        "deep garnet",
    )
    assert (
        result == "concordance"
    ), f"Expected 'concordance' for red vs deep garnet (color synonym), got {result!r}"

    result2 = check_concordance(
        "color",
        {"value": "white", "confidence": 0.85, "source": "knowledge"},
        "pale yellow",
    )
    assert (
        result2 == "concordance"
    ), f"Expected 'concordance' for white vs pale yellow (color synonym), got {result2!r}"


def test_concordance_grape_variety_substring():
    """Test: Grape variety substring matching — 'Cabernet Sauvignon' vs '87% Cabernet Sauvignon...' → web_data_more_complete."""
    result = check_concordance(
        "grape_variety",
        {"value": "Cabernet Sauvignon", "confidence": 0.85, "source": "visible"},
        "87% Cabernet Sauvignon, 8% Merlot, 5% Cabernet Franc",
    )
    assert (
        result == "web_data_more_complete"
    ), f"Expected 'web_data_more_complete' for substring match (blend breakdown), got {result!r}"

    # Test reverse case: web data less specific
    result2 = check_concordance(
        "grape_variety",
        {"value": "Cabernet Sauvignon", "confidence": 0.85, "source": "visible"},
        "Cabernet",
    )
    assert (
        result2 == "concordance"
    ), f"Expected 'concordance' for web data less specific (Cabernet vs Cabernet Sauvignon), got {result2!r}"

    # Test no substring match → contradiction
    result3 = check_concordance(
        "grape_variety",
        {"value": "Cabernet Sauvignon", "confidence": 0.85, "source": "visible"},
        "Pinot Noir",
    )
    assert (
        result3 == "contradiction"
    ), f"Expected 'contradiction' for completely different grape varieties, got {result3!r}"


# ---------------------------------------------------------------------------
# WSRCH-03 + WSRCH-06: apply_concordance_result — Tests 6–7
# ---------------------------------------------------------------------------


def test_apply_concordance_boosts_confidence():
    """Test 6: Concordance → confidence boosted to >= 0.95, verification_status='web_verified'."""
    existing_fc = {
        "region": {"value": "Burgundy", "confidence": 0.85, "source": "knowledge"}
    }
    updated = apply_concordance_result(
        existing_fc, "region", "Burgundy", web_confidence=0.9, concordance="concordance"
    )
    assert (
        updated["region"]["confidence"] >= 0.95
    ), f"Expected confidence >= 0.95 after concordance boost, got {updated['region']['confidence']}"
    assert (
        updated["region"]["verification_status"] == "web_verified"
    ), f"Expected verification_status='web_verified', got {updated['region'].get('verification_status')!r}"


def test_apply_contradiction_flags_both_values():
    """Test 7 (WSRCH-06): Contradiction → verification_status='contradicted' + contradicted_value."""
    existing_fc = {
        "region": {"value": "Bordeaux", "confidence": 0.85, "source": "knowledge"}
    }
    updated = apply_concordance_result(
        existing_fc,
        "region",
        "Burgundy",
        web_confidence=0.9,
        concordance="contradiction",
    )
    assert (
        updated["region"]["verification_status"] == "contradicted"
    ), f"Expected verification_status='contradicted', got {updated['region'].get('verification_status')!r}"
    assert (
        updated["region"].get("contradicted_value") == "Burgundy"
    ), f"Expected contradicted_value='Burgundy', got {updated['region'].get('contradicted_value')!r}"
    # Original value preserved — not overwritten by contradiction
    assert (
        updated["region"]["value"] == "Bordeaux"
    ), "Contradiction must not overwrite existing value"


# ---------------------------------------------------------------------------
# WSRCH-05: Producer normalization — Test 8
# ---------------------------------------------------------------------------


def test_normalize_producer_name_unicode():
    """Test 8 (WSRCH-05): Unicode transliteration + slugification."""
    assert (
        normalize_producer_name("Château Müller-Catoir") == "chateau-muller-catoir"
    ), "Unicode normalization failed"
    assert (
        normalize_producer_name("Domaine de la Romanée-Conti")
        == "domaine-de-la-romanee-conti"
    )
    assert normalize_producer_name(None) == "", "None input must return empty string"
    assert normalize_producer_name("") == "", "Empty string must return empty string"
    assert normalize_producer_name("DRC") == "drc", "Simple name normalization failed"

    # build_search_query coverage
    query = build_search_query("Domaine Leflaive", "Puligny-Montrachet", "2019")
    assert query == "Domaine Leflaive Puligny-Montrachet 2019"
    assert build_search_query(None, "Barolo", "2018") == "Barolo 2018"


# ---------------------------------------------------------------------------
# WSRCH-07: Tiered search strategy — Test 9
# ---------------------------------------------------------------------------


def test_tiered_search_strategy(existing_fc_low_confidence, existing_fc_all_verified):
    """Test 9 (WSRCH-07): _should_web_verify tiered eligibility."""
    # (a) Low confidence → should verify
    assert (
        _should_web_verify(existing_fc_low_confidence, producer_in_graph=True) is True
    ), "Should verify when FC has field with confidence < 0.8"
    # All high-confidence + web_verified + known producer → skip
    assert (
        _should_web_verify(existing_fc_all_verified, producer_in_graph=True) is False
    ), "Should NOT verify when all fields >= 0.8 and web_verified"
    # (b) Unknown producer always triggers verification
    assert (
        _should_web_verify(existing_fc_all_verified, producer_in_graph=False) is True
    ), "Should verify when producer not in graph (always)"
    # (c) Never verified (no verification_status) with known producer but low FC
    never_verified_fc = {
        "region": {"value": "Burgundy", "confidence": 0.9, "source": "knowledge"},
        # no verification_status key
    }
    assert (
        _should_web_verify(never_verified_fc, producer_in_graph=True) is True
    ), "Should verify when wine has never been web-verified"


# ---------------------------------------------------------------------------
# WSRCH-08: Daily budget cap — Test 10
# ---------------------------------------------------------------------------


def test_budget_cap_enforced():
    """Test 10 (WSRCH-08): check_and_reserve_search_budget() via mocked Redis INCRBYFLOAT."""
    from jobs.web_verify_tasks import check_and_reserve_search_budget

    # Case A: Redis INCRBYFLOAT returns 5.1 (over $5.0 cap) → should return False
    mock_redis = MagicMock()
    mock_redis.incrbyfloat.return_value = 5.1
    with patch("jobs.web_verify_tasks.redis_lib.from_url", return_value=mock_redis):
        result = check_and_reserve_search_budget(cost_per_search=0.001)
    assert (
        result is False
    ), f"Expected False when daily total 5.1 > cap 5.0, got {result}"
    # The undo increment should have been called
    assert (
        mock_redis.incrbyfloat.call_count == 2
    ), "Expected 2 INCRBYFLOAT calls (increment + undo)"

    # Case B: Redis INCRBYFLOAT returns 0.5 (under cap) → should return True
    mock_redis_ok = MagicMock()
    mock_redis_ok.incrbyfloat.return_value = 0.5
    with patch("jobs.web_verify_tasks.redis_lib.from_url", return_value=mock_redis_ok):
        result_ok = check_and_reserve_search_budget(cost_per_search=0.001)
    assert (
        result_ok is True
    ), f"Expected True when daily total 0.5 < cap 5.0, got {result_ok}"

    # Case C: Redis unavailable → fail open (return True)
    mock_redis_fail = MagicMock()
    mock_redis_fail.incrbyfloat.side_effect = ConnectionError("Redis unavailable")
    with patch(
        "jobs.web_verify_tasks.redis_lib.from_url", return_value=mock_redis_fail
    ):
        result_fail_open = check_and_reserve_search_budget(cost_per_search=0.001)
    assert result_fail_open is True, "Redis failure must fail open (return True)"


# ---------------------------------------------------------------------------
# WSRCH-09: E2E integration test — full mock pipeline
# ---------------------------------------------------------------------------


def test_e2e_web_verify_flow():
    """
    Test 11 (WSRCH-09): Full E2E mock pipeline.

    Input:  wine_id with low-confidence region (0.55)
    Mocks:  Supabase (select + update), serper_search, parse_search_results, Redis
    Assert: field_confidence["region"]["confidence"] >= 0.95
            field_confidence["region"]["verification_status"] == "web_verified"
    """
    from jobs.web_verify_tasks import _verify_async

    wine_id = "test-wine-uuid-12345"

    # Mock wine row returned by Supabase select
    mock_wine_row = {
        "id": wine_id,
        "payload": {"wine_name": "Puligny-Montrachet", "producer": "Domaine Leflaive"},
        "field_confidence": {
            "wine_name": {
                "value": "Puligny-Montrachet",
                "confidence": 0.97,
                "source": "visible",
            },
            "producer": {
                "value": "Domaine Leflaive",
                "confidence": 0.82,
                "source": "visible",
            },
            "region": {"value": "Burgundy", "confidence": 0.55, "source": "knowledge"},
            "vintage": {"value": "2019", "confidence": 0.97, "source": "visible"},
        },
    }

    # Mock Serper results (2 organic results mentioning Burgundy)
    mock_serper_results = [
        {
            "title": "Domaine Leflaive Puligny-Montrachet 2019",
            "link": "https://wine-searcher.com/...",
            "snippet": "From Burgundy, France. Domaine Leflaive produces world-class white Burgundy.",
            "position": 1,
        },
        {
            "title": "Leflaive 2019 Puligny Review",
            "link": "https://vivino.com/...",
            "snippet": "Domaine Leflaive Puligny-Montrachet 2019 Burgundy. 93 pts.",
            "position": 2,
        },
    ]

    # Mock WineVerificationResult — Gemini confirms region=Burgundy, country=France
    mock_verification_result = WineVerificationResult(
        producer="Domaine Leflaive",
        region="Burgundy",
        country="France",
        sub_region="Côte de Beaune",
        source_confidence=0.9,
    )

    # Captured update payload storage
    captured_update: Dict[str, Any] = {}

    def mock_update_chain(*args, **kwargs):
        """Capture the update payload for assertion."""
        mock_chain = MagicMock()
        mock_chain.eq.return_value = MagicMock(
            execute=MagicMock(return_value=MagicMock(data=[{}]))
        )

        # Extract the payload from the first argument (dict passed to .update())
        if args:
            captured_update.update(args[0])
        return mock_chain

    # Build Supabase mock
    mock_supabase = MagicMock()
    mock_supabase.table.return_value = MagicMock(
        select=MagicMock(
            return_value=MagicMock(
                eq=MagicMock(
                    return_value=MagicMock(
                        maybe_single=MagicMock(
                            return_value=MagicMock(
                                execute=MagicMock(
                                    return_value=MagicMock(data=mock_wine_row)
                                )
                            )
                        )
                    )
                )
            )
        ),
        update=mock_update_chain,
    )

    with (
        patch("jobs.web_verify_tasks.create_client", return_value=mock_supabase),
        patch(
            "services.web_verification_service.create_client",
            return_value=mock_supabase,
        ),
        patch(
            "jobs.web_verify_tasks.redis_lib.from_url",
            return_value=MagicMock(
                set=MagicMock(return_value=True),
                delete=MagicMock(),
                incrbyfloat=MagicMock(return_value=0.001),
                expire=MagicMock(),
            ),
        ),
        patch(
            "services.serper_client.serper_search",
            new_callable=AsyncMock,
            return_value=mock_serper_results,
        ),
        patch(
            "services.web_verification_service.parse_search_results",
            new_callable=AsyncMock,
            return_value=mock_verification_result,
        ),
        patch("services.web_verification_service.lookup_producer", return_value=None),
        patch(
            "services.web_verification_service.upsert_producer",
            return_value="producer-uuid",
        ),
    ):
        result = asyncio.run(_verify_async(wine_id))

    # Assert task returned a successful result
    assert result is not None, "E2E test: _verify_async should return non-None result"
    assert (
        result.get("wine_id") == wine_id
    ), f"E2E test: expected wine_id={wine_id!r} in result"

    # Assert field_confidence was updated with verification data
    assert (
        "field_confidence" in captured_update
    ), "E2E test: Supabase .update() must be called with field_confidence in payload"
    updated_region = captured_update["field_confidence"].get("region", {})
    assert updated_region.get("confidence", 0) >= 0.95, (
        f"E2E test: region confidence must be >= 0.95 after concordance boost, "
        f"got {updated_region.get('confidence')}"
    )
    assert updated_region.get("verification_status") == "web_verified", (
        f"E2E test: region verification_status must be 'web_verified', "
        f"got {updated_region.get('verification_status')!r}"
    )


# ---------------------------------------------------------------------------
# OD-75: parse-graded outcomes on the Gemini snippet parse
# ---------------------------------------------------------------------------


def _gemini_response(text: str) -> MagicMock:
    resp = MagicMock()
    resp.text = text
    resp.usage_metadata = MagicMock(
        prompt_token_count=900,
        candidates_token_count=140,
        thoughts_token_count=60,
    )
    return resp


def _run_parse(response_text: str, logger_mock: MagicMock):
    """Drive parse_search_results with a canned Gemini answer."""
    client = MagicMock()
    client.models.generate_content.return_value = _gemini_response(response_text)

    from services.web_verification_service import parse_search_results

    with patch(
        "services.web_verification_service.get_settings",
        return_value=MagicMock(google_api_key="test-key"),
    ), patch(
        "services.web_verification_service.genai.Client", return_value=client
    ), patch(
        "services.web_verification_service.get_spend_logger",
        return_value=logger_mock,
    ):
        return asyncio.run(
            parse_search_results(
                snippets=[{"title": "t", "snippet": "s", "link": "http://x"}],
                wine_name="Château Test 2015",
            )
        )


def test_unparseable_gemini_snippet_parse_records_partial():
    """
    OD-75: parse_search_results returns None on an unparseable answer, so the
    failure was silent in both directions — the caller got no verification and
    NF got 'success' on the call_level_v0 basis, proving only that Gemini
    replied. The row must now say 'partial' on the parse_v1 basis, and must
    still be written once because the tokens were billed regardless.
    """
    logger_mock = MagicMock()
    result = _run_parse("Sorry, I could not find that wine.", logger_mock)

    assert result is None
    assert logger_mock.log.call_count == 1
    kwargs = logger_mock.log.call_args.kwargs
    assert kwargs["outcome"] == "partial"
    assert kwargs["outcome"] != "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is True
    assert kwargs["input_tokens"] == 900
    assert kwargs["output_tokens"] == 200  # thinking tokens bill as output


def test_valid_gemini_snippet_parse_records_success_on_parse_basis():
    """OD-75: a schema-valid answer keeps 'success', now on the parse_v1 basis."""
    logger_mock = MagicMock()
    result = _run_parse('{"region": "Pauillac", "source_confidence": 0.9}', logger_mock)

    assert result is not None
    assert logger_mock.log.call_count == 1
    kwargs = logger_mock.log.call_args.kwargs
    assert kwargs["outcome"] == "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is False
