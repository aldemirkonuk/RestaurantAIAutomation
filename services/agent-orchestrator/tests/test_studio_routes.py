"""Tests for studio API routes (Phase 13 DEVUI-10).

Auth strategy: real JWTs signed with a known secret; config.settings.get_settings
is patched to return that secret so the route's JWT verification succeeds.
Supabase is patched via api.studio_routes._get_supabase (local name in module).
"""
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


SECRET = "studio-test-secret"

DEVELOPER_JWT_PAYLOAD = {
    "sub": "user-dev-001",
    "email": "dev@example.com",
    "app_metadata": {"roles": ["developer"]},
}

CONTRIBUTOR_JWT_PAYLOAD = {
    "sub": "user-contrib-001",
    "email": "contrib@example.com",
    "app_metadata": {"roles": ["certified_contributor"]},
}

REVIEW_ADMIN_JWT_PAYLOAD = {
    "sub": "user-admin-001",
    "email": "admin@example.com",
    "app_metadata": {"roles": ["review_admin"]},
}


def _make_jwt(payload: dict, secret: str = SECRET) -> str:
    import jwt as pyjwt
    return pyjwt.encode(payload, secret, algorithm="HS256")


def _auth(payload: dict) -> dict:
    return {"Authorization": f"Bearer {_make_jwt(payload)}"}


def _make_settings(secret: str = SECRET, trust_threshold: int = 5):
    return type("S", (), {
        "supabase_jwt_secret": secret,
        "trust_level_threshold": trust_threshold,
    })()


def _make_submission_mock(field_confidence: dict):
    """Return a MagicMock supabase client pre-configured for the submit_override route."""
    mock_sb = MagicMock()
    # select().eq().maybe_single().execute().data — used by submit_override and _apply_override_to_submission
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
        "id": "sub-001",
        "field_confidence": field_confidence,
    }
    # insert().execute().data — override_events insert
    mock_sb.table.return_value.insert.return_value.execute.return_value.data = [{"id": "ov-001"}]
    # update().eq().execute().data — _apply_override_to_submission update
    mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [{}]
    return mock_sb


# ─── POST /overrides — D-07 reason enforcement ───────────────────────────────

class TestPostOverrides:
    def test_post_override_low_confidence_no_reason_required(self, test_client: TestClient):
        """confidence < 0.8 → reason NOT required; override accepted."""
        mock_sb = _make_submission_mock(
            field_confidence={"wine_name": {"value": "Old Name", "confidence": 0.5, "source": "visible"}}
        )
        with patch("config.settings.get_settings", return_value=_make_settings()), \
             patch("api.studio_routes._get_supabase", return_value=mock_sb):
            resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "submission_id": "sub-001",
                    "field_name": "wine_name",
                    "new_value": "Château Latour",
                    "session_id": None,
                },
                headers=_auth(DEVELOPER_JWT_PAYLOAD),
            )
        assert resp.status_code == 200, resp.text

    def test_post_override_high_confidence_reason_required_missing_returns_422(
        self, test_client: TestClient
    ):
        """confidence >= 0.8 without reason → 422 Unprocessable Entity."""
        mock_sb = _make_submission_mock(
            field_confidence={"vintage": {"value": "2018", "confidence": 0.85, "source": "visible"}}
        )
        with patch("config.settings.get_settings", return_value=_make_settings()), \
             patch("api.studio_routes._get_supabase", return_value=mock_sb):
            resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "submission_id": "sub-001",
                    "field_name": "vintage",
                    "new_value": "2019",
                    "reason": None,
                    "session_id": None,
                },
                headers=_auth(DEVELOPER_JWT_PAYLOAD),
            )
        assert resp.status_code == 422, resp.text
        assert "reason" in resp.text.lower()

    def test_post_override_high_confidence_with_reason_accepted(
        self, test_client: TestClient
    ):
        """confidence >= 0.8 with reason → 200 OK."""
        mock_sb = _make_submission_mock(
            field_confidence={"vintage": {"value": "2018", "confidence": 0.85, "source": "visible"}}
        )
        with patch("config.settings.get_settings", return_value=_make_settings()), \
             patch("api.studio_routes._get_supabase", return_value=mock_sb):
            resp = test_client.post(
                "/api/v1/studio/overrides",
                json={
                    "submission_id": "sub-001",
                    "field_name": "vintage",
                    "new_value": "2019",
                    "reason": "Verified against producer's official vintage chart.",
                    "session_id": None,
                },
                headers=_auth(DEVELOPER_JWT_PAYLOAD),
            )
        assert resp.status_code == 200, resp.text


# ─── POST /invite — review_admin gating ──────────────────────────────────────

