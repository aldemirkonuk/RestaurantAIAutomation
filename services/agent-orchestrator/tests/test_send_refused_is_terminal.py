"""A draft the gateway closed as SEND_REFUSED cannot be re-claimed for a send.

Founder, 2026-09-21 (answer 6): both send paths close a draft on a definite
refusal, with the reason shown. The gateway's own in-process send
(`approveDraft`, an ADR 0172 header refusal) now closes the draft as
`SEND_REFUSED` (migration 20260921114950). The orchestrator claims a
conversation for a send with a NOT-IN block-list
(`ProviderConversationAgent._claim_conversation_for_send`), so a status that is
not on the list is claimable — a replayed approval event would re-open a closed
draft through the other door. This file proves the list holds it.

The fake below reads the claim's REAL `.or_()` filter string, not a hand-kept
copy of the list: a fake that mirrored the list would pass whatever the agent
sent, which is exactly the false pass the relay lane measured on the older
fake in `test_cross_runtime_envelope_and_send_claim.py`.
"""

import re
import types
from unittest.mock import MagicMock

from agents.provider_conversation_agent import ProviderConversationAgent

CONV_ID = "22222222-2222-2222-2222-222222222222"


class _ClaimQuery:
    def __init__(self, row):
        self._row = row
        self._payload = None
        self._or = None
        self._id = None

    def update(self, payload):
        self._payload = payload
        return self

    def eq(self, column, value):
        if column == "id":
            self._id = value
        return self

    def or_(self, filters, *a, **k):
        self._or = filters
        return self

    def execute(self):
        # The claim's own words: "status.is.null,status.not.in.(A,B,...)".
        match = re.search(r"status\.not\.in\.\(([^)]*)\)", self._or or "")
        assert match, f"the claim no longer states a NOT-IN block-list: {self._or!r}"
        blocked = {s.strip() for s in match.group(1).split(",") if s.strip()}
        status = self._row.get("status")
        if status is not None and status in blocked:
            return types.SimpleNamespace(data=[])
        self._row.update(self._payload)
        return types.SimpleNamespace(data=[dict(self._row)])


def _agent(status):
    row = {"id": CONV_ID, "status": status, "message_id": None}
    agent = object.__new__(ProviderConversationAgent)
    agent.logger = MagicMock()
    agent.database = types.SimpleNamespace(
        supabase=types.SimpleNamespace(table=lambda name: _ClaimQuery(row))
    )
    agent.row = row
    return agent


def test_a_send_refused_draft_cannot_be_claimed():
    agent = _agent("SEND_REFUSED")
    claimed = ProviderConversationAgent._claim_conversation_for_send(
        agent, CONV_ID, "<mid@x>"
    )
    assert claimed is False
    assert agent.row["status"] == "SEND_REFUSED"


def test_a_pending_draft_is_still_claimable():
    agent = _agent("PENDING_APPROVAL")
    claimed = ProviderConversationAgent._claim_conversation_for_send(
        agent, CONV_ID, "<mid@x>"
    )
    assert claimed is True
    assert agent.row["status"] == "SENDING"
