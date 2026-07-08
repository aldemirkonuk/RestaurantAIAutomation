#!/usr/bin/env python3
"""
Live DB test: after _process_with_retry exhausts retries, a dead_letter_queue row
is inserted (Phase 18 / INFRA-05).

Runs a minimal BaseAgent whose process_message always raises, with fast retries
and circuit breaker disabled so all attempts run and DLQ is reached.

Usage:
  cd services/agent-orchestrator && python3 scripts/live_dlq_retry_test.py
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


class _AlwaysFailsAgent(BaseAgent):
    async def initialize(self) -> None:
        return None

    async def process_message(self, message: Dict[str, Any]) -> None:
        raise Exception("simulated failure")

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

    marker = f"dlq-live-test-{uuid.uuid4()}"
    supabase = create_client(url, key)

    agent = _AlwaysFailsAgent(
        agent_name="live_dlq_test_agent",
        message_bus=None,  # type: ignore[arg-type]
        database=_DbFacade(supabase),
        config={
            "max_retries": 3,
            "retry_delay_seconds": 0.01,
            "circuit_breaker_enabled": False,
        },
    )

    message: Dict[str, Any] = {
        "_exchange": "test.exchange",
        "_routing_key": "test.routing",
        "body": {"hello": "world"},
        "dlq_marker": marker,
    }

    await agent._process_with_retry(message)

    resp = (
        supabase.table("dead_letter_queue")
        .select(
            "id, agent_name, original_exchange, original_routing_key, message, error, retry_count"
        )
        .eq("agent_name", "live_dlq_test_agent")
        .order("id", desc=True)
        .limit(5)
        .execute()
    )
    rows = resp.data or []
    row = next(
        (r for r in rows if (r.get("message") or {}).get("dlq_marker") == marker), None
    )
    assert (
        row is not None
    ), f"No DLQ row with marker {marker!r} in last 5 for agent: {rows!r}"

    assert row.get("agent_name") == "live_dlq_test_agent"
    assert row.get("original_exchange") == "test.exchange"
    assert row.get("original_routing_key") == "test.routing"
    assert row.get("error") == "simulated failure"
    assert int(row.get("retry_count") or 0) > 0
    msg_body = row.get("message") or {}
    assert msg_body.get("dlq_marker") == marker
    assert msg_body.get("body") == {"hello": "world"}

    print("OK — dead_letter_queue row present after retry exhaustion.")
    print(
        f"  id={row.get('id')!r} retry_count={row.get('retry_count')!r} error={row.get('error')!r}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
