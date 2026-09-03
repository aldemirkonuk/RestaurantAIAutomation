"""An unreadable push-subscription source must not look like "no devices".

``push_subscriptions`` does not exist in production: PostgREST answers
``404 PGRST205 / Could not find the table 'public.push_subscriptions' in the
schema cache`` to the service-role key (curl, 2026-08-26), and postgrest-py
turns any non-2xx into a raised ``APIError``
(``postgrest/_sync/request_builder.py:78``). This file uses that real exception
rather than a stand-in, so the double cannot drift from what production raises.

The old ``_get_push_subscriptions`` caught it and returned ``[]``. That logged a
line, but the return value was indistinguishable from "this manager registered
no device", so every caller skipped its push loop, appended nothing to
``results``, and ``_log_notification`` persisted a notification whose push leg
was absent -- and whose ``success`` was computed over the remaining legs, so a
total push failure was recorded as a successful notification.
"""

from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError

from agents.notification_agent import (
    PUSH_SUBSCRIPTION_TABLE,
    NotificationAgent,
    PushSubscriptionSourceError,
)

MANAGER_ID = "mgr-1"

# Exactly what postgrest-py raises for a table that is not in the schema cache.
MISSING_TABLE = APIError(
    {
        "code": "PGRST205",
        "details": None,
        "hint": None,
        "message": (
            "Could not find the table 'public.push_subscriptions' "
            "in the schema cache"
        ),
    }
)


def _agent(table_behaviour):
    """A bare NotificationAgent whose supabase table() applies `table_behaviour`."""
    agent = NotificationAgent.__new__(NotificationAgent)
    agent.logger = MagicMock()

    class _Builder:
        def select(self, *_a, **_k):
            return self

        def eq(self, *_a, **_k):
            return self

        def execute(self):
            return table_behaviour()

    class _Supabase:
        def __init__(self):
            self.tables_read = []

        def table(self, name):
            self.tables_read.append(name)
            return _Builder()

    supabase = _Supabase()
    agent.database = MagicMock()
    agent.database.supabase = supabase
    return agent, supabase


def _raises():
    raise MISSING_TABLE


def _returns(rows):
    def _inner():
        response = MagicMock()
        response.data = rows
        return response

    return _inner


@pytest.mark.asyncio
async def test_missing_table_raises_instead_of_returning_empty():
    agent, supabase = _agent(_raises)

    with pytest.raises(PushSubscriptionSourceError) as excinfo:
        await agent._get_push_subscriptions(MANAGER_ID)

    # Enough identity to act on: which table, which manager, which PostgREST code.
    message = str(excinfo.value)
    assert PUSH_SUBSCRIPTION_TABLE in message
    assert MANAGER_ID in message
    assert "PGRST205" in message
    assert supabase.tables_read == [PUSH_SUBSCRIPTION_TABLE]


@pytest.mark.asyncio
async def test_empty_table_still_means_no_devices():
    """The other half of the distinction: [] must survive as []."""
    agent, _ = _agent(_returns([]))

    assert await agent._get_push_subscriptions(MANAGER_ID) == []


@pytest.mark.asyncio
async def test_successful_read_returns_rows():
    rows = [{"id": "s1", "subscription_data": {}, "type": "web_push"}]
    agent, _ = _agent(_returns(rows))

    assert await agent._get_push_subscriptions(MANAGER_ID) == rows


@pytest.mark.asyncio
async def test_push_targets_records_a_failed_push_leg_in_results():
    """The degrade path must leave a trace the notification log can persist.

    `_log_notification` computes `success` as
    `all(r[1].get("success", False) for r in results)`, so this appended leg is
    what turns the persisted notification from "sent" into "failed".
    """
    agent, _ = _agent(_raises)
    results: list = []

    targets = await agent._push_targets(MANAGER_ID, results)

    assert targets == []
    assert len(results) == 1
    channel, outcome = results[0]
    assert channel == "push"
    assert outcome["success"] is False
    assert outcome["source_unreadable"] is True
    assert "PGRST205" in outcome["error"]


@pytest.mark.asyncio
async def test_push_targets_logs_a_greppable_error_marker():
    agent, _ = _agent(_raises)

    await agent._push_targets(MANAGER_ID, [])

    logged = " ".join(str(c) for c in agent.logger.error.call_args_list)
    assert "PUSH_SUBSCRIPTIONS_UNREADABLE" in logged
    assert MANAGER_ID in logged
    assert PUSH_SUBSCRIPTION_TABLE in logged


@pytest.mark.asyncio
async def test_push_targets_stays_quiet_when_the_manager_simply_has_no_device():
    agent, _ = _agent(_returns([]))
    results: list = []

    assert await agent._push_targets(MANAGER_ID, results) == []
    assert results == []
    agent.logger.error.assert_not_called()
