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
import json
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
    providers_chain.execute.return_value = MagicMock(data=[{
        "name": "Burgundy Imports",
        "contact_email": "test@example.com",
        "profile_foundational": {},
        "profile_dynamic": {},
        "close_relationship": False,
        "relationship_health_score": 0.75,
        "ai_personality_notes": "",
    }])
    db.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value = providers_chain

    # procurement_conversations.insert chain
    conv_insert_chain = MagicMock()
    conv_insert_chain.execute.return_value = MagicMock(data=[{"id": "conv-uuid-1234"}])
    db.supabase.table.return_value.insert.return_value = conv_insert_chain

    # negotiation_facts / rolling_summary chains (empty by default)
    facts_chain = MagicMock()
    facts_chain.execute.return_value = MagicMock(data=[])
    db.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.limit.return_value = facts_chain

    return db


@pytest.fixture
def mock_redis():
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)    # under cap
    redis.set = AsyncMock(return_value=True)    # lock acquired
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
        "order_id": "ord1", "restaurant_id": "rest1", "provider_id": "prov1",
        "wine_name": "Burgundy", "quantity": 4, "target_price_per_bottle": None,
    }
    assert agent._select_email_type(payload) == "PRICE_INQUIRY"


@pytest.mark.asyncio
async def test_email_type_selection_demand_offer_when_price_set(agent):
    payload = {
        "order_id": "ord1", "restaurant_id": "rest1", "provider_id": "prov1",
        "wine_name": "Burgundy", "quantity": 4, "target_price_per_bottle": 45.00,
    }
    assert agent._select_email_type(payload) == "DEMAND_OFFER"


# ──────────────────────────────────────────────────────────────────────────────
# Tests 3-4: PII sensitivity classifier (GAP-1 / C-21)
# ──────────────────────────────────────────────────────────────────────────────

def test_classify_message_sensitivity_detects_ssn(agent):
    assert agent._classify_message_sensitivity("SSN 123-45-6789") is True


def test_classify_message_sensitivity_clean_text_passes(agent):
    assert agent._classify_message_sensitivity("We are interested in 4 cases of Pommard") is False


# ──────────────────────────────────────────────────────────────────────────────
# Tests 5-6: Daily rate limit (D-32-04)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_daily_rate_limit_blocks_at_cap(agent, mock_redis):
    mock_redis.get = AsyncMock(return_value="50")   # at cap
    key = "negotiation_draft:rest1:day"
    blocked = await agent._check_and_increment_rate_limit(key, 50)
    assert blocked is True


@pytest.mark.asyncio
async def test_daily_rate_limit_allows_under_cap(agent, mock_redis):
    mock_redis.get = AsyncMock(return_value="10")   # under cap
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
    mock_redis.set = AsyncMock(return_value=None)   # NX failed — lock held
    acquired = await agent._acquire_draft_lock("draft_lock:ord1")
    assert acquired is False


# ──────────────────────────────────────────────────────────────────────────────
# Test 9: Token hard cap (TOKENBDGT-01)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_token_hard_cap_exceeded_triggers_notification(agent):
    payload = {
        "order_id": "ord1", "restaurant_id": "rest1", "provider_id": "prov1",
        "wine_name": "Burgundy", "quantity": 4, "target_price_per_bottle": None,
    }
    with patch.object(agent, "_build_context_window", return_value=("prompt", 9000)), \
         patch.object(agent, "_notify", new_callable=AsyncMock) as mock_notify:
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
        "order_id": "ord-1234", "restaurant_id": "rest-5678", "provider_id": "prov-9012",
        "wine_name": "Pommard 1er Cru", "quantity": 4, "target_price_per_bottle": None,
        "urgency": "normal", "provider_name": "Burgundy Imports",
        "restaurant_name": "La Belle Époque",
    }
    mock_haiku_response = MagicMock()
    mock_haiku_response.content = [MagicMock(
        text='{"subject": "Price Inquiry: Pommard", "body": "We are interested in 4 cases of wine."}'
    )]
    mock_haiku_response.usage = MagicMock(input_tokens=400, output_tokens=80)

    # Ensure procurement_orders duplicate check returns empty (no duplicates)
    no_dup_chain = MagicMock()
    no_dup_chain.execute.return_value = MagicMock(data=[])
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.in_.return_value.neq.return_value.limit.return_value = no_dup_chain

    with patch("agents.provider_communication_agent.get_haiku_client") as mock_hc, \
         patch.object(agent, "_notify", new_callable=AsyncMock) as mock_notify, \
         patch.object(agent, "_check_auto_send_gate", new_callable=AsyncMock, return_value=False):
        mock_hc.return_value.messages.create = AsyncMock(return_value=mock_haiku_response)
        await agent._handle_order_created(payload)
        # Notification fired for PENDING_APPROVAL path
        mock_notify.assert_called()
        # At least the draft_ready notification
        notification_types = [
            call[1].get("notification_type")
            for call in mock_notify.call_args_list
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
        return MagicMock(data={"relationship_health_score": 0.60, "auto_reply_enabled": True})

    # Patch the terminal .execute() to alternate responses
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = mock_execute_for_call
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.side_effect = mock_execute_for_call

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
        return MagicMock(data={"relationship_health_score": 0.90, "auto_reply_enabled": True})

    agent.database.supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = mock_execute_for_call
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.side_effect = mock_execute_for_call

    result = await agent._check_auto_send_gate("rest1", "prov1")
    assert result is True
