"""ADR 0266 / owner-quarter sim F-106 — an order's vendor letter is staged once.

Two agents used to stage a waiting letter for one order: the create-time
letter (ProviderCommunicationAgent) and the approval-time ``order_inquiry``
letter (ProviderConversationAgent). Both now go through the database door
``stage_order_letter`` (migration ``an_order_letter_is_staged_once``), which
writes nothing when the order already has a live outbound letter. The SQL is
proven against a Postgres built from every migration (ADR 0266's evidence);
these tests pin the Python side: each agent uses the door, and a refused
stage notifies nobody and sends nothing.

Run: cd services/agent-orchestrator && python -m pytest tests/test_one_letter_per_order.py -q
"""

from __future__ import annotations

import asyncio
import pathlib
import re
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.order_letter_door import (
    ORDER_LETTER_LIVE_STATUSES,
    OrderLetterDoorMissing,
    live_order_letter_id,
    stage_order_letter,
)

MIGRATIONS = pathlib.Path(__file__).resolve().parents[3] / "supabase" / "migrations"


def _migration_sql() -> str:
    files = sorted(MIGRATIONS.glob("*_an_order_letter_is_staged_once.sql"))
    assert len(files) == 1, files
    return files[0].read_text()


# ─────────────────────────────────────────────────────────────────────────────
# The door helper
# ─────────────────────────────────────────────────────────────────────────────


def _supabase_answering(data=None, raises=None):
    sb = MagicMock()
    if raises is not None:
        sb.rpc.return_value.execute.side_effect = raises
    else:
        sb.rpc.return_value.execute.return_value = MagicMock(data=data)
    return sb


def _door_keys() -> set:
    """The keys stage_order_letter writes; any other key is refused (22023)."""
    sql = _migration_sql()
    start = sql.index("WHERE k <> ALL (ARRAY[")
    return set(re.findall(r"'([a-z_]+)'", sql[start : sql.index("])", start)]))


def _letter_inserts(supabase):
    """Inserts that wrote a vendor letter (other tables share the mock)."""
    return [
        c.args[0]
        for c in supabase.table.return_value.insert.call_args_list
        if c.args and isinstance(c.args[0], dict) and "message_text" in c.args[0]
    ]


class TestTheDoor:
    def test_live_statuses_match_the_migration(self):
        sql = _migration_sql()
        start = sql.index("AND (c.status)::text IN (")
        block = sql[start : sql.index(")", sql.index("(", start + 25))]
        words = re.findall(r"'([A-Z_]+)'", block)
        assert set(words) == set(ORDER_LETTER_LIVE_STATUSES), words

    def test_staged_letter(self):
        sb = _supabase_answering({"id": "c-1", "staged": True})
        assert stage_order_letter(sb, {"order_id": "o"}) == ("c-1", True)
        sb.rpc.assert_called_once_with(
            "stage_order_letter", {"p_row": {"order_id": "o"}, "p_kind": None}
        )

    def test_refused_letter_names_the_existing_one(self):
        sb = _supabase_answering({"id": "c-0", "staged": False})
        assert stage_order_letter(sb, {}, "ORDER_REQUEST") == ("c-0", False)
        assert sb.rpc.call_args.args[1]["p_kind"] == "ORDER_REQUEST"

    def test_a_list_answer_is_read_too(self):
        sb = _supabase_answering([{"id": "c-1", "staged": True}])
        assert stage_order_letter(sb, {}) == ("c-1", True)

    @pytest.mark.parametrize("data", [None, {}, {"staged": True}, []])
    def test_no_id_is_never_reported_as_staged(self, data):
        with pytest.raises(RuntimeError):
            stage_order_letter(_supabase_answering(data), {})

    def test_missing_function_is_its_own_error(self):
        exc = Exception("PGRST202 Could not find the function")
        with pytest.raises(OrderLetterDoorMissing):
            stage_order_letter(_supabase_answering(raises=exc), {})

    def test_any_other_error_propagates(self):
        with pytest.raises(ValueError):
            stage_order_letter(_supabase_answering(raises=ValueError("boom")), {})

    def test_early_read_is_house_scoped_and_reads_live_statuses(self):
        sb = MagicMock()
        chain = sb.table.return_value.select.return_value
        chain.eq.return_value = chain
        chain.ilike.return_value = chain
        chain.in_.return_value = chain
        chain.limit.return_value = chain
        chain.execute.return_value = MagicMock(data=[{"id": "c-9"}])
        assert live_order_letter_id(sb, "rest-1", "ord-1") == "c-9"
        sb.table.assert_called_with("procurement_conversations")
        assert [c.args for c in chain.eq.call_args_list] == [
            ("restaurant_id", "rest-1"),
            ("order_id", "ord-1"),
        ]
        chain.in_.assert_called_with("status", list(ORDER_LETTER_LIVE_STATUSES))


