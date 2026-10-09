"""
F-047: one inbound reply is one procurement_conversations row.

The gateway (rabbitmq-bridge handleInboundEmail) and EmailParsingAgent both
consume email.inbound.received and both store the message. The gateway skips a
gmail_message_id it already holds; the agent wrote no gmail_message_id and
checked nothing, so the same reply landed twice. The agent now writes the id and
skips a message already stored.
"""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock

from agents.email_parsing_agent import EmailParsingAgent


class _Query:
    def __init__(self, table, existing):
        self._table = table
        self._existing = existing

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def insert(self, row):
        self._table.inserted.append(row)
        return self

    async def execute(self):
        return MagicMock(data=[{"id": "row-1"}] if self._existing else [])


class _Supabase:
    def __init__(self, existing):
        self.existing = existing
        self.inserted = []

    def table(self, _name):
        return _Query(self, self.existing)


def _agent(existing):
    agent = object.__new__(EmailParsingAgent)
    agent.logger = logging.getLogger("test")
    agent.db = MagicMock()
    agent.db.supabase = _Supabase(existing)
    for name in (
        "_match_by_gmail_thread_id",
        "_match_by_headers",
        "_match_by_context",
        "_find_provider_by_email",
        "_find_thread_for_order",
        "_get_restaurant_id",
        "_generate_thread_summary",
        "_route_to_procurement",
        "_notify_frontend",
    ):
        setattr(agent, name, AsyncMock(return_value=None))
    agent._detect_intent = AsyncMock(return_value="other")
    return agent


PAYLOAD = {
    "from": "Vendor <rep@vendor.example>",
    "subject": "Re: order",
    "body": "Shipping Tuesday.",
    "gmail_message_id": "gm-1",
    "gmail_thread_id": "gt-1",
}


def test_a_message_the_gateway_already_stored_is_not_stored_again():
    agent = _agent(existing=True)
    asyncio.run(agent._process_inbound_email(dict(PAYLOAD)))
    assert agent.db.supabase.inserted == []


def test_a_new_message_is_stored_once_with_its_gmail_ids():
    agent = _agent(existing=False)
    asyncio.run(agent._process_inbound_email(dict(PAYLOAD)))
    assert len(agent.db.supabase.inserted) == 1
    row = agent.db.supabase.inserted[0]
    assert row["gmail_message_id"] == "gm-1"
    assert row["gmail_thread_id"] == "gt-1"
