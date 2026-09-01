"""
RFQAgent tests.

Two concerns live here, in this order:

1. **The solicitation gate.** A ``stock.threshold.breached`` event used to walk
   ``_handle_low_stock`` → ``_initiate_rfq`` → ``_send_rfq_to_vendor`` and
   publish ``notification.send_sms`` / ``notification.send_email`` straight at
   ``vendor.contact_phone`` / ``vendor.contact_email`` — N outbound commercial
   contacts in the restaurant's name from one par crossing, with no human
   anywhere in the path. This is the second such path found; ``procurement_agent``
   was the first. These tests fail on the pre-fix agent.

2. **OD-75 outcome grading** on ``_parse_vendor_response`` (unchanged by the
   gate work — it is the inbound half, reacting to what a vendor already said).

Run: cd services/agent-orchestrator && python -m pytest tests/test_rfq_agent.py -v
"""

from types import SimpleNamespace
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.rfq_agent import (
    ACTION_FAMILY,
    ACTION_KIND,
    AUTONOMY_TIER,
    ONE_TAP_ACTION_TYPE,
    PROPOSAL_STATUS,
    RFQAgent,
    RFQSafetyError,
)

INV_ID = "inv-0001"
REST_ID = "rest-0001"

# The two routing keys that reach a vendor. Nothing on the origination path may
# publish either of them, ever.
VENDOR_CONTACT_KEYS = {
    "notification.send_sms",
    "notification.send_email",
}


# ---------------------------------------------------------------------------
# Supabase stub (same shape as tests/test_recurring_order_agent.py's _TableRouter)
# ---------------------------------------------------------------------------


class _TableRouter:
    """Routes supabase.table(name) to per-table chain mocks; records writes."""

    def __init__(self, tables: Dict[str, List[Dict[str, Any]]]):
        self.tables = {k: list(v) for k, v in tables.items()}
        self.inserts: Dict[str, List[Dict[str, Any]]] = {}
        self.updates: Dict[str, List[Dict[str, Any]]] = {}
        self.insert_should_fail: set = set()
        self._chains: Dict[str, MagicMock] = {}

    def table(self, name: str) -> MagicMock:
        if name not in self._chains:
            self._chains[name] = self._make_chain(name)
        return self._chains[name]

    def _make_chain(self, name: str) -> MagicMock:
        chain = MagicMock(name=f"chain:{name}")
        state: Dict[str, Any] = {
            "filters": {},
            "limit": None,
            "pending_insert": None,
            "pending_update": None,
        }

        def _reset():
            state["filters"] = {}
            state["limit"] = None
            state["pending_insert"] = None
            state["pending_update"] = None

        def select(*_a, **_k):
            return chain

        def eq(col, val):
            state["filters"][col] = val
            return chain

        def order(*_a, **_k):
            return chain

        def limit(n):
            state["limit"] = n
            return chain

        def insert(row):
            state["pending_insert"] = row
            return chain

        def update(row):
            state["pending_update"] = row
            return chain

        def execute():
            result = MagicMock()

            if state["pending_insert"] is not None:
                if name in self.insert_should_fail:
                    _reset()
                    raise RuntimeError(f"simulated insert failure on {name}")
                row = dict(state["pending_insert"])
                row.setdefault("id", f"{name}-id-{len(self.inserts.get(name, [])) + 1}")
                self.inserts.setdefault(name, []).append(row)
                self.tables.setdefault(name, []).append(row)
                result.data = [row]
                _reset()
                return result

            if state["pending_update"] is not None:
                patch_row = dict(state["pending_update"])
                patch_row["_filters"] = dict(state["filters"])
                self.updates.setdefault(name, []).append(patch_row)
                for row in self.tables.get(name, []):
                    if all(row.get(c) == v for c, v in state["filters"].items()):
                        row.update(state["pending_update"])
                result.data = []
                _reset()
                return result

            rows = [
                r
                for r in self.tables.get(name, [])
                if all(r.get(c) == v for c, v in state["filters"].items())
            ]
            if state["limit"] is not None:
                rows = rows[: state["limit"]]
            result.data = rows
            _reset()
            return result

        chain.select.side_effect = select
        chain.eq.side_effect = eq
        chain.order.side_effect = order
        chain.limit.side_effect = limit
        chain.insert.side_effect = insert
        chain.update.side_effect = update
        chain.execute.side_effect = execute
        return chain


