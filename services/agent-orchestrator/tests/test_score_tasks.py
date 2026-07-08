"""
Unit tests for score_tasks.py
Covers: CRIT-01 (task structure, Redis NX dedup), CRIT-05 (markup cascade),
        CRIT-06 (anomaly flagging), D-03c (dedup key patterns)

All external dependencies (Redis, Supabase, Serper, Celery) are mocked.
No live connections required.
"""

from unittest.mock import patch, MagicMock


# =============================================================================
# CRIT-01 / D-03c: Redis SET NX dedup
# =============================================================================


class TestRedisNXDedup:
    """Redis SET NX lock prevents double processing of the same wine."""

    def test_second_call_returns_none_when_lock_held(self):
        """When NX set returns None (lock held), score_lookup_task returns None immediately."""
        from jobs.score_tasks import score_lookup_task

        mock_redis = MagicMock()
        mock_redis.set.return_value = None  # NX failed — lock already held

        with patch("jobs.score_tasks.redis_lib") as mock_redis_lib:
            mock_redis_lib.from_url.return_value = mock_redis
            result = score_lookup_task.run("test-wine-id-123")

        assert result is None
        mock_redis.set.assert_called_once_with(
            "wine:scores:test-wine-id-123", "1", nx=True, ex=3600
        )
        # Lock is NOT deleted when it was never acquired (early return before try block)
        mock_redis.delete.assert_not_called()

    def test_lock_acquired_proceeds_and_releases(self):
        """When NX set returns True, task proceeds and always releases lock in finally."""
        from jobs.score_tasks import score_lookup_task

        mock_redis = MagicMock()
        mock_redis.set.return_value = True  # NX succeeded
        mock_redis.delete.return_value = 1

        async def mock_score_async(wine_id):
            return {"wine_id": wine_id, "sources_found": 2, "composite": 90.0}

        with patch("jobs.score_tasks.redis_lib") as mock_redis_lib, patch(
            "jobs.score_tasks._score_async", side_effect=mock_score_async
        ):
            mock_redis_lib.from_url.return_value = mock_redis
            result = score_lookup_task.run("wine-proceed")

        # Lock must be released in finally block
        mock_redis.delete.assert_called_once_with("wine:scores:wine-proceed")
        assert result == {
            "wine_id": "wine-proceed",
            "sources_found": 2,
            "composite": 90.0,
        }

    def test_lock_released_even_on_exception(self):
        """Lock is always released in finally block, even when _score_async raises."""
        from jobs.score_tasks import score_lookup_task

        mock_redis = MagicMock()
        mock_redis.set.return_value = True

        async def mock_score_raises(wine_id):
            raise RuntimeError("Serper timeout")

        # Use apply() in eager mode so retry is surfaced without Celery overhead
        with patch("jobs.score_tasks.redis_lib") as mock_redis_lib, patch(
            "jobs.score_tasks._score_async", side_effect=mock_score_raises
        ), patch.object(
            score_lookup_task, "retry", side_effect=Exception("retry exhausted")
        ):
            mock_redis_lib.from_url.return_value = mock_redis
            # With max_retries=3, after the third retry the task returns None
            # Patch request.retries via the Celery app task request context
            try:
                score_lookup_task.run("wine-exc")
            except Exception:
                pass

        # Lock MUST be deleted regardless of exception
        mock_redis.delete.assert_called_once_with("wine:scores:wine-exc")

    def test_dataset_enrich_uses_different_lock_key(self):
        """dataset_enrich_task uses wine:dataset:{id} not wine:scores:{id}."""
        from jobs.score_tasks import dataset_enrich_task

        mock_redis = MagicMock()
        mock_redis.set.return_value = None  # already locked

        with patch("jobs.score_tasks.redis_lib") as mock_redis_lib:
            mock_redis_lib.from_url.return_value = mock_redis
            result = dataset_enrich_task.run("wine-dataset-456")

        set_call = mock_redis.set.call_args[0]
        assert set_call[0] == "wine:dataset:wine-dataset-456"
        assert result is None

    def test_score_lookup_lock_key_format(self):
        """Lock key for score_lookup_task is wine:scores:{wine_id}."""
        from jobs.score_tasks import score_lookup_task

        mock_redis = MagicMock()
        mock_redis.set.return_value = None

        with patch("jobs.score_tasks.redis_lib") as mock_redis_lib:
            mock_redis_lib.from_url.return_value = mock_redis
            score_lookup_task.run("abc-def-ghi")

        set_call = mock_redis.set.call_args[0]
        assert set_call[0] == "wine:scores:abc-def-ghi"
        assert set_call[1] == "1"
        kw = mock_redis.set.call_args[1]
        assert kw.get("nx") is True
        assert kw.get("ex") == 3600


