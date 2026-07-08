"""
E2E tests: Studio override pipeline and approval queue (Phase 13 DEVUI-10).

Phase 14 Plan 02 — Task 1.
Covers:
  - Developer auto-promote path (D-13)
  - High-confidence reason enforcement (D-07 server-side)
  - Certified contributor → pending queue (D-12)
  - Admin approve / reject pending override
  - Already-decided override → 409
  - Studio metrics KPIs (DEVUI-09)
  - Invite create + redeem flow (DEVUI-07, D-03/D-04)

All tests are mock-only (no live Supabase). JWT secret is "e2e-secret".
Threat T-14-03: test JWTs use "e2e-secret" — test-only, no production impact.
"""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

pytestmark = pytest.mark.e2e

# ---------------------------------------------------------------------------
# JWT constants — test-only (T-14-03)
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
CERTIFIED_CONTRIBUTOR_PAYLOAD = {
    "sub": "cc-e2e-001",
    "email": "contributor@e2e-test.com",
    "app_metadata": {"roles": ["certified_contributor"]},
}

SESSION_ID = "sess-e2e-pipe-001"
SUBMISSION_ID = "sub-e2e-pipe-001"
OVERRIDE_ID = "ov-e2e-pipe-001"


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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestStudioOverridePipeline:

    def test_developer_override_auto_promotes(self, test_client):
        """Developer submits override on high-confidence field with reason → auto_promoted."""
        submissions_mock = MagicMock()
        submissions_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": SUBMISSION_ID,
            "field_confidence": {
                "wine_name": {
                    "value": "Old Name",
                    "confidence": 0.92,
                    "source": "visible",
                },
            },
        }

        events_mock = MagicMock()
        events_mock.insert.return_value.execute.return_value.data = [
            {"id": OVERRIDE_ID, "promotion_status": "auto_promoted"}
        ]

        sb = _build_supabase(
            {
                "master_wine_library_submissions": submissions_mock,
                "override_events": events_mock,
            }
        )
        auth = {"Authorization": f"Bearer {_make_jwt(DEVELOPER_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ), patch(
            "api.studio_routes.check_and_update_trust", return_value=None
        ):

            resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "session_id": SESSION_ID,
                    "submission_id": SUBMISSION_ID,
                    "field_name": "wine_name",
                    "new_value": "Corrected Name",
                    "reason": "Producer confirmed on website",
                },
                headers=auth,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "auto_promoted"
        assert body["override_id"] == OVERRIDE_ID

    def test_developer_override_requires_reason_for_high_confidence(self, test_client):
        """reason required (min 5 chars) when confidence >= 0.8; absent or short → 422."""
        submissions_mock = MagicMock()
        submissions_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": SUBMISSION_ID,
            "field_confidence": {
                "wine_name": {"value": "Old", "confidence": 0.92, "source": "visible"},
            },
        }

        sb = _build_supabase({"master_wine_library_submissions": submissions_mock})
        auth = {"Authorization": f"Bearer {_make_jwt(DEVELOPER_PAYLOAD)}"}
        base_body = {
            "session_id": SESSION_ID,
            "submission_id": SUBMISSION_ID,
            "field_name": "wine_name",
            "new_value": "X",
        }

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ), patch(
            "api.studio_routes.check_and_update_trust", return_value=None
        ):

            # No reason → 422
            r1 = test_client.post(
                "/api/v1/studio/overrides", json=base_body, headers=auth
            )
            assert r1.status_code == 422, r1.text

            # Too-short reason (< 5 chars) → 422
            r2 = test_client.post(
                "/api/v1/studio/overrides",
                json={**base_body, "reason": "ab"},
                headers=auth,
            )
            assert r2.status_code == 422, r2.text

            # Sufficient reason → 200
            r3 = test_client.post(
                "/api/v1/studio/overrides",
                json={**base_body, "reason": "Verified on producer website"},
                headers=auth,
            )
            assert r3.status_code == 200, r3.text
            assert r3.json()["status"] == "auto_promoted"

    def test_contributor_override_lands_in_pending_queue(self, test_client):
        """certified_contributor override → promotion_status = 'pending' (D-12 queue path)."""
        submissions_mock = MagicMock()
        submissions_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": SUBMISSION_ID,
            "field_confidence": {
                "wine_name": {"value": "Old", "confidence": 0.40, "source": "inferred"},
            },
        }

        events_mock = MagicMock()
        events_mock.insert.return_value.execute.return_value.data = [
            {"id": "ov-cc-001", "promotion_status": "pending"}
        ]

        cc_roles = [{"role": "certified_contributor", "promotion_policy": "queue"}]

        sb = _build_supabase(
            {
                "master_wine_library_submissions": submissions_mock,
                "override_events": events_mock,
            }
        )
        auth = {"Authorization": f"Bearer {_make_jwt(CERTIFIED_CONTRIBUTOR_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=cc_roles
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ), patch(
            "api.studio_routes.check_and_update_trust", return_value=None
        ):

            resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "session_id": SESSION_ID,
                    "submission_id": SUBMISSION_ID,
                    "field_name": "wine_name",
                    "new_value": "Better Name",
                },
                headers=auth,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "pending"

    def test_admin_approves_pending_override(self, test_client):
        """review_admin PATCH /queue/{id} with decision='approved' → 200, decision='approved'."""
        pending_ov = {
            "id": OVERRIDE_ID,
            "promotion_status": "pending",
            "submission_id": SUBMISSION_ID,
            "field_name": "wine_name",
            "new_value": "Better Wine",
            "actor_id": "cc-e2e-001",
        }

        events_mock = MagicMock()
        events_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            pending_ov
        )
        events_mock.update.return_value.eq.return_value.execute.return_value.data = [{}]

        sb = _build_supabase({"override_events": events_mock})
        auth = {"Authorization": f"Bearer {_make_jwt(ADMIN_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ), patch(
            "api.studio_routes.check_and_update_trust", return_value=None
        ):

            resp = test_client.patch(
                f"/api/v1/studio/queue/{OVERRIDE_ID}",
                json={"decision": "approved", "note": "Verified correct"},
                headers=auth,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["decision"] == "approved"
        assert body["override_id"] == OVERRIDE_ID

    def test_admin_rejects_pending_override(self, test_client):
        """review_admin PATCH /queue/{id} with decision='rejected' → 200, decision='rejected'."""
        pending_ov = {
            "id": OVERRIDE_ID,
            "promotion_status": "pending",
            "submission_id": SUBMISSION_ID,
            "field_name": "wine_name",
            "new_value": "Bad Name",
            "actor_id": "cc-e2e-001",
        }

        events_mock = MagicMock()
        events_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            pending_ov
        )
        events_mock.update.return_value.eq.return_value.execute.return_value.data = [{}]

        sb = _build_supabase({"override_events": events_mock})
        auth = {"Authorization": f"Bearer {_make_jwt(ADMIN_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ), patch(
            "api.studio_routes.check_and_update_trust", return_value=None
        ):

            resp = test_client.patch(
                f"/api/v1/studio/queue/{OVERRIDE_ID}",
                json={"decision": "rejected", "note": "Incorrect value"},
                headers=auth,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["decision"] == "rejected"

    def test_already_decided_override_returns_409(self, test_client):
        """PATCH on already-approved override → 409 (cannot re-decide)."""
        approved_ov = {"id": OVERRIDE_ID, "promotion_status": "approved"}

        events_mock = MagicMock()
        events_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            approved_ov
        )

        sb = _build_supabase({"override_events": events_mock})
        auth = {"Authorization": f"Bearer {_make_jwt(ADMIN_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ), patch(
            "api.studio_routes._apply_override_to_submission", return_value=None
        ), patch(
            "api.studio_routes.check_and_update_trust", return_value=None
        ):

            resp = test_client.patch(
                f"/api/v1/studio/queue/{OVERRIDE_ID}",
                json={"decision": "approved"},
                headers=auth,
            )

        assert resp.status_code == 409, resp.text

    def test_studio_metrics_returns_kpis(self, test_client):
        """GET /studio/metrics returns all required KPI fields with correct counts."""
        override_rows = [
            {
                "promotion_status": "auto_promoted",
                "created_at": "2026-01-01T10:00:00Z",
                "decided_at": None,
                "actor_id": "dev-e2e-001",
                "field_name": "wine_name",
                "submission_id": "sub-001",
            },
            {
                "promotion_status": "pending",
                "created_at": "2026-01-02T10:00:00Z",
                "decided_at": None,
                "actor_id": "cc-e2e-001",
                "field_name": "region",
                "submission_id": "sub-002",
            },
        ]

        events_mock = MagicMock()
        # Main overrides query: .select(...).limit(10000).execute().data
        events_mock.select.return_value.limit.return_value.execute.return_value.data = (
            override_rows
        )
        # Active contributors (last 30d): .select("actor_id").gte(...).execute().data
        events_mock.select.return_value.gte.return_value.execute.return_value.data = [
            {"actor_id": "dev-e2e-001"}
        ]

        corr_mock = MagicMock()
        # Field corrections: .select(...).not_.is_(...).limit(10000).execute().data
        corr_mock.select.return_value.not_.is_.return_value.limit.return_value.execute.return_value.data = (
            []
        )

        sb = _build_supabase(
            {
                "override_events": events_mock,
                "field_corrections": corr_mock,
            }
        )
        auth = {"Authorization": f"Bearer {_make_jwt(DEVELOPER_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb):

            resp = test_client.get("/api/v1/studio/metrics", headers=auth)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "total_overrides" in body
        assert "pending_queue" in body
        assert "acceptance_rate" in body
        assert "post_override_correction_rate" in body
        assert body["total_overrides"] == 2
        assert body["pending_queue"] == 1
        assert body["auto_promoted"] == 1

    def test_invite_create_and_redeem_flow(self, test_client):
        """Admin creates invite → developer redeems → role_granted='certified_contributor'."""
        token_val = "test-invite-token-e2e-uuid"
        future_expiry = (datetime.now(timezone.utc) + timedelta(days=7)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )

        invite_mock = MagicMock()
        invite_mock.insert.return_value.execute.return_value.data = [
            {
                "token": token_val,
                "role": "certified_contributor",
                "expires_at": future_expiry,
            }
        ]
        invite_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "token": token_val,
            "role": "certified_contributor",
            "expires_at": future_expiry,
            "used_at": None,
            "created_by": "admin-e2e-001",
            "id": "tok-e2e-001",
        }

        user_roles_mock = MagicMock()

        sb = _build_supabase(
            {
                "invite_tokens": invite_mock,
                "user_roles": user_roles_mock,
            }
        )
        admin_auth = {"Authorization": f"Bearer {_make_jwt(ADMIN_PAYLOAD)}"}
        dev_auth = {"Authorization": f"Bearer {_make_jwt(DEVELOPER_PAYLOAD)}"}

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb):

            # Admin creates invite
            create_resp = test_client.post(
                "/api/v1/studio/invite",
                json={
                    "role": "certified_contributor",
                    "target_email": "new@example.com",
                },
                headers=admin_auth,
            )
            assert create_resp.status_code == 200, create_resp.text
            assert create_resp.json()["token"] == token_val

            # Developer redeems invite (developer is in the allowed roles list for /invite/redeem)
            redeem_resp = test_client.post(
                "/api/v1/studio/invite/redeem",
                json={"token": token_val},
                headers=dev_auth,
            )
            assert redeem_resp.status_code == 200, redeem_resp.text
            assert redeem_resp.json()["role_granted"] == "certified_contributor"
