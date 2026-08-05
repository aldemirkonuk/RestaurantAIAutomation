"""
Agent gating: the OPTIONAL tier must actually gate, and a stub must never run.

Two defects these pin down, both found by reading the live registry rather than
the docs:

1. The OPTIONAL tier was UNREACHABLE. AgentRegistry.is_enabled() looks up
   `AGENT_{NAME}_ENABLED` in the feature-flag dict, but the orchestrator's
   _build_feature_flags() only ever populated three FEATURE_* keys — so the flag
   the tier documented ("disabled unless feature flag is set") was one nothing
   read. Setting it in the environment silently did nothing.

2. Turning the gate on would then start an unimplemented stub. Five agents log
   the event and return; an agent that subscribes to real events and discards
   them is indistinguishable from a working one on any dashboard, so it must fail
   loudly at boot instead.
"""

import os

import pytest

from core.agent_registry import AgentRegistry, AgentTier, DEFAULT_AGENT_SPECS


def _registry(flags: dict) -> AgentRegistry:
    """
    A registry with the real specs loaded.

    is_enabled() returns False for an unknown name, so a bare AgentRegistry()
    reports everything disabled for the wrong reason — register_from_defaults()
    is what attaches the tier and flag each assertion is actually about.
    """
    registry = AgentRegistry(feature_flags=flags)
    registry.register_from_defaults({name: object for name in DEFAULT_AGENT_SPECS})
    return registry


def _flags_from_env() -> dict:
    """Mirror of AgentOrchestrator._build_feature_flags' env sweep."""
    return {
        k: v.strip().lower() in ("1", "true", "yes", "on")
        for k, v in os.environ.items()
        if k.startswith("AGENT_") and k.endswith("_ENABLED")
    }


class TestOptionalTierGate:
    def test_optional_agent_is_off_when_no_flag_is_set(self):
        registry = _registry({})

        assert registry.is_enabled("ghost_inventory_agent") is False

    def test_optional_agent_turns_on_when_its_flag_is_set(self):
        # This is what was impossible before: the key exists, so the documented
        # switch has something to read.
        registry = _registry({"AGENT_GHOST_INVENTORY_AGENT_ENABLED": True})

        assert registry.is_enabled("ghost_inventory_agent") is True

    def test_env_sweep_produces_the_key_is_enabled_looks_for(self, monkeypatch):
        # The exact bug: is_enabled() reads AGENT_<NAME>_ENABLED, and the flag
        # builder never produced keys of that shape.
        monkeypatch.setenv("AGENT_COMPLIANCE_AGENT_ENABLED", "true")

        flags = _flags_from_env()

        assert flags.get("AGENT_COMPLIANCE_AGENT_ENABLED") is True
        assert _registry(flags).is_enabled("compliance_agent") is True

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("true", True),
            ("TRUE", True),
            ("1", True),
            ("yes", True),
            ("on", True),
            ("false", False),
            ("0", False),
            ("", False),
            ("maybe", False),
        ],
    )
    def test_env_values_are_parsed_not_truthiness_tested(
        self, monkeypatch, raw, expected
    ):
        # os.environ values are strings, so a bare truthiness check would read
        # "false" as enabled.
        monkeypatch.setenv("AGENT_AUTO_PILOT_AGENT_ENABLED", raw)

        assert _flags_from_env()["AGENT_AUTO_PILOT_AGENT_ENABLED"] is expected

    def test_core_agents_ignore_the_gate(self):
        registry = _registry({})

        assert registry.is_enabled("inventory_engine") is True


class TestStubsAreMarked:
    """Every unimplemented agent declares IS_STUB so the orchestrator can refuse it."""

    STUBS = [
        ("agents.ghost_inventory_agent", "GhostInventoryAgent"),
        ("agents.auto_pilot_agent", "AutoPilotAgent"),
        ("agents.negotiation_playbook_agent", "NegotiationPlaybookAgent"),
        ("agents.shrinkage_detective_agent", "ShrinkageDetectiveAgent"),
        ("agents.compliance_agent", "ComplianceAgent"),
    ]

    @pytest.mark.parametrize("module_path,class_name", STUBS)
    def test_stub_declares_itself(self, module_path, class_name):
        module = __import__(module_path, fromlist=[class_name])
        agent_class = getattr(module, class_name)

        assert getattr(agent_class, "IS_STUB", False) is True, (
            f"{class_name} has an empty process_message() but does not declare "
            f"IS_STUB, so the orchestrator would start it and it would consume "
            f"events silently."
        )

    def test_implemented_agents_are_not_marked_as_stubs(self):
        # The marker must stay meaningful; mislabelling a real agent would take a
        # working one out of service at boot.
        from agents.inventory_engine import InventoryEngineAgent
        from agents.procurement_agent import ProcurementAgent

        assert getattr(InventoryEngineAgent, "IS_STUB", False) is False
        assert getattr(ProcurementAgent, "IS_STUB", False) is False

    def test_every_optional_tier_agent_is_currently_a_stub(self):
        # Documents today's reality: OPTIONAL is exactly the set of unimplemented
        # agents. If a future agent is OPTIONAL *and* implemented this fails, which
        # is the moment to reconsider whether the marker or the tier is wrong.
        optional = [
            name
            for name, cfg in DEFAULT_AGENT_SPECS.items()
            if cfg.get("tier") == AgentTier.OPTIONAL
        ]

        assert sorted(optional) == sorted(
            n
            for n, _ in [
                ("ghost_inventory_agent", 0),
                ("negotiation_playbook_agent", 0),
                ("auto_pilot_agent", 0),
                ("compliance_agent", 0),
                ("shrinkage_detective_agent", 0),
            ]
        )