class TestPostInvite:
    def test_invite_by_non_review_admin_returns_403(self, test_client: TestClient):
        """Contributor trying to generate invite → 403 Forbidden."""
        with patch("config.settings.get_settings", return_value=_make_settings()):
            resp = test_client.post(
                "/api/v1/studio/invite",
                json={"role": "certified_contributor", "target_email": "new@example.com"},
                headers=_auth(CONTRIBUTOR_JWT_PAYLOAD),
            )
        assert resp.status_code == 403, resp.text

    def test_invite_by_review_admin_returns_201_with_token(self, test_client: TestClient):
        """review_admin generating invite → 200/201 with token field."""
        mock_sb = MagicMock()
        mock_sb.table.return_value.insert.return_value.execute.return_value.data = [
            {"token": "abc-token-123", "role": "certified_contributor", "expires_at": "2026-04-14T00:00:00Z"}
        ]
        with patch("config.settings.get_settings", return_value=_make_settings()), \
             patch("api.studio_routes._get_supabase", return_value=mock_sb):
            resp = test_client.post(
                "/api/v1/studio/invite",
                json={"role": "certified_contributor", "target_email": "new@example.com"},
                headers=_auth(REVIEW_ADMIN_JWT_PAYLOAD),
            )
        assert resp.status_code in (200, 201), resp.text
        body = resp.json()
        assert "token" in body


# ─── PATCH /queue/{id} — decision endpoint ───────────────────────────────────

class TestPatchQueueDecision:
    def test_approve_decision_accepted(self, test_client: TestClient):
        """review_admin approving an override → 200 with updated status."""
        # Use per-table mocks to avoid collisions between the override_events select
        # and the master_wine_library_submissions select inside _apply_override_to_submission.
        override_table_mock = MagicMock()
        override_table_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "ov-001",
            "promotion_status": "pending",
            "submission_id": "sub-001",
            "field_name": "vintage",
            "new_value": "2019",
            "actor_id": "user-contrib-001",
        }
        override_table_mock.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "ov-001", "promotion_status": "approved"}
        ]

        submission_table_mock = MagicMock()
        submission_table_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "sub-001",
            "field_confidence": {"vintage": {"value": "2018", "confidence": 0.5, "source": "visible"}},
        }
        submission_table_mock.update.return_value.eq.return_value.execute.return_value.data = [{}]

        def _table_side_effect(name):
            if name == "override_events":
                return override_table_mock
            return submission_table_mock

        mock_sb = MagicMock()
        mock_sb.table.side_effect = _table_side_effect

        with patch("config.settings.get_settings", return_value=_make_settings()), \
             patch("api.studio_routes._get_supabase", return_value=mock_sb), \
             patch("api.studio_routes._get_user_studio_roles", return_value=[]):
            resp = test_client.patch(
                "/api/v1/studio/queue/ov-001",
                json={"decision": "approved"},
                headers=_auth(REVIEW_ADMIN_JWT_PAYLOAD),
            )
        assert resp.status_code == 200, resp.text


# ─── require_studio_role — sync dep.dependency pattern ───────────────────────
# require_studio_role returns a plain callable (not Depends).
# Wrap with Depends() in tests to access .dependency, then call directly.
# Never await — _check is a sync def.

class TestRequireStudioRole:
    def test_require_studio_role_invalid_token_raises_401(self):
        """Bearer token that fails JWT verification → 401."""
        from fastapi import Depends, HTTPException
        from api.studio_routes import require_studio_role

        dep = Depends(require_studio_role("developer"))
        inner = dep.dependency  # the sync _check function
        with patch("config.settings.get_settings", return_value=_make_settings()):
            with pytest.raises(HTTPException) as exc:
                inner(authorization="Bearer invalid.token.here")
        assert exc.value.status_code == 401

    def test_require_studio_role_missing_header_raises_401(self):
        """Missing Authorization header → 401."""
        from fastapi import Depends, HTTPException
        from api.studio_routes import require_studio_role

        dep = Depends(require_studio_role("developer"))
        inner = dep.dependency
        with pytest.raises(HTTPException) as exc:
            inner(authorization=None)
        assert exc.value.status_code == 401

    def test_require_studio_role_wrong_role_raises_403(self):
        """Valid JWT but certified_contributor requires review_admin → 403."""
        import jwt as pyjwt
        from fastapi import Depends, HTTPException
        from api.studio_routes import require_studio_role

        payload = {"sub": "u-001", "app_metadata": {"roles": ["certified_contributor"]}}
        token = pyjwt.encode(payload, SECRET, algorithm="HS256")

        dep = Depends(require_studio_role("review_admin"))
        inner = dep.dependency
        with patch("config.settings.get_settings", return_value=_make_settings()):
            with pytest.raises(HTTPException) as exc:
                inner(authorization=f"Bearer {token}")
        assert exc.value.status_code == 403
