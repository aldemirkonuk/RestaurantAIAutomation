"""
E2E: Extraction Pipeline Tests
================================
End-to-end coverage of POST /api/v1/onboarding/extract covering:
  POST /extract → submission persisted → field_confidence → review_queue → Haiku queued

All Supabase, Claude Vision, and Celery calls are mocked.
No live API or DB dependency.
"""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock

pytestmark = pytest.mark.e2e

# Patch targets (relative to the onboarding_routes module)
_SUPABASE_PATCH = "api.onboarding_routes.get_supabase_client"
_EXTRACTOR_PATCH = "api.onboarding_routes.get_claude_vision_extractor"
_HAIKU_PATCH = "api.onboarding_routes.haiku_enrich_task"

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_extraction_result(wines=None):
    """Build a mock ClaudeExtractionResult."""
    import uuid

    if wines is None:
        wines = [
            {
                "wine_name": "Barolo Riserva",
                "producer": "Giacomo Conterno",
                "vintage": 2019,
                "region": "Piedmont",
                "country": None,  # below threshold — rejected
                "grape_variety": None,  # triggers Haiku enrichment
                "field_confidence": {
                    "wine_name": {
                        "value": "Barolo Riserva",
                        "confidence": 0.97,
                        "source": "visible",
                    },
                    "vintage": {
                        "value": "2019",
                        "confidence": 0.88,
                        "source": "visible",
                    },
                    "region": {
                        "value": "Piedmont",
                        "confidence": 0.65,
                        "source": "inferred",
                    },
                    "country": {
                        "value": None,
                        "confidence": 0.35,
                        "source": "inferred",
                    },
                },
                "completeness_score": 0.72,
                "needs_review": True,
            },
            {
                "wine_name": "Chianti Classico",
                "producer": "Antinori",
                "vintage": 2020,
                "region": "Tuscany",
                "country": "Italy",
                "grape_variety": None,  # triggers Haiku enrichment
                "field_confidence": {
                    "wine_name": {
                        "value": "Chianti Classico",
                        "confidence": 0.95,
                        "source": "visible",
                    },
                    "vintage": {
                        "value": "2020",
                        "confidence": 0.90,
                        "source": "visible",
                    },
                    "region": {
                        "value": "Tuscany",
                        "confidence": 0.72,
                        "source": "inferred",
                    },
                    "country": {
                        "value": "Italy",
                        "confidence": 0.88,
                        "source": "visible",
                    },
                },
                "completeness_score": 0.80,
                "needs_review": False,
            },
        ]

    result = MagicMock()
    result.wines = wines
    result.total_wines = len(wines)
    result.total_cost_usd = 0.006
    result.scan_session_id = str(uuid.uuid4())
    result.pages_processed = 1
    result.needs_review_count = sum(1 for w in wines if w.get("needs_review"))
    result.page_errors = []
    return result


def _make_supabase_mock(submission_id="sub-001"):
    """Build a Supabase mock that simulates insert → execute → data pattern."""
    supabase = MagicMock()

    # api_spend preflight check — returns 0 spend (under cap)
    spend_mock = MagicMock()
    spend_mock.select.return_value.eq.return_value.execute.return_value.data = []

    # master_wine_library_submissions insert
    submissions_mock = MagicMock()
    submissions_mock.insert.return_value.execute.return_value.data = [
        {"id": submission_id}
    ]

    # field_review_queue insert
    review_queue_mock = MagicMock()
    review_queue_mock.insert.return_value.execute.return_value.data = [{}]

    def _table_side_effect(name: str):
        mapping = {
            "api_spend": spend_mock,
            "master_wine_library_submissions": submissions_mock,
            "field_review_queue": review_queue_mock,
        }
        return mapping.get(name, MagicMock())

    supabase.table.side_effect = _table_side_effect
    return supabase, submissions_mock, review_queue_mock


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------


