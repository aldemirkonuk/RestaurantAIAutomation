"""What an AI vendor letter is written from, and what happens when it cannot be.

Owner-quarter sim F-518: approveOrder publishes ``max_acceptable_price`` (the
house's walk-away price) and the whole payload went into the prompt as
CURRENT INTENT, beside the provider profile with the house's own read of the
vendor and ``providers.notes``. The model may repeat anything it is shown, and
a busy manager approving the draft can miss it. Only what the letter needs
reaches the prompt now, and what was left out is recorded on the draft.

F-519: when the model call failed, ``_generate_response`` returned the canned
"just checking in" note, and that was staged as the order's one letter. The
order-letter path now stages nothing and tells the manager.

No model is called: the client is a stub.

Run: cd services/agent-orchestrator && python -m pytest tests/test_letter_prompt_and_failure.py -q
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.provider_conversation_agent import (
    AuditEntry,
    DraftNotWritten,
    ProviderConversationAgent,
    vendor_facing_intent,
)

APPROVAL_PAYLOAD = {
    "intent_type": "order_inquiry",
    "order_id": "ord-1",
    "provider_id": "prov-1",
    "restaurant_id": "rest-1",
    "wine_name": "Barolo Cannubi",
    "quantity": 24,
    "target_price": 37.5,
    "max_acceptable_price": 41.25,
    "urgency": "normal",
    "channel_preference": "email",
}

TWIN = {
    "pricing": [
        {
            "label": "Price for Barolo",
            "subcategory": "price_point",
            "attributes": {"new_price": 38},
            "confidence": 0.42,
            "verified": False,
        }
    ],
    "relationship": [
        {
            "label": "leverage",
            "subcategory": "signal",
            "attributes": {"detail": "they are overstocked and desperate"},
            "confidence": 0.9,
            "verified": True,
        }
    ],
}


def _agent(llm):
    agent = object.__new__(ProviderConversationAgent)
    agent.logger = MagicMock()
    agent.mock_mode = False
    agent.llm_client = llm
    agent.llm_temperature = 0.3
    agent._log_gemini_spend = MagicMock()
    return agent


def _settings():
    return patch(
        "agents.provider_conversation_agent.Settings",
        return_value=MagicMock(prov_agent_level4_enabled=False),
    )


async def _generate(agent, **kw):
    with _settings():
        return await agent._generate_response(
            provider_id="prov-1",
            digital_twin=TWIN,
            style_profile={"formality": "semi-formal"},
            recent_messages=[],
            memories=[],
            intent=dict(APPROVAL_PAYLOAD),
            active_promos=[],
            restaurant_id="rest-1",
            **kw,
        )


# ─────────────────────────────────────────────────────────────────────────────
# F-518: only what the letter needs reaches the prompt
# ─────────────────────────────────────────────────────────────────────────────


class TestWhatThePromptHolds:
    async def test_no_walk_away_price_and_no_house_intel(self):
        llm = MagicMock()
        llm.generate_content.return_value = MagicMock(text="Dear Hasan, 24 please.")
        text, audit = await _generate(_agent(llm))
        prompt = llm.generate_content.call_args.args[0]
        assert text == "Dear Hasan, 24 please."
        assert "41.25" not in prompt
        assert "max_acceptable_price" not in prompt
        assert "desperate" not in prompt
        assert '"confidence"' not in prompt and '"verified"' not in prompt
        # What the letter needs is still there.
        assert "Barolo Cannubi" in prompt and "37.5" in prompt and "24" in prompt
        assert '"new_price": 38' in prompt

    async def test_what_was_left_out_is_recorded_with_why(self):
        llm = MagicMock()
        llm.generate_content.return_value = MagicMock(text="Dear Hasan")
        _, audit = await _generate(_agent(llm))
        why = {w["field"]: w["why"] for w in audit.withheld_from_prompt}
        assert "walk-away" in why["max_acceptable_price"]
        assert "profile.relationship" in why
        assert {"order_id", "provider_id", "restaurant_id"} <= set(why)
        assert "wine_name" not in why and "target_price" not in why
        assert audit.profile_data_used == ["pricing"]

    def test_unknown_fields_stay_out_by_default(self):
        kept, withheld = vendor_facing_intent(
            {"wine_name": "x", "internal_score": 9, "rel": 3}
        )
        assert kept == {"wine_name": "x"}
        assert [w["field"] for w in withheld] == ["internal_score", "rel"]

    async def test_the_record_travels_with_the_draft(self):
        agent = object.__new__(ProviderConversationAgent)
        agent.logger = MagicMock()
        agent.database = MagicMock()
        agent.database.supabase.rpc.return_value.execute.return_value = MagicMock(
            data={"id": "conv-1", "staged": True}
        )
        agent.publish = AsyncMock()
        agent._get_provider_name = AsyncMock(return_value="Cellar Co")
        agent.response_model = "m"
        session = MagicMock(session_id="s", session_type="negotiation", intent={})
        audit = AuditEntry(
            withheld_from_prompt=[{"field": "max_acceptable_price", "why": "w"}]
        )
        await agent._create_approval_request(
            session=session,
            message_text="Dear Hasan",
            provider_id="prov-1",
            restaurant_id="rest-1",
            audit=audit,
            order_id="ord-1",
            order_letter=True,
        )
        row = agent.database.supabase.rpc.call_args.args[1]["p_row"]
        assert row["constraint_flags"]["audit_trail"]["withheld_from_prompt"] == [
            {"field": "max_acceptable_price", "why": "w"}
        ]

    async def test_the_house_notes_on_a_vendor_are_not_credit_terms(self):
        agent = object.__new__(ProviderConversationAgent)
        agent.logger = MagicMock()
        agent.database = MagicMock()
        tables = {}

        def table(name):
            if name not in tables:
                chain = MagicMock()
                for m in (
                    "select",
                    "eq",
                    "in_",
                    "ilike",
                    "order",
                    "limit",
                    "maybe_single",
                ):
                    getattr(chain, m).return_value = chain
                chain.execute.return_value = MagicMock(data=[])
                tables[name] = chain
            return tables[name]

        agent.database.supabase.table.side_effect = table
        table("providers").execute.return_value = MagicMock(
            data={"notes": "pays late, push them hard", "close_relationship": True}
        )
        ctx = await agent._get_db_context_for_prompt("prov-1", "rest-1")
        assert "push them hard" not in ctx["credit_terms"]
        assert ctx["close_relationship"] is True
        assert all(
            "notes" not in str(c.args) for c in table("providers").select.call_args_list
        )


# ─────────────────────────────────────────────────────────────────────────────
# F-519: a failed model call stages nothing
# ─────────────────────────────────────────────────────────────────────────────


class TestAFailedDraft:
    async def test_raises_instead_of_the_canned_note_when_asked(self):
        llm = MagicMock()
        llm.generate_content.side_effect = RuntimeError("quota")
        with pytest.raises(DraftNotWritten):
            await _generate(_agent(llm), canned_on_failure=False)

    async def test_other_callers_keep_their_stand_in(self):
        llm = MagicMock()
        llm.generate_content.side_effect = RuntimeError("quota")
        text, _ = await _generate(_agent(llm))
        assert text  # unchanged for outreach and onboarding

    async def test_the_order_letter_is_not_staged_and_the_manager_is_told(self):
        agent = object.__new__(ProviderConversationAgent)
        agent.logger = MagicMock()
        agent.database = MagicMock()
        read = agent.database.supabase.table.return_value.select.return_value
        for m in ("eq", "ilike", "in_", "limit"):
            getattr(read, m).return_value = read
        read.execute.return_value = MagicMock(data=[])
        agent.publish = AsyncMock()
        agent._get_provider_name = AsyncMock(return_value="Cellar Co")
        agent.memory_top_k = 3
        agent._session_semaphore = asyncio.Semaphore(1)
        session = MagicMock(
            session_id="s",
            session_type="negotiation",
            intent={},
            messages=[],
            context={},
        )
        agent._get_or_create_session = AsyncMock(return_value=session)
        agent._load_digital_twin = AsyncMock(return_value={})
        agent._load_style_profile = AsyncMock(return_value={})
        agent._search_conversation_memory = AsyncMock(return_value=[])
        agent._get_active_promos = AsyncMock(return_value=[])
        agent._generate_response = AsyncMock(side_effect=DraftNotWritten("quota"))
        agent._store_conversation_embedding = AsyncMock()
        agent._persist_session = AsyncMock()
        agent._notify_manager = AsyncMock()

        await agent._handle_procurement_intent(dict(APPROVAL_PAYLOAD))

        assert agent._generate_response.call_args.kwargs["canned_on_failure"] is False
        agent.database.supabase.rpc.assert_not_called()
        agent.database.supabase.table.return_value.insert.assert_not_called()
        agent._store_conversation_embedding.assert_not_awaited()
        agent._persist_session.assert_not_awaited()
        assert agent.publish.await_count == 0
        args = agent._notify_manager.call_args
        assert args.args[0] == "rest-1"
        assert args.args[2] == "The letter to Cellar Co could not be drafted"
        assert "nothing was sent" in args.args[3]
        assert "Barolo Cannubi" in args.args[3]
        assert args.kwargs["order_id"] == "ord-1"
