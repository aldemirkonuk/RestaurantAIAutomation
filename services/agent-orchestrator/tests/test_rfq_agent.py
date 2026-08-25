"""
RFQAgent vendor-quote parsing — OD-75 outcome-grading tests.

`_parse_vendor_response` asks Claude to turn a vendor's reply into a quote.
Anthropic has no response_mime_type, so the answer can arrive as prose; when it
does the agent silently degrades to `_fallback_parse_response`, a regex that
knows nothing about availability or delivery dates.

The spend emit used to sit ABOVE that parse, recording outcome='success' on the
call_level_v0 basis — i.e. proving only that the HTTP call returned. A quote we
could not read was therefore indistinguishable in NF from one we could, and the
regex-degraded path was invisible. OD-75 moved the emit below the parse.

Run: cd services/agent-orchestrator && python -m pytest tests/test_rfq_agent.py -v
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.rfq_agent import RFQAgent


def make_rfq_agent():
    """RFQAgent with fully mocked bus + database; nothing reaches a network."""
    message_bus = MagicMock()
    message_bus.publish = AsyncMock(return_value=True)
    message_bus.publish_event = AsyncMock(return_value=True)

    database = MagicMock()
    database.supabase = MagicMock()

    return RFQAgent("rfq_agent", message_bus, database, {"mock_mode": False})


def _anthropic_returning(text: str):
    """An Anthropic client whose one call answers with `text` and known usage."""
    block = MagicMock()
    block.type = "text"
    block.text = text

    resp = MagicMock()
    resp.content = [block]
    resp.usage.input_tokens = 900
    resp.usage.output_tokens = 150

    client = AsyncMock()
    client.messages.create = AsyncMock(return_value=resp)
    return client


# ---------------------------------------------------------------------------
# OD-75: outcome must reflect the PARSE, not just the HTTP call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prose_vendor_quote_records_partial_not_success():
    """
    OD-75: an unparseable answer means the agent read no price, no availability
    and no delivery date — it fell back to regex. That is not a completed quote
    parse, and it must record 'partial' on the parse_v1 basis.

    The row must still be written exactly once: the tokens were billed before
    anyone tried to json.loads the text.
    """
    agent = make_rfq_agent()
    agent.llm_client = _anthropic_returning(
        "Sure! We can probably do a good price for you, let me check with the team."
    )
    spend = MagicMock()

    with patch("services.spend_logger.get_spend_logger", return_value=spend):
        result = await agent._parse_vendor_response(
            "Sure! We can probably do a good price for you."
        )

    # Degraded to the regex fallback rather than raising.
    assert result is not None
    assert result["availability"] == "unknown"

    # Exactly one row — the spend is owed, but must not be double-counted.
    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "partial"
    assert kwargs["outcome"] != "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is True
    assert kwargs["choice"] == "quote:parse_failed"
    # Cost survives the parse failure — the call was paid for either way.
    assert kwargs["input_tokens"] == 900
    assert kwargs["output_tokens"] == 150
    assert kwargs["cost_usd"] > 0


@pytest.mark.asyncio
async def test_parsed_vendor_quote_records_success_on_parse_basis():
    """OD-75: a readable quote keeps 'success', now on the parse_v1 basis."""
    agent = make_rfq_agent()
    agent.llm_client = _anthropic_returning(
        'Here is the quote:\n{"price": 24.5, "availability": "in_stock", '
        '"delivery_date": "2026-09-01", "minimum_order": 6, "notes": ""}'
    )
    spend = MagicMock()

    with patch("services.spend_logger.get_spend_logger", return_value=spend):
        result = await agent._parse_vendor_response("We can do $24.50 a bottle.")

    assert result["price"] == 24.5
    assert result["availability"] == "in_stock"

    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is False
    assert kwargs["choice"] == "quote:parsed"
