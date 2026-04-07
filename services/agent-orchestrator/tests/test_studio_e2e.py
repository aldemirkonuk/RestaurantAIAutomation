"""
E2E step-through test for the full Studio override flow (Phase 13 DEVUI-10).

Mocks Supabase client at the route layer. Exercises the complete flow:
  1. POST /sessions to start an onboarding session
  2. POST /overrides wine_name (confidence=0.9 → reason required)
  3. POST /overrides vintage (confidence=0.3 → no reason required)
  4. POST /overrides region (NULL → no reason required)
  5. GET /sessions/{session_id} → audit trail has >= 3 override events
  6. GET /queue as review_admin → 0 pending for developer-submitted overrides

Requires: studio_router registered in main.py (Plan 02 Task 2).
"""
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


pytestmark = pytest.mark.e2e

SECRET = "e2e-test-secret"

DEVELOPER_PAYLOAD = {
    "sub": "dev-e2e-001",
    "email": "dev@studio-test.com",
    "app_metadata": {"roles": ["developer"]},
}

ADMIN_PAYLOAD = {
    "sub": "admin-e2e-001",
    "email": "admin@studio-test.com",
    "app_metadata": {"roles": ["review_admin"]},
}

SESSION_ID = "sess-e2e-001"
SUBMISSION_ID = "sub-e2e-001"


def _make_jwt(payload: dict) -> str:
    import jwt as pyjwt
    return pyjwt.encode(payload, SECRET, algorithm="HS256")


def _make_settings():
    return type("S", (), {"supabase_jwt_secret": SECRET, "trust_level_threshold": 5})()


@pytest.fixture()
def mock_supabase_e2e():
    """Per-table Supabase mock for the full E2E flow."""
    sessions_mock = MagicMock()
    sessions_mock.insert.return_value.execute.return_value.data = [
        {"id": SESSION_ID, "actor_id": DEVELOPER_PAYLOAD["sub"], "status": "active"}
    ]
    # GET /sessions/{id}: select(*).eq().single().execute().data = session row
    sessions_mock.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "id": SESSION_ID,
        "actor_id": DEVELOPER_PAYLOAD["sub"],
        "status": "active",
    }

    # field_confidence_map for the submission
    field_confidence_map = {
        "wine_name": {"value": "Old Name", "confidence": 0.9, "source": "visible"},
        "vintage": {"value": "2018", "confidence": 0.3, "source": "inferred"},
        # region not present → old_confidence=None → no reason required
    }
    submissions_mock = MagicMock()
    submissions_mock.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "id": SUBMISSION_ID,
        "field_confidence": field_confidence_map,
    }
    submissions_mock.update.return_value.eq.return_value.execute.return_value.data = [{}]

    # override_events: insert + audit trail
    events_mock = MagicMock()
    events_mock.insert.return_value.execute.return_value.data = [
        {"id": "ov-001", "promotion_status": "auto_promoted"}
    ]
    # GET /sessions/{id} → override_events audit trail (select.eq.order.execute.data)
    events_mock.select.return_value.eq.return_value.order.return_value.execute.return_value.data = [
        {"id": "ov-wine_name", "field_name": "wine_name", "promotion_status": "auto_promoted"},
        {"id": "ov-vintage", "field_name": "vintage", "promotion_status": "auto_promoted"},
        {"id": "ov-region", "field_name": "region", "promotion_status": "auto_promoted"},
    ]
    # GET /queue → 0 pending items (count=0)
    events_mock.select.return_value.eq.return_value.execute.return_value.count = 0
    events_mock.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value.data = []

    user_roles_mock = MagicMock()
    user_roles_mock.select.return_value.eq.return_value.is_.return_value.execute.return_value.data = []

    def _table_side_effect(name: str):
        mapping = {
            "onboarding_sessions": sessions_mock,
            "master_wine_library_submissions": submissions_mock,
            "override_events": events_mock,
            "user_roles": user_roles_mock,
        }
        return mapping.get(name, MagicMock())

    sb = MagicMock()
    sb.table.side_effect = _table_side_effect
    return sb