def _base_tables() -> Dict[str, List[Dict[str, Any]]]:
    return {
        "one_tap_actions": [],
        "decision_log": [],
        # Deliberately present and deliberately expected to stay empty: an agent
        # that regains a send path would write an RFQ record here first.
        "rfq_requests": [],
    }


def _vendor(vid: str, name: str, rating: float = 4.0) -> SimpleNamespace:
    """A vendor with REAL-looking contact details, so a regression is visible."""
    return SimpleNamespace(
        id=vid,
        name=name,
        rating=rating,
        contact_phone=f"+1555000{vid[-4:]}",
        contact_email=f"{name.lower().replace(' ', '.')}@vendor.example",
    )


def _make_agent(
    inventory: Optional[Any] = None,
    vendors: Optional[List[SimpleNamespace]] = None,
    existing_rfqs: Optional[List[Any]] = None,
    tables: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    config: Optional[Dict[str, Any]] = None,
):
    router = _TableRouter(tables if tables is not None else _base_tables())

    db = MagicMock()
    db.supabase.table.side_effect = router.table

    db.inventory.get_by_id = AsyncMock(
        return_value=(
            SimpleNamespace(id=INV_ID, threshold_min=4, wine_name="Barolo Riserva")
            if inventory is None
            else inventory
        )
    )
    db.providers.get_active_providers = AsyncMock(
        return_value=(
            [_vendor("v-0001", "Vendor One", 4.9), _vendor("v-0002", "Vendor Two", 4.1)]
            if vendors is None
            else vendors
        )
    )
    db.rfq_requests.get_by_inventory = AsyncMock(
        return_value=existing_rfqs if existing_rfqs is not None else []
    )
    # The old execution path's record. Left on the mock on purpose: if it is ever
    # called again the assertions below say so by name.
    db.rfq_requests.create = AsyncMock(return_value=SimpleNamespace(id="rfq-1"))

    bus = AsyncMock()
    bus.publish = AsyncMock(return_value=True)

    # mock_mode=False is the realistic production posture, and is exactly the
    # setting under which the deleted `_send_rfq_to_vendor` used to send.
    agent = RFQAgent(
        agent_name="rfq_agent",
        message_bus=bus,
        database=db,
        config=config if config is not None else {"mock_mode": False},
    )
    agent.logger = MagicMock()
    return agent, router, bus, db


def _breach(**payload_overrides: Any) -> Dict[str, Any]:
    payload = {
        "inventory_id": INV_ID,
        "restaurant_id": REST_ID,
        "wine_name": "Barolo Riserva",
        "urgency": "urgent",
    }
    payload.update(payload_overrides)
    return {"routing_key": "stock.threshold.breached", "payload": payload}


def _published(bus: AsyncMock) -> List[Dict[str, Any]]:
    return [
        {
            "exchange": call.kwargs.get("exchange_name"),
            "routing_key": call.kwargs.get("routing_key"),
            "body": call.kwargs.get("message_body") or {},
        }
        for call in bus.publish.await_args_list
    ]


def _decisions(router: _TableRouter, decision_type: str) -> List[Dict[str, Any]]:
    return [
        r
        for r in router.inserts.get("decision_log", [])
        if r.get("decision_type") == decision_type
    ]


# ---------------------------------------------------------------------------
# 1. The gate: a par crossing cannot reach a vendor
# ---------------------------------------------------------------------------


