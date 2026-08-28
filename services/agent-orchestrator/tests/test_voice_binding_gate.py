"""
Voice binding gate — FUTURES §8.1.

Voice speaks a quantity and a price to a vendor and gathers "press 1 if you can
accommodate this order". That is outbound vendor communication that can form a
commitment, so it must be unreachable without (a) the capability flag, (b) a
recorded human approval for these exact terms, and (c) a constraint-engine pass.

These tests exercise the gate at the layer that enforces it — PlivoVoiceClient —
rather than at the (currently non-existent) caller, plus one test that the
procurement agent's broad `except Exception` does not swallow a refusal.

Plivo itself is never contacted: the client runs in mock_mode, and every gate
assertion fires before any dial path, mock or real.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from services.plivo_voice_client import (
    APPROVAL_MAX_AGE_SECONDS,
    VOICE_ORDER_CALLS_ENV,
    PlivoVoiceClient,
    VoiceBindingGateError,
    VoiceOrderApproval,
    is_order_acceptance_prompt,
    voice_order_calls_enabled,
)

ORDER_ID = "ord-1001"
WINE = "Barolo Riserva"
QTY = 6
PRICE = 25.0


@pytest.fixture(autouse=True)
def _clean_flag(monkeypatch):
    """Every test starts from the shipped default: capability OFF."""
    monkeypatch.delenv(VOICE_ORDER_CALLS_ENV, raising=False)


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv(VOICE_ORDER_CALLS_ENV, "true")


@pytest.fixture
def client():
    return PlivoVoiceClient(
        auth_id="test-auth-id",
        auth_token="test-auth-token",
        from_number="+15551230000",
        mock_mode=True,
    )


def approval(**overrides) -> VoiceOrderApproval:
    fields = {
        "approval_id": "appr-77",
        "order_id": ORDER_ID,
        "approved_by": "manager@restaurant.test",
        "approved_at": datetime.now(timezone.utc),
        "approved_quantity": QTY,
        "approved_unit_price": PRICE,
        "source": "procurement_orders.manager_approval_status",
    }
    fields.update(overrides)
    return VoiceOrderApproval(**fields)


def negotiate(client, **overrides):
    kwargs = {
        "wine_name": WINE,
        "quantity": QTY,
        "target_price": PRICE,
        "provider_name": "Acme Imports",
        "order_id": ORDER_ID,
        "order_approval": approval(),
    }
    kwargs.update(overrides)
    return client.generate_negotiation_xml(**kwargs)


# ──────────────────────────────────────────────────────────────────────────
# 1. Flag defaults to OFF
# ──────────────────────────────────────────────────────────────────────────


def test_flag_defaults_off():
    assert voice_order_calls_enabled() is False


@pytest.mark.parametrize("value", ["false", "0", "no", "", "  ", "maybe"])
def test_flag_only_explicit_truthy_enables(monkeypatch, value):
    monkeypatch.setenv(VOICE_ORDER_CALLS_ENV, value)
    assert voice_order_calls_enabled() is False


def test_negotiation_xml_refused_by_default_even_with_perfect_approval(client):
    """The capability is off out of the box: good evidence is not enough."""
    with pytest.raises(VoiceBindingGateError) as exc:
        negotiate(client)
    assert VOICE_ORDER_CALLS_ENV in str(exc.value)


@pytest.mark.asyncio
async def test_make_call_order_context_refused_by_default(client):
    with pytest.raises(VoiceBindingGateError) as exc:
        await client.make_call(
            to_number="+15559876543",
            context={"order_id": ORDER_ID, "quantity": QTY, "target_price": PRICE},
            order_approval=approval(),
        )
    assert VOICE_ORDER_CALLS_ENV in str(exc.value)


# ──────────────────────────────────────────────────────────────────────────
# 2. Missing / unusable approval evidence
# ──────────────────────────────────────────────────────────────────────────


def test_no_approval_raises(flag_on, client):
    with pytest.raises(VoiceBindingGateError, match="no recorded human approval"):
        negotiate(client, order_approval=None)


def test_wrong_type_approval_raises(flag_on, client):
    with pytest.raises(VoiceBindingGateError, match="must be a VoiceOrderApproval"):
        negotiate(client, order_approval={"approval_id": "appr-77"})


@pytest.mark.parametrize("field", ["approval_id", "approved_by", "source", "order_id"])
def test_blank_evidence_fields_raise(flag_on, client, field):
    with pytest.raises(VoiceBindingGateError, match="missing or blank"):
        negotiate(client, order_approval=approval(**{field: "   "}))


def test_stale_approval_raises(flag_on, client):
    old = datetime.now(timezone.utc) - timedelta(seconds=APPROVAL_MAX_AGE_SECONDS + 60)
    with pytest.raises(VoiceBindingGateError, match="stale"):
        negotiate(client, order_approval=approval(approved_at=old))


def test_future_dated_approval_raises(flag_on, client):
    ahead = datetime.now(timezone.utc) + timedelta(hours=2)
    with pytest.raises(VoiceBindingGateError, match="future"):
        negotiate(client, order_approval=approval(approved_at=ahead))


def test_approval_for_a_different_order_raises(flag_on, client):
    with pytest.raises(VoiceBindingGateError, match="is for order"):
        negotiate(client, order_approval=approval(order_id="ord-OTHER"))


def test_quantity_the_human_did_not_approve_raises(flag_on, client):
    with pytest.raises(VoiceBindingGateError, match="approved 6"):
        negotiate(client, quantity=60)


def test_price_the_human_did_not_approve_raises(flag_on, client):
    with pytest.raises(VoiceBindingGateError, match="unit price"):
        negotiate(client, target_price=48.0)


# ──────────────────────────────────────────────────────────────────────────
# 3. Constraint engine is genuinely consulted
# ──────────────────────────────────────────────────────────────────────────


def test_hard_constraint_violation_raises(flag_on, client):
    """C-19 three-tier compliance in the spoken text blocks the call."""
    with pytest.raises(VoiceBindingGateError, match="C-19"):
        negotiate(client, wine_name="Barolo direct-from-winery allocation")


def test_unapproved_dollar_figure_in_script_raises(flag_on, client):
    """
    Bypass attempt: skip generate_negotiation_xml and hand an order-acceptance
    script straight to generate_answer_xml, quoting a price nobody approved.
    """
    with pytest.raises(VoiceBindingGateError, match=r"\$99\.00"):
        client.generate_answer_xml(
            speak_text=(
                "Press 1 if you can accept this order for 6 bottles of wine "
                "at $99.00 per bottle."
            ),
            gather_input=True,
            order_approval=approval(),
        )


def test_answer_xml_order_acceptance_without_approval_raises(flag_on, client):
    with pytest.raises(VoiceBindingGateError, match="no recorded human approval"):
        client.generate_answer_xml(
            speak_text="Please press 1 if you can accommodate this order.",
            gather_input=True,
        )


# ──────────────────────────────────────────────────────────────────────────
# 4. Optional DB-backed verifier is an ADDITIONAL requirement
# ──────────────────────────────────────────────────────────────────────────


def test_verifier_rejection_raises(flag_on):
    client = PlivoVoiceClient(
        auth_id="a",
        auth_token="b",
        from_number="+15551230000",
        mock_mode=True,
        approval_verifier=lambda _appr: False,
    )
    with pytest.raises(VoiceBindingGateError, match="verifier rejected"):
        negotiate(client)


def test_verifier_blowing_up_fails_closed(flag_on):
    def boom(_appr):
        raise RuntimeError("supabase unreachable")

    client = PlivoVoiceClient(
        auth_id="a",
        auth_token="b",
        from_number="+15551230000",
        mock_mode=True,
        approval_verifier=boom,
    )
    with pytest.raises(VoiceBindingGateError, match="verifier failed"):
        negotiate(client)


# ──────────────────────────────────────────────────────────────────────────
# 5. Properly-evidenced calls pass
# ──────────────────────────────────────────────────────────────────────────


def test_fully_evidenced_negotiation_xml_passes(flag_on, client):
    xml = negotiate(client)
    assert "<GetDigits" in xml
    assert "press 1 if you can accommodate this order" in xml
    assert "$25.00 per bottle" in xml


@pytest.mark.asyncio
async def test_fully_evidenced_order_call_passes(flag_on, client):
    result = await client.make_call(
        to_number="+15559876543",
        context={
            "order_id": ORDER_ID,
            "wine_name": WINE,
            "quantity": QTY,
            "target_price": PRICE,
            "negotiation_type": "voice",
        },
        order_approval=approval(),
    )
    assert result["success"] is True
    assert result["call_uuid"]


# ──────────────────────────────────────────────────────────────────────────
# 6. Non-binding voice stays functional
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_non_binding_call_needs_no_approval(client):
    """Flag off, no approval — a reminder call must still work."""
    result = await client.make_call(
        to_number="+15559876543",
        context={"reason": "delivery_reminder", "restaurant_id": "rest-1"},
    )
    assert result["success"] is True


@pytest.mark.asyncio
async def test_call_with_no_context_needs_no_approval(client):
    result = await client.make_call(to_number="+15559876543")
    assert result["success"] is True


def test_non_binding_dtmf_menu_is_not_gated(client):
    """A plain alert menu is not an order acceptance channel."""
    xml = client.generate_answer_xml(
        speak_text="Your Barolo stock is low. Press 1 to acknowledge this alert.",
        gather_input=True,
    )
    assert "<GetDigits" in xml


def test_speak_only_xml_is_not_gated(client):
    xml = client.generate_answer_xml(speak_text="Your delivery arrives Tuesday.")
    assert "<Speak>" in xml


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Please press 1 if you can accommodate this order.", True),
        ("Press 2 to confirm the order quantity.", True),
        ("Press 1 to acknowledge this alert.", False),
        ("Your delivery arrives Tuesday.", False),
        ("", False),
    ],
)
def test_order_acceptance_detection(text, expected):
    assert is_order_acceptance_prompt(text) is expected


# ──────────────────────────────────────────────────────────────────────────
# 7. The agent must not swallow a refusal
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_procurement_agent_does_not_swallow_gate_refusal(client):
    """
    `_initiate_voice_negotiation` wraps its body in a broad `except Exception`
    that returns None. A gate refusal must escape that — a near-miss on an
    unapproved vendor commitment cannot look like a transient failure.
    """
    from agents.procurement_agent import ProcurementAgent

    agent = ProcurementAgent.__new__(ProcurementAgent)
    agent.logger = MagicMock()
    agent.voice_client = client
    agent.database = MagicMock()
    agent.database.get_provider = AsyncMock(
        return_value={"name": "Acme Imports", "contact_phone": "+15559876543"}
    )

    with pytest.raises(VoiceBindingGateError):
        await agent._initiate_voice_negotiation(
            order_id=ORDER_ID,
            provider_id="prov-1",
            wine_name=WINE,
            quantity=QTY,
            target_price=PRICE,
            order_approval=approval(),  # good evidence, flag still off
        )

    # And no call was placed on the way out.
    assert client.get_active_calls() == {}
