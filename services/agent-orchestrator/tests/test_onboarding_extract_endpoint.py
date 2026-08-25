"""
Tests for POST /api/v1/onboarding/extract endpoint.

Uses httpx.AsyncClient + ASGITransport (starlette 0.35 / httpx 0.28 compatible).
"""

import sys
import os
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure services/agent-orchestrator is on the path
_ORCHESTRATOR_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ORCHESTRATOR_ROOT not in sys.path:
    sys.path.insert(0, _ORCHESTRATOR_ROOT)


@pytest.fixture
def mock_extractor_result():
    from services.claude_vision_extractor import ClaudeExtractionResult

    return ClaudeExtractionResult(
        scan_session_id="test-session-uuid",
        wines=[
            {
                "wine_name": "Barolo Cannubi",
                "vintage": 2018,
                "price_bottle": 120.0,
                "price_glass": None,
                "region": "Piedmont",
                "country": "Italy",
                "grape_variety": "Nebbiolo",
                "section_name": "Reds",
                "bin_number": None,
                "completeness_score": 0.833,
                "needs_review": False,
            }
        ],
        total_wines=1,
        pages_processed=1,
        total_cost_usd=0.045,
        total_input_tokens=10000,
        total_output_tokens=2000,
        needs_review_count=0,
        page_errors=[],
    )


def _mock_supabase(prior_spend_rows=None, insert_id="sub-test-0001"):
    """Supabase double covering the ledger read and the submission writes.

    The endpoint now fails CLOSED: with no client, or an unreadable api_spend
    table, it refuses to call Claude at all. So every test that expects to reach
    the extractor has to supply a readable ledger.
    """
    spend = MagicMock()
    spend.select.return_value.eq.return_value.execute.return_value.data = (
        prior_spend_rows or []
    )
    submissions = MagicMock()
    submissions.insert.return_value.execute.return_value.data = [{"id": insert_id}]
    review_queue = MagicMock()
    review_queue.insert.return_value.execute.return_value.data = []

    client = MagicMock()
    client.table.side_effect = lambda name: {
        "api_spend": spend,
        "master_wine_library_submissions": submissions,
        "field_review_queue": review_queue,
    }.get(name, MagicMock())
    return client


async def _post(app, path, json_body, headers=None):
    """Helper: async POST via httpx.ASGITransport, authenticated by default.

    POST /onboarding/extract bills the Anthropic account, so it requires
    X-Admin-Key (or a studio JWT). Pass headers={} to exercise the 401 path.
    """
    from conftest import TEST_ADMIN_API_KEY

    if headers is None:
        headers = {"X-Admin-Key": TEST_ADMIN_API_KEY}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        return await client.post(path, json=json_body, headers=headers)


@pytest.mark.asyncio
async def test_extract_missing_restaurant_id():
    import main

    resp = await _post(
        main.app, "/api/v1/onboarding/extract", {"images": ["base64data"]}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_extract_pdf_base64_rejected():
    import main

    with patch(
        "api.onboarding_routes.get_supabase_client", return_value=_mock_supabase()
    ):
        resp = await _post(
            main.app,
            "/api/v1/onboarding/extract",
            {
                "restaurant_id": "rest-123",
                # Malformed base64 (length not a multiple of 4) — pdf_base64 is
                # a supported input, but invalid encoding must be rejected.
                "pdf_base64": "pdfbase64data",
            },
        )
    assert resp.status_code == 422
    assert "Invalid base64" in resp.json().get("detail", "")


@pytest.mark.asyncio
async def test_extract_empty_images_rejected():
    import main

    resp = await _post(
        main.app,
        "/api/v1/onboarding/extract",
        {
            "restaurant_id": "rest-123",
            "images": [],
        },
    )
    assert resp.status_code == 422
    assert "Provide either" in resp.json().get("detail", "")


@pytest.mark.asyncio
async def test_extract_success_200(mock_extractor_result):
    import main

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=mock_extractor_result)
        mock_getter.return_value = mock_extractor
        with patch(
            "api.onboarding_routes.get_supabase_client",
            return_value=_mock_supabase(),
        ):
            resp = await _post(
                main.app,
                "/api/v1/onboarding/extract",
                {
                    "restaurant_id": "rest-123",
                    "images": ["base64page1"],
                },
            )
    assert resp.status_code == 200
    body = resp.json()
    assert "scan_session_id" in body
    assert "wines" in body
    assert "total_cost_usd" in body
    assert "needs_review_count" in body
    assert body["total_wines"] == 1


@pytest.mark.asyncio
async def test_extract_partial_failure_207(mock_extractor_result):
    partial_result = mock_extractor_result.model_copy(
        update={"page_errors": [{"page": 1, "error": "API timeout"}]}
    )
    import main

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=partial_result)
        mock_getter.return_value = mock_extractor
        with patch(
            "api.onboarding_routes.get_supabase_client",
            return_value=_mock_supabase(),
        ):
            resp = await _post(
                main.app,
                "/api/v1/onboarding/extract",
                {
                    "restaurant_id": "rest-123",
                    "images": ["page1", "page2"],
                },
            )
    assert resp.status_code == 207


