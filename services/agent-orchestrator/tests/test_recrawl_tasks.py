"""
Tests for recrawl_tasks.py — TEMP-02

Tests:
  1. scheduled_recrawl_task selects due restaurants and fires crawl_and_diff_task.delay()
  2. scheduled_recrawl_task with no due restaurants returns {"queued": 0}
  3. crawl_and_diff_task Redis NX dedup: returns None when lock not acquired
  4. _update_crawl_schedule sets last_crawled_at, next_crawl_at, resets consecutive_failures
  5. _mark_crawl_error: consecutive_failures incremented; status='error' after threshold
"""
import pytest
from unittest.mock import MagicMock, patch, call


# =============================================================================
# Test 1: scheduled_recrawl_task fans out correctly
# =============================================================================

@patch("jobs.recrawl_tasks.crawl_and_diff_task")
@patch("supabase.create_client")
def test_scheduled_recrawl_fans_out(mock_create_client, mock_task):
    mock_sb = MagicMock()
    mock_create_client.return_value = mock_sb
    mock_sb.table.return_value.select.return_value.eq.return_value.lte.return_value.execute.return_value.data = [
        {"restaurant_id": "rest-001"},
        {"restaurant_id": "rest-002"},
    ]
    from jobs.recrawl_tasks import scheduled_recrawl_task
    result = scheduled_recrawl_task()
    assert result["queued"] == 2
    mock_task.delay.assert_any_call("rest-001")
    mock_task.delay.assert_any_call("rest-002")


# =============================================================================
# Test 2: no due restaurants returns queued=0
# =============================================================================

@patch("jobs.recrawl_tasks.crawl_and_diff_task")
@patch("supabase.create_client")
def test_scheduled_no_due_restaurants(mock_create_client, mock_task):
    mock_sb = MagicMock()
    mock_create_client.return_value = mock_sb
    mock_sb.table.return_value.select.return_value.eq.return_value.lte.return_value.execute.return_value.data = []
    from jobs.recrawl_tasks import scheduled_recrawl_task
    result = scheduled_recrawl_task()
    assert result["queued"] == 0
    mock_task.delay.assert_not_called()


# =============================================================================
# Test 3: Redis NX dedup returns None when lock not acquired
# =============================================================================

@patch("jobs.recrawl_tasks.redis_lib")
def test_crawl_and_diff_deduped_when_lock_not_acquired(mock_redis_lib):
    mock_r = MagicMock()
    mock_redis_lib.from_url.return_value = mock_r
    mock_r.set.return_value = None  # lock not acquired
    from jobs.recrawl_tasks import crawl_and_diff_task
    result = crawl_and_diff_task.run("rest-001")
    assert result is None
    mock_r.delete.assert_not_called()  # lock never acquired, so not deleted


# =============================================================================
# Test 4: _update_crawl_schedule sets correct fields
# =============================================================================

def test_update_crawl_schedule_weekly():
    mock_sb = MagicMock()
    from jobs.recrawl_tasks import _update_crawl_schedule
    _update_crawl_schedule(mock_sb, "rest-001", "weekly")
    update_call = mock_sb.table.return_value.update.call_args
    update_data = update_call[0][0]
    assert update_data["consecutive_failures"] == 0
    assert update_data["status"] == "active"
    assert "last_crawled_at" in update_data
    assert "next_crawl_at" in update_data


# =============================================================================
# Test 5: _mark_crawl_error sets status='error' after threshold
# =============================================================================

@patch("supabase.create_client")
def test_mark_crawl_error_sets_error_status_at_threshold(mock_create_client):
    mock_sb = MagicMock()
    mock_create_client.return_value = mock_sb
    # Simulate already at threshold-1 failures (2 failures → 3rd push triggers error)
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
        "consecutive_failures": 2  # CONSECUTIVE_FAILURE_THRESHOLD - 1
    }
    from jobs.recrawl_tasks import _mark_crawl_error, CONSECUTIVE_FAILURE_THRESHOLD
    assert CONSECUTIVE_FAILURE_THRESHOLD == 3
    _mark_crawl_error("rest-001", consecutive_inc=True)
    update_call = mock_sb.table.return_value.update.call_args[0][0]
    assert update_call["status"] == "error"
    assert update_call["consecutive_failures"] == 3


# =============================================================================
# Test 6: _update_crawl_schedule uses correct day offset for biweekly
# =============================================================================

def test_update_crawl_schedule_biweekly_offset():
    from datetime import datetime, timezone, timedelta
    mock_sb = MagicMock()
    from jobs.recrawl_tasks import _update_crawl_schedule, FREQUENCY_DAYS
    assert FREQUENCY_DAYS["biweekly"] == 14
    _update_crawl_schedule(mock_sb, "rest-002", "biweekly")
    update_call = mock_sb.table.return_value.update.call_args[0][0]
    # next_crawl_at should be approximately 14 days from now
    next_crawl = datetime.fromisoformat(update_call["next_crawl_at"])
    last_crawled = datetime.fromisoformat(update_call["last_crawled_at"])
    delta_days = (next_crawl - last_crawled).days
    assert delta_days == 14


# =============================================================================
# Test 7: _mark_crawl_error keeps status='active' below threshold
# =============================================================================

@patch("supabase.create_client")
def test_mark_crawl_error_stays_active_below_threshold(mock_create_client):
    mock_sb = MagicMock()
    mock_create_client.return_value = mock_sb
    # 1 failure so far — below threshold of 3
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
        "consecutive_failures": 1
    }
    from jobs.recrawl_tasks import _mark_crawl_error
    _mark_crawl_error("rest-003", consecutive_inc=True)
    update_call = mock_sb.table.return_value.update.call_args[0][0]
    assert update_call["status"] == "active"
    assert update_call["consecutive_failures"] == 2
