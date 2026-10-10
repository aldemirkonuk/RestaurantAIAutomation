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


# Write endpoints re-read user_roles (require_live_studio_role, F-761). By default each
# test's caller holds in the DB exactly the roles its JWT claims; TestLiveStudioRole
# overrides this to prove the DB, not the claim, is what decides.
from services import override_service as _override_service

_REAL_FETCH_ACTIVE_ROLES = _override_service._fetch_active_studio_roles
_DB_ROLES_BY_SUB = {
    "user-dev-001": ["developer"],
    "user-contrib-001": ["certified_contributor"],
    "user-admin-001": ["review_admin"],
}


@pytest.fixture(autouse=True)
def _db_roles_match_jwt():
    with patch(
        "services.override_service._fetch_active_studio_roles",
        side_effect=lambda sub: _DB_ROLES_BY_SUB.get(sub, []),
    ):
        yield


def _make_jwt(payload: dict, secret: str = SECRET) -> str:
    import jwt as pyjwt

    return pyjwt.encode(payload, secret, algorithm="HS256")


def _auth(payload: dict) -> dict:
    return {"Authorization": f"Bearer {_make_jwt(payload)}"}


def _make_settings(secret: str = SECRET, trust_threshold: int = 5):
    return type(
        "S",
        (),
        {
            "supabase_jwt_secret": secret,
            "trust_level_threshold": trust_threshold,
        },
    )()


def _make_submission_mock(field_confidence: dict):
    """Return a MagicMock supabase client pre-configured for the submit_override route."""
    mock_sb = MagicMock()
    # select().eq().maybe_single().execute().data — used by submit_override and _apply_override_to_submission
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
        "id": "sub-001",
        "field_confidence": field_confidence,
    }
    # insert().execute().data — override_events insert
    mock_sb.table.return_value.insert.return_value.execute.return_value.data = [
        {"id": "ov-001"}
    ]
    # update().eq().execute().data — _apply_override_to_submission update
    mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [
        {}
    ]
    return mock_sb


# ─── POST /overrides — D-07 reason enforcement ───────────────────────────────


class TestPostOverrides:
    def test_post_override_low_confidence_no_reason_required(
        self, test_client: TestClient
    ):
        """confidence < 0.8 → reason NOT required; override accepted."""
        mock_sb = _make_submission_mock(
            field_confidence={
                "wine_name": {
                    "value": "Old Name",
                    "confidence": 0.5,
                    "source": "visible",
                }
            }
        )
        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=mock_sb):
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
            field_confidence={
                "vintage": {"value": "2018", "confidence": 0.85, "source": "visible"}
            }
        )
        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=mock_sb):
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
            field_confidence={
                "vintage": {"value": "2018", "confidence": 0.85, "source": "visible"}
            }
        )
        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=mock_sb):
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
                json={
                    "role": "certified_contributor",
                    "target_email": "new@example.com",
                },
                headers=_auth(CONTRIBUTOR_JWT_PAYLOAD),
            )
        assert resp.status_code == 403, resp.text

    def test_invite_by_review_admin_returns_201_with_token(
        self, test_client: TestClient
    ):
        """review_admin generating invite → 200/201 with token field."""
        mock_sb = MagicMock()
        mock_sb.table.return_value.insert.return_value.execute.return_value.data = [
            {
                "token": "abc-token-123",
                "role": "certified_contributor",
                "expires_at": "2026-04-14T00:00:00Z",
            }
        ]
        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=mock_sb):
            resp = test_client.post(
                "/api/v1/studio/invite",
                json={
                    "role": "certified_contributor",
                    "target_email": "new@example.com",
                },
                headers=_auth(REVIEW_ADMIN_JWT_PAYLOAD),
            )
        assert resp.status_code in (200, 201), resp.text
        body = resp.json()
        assert "token" in body


# ─── POST /invite/redeem — ADR 0021 ──────────────────────────────────────────
#
# These live here rather than in tests/e2e/test_studio_pipeline.py because the whole
# tests/e2e/ subtree is skipped unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
# (a session-scoped autouse teardown fixture requires them: conftest_prod.py:217). The
# studio pipeline tests are mock-only and therefore never actually ran locally or in CI
# without those secrets. The invite behaviour is load-bearing enough to need coverage that
# runs unconditionally. Filed as OD-83.