class TestParCrossingCannotReachAVendor:
    async def test_threshold_breach_contacts_no_vendor_and_only_proposes(self):
        """
        THE REGRESSION TEST. Fails on the pre-fix agent with:

            AssertionError: a par crossing published vendor-contact keys:
            ['notification.send_sms', 'notification.send_email', ...]

        One `stock.threshold.breached` event, mock_mode off, two vendors with
        real phone numbers and email addresses on file.
        """
        agent, router, bus, db = _make_agent()

        await agent.process_message(_breach())

        keys = [p["routing_key"] for p in _published(bus)]

        # (a) No vendor is contacted, on either channel.
        contacted = [k for k in keys if k in VENDOR_CONTACT_KEYS]
        assert not contacted, f"a par crossing published vendor-contact keys: {keys}"

        # (b) The ONLY publish is the manager-facing proposal announcement.
        assert keys == ["notification.rfq_solicitation_proposed"], keys

        # (c) No RFQ record was created — that is the executor's job, after a tap.
        db.rfq_requests.create.assert_not_awaited()
        assert router.inserts.get("rfq_requests", []) == []

        # (d) Exactly one pending proposal was staged, unconfirmed.
        staged = router.inserts.get("one_tap_actions", [])
        assert len(staged) == 1
        row = staged[0]
        assert row["status"] == PROPOSAL_STATUS == "pending"
        assert row.get("executed_by") is None
        assert row.get("executed_at") is None
        assert row.get("execution_result") is None
        assert row["action_type"] == ONE_TAP_ACTION_TYPE
        assert row["metadata"]["action_family"] == ACTION_FAMILY
        assert row["metadata"]["action_kind"] == ACTION_KIND
        assert row["metadata"]["autonomy_tier"] == AUTONOMY_TIER == "propose_only"

    async def test_no_vendor_address_leaves_the_agent_at_all(self):
        """
        Stronger than "no send": no vendor phone number or email address appears
        in ANYTHING the agent published or wrote. A future path that leaked the
        address into a payload would be one string interpolation from a send.
        """
        vendors = [_vendor("v-0001", "Vendor One", 4.9), _vendor("v-0002", "Vendor Two")]
        agent, router, bus, _db = _make_agent(vendors=vendors)

        await agent.process_message(_breach())

        blob = repr(_published(bus)) + repr(router.inserts)
        for vendor in vendors:
            assert vendor.contact_phone not in blob
            assert vendor.contact_email not in blob

    async def test_the_send_capability_is_deleted_not_disabled(self):
        """
        The direct-action method is gone by name, along with the two wrappers
        that reached it. A flag that can be flipped back is not a gate.
        """
        for gone in ("_send_rfq_to_vendor", "_initiate_rfq", "initiate_rfq"):
            assert not hasattr(RFQAgent, gone), (
                f"{gone} is back on RFQAgent — the send capability must stay "
                "deleted, not disabled"
            )

        # And the module itself must never name the vendor-contact routing keys.
        import inspect

        import agents.rfq_agent as mod

        source = inspect.getsource(mod)
        for key in VENDOR_CONTACT_KEYS:
            # Allowed only inside a comment/docstring describing what was removed.
            live = [
                ln
                for ln in source.splitlines()
                if key in ln and "routing_key=" in ln
            ]
            assert not live, f"{key} is published again at: {live}"

    async def test_mock_mode_on_or_off_makes_no_difference(self):
        """
        `mock_mode` used to be the early return that made the ungated send look
        harmless. It must no longer gate anything on this path — the behaviour is
        identical either way.
        """
        for mock_mode in (True, False):
            agent, router, bus, _ = _make_agent(config={"mock_mode": mock_mode})
            await agent.process_message(_breach())
            keys = [p["routing_key"] for p in _published(bus)]
            assert keys == ["notification.rfq_solicitation_proposed"], (
                f"mock_mode={mock_mode} changed the outcome: {keys}"
            )
            assert len(router.inserts.get("one_tap_actions", [])) == 1

    async def test_every_proposal_writes_a_decision_log_row(self):
        agent, router, _bus, _db = _make_agent()

        await agent.process_message(_breach())

        rows = _decisions(router, "rfq_solicitation_proposal")
        assert len(rows) == 1
        output = rows[0]["output"]
        assert output["executed"] is False
        assert output["vendors_contacted"] == 0
        assert output["messages_sent"] == 0
        assert output["autonomy_tier"] == "propose_only"

    async def test_rfq_initiate_request_lands_on_the_same_proposal_path(self):
        """
        A message asserting someone wants an RFQ carries no executed_by. Treating
        it as consent is the substitution ACTION-SCHEMA-SPEC §4.1 rejects, so it
        takes the identical path. (This key has no producer in the repo today.)
        """
        agent, router, bus, _db = _make_agent()

        await agent.process_message(
            {
                "routing_key": "rfq.initiate_request",
                "payload": {
                    "inventory_id": INV_ID,
                    "restaurant_id": REST_ID,
                    "wine_name": "Barolo Riserva",
                },
            }
        )

        keys = [p["routing_key"] for p in _published(bus)]
        assert not [k for k in keys if k in VENDOR_CONTACT_KEYS], keys
        assert len(router.inserts.get("one_tap_actions", [])) == 1


