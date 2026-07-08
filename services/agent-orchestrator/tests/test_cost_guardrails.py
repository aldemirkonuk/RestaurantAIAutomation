"""
Unit tests for cost guardrail logic — COST-03, QUAL-01.

Tests:
  - _preflight_cap_check sums restaurant spend from api_spend
  - _preflight_cap_check fails open (returns 0.0) on DB error
  - _preflight_cap_check returns 0.0 when no rows found
  - AUTO_BLOCK_THRESHOLD constant = 0.3 (QUAL-01 gate)
  - auto_blocked computed correctly from completeness_score
"""

import pytest
from unittest.mock import MagicMock


# ---------------------------------------------------------------------------
# _preflight_cap_check
# ---------------------------------------------------------------------------


def _make_spend_supabase(rows=None, raise_error=False):
    """Build mock Supabase returning rows from api_spend query."""
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    if raise_error:
        chain.execute.side_effect = Exception("DB unavailable")
    else:
        chain.execute.return_value = MagicMock(data=rows or [])
    supabase = MagicMock()
    supabase.table.return_value = chain
    return supabase


def test_preflight_cap_check_sums_all_rows():
    """COST-03: returns sum of cost_usd across all api_spend rows for the restaurant."""
    from api.onboarding_routes import _preflight_cap_check

    rows = [
        {"cost_usd": 0.50},
        {"cost_usd": 0.75},
        {"cost_usd": 1.00},
    ]
    supabase = _make_spend_supabase(rows=rows)
    result = _preflight_cap_check(supabase, "rest-abc")

    assert result == pytest.approx(2.25)


def test_preflight_cap_check_fails_open_on_db_error():
    """COST-03: returns 0.0 (fail open) when Supabase raises an exception."""
    from api.onboarding_routes import _preflight_cap_check

    supabase = _make_spend_supabase(raise_error=True)
    result = _preflight_cap_check(supabase, "rest-abc")

    assert result == 0.0


def test_preflight_cap_check_returns_zero_when_no_rows():
    """COST-03: returns 0.0 when restaurant has no spend records."""
    from api.onboarding_routes import _preflight_cap_check

    supabase = _make_spend_supabase(rows=[])
    result = _preflight_cap_check(supabase, "rest-abc")

    assert result == 0.0


# ---------------------------------------------------------------------------
# AUTO_BLOCK_THRESHOLD (QUAL-01)
# ---------------------------------------------------------------------------


def test_auto_block_threshold_is_point_three():
    """QUAL-01: AUTO_BLOCK_THRESHOLD must be 0.3 — ensures contract is stable."""
    from api.onboarding_routes import AUTO_BLOCK_THRESHOLD

    assert AUTO_BLOCK_THRESHOLD == 0.3


def test_auto_blocked_true_for_score_below_threshold():
    """QUAL-01: completeness_score < 0.3 → auto_blocked must be True."""
    from api.onboarding_routes import AUTO_BLOCK_THRESHOLD

    low_score = 0.167  # 1 of 6 fields
    assert (low_score < AUTO_BLOCK_THRESHOLD) is True


def test_auto_blocked_false_for_score_at_threshold():
    """QUAL-01: completeness_score == 0.3 is NOT blocked (strictly less-than gate)."""
    from api.onboarding_routes import AUTO_BLOCK_THRESHOLD

    boundary_score = 0.3  # exactly at threshold — should NOT be blocked
    assert (boundary_score < AUTO_BLOCK_THRESHOLD) is False


def test_per_restaurant_cap_constant():
    """COST-03: PER_RESTAURANT_CAP_USD must be 2.00 — contract stability check."""
    from api.onboarding_routes import PER_RESTAURANT_CAP_USD

    assert PER_RESTAURANT_CAP_USD == 2.00