INVITEE_JWT_PAYLOAD = {
    "sub": "user-invitee-001",
    "email": "invitee@example.com",
    "app_metadata": {"roles": []},
}

INVITE_TARGET_EMAIL = "invitee@example.com"


def _make_invite_mocks(
    *,
    target_email: str = INVITE_TARGET_EMAIL,
    used_at=None,
    expires_at: str = "2099-01-01T00:00:00Z",
    claim_succeeds: bool = True,
    existing_roles=None,
    token_found: bool = True,
):
    """Supabase mocks shaped to redeem_invite's exact call chain."""
    invite_mock = MagicMock()
    invite_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
        {
            "id": "tok-001",
            "token": "tok-value",
            "role": "certified_contributor",
            "target_email": target_email,
            "expires_at": expires_at,
            "used_at": used_at,
            "created_by": "user-admin-001",
        }
        if token_found
        else None
    )
    invite_mock.update.return_value.eq.return_value.is_.return_value.execute.return_value.data = (
        [{"id": "tok-001"}] if claim_succeeds else []
    )

    user_roles_mock = MagicMock()
    user_roles_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = (
        existing_roles or []
    )

    sb = MagicMock()
    sb.table.side_effect = lambda name: {
        "invite_tokens": invite_mock,
        "user_roles": user_roles_mock,
    }.get(name, MagicMock())
    return sb, invite_mock, user_roles_mock


def _redeem(test_client, sb, payload, token="tok-value"):
    with patch("config.settings.get_settings", return_value=_make_settings()), patch(
        "api.studio_routes._get_supabase", return_value=sb
    ), patch("services.override_service._get_supabase", return_value=sb):
        return test_client.post(
            "/api/v1/studio/invite/redeem",
            json={"token": token},
            headers=_auth(payload),
        )


class TestRedeemInvite:
    def test_roleless_invitee_can_redeem(self, test_client: TestClient):
        """The regression this ADR fixes: an invitee has no studio role, by definition."""
        sb, _, user_roles_mock = _make_invite_mocks()
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 200, resp.text
        assert resp.json()["role_granted"] == "certified_contributor"
        assert user_roles_mock.insert.call_count == 1

    def test_email_mismatch_returns_403_and_does_not_burn_token(
        self, test_client: TestClient
    ):
        """A forwarded token grants nothing to the wrong account (T-13-13)."""
        sb, invite_mock, user_roles_mock = _make_invite_mocks()
        # DEVELOPER_JWT_PAYLOAD's email is dev@example.com, not the invited address.
        resp = _redeem(test_client, sb, DEVELOPER_JWT_PAYLOAD)
        assert resp.status_code == 403, resp.text
        assert invite_mock.update.call_count == 0
        assert user_roles_mock.insert.call_count == 0

    def test_token_with_no_target_email_is_unredeemable(self, test_client: TestClient):
        """Rows minted before ADR 0021 have no binding, so they fail closed rather than open."""
        sb, invite_mock, _ = _make_invite_mocks(target_email=None)
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 403, resp.text
        assert invite_mock.update.call_count == 0

    def test_email_match_is_case_and_whitespace_insensitive(
        self, test_client: TestClient
    ):
        """Address comparison must not reject on casing an identity provider chose."""
        sb, _, _ = _make_invite_mocks(target_email="  Invitee@Example.COM ")
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 200, resp.text

    def test_already_used_token_returns_409(self, test_client: TestClient):
        sb, _, user_roles_mock = _make_invite_mocks(used_at="2026-01-01T00:00:00Z")
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 409, resp.text
        assert user_roles_mock.insert.call_count == 0

    def test_expired_token_returns_410(self, test_client: TestClient):
        sb, _, _ = _make_invite_mocks(expires_at="2020-01-01T00:00:00Z")
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 410, resp.text

    def test_unknown_token_returns_404(self, test_client: TestClient):
        sb, _, _ = _make_invite_mocks(token_found=False)
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 404, resp.text

    def test_lost_claim_race_returns_409_without_granting(
        self, test_client: TestClient
    ):
        """The conditional UPDATE, not the earlier read, is what enforces single-use."""
        sb, _, user_roles_mock = _make_invite_mocks(claim_succeeds=False)
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 409, resp.text
        assert user_roles_mock.insert.call_count == 0

    def test_already_held_role_returns_409_without_burning_token(
        self, test_client: TestClient
    ):
        sb, invite_mock, _ = _make_invite_mocks(
            existing_roles=[{"role": "certified_contributor"}]
        )
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 409, resp.text
        assert invite_mock.update.call_count == 0

    def test_failed_grant_releases_the_claim(self, test_client: TestClient):
        """A burned token with no role granted would strand the invitee with no recourse."""
        sb, invite_mock, user_roles_mock = _make_invite_mocks()
        user_roles_mock.insert.return_value.execute.side_effect = RuntimeError("boom")
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 503, resp.text
        # Two updates: the claim, then the compensating release.
        assert invite_mock.update.call_count == 2
        assert invite_mock.update.call_args_list[1][0][0] == {
            "used_at": None,
            "used_by": None,
        }

    def test_missing_bearer_token_returns_401(self, test_client: TestClient):
        """Authenticated-only still means authenticated — the gate did not simply vanish."""
        sb, _, _ = _make_invite_mocks()
        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb):
            resp = test_client.post(
                "/api/v1/studio/invite/redeem", json={"token": "tok-value"}
            )
        assert resp.status_code == 401, resp.text

    def test_forged_token_returns_401(self, test_client: TestClient):
        """Signature verification survives the removal of the role check (T-13-07)."""
        sb, _, _ = _make_invite_mocks()
        forged = _make_jwt(INVITEE_JWT_PAYLOAD, secret="not-the-real-secret")
        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb):
            resp = test_client.post(
                "/api/v1/studio/invite/redeem",
                json={"token": "tok-value"},
                headers={"Authorization": f"Bearer {forged}"},
            )
        assert resp.status_code == 401, resp.text


