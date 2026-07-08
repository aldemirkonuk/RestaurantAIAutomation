"""
E2E: Studio→Library Promotion Path Tests (Phase 14 Plan 04 — Task 1).

Covers the architectural gap fix: studio overrides now trigger _maybe_promote_submission,
which promotes the wine to master_wine_library when all three gates are clear:
  1. Submission status == "pending_review"
  2. No remaining pending fields in field_review_queue
  3. should_auto_block(fc) returns False

All tests are mock-only (no live Supabase). JWT secret is "e2e-secret".
"""

import pytest
from unittest.mock import MagicMock, patch

pytestmark = pytest.mark.e2e

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
E2E_SECRET = "e2e-secret"

DEVELOPER_PAYLOAD = {
    "sub": "dev-e2e-001",
    "email": "developer@e2e-test.com",
    "app_metadata": {"roles": ["developer"]},
}
ADMIN_PAYLOAD = {
    "sub": "admin-e2e-001",
    "email": "admin@e2e-test.com",
    "app_metadata": {"roles": ["review_admin"]},
}

SESSION_ID = "sess-e2e-promo-001"
SUBMISSION_ID = "sub-e2e-promo-001"
OVERRIDE_ID = "ov-e2e-promo-001"


def _make_jwt(payload: dict) -> str:
    import jwt as pyjwt

    return pyjwt.encode(payload, E2E_SECRET, algorithm="HS256")


def _make_settings():
    return type(
        "S",
        (),
        {
            "supabase_jwt_secret": E2E_SECRET,
            "trust_level_threshold": 5,
        },
    )()


def _build_supabase(table_map: dict) -> MagicMock:
    sb = MagicMock()

    def _table(name: str) -> MagicMock:
        return table_map.get(name, MagicMock())

    sb.table.side_effect = _table
    return sb


def _make_full_submission(fc: dict, status: str = "pending_review") -> dict:
    """Build a submission dict with all fields needed by both submit_override and _maybe_promote_submission."""
    return {
        "id": SUBMISSION_ID,
        "status": status,
        "field_confidence": fc,
        "payload": {
            "wine_name": (
                fc.get("wine_name", {}).get("value")
                if isinstance(fc.get("wine_name"), dict)
                else None
            )
        },
        "auto_blocked": False,
        "restaurant_id": "rest-e2e-001",
    }


