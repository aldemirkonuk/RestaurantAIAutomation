"""Unit tests for override_service.py (Phase 13 DEVUI-10).

Note: TestRequireStudioRole lives in test_studio_routes.py (sync dep.dependency pattern).
This file tests service-layer logic only: check_and_update_trust.

check_and_update_trust is a SYNCHRONOUS def — never use await.
Signature: check_and_update_trust(supabase, user_id: str, approved: bool, threshold: int = 5)
Returns None. Calls supabase.rpc("increment_trust_counter", {"p_user_id": user_id}) on approve.
"""

from unittest.mock import MagicMock


class TestCheckAndUpdateTrust:
    """Test trust counter logic in override_service.check_and_update_trust."""

    def _make_mock_sb(self, consecutive_approved: int = 3) -> MagicMock:
        """Supabase mock with pre-configured chain for check_and_update_trust."""
        mock_sb = MagicMock()
        # RPC call for increment_trust_counter (approve path)
        mock_sb.rpc.return_value.execute.return_value = None
        # Post-increment count lookup:
        # .table.select.eq.eq.is_.maybe_single.execute.data
        mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.maybe_single.return_value.execute.return_value.data = {
            "consecutive_approved_overrides": consecutive_approved
        }
        # update chain for policy flip or streak reset
        mock_sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {}
        ]
        return mock_sb

    def test_increment_trust_counter_rpc_called_on_approve(self):
        """check_and_update_trust calls increment_trust_counter RPC with correct p_user_id."""
        from services.override_service import check_and_update_trust

        mock_sb = self._make_mock_sb(consecutive_approved=3)

        result = check_and_update_trust(mock_sb, user_id="u-001", approved=True)
        mock_sb.rpc.assert_called_once_with(
            "increment_trust_counter",
            {"p_user_id": "u-001"},
        )
        assert result is None

    def test_rejection_resets_streak(self):
        """check_and_update_trust with approved=False resets streak; does not call RPC."""
        from services.override_service import check_and_update_trust

        mock_sb = MagicMock()
        mock_sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {}
        ]

        result = check_and_update_trust(mock_sb, user_id="u-002", approved=False)
        mock_sb.rpc.assert_not_called()
        assert result is None

    def test_rejection_writes_zero_to_consecutive_field(self):
        """check_and_update_trust with approved=False calls update with consecutive_approved_overrides=0."""
        from services.override_service import check_and_update_trust

        mock_sb = MagicMock()
        mock_sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {}
        ]

        check_and_update_trust(mock_sb, user_id="u-002", approved=False)
        update_call = mock_sb.table.return_value.update.call_args_list
        assert any(
            "consecutive_approved_overrides" in str(call) for call in update_call
        )

    def test_threshold_reached_flips_policy_to_auto_promote(self):
        """When count reaches threshold, update sets promotion_policy=auto_promote."""
        from services.override_service import check_and_update_trust

        mock_sb = self._make_mock_sb(consecutive_approved=5)

        check_and_update_trust(mock_sb, user_id="u-003", approved=True, threshold=5)
        update_calls = mock_sb.table.return_value.update.call_args_list
        assert any("auto_promote" in str(call) for call in update_calls)

    def test_below_threshold_does_not_flip_policy(self):
        """When count is below threshold (3 of 5), promotion_policy is NOT changed."""
        from services.override_service import check_and_update_trust

        mock_sb = self._make_mock_sb(consecutive_approved=3)

        check_and_update_trust(mock_sb, user_id="u-004", approved=True, threshold=5)
        update_calls = mock_sb.table.return_value.update.call_args_list
        assert not any("auto_promote" in str(call) for call in update_calls)