# =============================================================================
# Budget cap behavior
# =============================================================================


class TestBudgetCapBehavior:
    """CRIT-01: Budget cap causes graceful skip per Serper source call."""

    def test_skips_when_budget_exhausted(self):
        """When _score_async returns skipped_budget_cap, task returns that result."""
        from jobs.score_tasks import score_lookup_task

        mock_redis = MagicMock()
        mock_redis.set.return_value = True
        mock_redis.delete.return_value = 1

        async def mock_score_budget_cap(wine_id):
            return {
                "wine_id": wine_id,
                "status": "skipped_budget_cap",
                "sources_found": 0,
            }

        with patch("jobs.score_tasks.redis_lib") as mock_redis_lib, patch(
            "jobs.score_tasks._score_async", side_effect=mock_score_budget_cap
        ):
            mock_redis_lib.from_url.return_value = mock_redis
            result = score_lookup_task.run("wine-budget")

        assert result is not None
        assert result.get("status") == "skipped_budget_cap"
        assert result.get("sources_found") == 0

    def test_rescore_stale_queues_wines(self):
        """rescore_stale_wines_task fetches wines and queues score_lookup_task for stale ones."""
        from jobs.score_tasks import rescore_stale_wines_task

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.execute.return_value.data = [
            {"id": "wine-stale-1", "critic_scores": {}, "scores_last_updated_at": None},
            {
                "id": "wine-stale-2",
                "critic_scores": None,
                "scores_last_updated_at": None,
            },
        ]

        with patch(
            "jobs.score_tasks._get_supabase_client", return_value=mock_supabase
        ), patch("jobs.score_tasks.score_lookup_task") as mock_task:
            mock_task.delay = MagicMock()
            result = rescore_stale_wines_task()

        assert result["queued"] == 2
        assert mock_task.delay.call_count == 2


# =============================================================================
# CRIT-05: Markup cascade update
# =============================================================================