class TestStudioE2EOverrideFlow:
    def test_full_developer_override_flow(
        self, test_client: TestClient, mock_supabase_e2e
    ):
        """
        Full E2E per DEVUI-10: developer creates session → submits 3 overrides → verifies audit trail.

        Steps:
          1. POST /sessions → sessionId
          2. POST /overrides wine_name (confidence=0.9, reason required)
          3. POST /overrides vintage (confidence=0.3, no reason required)
          4. POST /overrides region (NULL field, no reason required)
          5. GET /sessions/{session_id} → audit trail has >= 3 events
        Developer role → all overrides auto_promoted instantly.
        """
        auth = {"Authorization": f"Bearer {_make_jwt(DEVELOPER_PAYLOAD)}"}

        with patch("config.settings.get_settings", return_value=_make_settings()), \
             patch("api.studio_routes._get_supabase", return_value=mock_supabase_e2e), \
             patch("api.studio_routes._get_user_studio_roles", return_value=[]):

            # Step 1: create session
            sess_resp = test_client.post(
                "/api/v1/studio/sessions",
                json={"source_type": "manual_seed", "source_ref": "e2e-test"},
                headers=auth,
            )
            assert sess_resp.status_code == 200, sess_resp.text

            # Step 2: override wine_name (confidence=0.9 → reason required)
            ov1 = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "session_id": SESSION_ID,
                    "submission_id": SUBMISSION_ID,
                    "field_name": "wine_name",
                    "new_value": "Château Margaux",
                    "reason": "Confirmed on producer website",
                },
                headers=auth,
            )
            assert ov1.status_code == 200, ov1.text

            # Step 3: override vintage (confidence=0.3 → no reason required)
            ov2 = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "session_id": SESSION_ID,
                    "submission_id": SUBMISSION_ID,
                    "field_name": "vintage",
                    "new_value": "2019",
                },
                headers=auth,
            )
            assert ov2.status_code == 200, ov2.text

            # Step 4: override region (NULL confidence → no reason required)
            ov3 = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "session_id": SESSION_ID,
                    "submission_id": SUBMISSION_ID,
                    "field_name": "region",
                    "new_value": "Bordeaux",
                },
                headers=auth,
            )
            assert ov3.status_code == 200, ov3.text

            # Step 5: GET /sessions/{id} → audit trail has >= 3 events
            sess_detail = test_client.get(
                f"/api/v1/studio/sessions/{SESSION_ID}",
                headers=auth,
            )
            assert sess_detail.status_code == 200, sess_detail.text
            body = sess_detail.json()
            event_count = body.get("event_count", 0)
            assert event_count >= 3, f"Expected >= 3 events, got {event_count}"

    def test_review_admin_queue_is_empty_for_developer_overrides(
        self, test_client: TestClient, mock_supabase_e2e
    ):
        """
        GET /queue as review_admin → total=0 when developer submitted (instant promote).
        DEVUI-10: developer instant-promote means nothing enters the pending queue.
        """
        auth = {"Authorization": f"Bearer {_make_jwt(ADMIN_PAYLOAD)}"}

        with patch("config.settings.get_settings", return_value=_make_settings()), \
             patch("api.studio_routes._get_supabase", return_value=mock_supabase_e2e):

            queue_resp = test_client.get("/api/v1/studio/queue", headers=auth)
            assert queue_resp.status_code == 200, queue_resp.text
            body = queue_resp.json()
            assert body["total"] == 0, f"Expected 0 pending, got {body['total']}"


# ---------------------------------------------------------------------------
# SC-10: certified_contributor → pending queue → review_admin approval path
# ---------------------------------------------------------------------------

CERTIFIED_PAYLOAD = {
    "sub": "cc-e2e-001",
    "email": "contributor@studio-test.com",
    "app_metadata": {"roles": ["certified_contributor"]},
}

CC_SESSION_ID = "sess-cc-001"
CC_SUBMISSION_ID = "sub-cc-001"
CC_OVERRIDE_ID = "ov-cc-001"


