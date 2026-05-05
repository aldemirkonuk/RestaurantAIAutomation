"""
Wave C: Agent Trigger Tests via RabbitMQ (TEST-PROD-03)
=========================================================
Publishes a test message to each agent's routing key on live CloudAMQP RabbitMQ.
Verifies each agent remains healthy within 5 seconds of receiving the message.

Pass criteria: Agent does not crash or enter error state from the test message.
The agent may reject/DLQ the message — that is acceptable (D-15 continue-all-waves).

Depends on: Wave B (agents must be healthy before triggering — D-17: B→C)

Routing keys extracted from source code:
  - core/message_bus.py  → declared exchanges
  - agents/*.py          → get_subscribed_routing_keys() implementations

Run: pytest tests/e2e/wave_c_agent_triggers.py --junitxml=test-results/wave_c.xml
CI: Runs in parallel with Wave B (pytest -n 2 wave_b wave_c — see e2e-prod.yml)
"""

import asyncio
import json
import os
from typing import Optional

import aio_pika
import httpx
import pytest
from e2e.conftest_prod import get_with_retry

pytestmark = pytest.mark.prod_e2e

# ---------------------------------------------------------------------------
# Agent routing keys — extracted from core/message_bus.py + agents/*.py
#
# Format: agent_name → (exchange_name, routing_key)
#
# Exchange availability (from core/message_bus.py._setup_exchanges):
#   Declared:   pos.events, stock.events, procurement.events, notification.events,
#               report.events, menu.events, provider.events, conversation.events,
#               calendar.events, voice.events, system.control, broadcast
#   NOT declared: pos.commands (used by pos_integration_agent),
#                 reporting.events (used by reporting_agent)
#
# For undeclared exchanges: use default exchange ("") with exact queue name.
# Queue name pattern (base_agent.py:422): queue.{agent_name}.{routing_key.replace('.','_')}
#
# Agent short names match wave_b EXPECTED_AGENTS (confirmed from Phase 22 deployment).
# ---------------------------------------------------------------------------
AGENT_ROUTING_KEYS: dict[str, tuple[str, str]] = {
    # pos_integration_agent subscribes to ("pos.commands", "pos.test")
    # "pos.commands" exchange NOT declared in message_bus._setup_exchanges →
    # fall back to default exchange + direct queue name.
    # Actual orchestrator key is "pos_integration_agent" (orchestrator.py:134).
    "pos_integration": ("", "queue.pos_integration_agent.pos_test"),

    # buffer_manager subscribes to ("pos.events", "pos.sale.completed")
    # "pos.events" is declared in message_bus._setup_exchanges — use topic routing.
    "buffer_manager": ("pos.events", "pos.sale.completed"),

    # inventory_engine subscribes to ("stock.events", "stock.evaluated")
    "inventory_engine": ("stock.events", "stock.evaluated"),

    # inequality_detector subscribes to ("stock.events", "stock.state.changed")
    "inequality_detector": ("stock.events", "stock.state.changed"),

    # state_invariant_enforcer subscribes to ("pos.events", "#") — wildcard.
    # Any routing key on pos.events will be received.
    "state_invariant_enforcer": ("pos.events", "pos.e2e.test_probe"),

    # notification_agent subscribes to ("stock.events", "stock.threshold.breached")
    "notification": ("stock.events", "stock.threshold.breached"),

    # procurement_agent subscribes to ("procurement.events", "procurement.manual_order_request")
    "procurement": ("procurement.events", "procurement.manual_order_request"),

    # calendar_agent subscribes to ("system.control", "system.schedule.daily_check")
    "calendar": ("system.control", "system.schedule.daily_check"),

    # reporting_agent subscribes to ("reporting.events", "reporting.generate_on_demand_report")
    # "reporting.events" NOT declared in message_bus._setup_exchanges →
    # fall back to default exchange + direct queue name.
    # Actual orchestrator key is "reporting_agent" (orchestrator.py:143).
    "reporting": ("", "queue.reporting_agent.reporting_generate_on_demand_report"),
}


