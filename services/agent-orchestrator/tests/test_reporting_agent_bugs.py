"""Tests for BUG-09, BUG-10, BUG-11, BUG-12 in ReportingAgent."""
import inspect
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, mock_open
from agents.reporting_agent import ReportingAgent


def _make_agent():
    """Build ReportingAgent with minimal mocks."""
    agent = ReportingAgent.__new__(ReportingAgent)
    agent.agent_name = "test_reporting"
    agent.logger = MagicMock()
    agent.config = {
        "ai_insights_enabled": False,
        "predictive_analytics_enabled": False,
    }
    agent.ai_insights_enabled = False
    agent.predictive_analytics_enabled = False
    agent.email_client = AsyncMock()
    agent.push_service = AsyncMock()
    agent.mock_mode = True

    # BUG-09: BaseAgent stores as self.database
    agent.database = MagicMock()

    return agent


# ---------------------------------------------------------------------------
# BUG-09: self.db → self.database
# ---------------------------------------------------------------------------

class TestBUG09SelfDb:
    def test_no_self_db_in_source(self):
        """Source of reporting_agent.py must not reference self.db."""
        source = inspect.getsource(ReportingAgent)
        # Find all self.db occurrences (but not self.database)
        import re
        matches = re.findall(r'\bself\.db\b(?!ase)', source)
        assert matches == [], \
            f"BUG-09: found {len(matches)} occurrences of self.db: {matches}"

    @pytest.mark.asyncio
    async def test_generate_inventory_report_uses_self_database(self):
        """_generate_inventory_report must not raise AttributeError for self.db."""
        agent = _make_agent()
        # Set up mock Supabase chain for inventory query
        mock_result = MagicMock()
        mock_result.data = []
        agent.database.supabase.table.return_value \
            .select.return_value \
            .eq.return_value \
            .execute.return_value = mock_result

        # Should not raise AttributeError
        result = await agent._generate_inventory_report("rest-1")
        assert result["type"] == "inventory"
        assert "summary" in result

    @pytest.mark.asyncio
    async def test_get_manager_preferences_uses_self_database(self):
        """_get_manager_preferences must not raise AttributeError for self.db."""
        agent = _make_agent()
        mock_result = MagicMock()
        mock_result.data = {"report_timezone": "America/Chicago", "report_format": "pdf"}
        agent.database.supabase.table.return_value \
            .select.return_value \
            .eq.return_value \
            .single.return_value \
            .execute.return_value = mock_result

        prefs = await agent._get_manager_preferences("manager-1")
        assert prefs is not None


# ---------------------------------------------------------------------------
# BUG-10: SMS append outside if-block
# ---------------------------------------------------------------------------

class TestBUG10SmsAppend:
    @pytest.mark.asyncio
    async def test_sms_not_in_channels_when_disabled(self):
        """channels_used must not contain 'sms' when sms preference is False/unset."""
        agent = _make_agent()
        agent.email_client.send_email = AsyncMock()
        agent.push_service.send_notification = AsyncMock()

        preferences = {
            "notification_channels": {"email": True, "push": False, "sms": False},
            "email": "manager@example.com",
        }
        report_file = {
            "file_path": "/tmp/fake.pdf",
            "file_name": "fake.pdf",
            "mime_type": "application/pdf",
        }

        result = await agent._deliver_report(
            report_file=report_file,
            preferences=preferences,
            manager_id="manager-1",
            report_type="inventory",
        )

        assert "sms" not in result.get("channels", []), \
            f"BUG-10: 'sms' should not be in channels when sms=False, got {result['channels']}"

    @pytest.mark.asyncio
    async def test_sms_append_inside_if_block(self):
        """Source inspection: channels_used.append('sms') must be inside an sms if-block."""
        source = inspect.getsource(ReportingAgent._deliver_report)
        # The sms append must only appear inside an if-guarded block.
        # Simplest check: if the line exists, verify it's not reachable when SMS is off.
        # We rely on the functional test above (test_sms_not_in_channels_when_disabled).
        # This source check ensures no bare unindented append remains.
        lines = source.split('\n')
        for i, line in enumerate(lines):
            if 'channels_used.append("sms")' in line or "channels_used.append('sms')" in line:
                # The line must be preceded by an active (uncommented) if-sms guard
                context = '\n'.join(lines[max(0, i-5):i+1])
                assert 'if' in context and '#' not in line.strip()[:2], \
                    f"BUG-10: sms append at line {i} appears outside active if-block:\n{context}"


# ---------------------------------------------------------------------------
# BUG-11: Real inventory + sales reports from DB
# ---------------------------------------------------------------------------

