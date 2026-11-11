"""EmailParsingAgent files nothing: the gateway bridge is the one writer."""

import asyncio
from unittest.mock import AsyncMock

from mail_store import Store
from test_email_house_scope import _agent, _houses, _letter


def test_a_letter_the_old_pipeline_would_file_is_not_filed_here():
    store = Store(_houses())
    agent = _agent(store)
    agent.database, agent.message_bus = store, AsyncMock()
    asyncio.run(agent.process_message(_letter(gmail_thread_id="T-A")))
    assert (store.inserts, store.reads, agent.calls) == ([], [], [])
    agent.message_bus.publish.assert_not_called()