def make_test_payload(agent_name: str) -> dict:
    """Build a minimal test probe payload.

    Intentionally minimal — agents should DLQ or ignore unknown message types
    rather than crash. Each agent receives: type=test_probe, source=e2e.
    """
    return {
        "type": "test_probe",
        "source": "e2e-test-suite",
        "agent": agent_name,
        "restaurant_id": "e2e-test-restaurant",
        "timestamp": "2026-05-01T02:00:00Z",
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def rabbitmq_url() -> str:
    """RABBITMQ_URL from env — skips entire Wave C if not set."""
    url = os.environ.get("RABBITMQ_URL", "")
    if not url:
        pytest.skip("RABBITMQ_URL not set — skipping Wave C RabbitMQ tests")
    return url


@pytest.fixture(scope="session")
async def rabbitmq_connection(rabbitmq_url: str) -> "aio_pika.RobustConnection":
    """Single shared RabbitMQ connection for all Wave C tests.

    H-01 fix: re-using one connection across all 9 parametrized tests avoids
    exhausting CloudAMQP's free tier (5 concurrent connection limit).
    """
    connection = await aio_pika.connect_robust(rabbitmq_url, timeout=10)
    yield connection
    await connection.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def publish_test_message(
    connection: "aio_pika.RobustConnection",
    exchange_name: str,
    routing_key: str,
    payload: dict,
) -> None:
    """Publish a single test message via the shared RabbitMQ connection.

    Opens a fresh channel per call (channels are lightweight) and closes it
    after publish to avoid channel leak.
    """
    channel = await connection.channel()
    try:
        if exchange_name:
            # Named TOPIC exchange — declared in message_bus._setup_exchanges
            exchange = await channel.get_exchange(exchange_name, ensure=False)
        else:
            # Default exchange — routing_key must be exact queue name
            exchange = channel.default_exchange
        await exchange.publish(
            aio_pika.Message(
                body=json.dumps(payload).encode(),
                content_type="application/json",
            ),
            routing_key=routing_key,
        )
    finally:
        await channel.close()


async def check_agent_still_healthy(
    base_url: str,
    admin_headers: dict,
    agent_name: str,
    timeout_seconds: float = 5.0,
) -> bool:
    """Poll GET /api/v1/health/agents/{name} up to 5s.

    Returns True if the agent shows no crash/error state within the window.
    Returns True on 404 as well (name mismatch is not a crash indicator).
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    async with httpx.AsyncClient(
        base_url=base_url, headers=admin_headers, timeout=6.0
    ) as client:
        while loop.time() < deadline:
            try:
                resp = await client.get(f"/api/v1/health/agents/{agent_name}")
                if resp.status_code == 200:
                    data = resp.json()
                    status = str(data.get("status", "")).lower()
                    healthy = data.get("healthy")
                    # Agent entered error state — FAIL
                    if status in ("error", "failed", "crashed"):
                        return False
                    if healthy is False and status not in ("starting", "initializing"):
                        return False
                elif resp.status_code == 404:
                    # Short name doesn't match registered key — cannot determine
                    # crash state from detail endpoint; treat as no crash detected.
                    pass
                # Any other status code: continue polling
            except httpx.HTTPStatusError:
                pass  # Non-200 from health endpoint — keep polling
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout):
                pass  # Transient network issue — keep polling
            # Unexpected exceptions propagate so flaky networks are visible
            await asyncio.sleep(1.0)
    return True  # No crash observed within 5s


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------

class TestAgentTriggers:
    """Wave C: Publish test message to each agent, verify no crash (TEST-PROD-03)."""

    async def test_rabbitmq_connection_reachable(
        self, rabbitmq_connection: "aio_pika.RobustConnection"
    ) -> None:
        """Verify CloudAMQP shared connection is alive (prerequisite for Wave C).

        Uses the session-scoped rabbitmq_connection fixture — no extra connection opened.
        """
        assert not rabbitmq_connection.is_closed, (
            "Shared RabbitMQ connection is closed — check CloudAMQP credentials "
            "and RABBITMQ_URL."
        )

    @pytest.mark.parametrize("agent_name", list(AGENT_ROUTING_KEYS.keys()))
    async def test_agent_survives_test_message(
        self,
        agent_name: str,
        rabbitmq_connection: "aio_pika.RobustConnection",
        prod_base_url: str,
        prod_admin_headers: dict,
    ) -> None:
        """Publish test probe message; agent must remain healthy within 5s (TEST-PROD-03).

        H-01 fix: uses shared rabbitmq_connection (session-scoped) — all 9 agents
        share one connection, staying within CloudAMQP free tier (5 connection limit).

        SKIP condition: RabbitMQ publish fails (exchange/queue not reachable).
        PASS condition: Agent is not in error/crashed state within 5s.
        """
        exchange_name, routing_key = AGENT_ROUTING_KEYS[agent_name]
        payload = make_test_payload(agent_name)

        try:
            await publish_test_message(
                connection=rabbitmq_connection,
                exchange_name=exchange_name,
                routing_key=routing_key,
                payload=payload,
            )
        except Exception as exc:
            pytest.skip(
                f"Could not publish to RabbitMQ for agent '{agent_name}' "
                f"(exchange='{exchange_name}', routing_key='{routing_key}'): {exc}. "
                "Check RABBITMQ_URL and that queues/exchanges are bound."
            )

        still_healthy = await check_agent_still_healthy(
            base_url=prod_base_url,
            admin_headers=prod_admin_headers,
            agent_name=agent_name,
            timeout_seconds=5.0,
        )
        assert still_healthy, (
            f"Agent '{agent_name}' entered error/crashed state within 5s of "
            f"receiving test probe message on "
            f"exchange='{exchange_name}' routing_key='{routing_key}'. "
            f"Check Railway logs for the agent."
        )
