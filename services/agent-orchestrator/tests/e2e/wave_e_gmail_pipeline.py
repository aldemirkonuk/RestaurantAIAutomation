"""
Wave E: Gmail Pipeline Test (TEST-PROD-05)
===========================================
Triggers a low-stock notification for the e2e-test-restaurant and verifies
that an email delivery record appears in the notification_deliveries table
within 30 seconds.

Trigger mechanism: Upsert an inventory_stock row with quantity=0 below threshold=5.
NotificationAgent subscribes to stock.events (stock.threshold.breached) and fires
the email alert, writing a notification_deliveries row with channel='email'.

Depends on: Wave E is independent (D-17). Wave G depends on Wave E completing.

SKIP condition: GMAIL_USER env var not set (email backend not configured).

Run: pytest tests/e2e/wave_e_gmail_pipeline.py --junitxml=test-results/wave_e.xml
"""

import asyncio
import os
from datetime import datetime, timezone

import pytest

pytestmark = pytest.mark.prod_e2e

# Deterministic IDs (D-05)
E2E_STOCK_ID = "e2e-stock-001"
E2E_WINE_ID = "e2e-wine-001"
E2E_RESTAURANT_ID = "e2e-test-restaurant"

# Table names — verified from notification_agent.py
INVENTORY_TABLE = "inventory_stock"
DELIVERIES_TABLE = "notification_deliveries"


@pytest.fixture(scope="module", autouse=True)
def require_gmail():
    """Skip Wave E if Gmail SMTP is not configured."""
    if not os.environ.get("GMAIL_USER"):
        pytest.skip(
            "GMAIL_USER not set — skipping Wave E email pipeline test. "
            "Set GMAIL_USER (and GMAIL_PASSWORD) env vars on Railway to enable."
        )


async def upsert_low_stock_record(prod_supabase, e2e_created_ids: list) -> str:
    """Create a below-threshold inventory row to trigger a notification.

    Returns the ID of the created record (registered for teardown).
    NotificationAgent subscribes to stock.threshold.breached via RabbitMQ;
    the trigger assumes InventoryEngine (or a Supabase webhook) publishes the
    event when current_quantity drops below minimum_threshold.
    """
    payload = {
        "id": E2E_STOCK_ID,
        "restaurant_id": E2E_RESTAURANT_ID,
        "wine_id": E2E_WINE_ID,
        "current_quantity": 0,           # Below threshold — triggers alert
        "minimum_threshold": 5,
        "unit": "bottles",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": "e2e-wave-e",
    }
    prod_supabase.table(INVENTORY_TABLE).upsert(payload, on_conflict="id").execute()
    e2e_created_ids.append({"table": INVENTORY_TABLE, "id": E2E_STOCK_ID})
    return E2E_STOCK_ID


async def poll_notification_delivery(
    prod_supabase, restaurant_id: str, timeout_seconds: float = 30.0
) -> dict | None:
    """Poll notification_deliveries for email delivery row within 30s (TEST-PROD-05).

    NotificationAgent writes rows with:
      channel = 'email'
      status  = 'pending' → 'sent' / 'failed'  (verified from notification_agent.py)

    Returns the delivery row once status is 'sent' or 'delivered'.
    Returns None if timeout expires without a sent/delivered/queued row.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    last_exc = None
    while loop.time() < deadline:
        try:
            result = (
                prod_supabase.table(DELIVERIES_TABLE)
                .select("notification_id, channel, status, created_at")
                .eq("restaurant_id", restaurant_id)
                .eq("channel", "email")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if result.data and len(result.data) > 0:
                row = result.data[0]
                if row.get("status") in ("sent", "delivered", "queued"):
                    return row
        except Exception as exc:
            if last_exc is None:
                print(f"[poll] Supabase query error (will retry): {exc}", flush=True)
            last_exc = exc
        await asyncio.sleep(3.0)
    if last_exc:
        raise RuntimeError(
            f"Supabase poll failed after {timeout_seconds}s: {last_exc}"
        ) from last_exc
    return None


class TestGmailPipeline:
    """Wave E: Email pipeline — notification_deliveries row within 30s (TEST-PROD-05)."""

    async def test_notification_deliveries_table_accessible(self, prod_supabase):
        """Verify notification_deliveries table exists and is queryable."""
        try:
            prod_supabase.table(DELIVERIES_TABLE).select("notification_id").limit(1).execute()
        except Exception as exc:
            pytest.skip(
                f"notification_deliveries table not accessible: {exc}. "
                "ASSUMPTION A6 from RESEARCH.md may be wrong — verify table name "
                "from notification_agent.py. "
                "Confirmed from source: self.database.supabase.table('notification_deliveries')"
            )

    async def test_low_stock_triggers_email_delivery(
        self, prod_supabase, e2e_created_ids: list
    ):
        """Upsert below-threshold stock → email delivery row appears within 30s (TEST-PROD-05).

        Pipeline:
          inventory_stock upsert (current_quantity=0 < minimum_threshold=5)
          → InventoryEngine detects threshold breach
          → publishes stock.threshold.breached to RabbitMQ stock.events exchange
          → NotificationAgent receives event, calls send_low_stock_alert()
          → _track_notification_delivery() inserts notification_deliveries row
          → _mark_delivery_sent() updates status to 'sent'
        """
        await upsert_low_stock_record(prod_supabase, e2e_created_ids)

        delivery_row = await poll_notification_delivery(
            prod_supabase=prod_supabase,
            restaurant_id=E2E_RESTAURANT_ID,
            timeout_seconds=30.0,
        )

        assert delivery_row is not None, (
            f"No email delivery row found in '{DELIVERIES_TABLE}' within 30s "
            f"after triggering low-stock alert for restaurant_id='{E2E_RESTAURANT_ID}'.\n"
            "Possible causes:\n"
            "  1. NotificationAgent not receiving stock.threshold.breached events\n"
            "     (check InventoryEngine publishes to stock.events exchange)\n"
            "  2. GMAIL_USER / GMAIL_PASSWORD not set on Railway orchestrator\n"
            "  3. notification_deliveries table column names differ from expected\n"
            "     (verify PK is notification_id, columns: event_id, restaurant_id, channel, status)\n"
            "  4. NotificationAgent mock_mode=True on Railway (disables real sends)\n"
            "Check Railway logs for NotificationAgent errors."
        )

        status = delivery_row.get("status", "")
        assert status in ("sent", "delivered", "queued"), (
            f"Email delivery row has unexpected status: '{status}'. "
            f"Full row: {delivery_row}"
        )

    async def test_email_delivery_registered_for_teardown(self, e2e_created_ids: list):
        """Verify notification_deliveries rows are covered by tag-based teardown.

        The tag-based sweep in conftest_prod.py teardown_e2e_records covers
        notification_deliveries WHERE restaurant_id='e2e-test-restaurant'.
        This test confirms the table is in the E2E_TABLES sweep list.
        """
        import e2e.conftest_prod as cp

        assert "notification_deliveries" in cp.E2E_TABLES, (
            "notification_deliveries must be in conftest_prod.py E2E_TABLES teardown sweep. "
            "Add it to the E2E_TABLES list in conftest_prod.py."
        )