# ─────────────────────────────────────────────────────────────────────────────
# The create-time letter (ProviderCommunicationAgent)
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def comm_agent():
    from agents.provider_communication_agent import ProviderCommunicationAgent

    db = MagicMock()
    db.supabase = MagicMock()
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
    facts_chain = MagicMock()
    facts_chain.execute.return_value = MagicMock(data=[])
    db.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.limit.return_value = (
        facts_chain
    )
    no_dup_chain = MagicMock()
    no_dup_chain.execute.return_value = MagicMock(data=[])
    db.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.in_.return_value.neq.return_value.limit.return_value = (
        no_dup_chain
    )
    db.supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "conv-plain"}]
    )

    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.set = AsyncMock(return_value=True)
    pipe = AsyncMock()
    pipe.incr = MagicMock()
    pipe.expire = MagicMock()
    pipe.execute = AsyncMock(return_value=[1, True])
    redis.pipeline.return_value = pipe

    a = ProviderCommunicationAgent(
        message_bus=AsyncMock(), database=db, redis_client=redis
    )
    a.haiku_semaphore = asyncio.Semaphore(1)
    a.logger = MagicMock()
    return a


ORDER = {
    "order_id": "ord-1",
    "restaurant_id": "rest-1",
    "provider_id": "prov-1",
    "wine_name": "Pommard 1er Cru",
    "quantity": 4,
    "target_price_per_bottle": None,
    "provider_name": "Burgundy Imports",
    "restaurant_name": "La Belle Époque",
}


async def _run_create_time(agent, *, auto_send=False):
    reply = MagicMock()
    reply.content = [
        MagicMock(
            text='{"subject": "Price Inquiry: Pommard", "body": "We are interested in 4 cases of wine."}'
        )
    ]
    reply.usage = MagicMock(input_tokens=400, output_tokens=80)
    with patch(
        "agents.provider_communication_agent.get_haiku_client"
    ) as hc, patch.object(
        agent, "_notify", new_callable=AsyncMock
    ) as notify, patch.object(
        agent, "_check_auto_send_gate", new_callable=AsyncMock, return_value=auto_send
    ):
        hc.return_value.messages.create = AsyncMock(return_value=reply)
        await agent._handle_order_created(dict(ORDER))
    return notify


class TestCreateTimeLetter:
    async def test_goes_through_the_door(self, comm_agent):
        comm_agent.database.supabase.rpc.return_value.execute.return_value = MagicMock(
            data={"id": "conv-1", "staged": True}
        )
        notify = await _run_create_time(comm_agent)
        name, args = comm_agent.database.supabase.rpc.call_args.args
        assert name == "stage_order_letter"
        assert args["p_kind"] is None
        assert args["p_row"]["order_id"] == "ord-1"
        assert args["p_row"]["status"] == "PENDING_APPROVAL"
        assert set(args["p_row"]) <= _door_keys(), set(args["p_row"]) - _door_keys()
        assert _letter_inserts(comm_agent.database.supabase) == []
        kinds = [c.kwargs.get("notification_type") for c in notify.call_args_list]
        assert "draft_ready" in kinds
        draft = [
            c
            for c in notify.call_args_list
            if c.kwargs.get("notification_type") == "draft_ready"
        ]
        assert draft[0].kwargs["metadata"]["conversation_id"] == "conv-1"

    async def test_a_letter_already_there_means_no_notice(self, comm_agent):
        comm_agent.database.supabase.rpc.return_value.execute.return_value = MagicMock(
            data={"id": "conv-0", "staged": False}
        )
        notify = await _run_create_time(comm_agent)
        kinds = [c.kwargs.get("notification_type") for c in notify.call_args_list]
        assert "draft_ready" not in kinds
        assert _letter_inserts(comm_agent.database.supabase) == []

    async def test_a_letter_already_there_means_no_auto_send(self, comm_agent):
        comm_agent.database.supabase.rpc.return_value.execute.return_value = MagicMock(
            data={"id": "conv-0", "staged": False}
        )
        await _run_create_time(comm_agent, auto_send=True)
        keys = [
            c.kwargs.get("routing_key")
            for c in comm_agent.message_bus.publish.call_args_list
        ]
        assert "provider.draft.auto_approved" not in keys

    async def test_before_the_migration_applies_the_letter_is_not_lost(
        self, comm_agent
    ):
        comm_agent.database.supabase.rpc.return_value.execute.side_effect = Exception(
            "PGRST202"
        )
        notify = await _run_create_time(comm_agent)
        assert len(_letter_inserts(comm_agent.database.supabase)) == 1
        draft = [
            c
            for c in notify.call_args_list
            if c.kwargs.get("notification_type") == "draft_ready"
        ]
        assert draft and draft[0].kwargs["metadata"]["conversation_id"] == "conv-plain"

    async def test_a_failed_stage_still_raises(self, comm_agent):
        comm_agent.database.supabase.rpc.return_value.execute.side_effect = ValueError(
            "db down"
        )
        with pytest.raises(ValueError):
            await _run_create_time(comm_agent)


