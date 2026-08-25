"""
Auto-Pilot Agent
Executes trusted procurement rules autonomously.
"""

from typing import Dict, Any, List

from core.base_agent import BaseAgent


class AutoPilotAgent(BaseAgent):
    #: This agent is a stub — process_message() logs and returns. Declaring it
    #: here means the orchestrator refuses to start it rather than running an
    #: agent that consumes events and produces nothing, which reads identically
    #: to a working one from every dashboard and health check.
    IS_STUB = True

    async def initialize(self) -> None:
        self.logger.info("Initializing Auto-Pilot Agent")
        self.logger.info("✓ Auto-Pilot Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("stock.events", "stock.state.changed"),
            ("procurement.events", "procurement.order.completed"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")
        payload = message.get("payload", {})

        self.logger.info(
            {
                "message": "Auto-pilot event received",
                "routing_key": routing_key,
                "payload_keys": list(payload.keys()),
            }
        )

        # TODO: Evaluate auto_pilot_rules
        # TODO: Create procurement orders when rules are triggered
        # TODO: Record auto_pilot_executions
