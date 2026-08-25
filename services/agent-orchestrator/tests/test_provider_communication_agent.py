"""
Behavioral contract tests for ProviderCommunicationAgent (Phase 32).
Uses in-process mocks — no real Supabase, no real Redis, no real RabbitMQ.

Tests:
  10 original behavioral contracts (Tasks 1-3)
  3 auto-send gate tests (Task 4 / OUTBOUND-08)
  = 13 total
"""

from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.supabase = MagicMock()

    # providers.select chain (for _build_context_window)
    providers_chain = MagicMock()
    providers_chain.execute.return_value = MagicMock(
        data=[
            {
                "name": "Burgundy Imports",
                "contact_email": "test@example.com",
                "profile_foundational": {},
                "profile_dynamic": {},
                "close_relationship": False,
                "relationship_health_score": 0.75,
                "ai_personality_notes": "",
            }
        ]
    )
    db.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value = (
        providers_chain
    )

    # procurement_conversations.insert chain
    conv_insert_chain = MagicMock()
    conv_insert_chain.execute.return_value = MagicMock(data=[{"id": "conv-uuid-1234"}])
    db.supabase.table.return_value.insert.return_value = conv_insert_chain

    # negotiation_facts / rolling_summary chains (empty by default)
    facts_chain = MagicMock()
    facts_chain.execute.return_value = MagicMock(data=[])
    db.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.limit.return_value = (
        facts_chain
    )

    return db


@pytest.fixture
def mock_redis():
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)  # under cap
    redis.set = AsyncMock(return_value=True)  # lock acquired
    mock_pipe = AsyncMock()
    mock_pipe.incr = MagicMock()
    mock_pipe.expire = MagicMock()
    mock_pipe.execute = AsyncMock(return_value=[1, True])
    redis.pipeline.return_value = mock_pipe
    return redis


@pytest.fixture
def agent(mock_db, mock_redis):
    from agents.provider_communication_agent import ProviderCommunicationAgent

    a = ProviderCommunicationAgent(
        message_bus=AsyncMock(),
        database=mock_db,
        redis_client=mock_redis,
    )
    a.haiku_semaphore = asyncio.Semaphore(1)
    a.logger = MagicMock()
    return a


# ──────────────────────────────────────────────────────────────────────────────
# Tests 1-2: Email type selection (D-32-02)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_email_type_selection_price_inquiry_when_no_target_price(agent):
    payload = {
        "order_id": "ord1",
        "restaurant_id": "rest1",
        "provider_id": "prov1",
        "wine_name": "Burgundy",
        "quantity": 4,
        "target_price_per_bottle": None,
    }
    assert agent._select_email_type(payload) == "PRICE_INQUIRY"


@pytest.mark.asyncio
async def test_email_type_selection_demand_offer_when_price_set(agent):
    payload = {
        "order_id": "ord1",
        "restaurant_id": "rest1",
        "provider_id": "prov1",
        "wine_name": "Burgundy",
        "quantity": 4,
        "target_price_per_bottle": 45.00,
    }
    assert agent._select_email_type(payload) == "DEMAND_OFFER"


# ──────────────────────────────────────────────────────────────────────────────
# Tests 3-4: PII sensitivity classifier (GAP-1 / C-21)
# ──────────────────────────────────────────────────────────────────────────────


def test_classify_message_sensitivity_detects_ssn(agent):
    assert agent._classify_message_sensitivity("SSN 123-45-6789") is True


def test_classify_message_sensitivity_clean_text_passes(agent):
    assert (
        agent._classify_message_sensitivity("We are interested in 4 cases of Pommard")
        is False
    )


# ──────────────────────────────────────────────────────────────────────────────
# Tests 5-6: Daily rate limit (D-32-04)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_daily_rate_limit_blocks_at_cap(agent, mock_redis):
    mock_redis.get = AsyncMock(return_value="50")  # at cap
    key = "negotiation_draft:rest1:day"
    blocked = await agent._check_and_increment_rate_limit(key, 50)
    assert blocked is True