# ---------------------------------------------------------------------------
# 2. The RFQ reasoning survives, and is side-effect free
# ---------------------------------------------------------------------------


class TestRfqPlanIsPure:
    async def test_building_a_plan_writes_nothing_and_publishes_nothing(self):
        """
        Requirement 3: the vendor selection, quantity and quote-request
        composition are preserved for the future hop-4 bridge as logic that
        structurally cannot act.
        """
        agent, router, bus, db = _make_agent()

        plan = await agent._build_rfq_plan(
            {
                "inventory_id": INV_ID,
                "restaurant_id": REST_ID,
                "wine_name": "Barolo Riserva",
                "urgency": "urgent",
            }
        )

        assert plan is not None
        # Nothing written, anywhere.
        assert router.inserts == {}
        assert router.updates == {}
        # Nothing published.
        bus.publish.assert_not_awaited()
        # No RFQ record.
        db.rfq_requests.create.assert_not_awaited()

    async def test_the_plan_preserves_the_rfq_reasoning(self):
        agent, _router, _bus, _db = _make_agent()

        plan = await agent._build_rfq_plan(
            {
                "inventory_id": INV_ID,
                "restaurant_id": REST_ID,
                "wine_name": "Barolo Riserva",
                "urgency": "urgent",
            }
        )

        # Quantity: max(threshold_min * 3, 12) — threshold_min is 4, so 12.
        assert plan["quantity"] == 12
        # Vendor selection: top N by rating, best first.
        assert [s["vendor_name"] for s in plan["solicitations"]] == [
            "Vendor One",
            "Vendor Two",
        ]
        assert plan["vendor_count"] == 2
        # Composition: urgency picked the urgent template, per vendor.
        for sol in plan["solicitations"]:
            assert sol["message"].startswith(f"Hi {sol['vendor_name']},")
            assert "urgently" in sol["message"]
            assert "12 bottles of Barolo Riserva" in sol["message"]
        # Channel availability travels; the addresses themselves do not.
        assert all(s["has_phone"] and s["has_email"] for s in plan["solicitations"])
        assert "contact_phone" not in repr(plan)
        assert "@vendor.example" not in repr(plan)

    async def test_quantity_and_template_track_the_inputs(self):
        """Bulk template above 24 bottles; standard when not urgent."""
        agent, _router, _bus, _db = _make_agent(
            inventory=SimpleNamespace(id=INV_ID, threshold_min=10, wine_name="Barolo")
        )

        plan = await agent._build_rfq_plan(
            {
                "inventory_id": INV_ID,
                "restaurant_id": REST_ID,
                "wine_name": "Barolo",
                "urgency": "normal",
            }
        )

        assert plan["quantity"] == 30  # 10 * 3
        assert "bulk order" in plan["solicitations"][0]["message"]


# ---------------------------------------------------------------------------
# 3. The enforcement point
# ---------------------------------------------------------------------------


