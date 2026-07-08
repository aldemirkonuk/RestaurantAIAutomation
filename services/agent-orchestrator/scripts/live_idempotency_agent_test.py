#!/usr/bin/env python3
"""
Live DB sanity test for BaseAgent idempotency (Phase 18 / INFRA-01).

Loads SUPABASE_URL + SUPABASE_SERVICE_KEY (or SUPABASE_KEY) from .env in
services/agent-orchestrator, then runs the same sequence as the UAT checklist.

Usage (from repo):
  cd services/agent-orchestrator && python3 scripts/live_idempotency_agent_test.py

Optional:
  MESSAGE_ID=my-custom-id python3 scripts/live_idempotency_agent_test.py
  python3 scripts/live_idempotency_agent_test.py --cleanup   # delete row after success
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

# Project root: services/agent-orchestrator
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from supabase import create_client

from core.base_agent import BaseAgent


class _LiveTestAgent(BaseAgent):
    """Minimal BaseAgent for idempotency-only live checks."""

    async def initialize(self) -> None:
        return None

    async def process_message(self, message: Dict[str, Any]) -> None:
        return None

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return []


class _DbFacade:
    """Thin wrapper matching BaseAgent's `database.supabase` usage."""

    def __init__(self, supabase: Any) -> None:
        self.supabase = supabase


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Live idempotency test against Supabase"
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Delete the test message_id row after a successful run",
    )
    args = parser.parse_args()

    if load_dotenv:
        load_dotenv(_ROOT / ".env")

    url = os.getenv("SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_SERVICE_KEY")
        or os.getenv("SUPABASE_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        print(
            "Missing SUPABASE_URL or service key (SUPABASE_SERVICE_KEY / SUPABASE_KEY).",
            file=sys.stderr,
        )
        return 1

    message_id = os.getenv("MESSAGE_ID", "msg-001")

    supabase = create_client(url, key)
    # Ensure a clean run for the default id
    try:
        supabase.table("idempotency_keys").delete().eq(
            "message_id", message_id
        ).execute()
    except Exception as exc:
        print(f"Warning: pre-delete skipped: {exc}", file=sys.stderr)

    agent = _LiveTestAgent(
        agent_name="live_idempotency_test",
        message_bus=None,  # type: ignore[arg-type]
        database=_DbFacade(supabase),
        config={},
    )

    result = await agent._check_idempotency(message_id)
    assert result is False, f"Expected False (never seen), got {result!r}"

    await agent._mark_processed(message_id, {"status": "ok"})

    result = await agent._check_idempotency(message_id)
    assert result is True, f"Expected True (seen), got {result!r}"

    row = (
        supabase.table("idempotency_keys")
        .select("message_id, agent_name, result")
        .eq("message_id", message_id)
        .maybe_single()
        .execute()
    )
    data = row.data
    assert data and data.get("message_id") == message_id, f"Row missing in DB: {data!r}"
    print("OK — idempotency live test passed.")
    print(
        f"  message_id={message_id!r} agent_name={data.get('agent_name')!r} result={data.get('result')!r}"
    )

    if args.cleanup:
        supabase.table("idempotency_keys").delete().eq(
            "message_id", message_id
        ).execute()
        print("Cleanup: deleted idempotency_keys row.")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