@pytest.mark.asyncio
async def test_daily_rate_limit_allows_under_cap(agent, mock_redis):
    mock_redis.get = AsyncMock(return_value="10")  # under cap
    key = "negotiation_draft:rest1:day"
    blocked = await agent._check_and_increment_rate_limit(key, 50)
    assert blocked is False


# ──────────────────────────────────────────────────────────────────────────────
# Tests 7-8: Draft lock mutex (D-32-04 / T-32-03-03)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_draft_lock_acquired_when_redis_returns_true(agent, mock_redis):
    mock_redis.set = AsyncMock(return_value=True)
    acquired = await agent._acquire_draft_lock("draft_lock:ord1")
    assert acquired is True


@pytest.mark.asyncio
async def test_draft_lock_fails_when_already_held(agent, mock_redis):
    mock_redis.set = AsyncMock(return_value=None)  # NX failed — lock held
    acquired = await agent._acquire_draft_lock("draft_lock:ord1")
    assert acquired is False


# ──────────────────────────────────────────────────────────────────────────────
# Test 9: Token hard cap (TOKENBDGT-01)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_token_hard_cap_exceeded_triggers_notification(agent):
    payload = {
        "order_id": "ord1",
        "restaurant_id": "rest1",
        "provider_id": "prov1",
        "wine_name": "Burgundy",
        "quantity": 4,
        "target_price_per_bottle": None,
    }
    with patch.object(
        agent, "_build_context_window", return_value=("prompt", 9000)
    ), patch.object(agent, "_notify", new_callable=AsyncMock) as mock_notify:
        await agent._handle_order_created(payload)
        mock_notify.assert_called_once()
        call_kwargs = mock_notify.call_args[1]
        assert call_kwargs.get("metadata", {}).get("constraint") == "TOKENBDGT-01"


# ──────────────────────────────────────────────────────────────────────────────
# Test 10: Happy path — order.created → draft inserted → notification fired
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_order_created_generates_draft_and_notification(agent):
    """Full happy path: order.created → draft inserted → notification fired."""
    payload = {
        "order_id": "ord-1234",
        "restaurant_id": "rest-5678",
        "provider_id": "prov-9012",
        "wine_name": "Pommard 1er Cru",
        "quantity": 4,
        "target_price_per_bottle": None,
        "urgency": "normal",
        "provider_name": "Burgundy Imports",
        "restaurant_name": "La Belle Époque",
    }
    mock_haiku_response = MagicMock()
    mock_haiku_response.content = [
        MagicMock(
            text='{"subject": "Price Inquiry: Pommard", "body": "We are interested in 4 cases of wine."}'
        )
    ]
    mock_haiku_response.usage = MagicMock(input_tokens=400, output_tokens=80)

    # Ensure procurement_orders duplicate check returns empty (no duplicates)
    no_dup_chain = MagicMock()
    no_dup_chain.execute.return_value = MagicMock(data=[])
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.in_.return_value.neq.return_value.limit.return_value = (
        no_dup_chain
    )

    with patch(
        "agents.provider_communication_agent.get_haiku_client"
    ) as mock_hc, patch.object(
        agent, "_notify", new_callable=AsyncMock
    ) as mock_notify, patch.object(
        agent, "_check_auto_send_gate", new_callable=AsyncMock, return_value=False
    ):
        mock_hc.return_value.messages.create = AsyncMock(
            return_value=mock_haiku_response
        )
        await agent._handle_order_created(payload)
        # Notification fired for PENDING_APPROVAL path
        mock_notify.assert_called()
        # At least the draft_ready notification
        notification_types = [
            call[1].get("notification_type") for call in mock_notify.call_args_list
        ]
        assert "draft_ready" in notification_types