class TestMarkupCascadeUpdate:
    """_update_inventory_markup writes markup_ratio + markup_classification to inventory rows."""

    def test_markup_computed_from_menu_and_retail_price(self):
        """120 / 50 = 2.4 → standard, no anomaly."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        inv_select = (
            mock_supabase.table.return_value.select.return_value.eq.return_value.execute
        )
        inv_select.return_value.data = [
            {"id": "inv-row-1", "menu_price_current": 120.0},
        ]

        _update_inventory_markup(mock_supabase, "wine-123", 50.0)

        # The update call should have been made to restaurant_inventory
        update_payload = mock_supabase.table.return_value.update.call_args[0][0]
        assert abs(update_payload["markup_ratio"] - 2.4) < 0.01
        assert update_payload["markup_classification"] == "standard"

    def test_null_menu_price_row_skipped(self):
        """NULL menu_price_current → compute_markup_info returns None → row skipped."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inv-null", "menu_price_current": None},
        ]

        _update_inventory_markup(mock_supabase, "wine-null", 50.0)

        # No update should be called for a row with null menu_price
        mock_supabase.table.return_value.update.assert_not_called()

    def test_empty_inventory_rows_no_error(self):
        """If no inventory rows, function completes without errors."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = (
            []
        )

        # Should not raise
        _update_inventory_markup(mock_supabase, "wine-empty", 50.0)
        mock_supabase.table.return_value.update.assert_not_called()

    def test_value_tier_markup(self):
        """60 / 50 = 1.2 → value tier, not anomaly (>= 0.8)."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inv-value", "menu_price_current": 60.0},
        ]

        _update_inventory_markup(mock_supabase, "wine-value", 50.0)

        update_payload = mock_supabase.table.return_value.update.call_args[0][0]
        assert update_payload["markup_classification"] == "value"

    def test_multiple_inventory_rows_all_updated(self):
        """Multiple inventory rows for the same wine all get updated."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inv-1", "menu_price_current": 100.0},
            {"id": "inv-2", "menu_price_current": 150.0},
        ]

        _update_inventory_markup(mock_supabase, "wine-multi", 50.0)

        assert mock_supabase.table.return_value.update.call_count == 2


# =============================================================================
# CRIT-06: Anomaly detection and field_review_queue insertion
# =============================================================================


class TestAnomalyFlagging:
    """markup_ratio > 5x or < 0.8x triggers field_review_queue insert."""

    def test_anomaly_above_5x_inserts_review_queue_row(self):
        """300 / 50 = 6.0x → anomaly → field_review_queue insert."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inv-anomaly-high", "menu_price_current": 300.0},
        ]

        _update_inventory_markup(mock_supabase, "wine-anom-high", 50.0)

        # field_review_queue insert should have been called
        table_calls = [c[0][0] for c in mock_supabase.table.call_args_list]
        assert "field_review_queue" in table_calls

    def test_anomaly_below_08x_inserts_review_queue_row(self):
        """30 / 50 = 0.6x → anomaly below 0.8 → field_review_queue insert."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inv-anomaly-low", "menu_price_current": 30.0},
        ]

        _update_inventory_markup(mock_supabase, "wine-anom-low", 50.0)

        table_calls = [c[0][0] for c in mock_supabase.table.call_args_list]
        assert "field_review_queue" in table_calls

    def test_no_anomaly_for_normal_markup(self):
        """100 / 50 = 2.0x → standard → NO field_review_queue insert."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inv-normal", "menu_price_current": 100.0},
        ]

        _update_inventory_markup(mock_supabase, "wine-normal", 50.0)

        table_calls = [c[0][0] for c in mock_supabase.table.call_args_list]
        assert "field_review_queue" not in table_calls

    def test_anomaly_at_exactly_5x_not_flagged(self):
        """250 / 50 = 5.0x exactly → NOT anomaly (threshold is > 5.0, not >= 5.0)."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inv-exact-5x", "menu_price_current": 250.0},
        ]

        _update_inventory_markup(mock_supabase, "wine-5x", 50.0)

        table_calls = [c[0][0] for c in mock_supabase.table.call_args_list]
        assert "field_review_queue" not in table_calls

    def test_anomaly_source_is_pricing_anomaly(self):
        """field_review_queue row must have source='pricing_anomaly'."""
        from jobs.score_tasks import _update_inventory_markup

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inv-source-check", "menu_price_current": 300.0},
        ]

        _update_inventory_markup(mock_supabase, "wine-src", 50.0)

        # Find the insert call on field_review_queue
        for c in mock_supabase.table.call_args_list:
            if c[0][0] == "field_review_queue":
                insert_payload = mock_supabase.table.return_value.insert.call_args[0][0]
                assert insert_payload["source"] == "pricing_anomaly"
                assert insert_payload["field_name"] == "markup_ratio"
                assert insert_payload["status"] == "pending"
                break


# =============================================================================
# rescore_stale_wines_task boundary conditions
# =============================================================================


class TestRescoreStaleWines:
    """rescore_stale_wines_task correctly identifies stale wines."""

    def test_empty_library_queues_nothing(self):
        from jobs.score_tasks import rescore_stale_wines_task

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.execute.return_value.data = (
            []
        )

        with patch(
            "jobs.score_tasks._get_supabase_client", return_value=mock_supabase
        ), patch("jobs.score_tasks.score_lookup_task") as mock_task:
            mock_task.delay = MagicMock()
            result = rescore_stale_wines_task()

        assert result["queued"] == 0
        mock_task.delay.assert_not_called()

    def test_wine_with_existing_fresh_scores_not_queued(self):
        """Wine with recent scores (not stale) is NOT re-queued."""
        from jobs.score_tasks import rescore_stale_wines_task
        from datetime import datetime, timezone, timedelta

        fresh_timestamp = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.execute.return_value.data = [
            {
                "id": "wine-fresh",
                "critic_scores": {"wine_advocate": {"normalized_score": 93.0}},
                "scores_last_updated_at": fresh_timestamp,
            },
        ]

        with patch(
            "jobs.score_tasks._get_supabase_client", return_value=mock_supabase
        ), patch("jobs.score_tasks.score_lookup_task") as mock_task:
            mock_task.delay = MagicMock()
            result = rescore_stale_wines_task()

        assert result["queued"] == 0
