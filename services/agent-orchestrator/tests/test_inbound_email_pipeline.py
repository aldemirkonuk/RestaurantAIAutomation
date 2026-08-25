"""
Inbound email pipeline wiring.

Three defects, each of which alone made the pipeline dead, and the first of which
hid the other two:

1. NEITHER AGENT WAS REGISTERED. EmailIntelAgent and EmailParsingAgent were fully
   implemented and absent from orchestrator._register_agent_classes(), so nothing
   consumed inbound vendor email at all.

2. EmailIntelAgent SUBSCRIBED TO A DEAD KEY. It listened on `email.inbound.raw`,
   which has zero publishers — the three real producers (the provider-agnostic
   inbound webhook, the Gmail bridge, the communications controller) all emit
   `email.inbound.received`.

3. EmailParsingAgent'S SIGNATURE DID NOT MATCH BaseAgent. It declared
   process_message(self, routing_key, payload) while BaseAgent dispatches
   `await self.process_message(message)` — one argument. It would have raised
   TypeError on its first message, and only never did because of defect 1.

Fixing 2 also armed a loop: EmailIntelAgent re-publishes OPERATIONAL mail to
`email.inbound.received` with `__intel_bypass: True`, and that flag was being SET
and read NOWHERE. Once this agent listened on the same key it would have received
its own re-publish and classified forever.
"""

import inspect

from core.base_agent import BaseAgent


class TestBothAgentsAreRegistered:
    def test_registry_contains_the_inbound_email_agents(self):
        from core.orchestrator import AgentOrchestrator

        source = inspect.getsource(AgentOrchestrator._register_agent_classes)

        assert '"email_intel_agent"' in source
        assert '"email_parsing_agent"' in source


class TestRoutingKeys:
    """The consumed key must be one that producers actually emit."""

    LIVE_KEY = "email.inbound.received"
    DEAD_KEY = "email.inbound.raw"

    def test_intel_agent_listens_on_the_key_with_publishers(self):
        from agents.email_intel_agent import EmailIntelAgent

        keys = EmailIntelAgent.get_subscribed_routing_keys(EmailIntelAgent)

        assert (("email.events", self.LIVE_KEY)) in keys

    def test_intel_agent_no_longer_listens_on_the_dead_key(self):
        from agents.email_intel_agent import EmailIntelAgent

        keys = EmailIntelAgent.get_subscribed_routing_keys(EmailIntelAgent)

        assert all(
            k != self.DEAD_KEY for _, k in keys
        ), "email.inbound.raw has no publishers; subscribing to it is a dead queue"

    def test_parsing_agent_listens_on_the_same_key(self):
        from agents.email_parsing_agent import EmailParsingAgent

        keys = EmailParsingAgent.get_subscribed_routing_keys(EmailParsingAgent)

        assert (("email.events", self.LIVE_KEY)) in keys


class TestSignatureContract:
    """BaseAgent dispatches process_message(message) — one argument."""

    AGENTS = [
        ("agents.email_intel_agent", "EmailIntelAgent"),
        ("agents.email_parsing_agent", "EmailParsingAgent"),
    ]

    def test_base_agent_contract_is_one_argument(self):
        params = list(inspect.signature(BaseAgent.process_message).parameters)

        assert params == ["self", "message"]

    def test_agents_match_the_dispatch_signature(self):
        for module_path, class_name in self.AGENTS:
            module = __import__(module_path, fromlist=[class_name])
            agent_class = getattr(module, class_name)

            params = list(inspect.signature(agent_class.process_message).parameters)

            assert params == ["self", "message"], (
                f"{class_name}.process_message{tuple(params)} does not match "
                f"BaseAgent's dispatch, so it would TypeError on its first message"
            )


class TestRepublishLoopIsClosed:
    """
    The re-publish guard must be READ, not merely written.

    EmailIntelAgent forwards OPERATIONAL mail to the same key it now consumes. The
    __intel_bypass flag was already being set at the re-publish site and consumed
    nowhere, so subscribing to that key armed an unbounded loop.
    """

    def test_intel_agent_sets_the_bypass_flag_when_republishing(self):
        from agents import email_intel_agent

        source = inspect.getsource(email_intel_agent)

        assert '"__intel_bypass": True' in source

    def test_intel_agent_returns_early_on_its_own_republish(self):
        from agents.email_intel_agent import EmailIntelAgent

        source = inspect.getsource(EmailIntelAgent.process_message)

        assert "__intel_bypass" in source, (
            "process_message must consume __intel_bypass or the agent reprocesses "
            "its own re-publish forever"
        )
        # The guard has to precede the classification work, or the loop still runs
        # once per hop before bailing.
        assert source.index("__intel_bypass") < source.index(
            "idempotency_key"
        ), "the bypass check must come before any processing"

    def test_parsing_agent_does_not_skip_bypassed_messages(self):
        # The flag exists to stop the CLASSIFIER reprocessing, not the parser —
        # the re-publish is precisely how OPERATIONAL mail reaches the parser.
        from agents.email_parsing_agent import EmailParsingAgent

        source = inspect.getsource(EmailParsingAgent.process_message)

        assert "return" not in source.split("__intel_bypass")[-1] or (
            "__intel_bypass" not in source
        ), "EmailParsingAgent must still parse re-published OPERATIONAL mail"
