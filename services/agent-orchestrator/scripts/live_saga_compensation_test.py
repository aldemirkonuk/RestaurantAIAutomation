#!/usr/bin/env python3
"""
Live DB test: saga compensation (Phase 18 / INFRA-06).

1) Real saga → compensate_saga → status=COMPENSATED, error set.
2) Unknown saga_id (valid UUID, no row) → returns without exception.

Note: saga_id must be a valid UUID string for PostgREST filters; a literal like
"nonexistent-uuid" may cause a DB/API error and raise — use a random UUID instead.

Usage:
  cd services/agent-orchestrator && python3 scripts/live_saga_compensation_test.py
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


class _SagaTestAgent(BaseAgent):
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
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY") or os.getenv(
        "SUPABASE_SERVICE_ROLE_KEY"
    )
    if not url or not key:
        print("Missing SUPABASE_URL or service key.", file=sys.stderr)
        return 1

    supabase = create_client(url, key)
    agent = _SagaTestAgent(
        agent_name="live_saga_comp_test_agent",
        message_bus=None,  # type: ignore[arg-type]
        database=_DbFacade(supabase),
        config={},
    )

    saga_id = await agent.start_saga("order_sync", context={}, deadline_minutes=10)
    await agent.compensate_saga(saga_id, "timeout error")

    row = (
        supabase.table("saga_state")
        .select("status, error, saga_id")
        .eq("saga_id", saga_id)
        .maybe_single()
        .execute()
    ).data
    assert row, "saga row missing"
    assert row["status"] == "COMPENSATED", row
    assert row["error"] == "timeout error", row

    missing_id = str(uuid.uuid4())
    await agent.compensate_saga(missing_id, "some error")
    ghost_resp = (
        supabase.table("saga_state")
        .select("saga_id")
        .eq("saga_id", missing_id)
        .execute()
    )
    rows = (ghost_resp.data if ghost_resp is not None else None) or []
    assert len(rows) == 0, "unexpected row for random UUID"

    print("OK — compensate_saga sets COMPENSATED + error; unknown UUID returns without exception.")
    print(f"  compensated saga_id={saga_id!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