class TestLogSanitization:
    """CodeQL py/log-injection (alert 884): `sub` reaches the log from the request's JWT."""

    def test_newlines_cannot_forge_a_second_log_entry(self):
        from services.override_service import sanitize_for_log

        forged = "victim\nINFO:root:Redeemed invite for user=attacker role=review_admin"
        cleaned = sanitize_for_log(forged)

        assert "\n" not in cleaned
        assert "\r" not in cleaned
        assert cleaned.startswith("victim\\n")

    def test_caps_length_and_survives_non_strings(self):
        from services.override_service import sanitize_for_log

        assert len(sanitize_for_log("a" * 500)) == 128
        assert sanitize_for_log(None) == "None"

    def test_redeem_logs_a_sanitized_subject(self, test_client: TestClient, caplog):
        """The success path logs the JWT subject — it must arrive escaped."""
        import logging

        sb, _, _ = _make_invite_mocks()
        payload = {
            "sub": "evil\nINFO:root:forged entry",
            "email": INVITE_TARGET_EMAIL,
            "app_metadata": {"roles": []},
        }
        with caplog.at_level(logging.INFO):
            resp = _redeem(test_client, sb, payload)

        assert resp.status_code == 200, resp.text
        redeemed = [r for r in caplog.records if "Redeemed invite" in r.getMessage()]
        assert redeemed, "expected a redemption log line"
        assert "\n" not in redeemed[0].getMessage()


class TestInviteRequiresTargetEmail:
    def test_mint_without_target_email_returns_422(self, test_client: TestClient):
        """An unbound token would be a bearer capability for a role — ADR 0021 forbids minting one."""
        with patch("config.settings.get_settings", return_value=_make_settings()):
            resp = test_client.post(
                "/api/v1/studio/invite",
                json={"role": "review_admin"},
                headers=_auth(REVIEW_ADMIN_JWT_PAYLOAD),
            )
        assert resp.status_code == 422, resp.text

    def test_mint_with_malformed_target_email_returns_422(
        self, test_client: TestClient
    ):
        with patch("config.settings.get_settings", return_value=_make_settings()):
            resp = test_client.post(
                "/api/v1/studio/invite",
                json={"role": "developer", "target_email": "not-an-address"},
                headers=_auth(REVIEW_ADMIN_JWT_PAYLOAD),
            )
        assert resp.status_code == 422, resp.text


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
        override_table_mock.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": "ov-001", "promotion_status": "approved"}
        ]

        submission_table_mock = MagicMock()
        submission_table_mock.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "sub-001",
            "field_confidence": {
                "vintage": {"value": "2018", "confidence": 0.5, "source": "visible"}
            },
        }
        submission_table_mock.update.return_value.eq.return_value.execute.return_value.data = [
            {}
        ]

        def _table_side_effect(name):
            if name == "override_events":
                return override_table_mock
            return submission_table_mock

        mock_sb = MagicMock()
        mock_sb.table.side_effect = _table_side_effect

        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=mock_sb), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ):
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