# ──────────────────────────────────────────────────────────────────────────────
# Tests 11-13: Auto-send gate (OUTBOUND-08 / D-32-07)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_auto_send_gate_returns_false_when_feature_flag_off(agent):
    """OUTBOUND-08: auto-send disabled → gate returns False → PENDING_APPROVAL."""
    # Feature flag OFF
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
        data={"auto_send_enabled": False}
    )
    result = await agent._check_auto_send_gate("rest1", "prov1")
    assert result is False


@pytest.mark.asyncio
async def test_auto_send_gate_returns_false_when_health_below_threshold(agent):
    """OUTBOUND-08: health < 0.80 → gate returns False regardless of other flags."""
    call_count = 0

    def mock_execute_for_call(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return MagicMock(data={"auto_send_enabled": True})
        return MagicMock(
            data={"relationship_health_score": 0.60, "auto_reply_enabled": True}
        )

    # Patch the terminal .execute() to alternate responses
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = (
        mock_execute_for_call
    )
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.side_effect = (
        mock_execute_for_call
    )

    result = await agent._check_auto_send_gate("rest1", "prov1")
    assert result is False


@pytest.mark.asyncio
async def test_auto_send_gate_returns_true_when_all_conditions_met(agent):
    """OUTBOUND-08: all 3 gates pass → True → status=AUTO_SENT."""
    call_count = 0

    def mock_execute_for_call(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return MagicMock(data={"auto_send_enabled": True})
        return MagicMock(
            data={"relationship_health_score": 0.90, "auto_reply_enabled": True}
        )

    agent.database.supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = (
        mock_execute_for_call
    )
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.side_effect = (
        mock_execute_for_call
    )

    result = await agent._check_auto_send_gate("rest1", "prov1")
    assert result is True


# ──────────────────────────────────────────────────────────────────────────────
# Tests 14-18: Message-bus wiring
#
# The agent owned procurement.order.created and could not consume it. Three
# independent breaks, any one of which alone made the RabbitMQ path dead:
#
#   1. __init__ did not accept the orchestrator's factory kwargs, so the agent
#      raised TypeError on instantiation and never subscribed to anything.
#   2. process_message read `_routing_key`; MessageBus injects `routing_key`, so
#      every message fell through to "Unhandled routing key" and was dropped.
#   3. Only the flat envelope was understood, while ProcurementAgent wraps its
#      payload under "payload".
#
# Only the HTTP fallback worked, and createOrder calls it AND publishes to
# RabbitMQ — so repairing (2) without a shared guard would have turned one dead
# path into two live ones drafting the same order twice.
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dispatches_on_the_routing_key_the_bus_actually_injects(agent):
    """MessageBus setdefaults `routing_key` onto the body — not `_routing_key`."""
    with patch.object(
        agent, "_handle_order_created", new_callable=AsyncMock
    ) as handler:
        await agent.process_message(
            {
                "routing_key": "procurement.order.created",
                "exchange": "procurement.events",
                "order_id": "ord-1",
                "restaurant_id": "rest-1",
                "provider_id": "prov-1",
            }
        )

    handler.assert_awaited_once()


@pytest.mark.asyncio
async def test_flat_nestjs_envelope_reaches_the_handler_intact(agent):
    """procurement.service.ts publishes draftPayload at the top level."""
    with patch.object(
        agent, "_handle_order_created", new_callable=AsyncMock
    ) as handler:
        await agent.process_message(
            {
                "routing_key": "procurement.order.created",
                "order_id": "ord-flat",
                "restaurant_id": "rest-1",
                "provider_id": "prov-1",
            }
        )

    assert handler.await_args[0][0]["order_id"] == "ord-flat"


@pytest.mark.asyncio
async def test_wrapped_procurement_agent_envelope_is_unwrapped(agent):
    """ProcurementAgent publishes {"event_type": ..., "payload": {...}}."""
    with patch.object(
        agent, "_handle_order_created", new_callable=AsyncMock
    ) as handler:
        await agent.process_message(
            {
                "routing_key": "procurement.order.created",
                "event_type": "ProcurementOrderCreated",
                "payload": {
                    "order_id": "ord-wrapped",
                    "restaurant_id": "rest-1",
                    "provider_id": "prov-1",
                },
            }
        )

    assert handler.await_args[0][0]["order_id"] == "ord-wrapped"


@pytest.mark.asyncio
async def test_unknown_routing_key_is_still_ignored(agent):
    """Reading the right key must not turn the agent into a catch-all."""
    with patch.object(
        agent, "_handle_order_created", new_callable=AsyncMock
    ) as handler:
        await agent.process_message(
            {"routing_key": "stock.threshold.breached", "order_id": "ord-1"}
        )

    handler.assert_not_awaited()


@pytest.mark.asyncio
async def test_http_and_rabbitmq_for_one_order_produce_one_draft(agent, mock_redis):
    """createOrder fires triggerDraftHttp AND publishes to RabbitMQ.

    The HTTP fallback calls _handle_order_created directly, past process_message's
    guard, so the per-order lock has to sit inside the handler and has to come
    before the rate-limit increment and the manager notification. SET NX PX is the
    race-safe primitive: it returns the key on first acquire and None thereafter.
    """
    acquired = []

    async def set_once(*args, **kwargs):
        if kwargs.get("nx") and acquired:
            return None
        acquired.append(1)
        return True

    mock_redis.set = AsyncMock(side_effect=set_once)

    payload = {
        "order_id": "ord-dup",
        "restaurant_id": "rest-1",
        "provider_id": "prov-1",
        "wine_name": "Pommard 1er Cru",
        "quantity": 4,
        "target_price_per_bottle": None,
    }
    # Same draft text as the happy-path test above: this asserts deduplication,
    # so the body has to be one the post-draft constraints already let through.
    mock_haiku_response = MagicMock()
    mock_haiku_response.content = [
        MagicMock(
            text='{"subject": "Price Inquiry: Pommard", "body": "We are interested in 4 cases of wine."}'
        )
    ]
    mock_haiku_response.usage = MagicMock(input_tokens=400, output_tokens=80)

    no_dup_chain = MagicMock()
    no_dup_chain.execute.return_value = MagicMock(data=[])
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.in_.return_value.neq.return_value.limit.return_value = (
        no_dup_chain
    )

    with patch(
        "agents.provider_communication_agent.get_haiku_client"
    ) as mock_hc, patch.object(
        agent, "_notify", new_callable=AsyncMock
    ) as mock_notify, patch.object(
        agent, "_check_auto_send_gate", new_callable=AsyncMock, return_value=False
    ), patch.object(
        agent,
        "_check_and_increment_rate_limit",
        new_callable=AsyncMock,
        return_value=False,
    ) as mock_rate_limit:
        mock_hc.return_value.messages.create = AsyncMock(
            return_value=mock_haiku_response
        )
        await agent._handle_order_created(payload)  # RabbitMQ delivery
        await agent._handle_order_created(payload)  # HTTP fallback, same order

    drafts_ready = [
        c
        for c in mock_notify.call_args_list
        if c[1].get("notification_type") == "draft_ready"
    ]
    assert len(drafts_ready) == 1, (
        "one order must notify the manager once; a second entry path must be "
        "stopped by the per-order lock before it drafts or notifies"
    )

    # Position, not just presence. The lock used to sit at step 6, behind the
    # rate-limit increment, the context build and the constraint checks — so a
    # second delivery still burned a slot off the restaurant's daily cap and could
    # fire a second constraint_triggered notification before reaching the lock.
    assert mock_rate_limit.await_count == 1, (
        "the per-order lock must come BEFORE the daily rate-limit increment, or a "
        "duplicate delivery double-counts the cap even when no second draft is sent"
    )
