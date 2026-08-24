"""Pin the real subscription graph.

Phase 21's success criterion #2 states "stock.events -> NotificationAgent +
ReportingAgent" and its headline describes "POSIntegrationAgent -> InventoryEngine".
Neither matches the code, and the v2.0 audit flagged both as documentation-accuracy
gaps rather than defects.

They are documentation gaps: the code is right. ReportingAgent generates reports on
a schedule or on demand -- subscribing it to stock.events would emit a report every
time a bottle is poured, which is a defect, not the criterion being met. And the
POS -> inventory path genuinely runs through BufferManager, which batches sales
before evaluating stock.

The reason this is a test and not just a corrected sentence: a docstring drifts
silently, and this exact pair of claims survived a full milestone and an audit
before anyone checked them. These assertions fail loudly the moment the graph
changes, which is the only thing that keeps a topology diagram honest.
"""

import inspect

from agents.buffer_manager import BufferManagerAgent
from agents.inventory_engine import InventoryEngineAgent
from agents.notification_agent import NotificationAgent
from agents.provider_communication_agent import ProviderCommunicationAgent
from agents.provider_conversation_agent import ProviderConversationAgent
from agents.reporting_agent import ReportingAgent
from core.base_agent import BaseAgent


def _keys(agent_cls):
    """Routing keys a class declares, without constructing or connecting it."""
    return set(agent_cls.get_subscribed_routing_keys(agent_cls))


def _all_agent_classes():
    """Every agent class the orchestrator imports, as classes, uninstantiated.

    Reading the orchestrator module rather than a hand-listed tuple is the point:
    an agent added later is covered without anyone remembering to add it here.
    """
    import core.orchestrator as orchestrator_module

    return [
        obj
        for obj in vars(orchestrator_module).values()
        if inspect.isclass(obj) and issubclass(obj, BaseAgent) and obj is not BaseAgent
    ]


def _subscribers_of(routing_key):
    """Names of every agent class declaring `routing_key`, in any exchange."""
    return sorted(
        cls.__name__
        for cls in _all_agent_classes()
        if any(key == routing_key for _, key in _keys(cls))
    )


class TestGoldenPathTopology:
    def test_buffer_manager_sits_between_pos_and_inventory(self):
        # The ROADMAP's "POSIntegrationAgent -> InventoryEngine" skips a hop. POS
        # sales land on BufferManager, which batches and re-publishes
        # stock.evaluated; InventoryEngine consumes that, never the raw sale.
        assert ("pos.events", "pos.sale.completed") in _keys(BufferManagerAgent)
        assert ("stock.events", "stock.evaluated") in _keys(InventoryEngineAgent)
        assert ("pos.events", "pos.sale.completed") not in _keys(InventoryEngineAgent)

    def test_notification_agent_does_listen_to_stock_events(self):
        # Half of criterion #2 is correct and worth pinning so a refactor cannot
        # quietly drop low-stock alerting.
        keys = _keys(NotificationAgent)
        assert ("stock.events", "stock.threshold.breached") in keys
        assert ("stock.events", "stock.critical") in keys

    def test_reporting_agent_does_not_listen_to_stock_events(self):
        # The other half is wrong, and deliberately so. Reports are scheduled or
        # on-demand; wiring them to stock.events would generate one per pour.
        keys = _keys(ReportingAgent)
        assert not any(exchange == "stock.events" for exchange, _ in keys)

    def test_reporting_agent_is_triggered_only_by_reporting_events(self):
        keys = _keys(ReportingAgent)
        assert keys == {
            ("reporting.events", "reporting.generate_scheduled_report"),
            ("reporting.events", "reporting.generate_event_report"),
            ("reporting.events", "reporting.generate_on_demand_report"),
        }


class TestOrderCreatedHasExactlyOneOwner:
    """One order, one draft, one manager notification.

    ProviderConversationAgent and ProviderCommunicationAgent both subscribed to
    `procurement.order.created`, and both respond to it the same way: generate an
    outbound message, stage a PENDING_APPROVAL row in procurement_conversations,
    notify the manager. Nothing dedups between them, so the manager gets two
    drafts and two notifications for one order.

    It never showed, because neither agent is in DEFAULT_AGENT_SPECS and so both
    silently default to ON_DEMAND, which start_all_agents() never starts. The
    duplicate is latent behind that, and declaring either agent CORE releases it.

    Phase 32 D-32-01 splits the loop by step, not by agent capability:
      step 1  order created            → ProviderCommunicationAgent drafts
      step 3  provider replies         → ProviderConversationAgent drafts
    Both agents can draft to a provider, which is exactly why the split has to be
    written down somewhere that fails.
    """

    KEY = "procurement.order.created"

    def test_exactly_one_agent_subscribes_to_order_created(self):
        subscribers = _subscribers_of(self.KEY)

        assert len(subscribers) == 1, (
            f"{self.KEY} must have exactly one consumer; found {subscribers}. "
            "Two consumers means two drafts and two manager notifications per order."
        )

    def test_the_owner_is_the_phase_32_outbound_engine(self):
        assert _subscribers_of(self.KEY) == [ProviderCommunicationAgent.__name__]

    def test_conversation_agent_owns_the_reply_half_not_the_order_half(self):
        keys = _keys(ProviderConversationAgent)

        # Step 3 — the half it does own. Losing this is the opposite regression:
        # provider replies stop producing drafts.
        assert ("conversation.events", "conversation.inbound.email") in keys

        # Its one procurement trigger is the explicit intent request. ProcurementAgent
        # publishes procurement.conversation_request AND procurement.order.created for
        # the same auto-reorder, so listening to both would double this agent against
        # itself even with the other agent removed entirely.
        procurement_keys = {key for _, key in keys if key.startswith("procurement.")}
        assert procurement_keys == {"procurement.conversation_request"}
