"""
Central Agent Orchestrator
==========================
Manages lifecycle and coordination of all autonomous agents.
Refactored with:
- Lazy agent loading via AgentRegistry
- Feature flags per agent
- Auto-suspend for idle on-demand agents
- Connection pooling integration
"""

import asyncio
import os
from typing import Dict, Any, Optional, Type
from datetime import datetime

from core.base_agent import BaseAgent, AgentStatus
from core.message_bus import MessageBus
from core.database import DatabaseClient
from core.agent_registry import AgentRegistry, AgentTier, LazyAgentProxy
from config.settings import Settings
from utils.logger import setup_logger

# Import all agents
from agents.buffer_manager import BufferManagerAgent
from agents.inventory_engine import InventoryEngineAgent
from agents.inequality_detector import InequalityDetectorAgent
from agents.procurement_agent import ProcurementAgent
from agents.provider_conversation_agent import ProviderConversationAgent
from agents.notification_agent import NotificationAgent
from agents.calendar_agent import CalendarAgent
from agents.pos_integration_agent import POSIntegrationAgent

# Phase 2 Agents
from agents.visual_verification_agent import VisualVerificationAgent
from agents.sommelier_agent import SommelierAgent
from agents.menu_analyzer_agent import MenuAnalyzerAgent
from agents.rfq_agent import RFQAgent
from agents.reporting_agent import ReportingAgent
from agents.state_invariant_enforcer import StateInvariantEnforcerAgent

# Phase 3 Agents (P1)
from agents.ghost_inventory_agent import GhostInventoryAgent
from agents.negotiation_playbook_agent import NegotiationPlaybookAgent
from agents.auto_pilot_agent import AutoPilotAgent
from agents.compliance_agent import ComplianceAgent
from agents.shrinkage_detective_agent import ShrinkageDetectiveAgent
from agents.drift_agent import DriftAgent

# Phase 24 Agents — inbound email intelligence
from agents.email_intel_agent import EmailIntelAgent
from agents.email_parsing_agent import EmailParsingAgent

# Phase 32 Agents
from agents.provider_communication_agent import ProviderCommunicationAgent

logger = setup_logger(__name__)