class TestExtractionPipelineE2E:

    def test_extraction_creates_submission_with_field_confidence(self, test_client):
        """
        POST /extract with 2 wines → submissions inserted with field_confidence JSONB.
        Haiku enrichment queued for wines missing region/country/grape_variety.
        """
        supabase, submissions_mock, _ = _make_supabase_mock("sub-001")
        result = _make_extraction_result()

        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=result)

        mock_haiku = MagicMock()
        mock_haiku.delay = MagicMock()

        with (
            patch(_SUPABASE_PATCH, return_value=supabase),
            patch(_EXTRACTOR_PATCH, return_value=mock_extractor),
            patch(_HAIKU_PATCH, mock_haiku),
        ):
            resp = test_client.post(
                "/api/v1/onboarding/extract",
                json={"restaurant_id": "test-r-001", "images": ["base64data"]},
            )

        assert (
            resp.status_code == 200
        ), f"Expected 200 got {resp.status_code}: {resp.text}"

        # Supabase insert was called for each wine
        assert (
            submissions_mock.insert.called
        ), "Expected master_wine_library_submissions.insert() to be called"

        # Inspect insert payload for first wine
        call_args = submissions_mock.insert.call_args_list[0][0][0]
        assert (
            "field_confidence" in call_args
        ), "Insert payload missing field_confidence"
        assert call_args["field_confidence"] is not None

        # auto_blocked is present in payload
        assert "auto_blocked" in call_args, "Insert payload missing auto_blocked"

        # Haiku delay was called (wines missing grape_variety)
        assert (
            mock_haiku.delay.called
        ), "Expected haiku_enrich_task.delay() to be called"

    def test_extraction_routes_mid_confidence_to_review_queue(self, test_client):
        """
        Fields with 0.50–0.80 confidence → inserted into field_review_queue.
        Region at 0.65 should appear in the queue.
        """
        supabase, submissions_mock, review_queue_mock = _make_supabase_mock("sub-002")
        result = _make_extraction_result()

        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=result)

        mock_haiku = MagicMock()
        mock_haiku.delay = MagicMock()

        with (
            patch(_SUPABASE_PATCH, return_value=supabase),
            patch(_EXTRACTOR_PATCH, return_value=mock_extractor),
            patch(_HAIKU_PATCH, mock_haiku),
        ):
            resp = test_client.post(
                "/api/v1/onboarding/extract",
                json={"restaurant_id": "test-r-002", "images": ["base64data"]},
            )

        assert resp.status_code == 200

        # field_review_queue insert was called for mid-confidence fields
        assert (
            review_queue_mock.insert.called
        ), "Expected field_review_queue.insert() to be called for mid-confidence fields"

        # Inspect queue rows — region (0.65) should be in the queue
        queue_call_args = review_queue_mock.insert.call_args_list[0][0][0]
        # Queue rows is a list of dicts
        if isinstance(queue_call_args, list):
            field_names = [row["field_name"] for row in queue_call_args]
        else:
            field_names = [queue_call_args.get("field_name")]

        assert (
            "region" in field_names
        ), f"Expected 'region' in field_review_queue rows, got {field_names}"

        # Check that the region entry has status=pending and correct confidence
        region_rows = [
            r
            for r in (
                queue_call_args
                if isinstance(queue_call_args, list)
                else [queue_call_args]
            )
            if r.get("field_name") == "region"
        ]
        assert region_rows, "No region row found in review_queue insert"
        region_row = region_rows[0]
        assert region_row.get("status") == "pending"
        assert 0.50 <= region_row.get("confidence", 0) <= 0.80

    def test_extraction_rejects_below_threshold(self, test_client):
        """
        Fields with confidence < 0.50 (country at 0.35) must NOT appear in
        the accepted flat payload but MUST be present in field_confidence JSONB.
        """
        supabase, submissions_mock, _ = _make_supabase_mock("sub-003")
        result = _make_extraction_result()

        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=result)

        mock_haiku = MagicMock()
        mock_haiku.delay = MagicMock()

        with (
            patch(_SUPABASE_PATCH, return_value=supabase),
            patch(_EXTRACTOR_PATCH, return_value=mock_extractor),
            patch(_HAIKU_PATCH, mock_haiku),
        ):
            resp = test_client.post(
                "/api/v1/onboarding/extract",
                json={"restaurant_id": "test-r-003", "images": ["base64data"]},
            )

        assert resp.status_code == 200

        # Inspect insert payload for first wine (country confidence 0.35 → rejected)
        call_args = submissions_mock.insert.call_args_list[0][0][0]

        # field_confidence JSONB should contain country
        fc = call_args.get("field_confidence", {})
        assert "country" in fc, "country should be present in field_confidence JSONB"
        assert fc["country"]["confidence"] == 0.35

        # payload (accepted_fields) should NOT contain country as a top-level key
        payload = call_args.get("payload", {})
        assert "country" not in payload, (
            f"country (confidence 0.35) should be rejected from flat payload, "
            f"but found in payload: {payload}"
        )

    def test_extraction_per_restaurant_cap_returns_402(self, test_client):
        """
        When cumulative spend > PER_RESTAURANT_CAP_USD=$2.00 → HTTP 402.
        """
        supabase = MagicMock()

        # api_spend returns $3.00 — exceeds cap
        spend_mock = MagicMock()
        spend_mock.select.return_value.eq.return_value.execute.return_value.data = [
            {"cost_usd": 3.00}
        ]
        supabase.table.return_value = spend_mock

        mock_extractor = MagicMock()
        mock_haiku = MagicMock()
        mock_haiku.delay = MagicMock()

        with (
            patch(_SUPABASE_PATCH, return_value=supabase),
            patch(_EXTRACTOR_PATCH, return_value=mock_extractor),
            patch(_HAIKU_PATCH, mock_haiku),
            # Suppress email sending
            patch("api.onboarding_routes._send_cap_alert_email"),
        ):
            resp = test_client.post(
                "/api/v1/onboarding/extract",
                json={"restaurant_id": "test-r-cap", "images": ["base64data"]},
            )

        assert (
            resp.status_code == 402
        ), f"Expected 402 got {resp.status_code}: {resp.text}"
        detail = resp.json().get("detail", "")
        assert (
            "cap" in detail.lower() or "exceed" in detail.lower()
        ), f"Expected cap/exceed in error detail, got: {detail}"

    def test_extraction_missing_images_returns_422(self, test_client):
        """
        POST /extract with both images=null and pdf_base64=null → 422 Unprocessable.
        """
        with patch(_SUPABASE_PATCH, return_value=None):
            resp = test_client.post(
                "/api/v1/onboarding/extract",
                json={
                    "restaurant_id": "test-r-422",
                    "images": None,
                    "pdf_base64": None,
                },
            )

        assert (
            resp.status_code == 422
        ), f"Expected 422 got {resp.status_code}: {resp.text}"
