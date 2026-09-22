"""
`send_sms_with_action_buttons` (plivo_client.py).

Before this pass it always appended two lines, "Approve: <url>" and
"Reject: <url>", promising two distinct one-tap acts. Every real caller
(notification_agent.py's `send_order_approval_request`) passes the SAME url
for both, since approval and rejection both happen behind the in-app
hold-to-approve ceremony — there is no one-tap approve or reject from
outside the app. Printing the identical link twice under two different
labels was the untruth; this pins the fix: one line when the two urls match,
the original two-line form preserved for a hypothetical caller that ever
passes two genuinely different links.
"""

from unittest.mock import AsyncMock, patch

import pytest

from services.plivo_client import PlivoSMSClient


def _client() -> PlivoSMSClient:
    return PlivoSMSClient(
        auth_id="test", auth_token="test", from_number="+15550001111", mock_mode=True
    )


@pytest.mark.asyncio
async def test_one_link_when_approve_and_reject_are_the_same_url():
    client = _client()
    result = await client.send_sms_with_action_buttons(
        to_number="+15551234567",
        message="Order needs review",
        approve_url="https://mudavym.com/orders/ord-9",
        reject_url="https://mudavym.com/orders/ord-9",
    )

    body = result["message"]
    assert body.count("https://mudavym.com/orders/ord-9") == 1
    assert "Approve:" not in body
    assert "Reject:" not in body
    assert "Open: https://mudavym.com/orders/ord-9" in body


@pytest.mark.asyncio
async def test_two_lines_preserved_for_two_genuinely_different_urls():
    client = _client()
    result = await client.send_sms_with_action_buttons(
        to_number="+15551234567",
        message="Order needs review",
        approve_url="https://mudavym.com/orders/ord-9?a=1",
        reject_url="https://mudavym.com/orders/ord-9?a=2",
    )

    body = result["message"]
    assert "✅ Approve: https://mudavym.com/orders/ord-9?a=1" in body
    assert "❌ Reject: https://mudavym.com/orders/ord-9?a=2" in body


@pytest.mark.asyncio
async def test_send_sms_called_with_the_composed_message():
    client = _client()
    with patch.object(
        client, "send_sms", AsyncMock(return_value={"success": True})
    ) as mocked:
        await client.send_sms_with_action_buttons(
            to_number="+15551234567",
            message="Order needs review",
            approve_url="https://mudavym.com/orders/ord-9",
            reject_url="https://mudavym.com/orders/ord-9",
        )
        args = mocked.call_args.args
        assert args[0] == "+15551234567"
        assert "Open: https://mudavym.com/orders/ord-9" in args[1]
