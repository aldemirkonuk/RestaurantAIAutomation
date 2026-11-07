"""The Studio's manual Promote writes master_wine_library's real columns (QA round 5, B-1).

Until 2026-11-07 promote_to_library sent price, price_glass, color,
sweetness_level, tasting_notes, description, submission_id, promoted_by and
promoted_at -- none of them columns -- and no wine_id (NOT NULL), so every
promote answered 503. Assertions are on what is SENT (library_columns_util.py).

Run: cd services/agent-orchestrator && python -m pytest tests/test_library_promotion_manual.py -v
"""

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from library_columns_util import SUBMISSION, _assert_real_columns, _DB


# =============================================================================
# Path 2: the Studio's manual Promote
# =============================================================================


class TestManualPath:
    def _promote(self, db):
        from api import studio_routes

        with patch.object(studio_routes, "_get_supabase", return_value=db):
            return studio_routes.promote_to_library(
                studio_routes.PromoteRequest(submission_id="sub-1"), {"sub": "dev-1"}
            )

    def test_writes_real_columns_and_links_the_submission(self):
        db = _DB(SUBMISSION)
        resp = self._promote(db)
        _assert_real_columns(db)
        (row,) = db.library_inserts()
        assert resp["status"] == "promoted" and resp["wine_id"] == row["id"]
        assert db.submission_updates() == [{"matched_master_id": row["id"]}]

    def test_a_refused_insert_is_a_worded_503(self):
        with pytest.raises(HTTPException) as exc:
            self._promote(_DB(SUBMISSION, insert_error=RuntimeError("refused")))
        assert exc.value.status_code == 503
        assert "could not be added to the wine library" in exc.value.detail

    def test_a_taken_signature_is_409(self):
        err = RuntimeError("23505 duplicate key value")
        with pytest.raises(HTTPException) as exc:
            self._promote(_DB(SUBMISSION, insert_error=err))
        assert exc.value.status_code == 409
