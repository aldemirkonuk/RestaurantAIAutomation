"""Integration tests for HARD-04: ReportingAgent Level 4 hardening.

Covers composite idempotency, decision logging, PDF generation path, and edge cases.
"""
import pytest
import datetime as dt_module
from unittest.mock import AsyncMock, MagicMock, patch, call
from datetime import datetime
from agents.reporting_agent import ReportingAgent


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_db():
    """Build a mock DatabaseClient with Supabase chain pre-wired."""
    mock_db = MagicMock()
    mock_db.supabase = MagicMock()
    # idempotency_keys: default not-yet-processed
    mock_db.supabase.table.return_value.select.return_value.eq.return_value \
        .execute.return_value.data = []
    # insert returns a row with message_id
    mock_db.supabase.table.return_value.insert.return_value.execute.return_value \
        .data = [{"message_id": "report-key"}]
    # execute_query for real data queries
    mock_db.execute_query = AsyncMock(return_value=[
        {"wine_name": "Opus One", "stock_live": 5, "threshold_min": 3}
    ])
    return mock_db


@pytest.fixture
def mock_db():
    return _make_db()


@pytest.fixture
def agent(mock_db):
    mock_bus = MagicMock()
    config = {"mock_mode": True, "timezone": "America/Chicago"}
    a = ReportingAgent("reporting_agent", mock_bus, mock_db, config)
    a._check_idempotency = AsyncMock(return_value=False)
    a._mark_processed = AsyncMock()
    a.log_decision = AsyncMock()
    a.email_client = AsyncMock()
    a.push_service = AsyncMock()
    return a


def report_message(restaurant_id="rest-1", report_type="inventory", date="2026-04-10",
                   msg_type="generate_on_demand_report"):
    return {
        "type": msg_type,
        "restaurant_id": restaurant_id,
        "report_type": report_type,
        "date": date,
        "routing_key": "report.generate",
    }


# ---------------------------------------------------------------------------
# TestHARD04Idempotency
# ---------------------------------------------------------------------------

class TestHARD04Idempotency:
    @pytest.mark.asyncio
    async def test_duplicate_scheduled_report_skipped(self, agent):
        """Same restaurant_id + report_type + date → report generation called only once."""
        agent._check_idempotency.return_value = True  # already processed
        msg = report_message()
        result = await agent.process_message(msg)
        assert result.get("skipped") is True
        agent._mark_processed.assert_not_called()
        agent.log_decision.assert_not_called()

    @pytest.mark.asyncio
    async def test_unique_report_processed(self, agent):
        """Different date → report generates and mark_processed is called."""
        agent._check_idempotency.return_value = False
        msg = report_message(date="2026-04-11")
        result = await agent.process_message(msg)
        assert result.get("success") is True
        agent._mark_processed.assert_called_once()

    @pytest.mark.asyncio
    async def test_composite_key_uses_all_three_fields(self, agent):
        """_check_idempotency must be called with key containing all 3 fields."""
        agent._check_idempotency.return_value = False
        msg = report_message(restaurant_id="rest-1", report_type="inventory", date="2026-04-10")
        await agent.process_message(msg)
        call_args = agent._check_idempotency.call_args[0][0]
        assert "rest-1" in call_args
        assert "inventory" in call_args
        assert "2026-04-10" in call_args

    @pytest.mark.asyncio
    async def test_idempotency_fail_open_on_db_error(self, agent):
        """If _check_idempotency raises, report generation still proceeds."""
        agent._check_idempotency.side_effect = Exception("db timeout")
        msg = report_message()
        result = await agent.process_message(msg)
        # Should not raise; should return a result dict
        assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# TestHARD04DecisionLogging
# ---------------------------------------------------------------------------

class TestHARD04DecisionLogging:
    @pytest.mark.asyncio
    async def test_report_generated_logs_decision(self, agent):
        """log_decision must be called with decision_type='report_generated'."""
        agent._check_idempotency.return_value = False
        msg = report_message()
        await agent.process_message(msg)
        agent.log_decision.assert_called_once()
        kwargs = agent.log_decision.call_args
        # decision_type is first positional arg
        assert kwargs[0][0] == "report_generated"

    @pytest.mark.asyncio
    async def test_decision_log_includes_report_type(self, agent):
        """Decision log inputs dict must contain the report_type key."""
        agent._check_idempotency.return_value = False
        msg = report_message(report_type="sales")
        await agent.process_message(msg)
        kwargs = agent.log_decision.call_args[1]
        assert "report_type" in kwargs.get("inputs", {})
        assert kwargs["inputs"]["report_type"] == "sales"

    @pytest.mark.asyncio
    async def test_decision_log_confidence_0_9(self, agent):
        """log_decision must be called with confidence=0.9."""
        agent._check_idempotency.return_value = False
        msg = report_message()
        await agent.process_message(msg)
        kwargs = agent.log_decision.call_args[1]
        assert kwargs.get("confidence") == 0.9


# ---------------------------------------------------------------------------
# TestHARD04PDFGeneration
# ---------------------------------------------------------------------------

