"""
WineMatcher AI enrichment — OD-75 outcome-grading tests.

Two twin emit sites, both fixed the same way:

  _ai_enrichment          — Gemini + Google Search grounding. A parse failure
                            raises into the outer handler, which falls back to
                            the non-grounded call.
  _ai_enrichment_fallback — that non-grounded fallback.

Both used to log outcome='success' ABOVE the parse, on the call_level_v0 basis,
so an answer that enriched zero of the 25 master_wine_library fields was
recorded exactly like one that filled them all. OD-75 moved each emit into a
`finally` BELOW the parse, which keeps the fallback chain byte-for-byte intact
while grading the row on whether the answer was usable.

Run: cd services/agent-orchestrator && python -m pytest tests/test_wine_matcher.py -v
"""

from unittest.mock import AsyncMock, MagicMock, patch

import sys

import google
from types import ModuleType

import pytest

from services.wine_matcher import WineMatcher


def _gemini_returning(text: str):
    """A Gemini response carrying `text` and known usage metadata."""
    resp = MagicMock()
    resp.text = text
    resp.usage_metadata.prompt_token_count = 2000
    resp.usage_metadata.candidates_token_count = 450
    resp.usage_metadata.thoughts_token_count = 150
    resp.candidates = []
    return resp


def _matcher():
    return WineMatcher(
        supabase_client=MagicMock(),
        google_api_key="test-key",
        mock_mode=False,
    )


async def _run_grounded(text: str, spend: MagicMock):
    """
    Drive the grounded path with a canned answer.

    `_ai_enrichment_fallback` is stubbed out: on the parse-failure path the real
    one would fire a second live model call, which would both hit the network
    and add a second spend row that this test's call_count assertion is
    specifically there to rule out.
    """
    matcher = _matcher()
    client = MagicMock()
    client.models.generate_content.return_value = _gemini_returning(text)

    with patch("google.genai.Client", return_value=client), patch.object(
        WineMatcher, "_ai_enrichment_fallback", new=AsyncMock(return_value=None)
    ), patch("services.spend_logger.get_spend_logger", return_value=spend):
        return await matcher._ai_enrichment("Château Test", "Test Estate", 2015)


async def _run_fallback(text: str, spend: MagicMock):
    """
    Drive the non-grounded fallback with a canned answer.

    The stub is injected into `sys.modules` rather than patched onto
    `google.generativeai`, because `wine_matcher` does `import
    google.generativeai as genai` INSIDE the function and the legacy SDK is not
    installed in CI — `patch("google.generativeai.configure")` therefore raised
    `AttributeError: module 'google' has no attribute 'generativeai'` there
    while passing locally, where the package happens to exist. Injecting the
    module satisfies the in-function import on either machine.
    """
    matcher = _matcher()
    model = MagicMock()
    model.generate_content.return_value = _gemini_returning(text)

    fake_genai = ModuleType("google.generativeai")
    fake_genai.configure = MagicMock()
    fake_genai.GenerativeModel = MagicMock(return_value=model)

    # `_ai_enrichment_fallback` wraps its whole body in a try/except that
    # returns None, so ANY incidental failure inside it looks like "the model
    # returned nothing" rather than an error. `get_settings()` is a cached
    # singleton other tests mutate, so it is stubbed here too — without this the
    # test passes alone and fails in the full suite, which is precisely how the
    # CI-only failure presented.
    settings = MagicMock()
    settings.gemini_model = "gemini-3.5-flash-lite"

    # BOTH the sys.modules entry and the attribute on the `google` package are
    # needed, and each covers a different machine:
    #   * CI never installs the legacy SDK, so `getattr(google, "generativeai")`
    #     raises and only the sys.modules entry can satisfy the import
    #     (create=True is what allows patching an attribute that is absent).
    #   * Locally the package IS installed, and once any earlier test imports
    #     it, `import google.generativeai as genai` reads the attribute off the
    #     parent package and ignores sys.modules entirely — which made this test
    #     fire a REAL network request ("400 API key not valid") and fail only in
    #     the full suite, never alone.
    with patch.dict(sys.modules, {"google.generativeai": fake_genai}), patch.object(
        google, "generativeai", fake_genai, create=True
    ), patch("services.wine_matcher.get_settings", return_value=settings), patch(
        "services.spend_logger.get_spend_logger", return_value=spend
    ):
        return await matcher._ai_enrichment_fallback(
            "Château Test", "Test Estate", 2015
        )


# ---------------------------------------------------------------------------
# OD-75: grounded enrichment — outcome must reflect the PARSE
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unparseable_grounded_enrichment_records_partial_not_success():
    """
    OD-75: an unparseable grounded answer enriched nothing and dropped the
    matcher onto its fallback. Recording that as 'success' hid the degradation
    entirely — NF showed a completed enrichment for a wine we learned nothing
    about. It must grade 'partial' on the parse_v1 basis.

    The row must still be written exactly once: the grounded call was billed
    before the parse ran, and the stubbed fallback must not add a second row.
    """
    spend = MagicMock()
    result = await _run_grounded("I could not find that wine anywhere.", spend)

    assert result is None  # fell through to the (stubbed) fallback

    # Exactly one row — the spend is owed, but must not be double-counted.
    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "partial"
    assert kwargs["outcome"] != "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is True
    assert kwargs["task_type"] == "wine_enrichment_grounded"
    # Cost survives the parse failure — the call was paid for either way.
    assert kwargs["input_tokens"] == 2000
    assert kwargs["output_tokens"] == 600  # thinking tokens bill as output
    assert kwargs["cost_usd"] > 0


@pytest.mark.asyncio
async def test_parsed_grounded_enrichment_records_success_on_parse_basis():
    """OD-75: a usable grounded answer keeps 'success', now on the parse_v1 basis."""
    spend = MagicMock()
    result = await _run_grounded(
        '```json\n{"name": "Château Test", "region": "Pauillac", '
        '"confidence": 0.92}\n```',
        spend,
    )

    assert result is not None
    assert result["source"] == "gemini_grounded_enrichment"
    assert result["region"] == "Pauillac"

    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is False


# ---------------------------------------------------------------------------
# OD-75: the non-grounded fallback twin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unparseable_fallback_enrichment_records_partial_not_success():
    """
    OD-75: the fallback is the last chance to enrich a wine. Left unfixed it
    would claim 'success' for exactly the answers the grounded path above now
    grades honestly — the worse path scoring better than the better one.
    """
    spend = MagicMock()
    result = await _run_fallback("I'm not familiar with that bottle.", spend)

    assert result is None

    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "partial"
    assert kwargs["outcome"] != "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is True
    assert kwargs["task_type"] == "wine_enrichment_fallback"
    assert kwargs["input_tokens"] == 2000
    assert kwargs["output_tokens"] == 600
    assert kwargs["cost_usd"] > 0


@pytest.mark.asyncio
async def test_parsed_fallback_enrichment_records_success_on_parse_basis():
    """OD-75: a usable fallback answer keeps 'success', now on the parse_v1 basis."""
    spend = MagicMock()
    result = await _run_fallback(
        '{"name": "Château Test", "region": "Pauillac", "confidence": 0.7}',
        spend,
    )

    assert result is not None
    assert result["source"] == "gemini_enrichment_fallback"

    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is False