class AgentOrchestrator:
    """
    Central orchestrator for all autonomous agents.

    Refactored with:
    - AgentRegistry for lazy loading and feature flags
    - LazyAgentProxy for on-demand instantiation
    - Auto-suspend for idle on-demand agents
    - Backward-compatible self.agents dict for existing code

    Responsibilities:
    - Agent lifecycle management (start, stop, restart)
    - Health monitoring
    - Performance tracking
    - System-wide control (pause writes, emergency flush)
    - Metrics aggregation
    """

    def __init__(self, message_bus: MessageBus, settings: Settings):
        self.message_bus = message_bus
        self.settings = settings
        self.database: Optional[DatabaseClient] = None

        # New: Agent registry with lazy loading
        self._feature_flags = self._build_feature_flags(settings)
        self.registry = AgentRegistry(feature_flags=self._feature_flags)

        # Lazy proxies
        self._proxies: Dict[str, LazyAgentProxy] = {}

        # Backward-compatible agents dict (populated on start)
        self.agents: Dict[str, BaseAgent] = {}
        self.agent_classes: Dict[str, Type[BaseAgent]] = {}

        # System state
        self.system_paused: bool = False
        self.started_at: datetime = datetime.utcnow()

        logger.info("Agent Orchestrator initialized (lazy-loading enabled)")

    @staticmethod
    def _build_feature_flags(settings: Settings) -> Dict[str, bool]:
        """
        Extract feature flags from settings for the registry.

        Two kinds of key end up here:

          FEATURE_*                 named flags declared on an AgentSpec
          AGENT_<NAME>_ENABLED      the per-agent gate AgentTier.OPTIONAL requires

        The second kind used to be missing entirely. AgentRegistry.is_enabled()
        looks up `AGENT_{name.upper()}_ENABLED` for every OPTIONAL agent and
        defaults it to False, so with those keys absent the OPTIONAL tier was
        unreachable: setting AGENT_GHOST_INVENTORY_AGENT_ENABLED=true in the
        environment did nothing at all, silently, because nothing read it. The
        tier was documented as "disabled unless feature flag is set" while there
        was no flag it would honour.

        Reading them from os.environ here makes the documented switch real. The
        five OPTIONAL agents are still off by default — they are unimplemented
        stubs (see agents/planned) and BaseAgent now refuses to start one, so a
        flag alone will not silently give you an agent that does nothing.
        """
        flags: Dict[str, bool] = {}
        if hasattr(settings, "features"):
            features = settings.features
            flags["FEATURE_VISUAL_VERIFICATION"] = getattr(
                features, "visual_verification", False
            )
            flags["FEATURE_SOMMELIER_AI"] = getattr(features, "sommelier_ai", False)
            flags["FEATURE_MENU_ANALYZER"] = (
                getattr(features, "menu_analyzer_enabled", False)
                if hasattr(features, "menu_analyzer_enabled")
                else False
            )

        for key, value in os.environ.items():
            if key.startswith("AGENT_") and key.endswith("_ENABLED"):
                flags[key] = value.strip().lower() in ("1", "true", "yes", "on")

        return flags

    async def initialize(self) -> None:
        """
        Initialize orchestrator: database, registry, lazy proxies.
        Agents are NOT instantiated here - only registered.
        """
        try:
            logger.info("Initializing Agent Orchestrator...")

            # Initialize database client
            self.database = DatabaseClient(
                supabase_url=self.settings.supabase_url,
                supabase_key=self.settings.supabase_service_role_key,
                redis_url=self.settings.redis_url,
            )
            await self.database.connect()

            # Register all agent classes with the registry
            self._register_agent_classes()

            # Create lazy proxies (no instantiation yet)
            self._create_lazy_proxies()

            logger.info(
                "Agent Orchestrator initialized (agents registered, not yet instantiated)"
            )

        except Exception as e:
            logger.error(f"Failed to initialize orchestrator: {e}")
            raise

    def _register_agent_classes(self) -> None:
        """Register all available agent classes with the registry."""
        self.agent_classes = {
            # Core agents
            "pos_integration_agent": POSIntegrationAgent,
            "buffer_manager": BufferManagerAgent,
            "inventory_engine": InventoryEngineAgent,
            "inequality_detector": InequalityDetectorAgent,
            "state_invariant_enforcer": StateInvariantEnforcerAgent,
            "provider_conversation_agent": ProviderConversationAgent,
            "procurement_agent": ProcurementAgent,
            "notification_agent": NotificationAgent,
            "calendar_agent": CalendarAgent,
            "reporting_agent": ReportingAgent,
            # Phase 2 agents
            "visual_verification_agent": VisualVerificationAgent,
            "sommelier_agent": SommelierAgent,
            "menu_analyzer_agent": MenuAnalyzerAgent,
            "rfq_agent": RFQAgent,
            # P1 agents
            "ghost_inventory_agent": GhostInventoryAgent,
            "negotiation_playbook_agent": NegotiationPlaybookAgent,
            "auto_pilot_agent": AutoPilotAgent,
            "compliance_agent": ComplianceAgent,
            "shrinkage_detective_agent": ShrinkageDetectiveAgent,
            "drift_agent": DriftAgent,
            # Phase 24 agents — inbound email intelligence.
            #
            # Both were fully implemented and absent from this registry, so nothing
            # consumed inbound vendor email at all. Registering them was necessary
            # but not sufficient: EmailIntelAgent subscribed to email.inbound.raw,
            # which has zero publishers, and EmailParsingAgent's process_message
            # took two arguments where BaseAgent passes one. Three defects, each of
            # which alone would have made the pipeline dead, and the missing
            # registration hid the other two.
            "email_intel_agent": EmailIntelAgent,
            "email_parsing_agent": EmailParsingAgent,
            # Phase 32 agents
            "provider_communication_agent": ProviderCommunicationAgent,
        }

        # Register with the new registry (includes tier and dependency info)
        self.registry.register_from_defaults(self.agent_classes)
        # Registered is not the same as running, and reporting only the former
        # overstates the system. Five of these are OPTIONAL, unimplemented stubs
        # that get no proxy and never subscribe — a count of 20 read as 20 working
        # agents, which is how "registered" came to be mistaken for "live".
        enabled = [n for n in self.agent_classes if self.registry.is_enabled(n)]
        disabled = [n for n in self.agent_classes if n not in enabled]
        logger.info(
            f"Registered {self.registry.registered_count} agent classes; "
            f"{len(enabled)} enabled, {len(disabled)} gated off"
        )
        if disabled:
            logger.info(
                f"Gated off (no proxy, no subscriptions): {', '.join(sorted(disabled))}"
            )

    def _create_lazy_proxies(self) -> None:
        """Create lazy proxies for all registered agents (no instantiation)."""
        for agent_name, agent_class in self.agent_classes.items():
            if not self.registry.is_enabled(agent_name):
                logger.info(
                    f"Agent {agent_name} disabled by feature flag - skipping proxy"
                )
                continue

            # Refuse to run a stub even when its flag is on. Now that
            # AGENT_<NAME>_ENABLED is actually read (it previously was not), a
            # well-meaning operator can switch one of these on and get an agent
            # that subscribes to real events and silently discards them — which
            # looks healthy from every dashboard. Failing loudly at boot is the
            # only version of this that cannot be mistaken for working.
            if getattr(agent_class, "IS_STUB", False):
                logger.error(
                    f"Agent {agent_name} is enabled but is an unimplemented stub — "
                    f"refusing to start it. Implement process_message() or leave "
                    f"AGENT_{agent_name.upper()}_ENABLED unset."
                )
                continue

            agent_config = self._get_agent_config(agent_name)

            proxy = self.registry.create_proxy(
                name=agent_name,
                factory=agent_class,
                factory_kwargs={
                    "agent_name": agent_name,
                    "message_bus": self.message_bus,
                    "database": self.database,
                    "config": agent_config,
                },
            )
            self._proxies[agent_name] = proxy

        logger.info(f"Created {len(self._proxies)} lazy proxies")

    def _get_agent_config(self, agent_name: str) -> Dict[str, Any]:
        """
        Get configuration for a specific agent
        """
        # Base configuration from settings
        base_config = {
            "environment": self.settings.environment,
            "debug": self.settings.debug,
        }

        # Agent-specific configurations
        agent_configs = {
            "pos_integration_agent": {
                "toast_api_url": self.settings.toast_api_url,
                "toast_client_id": self.settings.toast_client_id,
                "toast_client_secret": self.settings.toast_client_secret,
                "toast_restaurant_guid": self.settings.toast_restaurant_guid,
                "toast_webhook_secret": self.settings.toast_webhook_secret,
                "toast_environment": self.settings.toast_environment,
                "mock_mode": self.settings.mock_pos,
            },
            "buffer_manager": {
                "buffer_window_minutes": self.settings.buffer_window_minutes,
                "evaluation_interval_seconds": 60,
            },
            "inventory_engine": {
                "default_threshold": self.settings.default_threshold_min,
            },
            "provider_conversation_agent": {
                "extraction_model": getattr(
                    self.settings,
                    "provider_convo_extraction_model",
                    self.settings.llm_primary_model,
                ),
                "response_model": getattr(
                    self.settings,
                    "provider_convo_response_model",
                    self.settings.llm_primary_model,
                ),
                "embedding_model": getattr(
                    self.settings,
                    "provider_convo_embedding_model",
                    "text-embedding-004",
                ),
                "llm_temperature": self.settings.llm_temperature,
                "google_api_key": self.settings.google_api_key,
                "mock_mode": self.settings.mock_llm,
                "api_gateway_url": self.settings.api_gateway_url,
                "max_sessions": getattr(
                    self.settings, "provider_convo_max_sessions", 20
                ),
                "memory_top_k": getattr(
                    self.settings, "provider_convo_memory_top_k", 10
                ),
                "follow_up_buffer_hours": getattr(
                    self.settings, "provider_convo_follow_up_buffer_hours", 24
                ),
                "relationship_alert_days": getattr(
                    self.settings, "provider_convo_relationship_alert_days", 30
                ),
                "promo_alert_days": getattr(
                    self.settings, "provider_convo_promo_alert_days", 7
                ),
            },
            "procurement_agent": {
                "llm_model": self.settings.llm_primary_model,
                "llm_temperature": self.settings.llm_temperature,
                "google_api_key": self.settings.google_api_key,
                "mock_mode": self.settings.mock_llm,
            },
            "notification_agent": {
                "plivo_auth_id": self.settings.plivo_auth_id,
                "plivo_auth_token": self.settings.plivo_auth_token,
                "plivo_phone_number": self.settings.plivo_phone_number,
                "email_backend": self.settings.email_backend,
                "gmail_user": self.settings.gmail_user,
                "gmail_password": self.settings.gmail_password,
                "sendgrid_api_key": self.settings.sendgrid_api_key,
                "from_email": self.settings.from_email,
                "vapid_private_key": self.settings.vapid_private_key,
                "vapid_public_key": self.settings.vapid_public_key,
                "vapid_email": self.settings.vapid_email,
                "fcm_server_key": self.settings.fcm_server_key,
                "mock_mode": self.settings.mock_notifications,
            },
            # Phase 2 agents
            "visual_verification_agent": {
                "yolo_model_path": getattr(
                    self.settings, "yolo_model_path", "yolov8n.pt"
                ),
                "confidence_threshold": 0.5,
                "ocr_languages": ["en"],
                "mock_mode": self.settings.mock_llm,
            },
            "sommelier_agent": {
                "llm_model": self.settings.llm_primary_model,
                "google_api_key": self.settings.google_api_key,
                "mock_mode": self.settings.mock_llm,
            },
            "menu_analyzer_agent": {
                "yolo_model_path": getattr(
                    self.settings, "yolo_model_path", "yolov8n.pt"
                ),
                "confidence_threshold": 0.3,
                "ocr_languages": ["en"],
                "google_api_key": self.settings.google_api_key,
                "mock_mode": self.settings.mock_llm,
            },
            "rfq_agent": {
                "llm_model": self.settings.llm_primary_model,
                "google_api_key": self.settings.google_api_key,
                "default_vendor_count": 3,
                "response_timeout_hours": 24,
                "mock_mode": self.settings.mock_llm,
            },
            "state_invariant_enforcer": {
                "window_seconds": 120,
                "max_repeats": 3,
                "double_write_window_seconds": 300,
                "enable_opus_review": True,
            },
            "ghost_inventory_agent": {},
            "negotiation_playbook_agent": {},
            "auto_pilot_agent": {},
            "compliance_agent": {},
            "shrinkage_detective_agent": {},
        }

        config = base_config.copy()
        config.update(agent_configs.get(agent_name, {}))

        return config

    async def start_all_agents(self) -> None:
        """
        Start CORE agents eagerly (in dependency order).
        ON_DEMAND and OPTIONAL agents remain as lazy proxies.
        """
        logger.info("Starting core agents (on-demand agents will lazy-load)...")

        # Get dependency-resolved startup order for core agents only
        start_order = self.registry.get_startup_order()
        started_count = 0

        for agent_name in start_order:
            proxy = self._proxies.get(agent_name)
            if not proxy:
                continue

            try:
                instance = await proxy.ensure_started()
                # Populate backward-compatible agents dict
                self.agents[agent_name] = instance
                started_count += 1
                logger.info(f"Started core agent: {agent_name}")
            except Exception as e:
                logger.error(f"Failed to start agent {agent_name}: {e}")
                # Continue starting other agents

        # Start the auto-suspend monitor for on-demand agents
        await self.registry.start_suspend_monitor(check_interval=60)

        on_demand_count = sum(
            1 for p in self._proxies.values() if p.spec.tier != AgentTier.CORE
        )

        logger.info(
            f"Started {started_count} core agents. "
            f"{on_demand_count} on-demand agents ready for lazy loading."
        )

    async def stop_all_agents(self) -> None:
        """Stop all agents gracefully (both core and lazy-loaded)."""
        logger.info("Stopping all agents...")

        # Stop the auto-suspend monitor
        await self.registry.stop_suspend_monitor()

        # Stop all proxies (both core and on-demand that were loaded)
        stop_order = list(reversed(list(self._proxies.keys())))

        for agent_name in stop_order:
            proxy = self._proxies.get(agent_name)
            if proxy and proxy.is_loaded:
                try:
                    await proxy.stop()
                    logger.info(f"Stopped agent: {agent_name}")
                except Exception as e:
                    logger.error(f"Error stopping agent {agent_name}: {e}")

        # Also stop any agents in the legacy dict
        for agent_name, agent in self.agents.items():
            if (
                agent
                and hasattr(agent, "status")
                and agent.status != AgentStatus.STOPPED
            ):
                try:
                    await agent.stop()
                except Exception:
                    pass

        # Disconnect database
        if self.database:
            await self.database.disconnect()

        logger.info("All agents stopped")

    async def restart_agent(self, agent_name: str) -> Dict[str, Any]:
        """Restart a specific agent (works with both lazy and eager agents)."""
        proxy = self._proxies.get(agent_name)
        if proxy and proxy.is_loaded:
            try:
                logger.info(f"Restarting agent: {agent_name}")
                await proxy.stop()
                await asyncio.sleep(1)
                instance = await proxy.ensure_started()
                self.agents[agent_name] = instance
                return {"success": True, "agent": agent_name, "status": proxy.state}
            except Exception as e:
                logger.error(f"Failed to restart agent {agent_name}: {e}")
                return {"success": False, "error": str(e)}

        # Fallback to legacy dict
        agent = self.agents.get(agent_name)
        if not agent:
            return {"success": False, "error": "Agent not found"}

        try:
            await agent.stop()
            await asyncio.sleep(1)
            await agent.start()
            return {"success": True, "agent": agent_name, "status": agent.status.value}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def stop_agent(self, agent_name: str) -> Dict[str, Any]:
        """Stop a specific agent."""
        proxy = self._proxies.get(agent_name)
        if proxy and proxy.is_loaded:
            try:
                await proxy.stop()
                return {"success": True, "agent": agent_name, "status": "stopped"}
            except Exception as e:
                return {"success": False, "error": str(e)}

        agent = self.agents.get(agent_name)
        if not agent:
            return {"success": False, "error": "Agent not found"}
        try:
            await agent.stop()
            return {"success": True, "agent": agent_name, "status": "stopped"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def start_agent(self, agent_name: str) -> Dict[str, Any]:
        """Start a specific agent (lazy-load if needed)."""
        proxy = self._proxies.get(agent_name)
        if proxy:
            try:
                instance = await proxy.ensure_started()
                self.agents[agent_name] = instance
                return {"success": True, "agent": agent_name, "status": "started"}
            except Exception as e:
                return {"success": False, "error": str(e)}

        return {"success": False, "error": "Agent not registered"}

    async def pause_all_writes(self) -> None:
        """
        Pause all agents that write to database
        Used during manual edits (Yield-to-Human protocol)
        """
        logger.warning("⏸️ PAUSING ALL WRITES (Yield-to-Human)")

        # Broadcast pause command
        await self.message_bus.publish(
            exchange_name="system.control",
            routing_key="system.pause_writes",
            message_body={
                "command": "pause_writes",
                "reason": "manual_edit_detected",
            },
            priority=10,  # Highest priority
        )

        self.system_paused = True

        # Pause write-heavy agents
        write_agents = ["inventory_engine", "procurement_agent"]
        for agent_name in write_agents:
            agent = self.agents.get(agent_name)
            if agent:
                await agent.pause()

    async def resume_all_writes(self) -> None:
        """Resume all agents after manual edit period"""
        logger.info("▶️ RESUMING ALL WRITES")

        await self.message_bus.publish(
            exchange_name="system.control",
            routing_key="system.resume_writes",
            message_body={"command": "resume_writes"},
            priority=10,
        )

        self.system_paused = False

        # Resume all paused agents
        for agent in self.agents.values():
            if agent.status == AgentStatus.PAUSED:
                await agent.resume()

    async def emergency_flush_buffer(self) -> Dict[str, Any]:
        """
        Emergency flush of buffer (skip 30-min wait)
        Used for critical stockouts
        """
        logger.warning("🚨 EMERGENCY BUFFER FLUSH")

        await self.message_bus.publish(
            exchange_name="system.control",
            routing_key="system.emergency.flush_buffer",
            message_body={"command": "flush_buffer", "reason": "emergency"},
            priority=10,
        )

        return {"success": True, "action": "buffer_flushed"}

    async def get_agent_health(self) -> Dict[str, Any]:
        """Get health status of all agents (includes lazy proxy status)."""
        agent_health = {}

        # Get status from registry (includes all agents, even unloaded)
        registry_statuses = self.registry.get_all_statuses()

        for agent_name, status in registry_statuses.items():
            # For loaded agents, also include the agent's own health
            agent = self.agents.get(agent_name)
            if agent and hasattr(agent, "get_health"):
                health = agent.get_health()
                health.update(status)
                agent_health[agent_name] = health
            else:
                agent_health[agent_name] = status

        # System-wide health
        loaded_agents = {
            k: v for k, v in agent_health.items() if v.get("loaded", False)
        }
        all_healthy = (
            all(
                health.get("healthy", True) and health.get("state") != "failed"
                for health in loaded_agents.values()
            )
            if loaded_agents
            else True
        )

        return {
            "system_healthy": all_healthy,
            "system_paused": self.system_paused,
            "agents": agent_health,
            "total_registered": self.registry.registered_count,
            "total_loaded": self.registry.loaded_count,
            "total_active": self.registry.active_count,
        }

    async def get_detailed_agent_health(self) -> Dict[str, Any]:
        """Get detailed health for all agents"""
        detailed_health = {}

        for agent_name, agent in self.agents.items():
            detailed_health[agent_name] = agent.get_detailed_health()

        return detailed_health

    async def get_metrics(self) -> Dict[str, Any]:
        """
        Get comprehensive system metrics
        """
        # Agent metrics
        agent_metrics = {}
        total_messages = 0
        total_errors = 0

        for agent_name, agent in self.agents.items():
            metrics = agent.metrics.to_dict()
            agent_metrics[agent_name] = metrics
            total_messages += metrics["messages_processed"]
            total_errors += metrics["errors"]

        # Message bus metrics
        bus_stats = await self.message_bus.get_statistics()

        # Database metrics
        db_stats = await self.database.get_statistics()

        # System metrics
        uptime_seconds = (datetime.utcnow() - self.started_at).total_seconds()

        return {
            "system": {
                "uptime_seconds": round(uptime_seconds, 2),
                "uptime_hours": round(uptime_seconds / 3600, 2),
                "system_paused": self.system_paused,
                "total_agents": len(self.agents),
            },
            "agents": agent_metrics,
            "aggregated": {
                "total_messages_processed": total_messages,
                "total_errors": total_errors,
                "overall_error_rate": round(total_errors / max(total_messages, 1), 4),
            },
            "message_bus": bus_stats,
            "database": db_stats,
        }

    def __repr__(self) -> str:
        return f"<AgentOrchestrator(agents={len(self.agents)}, paused={self.system_paused})>"