class TestHARD04PDFGeneration:
    @pytest.mark.asyncio
    @patch("agents.reporting_agent.weasyprint")
    async def test_pdf_export_called(self, mock_weasyprint, agent):
        """weasyprint.HTML().write_pdf() must be called during PDF export."""
        mock_weasyprint.HTML.return_value.write_pdf.return_value = b"%PDF-1.4 test"
        report_data = {
            "id": "test_report",
            "type": "inventory",
            "restaurant_id": "rest-1",
            "generated_at": "2026-04-10T00:00:00",
            "summary": {"total_items": 10},
        }
        result = await agent._export_to_pdf(report_data)
        mock_weasyprint.HTML.assert_called_once()
        assert result.get("mime_type") == "application/pdf"

    @pytest.mark.asyncio
    async def test_pdf_generation_does_not_block_idempotency_mark(self, agent):
        """_mark_processed must be called even after PDF generation."""
        agent._check_idempotency.return_value = False
        msg = report_message()
        result = await agent.process_message(msg)
        assert result.get("success") is True
        agent._mark_processed.assert_called_once()


# ---------------------------------------------------------------------------
# TestHARD04EdgeCases
# ---------------------------------------------------------------------------

class TestHARD04EdgeCases:
    @pytest.mark.asyncio
    async def test_missing_date_uses_today(self, agent):
        """No date in message → idempotency key uses today's date."""
        agent._check_idempotency.return_value = False
        fixed_date = "2026-04-10"
        with patch("agents.reporting_agent.datetime") as mock_dt:
            mock_dt.utcnow.return_value.strftime = lambda fmt: fixed_date
            msg = {
                "type": "generate_on_demand_report",
                "restaurant_id": "rest-1",
                "report_type": "inventory",
                # no "date" key
            }
            await agent.process_message(msg)
        call_args = agent._check_idempotency.call_args[0][0]
        assert fixed_date in call_args

    @pytest.mark.asyncio
    async def test_different_report_types_not_deduped(self, agent):
        """Same restaurant + date but different report_type → two separate idempotency checks."""
        agent._check_idempotency.return_value = False

        msg1 = report_message(restaurant_id="rest-1", report_type="inventory", date="2026-04-10")
        msg2 = report_message(restaurant_id="rest-1", report_type="sales", date="2026-04-10")

        await agent.process_message(msg1)
        await agent.process_message(msg2)

        assert agent._check_idempotency.call_count == 2
        keys = [c[0][0] for c in agent._check_idempotency.call_args_list]
        assert keys[0] != keys[1]
        assert "inventory" in keys[0]
        assert "sales" in keys[1]

    @pytest.mark.asyncio
    async def test_unknown_message_type_bypasses_idempotency(self, agent):
        """Unknown message type returns error without idempotency side-effects."""
        msg = {"type": "unknown_type", "restaurant_id": "rest-1"}
        result = await agent.process_message(msg)
        assert result.get("success") is False
        agent._mark_processed.assert_not_called()
        agent.log_decision.assert_not_called()

    @pytest.mark.asyncio
    async def test_mark_processed_called_with_composite_key(self, agent):
        """_mark_processed receives the same composite key passed to _check_idempotency."""
        agent._check_idempotency.return_value = False
        msg = report_message(restaurant_id="rest-42", report_type="procurement", date="2026-05-01")
        await agent.process_message(msg)
        mark_key = agent._mark_processed.call_args[0][0]
        assert mark_key == "rest-42:procurement:2026-05-01"

    @pytest.mark.asyncio
    async def test_missing_date_logs_warning(self, agent):
        """Message with no date field triggers a WARNING log containing 'defaulting to UTC date'."""
        agent._check_idempotency.return_value = False
        msg = {
            "type": "generate_on_demand_report",
            "restaurant_id": "rest-1",
            "report_type": "inventory",
            # no "date" key — intentionally absent
        }
        with patch.object(agent.logger, "warning") as mock_warn:
            await agent.process_message(msg)
        assert mock_warn.called, "Expected logger.warning to be called when date is absent"
        warning_text = mock_warn.call_args[0][0]
        assert "defaulting to UTC date" in warning_text

    @pytest.mark.asyncio
    async def test_explicit_date_overrides_utc(self, agent):
        """Message with date='2026-04-10' uses that date in the idempotency key regardless of UTC now."""
        agent._check_idempotency.return_value = False
        msg = {
            "type": "generate_on_demand_report",
            "restaurant_id": "rest-1",
            "report_type": "inventory",
            "date": "2026-04-10",
        }
        # Patch utcnow to return a different date to confirm caller date wins
        with patch("agents.reporting_agent.datetime") as mock_dt:
            mock_dt.utcnow.return_value.strftime = lambda fmt: "2026-04-11"
            await agent.process_message(msg)
        call_args = agent._check_idempotency.call_args[0][0]
        assert "2026-04-10" in call_args, f"Expected caller date '2026-04-10' in key, got: {call_args}"
        assert "2026-04-11" not in call_args, "UTC fallback date should not appear when caller date is supplied"

    @pytest.mark.asyncio
    async def test_log_decision_output_includes_date_source(self, agent):
        """log_decision output dict includes date_source: 'caller' or 'utc_default'."""
        agent._check_idempotency.return_value = False

        # Case 1: caller supplies date → date_source should be "caller"
        msg_with_date = report_message(date="2026-04-10")
        await agent.process_message(msg_with_date)
        output_with_date = agent.log_decision.call_args[1].get("output", {})
        assert output_with_date.get("date_source") == "caller", (
            f"Expected date_source='caller', got: {output_with_date.get('date_source')}"
        )

        agent.log_decision.reset_mock()

        # Case 2: no date in message → date_source should be "utc_default"
        msg_no_date = {
            "type": "generate_on_demand_report",
            "restaurant_id": "rest-1",
            "report_type": "inventory",
        }
        await agent.process_message(msg_no_date)
        output_no_date = agent.log_decision.call_args[1].get("output", {})
        assert output_no_date.get("date_source") == "utc_default", (
            f"Expected date_source='utc_default', got: {output_no_date.get('date_source')}"
        )
