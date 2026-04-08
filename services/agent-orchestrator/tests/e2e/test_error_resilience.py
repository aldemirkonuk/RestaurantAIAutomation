"""
E2E: Error Resilience Tests (Phase 14 Plan 04 — Task 2).

Verifies graceful degradation when downstream dependencies (Supabase, Claude Vision,
Celery) are unavailable or fail. All error responses must be structured 503/4xx with
informative messages, never unhandled 500s or raw stack traces.

COVERAGE MAP: HTTP Endpoint → E2E Test
=======================================
GET  /health
    → test_health.py::TestHealthEndpoint::test_health_endpoint_returns_ok
    → test_error_resilience.py::TestErrorResilience::test_health_always_returns_200

POST /api/v1/onboarding/extract
    → test_extraction_pipeline.py::TestExtractionPipelineE2E::test_extraction_creates_submission_with_field_confidence
    → test_extraction_pipeline.py::TestExtractionPipelineE2E::test_extraction_routes_mid_confidence_to_review_queue
    → test_extraction_pipeline.py::TestExtractionPipelineE2E::test_extraction_rejects_below_threshold
    → test_extraction_pipeline.py::TestExtractionPipelineE2E::test_extraction_per_restaurant_cap_returns_402
    → test_extraction_pipeline.py::TestExtractionPipelineE2E::test_extraction_missing_images_returns_422
    → test_error_resilience.py::TestErrorResilience::test_extract_returns_503_when_extractor_fails
    → test_error_resilience.py::TestErrorResilience::test_extraction_cap_check_fails_open

GET  /api/v1/quality/review-queue
    → test_api_endpoints.py::TestQualityPipeline::test_review_queue_returns_pending_fields_grouped_by_wine
    → test_error_resilience.py::TestErrorResilience::test_quality_review_queue_returns_503_when_supabase_down

PATCH /api/v1/quality/review-queue/{submission_id}
    → test_api_endpoints.py::TestQualityPipeline::test_review_queue_patch_correction_promotes_to_library
    → test_api_endpoints.py::TestQualityPipeline::test_review_queue_patch_does_not_promote_when_fields_remain

GET  /api/v1/quality/calibration
    → test_api_endpoints.py::TestQualityPipeline::test_calibration_endpoint_returns_thresholds

POST /api/v1/studio/overrides
    → test_studio_pipeline.py::TestStudioOverridePipeline::test_developer_override_auto_promotes
    → test_studio_pipeline.py::TestStudioOverridePipeline::test_developer_override_requires_reason_for_high_confidence
    → test_studio_pipeline.py::TestStudioOverridePipeline::test_contributor_override_lands_in_pending_queue
    → test_promotion_path.py::TestPromotionPath::test_auto_promoted_override_triggers_library_promotion
    → test_promotion_path.py::TestPromotionPath::test_promotion_skipped_when_fields_still_pending
    → test_promotion_path.py::TestPromotionPath::test_promotion_skipped_when_auto_blocked
    → test_error_resilience.py::TestErrorResilience::test_studio_override_returns_503_when_supabase_down

PATCH /api/v1/studio/queue/{override_id}
    → test_studio_pipeline.py::TestStudioOverridePipeline::test_admin_approves_pending_override
    → test_studio_pipeline.py::TestStudioOverridePipeline::test_admin_rejects_pending_override
    → test_studio_pipeline.py::TestStudioOverridePipeline::test_already_decided_override_returns_409
    → test_promotion_path.py::TestPromotionPath::test_admin_approve_triggers_library_promotion

GET  /api/v1/studio/queue
    → test_health.py::TestRouterRegistration::test_all_router_prefixes_reachable[studio-...]

GET  /api/v1/studio/metrics
    → test_studio_pipeline.py::TestStudioOverridePipeline::test_studio_metrics_returns_kpis

POST /api/v1/studio/invite
POST /api/v1/studio/invite/redeem
    → test_studio_pipeline.py::TestStudioOverridePipeline::test_invite_create_and_redeem_flow

GET  /api/v1/studio/me/roles
    → test_error_resilience.py::TestErrorResilience::test_studio_me_roles_returns_empty_on_error

GET  /api/v1/research/metrics
    → test_api_endpoints.py::TestResearchAPI::test_research_metrics_handles_empty_tables
    → test_api_endpoints.py::TestResearchAPI::test_research_metrics_computes_from_data
    → test_error_resilience.py::TestErrorResilience::test_research_metrics_handles_partial_table_failures

POST /api/v1/research/trigger
    → test_api_endpoints.py::TestResearchAPI::test_research_trigger_requires_admin_key
    → test_api_endpoints.py::TestResearchAPI::test_research_trigger_blocks_concurrent_runs

GET  /api/v1/analytics/wine/{wine_id}/scores
    → test_api_endpoints.py::TestAnalyticsAPI::test_wine_scores_returns_critic_data
    → test_api_endpoints.py::TestAnalyticsAPI::test_wine_scores_invalid_uuid_returns_422
    → test_error_resilience.py::TestErrorResilience::test_analytics_unavailable_returns_503

GET  /api/v1/analytics/trends
    → test_api_endpoints.py::TestAnalyticsAPI::test_trends_returns_trending_wines
    → test_health.py::TestRouterRegistration::test_all_router_prefixes_reachable[analytics-...]

GET  /api/v1/analytics/wine/{wine_id}/timeline
    → test_api_endpoints.py::TestAnalyticsAPI::test_wine_timeline_returns_lifecycle

POST /api/v1/preview/detect
    → test_health.py::TestRouterRegistration::test_all_router_prefixes_reachable[preview-...]

UNTESTED (no HTTP route):
- NotificationAgent, ProcurementAgent, EmailParsingAgent, CalendarAgent, etc. (Python agents
  with no FastAPI router mounted in main.py — tested separately via unit tests)
- Operations pipeline (stock, orders, email, delivery) — agents exist but are not wired to
  HTTP endpoints in the current release
- Celery beat jobs (calibration_tasks, spend_tasks) — background tasks without HTTP surface
"""