@pytest.fixture()
def mock_supabase_cc():
    """Per-table Supabase mock for the certified_contributor queue flow."""
    sessions_mock = MagicMock()
    sessions_mock.insert.return_value.execute.return_value.data = [
        {"id": CC_SESSION_ID, "actor_id": CERTIFIED_PAYLOAD["sub"], "status": "active"}
    ]
    sessions_mock.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "id": CC_SESSION_ID,
        "actor_id": CERTIFIED_PAYLOAD["sub"],
        "status": "active",
    }

    submissions_mock = MagicMock()
    submissions_mock.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "id": CC_SUBMISSION_ID,
        "field_confidence": {
            "wine_name": {"value": "Old Wine", "confidence": 0.4, "source": "inferred"}
        },
    }
    submissions_mock.update.return_value.eq.return_value.execute.return_value.data = [{}]

    events_mock = MagicMock()
    # POST /overrides → certified_contributor override lands pending
    events_mock.insert.return_value.execute.return_value.data = [
        {"id": CC_OVERRIDE_ID, "promotion_status": "pending"}
    ]
    # PATCH /queue/{id}: decide_override fetches row via select(*).eq(id).single()
    events_mock.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "id": CC_OVERRIDE_ID,
        "promotion_status": "pending",
        "submission_id": CC_SUBMISSION_ID,
        "field_name": "wine_name",
        "new_value": "Verified Wine Name",
        "actor_id": CERTIFIED_PAYLOAD["sub"],
        "session_id": CC_SESSION_ID,
    }
    events_mock.update.return_value.eq.return_value.execute.return_value.data = [{}]
    # GET /queue pending count (no .single())
    events_mock.select.return_value.eq.return_value.execute.return_value.count = 1

    user_roles_mock = MagicMock()
    user_roles_mock.select.return_value.eq.return_value.is_.return_value.execute.return_value.data = [
        {"role": "certified_contributor", "promotion_policy": "queue", "consecutive_approved_overrides": 0}
    ]

    def _table_side_effect(name: str):
        mapping = {
            "onboarding_sessions": sessions_mock,
            "master_wine_library_submissions": submissions_mock,
            "override_events": events_mock,
            "user_roles": user_roles_mock,
        }
        return mapping.get(name, MagicMock())

    sb = MagicMock()
    sb.table.side_effect = _table_side_effect
    return sb


class TestCertifiedContributorFlow:
    def test_full_certified_contributor_approval_flow(
        self, test_client: TestClient, mock_supabase_cc
    ):
        """
        Full E2E for DEVUI-10 certified_contributor path (SC-10):
          1. certified_contributor creates session
          2. POST /overrides → promotion_status='pending' (goes to queue)
          3. review_admin PATCH /queue/{id} with decision=approved
          4. assert response decision=='approved'
        """
        cc_auth = {"Authorization": f"Bearer {_make_jwt(CERTIFIED_PAYLOAD)}"}
        admin_auth = {"Authorization": f"Bearer {_make_jwt(ADMIN_PAYLOAD)}"}

        cc_roles_row = [
            {"role": "certified_contributor", "promotion_policy": "queue",
             "consecutive_approved_overrides": 0}
        ]

        with patch("config.settings.get_settings", return_value=_make_settings()), \
             patch("api.studio_routes._get_supabase", return_value=mock_supabase_cc), \
             patch("api.studio_routes._get_user_studio_roles", side_effect=lambda _sb, uid: (
                 cc_roles_row if uid == CERTIFIED_PAYLOAD["sub"] else []
             )), \
             patch("api.studio_routes._apply_override_to_submission", return_value=None), \
             patch("api.studio_routes.check_and_update_trust", return_value=None):

            # Step 1: certified_contributor starts session
            sess_resp = test_client.post(
                "/api/v1/studio/sessions",
                json={"source_type": "manual_seed"},
                headers=cc_auth,
            )
            assert sess_resp.status_code == 200, sess_resp.text

            # Step 2: submit override → must land in pending queue
            ov_resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "session_id": CC_SESSION_ID,
                    "submission_id": CC_SUBMISSION_ID,
                    "field_name": "wine_name",
                    "new_value": "Verified Wine Name",
                    # confidence=0.4 → no reason required
                },
                headers=cc_auth,
            )
            assert ov_resp.status_code == 200, ov_resp.text
            ov_body = ov_resp.json()
            assert ov_body["status"] == "pending", (
                f"Expected certified_contributor override to be 'pending', got: {ov_body['status']}"
            )
            override_id = ov_body.get("override_id", CC_OVERRIDE_ID)

            # Step 3: review_admin approves the pending override
            approve_resp = test_client.patch(
                f"/api/v1/studio/queue/{override_id}",
                json={"decision": "approved", "note": "Verified correct"},
                headers=admin_auth,
            )
            assert approve_resp.status_code == 200, approve_resp.text
            approve_body = approve_resp.json()
            assert approve_body["decision"] == "approved", (
                f"Expected decision='approved', got: {approve_body}"
            )
            assert approve_body["override_id"] == override_id