# ─── F-757: a revoked contributor can be listed, re-enabled and re-invited ───


class TestRevokedContributorsCanReturn:
    def test_contributor_list_includes_revoked_rows(self, test_client: TestClient):
        """The Enable action only exists on revoked rows, so the list must carry them."""
        sb = MagicMock()
        roles = sb.table.return_value
        roles.select.return_value.eq.return_value.execute.return_value.data = [
            {"user_id": "u-1", "revoked_at": None},
            {"user_id": "u-2", "revoked_at": "2026-10-01T00:00:00Z"},
        ]
        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb):
            resp = test_client.get(
                "/api/v1/studio/contributors", headers=_auth(REVIEW_ADMIN_JWT_PAYLOAD)
            )
        assert resp.status_code == 200, resp.text
        assert [c["user_id"] for c in resp.json()["contributors"]] == ["u-1", "u-2"]
        roles.select.return_value.eq.return_value.is_.assert_not_called()

    def test_reinvite_restores_the_revoked_row_instead_of_inserting(
        self, test_client: TestClient
    ):
        """user_roles is UNIQUE (user_id, role): a second INSERT can only fail."""
        sb, _, user_roles_mock = _make_invite_mocks(
            existing_roles=[
                {"role": "certified_contributor", "revoked_at": "2026-10-01T00:00:00Z"}
            ]
        )
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 200, resp.text
        assert user_roles_mock.insert.call_count == 0
        assert user_roles_mock.update.call_count == 1
        restored = user_roles_mock.update.call_args[0][0]
        assert restored["revoked_at"] is None
        assert restored["granted_by"] == "user-admin-001"
        assert restored["promotion_policy"] == "queue"
        assert restored["consecutive_approved_overrides"] == 0

    def test_unique_violation_on_grant_reads_as_already_held(
        self, test_client: TestClient
    ):
        """A racing redeem that wins the row turns into words, and the invite is released."""

        class _UniqueViolation(Exception):
            code = "23505"

        sb, invite_mock, user_roles_mock = _make_invite_mocks()
        user_roles_mock.insert.return_value.execute.side_effect = _UniqueViolation(
            "duplicate key value violates unique constraint"
        )
        resp = _redeem(test_client, sb, INVITEE_JWT_PAYLOAD)
        assert resp.status_code == 409, resp.text
        assert "already hold" in resp.json()["detail"]
        assert invite_mock.update.call_args_list[-1][0][0] == {
            "used_at": None,
            "used_by": None,
        }


# ─── F-758 / F-759: queue decisions are atomic and honest about failure ──────


def _decide_mocks(*, update_rows, apply_fails=False):
    events = MagicMock()
    events.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
        "id": "ov-001",
        "promotion_status": "pending",
        "submission_id": "sub-001",
        "field_name": "vintage",
        "new_value": "2019",
        "actor_id": "user-contrib-001",
    }
    events.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = (
        update_rows
    )
    sb = MagicMock()
    sb.table.side_effect = lambda name: (
        events if name == "override_events" else MagicMock()
    )
    apply = MagicMock(side_effect=RuntimeError("boom") if apply_fails else None)
    return sb, events, apply


def _decide(test_client, sb, apply, trust, promote, decision="approved"):
    with patch("config.settings.get_settings", return_value=_make_settings()), patch(
        "api.studio_routes._get_supabase", return_value=sb
    ), patch("api.studio_routes._apply_override_to_submission", apply), patch(
        "api.studio_routes.check_and_update_trust", trust
    ), patch(
        "api.studio_routes._maybe_promote_submission", promote
    ), patch(
        "api.studio_routes._get_user_studio_roles",
        return_value=[{"role": "certified_contributor"}],
    ):
        return test_client.patch(
            "/api/v1/studio/queue/ov-001",
            json={"decision": decision},
            headers=_auth(REVIEW_ADMIN_JWT_PAYLOAD),
        )


