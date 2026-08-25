"""
The agent roster must be fully declared: every registered agent needs a spec, and
a bus-driven agent needs a tier that actually starts it.

Three ways an agent has reached "registered" in this repo and still consumed
nothing, each pinned below:

1. Absent from DEFAULT_AGENT_SPECS. register_from_defaults() used to fall back to
   `DEFAULT_AGENT_SPECS.get(name, {})`, handing over the dataclass defaults in
   silence. An agent nobody had thought about was indistinguishable from one
   deliberately declared ON_DEMAND with no dependencies.

2. Left at tier ON_DEMAND. start_all_agents() starts get_startup_order(), which
   filters to CORE. Nothing in the repo calls registry.get_or_create() or
   start_agent(), so ON_DEMAND is not "lazy" — it is "never". Defects 1 and 2
   compound: the silent fallback's default value is the tier that never runs.

3. Absent from the orchestrator class map entirely (see
   test_inbound_email_pipeline.py, which covers that case).
"""

import ast
import inspect
from pathlib import Path

import pytest

from core.agent_registry import AgentRegistry, AgentTier, DEFAULT_AGENT_SPECS
from core.orchestrator import AgentOrchestrator

AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"


def _class_map_names() -> set:
    """
    The keys of orchestrator._register_agent_classes()'s dict, read statically.

    Parsed rather than called because building a real AgentOrchestrator wants
    settings, a database and a message bus; the roster is a literal and the whole
    point is to check it without booting anything.
    """
    source = inspect.getsource(AgentOrchestrator._register_agent_classes)
    tree = ast.parse(source.lstrip())
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict) and node.keys:
            return {
                k.value
                for k in node.keys
                if isinstance(k, ast.Constant) and isinstance(k.value, str)
            }
    raise AssertionError("no agent class-map dict found in _register_agent_classes")


class TestEveryRegisteredAgentIsDeclared:
    def test_class_map_and_specs_agree(self):
        missing = _class_map_names() - set(DEFAULT_AGENT_SPECS)

        assert missing == set(), (
            f"{sorted(missing)} are in the orchestrator class map but have no "
            f"DEFAULT_AGENT_SPECS entry, so they would default to ON_DEMAND and "
            f"never start."
        )

    def test_registering_an_undeclared_agent_raises(self):
        # The regression itself: this used to register happily and log nothing.
        with pytest.raises(ValueError, match="no DEFAULT_AGENT_SPECS entry"):
            AgentRegistry().register_from_defaults({"agent_nobody_declared": object})

    def test_the_error_names_every_missing_agent_at_once(self):
        with pytest.raises(ValueError) as exc:
            AgentRegistry().register_from_defaults(
                {"undeclared_one": object, "undeclared_two": object}
            )

        assert "undeclared_one" in str(exc.value)
        assert "undeclared_two" in str(exc.value)

    def test_declared_agents_still_register(self):
        registry = AgentRegistry()

        registry.register_from_defaults({name: object for name in DEFAULT_AGENT_SPECS})

        assert registry.registered_count == len(DEFAULT_AGENT_SPECS)

    def test_every_spec_declares_a_tier(self):
        untiered = [n for n, cfg in DEFAULT_AGENT_SPECS.items() if "tier" not in cfg]

        assert untiered == [], (
            f"{sorted(untiered)} have a spec but no tier, which would default to "
            f"ON_DEMAND — the same silent failure one level down."
        )

    def test_a_spec_without_a_tier_raises(self, monkeypatch):
        # Present-but-incomplete is the near miss the missing-entry check alone
        # would wave through.
        monkeypatch.setitem(
            DEFAULT_AGENT_SPECS, "agent_with_no_tier", {"description": "forgot a tier"}
        )

        with pytest.raises(ValueError, match="declares no tier"):
            AgentRegistry().register_from_defaults({"agent_with_no_tier": object})


class TestBusDrivenAgentsAreStartable:
    """
    An agent whose only input is the message bus has to be CORE, because
    ON_DEMAND never starts and therefore never subscribes.
    """

    COMMUNICATION_AGENTS = [
        "email_intel_agent",
        "email_parsing_agent",
        "provider_conversation_agent",
        "provider_communication_agent",
    ]

    @pytest.mark.parametrize("name", COMMUNICATION_AGENTS)
    def test_communication_agents_are_core(self, name):
        # All four have live NestJS publishers upstream — email.inbound.received,
        # procurement.order.created, conversation.approved — and all four were
        # undeclared, hence ON_DEMAND, hence never started.
        assert DEFAULT_AGENT_SPECS[name]["tier"] == AgentTier.CORE

    @pytest.mark.parametrize("name", COMMUNICATION_AGENTS)
    def test_communication_agents_reach_the_startup_order(self, name):
        registry = AgentRegistry()
        registry.register_from_defaults({n: object for n in DEFAULT_AGENT_SPECS})

        assert name in registry.get_startup_order()

    def test_dependencies_are_themselves_registered(self):
        # A dependency absent from the specs is dropped by the topological sort
        # without complaint, which would reorder startup silently.
        for name, cfg in DEFAULT_AGENT_SPECS.items():
            for dep in cfg.get("dependencies", []):
                assert (
                    dep in DEFAULT_AGENT_SPECS
                ), f"{name} depends on {dep}, which has no spec"

    def test_core_dependencies_are_core(self):
        # get_startup_order() only visits dependencies that are themselves CORE,
        # so a CORE agent depending on a non-CORE one gets no ordering guarantee.
        for name, cfg in DEFAULT_AGENT_SPECS.items():
            if cfg.get("tier") != AgentTier.CORE:
                continue
            for dep in cfg.get("dependencies", []):
                assert DEFAULT_AGENT_SPECS[dep].get("tier") == AgentTier.CORE, (
                    f"CORE agent {name} depends on {dep}, which is not CORE — "
                    f"the startup order cannot honour that edge."
                )


class TestNoOrphanAgentModules:
    """
    Every agent module on disk is either in the class map or is a documented
    standalone. book_scraper_agent and dataset_creator_agent were neither: not
    registered, and subscribed to exchanges with no publishers in the repo.
    """

    # Not a BaseAgent and not on the bus — driven by explicit start()/stop().
    # See its docstring.
    STANDALONE = {"recurring_order_agent"}

    def test_every_agent_module_is_registered_or_standalone(self):
        on_disk = {p.stem for p in AGENTS_DIR.glob("*.py") if p.stem != "__init__"}

        orphans = on_disk - _class_map_names() - self.STANDALONE

        assert orphans == set(), (
            f"{sorted(orphans)} are agent modules that nothing registers and that "
            f"are not declared standalone. Either add them to the orchestrator "
            f"class map and DEFAULT_AGENT_SPECS, add them to STANDALONE with a "
            f"docstring saying how they are driven, or delete them."
        )