class TestEnforcementPoint:
    async def test_refuses_a_preconfirmed_row(self):
        """
        `_emit_action_proposal` validates caller-supplied data, so it still fails
        on a future caller that reintroduces sending.
        """
        agent, _router, _bus, _db = _make_agent()

        for bad in (
            {"status": "executed"},
            {"status": PROPOSAL_STATUS, "executed_by": "user-1"},
            {"status": PROPOSAL_STATUS, "executed_at": "2026-09-01T00:00:00Z"},
            {"status": PROPOSAL_STATUS, "execution_result": {"ok": True}},
        ):
            row = {"restaurant_id": REST_ID, "action_type": ONE_TAP_ACTION_TYPE}
            row.update(bad)
            with pytest.raises(RFQSafetyError):
                await agent._emit_action_proposal(row)

    async def test_accepts_a_clean_pending_row(self):
        agent, router, _bus, _db = _make_agent()

        action_id = await agent._emit_action_proposal(
            {
                "restaurant_id": REST_ID,
                "action_type": ONE_TAP_ACTION_TYPE,
                "status": PROPOSAL_STATUS,
                "title": "t",
                "metadata": {"action_kind": ACTION_KIND},
            }
        )

        assert action_id
        assert len(router.inserts["one_tap_actions"]) == 1


# ---------------------------------------------------------------------------
# 4. Fail closed
# ---------------------------------------------------------------------------


class TestFailsClosed:
    async def test_when_the_proposal_cannot_be_staged_nothing_else_happens(self):
        """
        Requirement 4. Staging fails; the agent must NOT fall back to sending.
        """
        agent, router, bus, db = _make_agent()
        router.insert_should_fail.add("one_tap_actions")

        result = await agent._propose_rfq_solicitation(_breach())

        assert result is None
        # No vendor contacted, nothing published at all.
        assert _published(bus) == []
        db.rfq_requests.create.assert_not_awaited()
        # The refusal is recorded.
        blocked = _decisions(router, "rfq_solicitation_blocked")
        assert len(blocked) == 1
        assert blocked[0]["output"]["vendors_contacted"] == 0

    async def test_missing_inventory_proposes_nothing(self):
        agent, router, bus, _db = _make_agent(inventory=False)
        agent.database.inventory.get_by_id = AsyncMock(return_value=None)

        assert await agent._propose_rfq_solicitation(_breach()) is None
        assert router.inserts.get("one_tap_actions", []) == []
        assert _published(bus) == []

    async def test_no_vendors_proposes_nothing(self):
        agent, router, bus, _db = _make_agent(vendors=[])

        assert await agent._propose_rfq_solicitation(_breach()) is None
        assert router.inserts.get("one_tap_actions", []) == []
        assert _published(bus) == []

    async def test_commitment_language_in_a_template_fails_the_whole_plan(self):
        """
        The CI-enforced UCC guardrail (core/commitment_patterns.py, generated
        from the TypeScript canon). RFQ text is vendor-facing commercial
        language; a template edit that introduces binding language must fail
        closed rather than land a contract-forming sentence behind a one-tap
        approve button.
        """
        agent, router, bus, _db = _make_agent()
        # "place the order" is pattern #9 in the canon.
        agent.rfq_templates["urgent"] = (
            "Hi {vendor_name}, we will place the order for {quantity} {unit} of "
            "{wine_name} by {delivery_date}."
        )

        assert await agent._propose_rfq_solicitation(_breach()) is None
        assert router.inserts.get("one_tap_actions", []) == []
        assert _published(bus) == []

    async def test_shipped_templates_are_clean_today(self):
        """The guardrail above only helps if the shipped text passes it."""
        from core.commitment_patterns import contains_commitment_language

        agent, _router, _bus, _db = _make_agent()
        for key, template in agent.rfq_templates.items():
            text = template.format(
                vendor_name="Acme",
                quantity=12,
                unit="bottles",
                wine_name="Barolo Riserva",
                delivery_date="2026-09-06",
            )
            assert not contains_commitment_language(text), key


# ---------------------------------------------------------------------------
# 5. Dedup and metadata
# ---------------------------------------------------------------------------