def _high_confidence_fc() -> dict:
    """Field confidence where most fields are high-confidence (should_auto_block → False)."""
    return {
        "wine_name": {
            "value": "Barolo Riserva",
            "confidence": 0.92,
            "source": "visible",
        },
        "producer": {
            "value": "Giacomo Conterno",
            "confidence": 0.90,
            "source": "visible",
        },
        "vintage": {"value": "2019", "confidence": 0.88, "source": "visible"},
        "region": {"value": "Piedmont", "confidence": 0.85, "source": "visible"},
        # Low-confidence target field — no reason required when overriding (< 0.8)
        "grape_variety": {
            "value": "Nebbiolo",
            "confidence": 0.40,
            "source": "inferred",
        },
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestPromotionPath:

    def test_auto_promoted_override_triggers_library_promotion(self, test_client):
        """
        Developer auto-promoted override + all gates clear → master_wine_library.insert called.

        Gate verification:
          - status="pending_review" ✓
          - field_review_queue count=0 (no pending) ✓
          - should_auto_block(fc) → False (4/5 fields have confidence >= 0.5) ✓
        """
        fc = _high_confidence_fc()
        sub_data = _make_full_submission(fc)

        submissions_mock = MagicMock()
        submissions_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            sub_data
        )

        events_mock = MagicMock()
        events_mock.insert.return_value.execute.return_value.data = [
            {"id": OVERRIDE_ID, "promotion_status": "auto_promoted"}
        ]

        # Gate 2: no pending fields
        queue_mock = MagicMock()
        queue_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = (
            0
        )

        library_mock = MagicMock()

        sb = _build_supabase(
            {
                "master_wine_library_submissions": submissions_mock,
                "override_events": events_mock,
                "field_review_queue": queue_mock,
                "master_wine_library": library_mock,
            }
        )
        auth = {"Authorization": f"Bearer {_make_jwt(DEVELOPER_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ):

            resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "session_id": SESSION_ID,
                    "submission_id": SUBMISSION_ID,
                    "field_name": "grape_variety",
                    "new_value": "Barbera",
                    # No reason required — grape_variety confidence 0.40 < 0.8
                },
                headers=auth,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "auto_promoted"
        # Promotion triggered: master_wine_library.insert must have been called once
        library_mock.insert.assert_called_once()
        # Submission status updated to "approved"
        submissions_mock.update.assert_called()

    def test_promotion_skipped_when_fields_still_pending(self, test_client):
        """
        Auto-promoted override submitted but field_review_queue has 2 pending fields.
        Library insert must NOT be called — promotion gate 2 blocks it.
        """
        fc = _high_confidence_fc()
        sub_data = _make_full_submission(fc)

        submissions_mock = MagicMock()
        submissions_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            sub_data
        )

        events_mock = MagicMock()
        events_mock.insert.return_value.execute.return_value.data = [
            {"id": OVERRIDE_ID, "promotion_status": "auto_promoted"}
        ]

        # Gate 2 fails: 2 pending fields remain
        queue_mock = MagicMock()
        queue_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = (
            2
        )

        library_mock = MagicMock()

        sb = _build_supabase(
            {
                "master_wine_library_submissions": submissions_mock,
                "override_events": events_mock,
                "field_review_queue": queue_mock,
                "master_wine_library": library_mock,
            }
        )
        auth = {"Authorization": f"Bearer {_make_jwt(DEVELOPER_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ):

            resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "session_id": SESSION_ID,
                    "submission_id": SUBMISSION_ID,
                    "field_name": "grape_variety",
                    "new_value": "Barbera",
                },
                headers=auth,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "auto_promoted"
        # Promotion NOT triggered due to pending fields
        library_mock.insert.assert_not_called()

    def test_promotion_skipped_when_auto_blocked(self, test_client):
        """
        Auto-promoted override submitted but field_confidence has > 50% fields below 0.5.
        should_auto_block returns True → promotion gate 3 blocks it.
        Library insert must NOT be called.
        """
        # 3 out of 4 fields have confidence < 0.5 → should_auto_block returns True
        fc = {
            "wine_name": {
                "value": "Blocked Wine",
                "confidence": 0.30,
                "source": "inferred",
            },
            "producer": {"value": None, "confidence": 0.20, "source": "inferred"},
            "vintage": {"value": None, "confidence": 0.15, "source": "inferred"},
            "region": {"value": "Somewhere", "confidence": 0.85, "source": "visible"},
        }
        sub_data = _make_full_submission(fc)

        submissions_mock = MagicMock()
        submissions_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            sub_data
        )

        events_mock = MagicMock()
        events_mock.insert.return_value.execute.return_value.data = [
            {"id": OVERRIDE_ID, "promotion_status": "auto_promoted"}
        ]

        # Gate 2: no pending (but gate 3 will block)
        queue_mock = MagicMock()
        queue_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = (
            0
        )

        library_mock = MagicMock()

        sb = _build_supabase(
            {
                "master_wine_library_submissions": submissions_mock,
                "override_events": events_mock,
                "field_review_queue": queue_mock,
                "master_wine_library": library_mock,
            }
        )
        auth = {"Authorization": f"Bearer {_make_jwt(DEVELOPER_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ):

            resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "session_id": SESSION_ID,
                    "submission_id": SUBMISSION_ID,
                    "field_name": "wine_name",
                    "new_value": "Corrected Blocked Wine",
                    # No reason needed — wine_name confidence 0.30 < 0.8
                },
                headers=auth,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "auto_promoted"
        # Promotion blocked by should_auto_block
        library_mock.insert.assert_not_called()

    def test_admin_approve_triggers_library_promotion(self, test_client):
        """
        review_admin approves a pending override → decide_override calls _maybe_promote_submission
        → all gates clear → master_wine_library.insert called.
        """
        pending_ov = {
            "id": OVERRIDE_ID,
            "promotion_status": "pending",
            "submission_id": SUBMISSION_ID,
            "field_name": "grape_variety",
            "new_value": "Barbera",
            "actor_id": "cc-e2e-001",
        }

        fc = _high_confidence_fc()
        sub_data = _make_full_submission(fc)

        events_mock = MagicMock()
        events_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            pending_ov
        )
        events_mock.update.return_value.eq.return_value.execute.return_value.data = [{}]

        submissions_mock = MagicMock()
        submissions_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            sub_data
        )

        queue_mock = MagicMock()
        queue_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = (
            0
        )

        library_mock = MagicMock()

        sb = _build_supabase(
            {
                "override_events": events_mock,
                "master_wine_library_submissions": submissions_mock,
                "field_review_queue": queue_mock,
                "master_wine_library": library_mock,
            }
        )
        auth = {"Authorization": f"Bearer {_make_jwt(ADMIN_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ):

            resp = test_client.patch(
                f"/api/v1/studio/queue/{OVERRIDE_ID}",
                json={"decision": "approved", "note": "Verified on producer website"},
                headers=auth,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["decision"] == "approved"
        # Admin approval → _maybe_promote_submission → library insert
        library_mock.insert.assert_called_once()
        # Submission status updated to "approved"
        submissions_mock.update.assert_called()
