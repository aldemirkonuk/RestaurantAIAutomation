"""
E2E tests: Quality review pipeline, Research API, and Analytics API.

Phase 14 Plan 02 — Task 2.
Covers:
  - Quality: review-queue GET grouped by wine, PATCH correction → promotion,
             no-promote when fields remain, calibration endpoint
  - Research: metrics with empty/populated tables, trigger admin-key auth,
              trigger concurrent-run block (429)
  - Analytics: wine scores with critic data, invalid UUID → 422, trends,
               wine timeline lifecycle

All tests are mock-only (no live Supabase/Anthropic calls). Marked @pytest.mark.e2e.
Threat T-14-04: ADMIN_API_KEY set via os.environ in test, cleared in teardown.
"""

import os
import uuid
import pytest
from unittest.mock import MagicMock, patch

pytestmark = pytest.mark.e2e

# Stable UUIDs for assertions
WINE_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
SUBMISSION_UUID_A = "b2c3d4e5-f6a7-8901-bcde-f12345678901"
SUBMISSION_UUID_B = "c3d4e5f6-a7b8-9012-cdef-123456789012"
REVIEW_ID_1 = "d4e5f6a7-b8c9-0123-defa-234567890123"
REVIEW_ID_2 = "e5f6a7b8-c9d0-1234-efab-345678901234"
REVIEW_ID_3 = "f6a7b8c9-d0e1-2345-fabc-456789012345"

ADMIN_API_KEY_TEST = "test-admin-key-e2e-14-02"


def _build_supabase(table_map: dict) -> MagicMock:
    sb = MagicMock()

    def _table(name: str) -> MagicMock:
        return table_map.get(name, MagicMock())

    sb.table.side_effect = _table
    return sb


# ===========================================================================
# Quality Pipeline Tests
# ===========================================================================


