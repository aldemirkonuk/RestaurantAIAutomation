"""
Unit tests for quality_routes.py — QUAL-02, QUAL-03.

Tests:
  - _compute_completeness() pure function
  - GET /review-queue sorting (auto_blocked first, then completeness asc)
  - GET /review-queue 503 when Supabase unavailable
  - PATCH /review-queue happy path: promotion to master_wine_library
  - PATCH /review-queue blocked path: score < 0.3 → auto_blocked, no promotion
  - PATCH /review-queue 404 when submission not found
  - PATCH /review-queue 409 when submission not pending_review
  - PATCH /review-queue field corrections logged to field_corrections table
"""
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_chain(data=None, single_data=None):
    """Build a Supabase query chain mock.

    ``data`` is used for .execute() returning a list result (insert/update/select-many).
    ``single_data`` is used for .maybe_single().execute() returning a single row.
    """
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.order.return_value = chain
    chain.range.return_value = chain
    chain.insert.return_value = chain
    chain.update.return_value = chain

    list_resp = MagicMock(data=data if data is not None else [])
    single_resp = MagicMock(data=single_data)
    # maybe_single() returns a new chain whose execute() gives single_resp
    single_chain = MagicMock()
    single_chain.execute.return_value = single_resp
    chain.maybe_single.return_value = single_chain
    chain.execute.return_value = list_resp
    return chain


def _make_supabase(chain=None):
    mock = MagicMock()
    mock.table.return_value = chain or _make_chain()
    return mock


def _pending_submission(
    sub_id="sub-1",
    score=0.5,
    blocked=False,
    restaurant_id="rest-1",
):
    return {
        "id": sub_id,
        "status": "pending_review",
        "auto_blocked": blocked,
        "restaurant_id": restaurant_id,
        "payload": {
            "wine_name": "Château Margaux",
            "vintage": 2018,
            "price_bottle": 450.0,
            "region": "Bordeaux",
            "country": "France",
            "section_name": "Red Wines",
            "completeness_score": score,
        },
    }


# ---------------------------------------------------------------------------
# _compute_completeness
# ---------------------------------------------------------------------------

def test_compute_completeness_full_score():
    """QUAL-03: all 6 COMPLETENESS_FIELDS present → 1.0."""
    from api.quality_routes import _compute_completeness
    payload = {
        "wine_name": "Château Margaux",
        "vintage": 2018,
        "price_bottle": 450.0,
        "region": "Bordeaux",
        "country": "France",
        "section_name": "Red Wines",
    }
    assert _compute_completeness(payload) == 1.0


def test_compute_completeness_partial_score():
    """QUAL-03: 3 of 6 fields → 0.5."""
    from api.quality_routes import _compute_completeness
    payload = {"wine_name": "Opus One", "vintage": 2019, "price_bottle": 300.0}
    assert _compute_completeness(payload) == 0.5


def test_compute_completeness_empty():
    """QUAL-03: empty payload → 0.0."""
    from api.quality_routes import _compute_completeness
    assert _compute_completeness({}) == 0.0


# ---------------------------------------------------------------------------
# GET /review-queue
# ---------------------------------------------------------------------------

def test_get_review_queue_503_when_no_db():
    """QUAL-03: returns 503 when Supabase is not configured."""
    from api.quality_routes import get_review_queue
    from fastapi import HTTPException

    with patch("api.quality_routes._get_supabase", return_value=None):
        with pytest.raises(HTTPException) as exc_info:
            get_review_queue()
    assert exc_info.value.status_code == 503


def test_get_review_queue_sorts_blocked_first():
    """QUAL-03: auto_blocked items appear before non-blocked; non-blocked sorted by score asc."""
    from api.quality_routes import get_review_queue

    rows = [
        {
            "id": "sub-high", "restaurant_id": "r1",
            "auto_blocked": False,
            "created_at": "2026-04-05T00:00:00Z",
            "payload": {"wine_name": "High Score", "completeness_score": 0.8},
        },
        {
            "id": "sub-blocked", "restaurant_id": "r1",
            "auto_blocked": True,
            "created_at": "2026-04-05T00:00:01Z",
            "payload": {"wine_name": "Blocked Wine", "completeness_score": 0.1},
        },
        {
            "id": "sub-low", "restaurant_id": "r1",
            "auto_blocked": False,
            "created_at": "2026-04-05T00:00:02Z",
            "payload": {"wine_name": "Low Score", "completeness_score": 0.4},
        },
    ]

    chain = _make_chain(data=rows)
    mock_supabase = _make_supabase(chain)

    with patch("api.quality_routes._get_supabase", return_value=mock_supabase):
        result = get_review_queue()

    ids = [item["id"] for item in result["items"]]
    assert ids[0] == "sub-blocked", "auto_blocked item must be first"
    assert ids[1] == "sub-low", "lower completeness next"
    assert ids[2] == "sub-high", "higher completeness last"


# ---------------------------------------------------------------------------
# PATCH /review-queue — happy path
# ---------------------------------------------------------------------------

