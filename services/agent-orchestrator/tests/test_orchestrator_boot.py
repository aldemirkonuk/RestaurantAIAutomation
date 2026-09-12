"""Boot the real orchestrator and prove every CORE agent actually starts.

start_all_agents() catches per-agent exceptions, logs "Failed to start agent X",
and continues. That is a reasonable degradation policy and a terrible reporting
one: it then logs "Started N core agents" and main.py logs "All CORE agents
started successfully", so a boot where a third of the roster threw TypeError on
instantiation is indistinguishable from a clean one in the logs.

That is how four agents came to be declared CORE — the fix for their never
running — while three of them still could not be constructed. Nothing between
the class map and the log line checks that the agents exist.

This drives the real AgentOrchestrator, the real AgentRegistry, the real agent
classes and the real start_all_agents(), substituting only the two external
dependencies: the AMQP connection and the Supabase/Redis client. What it proves
is instantiation and subscription — that every CORE agent is constructed, starts
without raising, and binds a queue for each key it declares. What it cannot
prove is anything requiring a live broker or database.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from config.settings import Settings
from core.agent_registry import AgentTier
from core.orchestrator import AgentOrchestrator


class RecordingMessageBus:
    """Stands in for MessageBus, recording the bindings agents ask for."""

    def __init__(self):
        self.bindings: list[tuple[str, str, str]] = []  # (queue, exchange, routing_key)
        self.consumed: list[str] = []

    async def declare_queue(
        self, queue_name, exchange_name, routing_key, durable=True, max_priority=10
    ):
        self.bindings.append((queue_name, exchange_name, routing_key))

    async def consume(self, queue_name, callback, auto_ack=False):
        self.consumed.append(queue_name)

    async def publish(self, *args, **kwargs):
        return None

    def __getattr__(self, name):
        # Anything else an agent reaches for during start() is a no-op coroutine.
        return AsyncMock()


@pytest.fixture
async def booted():
    """Run the real boot sequence: initialize() then start_all_agents()."""
    bus = RecordingMessageBus()

    # The real Settings, not a MagicMock: _get_agent_config reads through
    # getattr(settings, name, default), and a MagicMock answers every one of those
    # with a MagicMock instead of letting the default apply — which produces
    # failures that belong to the fixture rather than to the code under test.
    settings = Settings()

    fake_db = MagicMock()
    fake_db.connect = AsyncMock()
    fake_db.redis = AsyncMock()

    orch = AgentOrchestrator(message_bus=bus, settings=settings)

    with patch("core.orchestrator.DatabaseClient", return_value=fake_db), patch(
        "core.agent_registry.AgentRegistry.start_suspend_monitor",
        new_callable=AsyncMock,
    ):
        await orch.initialize()
        await orch.start_all_agents()

    yield orch, bus

    for agent in list(orch.agents.values()):
        try:
            await agent.stop()
        except Exception:
            pass


class TestCoreRosterStarts:
    async def test_every_core_agent_is_running_after_boot(self, booted):
        orch, _ = booted

        expected = {
            name
            for name, spec in orch.registry._specs.items()
            if spec.tier == AgentTier.CORE and orch.registry.is_enabled(name)
        }
        missing = expected - set(orch.agents)

        assert not missing, (
            f"declared CORE but not running after start_all_agents(): {sorted(missing)}. "
            "start_all_agents swallows the exception and still logs success, so this "
            "is invisible in the boot log."
        )

    async def test_the_four_bus_driven_agents_are_among_them(self, booted):
        # The roster this specifically guards: all four were CORE-declared to fix
        # them never running, and three could not be constructed at all.
        orch, _ = booted

        for name in (
            "provider_communication_agent",
            "provider_conversation_agent",
            "email_intel_agent",
            "email_parsing_agent",
        ):
            assert name in orch.agents, f"{name} did not start"

    async def test_no_agent_reports_an_error_status(self, booted):
        orch, _ = booted

        errored = {
            name: agent.metrics.last_error
            for name, agent in orch.agents.items()
            if agent.status.value == "error"
        }

        assert not errored, f"agents started but are in ERROR state: {errored}"


class TestSubscriptionsAreActuallyBound:
    """Starting is not consuming — an agent that starts but binds nothing is dead."""

    async def test_order_created_has_a_bound_queue_after_boot(self, booted):
        _, bus = booted

        bound = [b for b in bus.bindings if b[2] == "procurement.order.created"]

        assert len(bound) == 1, (
            "exactly one queue must be bound to procurement.order.created after "
            f"boot; got {bound}"
        )
        assert (
            bound[0][0]
            == "queue.provider_communication_agent.procurement_order_created"
        )

    async def test_every_declared_key_of_every_core_agent_is_bound(self, booted):
        orch, bus = booted

        bound = {(exchange, key) for _, exchange, key in bus.bindings}
        unbound = {}
        for name, agent in orch.agents.items():
            declared = set(agent.get_subscribed_routing_keys())
            if declared - bound:
                unbound[name] = sorted(declared - bound)

        assert not unbound, f"agents started without binding their keys: {unbound}"

    async def test_every_bound_queue_is_being_consumed(self, booted):
        _, bus = booted

        declared_queues = {queue for queue, _, _ in bus.bindings}
        not_consumed = declared_queues - set(bus.consumed)

        assert (
            not not_consumed
        ), f"queues declared but never consumed from: {sorted(not_consumed)}"
