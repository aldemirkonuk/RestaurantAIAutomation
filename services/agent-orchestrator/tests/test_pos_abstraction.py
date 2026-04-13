"""Tests for POS abstraction layer (POS-ABSTRACT)."""
import hashlib
import hmac
import json
from datetime import datetime, timezone
import pytest


def test_pos_event_validates_required_fields():
    from core.pos_provider import POSEvent
    event = POSEvent(
        event_type="ORDER_CLOSED",
        restaurant_guid="rest-123",
        timestamp=datetime.now(tz=timezone.utc),
        items=[{"name": "Chateau Margaux", "quantity": 1}],
        raw_payload={"guid": "order-abc"},
    )
    assert event.event_type == "ORDER_CLOSED"
    assert event.restaurant_guid == "rest-123"


def test_toast_adapter_is_pos_provider():
    from core.pos_provider import POSProvider
    from adapters.toast_adapter import ToastAdapter
    adapter = ToastAdapter(webhook_secret="test-secret")
    assert isinstance(adapter, POSProvider)


@pytest.mark.asyncio
async def test_toast_adapter_verify_webhook_invalid_signature():
    from adapters.toast_adapter import ToastAdapter
    adapter = ToastAdapter(webhook_secret="my-secret")
    raw = b'{"guid": "order-1"}'
    result = await adapter.verify_webhook(raw, signature="invalid-sig")
    assert result is False


@pytest.mark.asyncio
async def test_toast_adapter_verify_webhook_valid_signature():
    from adapters.toast_adapter import ToastAdapter
    secret = "my-webhook-secret"
    raw = b'{"guid": "order-1", "restaurantGuid": "rest-1"}'
    # Compute valid HMAC-SHA256
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    adapter = ToastAdapter(webhook_secret=secret)
    result = await adapter.verify_webhook(raw, signature=expected)
    assert result is True


@pytest.mark.asyncio
async def test_toast_adapter_normalize_event_returns_pos_event():
    from adapters.toast_adapter import ToastAdapter
    from core.pos_provider import POSEvent
    adapter = ToastAdapter(webhook_secret="test")
    raw = {
        "eventType": "ORDER_CLOSED",
        "restaurantGuid": "rest-abc",
        "createdDate": "2026-04-13T12:00:00Z",
        "order": {"guid": "order-xyz", "checks": []},
    }
    event = await adapter.normalize_event(raw)
    assert isinstance(event, POSEvent)
    assert event.event_type == "ORDER_CLOSED"
    assert event.restaurant_guid == "rest-abc"
    assert event.raw_payload == raw


@pytest.mark.asyncio
async def test_toast_adapter_normalize_event_handles_missing_fields():
    """normalize_event does not raise even if some Toast fields are absent."""
    from adapters.toast_adapter import ToastAdapter
    adapter = ToastAdapter(webhook_secret="test")
    raw = {"eventType": "TEST_EVENT"}  # Missing restaurantGuid, createdDate, etc.
    event = await adapter.normalize_event(raw)
    assert event.event_type == "TEST_EVENT"
    assert event.restaurant_guid == ""   # Default fallback