class TestBUG11RealReports:
    @pytest.mark.asyncio
    async def test_inventory_report_queries_inventory_stock_table(self):
        """_generate_inventory_report must query inventory_stock table."""
        agent = _make_agent()

        mock_result = MagicMock()
        mock_result.data = [
            {"id": "i1", "wine_name": "Caymus", "stock_live": 5, "threshold_min": 3, "wine_price": 150.0},
            {"id": "i2", "wine_name": "Opus One", "stock_live": 1, "threshold_min": 3, "wine_price": 350.0},
            {"id": "i3", "wine_name": "Pinot Noir", "stock_live": 0, "threshold_min": 2, "wine_price": 80.0},
        ]
        agent.database.supabase.table.return_value \
            .select.return_value \
            .eq.return_value \
            .execute.return_value = mock_result

        result = await agent._generate_inventory_report("rest-1")

        # Verify it called the right table
        agent.database.supabase.table.assert_called_with("inventory_stock")
        assert result["summary"]["total_items"] == 3
        # Opus One (stock=1 < threshold=3) and Pinot Noir (stock=0 < threshold=2) = 2 low stock
        assert result["summary"]["low_stock_count"] == 2
        assert result["summary"]["out_of_stock_count"] == 1

    @pytest.mark.asyncio
    async def test_inventory_report_returns_nonzero_value(self):
        """_generate_inventory_report total_value must be computed from actual rows."""
        agent = _make_agent()
        mock_result = MagicMock()
        mock_result.data = [
            {"id": "i1", "wine_name": "Caymus", "stock_live": 5, "threshold_min": 3, "wine_price": 100.0},
        ]
        agent.database.supabase.table.return_value \
            .select.return_value \
            .eq.return_value \
            .execute.return_value = mock_result

        result = await agent._generate_inventory_report("rest-1")
        assert result["summary"]["total_value"] == 500.0, \
            f"Expected total_value=500.0 (5 bottles × $100), got {result['summary']['total_value']}"

    @pytest.mark.asyncio
    async def test_sales_report_queries_pos_webhook_logs(self):
        """_generate_sales_report must query pos_webhook_logs table."""
        agent = _make_agent()

        mock_result = MagicMock()
        mock_result.data = [
            {"id": "w1", "event_type": "OrderCompleted", "payload": {"wine_name": "Caymus", "quantity": 2, "price": 150.0}},
            {"id": "w2", "event_type": "OrderCompleted", "payload": {"wine_name": "Opus One", "quantity": 1, "price": 350.0}},
            {"id": "w3", "event_type": "OrderCompleted", "payload": {"wine_name": "Caymus", "quantity": 1, "price": 150.0}},
        ]
        agent.database.supabase.table.return_value \
            .select.return_value \
            .eq.return_value \
            .order.return_value \
            .execute.return_value = mock_result

        result = await agent._generate_sales_report("rest-1")

        agent.database.supabase.table.assert_called_with("pos_webhook_logs")
        assert result["summary"]["total_sales"] == 3, \
            f"Expected total_sales=3, got {result['summary']['total_sales']}"
        assert len(result["summary"]["top_sellers"]) > 0, "top_sellers should not be empty"


# ---------------------------------------------------------------------------
# BUG-12: Real PDF via weasyprint
# ---------------------------------------------------------------------------

class TestBUG12RealPDF:
    @pytest.mark.asyncio
    async def test_export_to_pdf_calls_weasyprint(self):
        """_export_to_pdf must call weasyprint.HTML.write_pdf, not return a mock."""
        agent = _make_agent()
        report_data = {
            "id": "test_report_001",
            "type": "inventory",
            "restaurant_id": "rest-1",
            "generated_at": "2026-04-15T12:00:00",
            "summary": {"total_items": 3, "low_stock_count": 1},
            "details": {},
        }

        with patch("agents.reporting_agent.weasyprint") as mock_weasyprint:
            mock_html_instance = MagicMock()
            mock_weasyprint.HTML.return_value = mock_html_instance
            mock_html_instance.write_pdf.return_value = b"%PDF-1.4 fake pdf content"

            result = await agent._export_to_pdf(report_data)

        mock_weasyprint.HTML.assert_called_once()
        mock_html_instance.write_pdf.assert_called_once()
        assert result["mime_type"] == "application/pdf"
        assert result["file_path"].endswith(".pdf")

    @pytest.mark.asyncio
    async def test_export_to_pdf_file_size_is_real(self):
        """_export_to_pdf size_bytes must reflect actual bytes written, not hardcoded 100KB."""
        agent = _make_agent()
        report_data = {
            "id": "test_report_002",
            "type": "inventory",
            "restaurant_id": "rest-1",
            "generated_at": "2026-04-15T12:00:00",
            "summary": {"total_items": 5},
            "details": {},
        }
        fake_pdf_bytes = b"%PDF-1.4 " + b"x" * 512  # 521 bytes

        with patch("agents.reporting_agent.weasyprint") as mock_weasyprint:
            mock_html_instance = MagicMock()
            mock_weasyprint.HTML.return_value = mock_html_instance
            mock_html_instance.write_pdf.return_value = fake_pdf_bytes

            result = await agent._export_to_pdf(report_data)

        assert result["size_bytes"] == len(fake_pdf_bytes), \
            f"Expected size_bytes={len(fake_pdf_bytes)}, got {result['size_bytes']} (hardcoded mock?)"