import uuid
import pytest
from unittest.mock import MagicMock, patch, AsyncMock

pytestmark = pytest.mark.e2e

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
E2E_SECRET = "e2e-secret"
WRONG_SECRET = "definitely-not-the-right-secret"

DEVELOPER_PAYLOAD = {
    "sub": "dev-e2e-001",
    "email": "developer@e2e-test.com",
    "app_metadata": {"roles": ["developer"]},
}

_SUPABASE_PATCH = "api.onboarding_routes.get_supabase_client"
_EXTRACTOR_PATCH = "api.onboarding_routes.get_claude_vision_extractor"
_HAIKU_PATCH = "api.onboarding_routes.haiku_enrich_task"


def _make_jwt(payload: dict, secret: str = E2E_SECRET) -> str:
    import jwt as pyjwt
    return pyjwt.encode(payload, secret, algorithm="HS256")


def _make_settings(jwt_secret: str = E2E_SECRET):
    return type("S", (), {
        "supabase_jwt_secret": jwt_secret,
        "trust_level_threshold": 5,
    })()


def _make_extraction_result_mock():
    """Minimal valid ClaudeExtractionResult for cap-check-fails-open test."""
    result = MagicMock()
    result.wines = [{
        "wine_name": "Test Wine",
        "producer": "Test Producer",
        "vintage": 2021,
        "field_confidence": {
            "wine_name": {"value": "Test Wine", "confidence": 0.95, "source": "visible"},
            "vintage": {"value": "2021", "confidence": 0.90, "source": "visible"},
        },
        "completeness_score": 0.90,
        "needs_review": False,
    }]
    result.total_wines = 1
    result.total_cost_usd = 0.003
    result.scan_session_id = str(uuid.uuid4())
    result.pages_processed = 1
    result.needs_review_count = 0
    result.page_errors = []
    return result


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestErrorResilience:

    def test_extract_returns_503_when_extractor_fails(self, test_client):
        """
        Claude Vision extractor raises RuntimeError → POST /onboarding/extract → 503.
        Verifies the route catches RuntimeError and converts to a structured 503 response
        (error detail exposed, but no raw stack trace).
        """
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(side_effect=RuntimeError("All pages failed: API timeout"))

        with patch(_SUPABASE_PATCH, return_value=None), \
             patch(_EXTRACTOR_PATCH, return_value=mock_extractor):

            resp = test_client.post(
                "/api/v1/onboarding/extract",
                json={"restaurant_id": "rest-e2e-fail-001", "images": ["base64data"]},
            )

        assert resp.status_code == 503, resp.text
        detail = resp.json().get("detail", "")
        assert "All pages failed" in detail, f"Expected informative error, got: {detail}"
        # No raw Python stack trace in the response body
        assert "Traceback" not in detail
        assert "File " not in detail

    def test_quality_review_queue_returns_503_when_supabase_down(self, test_client):
        """
        Supabase unavailable → GET /quality/review-queue → 503 "Database not available".
        The quality endpoint must never return a raw 500 when the DB client is None.
        """
        with patch("api.quality_routes._get_supabase", return_value=None):
            resp = test_client.get("/api/v1/quality/review-queue")

        assert resp.status_code == 503, resp.text
        assert "Database" in resp.json().get("detail", ""), resp.text

    def test_studio_override_returns_503_when_supabase_down(self, test_client):
        """
        Supabase unavailable → POST /studio/overrides → 503 "Database not available".
        JWT auth still passes (role check uses JWT payload, not DB), but submission
        fetch fails gracefully with 503.
        """
        auth = {"Authorization": f"Bearer {_make_jwt(DEVELOPER_PAYLOAD)}"}

        with patch("config.settings.get_settings", return_value=_make_settings()), \
             patch("api.studio_routes._get_supabase", return_value=None):

            resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "submission_id": "sub-e2e-no-db",
                    "field_name": "wine_name",
                    "new_value": "New Name",
                },
                headers=auth,
            )

        assert resp.status_code == 503, resp.text
        assert "Database" in resp.json().get("detail", ""), resp.text

    def test_research_metrics_handles_partial_table_failures(self, test_client):
        """
        research_run_stats query raises Exception, other tables return empty.
        GET /research/metrics → 200 (graceful degradation — stats_rows defaults to []).
        All computed metric values must be 0/0.0, not a 500 error.
        """
        # research_run_stats: fails — simulates a missing or empty table
        stats_mock = MagicMock()
        stats_mock.select.return_value.order.return_value.limit.return_value.execute.side_effect = (
            Exception("research_run_stats: relation does not exist")
        )

        # Other tables return empty results — metrics gracefully default to 0
        citations_mock = MagicMock()
        citations_mock.select.return_value.limit.return_value.execute.return_value.data = []

        runs_mock = MagicMock()
        runs_mock.select.return_value.limit.return_value.execute.return_value.data = []

        corrections_mock = MagicMock()
        corrections_mock.select.return_value.not_.is_.return_value.limit.return_value.execute.return_value.data = []

        sb = MagicMock()
        def _table(name: str):
            return {
                "research_run_stats": stats_mock,
                "evidence_citations": citations_mock,
                "research_runs": runs_mock,
                "field_corrections": corrections_mock,
            }.get(name, MagicMock())
        sb.table.side_effect = _table

        with patch("api.research_routes._get_supabase", return_value=sb):
            resp = test_client.get("/api/v1/research/metrics")

        assert resp.status_code == 200, resp.text
        body = resp.json()

        # All numeric aggregates should be 0 when tables are empty
        gap = body.get("gap_closure", {})
        assert gap.get("null_rate_before", -1) == 0.0
        quality = body.get("quality", {})
        assert quality.get("promotion_rate", -1) == 0.0
        safety = body.get("safety", {})
        assert safety.get("pii_policy_flags", -1) == 0

    def test_analytics_unavailable_returns_503(self, test_client):
        """
        Supabase unavailable → GET /analytics/wine/{uuid}/scores → 503 "Database unavailable".
        Verifies analytics degrades gracefully when the DB client cannot be created.
        """
        valid_wine_id = str(uuid.uuid4())

        with patch("api.analytics_routes._get_supabase", return_value=None):
            resp = test_client.get(f"/api/v1/analytics/wine/{valid_wine_id}/scores")

        assert resp.status_code == 503, resp.text
        assert "unavailable" in resp.json().get("detail", "").lower(), resp.text

    def test_health_always_returns_200(self, test_client):
        """
        GET /health returns 200 regardless of Supabase state.
        The health endpoint must never require a DB connection to respond.
        """
        # No mocking — test with real app state
        resp = test_client.get("/health")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body.get("status") == "ok"

    def test_studio_me_roles_returns_empty_on_error(self, test_client):
        """
        GET /studio/me/roles with invalid/expired JWT → 200 with empty roles.
        This endpoint is designed to never raise — graceful degradation prevents
        AuthContext from breaking the frontend on bad tokens.
        """
        # Token signed with wrong secret → JWT decode fails → empty roles returned
        bad_jwt = _make_jwt(DEVELOPER_PAYLOAD, secret=WRONG_SECRET)
        auth = {"Authorization": f"Bearer {bad_jwt}"}

        with patch("config.settings.get_settings", return_value=_make_settings(jwt_secret=E2E_SECRET)):
            resp = test_client.get("/api/v1/studio/me/roles", headers=auth)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body.get("roles") == [], f"Expected empty roles, got: {body}"
        assert "promotion_policy" in body

    def test_extraction_cap_check_fails_open(self, test_client):
        """
        api_spend query raises Exception inside _preflight_cap_check.
        _preflight_cap_check catches it and returns 0.0 (fail-open per design).
        Extraction proceeds — never blocked by cap check infrastructure failure.
        """
        # Build supabase where api_spend query raises (simulates DB error for that table)
        api_spend_mock = MagicMock()
        api_spend_mock.select.return_value.eq.return_value.execute.side_effect = Exception(
            "api_spend: connection reset"
        )

        submissions_mock = MagicMock()
        submissions_mock.insert.return_value.execute.return_value.data = [{"id": "sub-cap-fail-001"}]

        review_queue_mock = MagicMock()
        review_queue_mock.insert.return_value.execute.return_value.data = [{}]

        sb = MagicMock()
        def _table(name: str):
            return {
                "api_spend": api_spend_mock,
                "master_wine_library_submissions": submissions_mock,
                "field_review_queue": review_queue_mock,
            }.get(name, MagicMock())
        sb.table.side_effect = _table

        # Extractor returns a valid result — extraction should succeed
        result = _make_extraction_result_mock()
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=result)

        mock_haiku = MagicMock()
        mock_haiku.delay = MagicMock()

        with patch(_SUPABASE_PATCH, return_value=sb), \
             patch(_EXTRACTOR_PATCH, return_value=mock_extractor), \
             patch(_HAIKU_PATCH, mock_haiku):

            resp = test_client.post(
                "/api/v1/onboarding/extract",
                json={"restaurant_id": "rest-cap-fail-001", "images": ["base64data"]},
            )

        # Extraction must succeed despite api_spend query failure (fail-open)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        # Submission was inserted (extraction ran)
        assert submissions_mock.insert.called, "Extraction did not run — cap check was not fail-open"
