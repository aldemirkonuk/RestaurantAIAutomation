#!/usr/bin/env python3
"""
Live DB test for BaseAgent.log_decision (Phase 18 / INFRA-02).

correlation_id is only persisted if agent._current_correlation_id is set
(see BaseAgent.log_decision). This script sets it before calling log_decision
so the row matches the UAT checklist.

Usage:
  cd services/agent-orchestrator && python3 scripts/live_decision_log_test.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from supabase import create_client

from core.base_agent import BaseAgent


class _MinimalAgent(BaseAgent):
    async def initialize(self) -> None:
        return None

    async def process_message(self, message: Dict[str, Any]) -> None:
        return None

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return []


class _DbFacade:
    def __init__(self, supabase: Any) -> None:
        self.supabase = supabase


async def main() -> int:
    if load_dotenv:
        load_dotenv(_ROOT / ".env")

    url = os.getenv("SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_SERVICE_KEY")
        or os.getenv("SUPABASE_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        print("Missing SUPABASE_URL or service key.", file=sys.stderr)
        return 1

    correlation = f"live-decision-test-{uuid.uuid4()}"
    supabase = create_client(url, key)
    agent = _MinimalAgent(
        agent_name="live_decision_test_agent",
        message_bus=None,  # type: ignore[arg-type]
        database=_DbFacade(supabase),
        config={},
    )
    agent._current_correlation_id = correlation

    await agent.log_decision(
        decision_type="wine_match",
        inputs={"name": "Opus One"},
        output={"match": "cabernet"},
        reasoning="keyword match",
        confidence=0.95,
    )

    resp = (
        supabase.table("decision_log")
        .select(
            "id, agent_name, decision_type, inputs, output, reasoning, confidence, correlation_id"
        )
        .eq("correlation_id", correlation)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    assert len(rows) == 1, f"Expected 1 row, got {len(rows)}: {rows!r}"
    row = rows[0]

    assert row.get("agent_name") == "live_decision_test_agent"
    assert row.get("decision_type") == "wine_match"
    assert row.get("confidence") == 0.95
    assert row.get("correlation_id") == correlation
    assert row.get("inputs") == {"name": "Opus One"}
    assert row.get("output") == {"match": "cabernet"}
    assert row.get("reasoning") == {"text": "keyword match"}

    print("OK — decision_log row verified in Supabase.")
    print(f"  id={row.get('id')!r} correlation_id={correlation!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
