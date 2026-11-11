"""A letter's Message-ID has one stored shape, ``<id>`` (rfc822_message_id.py).

The gateway's copy of the rule is pinned by
apps/api-gateway/src/communications/rfc822-message-id.spec.ts with the same
table, and the SQL backfill by supabase/tests/20270625100000_*_test.sql.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.email_parsing_agent import EmailParsingAgent
from services.email_composer_service import EmailComposerService
from services.rfc822_message_id import (
    canonical_message_id,
    message_id_variants,
    message_ids_in,
)

SHAPES = [
    ("<abc@x.example>", "<abc@x.example>"),
    ("abc@x.example", "<abc@x.example>"),
    (" < Sp@x.example >\r\n", "<Sp@x.example>"),
    ("junk <First@x.example> <second@x.example>", "<First@x.example>"),
    ("<unclosed@x.example", "<unclosed@x.example>"),
    ("closed@x.example>", "<closed@x.example>"),
    ("\tfold@x.example\r\n ", "<fold@x.example>"),
    ('<"a b"@x.example>', '<"a b"@x.example>'),
    ("< >  <real@x.example>", "<real@x.example>"),
    (
        "22c74902-a0c1-4511-804f-341342852c90",
        "<22c74902-a0c1-4511-804f-341342852c90>",
    ),
    ("CAGXpo2W+5AX@Mail.Gmail.com", "<CAGXpo2W+5AX@Mail.Gmail.com>"),
]


@pytest.mark.parametrize("raw,stored", SHAPES)
def test_stored_shape_matches_the_gateway_table(raw, stored):
    assert canonical_message_id(raw) == stored
    assert canonical_message_id(stored) == stored


@pytest.mark.parametrize("raw", ["", "   ", "<>", "< >", None, 42])
def test_no_id_is_none(raw):
    assert canonical_message_id(raw) is None
    assert message_id_variants(raw) == []


def test_variants_match_a_row_stored_either_way():
    assert message_id_variants("<v1@vendor.example>") == [
        "<v1@vendor.example>",
        "v1@vendor.example",
    ]
    assert message_id_variants("v1@vendor.example") == message_id_variants(
        "<v1@vendor.example>"
    )


def test_ids_in_a_references_value():
    assert message_ids_in("<a@x> b@x\r\n\t<a@x> <c@x>") == ["<a@x>", "<b@x>", "<c@x>"]
    assert message_ids_in(None) == []


class _Query:
    """A procurement_conversations chain that records filters and inserts."""

    def __init__(self, store):
        self.store = store
        self.filters = []

    def select(self, *_a):
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, list(values)))
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def limit(self, _n):
        return self

    def insert(self, row):
        self.store["inserted"].append(row)
        return self

    async def execute(self):
        self.store["queries"].append(self.filters)
        rows = []
        for kind, column, value in self.filters:
            if column != "message_id":
                continue
            wanted = value if kind == "in" else [value]
            rows = [r for r in self.store["rows"] if r["message_id"] in wanted]
        return SimpleNamespace(data=rows)


def _agent(rows):
    store = {"rows": rows, "inserted": [], "queries": []}
    agent = EmailParsingAgent.__new__(EmailParsingAgent)
    agent.logger = MagicMock()
    agent.db = SimpleNamespace(
        supabase=SimpleNamespace(table=lambda _name: _Query(store))
    )
    return agent, store


@pytest.mark.asyncio
async def test_a_bracketed_in_reply_to_finds_a_row_stored_bare():
    agent, store = _agent(
        [{"id": "row-1", "order_id": "o-1", "thread_id": "t-1", "message_id": "v1@x"}]
    )
    match = await agent._match_by_headers("<v1@x>", "")
    assert match == {"order_id": "o-1", "thread_id": "t-1", "parent_id": "row-1"}
    assert store["queries"][0] == [("in", "message_id", ["<v1@x>", "v1@x"])]


@pytest.mark.asyncio
async def test_a_bare_reference_finds_a_row_stored_bracketed():
    agent, _ = _agent(
        [{"id": "row-2", "order_id": "o-2", "thread_id": "t-2", "message_id": "<v2@x>"}]
    )
    match = await agent._match_by_headers("", "<root@x> v2@x")
    assert match["parent_id"] == "row-2"


@pytest.mark.asyncio
async def test_the_parsed_letter_is_stored_in_the_canonical_shape():
    agent, store = _agent([])
    for name in (
        "_match_by_gmail_thread_id",
        "_match_by_headers",
        "_match_by_context",
        "_find_provider_by_email",
        "_get_restaurant_id",
        "_generate_thread_summary",
    ):
        setattr(agent, name, AsyncMock(return_value=None))
    agent._detect_intent = AsyncMock(return_value="general")
    await agent._process_inbound_email(
        {
            "from": "Jo <jo@vendor.example>",
            "subject": "Re: order",
            "body": "Fine.",
            "message_id_header": " jo-1@vendor.example ",
            "in_reply_to": "<house-1@wineops.ai>",
        }
    )
    row = store["inserted"][0]
    assert row["message_id"] == "<jo-1@vendor.example>"
    assert json.loads(row["email_headers"])["message_id"] == "<jo-1@vendor.example>"


def test_a_reply_composed_from_a_bare_stored_id_threads():
    composer = EmailComposerService(database=MagicMock(), config={"mock_mode": True})
    history = [
        {
            "email_headers": json.dumps(
                {
                    "message_id": " jo-1@vendor.example ",
                    "references": "root@wineops.ai <mid@wineops.ai>",
                    "gmail_thread_id": "g-1",
                }
            )
        }
    ]
    thread_id, in_reply_to, references = composer._resolve_threading(history)
    assert thread_id == "g-1"
    assert in_reply_to == "<jo-1@vendor.example>"
    # Every token keeps its brackets: the gateway's threadingHeader drops any
    # token that has none.
    assert references == "<jo-1@vendor.example> <root@wineops.ai> <mid@wineops.ai>"