class TestQueueDecisionIsAtomic:
    def test_update_is_conditioned_on_still_pending(self, test_client: TestClient):
        sb, events, apply = _decide_mocks(update_rows=[{"id": "ov-001"}])
        resp = _decide(test_client, sb, apply, MagicMock(), MagicMock())
        assert resp.status_code == 200, resp.text
        events.update.return_value.eq.return_value.eq.assert_called_with(
            "promotion_status", "pending"
        )

    def test_lost_race_returns_409_and_applies_nothing(self, test_client: TestClient):
        """Both reviewers pass the read; only the write that still matches 'pending' acts."""
        sb, _, apply = _decide_mocks(update_rows=[])
        trust, promote = MagicMock(), MagicMock()
        resp = _decide(test_client, sb, apply, trust, promote)
        assert resp.status_code == 409, resp.text
        apply.assert_not_called()
        promote.assert_not_called()
        trust.assert_not_called()


class TestFailedApprovalIsNotApproved:
    def test_failed_apply_returns_row_to_queue_and_skips_trust(
        self, test_client: TestClient
    ):
        sb, events, apply = _decide_mocks(
            update_rows=[{"id": "ov-001"}], apply_fails=True
        )
        trust, promote = MagicMock(), MagicMock()
        resp = _decide(test_client, sb, apply, trust, promote)
        assert resp.status_code == 503, resp.text
        assert "back in the queue" in resp.json()["detail"]
        revert = events.update.call_args_list[-1][0][0]
        assert revert["promotion_status"] == "pending"
        assert revert["decided_at"] is None
        promote.assert_not_called()
        trust.assert_not_called()


# ─── F-761: writes trust user_roles, not the token's role claim ──────────────


def _live_check(roles_required, payload, db_rows=None, db=True, db_raises=False):
    from fastapi import Depends
    from services.override_service import require_live_studio_role

    sb = MagicMock()
    chain = sb.table.return_value.select.return_value.eq.return_value.is_.return_value
    if db_raises:
        chain.execute.side_effect = RuntimeError("db down")
    else:
        chain.execute.return_value.data = db_rows or []
    inner = Depends(require_live_studio_role(*roles_required)).dependency
    with patch("config.settings.get_settings", return_value=_make_settings()), patch(
        "services.override_service._fetch_active_studio_roles",
        _REAL_FETCH_ACTIVE_ROLES,
    ), patch(
        "services.override_service._get_supabase", return_value=sb if db else None
    ):
        return inner(authorization=f"Bearer {_make_jwt(payload)}")


class TestLiveStudioRole:
    def test_revoked_role_in_db_beats_the_token_claim(self):
        """The JWT still says review_admin for up to 15 minutes after a revoke."""
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            _live_check(("review_admin",), REVIEW_ADMIN_JWT_PAYLOAD, db_rows=[])
        assert exc.value.status_code == 403

    def test_role_held_in_db_passes_and_replaces_claimed_roles(self):
        out = _live_check(
            ("review_admin",),
            CONTRIBUTOR_JWT_PAYLOAD,
            db_rows=[{"role": "review_admin"}],
        )
        assert out["app_metadata"]["roles"] == ["review_admin"]

    def test_unreadable_roles_fail_closed(self):
        from fastapi import HTTPException

        for kwargs in ({"db": False}, {"db_raises": True}):
            with pytest.raises(HTTPException) as exc:
                _live_check(("review_admin",), REVIEW_ADMIN_JWT_PAYLOAD, **kwargs)
            assert exc.value.status_code == 503

    def test_write_endpoint_rejects_a_revoked_admin(self, test_client: TestClient):
        """End to end: PATCH revoke as an admin whose own row is gone → 403, no write."""
        sb = MagicMock()
        with patch(
            "config.settings.get_settings", return_value=_make_settings()
        ), patch("api.studio_routes._get_supabase", return_value=sb), patch(
            "services.override_service._fetch_active_studio_roles", return_value=[]
        ):
            resp = test_client.patch(
                "/api/v1/studio/contributors/u-9/revoke",
                headers=_auth(REVIEW_ADMIN_JWT_PAYLOAD),
            )
        assert resp.status_code == 403, resp.text
        sb.table.assert_not_called()
