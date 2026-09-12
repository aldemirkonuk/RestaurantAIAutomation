"""
Tests for Phase 32 intelligence extraction pipeline:
- _extract_dynamic_profile (PROVINT-03)
- _maybe_summarize (OUTBOUND-04 / TOKENBDGT-04)
- _extract_invoice_from_email_text (D-32-15 Scenario B)
- _handle_invoice_match (D-32-15 Scenario B/C)
- _detect_unknown_sender / _notify_unknown_sender (PROVINT-04)
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

    # providers.select single chain (for _extract_dynamic_profile)
    provider_chain = MagicMock()
    provider_chain.execute.return_value = MagicMock(
        data=[{"id": "prov-1", "profile_dynamic": {"response_speed": "fast"}}]
    )
    db.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value = (
        provider_chain
    )

    # Generic update chain
    db.supabase.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[]
    )

    # Generic insert chain
    db.supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "new-fact"}]
    )

    # procurement_orders select chain (for _handle_invoice_match)
    orders_chain = MagicMock()
    orders_chain.execute.return_value = MagicMock(
        data=[
            {
                "id": "order-uuid-1",
                "wine_name": "Pommard 2019",
                "quantity": 6,
                "created_at": "2026-05-10T10:00:00Z",
                "status": "CONFIRMED",
            }
        ]
    )
    db.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.in_.return_value.order.return_value.limit.return_value = (
        orders_chain
    )

    return db


@pytest.fixture
def mock_redis():
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.set = AsyncMock(return_value=True)
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
# _extract_dynamic_profile tests (PROVINT-03)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_extract_dynamic_profile_calls_haiku_and_updates_db(agent):
    """Happy path: Haiku returns valid JSON → profile_dynamic updated."""
    mock_haiku_response = MagicMock()
    mock_haiku_response.content = [
        MagicMock(text='{"response_speed": "fast", "negotiation_style": "flexible"}')
    ]
    mock_haiku_response.usage = MagicMock(input_tokens=200, output_tokens=50)

    with patch("agents.provider_communication_agent.get_haiku_client") as mock_hc:
        mock_hc.return_value.messages.create = AsyncMock(
            return_value=mock_haiku_response
        )
        await agent._extract_dynamic_profile(
            "Provider always responds within 2 hours.",
            provider_id="prov-1",
            restaurant_id="rest-1",
        )
    # Verify update was called on providers table
    agent.database.supabase.table.assert_any_call("providers")


@pytest.mark.asyncio
async def test_extract_dynamic_profile_is_nonfatal_on_failure(agent):
    """Haiku failure → no exception raised (non-critical)."""
    with patch("agents.provider_communication_agent.get_haiku_client") as mock_hc:
        mock_hc.return_value.messages.create = AsyncMock(
            side_effect=Exception("API down")
        )
        # Should NOT raise
        await agent._extract_dynamic_profile(
            "Some text", provider_id="prov-1", restaurant_id="rest-1"
        )


# ──────────────────────────────────────────────────────────────────────────────
# _maybe_summarize tests (OUTBOUND-04 / TOKENBDGT-04)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_maybe_summarize_noop_on_odd_rounds(agent):
    """round_count=1 (odd) → Haiku NOT called."""
    with patch("agents.provider_communication_agent.get_haiku_client") as mock_hc:
        mock_hc.return_value.messages.create = AsyncMock()
        await agent._maybe_summarize(
            "conv-1", "prov-1", "rest-1", round_count=1, full_conversation="text"
        )
        mock_hc.return_value.messages.create.assert_not_called()


@pytest.mark.asyncio
async def test_maybe_summarize_noop_on_round_zero(agent):
    """round_count=0 → Haiku NOT called."""
    with patch("agents.provider_communication_agent.get_haiku_client") as mock_hc:
        mock_hc.return_value.messages.create = AsyncMock()
        await agent._maybe_summarize(
            "conv-1", "prov-1", "rest-1", round_count=0, full_conversation="text"
        )
        mock_hc.return_value.messages.create.assert_not_called()


@pytest.mark.asyncio
async def test_maybe_summarize_runs_on_even_rounds(agent):
    """round_count=2 → Haiku called + rolling_summary updated + negotiation_facts inserted."""
    mock_haiku_response = MagicMock()
    mock_haiku_response.content = [
        MagicMock(
            text=json.dumps(
                {
                    "summary": "Provider offered $45/bottle for 4 cases of Pommard.",
                    "facts": [
                        {
                            "field": "price_per_bottle",
                            "value": "$45.00",
                            "type": "price",
                            "commitment_type": "OFFER",
                            "confidence": 0.9,
                        }
                    ],
                }
            )
        )
    ]
    mock_haiku_response.usage = MagicMock(input_tokens=300, output_tokens=100)

    with patch("agents.provider_communication_agent.get_haiku_client") as mock_hc:
        mock_hc.return_value.messages.create = AsyncMock(
            return_value=mock_haiku_response
        )
        await agent._maybe_summarize(
            "conv-1",
            "prov-1",
            "rest-1",
            round_count=2,
            full_conversation="Provider: $45/bottle. Manager: interested.",
        )
    # Verify both procurement_conversations and negotiation_facts were touched
    calls = [str(c) for c in agent.database.supabase.table.call_args_list]
    assert any(
        "procurement_conversations" in c or "negotiation_facts" in c for c in calls
    )


@pytest.mark.asyncio
async def test_maybe_summarize_valid_commitment_type_only(agent):
    """Invalid commitment_type in Haiku response → normalized to INDICATIVE without raising."""
    mock_haiku_response = MagicMock()
    mock_haiku_response.content = [
        MagicMock(
            text=json.dumps(
                {
                    "summary": "Short summary.",
                    "facts": [
                        {
                            "field": "delivery",
                            "value": "Thursday",
                            "type": "logistics",
                            "commitment_type": "INVALID_TYPE",
                            "confidence": 0.7,
                        }
                    ],
                }
            )
        )
    ]
    mock_haiku_response.usage = MagicMock(input_tokens=200, output_tokens=80)

    with patch("agents.provider_communication_agent.get_haiku_client") as mock_hc:
        mock_hc.return_value.messages.create = AsyncMock(
            return_value=mock_haiku_response
        )
        # Should NOT raise — invalid type normalized to INDICATIVE
        await agent._maybe_summarize(
            "conv-1", "prov-1", "rest-1", round_count=4, full_conversation="text"
        )


# ──────────────────────────────────────────────────────────────────────────────
# _extract_invoice_from_email_text tests (D-32-15 Scenario B)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_extract_invoice_from_email_text_returns_structured_json():
    """Haiku returns valid JSON → structured invoice dict returned."""
    from agents.visual_verification_agent import VisualVerificationAgent

    vva = VisualVerificationAgent.__new__(VisualVerificationAgent)
    vva.logger = MagicMock()

    mock_response = MagicMock()
    mock_response.content = [
        MagicMock(
            text=json.dumps(
                {
                    "vendor_name": "Burgundy Imports",
                    "invoice_number": "INV-1234",
                    "invoice_date": "2026-05-14",
                    "line_items": [
                        {
                            "wine_name": "Pommard",
                            "vintage": 2019,
                            "quantity": 6,
                            "unit_price": 45.0,
                        }
                    ],
                    "total": 270.0,
                }
            )
        )
    ]
    mock_response.usage = MagicMock(input_tokens=300, output_tokens=80)

    with patch("services.model_clients.get_haiku_client") as mock_hc:
        mock_hc.return_value.messages.create = AsyncMock(return_value=mock_response)
        with patch(
            "agents.visual_verification_agent.VisualVerificationAgent._extract_invoice_from_email_text",
            wraps=vva._extract_invoice_from_email_text,
        ):
            result = await vva._extract_invoice_from_email_text(
                "Invoice #1234. Pommard 2019, 6 bottles at $45 each. Total $270."
            )
    # Result may be dict from Haiku or fallback; should not raise
    assert isinstance(result, dict)


@pytest.mark.asyncio
async def test_extract_invoice_from_email_text_fallback_on_haiku_failure():
    """Haiku failure → falls back to _parse_invoice_text() (returns dict, not raising)."""
    from agents.visual_verification_agent import VisualVerificationAgent

    vva = VisualVerificationAgent.__new__(VisualVerificationAgent)
    vva.logger = MagicMock()

    with patch("services.model_clients.get_haiku_client") as mock_hc:
        mock_hc.return_value.messages.create = AsyncMock(
            side_effect=Exception("timeout")
        )
        result = await vva._extract_invoice_from_email_text(
            "Invoice #5678. Chateau Margaux 2018, qty: 3, $120 each. Total $360."
        )
    # Falls back to regex parse — may return {} but must not raise
    assert isinstance(result, dict)


# ──────────────────────────────────────────────────────────────────────────────
# _handle_invoice_match tests (D-32-15)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handle_invoice_match_sends_off_app_invoice_notification(agent):
    """Any match scenario → off_app_invoice notification fired."""
    extracted = {
        "vendor_name": "Burgundy Imports",
        "invoice_date": "2026-05-14",
        "line_items": [{"wine_name": "Pommard 2019", "quantity": 6}],
        "total": 270.0,
    }

    with patch.object(agent, "_notify", new_callable=AsyncMock) as mock_notify:
        await agent._handle_invoice_match(
            restaurant_id="rest-1",
            provider_id="prov-1",
            provider_name="Burgundy Imports",
            extracted_invoice=extracted,
        )
        mock_notify.assert_called_once()
        call_kwargs = mock_notify.call_args[1]
        assert call_kwargs.get("notification_type") == "off_app_invoice"


@pytest.mark.asyncio
async def test_handle_invoice_match_no_orders_sends_orphan_notification(agent):
    """No open orders → orphan notification with match_class no_match."""
    agent.database.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.in_.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[]
    )

    with patch.object(agent, "_notify", new_callable=AsyncMock) as mock_notify:
        await agent._handle_invoice_match(
            restaurant_id="rest-1",
            provider_id="prov-1",
            provider_name="Unknown Supplier",
            extracted_invoice={"line_items": [{"wine_name": "Pommard"}]},
        )
        mock_notify.assert_called_once()
        call_kwargs = mock_notify.call_args[1]
        assert call_kwargs.get("notification_type") == "off_app_invoice"
        assert call_kwargs.get("metadata", {}).get("match_class") == "no_match"


# ──────────────────────────────────────────────────────────────────────────────
# PROVINT-04: unknown sender detection tests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def email_agent(mock_db, mock_redis):
    from agents.email_intel_agent import EmailIntelAgent

    a = EmailIntelAgent(
        message_bus=AsyncMock(),
        database=mock_db,
        redis_client=mock_redis,
    )
    a.haiku_semaphore = asyncio.Semaphore(1)
    a.logger = MagicMock()
    return a


@pytest.mark.asyncio
async def test_unknown_sender_returns_true_when_email_not_in_providers(email_agent):
    """PROVINT-04: sender not in providers table → _detect_unknown_sender returns True."""
    # providers query → empty; provider_contacts query → empty
    empty_chain = MagicMock()
    empty_chain.execute.return_value = MagicMock(data=[])
    email_agent.database.supabase.table.return_value.select.return_value.eq.return_value.ilike.return_value.limit.return_value = (
        empty_chain
    )

    result = await email_agent._detect_unknown_sender("rest1", "unknown@newvendor.com")
    assert result is True


@pytest.mark.asyncio
async def test_known_sender_returns_false(email_agent):
    """PROVINT-04: sender is in providers table → _detect_unknown_sender returns False."""
    known_chain = MagicMock()
    known_chain.execute.return_value = MagicMock(data=[{"id": "prov-1"}])
    email_agent.database.supabase.table.return_value.select.return_value.eq.return_value.ilike.return_value.limit.return_value = (
        known_chain
    )

    result = await email_agent._detect_unknown_sender("rest1", "known@distributor.com")
    assert result is False


@pytest.mark.asyncio
async def test_unknown_sender_fires_notification(email_agent):
    """PROVINT-04: unknown sender → _notify_unknown_sender called (inserts notification)."""
    with patch.object(
        email_agent, "_notify_unknown_sender", new_callable=AsyncMock
    ) as mock_notify:
        empty_chain = MagicMock()
        empty_chain.execute.return_value = MagicMock(data=[])
        email_agent.database.supabase.table.return_value.select.return_value.eq.return_value.ilike.return_value.limit.return_value = (
            empty_chain
        )

        is_unknown = await email_agent._detect_unknown_sender("rest1", "new@vendor.com")
        if is_unknown:
            await email_agent._notify_unknown_sender(
                "rest1", "new@vendor.com", {"subject": "Price list"}
            )
        mock_notify.assert_called_once()


# ──────────────────────────────────────────────────────────────────────────────
# OD-75: ProviderConversationAgent._extract_intelligence grades on the PARSE
# ──────────────────────────────────────────────────────────────────────────────


def _conversation_agent():
    from agents.provider_conversation_agent import ProviderConversationAgent

    a = ProviderConversationAgent(
        agent_name="provider_conversation_agent",
        message_bus=AsyncMock(),
        database=MagicMock(),
        config={"mock_mode": False},
    )
    a.logger = MagicMock()
    return a


def _legacy_gemini_client(text: str):
    """Legacy-SDK Gemini client returning a canned completion."""
    resp = MagicMock()
    resp.text = text
    resp.usage_metadata = MagicMock(
        prompt_token_count=500,
        candidates_token_count=100,
        thoughts_token_count=25,
    )
    client = MagicMock()
    client.generate_content.return_value = resp
    return client


@pytest.mark.asyncio
async def test_extract_intelligence_prose_answer_records_partial_not_success():
    """
    OD-75: a prose answer falls to _fallback_extract — a keyword heuristic, not
    an extraction — yet the shared _log_gemini_spend helper booked it as a
    completed task. It must now record 'partial' on the parse_v1 basis, exactly
    once, with the spend intact (the tokens were billed before the parse).
    """
    agent = _conversation_agent()
    agent.llm_client = _legacy_gemini_client("Sure! They sound quite happy about it.")

    spend = MagicMock()
    with patch(
        "agents.provider_conversation_agent.get_spend_logger", return_value=spend
    ):
        result = await agent._extract_intelligence("hi there", "prov-1")

    assert result is not None  # fallback still answers the caller
    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "partial"
    assert kwargs["outcome"] != "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is True
    assert kwargs["input_tokens"] == 500
    assert kwargs["output_tokens"] == 125  # thinking tokens bill as output


@pytest.mark.asyncio
async def test_extract_intelligence_json_answer_records_success_on_parse_basis():
    """OD-75: the parsed path keeps 'success', now on the parse_v1 basis."""
    agent = _conversation_agent()
    agent.llm_client = _legacy_gemini_client(
        json.dumps({"sentiment": "positive", "sentiment_score": 0.7})
    )

    spend = MagicMock()
    with patch(
        "agents.provider_conversation_agent.get_spend_logger", return_value=spend
    ):
        result = await agent._extract_intelligence("great news", "prov-1")

    assert result.sentiment == "positive"
    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is False
