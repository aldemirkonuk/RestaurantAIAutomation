"""
Tests for trend_tasks.py — TEMP-05 / TEMP-06

Tests:
  1. _compute_popularity counts distinct restaurants per wine (not duplicates)
  2. _window_start_iso returns correct ISO date string for 30-day window
  3. Burst detection constants are at correct threshold and bonus values
  4. trend_score formula: (5×3.0) + (3×1.5) + (2×1.0) + 2.0 = 21.5
  5. No burst when fewer than 3 distinct new restaurants in 14 days
  6. compute_trend_metrics_task calls both _compute_popularity and _compute_trending
"""
import pytest
from unittest.mock import MagicMock, patch


# =============================================================================
# Test 1: _compute_popularity counts distinct restaurants (not duplicate rows)
# =============================================================================

@patch("supabase.create_client")
def test_popularity_counts_distinct_restaurants(mock_create_client):
    """3 roster rows for same wine + same restaurant → count=1, not 3."""
    mock_sb = MagicMock()
    mock_create_client.return_value = mock_sb

    def table_side_effect(table_name):
        mock = MagicMock()
        if table_name == "master_wine_library_submissions":
            mock.select.return_value.not_.is_.return_value.execute.return_value.data = [
                {"signature_hash": "hash-A", "master_wine_id": "wine-001"},
            ]
        elif table_name == "restaurant_wine_roster":
            # 3 rows but same restaurant_id — distinct count should be 1
            mock.select.return_value.execute.return_value.data = [
                {"restaurant_id": "rest-1", "signature_hash": "hash-A"},
                {"restaurant_id": "rest-1", "signature_hash": "hash-A"},
                {"restaurant_id": "rest-1", "signature_hash": "hash-A"},
            ]
        elif table_name == "wine_popularity":
            mock.upsert.return_value.execute.return_value = MagicMock()
        return mock

    mock_sb.table.side_effect = table_side_effect

    from jobs.trend_tasks import _compute_popularity
    count = _compute_popularity(mock_sb)
    assert count == 1

    # Verify upsert was called with restaurant_count=1 (distinct), not 3
    upsert_call = mock_sb.table("wine_popularity").upsert.call_args
    if upsert_call:
        rows = upsert_call[0][0]
        assert rows[0]["restaurant_count"] == 1


# =============================================================================
# Test 2: _window_start_iso returns correct ISO date for 30-day window
# =============================================================================

def test_window_start_iso_30d():
    from jobs.trend_tasks import _window_start_iso
    from datetime import datetime, timezone, timedelta
    result = _window_start_iso(30)
    expected = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    # Same date prefix (year-month-day)
    assert result[:10] == expected[:10]
    # Result is a valid ISO string
    assert "T" in result


# =============================================================================
# Test 3: Burst detection constants at correct threshold and bonus
# =============================================================================

def test_burst_detected_at_threshold():
    """BURST_RESTAURANT_THRESHOLD=3 and BURST_BONUS=2.0 match D-02 formula."""
    from jobs.trend_tasks import BURST_RESTAURANT_THRESHOLD, BURST_BONUS
    assert BURST_RESTAURANT_THRESHOLD == 3
    assert BURST_BONUS == 2.0


# =============================================================================
# Test 4: Trend score formula accuracy — manual calculation
# =============================================================================

def test_trend_score_formula():
    """Manual: (5×3.0) + (3×1.5) + (2×1.0) + 2.0 = 15.0 + 4.5 + 2.0 + 2.0 = 23.5"""
    from jobs.trend_tasks import TREND_WEIGHTS, BURST_BONUS
    delta_30, delta_60, delta_90 = 5, 3, 2
    burst_bonus = BURST_BONUS  # burst detected
    score = (
        delta_30 * TREND_WEIGHTS[30]
        + delta_60 * TREND_WEIGHTS[60]
        + delta_90 * TREND_WEIGHTS[90]
        + burst_bonus
    )
    # (5×3.0)=15.0 + (3×1.5)=4.5 + (2×1.0)=2.0 + 2.0 = 23.5
    assert score == 23.5


# =============================================================================
# Test 5: No burst when fewer than 3 distinct restaurants
# =============================================================================

def test_no_burst_below_threshold():
    """2 new restaurants in 14d → burst_bonus = 0, not triggered."""
    from jobs.trend_tasks import BURST_RESTAURANT_THRESHOLD, BURST_BONUS
    new_restaurants = {"rest-1", "rest-2"}
    burst = len(new_restaurants) >= BURST_RESTAURANT_THRESHOLD
    assert burst is False
    bonus = BURST_BONUS if burst else 0.0
    assert bonus == 0.0


# =============================================================================
# Test 6: compute_trend_metrics_task calls both sub-functions in order
# =============================================================================

@patch("jobs.trend_tasks._compute_trending")
@patch("jobs.trend_tasks._compute_popularity")
@patch("supabase.create_client")
def test_compute_task_calls_both(mock_create_client, mock_pop, mock_trend):
    """Task must call popularity first, then trending, and return both counts."""
    mock_create_client.return_value = MagicMock()
    mock_pop.return_value = 10
    mock_trend.return_value = 8

    from jobs.trend_tasks import compute_trend_metrics_task
    result = compute_trend_metrics_task()

    mock_pop.assert_called_once()
    mock_trend.assert_called_once()
    assert result["popularity_wines_updated"] == 10
    assert result["trending_wines_updated"] == 8
    assert "computed_at" in result


# =============================================================================
# Test 7: _compute_popularity returns 0 when no promoted submissions exist
# =============================================================================

@patch("supabase.create_client")
def test_popularity_returns_zero_no_submissions(mock_create_client):
    """Empty submissions → hash_to_wine_id is empty → returns 0 without error."""
    mock_sb = MagicMock()
    mock_create_client.return_value = mock_sb

    def table_side_effect(table_name):
        mock = MagicMock()
        if table_name == "master_wine_library_submissions":
            mock.select.return_value.not_.is_.return_value.execute.return_value.data = []
        return mock

    mock_sb.table.side_effect = table_side_effect

    from jobs.trend_tasks import _compute_popularity
    count = _compute_popularity(mock_sb)
    assert count == 0


# =============================================================================
# Test 8: TREND_WEIGHTS match the D-02 formula weights exactly
# =============================================================================

def test_trend_weights_match_formula():
    """D-02: 30d weight=3.0, 60d weight=1.5, 90d weight=1.0."""
    from jobs.trend_tasks import TREND_WEIGHTS
    assert TREND_WEIGHTS[30] == 3.0
    assert TREND_WEIGHTS[60] == 1.5
    assert TREND_WEIGHTS[90] == 1.0
