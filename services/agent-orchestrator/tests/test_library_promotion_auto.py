"""The Studio auto path writes real columns and says what happened to the wine (QA round 5, B-1).

Until 2026-11-07 _maybe_promote_submission inserted 15 columns no migration
defines and no wine_id (NOT NULL); PostgREST refused it, the error was swallowed,
and the contributor still read "auto_promoted". A return-value test would pass
against that code, so the assertions are on what is SENT, then on what the
contributor and the reviewer are told (library_columns_util.py has the replay).

Run: cd services/agent-orchestrator && python -m pytest tests/test_library_promotion_auto.py -v
"""

from unittest.mock import patch

from library_columns_util import SUBMISSION, _assert_real_columns, _DB, _Resp
from services.library_promotion import (
    ALREADY_IN_LIBRARY,
    FAILED,
    NOT_READY,
    OUTCOME_WORDS,
    PROMOTED,
)


# =============================================================================
# Path 1: the Studio auto path, and what the contributor is told
# =============================================================================


class TestAutoPath:
    def test_writes_real_columns_and_links_the_submission(self):
        from services.override_service import _maybe_promote_submission

        db = _DB(SUBMISSION)
        assert _maybe_promote_submission(db, "sub-1") == PROMOTED
        _assert_real_columns(db)
        (row,) = db.library_inserts()
        assert db.submission_updates()[-1] == {
            "status": "approved",
            "matched_master_id": row["id"],
        }

    def test_a_refused_insert_is_failed_and_marks_nothing(self):
        from services.override_service import _maybe_promote_submission

        db = _DB(SUBMISSION, insert_error=RuntimeError("PGRST204 column"))
        assert _maybe_promote_submission(db, "sub-1") == FAILED
        assert db.submission_updates() == []

    def test_a_taken_signature_is_already_in_library(self):
        from services.override_service import _maybe_promote_submission

        err = RuntimeError('duplicate key value violates unique constraint "x"')
        db = _DB(SUBMISSION, insert_error=err)
        assert _maybe_promote_submission(db, "sub-1") == ALREADY_IN_LIBRARY

    def test_an_open_gate_is_not_ready(self):
        from services.override_service import _maybe_promote_submission

        db = _DB({**SUBMISSION, "status": "approved"})
        assert _maybe_promote_submission(db, "sub-1") == NOT_READY
        assert db.library_inserts() == []

    def _submit(self, db):
        from api import studio_routes
        from services.override_service import OverrideRequest

        body = OverrideRequest(
            submission_id="sub-1",
            field_name="grape_variety",
            new_value="Nebbiolo",
            reason="label reads Nebbiolo",
        )
        user = {"sub": "dev-1", "app_metadata": {"roles": ["developer"]}}
        with patch.object(studio_routes, "_get_supabase", return_value=db):
            return studio_routes.submit_override(body, user)

    def test_the_contributor_is_told_when_the_wine_did_not_go_in(self):
        resp = self._submit(_DB(SUBMISSION, insert_error=RuntimeError("refused")))
        assert resp["status"] == "auto_promoted"  # the OVERRIDE's status
        assert resp["library"] == FAILED
        assert resp["library_detail"] == OUTCOME_WORDS[FAILED]

    def test_the_contributor_is_told_when_it_did(self):
        db = _DB(SUBMISSION)
        resp = self._submit(db)
        _assert_real_columns(db)
        assert resp["library"] == PROMOTED
        assert resp["library_detail"] == OUTCOME_WORDS[PROMOTED]

    def test_the_reviewer_is_told_too(self):
        from api import studio_routes
        from services.override_service import ApprovalDecision

        class _QueueDB(_DB):
            def respond(self, q):
                if q.table == "override_events" and q.op == "select":
                    return _Resp(
                        {
                            "id": "ov-1",
                            "promotion_status": "pending",
                            "submission_id": "sub-1",
                            "field_name": "grape_variety",
                            "new_value": "Nebbiolo",
                            "actor_id": "cc-1",
                        }
                    )
                return super().respond(q)

        db = _QueueDB(SUBMISSION, insert_error=RuntimeError("refused"))
        settings = type("S", (), {"trust_level_threshold": 5})()
        with patch.object(studio_routes, "_get_supabase", return_value=db), patch(
            "config.settings.get_settings", return_value=settings
        ):
            resp = studio_routes.decide_override(
                "ov-1", ApprovalDecision(decision="approved"), {"sub": "admin-1"}
            )
        assert resp["library"] == FAILED
