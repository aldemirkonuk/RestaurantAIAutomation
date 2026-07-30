"""
Shrinkage Detective Agent
Detects anomalies and potential loss patterns.
"""

from typing import Dict, Any, List

from core.base_agent import BaseAgent


class ShrinkageDetectiveAgent(BaseAgent):
    #: This agent is a stub — process_message() logs and returns. Declaring it
    #: here means the orchestrator refuses to start it rather than running an
    #: agent that consumes events and produces nothing, which reads identically
    #: to a working one from every dashboard and health check.
    IS_STUB = True

    async def initialize(self) -> None:
        self.logger.info("Initializing Shrinkage Detective Agent")
        self.logger.info("✓ Shrinkage Detective Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("inventory.events", "inventory.discrepancy.detected"),
            ("pos.events", "pos.sale.recorded"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")
        payload = message.get("payload", {})

        self.logger.info(
            {
                "message": "Shrinkage detective event received",
                "routing_key": routing_key,
                "payload_keys": list(payload.keys()),
            }
        )

        # TODO: Analyze patterns and insert shrinkage_alerts
        # TODO: Update staff_correlation_data and anomaly_patterns
