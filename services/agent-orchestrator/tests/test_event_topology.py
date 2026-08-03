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

from agents.buffer_manager import BufferManagerAgent
from agents.inventory_engine import InventoryEngineAgent
from agents.notification_agent import NotificationAgent
from agents.reporting_agent import ReportingAgent


def _keys(agent_cls):
    """Routing keys a class declares, without constructing or connecting it."""
    return set(agent_cls.get_subscribed_routing_keys(agent_cls))


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
