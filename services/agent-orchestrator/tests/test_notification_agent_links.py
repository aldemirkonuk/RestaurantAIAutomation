"""
Outbound links notification_agent.py builds.

Two defects, pinned:

1. `_get_base_url()` returned a hardcoded domain, `https://app.wineops.ai`,
   that does not resolve at all (curl -> connection failure). It now reads
   `settings.frontend_url` (`FRONTEND_URL`, `config/settings.py`).
2. `send_order_approval_request` built `approve_url`/`reject_url` as
   `GET /api/orders/:id/approve?token=<hash>` — a route the gateway has never
   served, against a "token" the function's own comment admitted was not
   real ("In real implementation, use proper JWT/HMAC signing"). Both links
   now open the order itself, where the real, sealed approval ceremony lives
   (`OrdersNext.tsx`).

Every case here fails against the pre-fix tree.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.notification_agent import NotificationAgent


def _make_agent():
    agent = NotificationAgent.__new__(NotificationAgent)
    agent.agent_name = "test_notification"
    agent.logger = MagicMock()
    agent.mock_mode = True
    agent.config = {"mock_mode": True}
    agent.sms_client = MagicMock()
    agent.sms_client.send_sms = AsyncMock(return_value={"success": True})
    agent.sms_client.send_sms_with_action_buttons = AsyncMock(
        return_value={"success": True}
    )
    agent.email_client = MagicMock()
    agent.email_client.send_template_email = AsyncMock(return_value={"success": True})
    agent.push_service = MagicMock()
    agent.push_service.send_approval_notification = AsyncMock(
        return_value={"success": True}
    )
    agent.push_service.send_push_notification = AsyncMock(
        return_value={"success": True}
    )
    return agent


MANAGER = {
    "id": "mgr-1",
    "name": "Ada",
    "phone": "+15551234567",
    "email": "ada@example.com",
}


class TestGetBaseUrl:
    def test_reads_frontend_url_from_settings(self, monkeypatch):
        monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()
        assert agent._get_base_url() == "https://mudavym.com"
        get_settings.cache_clear()

    def test_never_the_dead_domain(self, monkeypatch):
        monkeypatch.delenv("FRONTEND_URL", raising=False)
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()
        assert agent._get_base_url() != "https://app.wineops.ai"
        get_settings.cache_clear()


class TestOrderApprovalLinks:
    @pytest.mark.asyncio
    async def test_approve_and_reject_open_the_order_with_no_token_scheme(
        self, monkeypatch
    ):
        monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()

        with (
            patch.object(
                agent, "_get_manager_for_restaurant", AsyncMock(return_value=MANAGER)
            ),
            patch.object(
                agent,
                "_get_notification_preferences",
                AsyncMock(return_value={"order_approval_channels": ["push"]}),
            ),
            patch.object(
                agent,
                "_push_targets",
                AsyncMock(return_value=[{"subscription_data": {}, "type": "web_push"}]),
            ),
            patch.object(agent, "_log_notification", AsyncMock()),
        ):
            await agent.send_order_approval_request(
                {
                    "order_id": "ord-9",
                    "wine_name": "Barolo",
                    "quantity": 6,
                    "provider_name": "Anadolu",
                    "final_price": 40.0,
                    "restaurant_id": "rest-A",
                }
            )

        kwargs = agent.push_service.send_approval_notification.call_args.kwargs
        assert kwargs["approve_url"] == "https://mudavym.com/orders/ord-9"
        assert kwargs["reject_url"] == "https://mudavym.com/orders/ord-9"
        # The dead one-tap scheme this replaced.
        assert "/api/orders/" not in kwargs["approve_url"]
        assert "token=" not in kwargs["approve_url"]
        assert "action=" not in kwargs["approve_url"]

        get_settings.cache_clear()

    @pytest.mark.asyncio
    async def test_sms_carries_no_truncated_url_fragment(self, monkeypatch):
        """
        `sms_body` used to end with `f"Approve: {approve_url[:40]}..."` — a
        cut-off, untappable half-link printed ABOVE the full one
        `send_sms_with_action_buttons` appends. The full
        link's own honesty (one line, not two identical "Approve"/"Reject"
        lines) is pinned separately in `test_plivo_client_links.py`.
        """
        monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()

        with (
            patch.object(
                agent, "_get_manager_for_restaurant", AsyncMock(return_value=MANAGER)
            ),
            patch.object(
                agent,
                "_get_notification_preferences",
                AsyncMock(return_value={"order_approval_channels": ["sms"]}),
            ),
            patch.object(agent, "_push_targets", AsyncMock(return_value=[])),
            patch.object(agent, "_log_notification", AsyncMock()),
        ):
            await agent.send_order_approval_request(
                {
                    "order_id": "ord-9",
                    "wine_name": "Barolo",
                    "quantity": 6,
                    "provider_name": "Anadolu",
                    "final_price": 40.0,
                    "restaurant_id": "rest-A",
                }
            )

        kwargs = agent.sms_client.send_sms_with_action_buttons.call_args.kwargs
        assert "..." not in kwargs["message"]
        assert "Approve:" not in kwargs["message"]
        assert (
            kwargs["approve_url"]
            == kwargs["reject_url"]
            == "https://mudavym.com/orders/ord-9"
        )

        get_settings.cache_clear()


class TestDeliveryConfirmationLink:
    @pytest.mark.asyncio
    async def test_sms_body_carries_the_real_domain_and_the_order(self, monkeypatch):
        monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()

        with (
            patch.object(
                agent, "_get_manager_for_restaurant", AsyncMock(return_value=MANAGER)
            ),
            patch.object(
                agent,
                "_get_notification_preferences",
                AsyncMock(return_value={}),
            ),
            patch.object(agent, "_select_channels", AsyncMock(return_value=["sms"])),
            patch.object(agent, "_push_targets", AsyncMock(return_value=[])),
            patch.object(agent, "_log_notification", AsyncMock()),
        ):
            await agent.send_delivery_confirmation_request(
                {
                    "order_id": "ord-9",
                    "wine_name": "Barolo",
                    "provider_name": "Anadolu",
                    "quantity": 6,
                    "restaurant_id": "rest-A",
                }
            )

        body = agent.sms_client.send_sms.call_args.args[1]
        assert "https://mudavym.com/orders/ord-9" in body
        assert "app.wineops.ai" not in body

        get_settings.cache_clear()

    @pytest.mark.asyncio
    async def test_email_confirm_url_carries_no_unread_action_param(self, monkeypatch):
        """Nothing in apps/web reads `action`, so the
        confirm-delivery email CTA no longer appends `?action=confirm` --
        same class as TestNegotiationCompleteLinks's `?action=approve` fix."""
        monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()

        with (
            patch.object(
                agent, "_get_manager_for_restaurant", AsyncMock(return_value=MANAGER)
            ),
            patch.object(
                agent,
                "_get_notification_preferences",
                AsyncMock(return_value={}),
            ),
            patch.object(agent, "_select_channels", AsyncMock(return_value=["email"])),
            patch.object(agent, "_push_targets", AsyncMock(return_value=[])),
            patch.object(agent, "_log_notification", AsyncMock()),
        ):
            await agent.send_delivery_confirmation_request(
                {
                    "order_id": "ord-9",
                    "wine_name": "Barolo",
                    "provider_name": "Anadolu",
                    "quantity": 6,
                    "restaurant_id": "rest-A",
                }
            )

        email_kwargs = agent.email_client.send_template_email.call_args.kwargs
        confirm_url = email_kwargs["template_data"]["confirm_url"]
        assert confirm_url == "https://mudavym.com/orders/ord-9"
        assert "action=" not in confirm_url

        get_settings.cache_clear()