def test_patch_promotes_wine_with_sufficient_score():
    """QUAL-03: score >= 0.3 after correction → promoted=True, status=approved."""
    from api.quality_routes import patch_review_queue, ReviewQueuePatchRequest

    sub = _pending_submission(score=0.5)

    # Mock execute() calls in order: fetch, promotion insert, status update
    fetch_resp = MagicMock(data=sub)
    insert_resp = MagicMock(data=[{}])
    update_resp = MagicMock(data=[{}])

    supabase = MagicMock()
    # Each table() call returns a new chain
    chains = {
        "master_wine_library_submissions_fetch": _make_chain(single_data=sub),
        "master_wine_library_insert": _make_chain(data=[{}]),
        "master_wine_library_submissions_update": _make_chain(data=[{}]),
    }

    # Use side_effect on table() to return different chains per call
    call_count = [0]

    def table_side_effect(name):
        call_count[0] += 1
        n = call_count[0]
        if n == 1:
            # First call: fetch submission (select + maybe_single)
            return chains["master_wine_library_submissions_fetch"]
        elif n == 2:
            # Second call: insert into master_wine_library
            return chains["master_wine_library_insert"]
        else:
            # Third call: update submission status
            return chains["master_wine_library_submissions_update"]

    supabase.table.side_effect = table_side_effect

    with patch("api.quality_routes._get_supabase", return_value=supabase):
        result = patch_review_queue("sub-1", ReviewQueuePatchRequest())

    assert result["status"] == "approved"
    assert result["promoted_to_library"] is True
    assert result["auto_blocked"] is False


def test_patch_blocks_wine_with_low_score():
    """QUAL-01/QUAL-03: score < 0.3 after correction → auto_blocked=True, no promotion."""
    from api.quality_routes import patch_review_queue, ReviewQueuePatchRequest, FieldCorrection

    # Wine with only 1/6 fields (score = ~0.167 < 0.3 threshold)
    sub = _pending_submission(score=0.167, blocked=True)
    sub["payload"] = {"wine_name": "Mystery Wine", "completeness_score": 0.167}

    fetch_chain = _make_chain(single_data=sub)
    update_chain = _make_chain(data=[{}])

    call_count = [0]

    def table_side_effect(name):
        call_count[0] += 1
        if call_count[0] == 1:
            return fetch_chain
        return update_chain

    supabase = MagicMock()
    supabase.table.side_effect = table_side_effect

    with patch("api.quality_routes._get_supabase", return_value=supabase):
        result = patch_review_queue("sub-1", ReviewQueuePatchRequest())

    assert result["auto_blocked"] is True
    assert result["promoted_to_library"] is False
    assert result["status"] == "blocked"


def test_patch_returns_404_on_missing_submission():
    """QUAL-03: 404 when submission_id does not exist."""
    from api.quality_routes import patch_review_queue, ReviewQueuePatchRequest
    from fastapi import HTTPException

    fetch_chain = _make_chain(single_data=None)
    supabase = _make_supabase(fetch_chain)

    with patch("api.quality_routes._get_supabase", return_value=supabase):
        with pytest.raises(HTTPException) as exc_info:
            patch_review_queue("nonexistent", ReviewQueuePatchRequest())

    assert exc_info.value.status_code == 404


def test_patch_returns_409_when_not_pending_review():
    """QUAL-03: 409 when submission status is already 'approved'."""
    from api.quality_routes import patch_review_queue, ReviewQueuePatchRequest
    from fastapi import HTTPException

    sub = _pending_submission()
    sub["status"] = "approved"
    fetch_chain = _make_chain(single_data=sub)
    supabase = _make_supabase(fetch_chain)

    with patch("api.quality_routes._get_supabase", return_value=supabase):
        with pytest.raises(HTTPException) as exc_info:
            patch_review_queue("sub-1", ReviewQueuePatchRequest())

    assert exc_info.value.status_code == 409


def test_patch_logs_field_corrections_for_changed_fields():
    """QUAL-02: field_corrections table insert called for each changed field."""
    from api.quality_routes import patch_review_queue, ReviewQueuePatchRequest, FieldCorrection

    sub = _pending_submission(score=0.5)
    sub["payload"]["region"] = "Old Region"  # will be corrected

    fetch_chain = _make_chain(single_data=sub)
    corrections_chain = _make_chain(data=[{}])
    promote_chain = _make_chain(data=[{}])
    update_chain = _make_chain(data=[{}])

    call_count = [0]
    chains_by_call = [fetch_chain, corrections_chain, promote_chain, update_chain]

    def table_side_effect(name):
        idx = min(call_count[0], len(chains_by_call) - 1)
        chain = chains_by_call[idx]
        call_count[0] += 1
        return chain

    supabase = MagicMock()
    supabase.table.side_effect = table_side_effect

    body = ReviewQueuePatchRequest(
        corrections=[FieldCorrection(field_name="region", corrected_value="Burgundy")],
        corrected_by="reviewer@test.com",
    )

    with patch("api.quality_routes._get_supabase", return_value=supabase):
        result = patch_review_queue("sub-1", body)

    # Verify field_corrections table was called
    table_calls = [c.args[0] for c in supabase.table.call_args_list]
    assert "field_corrections" in table_calls, "field_corrections table must be called for QUAL-02"