# ─────────────────────────────────────────────────────────────────────────────
# The approval-time letter (ProviderConversationAgent)
# ─────────────────────────────────────────────────────────────────────────────


def _conv_agent(live_rows=(), rpc_data=None, rpc_raises=None):
    from agents.provider_conversation_agent import (
        AuditEntry,
        ProviderConversationAgent,
    )

    agent = object.__new__(ProviderConversationAgent)
    agent.logger = MagicMock()
    agent.database = MagicMock()
    sb = agent.database.supabase
    read = sb.table.return_value.select.return_value
    read.eq.return_value = read
    read.ilike.return_value = read
    read.in_.return_value = read
    read.limit.return_value = read
    read.execute.return_value = MagicMock(data=[{"id": r} for r in live_rows])
    if rpc_raises is not None:
        sb.rpc.return_value.execute.side_effect = rpc_raises
    else:
        sb.rpc.return_value.execute.return_value = MagicMock(
            data=rpc_data or {"id": "conv-b", "staged": True}
        )
    sb.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "conv-plain"}]
    )
    agent.publish = AsyncMock()
    agent._get_provider_name = AsyncMock(return_value="Cellar Co")
    agent.response_model = "test-model"
    agent.memory_top_k = 3
    agent._session_semaphore = asyncio.Semaphore(1)
    session = MagicMock(
        session_id="s-1", session_type="negotiation", intent={}, messages=[], context={}
    )
    agent._get_or_create_session = AsyncMock(return_value=session)
    agent._load_digital_twin = AsyncMock(return_value={})
    agent._load_style_profile = AsyncMock(return_value={})
    agent._search_conversation_memory = AsyncMock(return_value=[])
    agent._get_active_promos = AsyncMock(return_value=[])
    agent._generate_response = AsyncMock(return_value=("Dear vendor", AuditEntry()))
    agent._store_conversation_embedding = AsyncMock()
    agent._persist_session = AsyncMock()
    return agent, session


INTENT = {
    "intent_type": "order_inquiry",
    "order_id": "ord-1",
    "provider_id": "prov-1",
    "restaurant_id": "rest-1",
    "wine_name": "Pommard",
}


def _published_keys(agent):
    return [c.kwargs.get("routing_key") for c in agent.publish.call_args_list]


class TestApprovalTimeLetter:
    async def test_skips_before_any_model_call_when_a_letter_exists(self):
        agent, _ = _conv_agent(live_rows=["conv-a"])
        await agent._handle_procurement_intent(dict(INTENT))
        agent._get_or_create_session.assert_not_awaited()
        agent._generate_response.assert_not_awaited()
        agent.database.supabase.rpc.assert_not_called()
        assert agent.publish.await_count == 0

    async def test_stages_through_the_door_when_none_exists(self):
        agent, session = _conv_agent()
        await agent._handle_procurement_intent(dict(INTENT))
        name, args = agent.database.supabase.rpc.call_args.args
        assert name == "stage_order_letter"
        assert args["p_row"]["order_id"] == "ord-1"
        assert args["p_row"]["status"] == "PENDING_APPROVAL"
        assert set(args["p_row"]) <= _door_keys(), set(args["p_row"]) - _door_keys()
        assert _letter_inserts(agent.database.supabase) == []
        assert "conversation.approval_needed" in _published_keys(agent)
        assert session.context["pending_conversation_id"] == "conv-b"

    async def test_a_letter_landing_after_the_read_is_not_doubled(self):
        """The create-time letter can land between the early read and the
        write; the door finds it, and nobody is notified twice."""
        agent, session = _conv_agent(rpc_data={"id": "conv-a", "staged": False})
        await agent._handle_procurement_intent(dict(INTENT))
        assert "conversation.approval_needed" not in _published_keys(agent)
        agent._persist_session.assert_not_awaited()
        assert "pending_conversation_id" not in session.context

    async def test_an_unreadable_check_still_lets_the_door_decide(self):
        agent, _ = _conv_agent()
        read = agent.database.supabase.table.return_value.select.return_value
        read.execute.side_effect = RuntimeError("read failed")
        await agent._handle_procurement_intent(dict(INTENT))
        agent.database.supabase.rpc.assert_called_once()

    async def test_other_intents_keep_the_plain_insert(self):
        agent, _ = _conv_agent(live_rows=["conv-a"])
        await agent._handle_procurement_intent(
            {**INTENT, "intent_type": "negotiate_price"}
        )
        agent.database.supabase.rpc.assert_not_called()
        assert len(_letter_inserts(agent.database.supabase)) == 1

    async def test_before_the_migration_applies_the_letter_is_not_lost(self):
        agent, _ = _conv_agent(rpc_raises=Exception("PGRST202"))
        await agent._handle_procurement_intent(dict(INTENT))
        assert len(_letter_inserts(agent.database.supabase)) == 1
        assert "conversation.approval_needed" in _published_keys(agent)
