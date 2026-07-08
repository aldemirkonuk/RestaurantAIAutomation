#!/usr/bin/env python3
"""
Live DB test: event_store append + unique (aggregate_type, aggregate_id, sequence_number).

The migration uses aggregate_id UUID — use a real UUID (not a string like "item-001").

Usage:
  cd services/agent-orchestrator && python3 scripts/live_event_store_test.py
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


class _EventTestAgent(BaseAgent):
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

    supabase = create_client(url, key)
    agent = _EventTestAgent(
        agent_name="live_event_store_agent",
        message_bus=None,  # type: ignore[arg-type]
        database=_DbFacade(supabase),
        config={},
    )
    correlation = f"evt-test-{uuid.uuid4()}"
    agent._current_correlation_id = correlation

    # Fresh aggregate per run (UUID column — not "item-001")
    aggregate_id = str(uuid.uuid4())

    await agent.append_event(
        aggregate_type="inventory",
        aggregate_id=aggregate_id,
        event_type="stock_decremented",
        payload={"qty": 1},
        sequence_number=1,
    )

    row = (
        supabase.table("event_store")
        .select(
            "aggregate_type, aggregate_id, sequence_number, correlation_id, event_type"
        )
        .eq("aggregate_type", "inventory")
        .eq("aggregate_id", aggregate_id)
        .eq("sequence_number", 1)
        .limit(1)
        .execute()
    )
    rows = row.data or []
    assert len(rows) == 1, rows
    assert rows[0]["correlation_id"] == correlation
    assert rows[0]["event_type"] == "stock_decremented"

    try:
        await agent.append_event(
            aggregate_type="inventory",
            aggregate_id=aggregate_id,
            event_type="stock_decremented",
            payload={"qty": 1},
            sequence_number=1,
        )
    except Exception as exc:
        err = str(exc).lower()
        if "unique" in err or "duplicate" in err or "23505" in err or "violates" in err:
            print("OK — first append succeeded; duplicate append raised (constraint).")
            print(f"  aggregate_id={aggregate_id!r} correlation_id={correlation!r}")
            return 0
        raise

    print("FAIL — duplicate append did not raise.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