class TestNegotiationCompleteLinks:
    """
    `send_negotiation_complete_notification` still offered three push
    buttons ("Approve"/"Reject"/"View Details") after sw.js was rewritten to
    route on `data.order_id` alone -- all three resolved to the identical
    `/orders/<id>`, the same one-tap dishonesty M5
    removed from `send_order_approval_request`'s push, 80 lines above this
    one in the same file. The email CTA carried an unread `?action=approve`
    too (the leftover half of the original review's M2).
    """

    @pytest.mark.asyncio
    async def test_push_offers_one_honest_action_not_three(self, monkeypatch):
        monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()

        with (
            patch.object(
                agent, "_get_manager_for_restaurant", AsyncMock(return_value=MANAGER)
            ),
            patch.object(
                agent, "_get_notification_preferences", AsyncMock(return_value={})
            ),
            patch.object(agent, "_select_channels", AsyncMock(return_value=["push"])),
            patch.object(
                agent,
                "_push_targets",
                AsyncMock(return_value=[{"subscription_data": {}, "type": "web_push"}]),
            ),
            patch.object(agent, "_log_notification", AsyncMock()),
        ):
            await agent.send_negotiation_complete_notification(
                {
                    "order_id": "ord-9",
                    "wine_name": "Barolo",
                    "provider_name": "Anadolu",
                    "negotiated_price": 38.0,
                    "target_price": 40.0,
                    "restaurant_id": "rest-A",
                }
            )

        kwargs = agent.push_service.send_push_notification.call_args.kwargs
        actions = kwargs["actions"]
        assert len(actions) == 1
        assert actions[0]["action"] == "open"
        labels = {a["title"] for a in actions}
        assert "Approve" not in labels
        assert "Reject" not in labels
        assert "View Details" not in labels
        assert kwargs["data"]["order_id"] == "ord-9"

        get_settings.cache_clear()

    @pytest.mark.asyncio
    async def test_email_cta_carries_no_unread_action_param(self, monkeypatch):
        monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()

        with (
            patch.object(
                agent, "_get_manager_for_restaurant", AsyncMock(return_value=MANAGER)
            ),
            patch.object(
                agent, "_get_notification_preferences", AsyncMock(return_value={})
            ),
            patch.object(agent, "_select_channels", AsyncMock(return_value=["email"])),
            patch.object(agent, "_push_targets", AsyncMock(return_value=[])),
            patch.object(agent, "_log_notification", AsyncMock()),
        ):
            await agent.send_negotiation_complete_notification(
                {
                    "order_id": "ord-9",
                    "wine_name": "Barolo",
                    "provider_name": "Anadolu",
                    "negotiated_price": 38.0,
                    "target_price": 40.0,
                    "restaurant_id": "rest-A",
                }
            )

        email_kwargs = agent.email_client.send_template_email.call_args.kwargs
        approve_url = email_kwargs["template_data"]["approve_url"]
        assert approve_url == "https://mudavym.com/orders/ord-9"
        assert "action=" not in approve_url

        get_settings.cache_clear()


