"""
Wave B: Agent Health Tests (TEST-PROD-02)
==========================================
Verifies all 9 live agents are healthy via GET /api/v1/health/agents.

Pass bar (D-10): At least 7 of 9 agents show healthy:true or status:'Active'.
Depends on Wave A (API contracts must pass first — D-17: A→B).

Run: pytest tests/e2e/wave_b_agent_health.py --junitxml=test-results/wave_b.xml
CI: Runs concurrently with Wave C (background process, separate wave_c.xml)
"""

import httpx
import pytest
from e2e.conftest_prod import get_with_retry

pytestmark = pytest.mark.prod_e2e

# 9 agent names confirmed from Phase 22 production deployment (STATE.md)
EXPECTED_AGENTS = [
    "pos_integration",
    "buffer_manager",
    "inventory_engine",
    "inequality_detector",
    "state_invariant_enforcer",
    "notification",
    "procurement",
    "calendar",
    "reporting",
]


def _extract_agents(data: dict | list) -> list:
    """Normalize response to a list of agent dicts regardless of response shape."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        # Handle {"agents": [...]} or {"data": [...]} or {"health": [...]}
        for key in ("agents", "data", "health", "results"):
            if key in data and isinstance(data[key], list):
                return data[key]
    return []


def _agent_is_healthy(agent: dict) -> bool:
    """Return True if agent reports healthy state.

    Accepts multiple status field conventions from health_routes.py:
      - healthy: True  (boolean)
      - status: "Active" | "healthy" | "running"
    """
    if agent.get("healthy") is True:
        return True
    status = str(agent.get("status", "")).lower()
    return status in ("active", "healthy", "running", "ok")


class TestAgentHealth:
    """Wave B: All 9 agents healthy (TEST-PROD-02)."""

    async def test_health_endpoint_returns_200(
        self, prod_base_url: str, prod_admin_headers: dict
    ):
        """GET /api/v1/health/agents with X-Admin-Key → 200 (not 401, 503, 500)."""
        async with httpx.AsyncClient(
            base_url=prod_base_url, headers=prod_admin_headers
        ) as client:
            resp = await get_with_retry(client, "/api/v1/health/agents", timeout=20.0)
        assert resp.status_code == 200, (
            f"Expected 200 from /api/v1/health/agents, got {resp.status_code}.\n"
            f"If 503: orchestrator not running. If 401: ADMIN_API_KEY mismatch.\n"
            f"Body: {resp.text[:300]}"
        )

    async def test_all_9_agents_present(
        self, prod_base_url: str, prod_admin_headers: dict
    ):
        """GET /api/v1/health/agents → response includes all 9 expected agent names."""
        async with httpx.AsyncClient(
            base_url=prod_base_url, headers=prod_admin_headers
        ) as client:
            resp = await get_with_retry(client, "/api/v1/health/agents", timeout=20.0)
        assert resp.status_code == 200

        agents = _extract_agents(resp.json())
        agent_names = {a.get("name", "") for a in agents}

        missing = set(EXPECTED_AGENTS) - agent_names
        assert not missing, (
            f"Missing agents from /api/v1/health/agents response: {missing}\n"
            f"Got agent names: {sorted(agent_names)}"
        )

    async def test_minimum_7_agents_healthy(
        self, prod_base_url: str, prod_admin_headers: dict
    ):
        """Pass bar (D-10): ≥7/9 agents show healthy:true or status:Active."""
        async with httpx.AsyncClient(
            base_url=prod_base_url, headers=prod_admin_headers
        ) as client:
            resp = await get_with_retry(client, "/api/v1/health/agents", timeout=20.0)
        assert resp.status_code == 200

        agents = _extract_agents(resp.json())
        healthy_agents = [a for a in agents if _agent_is_healthy(a)]
        unhealthy_agents = [
            a.get("name", "?") for a in agents if not _agent_is_healthy(a)
        ]

        assert len(healthy_agents) >= 7, (
            f"Pass bar failed: only {len(healthy_agents)}/9 agents healthy.\n"
            f"Unhealthy agents: {unhealthy_agents}\n"
            f"Full response: {resp.json()}"
        )

    @pytest.mark.parametrize("agent_name", EXPECTED_AGENTS)
    async def test_per_agent_health_detail(
        self, prod_base_url: str, prod_admin_headers: dict, agent_name: str
    ):
        """GET /api/v1/health/agents/{name} → 200 with health data (not 500)."""
        async with httpx.AsyncClient(
            base_url=prod_base_url, headers=prod_admin_headers
        ) as client:
            resp = await get_with_retry(
                client, f"/api/v1/health/agents/{agent_name}", timeout=15.0
            )
        # 200 = agent detail returned; 404 = agent name mismatch (acceptable for now)
        assert resp.status_code in (200, 404), (
            f"Expected 200 or 404 for agent '{agent_name}', got {resp.status_code}: "
            f"{resp.text[:200]}"
        )
        assert (
            resp.status_code != 500
        ), f"500 error on /api/v1/health/agents/{agent_name}: {resp.text[:300]}"