@pytest.mark.asyncio
async def test_extract_all_pages_fail_503():
    import main

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(
            side_effect=RuntimeError("All 2 pages failed")
        )
        mock_getter.return_value = mock_extractor
        with patch(
            "api.onboarding_routes.get_supabase_client",
            return_value=_mock_supabase(),
        ):
            resp = await _post(
                main.app,
                "/api/v1/onboarding/extract",
                {
                    "restaurant_id": "rest-123",
                    "images": ["page1", "page2"],
                },
            )
    assert resp.status_code == 503
    assert "All 2 pages failed" in resp.json().get("detail", "")


# ===========================================================================
# Authentication — POST /onboarding/extract bills the Anthropic account
# ===========================================================================
#
# Until this was added the endpoint was reachable anonymously on the public
# Railway host: an unauthenticated POST with a valid body sent menu images to
# Claude Vision and billed the account. The only guard was a $2.00 cap keyed on
# a caller-supplied restaurant_id that also failed open.


@pytest.mark.asyncio
async def test_extract_without_credentials_is_rejected():
    """Anonymous POST → 401, and the extractor is never constructed.

    The status code alone is not the point: the assertion that matters is that
    no Claude call was set up before the request was refused.
    """
    import main

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        resp = await _post(
            main.app,
            "/api/v1/onboarding/extract",
            {"restaurant_id": "rest-123", "images": ["base64page1"]},
            headers={},
        )

    assert resp.status_code == 401, resp.text
    assert not mock_getter.called, "Claude Vision was reached by an anonymous caller"


@pytest.mark.asyncio
async def test_extract_with_wrong_admin_key_is_rejected():
    """A wrong X-Admin-Key is rejected exactly like a missing one."""
    import main

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        resp = await _post(
            main.app,
            "/api/v1/onboarding/extract",
            {"restaurant_id": "rest-123", "images": ["base64page1"]},
            headers={"X-Admin-Key": "not-the-real-key"},
        )

    assert resp.status_code == 401, resp.text
    assert not mock_getter.called


@pytest.mark.asyncio
async def test_extract_accepts_studio_bearer_token(mock_extractor_result):
    """The Studio UI path (apps/web CommandBar) sends a Bearer JWT, not an admin
    key. That path must keep working, and the restaurant must be resolved from
    the token rather than from the request body."""
    import main

    supabase = _mock_supabase()
    users = MagicMock()
    users.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"restaurant_id": "restaurant-from-db"}
    ]
    base_side_effect = supabase.table.side_effect
    supabase.table.side_effect = lambda name: (
        users if name == "users" else base_side_effect(name)
    )

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        mock_extractor = MagicMock()
        mock_extractor.extract_menu = AsyncMock(return_value=mock_extractor_result)
        mock_getter.return_value = mock_extractor
        with patch(
            "api.onboarding_routes.get_supabase_client", return_value=supabase
        ), patch(
            "services.override_service.require_studio_role",
            return_value=lambda authorization=None: {"sub": "user-uuid-1"},
        ):
            resp = await _post(
                main.app,
                "/api/v1/onboarding/extract",
                # Body claims a different restaurant — it must be ignored.
                {"restaurant_id": "attacker-supplied", "images": ["base64page1"]},
                headers={"Authorization": "Bearer fake.jwt.token"},
            )

    assert resp.status_code == 200, resp.text
    submissions = supabase.table("master_wine_library_submissions")
    written = submissions.insert.call_args_list[0][0][0]
    assert written["restaurant_id"] == "restaurant-from-db", (
        "submission was attributed to the caller-supplied restaurant_id "
        f"instead of the one resolved from the token: {written['restaurant_id']}"
    )


# ===========================================================================
# Spend cap — must fail CLOSED
# ===========================================================================


@pytest.mark.asyncio
async def test_extract_refuses_when_ledger_query_fails():
    """An api_spend query error must block the call, not silently uncap it."""
    import main

    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.execute.side_effect = Exception(
        "connection reset"
    )

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        with patch("api.onboarding_routes.get_supabase_client", return_value=supabase):
            resp = await _post(
                main.app,
                "/api/v1/onboarding/extract",
                {"restaurant_id": "rest-123", "images": ["base64page1"]},
            )

    assert resp.status_code == 503, resp.text
    assert "fail closed" in resp.json().get("detail", "").lower()
    assert not mock_getter.called, "Claude Vision was called with no enforceable cap"


@pytest.mark.asyncio
async def test_extract_refuses_when_no_supabase_client():
    """No ledger at all is the same situation as an unreadable one."""
    import main

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        with patch("api.onboarding_routes.get_supabase_client", return_value=None):
            resp = await _post(
                main.app,
                "/api/v1/onboarding/extract",
                {"restaurant_id": "rest-123", "images": ["base64page1"]},
            )

    assert resp.status_code == 503, resp.text
    assert not mock_getter.called


@pytest.mark.asyncio
async def test_extract_cap_still_returns_402_when_exceeded():
    """The cap itself still fires — fail-closed did not replace it."""
    import main

    supabase = _mock_supabase(prior_spend_rows=[{"cost_usd": 3.0}])

    with patch("api.onboarding_routes.get_claude_vision_extractor") as mock_getter:
        with patch(
            "api.onboarding_routes.get_supabase_client", return_value=supabase
        ), patch("api.onboarding_routes._send_cap_alert_email"):
            resp = await _post(
                main.app,
                "/api/v1/onboarding/extract",
                {"restaurant_id": "rest-123", "images": ["base64page1"]},
            )

    assert resp.status_code == 402, resp.text
    assert not mock_getter.called
