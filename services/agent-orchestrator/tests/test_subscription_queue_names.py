"""Every subscription must name a queue the AMQP codec will send.

provider_conversation_agent has been CORE since 2026-08-24 (b98c79cc7) and had
not run in production since. Its last subscription is
`system.provider_conversation.*`. BaseAgent named each queue by replacing dots
and nothing else, pamqp (the codec under aio-pika) refuses `*` in a queue name,
and every boot logged "Failed to start agent provider_conversation_agent:
Invalid value for queue". Before #415 the orchestrator dropped a failed agent
from its health roster, so nothing reported it. Since #415 it is kept, reports
status=error, and `Deploy to Production` has been red on it since 2026-09-23.

These tests check names with pamqp's own frames, which is the code that refused
it in production.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pamqp import commands

from agents.provider_conversation_agent import ProviderConversationAgent
from core.base_agent import subscription_queue_name
from core.orchestrator import AgentOrchestrator


def _codec_accepts(queue_name: str, exchange: str, routing_key: str) -> None:
    """Build the three frames a subscription sends; pamqp validates each."""
    commands.Queue.Declare(queue=queue_name, durable=True)
    commands.Queue.Bind(queue=queue_name, exchange=exchange, routing_key=routing_key)
    commands.Basic.Consume(queue=queue_name)


class CodecCheckingBus:
    """Stands in for MessageBus and sends nothing, but builds the real frames."""

    def __init__(self):
        self.declared: list[tuple[str, str, str]] = []

    async def declare_queue(
        self, queue_name, exchange_name, routing_key, durable=True, max_priority=10
    ):
        _codec_accepts(queue_name, exchange_name, routing_key)
        self.declared.append((queue_name, exchange_name, routing_key))

    async def consume(self, queue_name, callback, auto_ack=False):
        commands.Basic.Consume(queue=queue_name)
        return f"ctag-{len(self.declared)}"


def _class_map() -> dict:
    """The orchestrator's own name -> class map, built without a broker."""
    stub = SimpleNamespace(registry=MagicMock())
    AgentOrchestrator._register_agent_classes(stub)
    return stub.agent_classes


class TestTheProductionFailure:
    def test_the_codec_refuses_the_name_the_old_rule_produced(self):
        # The old derivation, verbatim. This pins that the codec, not the
        # broker, is what refused it, with the exact production message.
        old = "queue.provider_conversation_agent." + (
            "system.provider_conversation.*".replace(".", "_")
        )
        with pytest.raises(ValueError, match="Invalid value for queue"):
            commands.Queue.Declare(queue=old, durable=True)

    async def test_provider_conversation_agent_subscribes_every_key(self):
        bus = CodecCheckingBus()
        agent = ProviderConversationAgent(
            agent_name="provider_conversation_agent",
            message_bus=bus,
            database=None,
            config={},
        )

        await agent._setup_subscriptions()

        declared = agent.get_subscribed_routing_keys()
        assert len(bus.declared) == len(declared)
        assert (
            "queue.provider_conversation_agent.system_provider_conversation_star",
            "system.control",
            "system.provider_conversation.*",
        ) in bus.declared


class TestExistingQueuesKeepTheirNames:
    """Queues are durable. A name that moves strands the old queue on the broker."""

    @pytest.mark.parametrize(
        "agent, key, name",
        [
            # As logged by the production boot of 2026-09-23 05:47.
            (
                "provider_conversation_agent",
                "conversation.auto_reply.urgency",
                "queue.provider_conversation_agent.conversation_auto_reply_urgency",
            ),
            (
                "provider_communication_agent",
                "procurement.order.created",
                "queue.provider_communication_agent.procurement_order_created",
            ),
            ("state_invariant_enforcer", "#", "queue.state_invariant_enforcer.#"),
        ],
    )
    def test_a_name_that_was_already_valid_does_not_change(self, agent, key, name):
        assert subscription_queue_name(agent, key) == name


class TestEveryKeyGetsASendableName:
    def test_the_two_wildcards_do_not_share_a_name(self):
        # `a.*` matches one word and `a.#` any number; one queue for both would
        # merge two different subscriptions.
        assert subscription_queue_name("x", "a.*") != subscription_queue_name(
            "x", "a.#"
        )

    @pytest.mark.parametrize(
        "key", ["a.*.b", "*.*", "price.€", "tab\tkey", "a+b", "semi;colon"]
    )
    def test_any_routing_key_yields_a_name_the_codec_accepts(self, key):
        _codec_accepts(subscription_queue_name("some_agent", key), "ex", key)

    def test_every_subscription_of_every_registered_agent(self):
        # Every class the orchestrator can build, not only CORE ones: an
        # OPTIONAL agent switched on later fails the same way at its first start.
        refused = {}
        for name, cls in _class_map().items():
            agent = cls(agent_name=name, message_bus=None, database=None, config={})
            for exchange, key in agent.get_subscribed_routing_keys():
                queue = subscription_queue_name(name, key)
                try:
                    _codec_accepts(queue, exchange, key)
                except ValueError as exc:
                    refused[f"{name} {exchange}/{key}"] = f"{queue}: {exc}"

        assert not refused, f"the AMQP codec refuses these queue names: {refused}"
