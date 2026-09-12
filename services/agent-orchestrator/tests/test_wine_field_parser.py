"""
WineFieldParser Gemini extraction — OD-75 outcome-grading tests.

`_parse_with_gemini` turns one OCR'd menu line into 25+ structured fields. When
the answer will not parse the method returns None — the caller gets nothing at
all — yet the spend emit used to sit ABOVE the parse and record
outcome='success' on the call_level_v0 basis, which proves only that Gemini
replied. OD-75 moved the emit into a `finally` BELOW the parse so the outer
`except json.JSONDecodeError` handler still sees the failure unchanged.

Run: cd services/agent-orchestrator && python -m pytest tests/test_wine_field_parser.py -v
"""

from unittest.mock import MagicMock, patch

import pytest

from services.wine_field_parser import WineFieldParser


def _gemini_returning(text: str):
    """A Gemini response carrying `text` and known usage metadata."""
    resp = MagicMock()
    resp.text = text
    resp.usage_metadata.prompt_token_count = 1500
    resp.usage_metadata.candidates_token_count = 320
    resp.usage_metadata.thoughts_token_count = 80
    return resp


async def _run_parse(text: str, spend: MagicMock):
    """Drive _parse_with_gemini with a canned Gemini answer."""
    parser = WineFieldParser(google_api_key="test-key", mock_mode=False)

    client = MagicMock()
    client.models.generate_content.return_value = _gemini_returning(text)

    with patch.object(
        parser, "_get_llm_client", return_value=(client, MagicMock())
    ), patch("services.spend_logger.get_spend_logger", return_value=spend):
        return await parser._parse_with_gemini(
            ocr_text="Chateau Test 2015 Pauillac 120",
            corrected_text="Château Test 2015 Pauillac 120",
            section_header="RED WINES",
            yolo_detections=None,
            restaurant_country="USA",
        )


# ---------------------------------------------------------------------------
# OD-75: outcome must reflect the PARSE, not just the HTTP call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unparseable_field_extraction_records_partial_not_success():
    """
    OD-75: the field parser produced nothing — no wine_name, no price, no
    governance tier — and the caller received None. Grading that 'success'
    made a total extraction failure look like a completed one in NF.

    It must record 'partial' on the parse_v1 basis, and the row must still be
    written exactly once because the tokens were billed before the parse ran.
    """
    spend = MagicMock()
    result = await _run_parse("Sorry, I can't read this menu line.", spend)

    assert result is None

    # Exactly one row — the spend is owed, but must not be double-counted.
    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "partial"
    assert kwargs["outcome"] != "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is True
    # Cost survives the parse failure — the call was paid for either way.
    assert kwargs["input_tokens"] == 1500
    assert kwargs["output_tokens"] == 400  # thinking tokens bill as output
    assert kwargs["cost_usd"] > 0


@pytest.mark.asyncio
async def test_parsed_field_extraction_records_success_on_parse_basis():
    """OD-75: a schema-valid answer keeps 'success', now on the parse_v1 basis."""
    spend = MagicMock()
    result = await _run_parse(
        '{"wine_name": "Château Test", "producer": "Test Estate", '
        '"vintage": 2015, "wine_type": "red", "confidence": 0.9}',
        spend,
    )

    assert result is not None
    assert result.wine_name == "Château Test"

    assert spend.log.call_count == 1
    kwargs = spend.log.call_args.kwargs
    assert kwargs["outcome"] == "success"
    assert kwargs["context"]["outcome_basis"] == "parse_v1"
    assert kwargs["context"]["parse_failed"] is False
