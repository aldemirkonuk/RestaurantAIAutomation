"""
Unit tests for ProcurementAgent — the buy-side gate.

The load-bearing test in this file is
``TestParCrossingCannotReachAVendor::test_threshold_breach_creates_no_order_and_no_vendor_intent``.
It is written to fail on the code that existed before this change, where
``_initiate_procurement`` responded to a single ``stock.threshold.breached``
event by calling ``database.create_procurement_order({... "status":
"NEGOTIATING"})`` and publishing ``procurement.conversation_request`` — the
intent that makes ProviderConversationAgent draft and send to a vendor. No human
appeared anywhere on that path.

That path was inert only because the Python POS pipeline that drives
``buffer_manager``'s two ``stock.threshold.breached`` publishes
(``buffer_manager.py:284`` and ``:451``) is dormant. The agent itself is CORE
(``core/agent_registry.py``), so it boots and binds its queue on every start;
E1's POS unification supplies the missing input. Hence the gate, before the pipe.

Covers:
  1. par crossing → exactly one pending proposal, no order, no vendor intent
  1b. shadow mode: the row is staged, and no human is notified, because
     approving it executes nothing today (ADR 0020)
  2. the enforcement point refuses a pre-confirmed row
  3. fail-closed: when staging fails, nothing else happens either
  4. the deleted execution path is deleted, not renamed
  5. ``_build_reorder_plan`` is pure — the preserved negotiation/vendor-selection
     logic decides without acting
  6. the manual-order route lands on the same proposal path
  7. dedup: a par that keeps breaching does not stack proposals
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock

import pytest

import agents.procurement_agent as procurement_module
from agents.procurement_agent import (
    ACTION_FAMILY,
    ACTION_KIND,
    AUTONOMY_TIER,
    DECISION_REORDER_BLOCKED,
    DECISION_REORDER_PROPOSAL,
    ONE_TAP_ACTION_TYPE,
    PROPOSAL_EXECUTOR_EXISTS,
    PROPOSAL_STATUS,
    RK_REORDER_PROPOSED,
    ProcurementAgent,
    ProcurementSafetyError,
)

REST_ID = "11111111-1111-1111-1111-111111111111"
INV_ID = "22222222-2222-2222-2222-222222222222"
PROV_ID = "33333333-3333-3333-3333-333333333333"

# Everything that would have to happen for a par crossing to reach a vendor.
# Named once so each test asserts against the same list rather than its own idea
# of what "reaching a vendor" means.
VENDOR_FACING_KEYS = {
    "procurement.conversation_request",
    "procurement.order.created",
    "notification.send_email",
    "notification.send_sms",
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
        self.insert_should_fail: set[str] = set()
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
                patch = dict(state["pending_update"])
                patch["_filters"] = dict(state["filters"])
                self.updates.setdefault(name, []).append(patch)
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
        # that regains an execution path would write here.
        "procurement_orders": [],
        "orders": [],
    }


def _inventory(**overrides: Any) -> Dict[str, Any]:
    row = {
        "id": INV_ID,
        "restaurant_id": REST_ID,
        "wine_name": "Barolo Riserva",
        "provider_id": PROV_ID,
        "threshold_min": 3,
        "reorder_quantity": 12,
    }
    row.update(overrides)
    return row


def _make_agent(
    inventory: Optional[Dict[str, Any]] = None,
    provider: Optional[Dict[str, Any]] = None,
    tables: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> tuple[ProcurementAgent, _TableRouter, AsyncMock, MagicMock]:
    router = _TableRouter(tables if tables is not None else _base_tables())

    db = MagicMock()
    db.supabase.table.side_effect = router.table
    db.get_inventory_item = AsyncMock(
        return_value=_inventory() if inventory is None else inventory
    )
    db.get_provider = AsyncMock(
        return_value=(
            {"id": PROV_ID, "name": "Vinos Iberia"} if provider is None else provider
        )
    )
    # The old execution path. Left on the mock on purpose: if it is ever called
    # again the assertions below say so by name.
    db.create_procurement_order = AsyncMock(return_value="ORDER-001")

    bus = AsyncMock()
    bus.publish = AsyncMock(return_value=True)

    agent = ProcurementAgent(
        agent_name="procurement_agent",
        message_bus=bus,
        database=db,
        config={"mock_mode": True},
    )
    agent.logger = MagicMock()
    return agent, router, bus, db


def _breach(**payload_overrides: Any) -> Dict[str, Any]:
    payload = {
        "inventory_id": INV_ID,
        "restaurant_id": REST_ID,
        "master_wine_id": INV_ID,
        "wine_name": "Barolo Riserva",
        "stock_before": 4,
        "stock_after": 1,
        "threshold": 3,
        "in_transit_quantity": 0,
        "sales_velocity_7d": 2.0,
        "estimated_stockout_days": 0.5,
        "urgency": "high",
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
# 1. The gate
# ---------------------------------------------------------------------------


class TestParCrossingCannotReachAVendor:
    @pytest.mark.asyncio
    async def test_threshold_breach_creates_no_order_and_no_vendor_intent(self):
        """
        THE regression test. On the pre-fix agent this fails three ways at once:
        create_procurement_order is awaited, procurement.conversation_request and
        procurement.order.created are published, and no proposal is staged.
        """
        agent, router, bus, db = _make_agent()

        await agent.process_message(_breach())

        # 1. Nothing was bought, on any table an order could land in.
        db.create_procurement_order.assert_not_awaited()
        assert router.inserts.get("procurement_orders") is None
        assert router.inserts.get("orders") is None

        # 2. Nothing reached a vendor.
        keys = {p["routing_key"] for p in _published(bus)}
        assert not (keys & VENDOR_FACING_KEYS), (
            f"a par crossing published {keys & VENDOR_FACING_KEYS}, which reaches "
            "a vendor with no human confirmation (FUTURES §8.1)"
        )

        # 3. What DID happen: exactly one unconfirmed proposal.
        staged = router.inserts.get("one_tap_actions", [])
        assert len(staged) == 1, "a par crossing must stage exactly one proposal"
        row = staged[0]
        assert row["status"] == PROPOSAL_STATUS
        assert row["action_type"] == ONE_TAP_ACTION_TYPE
        assert row.get("executed_by") is None
        assert row.get("executed_at") is None
        assert row.get("execution_result") is None

        meta = row["metadata"]
        assert meta["action_family"] == ACTION_FAMILY
        assert meta["action_kind"] == ACTION_KIND
        assert meta["autonomy_tier"] == AUTONOMY_TIER
        assert meta["proposer"] == "procurement_agent"
        assert meta["payload"]["inventory_id"] == INV_ID
        assert meta["payload"]["provider_id"] == PROV_ID

        # 4. Nothing at all was published. The proposal is staged in shadow mode
        #    because approving it would execute nothing — see
        #    TestNoHumanIsToldUntilApprovalWorks.
        assert _published(bus) == []

    @pytest.mark.asyncio
    async def test_the_proposal_preserves_the_negotiation_numbers(self):
        """
        Propose-only must not mean dumber. The price target and the tolerance
        band the old path computed are still computed — they ride on the
        proposal so a human approves a specific deal, not a blank reorder.
        """
        agent, router, _, _ = _make_agent()

        await agent.process_message(_breach())

        payload = router.inserts["one_tap_actions"][0]["metadata"]["payload"]
        assert payload["quantity"] == 12
        assert payload["provider_name"] == "Vinos Iberia"
        # No delivered history → _calculate_avg_price falls back to 25.0.
        assert payload["target_price_per_bottle"] == pytest.approx(23.75)
        assert payload["max_acceptable_price"] == pytest.approx(23.75 * 1.15)
        assert payload["price_tolerance_percent"] == 15

    @pytest.mark.asyncio
    async def test_every_proposal_writes_a_decision_log_row(self):
        agent, router, _, _ = _make_agent()

        await agent.process_message(_breach())

        rows = _decisions(router, DECISION_REORDER_PROPOSAL)
        assert len(rows) == 1
        assert rows[0]["agent_name"] == "procurement_agent"
        assert rows[0]["output"]["autonomy_tier"] == AUTONOMY_TIER
        assert rows[0]["output"]["executed"] is False
        assert rows[0]["output"]["orders_created"] == 0
        assert rows[0]["output"]["vendor_intents_published"] == 0
        # The shadow-mode volume has to be countable off decision_log alone.
        assert rows[0]["output"]["shadow_mode"] is True
        assert rows[0]["output"]["manager_notified"] is False

    @pytest.mark.asyncio
    async def test_no_order_placement_side_effect_exists_at_all(self):
        """
        The deleted path is deleted, not renamed. If someone reintroduces an
        execute method this fails before any behavioural test has to catch it.
        """
        for banned in (
            "_create_order",
            "_execute_order",
            "_place_order",
            "_initiate_procurement",
        ):
            assert not hasattr(ProcurementAgent, banned), (
                f"{banned} is an order-origination path; a par crossing is "
                "propose-only (FUTURES §8.1)"
            )
        assert ProcurementAgent.AUTONOMY_TIER == "propose_only"


# ---------------------------------------------------------------------------
# 1b. Shadow mode — nobody is told until approving does something
# ---------------------------------------------------------------------------


class TestNoHumanIsToldUntilApprovalWorks:
    """
    ADR 0020 (LOCKED): an action that cannot complete must refuse out loud, and
    "an error must never render as emptiness". Approving one of these proposals
    executes nothing — OneTapActionsService.triggerWorkflow
    (one-tap-actions.service.ts:404-429) is a switch of TODO logs with no branch
    for this family — so a manager who tapped approve would get silence.

    The row is still staged (shadow-mode input for the hop-4 bridge, and safe
    because the web action center excludes this action_type from
    RENDERABLE_SERVER_TYPES by design). What is gated is the notification.

    These tests fail the moment someone flips PROPOSAL_EXECUTOR_EXISTS without
    building the executor, and the moment someone re-adds the publish.
    """

    def test_the_gate_is_closed_and_says_why(self):
        assert PROPOSAL_EXECUTOR_EXISTS is False, (
            "PROPOSAL_EXECUTOR_EXISTS may only become True in the same change "
            "that gives OneTapActionsService.triggerWorkflow a real branch for "
            f"{ACTION_KIND!r}. Notifying without an executor puts a card in "
            "front of a manager that does nothing when tapped (ADR 0020)."
        )

    @pytest.mark.asyncio
    async def test_a_staged_proposal_notifies_nobody(self):
        agent, router, bus, _ = _make_agent()

        action_id = await agent._propose_reorder(_breach())

        # The row exists — that is the shadow-mode data we want to keep.
        assert action_id is not None
        assert len(router.inserts["one_tap_actions"]) == 1

        # And absolutely nothing was announced, on any exchange.
        assert _published(bus) == [], (
            "a proposal nobody can execute must not be announced to a human "
            "(ADR 0020)"
        )
        assert RK_REORDER_PROPOSED not in {p["routing_key"] for p in _published(bus)}

    @pytest.mark.asyncio
    async def test_the_notification_returns_when_the_executor_lands(self, monkeypatch):
        """
        The gate is a gate, not a deletion. Flipping the flag restores the
        manager notification — so whoever builds the executor gets the
        behaviour back by changing one constant, and this test tells them the
        wiring still works.
        """
        monkeypatch.setattr(procurement_module, "PROPOSAL_EXECUTOR_EXISTS", True)
        agent, router, bus, _ = _make_agent()

        await agent._propose_reorder(_breach())

        published = _published(bus)
        assert [p["routing_key"] for p in published] == [RK_REORDER_PROPOSED]
        body = published[0]["body"]["payload"]
        assert body["one_tap_action_id"] == router.inserts["one_tap_actions"][0]["id"]
        assert body["restaurant_id"] == REST_ID
        # Still no order, even with the notification switched back on.
        assert router.inserts.get("procurement_orders") is None


# ---------------------------------------------------------------------------
# 2. The enforcement point
# ---------------------------------------------------------------------------


class TestEnforcementPoint:
    @pytest.mark.asyncio
    async def test_refuses_a_preconfirmed_row(self):
        """
        ``_emit_action_proposal`` is the single writer and it validates the row
        it is handed — so a caller that tries to write consent is refused rather
        than persisted.
        """
        agent, router, _, _ = _make_agent()

        for forged in (
            {"status": "completed"},
            {"status": PROPOSAL_STATUS, "executed_by": "user-uuid"},
            {"status": PROPOSAL_STATUS, "executed_at": "2026-09-01T00:00:00Z"},
            {"status": PROPOSAL_STATUS, "execution_result": {"order_id": "X"}},
        ):
            row = {
                "restaurant_id": REST_ID,
                "action_type": ONE_TAP_ACTION_TYPE,
                "title": "forged",
                "metadata": {},
                **forged,
            }
            with pytest.raises(ProcurementSafetyError):
                await agent._emit_action_proposal(row)

        assert router.inserts.get("one_tap_actions") is None


# ---------------------------------------------------------------------------
# 3. Fail closed
# ---------------------------------------------------------------------------


class TestFailsClosed:
    @pytest.mark.asyncio
    async def test_when_the_proposal_cannot_be_staged_nothing_else_happens(self):
        """
        The proposal path being unavailable must degrade to doing nothing, never
        to the old direct path. A lost suggestion is recoverable; an unapproved
        purchase is not.
        """
        agent, router, bus, db = _make_agent()
        router.insert_should_fail.add("one_tap_actions")

        result = await agent._propose_reorder(_breach())

        assert result is None
        assert router.inserts.get("one_tap_actions") is None
        db.create_procurement_order.assert_not_awaited()
        assert router.inserts.get("procurement_orders") is None
        # Not even the manager notification — there is nothing to approve.
        assert _published(bus) == []
        # And the refusal is on the record rather than silent.
        assert len(_decisions(router, DECISION_REORDER_BLOCKED)) == 1

    @pytest.mark.asyncio
    async def test_missing_provider_proposes_nothing(self):
        agent, router, bus, db = _make_agent(inventory=_inventory(provider_id=None))

        result = await agent._propose_reorder(_breach())

        assert result is None
        assert router.inserts.get("one_tap_actions") is None
        db.create_procurement_order.assert_not_awaited()
        assert _published(bus) == []

    @pytest.mark.asyncio
    async def test_missing_inventory_proposes_nothing(self):
        agent, router, bus, db = _make_agent()
        db.get_inventory_item = AsyncMock(return_value=None)

        result = await agent._propose_reorder(_breach())

        assert result is None
        assert router.inserts.get("one_tap_actions") is None
        db.create_procurement_order.assert_not_awaited()
        assert _published(bus) == []


# ---------------------------------------------------------------------------
# 4. The preserved logic is preserved, and is inert
# ---------------------------------------------------------------------------


class TestReorderPlanIsPure:
    @pytest.mark.asyncio
    async def test_building_a_plan_writes_nothing_and_publishes_nothing(self):
        """
        The vendor-selection and price-target logic survives the conversion so
        the future hop-4 bridge can reuse it. It must be safe to call on its own,
        which means it decides without acting.
        """
        agent, router, bus, db = _make_agent()

        plan = await agent._build_reorder_plan(_breach()["payload"])

        assert plan is not None
        assert plan["provider_id"] == PROV_ID
        assert plan["quantity"] == 12
        assert plan["target_price_per_bottle"] == pytest.approx(23.75)

        # Reading price history is the only table it touches, and it writes none.
        assert router.inserts == {}
        assert router.updates == {}
        assert _published(bus) == []
        db.create_procurement_order.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_manual_overrides_still_drive_the_plan(self):
        agent, _, _, _ = _make_agent()

        plan = await agent._build_reorder_plan(
            {
                **_breach()["payload"],
                "_manual": True,
                "_provider_id": "other-provider",
                "_quantity": 6,
                "_target_price": 40.0,
                "_notes": "case discount promised",
            }
        )

        assert plan["provider_id"] == "other-provider"
        assert plan["quantity"] == 6
        assert plan["target_price_per_bottle"] == 40.0
        assert plan["is_manual"] is True
        assert plan["notes"] == "case discount promised"


# ---------------------------------------------------------------------------
# 5. The manual route lands on the same gate
# ---------------------------------------------------------------------------


class TestManualOrderRequest:
    @pytest.mark.asyncio
    async def test_manual_order_request_also_only_proposes(self):
        """
        A message claiming a human wanted this is not a confirmation record; it
        carries no executed_by. It takes the same path as an automatic par
        crossing.
        """
        agent, router, bus, db = _make_agent()

        await agent.process_message(
            {
                "routing_key": "procurement.manual_order_request",
                "payload": {
                    "wine_name": "Barolo Riserva",
                    "wine_id": INV_ID,
                    "provider_id": PROV_ID,
                    "restaurant_id": REST_ID,
                    "quantity": 6,
                    "target_price": 30.0,
                },
            }
        )

        db.create_procurement_order.assert_not_awaited()
        assert len(router.inserts.get("one_tap_actions", [])) == 1
        assert router.inserts["one_tap_actions"][0]["status"] == PROPOSAL_STATUS
        assert _published(bus) == []


# ---------------------------------------------------------------------------
# 6. Idempotency
# ---------------------------------------------------------------------------


class TestDedup:
    @pytest.mark.asyncio
    async def test_a_repeating_breach_does_not_stack_proposals(self):
        agent, router, _, _ = _make_agent()

        first = await agent._propose_reorder(_breach())
        second = await agent._propose_reorder(_breach())

        assert len(router.inserts["one_tap_actions"]) == 1
        assert second == first


# ---------------------------------------------------------------------------
# 7. Health surfaces the tier
# ---------------------------------------------------------------------------


class TestHealth:
    @pytest.mark.asyncio
    async def test_health_reports_propose_only(self):
        agent, _, _, _ = _make_agent()

        health = await agent.health_check()

        assert health["autonomy_tier"] == AUTONOMY_TIER
        assert health["can_create_orders"] is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