class TestQualityPipeline:

    def test_review_queue_returns_pending_fields_grouped_by_wine(self, test_client):
        """GET /quality/review-queue groups 3 pending rows into 2 grouped submission items."""
        queue_rows = [
            {
                "id": REVIEW_ID_1,
                "submission_id": SUBMISSION_UUID_A,
                "field_name": "region",
                "current_value": "Unknown",
                "confidence": 0.60,
                "source": "inferred",
                "status": "pending",
                "created_at": "2026-01-01",
            },
            {
                "id": REVIEW_ID_2,
                "submission_id": SUBMISSION_UUID_A,
                "field_name": "vintage",
                "current_value": "2018",
                "confidence": 0.65,
                "source": "inferred",
                "status": "pending",
                "created_at": "2026-01-01",
            },
            {
                "id": REVIEW_ID_3,
                "submission_id": SUBMISSION_UUID_B,
                "field_name": "producer",
                "current_value": "Unknown Producer",
                "confidence": 0.55,
                "source": "inferred",
                "status": "pending",
                "created_at": "2026-01-01",
            },
        ]
        sub_rows = [
            {
                "id": SUBMISSION_UUID_A,
                "payload": {"wine_name": "Barolo 2019"},
                "field_confidence": {},
                "auto_blocked": False,
                "restaurant_id": "rest-001",
                "status": "pending_review",
            },
            {
                "id": SUBMISSION_UUID_B,
                "payload": {"wine_name": "Chianti 2020"},
                "field_confidence": {},
                "auto_blocked": False,
                "restaurant_id": "rest-001",
                "status": "pending_review",
            },
        ]

        frq_mock = MagicMock()
        frq_mock.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value.data = (
            queue_rows
        )

        sub_mock = MagicMock()
        sub_mock.select.return_value.in_.return_value.execute.return_value.data = (
            sub_rows
        )

        sb = _build_supabase(
            {
                "field_review_queue": frq_mock,
                "master_wine_library_submissions": sub_mock,
            }
        )

        with patch("api.quality_routes._get_supabase", return_value=sb):
            resp = test_client.get("/api/v1/quality/review-queue")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 2, f"Expected 2 grouped items, got {body['total']}"

        item_a = next(
            (i for i in body["items"] if i["submission_id"] == SUBMISSION_UUID_A), None
        )
        assert item_a is not None, "Submission A not in response"
        assert (
            len(item_a["pending_fields"]) == 2
        ), f"Expected 2 pending_fields for submission A, got {len(item_a['pending_fields'])}"

    def test_review_queue_patch_correction_promotes_to_library(self, test_client):
        """PATCH /quality/review-queue/{id} with corrections → 0 pending → promoted_to_library=True."""
        submission_data = {
            "id": SUBMISSION_UUID_A,
            "payload": {"wine_name": "Barolo Riserva"},
            "field_confidence": {
                "wine_name": {
                    "value": "Barolo Riserva",
                    "confidence": 0.95,
                    "source": "visible",
                },
                "region": {
                    "value": "Unknown",
                    "confidence": 0.65,
                    "source": "inferred",
                },
            },
            "status": "pending_review",
            "auto_blocked": False,
            "restaurant_id": "rest-001",
            # JSONB enrichment keys (empty dicts for this test)
            "grape_family": {},
            "wine_structure": {},
            "sensory_profile": {},
            "practical_attributes": {},
            "region_hierarchy": {},
            "critic_scores": {},
            "winemaking_details": {},
        }

        sub_mock = MagicMock()
        sub_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            submission_data
        )
        sub_mock.update.return_value.eq.return_value.execute.return_value.data = [{}]

        frq_mock = MagicMock()
        # 0 remaining pending fields after correction
        frq_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = (
            0
        )

        lib_mock = MagicMock()
        lib_mock.insert.return_value.execute.return_value.data = [
            {"id": str(uuid.uuid4())}
        ]

        corr_mock = MagicMock()
        corr_mock.insert.return_value.execute.return_value.data = [{}]

        sb = _build_supabase(
            {
                "master_wine_library_submissions": sub_mock,
                "field_review_queue": frq_mock,
                "master_wine_library": lib_mock,
                "field_corrections": corr_mock,
            }
        )

        with patch("api.quality_routes._get_supabase", return_value=sb), patch(
            "api.quality_routes.should_auto_block", return_value=False
        ):

            resp = test_client.patch(
                f"/api/v1/quality/review-queue/{SUBMISSION_UUID_A}",
                json={
                    "corrections": {"region": "Piedmont"},
                    "corrected_by": "reviewer@test.com",
                },
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["promoted_to_library"] is True
        assert body["status"] == "approved"
        assert body["corrections_applied"] == 1

    def test_review_queue_patch_does_not_promote_when_fields_remain(self, test_client):
        """PATCH with 1 pending field remaining → promoted_to_library=False, status='pending_review'."""
        submission_data = {
            "id": SUBMISSION_UUID_B,
            "payload": {},
            "field_confidence": {
                "region": {
                    "value": "Unknown",
                    "confidence": 0.60,
                    "source": "inferred",
                },
                "vintage": {"value": None, "confidence": 0.55, "source": "inferred"},
            },
            "status": "pending_review",
            "auto_blocked": False,
            "restaurant_id": "rest-001",
            "grape_family": {},
            "wine_structure": {},
            "sensory_profile": {},
            "practical_attributes": {},
            "region_hierarchy": {},
            "critic_scores": {},
            "winemaking_details": {},
        }

        sub_mock = MagicMock()
        sub_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            submission_data
        )
        sub_mock.update.return_value.eq.return_value.execute.return_value.data = [{}]

        frq_mock = MagicMock()
        # 1 remaining pending field → do NOT promote
        frq_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = (
            1
        )

        sb = _build_supabase(
            {
                "master_wine_library_submissions": sub_mock,
                "field_review_queue": frq_mock,
            }
        )

        with patch("api.quality_routes._get_supabase", return_value=sb), patch(
            "api.quality_routes.should_auto_block", return_value=False
        ):

            resp = test_client.patch(
                f"/api/v1/quality/review-queue/{SUBMISSION_UUID_B}",
                json={
                    "corrections": {"region": "Tuscany"},
                    "corrected_by": "reviewer@test.com",
                },
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["promoted_to_library"] is False
        assert body["status"] == "pending_review"

    def test_calibration_endpoint_returns_thresholds(self, test_client):
        """GET /quality/calibration returns thresholds list and calibration_stats list."""
        thresholds = [
            {
                "field_name": "wine_name",
                "review_threshold": 0.50,
                "accept_threshold": 0.80,
                "last_calibrated_at": "2026-01-01",
            },
            {
                "field_name": "region",
                "review_threshold": 0.55,
                "accept_threshold": 0.80,
                "last_calibrated_at": "2026-01-01",
            },
        ]
        cal_stats = [
            {
                "field_name": "wine_name",
                "confidence_bin": "0.8-0.9",
                "total_reviewed": 50,
                "total_correct": 45,
                "actual_accuracy": 0.90,
                "measured_at": "2026-01-01",
            },
        ]

        thresh_mock = MagicMock()
        thresh_mock.select.return_value.order.return_value.execute.return_value.data = (
            thresholds
        )

        cal_mock = MagicMock()
        cal_mock.select.return_value.order.return_value.execute.return_value.data = (
            cal_stats
        )

        sb = _build_supabase(
            {
                "confidence_thresholds": thresh_mock,
                "field_calibration": cal_mock,
            }
        )

        with patch("api.quality_routes._get_supabase", return_value=sb):
            resp = test_client.get("/api/v1/quality/calibration")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "thresholds" in body
        assert "calibration_stats" in body
        assert len(body["thresholds"]) == 2
        assert body["fields_with_calibration_data"] == 1
        assert body["total_calibration_rows"] == 1


# ===========================================================================
# Research API Tests
# ===========================================================================


class TestResearchAPI:

    def test_research_metrics_handles_empty_tables(self, test_client):
        """GET /research/metrics with all empty tables → all metric values are 0 / 0.0."""
        stats_mock = MagicMock()
        stats_mock.select.return_value.order.return_value.limit.return_value.execute.return_value.data = (
            []
        )

        cit_mock = MagicMock()
        cit_mock.select.return_value.limit.return_value.execute.return_value.data = []

        runs_mock = MagicMock()
        runs_mock.select.return_value.limit.return_value.execute.return_value.data = []

        corr_mock = MagicMock()
        corr_mock.select.return_value.not_.is_.return_value.limit.return_value.execute.return_value.data = (
            []
        )

        sb = _build_supabase(
            {
                "research_run_stats": stats_mock,
                "evidence_citations": cit_mock,
                "research_runs": runs_mock,
                "field_corrections": corr_mock,
            }
        )

        with patch("api.research_routes._get_supabase", return_value=sb):
            resp = test_client.get("/api/v1/research/metrics")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["gap_closure"]["null_rate_before"] == 0.0
        assert body["gap_closure"]["null_rate_after"] == 0.0
        assert body["gap_closure"]["fields_filled_p50"] == 0.0
        assert body["quality"]["promotion_rate"] == 0.0
        assert body["evidence_hygiene"]["citation_completeness"] == 0.0
        assert body["throughput_cost"]["records_processed_per_day"] == 0.0
        assert body["safety"]["pii_policy_flags"] == 0
        assert body["safety"]["regression_rate"] == 0.0

    def test_research_metrics_computes_from_data(self, test_client):
        """GET /research/metrics with populated tables → promotion_rate=0.7, tier_mix A=50% B=50%."""
        stat_rows = [
            {
                "fields_targeted": 10,
                "fields_filled": 7,
                "fields_conflicted": 1,
                "null_rate_before": 0.80,
                "null_rate_after": 0.10,
                "time_to_fill_hours": 2.0,
                "attempts": 12,
                "cost_usd": 0.05,
                "regression_blocked_count": 0,
            },
            {
                "fields_targeted": 10,
                "fields_filled": 7,
                "fields_conflicted": 0,
                "null_rate_before": 0.70,
                "null_rate_after": 0.05,
                "time_to_fill_hours": 1.5,
                "attempts": 11,
                "cost_usd": 0.04,
                "regression_blocked_count": 0,
            },
        ]
        cit_rows = [
            {"source_tier": "A", "fetch_verified": True, "corroboration_count": 2},
            {"source_tier": "A", "fetch_verified": True, "corroboration_count": 2},
            {"source_tier": "B", "fetch_verified": False, "corroboration_count": 1},
            {"source_tier": "B", "fetch_verified": True, "corroboration_count": 1},
        ]

        stats_mock = MagicMock()
        stats_mock.select.return_value.order.return_value.limit.return_value.execute.return_value.data = (
            stat_rows
        )

        cit_mock = MagicMock()
        cit_mock.select.return_value.limit.return_value.execute.return_value.data = (
            cit_rows
        )

        runs_mock = MagicMock()
        runs_mock.select.return_value.limit.return_value.execute.return_value.data = []

        corr_mock = MagicMock()
        corr_mock.select.return_value.not_.is_.return_value.limit.return_value.execute.return_value.data = (
            []
        )

        sb = _build_supabase(
            {
                "research_run_stats": stats_mock,
                "evidence_citations": cit_mock,
                "research_runs": runs_mock,
                "field_corrections": corr_mock,
            }
        )

        with patch("api.research_routes._get_supabase", return_value=sb):
            resp = test_client.get("/api/v1/research/metrics")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        # 14 filled / 20 targeted = 0.7
        assert (
            body["quality"]["promotion_rate"] == 0.7
        ), f"Expected promotion_rate=0.7, got {body['quality']['promotion_rate']}"
        # 2 tier-A + 2 tier-B out of 4 = 50% / 50%
        tier_mix = body["quality"]["source_tier_mix"]
        assert tier_mix["A"] == 50.0
        assert tier_mix["B"] == 50.0
        assert tier_mix["C"] == 0.0

    def test_research_trigger_requires_admin_key(self, test_client):
        """POST /research/trigger: missing key → 401, wrong key → 401, correct key → 200."""
        # No X-Admin-Key header → 401
        r1 = test_client.post("/api/v1/research/trigger", json={"batch_size": 1})
        assert r1.status_code == 401, r1.text

        # Wrong key → 401
        r2 = test_client.post(
            "/api/v1/research/trigger",
            json={"batch_size": 1},
            headers={"X-Admin-Key": "definitely-wrong-key"},
        )
        assert r2.status_code == 401, r2.text

        # Correct key with mock DB and Celery task → 200
        runs_mock = MagicMock()
        runs_mock.select.return_value.eq.return_value.execute.return_value.count = (
            0  # no running
        )

        subs_mock = MagicMock()
        subs_mock.select.return_value.is_.return_value.limit.return_value.execute.return_value.data = [
            {"id": SUBMISSION_UUID_A}
        ]

        sb = _build_supabase(
            {
                "research_runs": runs_mock,
                "master_wine_library_submissions": subs_mock,
            }
        )

        task_mock = MagicMock()
        task_mock.delay = MagicMock()

        old_key = os.environ.get("ADMIN_API_KEY")
        try:
            os.environ["ADMIN_API_KEY"] = ADMIN_API_KEY_TEST
            with patch("api.research_routes._get_supabase", return_value=sb), patch(
                "jobs.research_tasks.research_agent_task", task_mock
            ):
                r3 = test_client.post(
                    "/api/v1/research/trigger",
                    json={"batch_size": 1},
                    headers={"X-Admin-Key": ADMIN_API_KEY_TEST},
                )
        finally:
            if old_key is None:
                os.environ.pop("ADMIN_API_KEY", None)
            else:
                os.environ["ADMIN_API_KEY"] = old_key

        assert r3.status_code == 200, r3.text
        assert r3.json()["queued"] >= 1

    def test_research_trigger_blocks_concurrent_runs(self, test_client):
        """POST /research/trigger with an in-progress run → 429 (T-12-11)."""
        runs_mock = MagicMock()
        # 1 run currently in status='running'
        runs_mock.select.return_value.eq.return_value.execute.return_value.count = 1

        sb = _build_supabase({"research_runs": runs_mock})

        old_key = os.environ.get("ADMIN_API_KEY")
        try:
            os.environ["ADMIN_API_KEY"] = ADMIN_API_KEY_TEST
            with patch("api.research_routes._get_supabase", return_value=sb):
                resp = test_client.post(
                    "/api/v1/research/trigger",
                    json={"batch_size": 5},
                    headers={"X-Admin-Key": ADMIN_API_KEY_TEST},
                )
        finally:
            if old_key is None:
                os.environ.pop("ADMIN_API_KEY", None)
            else:
                os.environ["ADMIN_API_KEY"] = old_key

        assert resp.status_code == 429, resp.text
        assert "in progress" in resp.json()["detail"].lower()


# ===========================================================================
# Analytics API Tests
# ===========================================================================


class TestAnalyticsAPI:

    def test_wine_scores_returns_critic_data(self, test_client):
        """GET /analytics/wine/{uuid}/scores returns critic_scores and per_restaurant_markup."""
        critic_scores = {
            "robert_parker": 95,
            "wine_spectator": 93,
            "jancis_robinson": 18,
        }
        wine_data = {
            "id": WINE_UUID,
            "name": "Opus One 2019",
            "critic_scores": critic_scores,
            "retail_price_avg": 350.0,
            "scores_last_updated_at": "2026-01-01T00:00:00Z",
        }
        inventory_rows = [
            {
                "restaurant_id": "rest-001",
                "markup_ratio": 2.5,
                "markup_classification": "luxury",
            },
        ]

        lib_mock = MagicMock()
        lib_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            wine_data
        )

        inv_mock = MagicMock()
        inv_mock.select.return_value.eq.return_value.execute.return_value.data = (
            inventory_rows
        )

        sb = _build_supabase(
            {
                "master_wine_library": lib_mock,
                "restaurant_inventory": inv_mock,
            }
        )

        with patch("api.analytics_routes._get_supabase", return_value=sb):
            resp = test_client.get(f"/api/v1/analytics/wine/{WINE_UUID}/scores")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["wine_id"] == WINE_UUID
        assert body["wine_name"] == "Opus One 2019"
        assert body["critic_scores"] == critic_scores
        assert body["retail_price_avg"] == 350.0
        assert len(body["per_restaurant_markup"]) == 1
        assert body["per_restaurant_markup"][0]["markup_ratio"] == 2.5
        assert body["per_restaurant_markup"][0]["markup_classification"] == "luxury"

    def test_wine_scores_invalid_uuid_returns_422(self, test_client):
        """GET /analytics/wine/not-a-uuid/scores → 422 (UUID validation guard)."""
        resp = test_client.get("/api/v1/analytics/wine/not-a-uuid/scores")
        assert resp.status_code == 422, resp.text
        assert "uuid" in resp.json()["detail"].lower()

    def test_trends_returns_trending_wines(self, test_client):
        """GET /analytics/trends?period=90d returns trending_up and trending_down lists."""
        wine_uuid_2 = str(uuid.uuid4())
        tw_rows = [
            {
                "wine_id": WINE_UUID,
                "trend_score": 0.92,
                "delta": 5,
                "restaurant_count_end": 12,
                "burst_detected_at": None,
            },
            {
                "wine_id": wine_uuid_2,
                "trend_score": 0.30,
                "delta": -3,
                "restaurant_count_end": 4,
                "burst_detected_at": None,
            },
        ]
        wine_meta_rows = [
            {
                "id": WINE_UUID,
                "name": "Opus One 2019",
                "primary_type": "Red",
                "grape_variety": "Cabernet Sauvignon",
                "region": "Napa Valley",
            },
            {
                "id": wine_uuid_2,
                "name": "Pouilly-Fumé 2021",
                "primary_type": "White",
                "grape_variety": "Sauvignon Blanc",
                "region": "Loire Valley",
            },
        ]

        tw_mock = MagicMock()
        tw_mock.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = (
            tw_rows
        )

        lib_mock = MagicMock()
        lib_mock.select.return_value.in_.return_value.execute.return_value.data = (
            wine_meta_rows
        )

        sb = _build_supabase(
            {
                "trending_wines": tw_mock,
                "master_wine_library": lib_mock,
            }
        )

        with patch("api.analytics_routes._get_supabase", return_value=sb):
            resp = test_client.get("/api/v1/analytics/trends?period=90d")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["period"] == "90d"
        assert len(body["trending_up"]) >= 1, "Expected at least 1 trending up wine"
        assert len(body["trending_down"]) >= 1, "Expected at least 1 trending down wine"
        trending_up_ids = [item["wine_id"] for item in body["trending_up"]]
        assert WINE_UUID in trending_up_ids

    def test_wine_timeline_returns_lifecycle(self, test_client):
        """GET /analytics/wine/{uuid}/timeline returns lifecycle: first_seen_at, restaurants_carrying, price_history."""
        sig_hash = "abc123hash-e2e"
        roster_rows = [
            {
                "restaurant_id": "rest-001",
                "first_seen_at": "2024-01-15",
                "last_seen_at": "2026-01-01",
                "price_reference": "85",
            },
            {
                "restaurant_id": "rest-002",
                "first_seen_at": "2024-06-01",
                "last_seen_at": "2025-12-15",
                "price_reference": "90",
            },
        ]
        changes_rows = [
            {
                "restaurant_id": "rest-001",
                "change_type": "added",
                "old_value": None,
                "new_value": "85",
                "detected_at": "2024-01-15",
            },
        ]

        lib_mock = MagicMock()
        lib_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WINE_UUID,
            "name": "Barolo Riserva 2016",
        }

        subs_mock = MagicMock()
        subs_mock.select.return_value.eq.return_value.execute.return_value.data = [
            {"signature_hash": sig_hash}
        ]

        pop_mock = MagicMock()
        pop_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "restaurant_count": 5
        }

        roster_mock = MagicMock()
        roster_mock.select.return_value.in_.return_value.execute.return_value.data = (
            roster_rows
        )

        changes_mock = MagicMock()
        changes_mock.select.return_value.in_.return_value.order.return_value.limit.return_value.execute.return_value.data = (
            changes_rows
        )

        sb = _build_supabase(
            {
                "master_wine_library": lib_mock,
                "master_wine_library_submissions": subs_mock,
                "wine_popularity": pop_mock,
                "restaurant_wine_roster": roster_mock,
                "menu_changes": changes_mock,
            }
        )

        with patch("api.analytics_routes._get_supabase", return_value=sb):
            resp = test_client.get(f"/api/v1/analytics/wine/{WINE_UUID}/timeline")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["wine_id"] == WINE_UUID
        assert body["wine_name"] == "Barolo Riserva 2016"
        assert body["restaurants_currently_carrying"] == 5
        assert (
            body["first_seen_at"] is not None
        ), "first_seen_at should be populated from roster"
        assert (
            len(body["price_history"]) == 2
        ), f"Expected 2 price_history entries, got {len(body['price_history'])}"