class TestPathMappings:
    """`/alerts`, `/dashboard`, `/audit` are not routes (App.tsx) — the
    nearest real pages are `/notifications`, `/`, `/logs`."""

    @pytest.mark.asyncio
    async def test_high_priority_alert_sms_uses_notifications_not_alerts(
        self, monkeypatch
    ):
        monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()

        with (
            patch.object(
                agent, "_get_manager_for_restaurant", AsyncMock(return_value=MANAGER)
            ),
            patch.object(agent, "_push_targets", AsyncMock(return_value=[])),
            patch.object(agent, "_log_notification", AsyncMock()),
        ):
            await agent.send_high_priority_alert(
                {
                    "restaurant_id": "rest-A",
                    "title": "Anomaly",
                    "message": "Something odd.",
                }
            )

        body = agent.sms_client.send_sms.call_args.args[1]
        assert "/notifications" in body
        assert "/alerts" not in body

        email_kwargs = agent.email_client.send_template_email.call_args.kwargs
        assert email_kwargs["template_data"]["dashboard_url"] == "https://mudavym.com/"

        get_settings.cache_clear()

    @pytest.mark.asyncio
    async def test_fraud_alert_uses_logs_not_audit(self, monkeypatch):
        monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
        from config.settings import get_settings

        get_settings.cache_clear()
        agent = _make_agent()

        with (
            patch.object(
                agent, "_get_manager_for_restaurant", AsyncMock(return_value=MANAGER)
            ),
            patch.object(agent, "_push_targets", AsyncMock(return_value=[])),
            patch.object(agent, "_log_notification", AsyncMock()),
        ):
            await agent.send_fraud_alert(
                {
                    "restaurant_id": "rest-A",
                    "details": "Suspicious.",
                    "entity": "Vendor X",
                }
            )

        body = agent.sms_client.send_sms.call_args.args[1]
        assert "/logs" in body
        assert "/audit" not in body

        email_kwargs = agent.email_client.send_template_email.call_args.kwargs
        assert email_kwargs["template_data"]["audit_url"] == "https://mudavym.com/logs"

        get_settings.cache_clear()
