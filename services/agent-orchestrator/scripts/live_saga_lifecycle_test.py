#!/usr/bin/env python3
"""
Live DB test: saga happy path (Phase 18 / INFRA-06) — start → advance → complete.

Mirrors UAT Test 9; verifies saga_state in Supabase after each phase.

Usage:
  cd services/agent-orchestrator && python3 scripts/live_saga_lifecycle_test.py
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


def _fetch(supabase: Any, saga_id: str) -> Dict[str, Any]:
    r = (
        supabase.table("saga_state")
        .select("*")
        .eq("saga_id", saga_id)
        .maybe_single()
        .execute()
    )
    assert r.data, f"No saga_state row for saga_id={saga_id!r}"
    return r.data


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

    supabase = create_client(url, key)
    agent = _SagaTestAgent(
        agent_name="live_saga_test_agent",
        message_bus=None,  # type: ignore[arg-type]
        database=_DbFacade(supabase),
        config={},
    )

    marker = str(uuid.uuid4())
    saga_id = await agent.start_saga(
        "order_sync",
        context={"order_id": "123", "test_marker": marker},
        deadline_minutes=30,
    )

    row = _fetch(supabase, saga_id)
    assert row["status"] == "IN_PROGRESS"
    assert row["current_step"] == "INIT"
    assert row["saga_type"] == "order_sync"
    assert row["context"].get("order_id") == "123"
    assert row["compensations"] == []

    await agent.advance_saga(
        saga_id,
        "step_2",
        {"compensate": "cancel_order"},
    )
    row = _fetch(supabase, saga_id)
    assert row["current_step"] == "step_2"
    comps = row["compensations"]
    assert isinstance(comps, list) and len(comps) == 1
    assert comps[0]["step"] == "step_2"
    assert comps[0]["compensation"] == {"compensate": "cancel_order"}

    await agent.complete_saga(saga_id)
    row = _fetch(supabase, saga_id)
    assert row["status"] == "COMPLETED"
    assert row["current_step"] == "DONE"

    print("OK — saga lifecycle (start → advance → complete) verified in Supabase.")
    print(f"  saga_id={saga_id!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
