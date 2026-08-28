"""
Agent Registry
==============
Manages agent class registration, lazy instantiation, feature flags,
dependency ordering, and auto-suspend lifecycle for idle agents.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Dict, List, Optional, Set, Type
from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime

from utils.logger import setup_logger

logger = setup_logger(__name__)


# =============================================================================
# CONFIGURATION
# =============================================================================


class AgentTier(str, Enum):
    """Agent tier determines startup behavior."""

    CORE = "core"  # Always start on boot
    ON_DEMAND = "on_demand"  # Lazy-loaded when first message arrives
    OPTIONAL = "optional"  # Disabled unless feature flag is set


@dataclass
class AgentSpec:
    """Specification for a registered agent."""

    name: str
    agent_class: Type
    tier: AgentTier = AgentTier.ON_DEMAND
    dependencies: List[str] = field(default_factory=list)
    feature_flag: Optional[str] = (
        None  # Env var name (e.g., "FEATURE_VISUAL_VERIFICATION")
    )
    idle_timeout_seconds: int = 300  # 5 minutes default
    description: str = ""


# Default agent configurations
DEFAULT_AGENT_SPECS: Dict[str, dict] = {
    # Core agents (always start)
    "buffer_manager": {
        "tier": AgentTier.CORE,
        "dependencies": [],
        "description": "Processes POS events with buffering",
    },
    "inventory_engine": {
        "tier": AgentTier.CORE,
        "dependencies": ["buffer_manager"],
        "description": "Core inventory management",
    },
    "inequality_detector": {
        "tier": AgentTier.CORE,
        "dependencies": ["inventory_engine"],
        "description": "Detects stock inequalities",
    },
    "state_invariant_enforcer": {
        "tier": AgentTier.CORE,
        "dependencies": ["inventory_engine"],
        "description": "Global guardrails",
    },
    "notification_agent": {
        "tier": AgentTier.CORE,
        "dependencies": [],
        "description": "Communication layer",
    },
    "procurement_agent": {
        "tier": AgentTier.CORE,
        "dependencies": ["inventory_engine", "notification_agent"],
        "description": "Procurement logic",
    },
    "calendar_agent": {
        "tier": AgentTier.CORE,
        "dependencies": [],
        "description": "Calendar integration",
    },
    "reporting_agent": {
        "tier": AgentTier.CORE,
        "dependencies": [],
        "description": "Report generation",
    },
    "pos_integration_agent": {
        "tier": AgentTier.CORE,
        "dependencies": [],
        "description": "POS data ingestion",
    },
    # Communication agents (Phase 24 inbound email, Phase 32 outbound drafts).
    #
    # These four are CORE for one reason: ON_DEMAND does not start anything.
    # start_all_agents() walks get_startup_order(), which filters to CORE, and
    # nothing in the repo calls registry.get_or_create() or start_agent() — so a
    # bus-driven agent left at the ON_DEMAND default is proxied, never
    # instantiated, and never subscribes. All four sat there: absent from
    # DEFAULT_AGENT_SPECS, silently defaulted to ON_DEMAND (see
    # register_from_defaults), and dead despite live upstream publishers —
    # email.inbound.received has three NestJS producers, procurement.order.created
    # has three, conversation.approved has two. Phase 32's plan asked only for the
    # orchestrator class-map entry and its verification passed on that alone,
    # which is how a second cohort of agents reached "registered" and stopped.
    #
    # idle_timeout_seconds is deliberately unset: the auto-suspend monitor skips
    # CORE, so any value here would be decoration.
    "provider_conversation_agent": {
        "tier": AgentTier.CORE,
        "dependencies": ["procurement_agent", "notification_agent", "calendar_agent"],
        "description": "Provider communication gateway — sessions, intelligence extraction, approvals",
    },
    "email_parsing_agent": {
        "tier": AgentTier.CORE,
        "dependencies": ["procurement_agent"],
        "description": "Inbound vendor email threading and conversation storage",
    },
    "email_intel_agent": {
        # Ordered after email_parsing_agent because it re-publishes OPERATIONAL
        # mail onto email.inbound.received: a topic exchange drops messages with
        # no bound queue, so the consumer has to be up first.
        "tier": AgentTier.CORE,
        "dependencies": ["email_parsing_agent", "notification_agent"],
        "description": "Inbox triage — OPERATIONAL/PROMO/NOISE classification and promo extraction",
    },
    "provider_communication_agent": {
        # Sole owner of procurement.order.created (Phase 32 D-32-01 step 1).
        # provider_conversation_agent subscribed to it too, and both stage a
        # PENDING_APPROVAL row plus a manager notification — harmless while
        # neither agent started, two drafts per order the moment they did. That
        # subscription was removed in the same push that made these CORE;
        # tests/test_event_topology.py pins the single owner.
        "tier": AgentTier.CORE,
        "dependencies": ["procurement_agent", "notification_agent"],
        "description": "Outbound AI draft engine with constraint enforcement",
    },
    # Phase 2 agents (on-demand)
    "visual_verification_agent": {
        "tier": AgentTier.ON_DEMAND,
        "dependencies": ["inventory_engine"],
        "feature_flag": "FEATURE_VISUAL_VERIFICATION",
        "description": "Delivery verification with YOLO",
    },
    "sommelier_agent": {
        "tier": AgentTier.ON_DEMAND,
        "dependencies": [],
        "feature_flag": "FEATURE_SOMMELIER_AI",
        "description": "Wine recommendations",
    },
    "menu_analyzer_agent": {
        "tier": AgentTier.ON_DEMAND,
        "dependencies": [],
        "feature_flag": "FEATURE_MENU_ANALYZER",
        "description": "Menu scanning and analysis",
    },
    "rfq_agent": {
        "tier": AgentTier.ON_DEMAND,
        "dependencies": ["procurement_agent"],
        "description": "Request for quotation",
    },
    # P1 agents (optional)
    "ghost_inventory_agent": {
        "tier": AgentTier.OPTIONAL,
        "dependencies": ["inventory_engine"],
        "description": "Ghost inventory detection",
    },
    "negotiation_playbook_agent": {
        "tier": AgentTier.OPTIONAL,
        "dependencies": ["procurement_agent"],
        "description": "Negotiation playbooks",
    },
    "auto_pilot_agent": {
        "tier": AgentTier.OPTIONAL,
        "dependencies": ["procurement_agent"],
        "description": "Auto-pilot procurement",
    },
    "compliance_agent": {
        "tier": AgentTier.OPTIONAL,
        "dependencies": [],
        "description": "Compliance checks",
    },
    "shrinkage_detective_agent": {
        "tier": AgentTier.OPTIONAL,
        "dependencies": ["inventory_engine"],
        "description": "Shrinkage detection",
    },
    # Scheduled purchasing (ADR 0039 Track A3).
    #
    # OPTIONAL, not ON_DEMAND, and the distinction is load-bearing here. This
    # agent owns a daily sweep over recurring_orders and stages purchase
    # proposals; OPTIONAL means it needs AGENT_RECURRING_ORDER_AGENT_ENABLED
    # before it gets a proxy at all, which is the same gate the five P1 stubs
    # sit behind. It is deliberately NOT CORE: bringing scheduled purchasing
    # inside the harness is this slice's job, deciding to run it against live
    # tenants is not, and a schedule sweep that starts on boot in every
    # environment is exactly the kind of change that should be a decision rather
    # than a side effect of a refactor.
    #
    # Its dependency on notification_agent is real: the reminder and
    # approval_needed events it publishes on recurring.events have no other
    # consumer, so starting it without one would stage proposals nobody is told
    # about.
    "recurring_order_agent": {
        "tier": AgentTier.OPTIONAL,
        "dependencies": ["notification_agent"],
        "description": "Recurring order schedule — stages purchase proposals (never places orders)",
    },
    # SimPOS testbed — catalog drift (sim-* tenants only)
    "drift_agent": {
        "tier": AgentTier.ON_DEMAND,
        "dependencies": [],
        "description": "SimPOS catalog ↔ WineOps mapping/inventory drift",
    },
}


# =============================================================================
# LAZY AGENT PROXY
# =============================================================================


class LazyAgentProxy:
    """
    Proxy that delays agent instantiation until first access.
    Supports auto-suspend of idle agents.
    """

    def __init__(
        self,
        spec: AgentSpec,
        factory: Callable[..., Any],
        factory_kwargs: Dict[str, Any],
    ):
        self.spec = spec
        self._factory = factory
        self._factory_kwargs = factory_kwargs
        self._instance: Optional[Any] = None
        self._is_started: bool = False
        self._is_suspended: bool = False
        self._last_activity: float = time.time()
        self._message_count: int = 0
        self._error_count: int = 0
        self._created_at: Optional[datetime] = None

    @property
    def is_loaded(self) -> bool:
        return self._instance is not None

    @property
    def is_active(self) -> bool:
        return self._is_started and not self._is_suspended

    @property
    def state(self) -> str:
        if not self._instance:
            return "idle"
        if self._is_suspended:
            return "suspended"
        if self._is_started:
            return "active"
        return "loaded"

    @property
    def idle_seconds(self) -> float:
        return time.time() - self._last_activity

    async def get_instance(self):
        """Get or create the agent instance (lazy loading)."""
        if self._instance is None:
            logger.info(f"Lazy-loading agent: {self.spec.name}")
            self._instance = self._factory(**self._factory_kwargs)
            self._created_at = datetime.utcnow()
        return self._instance

    async def ensure_started(self):
        """Ensure the agent is instantiated and started."""
        instance = await self.get_instance()
        if not self._is_started:
            await instance.start()
            self._is_started = True
            self._is_suspended = False
            logger.info(f"Started agent: {self.spec.name}")
        elif self._is_suspended:
            await self.resume()
        self._last_activity = time.time()
        return instance

    async def suspend(self):
        """Suspend an idle agent to free resources."""
        if self._instance and self._is_started and not self._is_suspended:
            try:
                # Stop consuming from queues but keep instance in memory
                if hasattr(self._instance, "pause"):
                    await self._instance.pause()
                self._is_suspended = True
                logger.info(
                    f"Suspended idle agent: {self.spec.name} (idle for {self.idle_seconds:.0f}s)"
                )
            except Exception as e:
                logger.warning(f"Failed to suspend agent {self.spec.name}: {e}")

    async def resume(self):
        """Resume a suspended agent."""
        if self._instance and self._is_suspended:
            try:
                if hasattr(self._instance, "resume"):
                    await self._instance.resume()
                elif hasattr(self._instance, "start"):
                    await self._instance.start()
                self._is_suspended = False
                self._last_activity = time.time()
                logger.info(f"Resumed agent: {self.spec.name}")
            except Exception as e:
                logger.warning(f"Failed to resume agent {self.spec.name}: {e}")

    async def stop(self):
        """Stop and unload the agent."""
        if self._instance:
            try:
                if hasattr(self._instance, "stop"):
                    await self._instance.stop()
                self._is_started = False
                self._is_suspended = False
                logger.info(f"Stopped agent: {self.spec.name}")
            except Exception as e:
                logger.warning(f"Error stopping agent {self.spec.name}: {e}")

    def record_activity(self):
        """Record that the agent processed a message."""
        self._last_activity = time.time()
        self._message_count += 1

    def record_error(self):
        """Record an error."""
        self._error_count += 1

    def get_status(self) -> Dict[str, Any]:
        """Get status info for health endpoints."""
        return {
            "name": self.spec.name,
            "tier": self.spec.tier.value,
            "state": self.state,
            "loaded": self.is_loaded,
            "started": self._is_started,
            "suspended": self._is_suspended,
            "idle_seconds": round(self.idle_seconds, 1),
            "message_count": self._message_count,
            "error_count": self._error_count,
            "created_at": self._created_at.isoformat() if self._created_at else None,
            "description": self.spec.description,
        }


# =============================================================================
# AGENT REGISTRY
# =============================================================================


class AgentRegistry:
    """
    Central registry for agent lifecycle management.
    Supports lazy loading, feature flags, dependency ordering, and auto-suspend.
    """

    def __init__(self, feature_flags: Optional[Dict[str, bool]] = None):
        self._specs: Dict[str, AgentSpec] = {}
        self._proxies: Dict[str, LazyAgentProxy] = {}
        self._feature_flags = feature_flags or {}
        self._suspend_task: Optional[asyncio.Task] = None

    def register(
        self,
        name: str,
        agent_class: Type,
        tier: AgentTier = AgentTier.ON_DEMAND,
        dependencies: Optional[List[str]] = None,
        feature_flag: Optional[str] = None,
        idle_timeout_seconds: int = 300,
        description: str = "",
    ) -> None:
        """Register an agent class."""
        spec = AgentSpec(
            name=name,
            agent_class=agent_class,
            tier=tier,
            dependencies=dependencies or [],
            feature_flag=feature_flag,
            idle_timeout_seconds=idle_timeout_seconds,
            description=description,
        )
        self._specs[name] = spec
        logger.debug(f"Registered agent: {name} (tier={tier.value})")

    def register_from_defaults(self, agent_classes: Dict[str, Type]) -> None:
        """
        Register agents using DEFAULT_AGENT_SPECS configuration.

        Raises if any agent class has no spec, or has one that omits `tier`. This
        used to be a `DEFAULT_AGENT_SPECS.get(name, {})`, which handed the agent
        the dataclass defaults — ON_DEMAND, no dependencies, no feature flag — and
        said nothing. An undeclared agent was therefore indistinguishable from one
        deliberately declared ON_DEMAND, and since ON_DEMAND agents are never
        started, four of them were quietly inert with live publishers upstream.

        `tier` is checked separately because defaulting it reproduces the same
        defect one level down: a spec that exists but omits the key would still
        silently become the tier that never runs. The other fields may be omitted
        — an absent `dependencies` means no ordering edge and an absent
        `feature_flag` means no gate, both of which are honest readings.

        A warning is the wrong instrument here: this repo has already learned that
        an agent which looks registered and consumes nothing reads as healthy on
        every dashboard. The condition is also a pure authoring mistake, fully
        determined at import time by the class map — so it belongs at boot, in
        dev and CI, not in a log line someone greps for after an outage. Every
        offending name is reported at once so the whole roster is fixed in one pass.
        """
        missing = [name for name in agent_classes if name not in DEFAULT_AGENT_SPECS]
        if missing:
            raise ValueError(
                f"Agent(s) registered with no DEFAULT_AGENT_SPECS entry: "
                f"{', '.join(sorted(missing))}. Without a spec an agent silently "
                f"defaults to tier=ON_DEMAND, which start_all_agents() never "
                f"starts — it would be registered, proxied, and never subscribe. "
                f"Add an entry to DEFAULT_AGENT_SPECS in core/agent_registry.py "
                f"declaring at minimum its tier and dependencies."
            )

        untiered = [
            name for name in agent_classes if "tier" not in DEFAULT_AGENT_SPECS[name]
        ]
        if untiered:
            raise ValueError(
                f"Agent(s) whose DEFAULT_AGENT_SPECS entry declares no tier: "
                f"{', '.join(sorted(untiered))}. Declare one explicitly — CORE to "
                f"start on boot (required for anything driven by the message bus), "
                f"ON_DEMAND only for agents invoked directly by a route or job, "
                f"OPTIONAL for flag-gated agents."
            )

        for name, agent_class in agent_classes.items():
            defaults = DEFAULT_AGENT_SPECS[name]
            self.register(
                name=name,
                agent_class=agent_class,
                tier=defaults["tier"],
                dependencies=defaults.get("dependencies", []),
                feature_flag=defaults.get("feature_flag"),
                idle_timeout_seconds=defaults.get("idle_timeout_seconds", 300),
                description=defaults.get("description", ""),
            )

    def is_enabled(self, name: str) -> bool:
        """Check if an agent is enabled (feature flag check)."""
        spec = self._specs.get(name)
        if not spec:
            return False

        # Core agents are always enabled
        if spec.tier == AgentTier.CORE:
            return True

        # Check feature flag
        if spec.feature_flag:
            flag_value = self._feature_flags.get(spec.feature_flag, False)
            if not flag_value:
                return False

        # Optional agents need explicit enablement
        if spec.tier == AgentTier.OPTIONAL:
            env_key = f"AGENT_{name.upper()}_ENABLED"
            return self._feature_flags.get(env_key, False)

        return True

    def create_proxy(
        self,
        name: str,
        factory: Callable[..., Any],
        factory_kwargs: Dict[str, Any],
    ) -> LazyAgentProxy:
        """Create a lazy proxy for an agent."""
        spec = self._specs.get(name)
        if not spec:
            raise ValueError(f"Agent {name} not registered")

        proxy = LazyAgentProxy(
            spec=spec, factory=factory, factory_kwargs=factory_kwargs
        )
        self._proxies[name] = proxy
        return proxy

    async def get_or_create(self, name: str) -> Optional[Any]:
        """Get an agent instance, creating it if necessary (lazy loading)."""
        proxy = self._proxies.get(name)
        if not proxy:
            logger.warning(f"No proxy found for agent: {name}")
            return None

        if not self.is_enabled(name):
            logger.debug(f"Agent {name} is disabled by feature flag")
            return None

        return await proxy.ensure_started()

    def get_startup_order(self) -> List[str]:
        """Get agents in dependency-resolved startup order (only CORE tier)."""
        core_agents = [
            name
            for name, spec in self._specs.items()
            if spec.tier == AgentTier.CORE and self.is_enabled(name)
        ]

        # Topological sort
        ordered: List[str] = []
        visited: Set[str] = set()
        temp_mark: Set[str] = set()

        def visit(name: str):
            if name in visited:
                return
            if name in temp_mark:
                logger.warning(f"Circular dependency detected for agent: {name}")
                return
            temp_mark.add(name)

            spec = self._specs.get(name)
            if spec:
                for dep in spec.dependencies:
                    if dep in core_agents:
                        visit(dep)

            temp_mark.discard(name)
            visited.add(name)
            ordered.append(name)

        for name in core_agents:
            visit(name)

        return ordered

    async def start_suspend_monitor(self, check_interval: int = 60):
        """Start background task that auto-suspends idle agents."""

        async def _monitor():
            while True:
                await asyncio.sleep(check_interval)
                for name, proxy in self._proxies.items():
                    if (
                        proxy.is_active
                        and proxy.spec.tier != AgentTier.CORE
                        and proxy.idle_seconds > proxy.spec.idle_timeout_seconds
                    ):
                        await proxy.suspend()

        self._suspend_task = asyncio.create_task(_monitor())
        logger.info("Auto-suspend monitor started")

    async def stop_suspend_monitor(self):
        """Stop the suspend monitor task."""
        if self._suspend_task:
            self._suspend_task.cancel()
            try:
                await self._suspend_task
            except asyncio.CancelledError:
                pass
            self._suspend_task = None

    def get_all_statuses(self) -> Dict[str, Dict[str, Any]]:
        """Get status of all registered agents."""
        statuses = {}
        for name, proxy in self._proxies.items():
            statuses[name] = proxy.get_status()
        # Also include non-proxied specs (disabled agents)
        for name, spec in self._specs.items():
            if name not in statuses:
                statuses[name] = {
                    "name": name,
                    "tier": spec.tier.value,
                    "state": "disabled",
                    "enabled": self.is_enabled(name),
                    "description": spec.description,
                }
        return statuses

    @property
    def registered_count(self) -> int:
        return len(self._specs)

    @property
    def loaded_count(self) -> int:
        return sum(1 for p in self._proxies.values() if p.is_loaded)

    @property
    def active_count(self) -> int:
        return sum(1 for p in self._proxies.values() if p.is_active)