class TestDedup:
    async def test_a_repeating_breach_does_not_stack_proposals(self):
        agent, router, _bus, _db = _make_agent()

        first = await agent._propose_rfq_solicitation(_breach())
        second = await agent._propose_rfq_solicitation(_breach())

        assert first == second
        assert len(router.inserts["one_tap_actions"]) == 1

    async def test_an_in_flight_rfq_suppresses_a_new_proposal(self):
        """Pre-existing dedup on rfq_requests, preserved through the rewrite."""
        agent, router, bus, _db = _make_agent(
            existing_rfqs=[SimpleNamespace(id="rfq-9", status="pending")]
        )

        assert await agent._propose_rfq_solicitation(_breach()) is None
        assert router.inserts.get("one_tap_actions", []) == []
        assert _published(bus) == []


class TestHealth:
    async def test_health_reports_propose_only(self):
        agent, _router, _bus, _db = _make_agent()
        health = await agent.health_check()
        assert health["autonomy_tier"] == "propose_only"


# ---------------------------------------------------------------------------
# 6. OD-75: outcome must reflect the PARSE, not just the HTTP call
#    (inbound half — unchanged by the solicitation gate)
# ---------------------------------------------------------------------------


def make_rfq_agent():
    """RFQAgent with fully mocked bus + database; nothing reaches a network."""
    message_bus = MagicMock()
    message_bus.publish = AsyncMock(return_value=True)
    message_bus.publish_event = AsyncMock(return_value=True)

    database = MagicMock()
    database.supabase = MagicMock()

    return RFQAgent("rfq_agent", message_bus, database, {"mock_mode": False})


def _anthropic_returning(text: str):
    """An Anthropic client whose one call answers with `text` and known usage."""
    block = MagicMock()
    block.type = "text"
    block.text = text

    resp = MagicMock()
    resp.content = [block]
    resp.usage.input_tokens = 900
    resp.usage.output_tokens = 150

    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=resp)
    return client


@pytest.mark.asyncio
async def test_prose_vendor_quote_records_partial_not_success():
    """
    OD-75: an unparseable answer means the agent read no price, no availability
    and no delivery date — it fell back to regex. That is not a completed quote
    parse, and it must record 'partial' on the parse_v1 basis.

    The row must still be written exactly once: the tokens were billed before
    anyone tried to json.loads the text.
    """
    agent = make_rfq_agent()
    agent.llm_client = _anthropic_returning(
        "Sure! We can probably do a good price for you, let me check with the team."
    )
    spend = MagicMock()

    with patch("services.spend_logger.get_spend_logger", return_value=spend):
        result = await agent._parse_vendor_response(
            "Sure! We can probably do a good price for you."
        )

    # Degraded to the regex fallback rather than raising.
    assert result is not None
    assert result["availability"] == "unknown"

    # Exactly one row — the spend is owed, but must not be double-counted.
    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "partial"
    assert kwargs["outcome"] != "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is True
    assert kwargs["choice"] == "quote:parse_failed"
    # Cost survives the parse failure — the call was paid for either way.
    assert kwargs["input_tokens"] == 900
    assert kwargs["output_tokens"] == 150
    assert kwargs["cost_usd"] > 0


@pytest.mark.asyncio
async def test_parsed_vendor_quote_records_success_on_parse_basis():
    """OD-75: a readable quote keeps 'success', now on the parse_v1 basis."""
    agent = make_rfq_agent()
    agent.llm_client = _anthropic_returning(
        'Here is the quote:\n{"price": 24.5, "availability": "in_stock", '
        '"delivery_date": "2026-09-01", "minimum_order": 6, "notes": ""}'
    )
    spend = MagicMock()

    with patch("services.spend_logger.get_spend_logger", return_value=spend):
        result = await agent._parse_vendor_response("We can do $24.50 a bottle.")

    assert result["price"] == 24.5
    assert result["availability"] == "in_stock"

    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is False
    assert kwargs["choice"] == "quote:parsed"
