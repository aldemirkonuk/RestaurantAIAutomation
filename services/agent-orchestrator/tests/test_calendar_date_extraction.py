"""
CalendarAgent date extraction — OD-63 regression tests.

The bug: `_extract_important_dates` built the LLM prompt and handed THAT to
`_call_llm_for_dates`, which handed it on to `_regex_date_extraction` when the
model call failed. DATE_EXTRACTION_PROMPT embeds today's date and two literal
example dates (2026-02-15, 2026-03-01), so every fallback manufactured at least
three dates at confidence 0.6, upserted into provider_important_dates with
source="llm_extraction" — indistinguishable from a real extraction.

It mattered more than it looked: before ADR 0010 the agent had no genai
configuration and named a retired model, so the LLM call always threw and the
fallback WAS the whole behaviour.
"""

from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.calendar_agent import DATE_EXTRACTION_PROMPT, CalendarAgent


@pytest.fixture
def llm_down():
    """
    Force the fallback path explicitly.

    Without this the tests would rely on the real Gemini client happening to
    fail — which is both a live network call and, if a key were ever present in
    CI, a test that silently stops exercising the fallback at all.
    """
    with patch(
        "services.model_clients.get_gemini_client",
        side_effect=RuntimeError("gemini unavailable (test)"),
    ):
        yield


def make_calendar_agent():
    """CalendarAgent with fully mocked bus + database; nothing reaches a network."""
    message_bus = MagicMock()
    message_bus.publish = AsyncMock(return_value=True)
    message_bus.publish_event = AsyncMock(return_value=True)

    supabase = MagicMock()
    database = MagicMock()
    database.supabase = supabase

    agent = CalendarAgent("calendar_agent", message_bus, database, {})
    return agent, supabase


# ---------------------------------------------------------------------------
# The template's own dates — the thing that used to leak into the ledger
# ---------------------------------------------------------------------------

TEMPLATE_EXAMPLE_DATES = ("2026-02-15", "2026-03-01")


def test_prompt_template_still_contains_the_dates_this_bug_was_about():
    """
    Anchors the premise. If someone rewrites the prompt without example dates,
    the tests below stop proving anything, and this failure says why.
    """
    for d in TEMPLATE_EXAMPLE_DATES:
        assert d in DATE_EXTRACTION_PROMPT
    assert "{today}" in DATE_EXTRACTION_PROMPT


def test_regex_fallback_on_the_prompt_would_have_invented_dates():
    """
    Demonstrates the defect directly: the formatted prompt regexes to >= 3
    fabricated dates at confidence 0.6. This is what production was writing.
    """
    agent, _ = make_calendar_agent()
    prompt = DATE_EXTRACTION_PROMPT.format(
        conversation="hello, nothing dated in here",
        provider_name="Acme Wines",
        today="2026-08-25",
    )

    results = agent._regex_date_extraction(prompt)
    dates = {r["date"] for r in results}

    assert TEMPLATE_EXAMPLE_DATES[0] in dates
    assert TEMPLATE_EXAMPLE_DATES[1] in dates
    assert "2026-08-25" in dates  # today, from the template
    assert all(r["confidence"] == 0.6 for r in results if r["date"] in dates)


@pytest.mark.asyncio
async def test_fallback_parses_the_conversation_not_the_prompt(llm_down):
    """
    The fix. With the LLM path failing, the fallback must see ONLY vendor text —
    so a conversation with no dates yields no rows, and the template's example
    dates never appear.
    """
    agent, _ = make_calendar_agent()

    results = await agent._call_llm_for_dates(
        "Thanks for the order, we will be in touch.",
        provider_name="Acme Wines",
    )

    assert results == [], f"fallback invented dates from nothing: {results}"


@pytest.mark.asyncio
async def test_fallback_still_extracts_dates_the_vendor_actually_wrote(llm_down):
    """The fix must not neuter the fallback — real dates in the body survive."""
    agent, _ = make_calendar_agent()

    results = await agent._call_llm_for_dates(
        "We can deliver on 2026-09-14, and the tasting is 10/02/2026.",
        provider_name="Acme Wines",
    )

    dates = {r["date"] for r in results}
    assert "2026-09-14" in dates
    assert "2026-10-02" in dates
    for d in TEMPLATE_EXAMPLE_DATES:
        assert d not in dates


@pytest.mark.asyncio
async def test_end_to_end_no_spurious_rows_reach_provider_important_dates(llm_down):
    """
    The consequence that OD-63 is actually about: what gets WRITTEN. Drive the
    real message path with a dateless conversation and assert the upsert never
    fires — previously it fired at least three times per fallback.
    """
    agent, supabase = make_calendar_agent()

    written: List[Dict[str, Any]] = []

    def table(name):
        t = MagicMock()

        def upsert(payload, **kwargs):
            written.append({"table": name, "payload": payload})
            return t

        def insert(payload, **kwargs):
            written.append({"table": name, "payload": payload})
            return t

        t.upsert.side_effect = upsert
        t.insert.side_effect = insert
        t.execute.return_value = MagicMock()
        return t

    supabase.table.side_effect = table

    await agent._extract_important_dates(
        {
            "routing_key": "procurement.conversation.completed",
            "payload": {
                "conversation": "Hi — confirming receipt of your order. Regards.",
                "provider_id": "11111111-1111-1111-1111-111111111111",
                "provider_name": "Acme Wines",
                "restaurant_id": "22222222-2222-2222-2222-222222222222",
            },
        }
    )

    spurious = [
        w
        for w in written
        if w["table"] == "provider_important_dates"
        and w["payload"].get("date") in TEMPLATE_EXAMPLE_DATES
    ]
    assert not spurious, f"template example dates persisted as vendor data: {spurious}"
    assert not written, f"a dateless conversation wrote rows anyway: {written}"


@pytest.mark.asyncio
async def test_caller_cannot_hand_the_prompt_to_the_fallback_any_more():
    """
    Structural guard, not a behavioural one. The fix was to build the prompt
    INSIDE _call_llm_for_dates so the formatted template never exists in the
    caller's scope — there is no longer a wrong string available to pass. Pin
    the signature so a refactor that reintroduces a `prompt` parameter has to
    argue with this test.
    """
    import inspect

    params = list(inspect.signature(CalendarAgent._call_llm_for_dates).parameters)
    assert params[1] == "conversation"
    assert "prompt" not in params
