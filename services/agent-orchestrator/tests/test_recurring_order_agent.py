"""
Unit tests for RecurringOrderAgent — scheduled purchasing under the harness.

The load-bearing test in this file is
``TestNoAutoExecute::test_due_order_with_auto_approve_still_only_proposes``.
Before ADR 0039 Track A3 this agent placed orders: ``_process_due_order``
branched on ``recurring_orders.auto_approve`` and called
``db.create_order({... "auto_approved": True})``. The old version of this file
*asserted that behaviour was correct*
(``recurring_agent.db.create_order.assert_called_once()``), which is why a
propose→confirm→execute violation survived in a tested file. The assertions are
inverted here on purpose.

Covers:
  1. schedule arithmetic (unchanged behaviour, kept from the original suite)
  2. no-auto-execute: due orders emit a pending proposal and place nothing
  3. the enforcement point refuses a pre-confirmed row
  4. reminders at T-2 days, proposals at T-0, dedup on a repeat sweep
  5. BaseAgent lifecycle (start → ACTIVE, stop → STOPPED, scheduler cancelled)
  6. registry wiring: registered, OPTIONAL, and gated off by default
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.recurring_order_agent import (
    ACTION_FAMILY,
    ACTION_KIND,
    AUTONOMY_TIER,
    DECISION_CHECK,
    DECISION_PROPOSAL,
    DECISION_REMINDER,
    PROPOSAL_STATUS,
    RK_APPROVAL_NEEDED,
    RK_REMINDER,
    RecurringOrderAgent,
    RecurringOrderSafetyError,
)
from core.base_agent import AgentStatus

REST_ID = "11111111-1111-1111-1111-111111111111"
INV_ID = "22222222-2222-2222-2222-222222222222"


# ---------------------------------------------------------------------------
# Supabase stub (same shape as tests/test_drift_agent.py's _TableRouter)
# ---------------------------------------------------------------------------


class _TableRouter:
    """Routes supabase.table(name) to per-table chain mocks; records writes."""

    def __init__(self, tables: Dict[str, List[Dict[str, Any]]]):
        self.tables = {k: list(v) for k, v in tables.items()}
        self.inserts: Dict[str, List[Dict[str, Any]]] = {}
        self.updates: Dict[str, List[Dict[str, Any]]] = {}
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


def _base_tables(
    recurring: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    return {
        "recurring_orders": recurring or [],
        "restaurant_inventory": [{"id": INV_ID, "wine_name": "Barolo Riserva"}],
        "one_tap_actions": [],
        "decision_log": [],
        # Deliberately present and deliberately expected to stay empty: an agent
        # that regains an execution path would write here.
        "orders": [],
        "procurement_orders": [],
    }


def _make_agent(
    tables: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    config: Optional[Dict[str, Any]] = None,
) -> tuple[RecurringOrderAgent, _TableRouter, AsyncMock]:
    router = _TableRouter(tables if tables is not None else _base_tables())
    db = MagicMock()
    db.supabase.table.side_effect = router.table
    bus = AsyncMock()
    bus.publish = AsyncMock(return_value=True)
    agent = RecurringOrderAgent(
        agent_name="recurring_order_agent",
        message_bus=bus,
        database=db,
        # Scheduler off by default in tests: the daily loop is exercised
        # explicitly in TestLifecycle, not left running under every unit test.
        config=config if config is not None else {"scheduler_enabled": False},
    )
    agent.logger = MagicMock()
    return agent, router, bus


def _order(**overrides: Any) -> Dict[str, Any]:
    row = {
        "id": "REC001",
        "restaurant_id": REST_ID,
        "wine_id": INV_ID,
        "quantity": 12,
        "unit_type": "bottle",
        "frequency": "weekly",
        "frequency_day": 1,
        "preferred_providers": ["PROV001"],
        "auto_approve": False,
        "next_order_date": date.today().isoformat(),
        "active": True,
    }
    row.update(overrides)
    return row


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
# 1. Schedule arithmetic — unchanged behaviour, kept from the original suite
# ---------------------------------------------------------------------------


class TestScheduleArithmetic:
    def test_daily(self):
        agent, _, _ = _make_agent()
        assert agent._calculate_next_date(date(2026, 1, 15), "daily", None) == date(
            2026, 1, 16
        )

    def test_weekly(self):
        agent, _, _ = _make_agent()
        # 2026-01-15 is a Thursday (weekday 3); next Monday (0) is the 19th.
        assert agent._calculate_next_date(date(2026, 1, 15), "weekly", 0) == date(
            2026, 1, 19
        )

    def test_biweekly(self):
        agent, _, _ = _make_agent()
        assert agent._calculate_next_date(date(2026, 1, 15), "biweekly", None) == date(
            2026, 1, 29
        )

    def test_monthly(self):
        agent, _, _ = _make_agent()
        assert agent._calculate_next_date(date(2026, 1, 15), "monthly", 15) == date(
            2026, 2, 15
        )

    def test_monthly_short_month(self):
        agent, _, _ = _make_agent()
        # February has no 31st — fall back to the last day of the month.
        assert agent._calculate_next_date(date(2026, 1, 31), "monthly", 31).month == 2

    def test_parse_date_accepts_string_and_date(self):
        agent, _, _ = _make_agent()
        assert agent._parse_date("2026-01-15") == date(2026, 1, 15)
        assert agent._parse_date(date(2026, 1, 20)) == date(2026, 1, 20)


# ---------------------------------------------------------------------------
# 2 + 3. The no-auto-execute guarantee
# ---------------------------------------------------------------------------


class TestNoAutoExecute:
    @pytest.mark.asyncio
    async def test_due_order_emits_a_pending_proposal(self):
        agent, router, bus = _make_agent()

        result = await agent._process_due_order(_order())

        staged = router.inserts.get("one_tap_actions", [])
        assert len(staged) == 1, "a due order must stage exactly one proposal"
        row = staged[0]

        assert row["status"] == PROPOSAL_STATUS
        assert row.get("executed_by") is None
        assert row.get("executed_at") is None
        assert row.get("execution_result") is None

        meta = row["metadata"]
        assert meta["action_family"] == ACTION_FAMILY
        assert meta["action_kind"] == ACTION_KIND
        assert meta["autonomy_tier"] == AUTONOMY_TIER
        assert meta["proposer"] == "recurring_order_agent"
        assert meta["payload"]["recurring_order_id"] == "REC001"

        assert result["status"] == PROPOSAL_STATUS
        assert result["duplicate"] is False

        # The manager is asked, not informed after the fact.
        keys = [p["routing_key"] for p in _published(bus)]
        assert keys == [RK_APPROVAL_NEEDED]
        assert "recurring.order.executed" not in keys

    @pytest.mark.asyncio
    async def test_due_order_with_auto_approve_still_only_proposes(self):
        """
        The regression that mattered. `auto_approve=True` used to mean "place it";
        it now means "raise the priority of the thing a human still has to tap".
        """
        agent, router, bus = _make_agent()

        await agent._process_due_order(_order(auto_approve=True))

        staged = router.inserts["one_tap_actions"]
        assert len(staged) == 1
        assert staged[0]["status"] == PROPOSAL_STATUS
        assert staged[0]["priority"] == "high"
        assert staged[0]["metadata"]["payload"]["schedule_auto_approve_flag"] is True

        # Nothing was purchased, on any table an order could land in.
        assert router.inserts.get("orders") is None
        assert router.inserts.get("procurement_orders") is None
        assert [p["routing_key"] for p in _published(bus)] == [RK_APPROVAL_NEEDED]

    @pytest.mark.asyncio
    async def test_no_order_placement_side_effect_exists_at_all(self):
        """
        The deleted path is deleted, not renamed. If someone reintroduces an
        execute method this fails before any behavioural test has to catch it.
        """
        for banned in ("_create_order", "_execute_order", "_place_order"):
            assert not hasattr(RecurringOrderAgent, banned), (
                f"{banned} is an order-placement path; scheduled purchasing is "
                "propose-only (FUTURES §8.1)"
            )
        assert RecurringOrderAgent.AUTONOMY_TIER == "propose_only"

    @pytest.mark.asyncio
    async def test_enforcement_point_refuses_a_preconfirmed_row(self):
        """
        `_emit_action_proposal` is the single writer, and it validates the row it
        is handed — so a caller that tries to write consent is refused rather
        than persisted.
        """
        agent, router, _ = _make_agent()

        for forged in (
            {"status": "completed"},
            {"status": PROPOSAL_STATUS, "executed_by": "user-uuid"},
            {"status": PROPOSAL_STATUS, "executed_at": "2026-08-28T00:00:00Z"},
            {"status": PROPOSAL_STATUS, "execution_result": {"order_id": "X"}},
        ):
            row = {
                "restaurant_id": REST_ID,
                "action_type": "custom",
                "title": "forged",
                "metadata": {},
                **forged,
            }
            with pytest.raises(RecurringOrderSafetyError):
                await agent._emit_action_proposal(row)

        assert router.inserts.get("one_tap_actions") is None

    @pytest.mark.asyncio
    async def test_every_proposal_writes_a_decision_log_row(self):
        agent, router, _ = _make_agent()

        await agent._process_due_order(_order())

        rows = _decisions(router, DECISION_PROPOSAL)
        assert len(rows) == 1
        assert rows[0]["output"]["autonomy_tier"] == AUTONOMY_TIER
        assert rows[0]["output"]["executed"] is False
        assert rows[0]["agent_name"] == "recurring_order_agent"


# ---------------------------------------------------------------------------
# 4. Sweep behaviour
# ---------------------------------------------------------------------------


class TestSweep:
    @pytest.mark.asyncio
    async def test_reminder_two_days_out_does_not_propose(self):
        due = date.today() + timedelta(days=2)
        agent, router, bus = _make_agent(
            _base_tables([_order(next_order_date=due.isoformat())])
        )

        result = await agent.check_scheduled_orders()

        assert result["reminders"] == ["REC001"]
        assert result["proposals"] == []
        assert router.inserts.get("one_tap_actions") is None
        assert [p["routing_key"] for p in _published(bus)] == [RK_REMINDER]
        assert len(_decisions(router, DECISION_REMINDER)) == 1

    @pytest.mark.asyncio
    async def test_sweep_handles_reminder_and_due_together(self):
        today = date.today()
        agent, router, bus = _make_agent(
            _base_tables(
                [
                    _order(
                        id="REC001",
                        next_order_date=(today + timedelta(days=2)).isoformat(),
                    ),
                    _order(
                        id="REC002",
                        next_order_date=today.isoformat(),
                        frequency="monthly",
                        frequency_day=15,
                    ),
                ]
            )
        )

        result = await agent.check_scheduled_orders()

        assert result["orders_examined"] == 2
        assert result["reminders"] == ["REC001"]
        assert len(result["proposals"]) == 1
        assert sorted(p["routing_key"] for p in _published(bus)) == sorted(
            [RK_REMINDER, RK_APPROVAL_NEEDED]
        )

        # The sweep itself is logged, including the invariant it must uphold.
        sweep = _decisions(router, DECISION_CHECK)
        assert len(sweep) == 1
        assert sweep[0]["output"]["orders_placed"] == 0

    @pytest.mark.asyncio
    async def test_sweep_advances_the_schedule_for_a_due_order(self):
        agent, router, _ = _make_agent(
            _base_tables([_order(next_order_date=date(2026, 1, 15).isoformat())])
        )

        await agent.check_scheduled_orders()

        updates = router.updates.get("recurring_orders", [])
        assert len(updates) == 1
        # weekly, frequency_day=1 (Tuesday) from Thursday 2026-01-15 → 2026-01-20
        assert updates[0]["next_order_date"] == "2026-01-20"
        assert updates[0]["_filters"] == {"id": "REC001"}

    @pytest.mark.asyncio
    async def test_second_sweep_does_not_stack_a_second_proposal(self):
        agent, router, _ = _make_agent()
        order = _order()

        await agent._propose_order(order)
        second = await agent._propose_order(order)

        assert len(router.inserts["one_tap_actions"]) == 1
        assert second["duplicate"] is True

    @pytest.mark.asyncio
    async def test_one_bad_row_does_not_abort_the_sweep(self):
        agent, router, _ = _make_agent(
            _base_tables(
                [
                    _order(id="BAD", next_order_date="not-a-date"),
                    _order(id="GOOD", next_order_date=date.today().isoformat()),
                ]
            )
        )

        result = await agent.check_scheduled_orders()

        assert [e["recurring_order_id"] for e in result["errors"]] == ["BAD"]
        assert len(result["proposals"]) == 1
        assert len(router.inserts["one_tap_actions"]) == 1

    @pytest.mark.asyncio
    async def test_sweep_can_be_scoped_to_one_restaurant(self):
        agent, router, _ = _make_agent(
            _base_tables(
                [
                    _order(id="MINE", restaurant_id=REST_ID),
                    _order(id="THEIRS", restaurant_id="other-restaurant"),
                ]
            )
        )

        result = await agent.check_scheduled_orders(restaurant_id=REST_ID)

        assert result["orders_examined"] == 1
        assert result["proposals"][0]["recurring_order_id"] == "MINE"


# ---------------------------------------------------------------------------
# 5. Harness lifecycle
# ---------------------------------------------------------------------------


class TestLifecycle:
    @pytest.mark.asyncio
    async def test_start_subscribes_and_stop_cancels_the_scheduler(self):
        agent, _, bus = _make_agent(config={"scheduler_enabled": True})

        await agent.start()
        try:
            assert agent.status == AgentStatus.ACTIVE
            assert agent._scheduler_task is not None
            health = await agent.health_check()
            assert health["scheduler_running"] is True
            assert health["can_execute_orders"] is False
            assert health["autonomy_tier"] == AUTONOMY_TIER

            # It subscribes through the harness rather than a private loop.
            bus.declare_queue.assert_awaited()
            bus.consume.assert_awaited()
        finally:
            await agent.stop()

        assert agent.status == AgentStatus.STOPPED
        assert agent._scheduler_task is None

    @pytest.mark.asyncio
    async def test_process_message_runs_a_sweep(self):
        agent, router, _ = _make_agent(
            _base_tables([_order(next_order_date=date.today().isoformat())])
        )

        result = await agent.process_message(
            {"payload": {"restaurant_id": REST_ID}, "message_id": "m-1"}
        )

        assert result["orders_examined"] == 1
        assert len(result["proposals"]) == 1

    def test_subscribes_to_the_scheduled_tick(self):
        assert RecurringOrderAgent.get_subscribed_routing_keys(RecurringOrderAgent) == [
            ("system.control", "system.schedule.recurring_orders")
        ]


# ---------------------------------------------------------------------------
# 6. Registry wiring
# ---------------------------------------------------------------------------


class TestRegistryWiring:
    def test_registered_in_the_orchestrator_class_map(self):
        import core.orchestrator as orchestrator_module

        assert orchestrator_module.RecurringOrderAgent is RecurringOrderAgent

    def test_spec_is_optional_and_gated_off_by_default(self):
        from core.agent_registry import (
            DEFAULT_AGENT_SPECS,
            AgentRegistry,
            AgentTier,
        )

        spec = DEFAULT_AGENT_SPECS["recurring_order_agent"]
        assert spec["tier"] == AgentTier.OPTIONAL

        registry = AgentRegistry(feature_flags={})
        registry.register_from_defaults({"recurring_order_agent": RecurringOrderAgent})
        assert registry.is_enabled("recurring_order_agent") is False
        assert "recurring_order_agent" not in registry.get_startup_order()

    def test_flag_can_turn_it_on(self):
        from core.agent_registry import AgentRegistry

        registry = AgentRegistry(
            feature_flags={"AGENT_RECURRING_ORDER_AGENT_ENABLED": True}
        )
        registry.register_from_defaults({"recurring_order_agent": RecurringOrderAgent})
        assert registry.is_enabled("recurring_order_agent") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
