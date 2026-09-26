"""
The Plivo clients never hand Plivo a callback on someone else's domain (ADR 0224).

Both clients used to default their callbacks to ``https://your-domain.com/...``.
That is a real, third-party domain: a live SMS would have had Plivo POST the
message id, both numbers and the delivery status to it, and a live call would
have fetched its answer XML there and POSTed hangup and recording events to it.
``scripts/check_data_terms_name_every_host.py`` found the literal; these tests
pin the behaviour. Plivo is never contacted: its REST client is a MagicMock.
"""

from unittest.mock import MagicMock

import pytest

from services.plivo_client import PlivoSMSClient
from services.plivo_voice_client import PlivoVoiceClient


@pytest.mark.asyncio
async def test_a_live_sms_passes_plivo_no_status_callback():
    client = PlivoSMSClient(
        auth_id="a", auth_token="b", from_number="+15550001111", mock_mode=True
    )
    client.mock_mode = False
    client.client = MagicMock()
    client.client.messages.create.return_value = MagicMock(message_uuid=["m-1"])

    await client._send_via_plivo("+15551234567", "Order confirmed")

    kwargs = client.client.messages.create.call_args.kwargs
    assert "url" not in kwargs
    assert not any("your-domain.com" in str(v) for v in kwargs.values())


def test_the_voice_client_has_no_placeholder_webhook_default():
    client = PlivoVoiceClient(
        auth_id="a", auth_token="b", from_number="+15550001111", mock_mode=True
    )
    assert client.webhook_base_url is None


@pytest.mark.asyncio
async def test_a_live_call_without_our_own_webhook_base_is_refused_before_dialling():
    client = PlivoVoiceClient(
        auth_id="a", auth_token="b", from_number="+15550001111", mock_mode=True
    )
    client.mock_mode = False
    client.client = MagicMock()

    result = await client.make_call(to_number="+15559876543")

    assert result["success"] is False
    assert "webhook base URL" in result["error"]
    client.client.calls.create.assert_not_called()


@pytest.mark.asyncio
async def test_a_live_call_with_our_own_webhook_base_points_plivo_there():
    client = PlivoVoiceClient(
        auth_id="a",
        auth_token="b",
        from_number="+15550001111",
        webhook_base_url="https://api.mudavym.com/webhooks/plivo",
        mock_mode=True,
    )
    client.mock_mode = False
    client.client = MagicMock()
    client.client.calls.create.return_value = [MagicMock(request_uuid="c-1")]

    await client.make_call(to_number="+15559876543")

    kwargs = client.client.calls.create.call_args.kwargs
    for key in ("answer_url", "hangup_url", "fallback_url", "record_callback_url"):
        assert kwargs[key].startswith("https://api.mudavym.com/webhooks/plivo/")
