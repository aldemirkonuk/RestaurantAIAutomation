"""ADR 0099 — the orchestrator must identify itself when it sends vendor email.

`EmailComposerService.send_via_gateway` POSTs to the api-gateway's
`POST /communications/email`. Commit `fdaa7fa0` (2026-08-25) put a class-level
`@UseGuards(JwtAuthGuard)` on that controller; this caller sent no credential at
all, so from that day the call was refused before the handler ran.

The gateway and the orchestrator already share one service secret — `ADMIN_API_KEY`,
carried in the `X-Admin-Key` header (`api/health_routes.py:verify_admin_key`, and
the gateway's own `orchestrator.service.ts:72` sending it the other way). This
reuses it rather than inventing a second scheme.

The fail-closed direction is the one that matters: an unset `ADMIN_API_KEY` must
stop the send, never send it unauthenticated and never report success.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import pytest

from agents.provider_conversation_agent import ProviderConversationAgent
from services.email_composer_service import EmailComposerService, EmailPayload


class _FakeResponse:
    def __init__(self, status: int, body: Dict[str, Any]):
        self.status = status
        self._body = body

    async def json(self) -> Dict[str, Any]:
        return self._body

    async def __aenter__(self) -> "_FakeResponse":
        return self

    async def __aexit__(self, *_exc: Any) -> bool:
        return False


class _FakeSession:
    """Records the single POST send_via_gateway makes, if it makes one."""

    calls: list = []

    def __init__(self, *_a: Any, **_kw: Any):
        pass

    async def __aenter__(self) -> "_FakeSession":
        return self

    async def __aexit__(self, *_exc: Any) -> bool:
        return False

    def post(
        self,
        url: str,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        **_kw: Any,
    ) -> _FakeResponse:
        _FakeSession.calls.append({"url": url, "json": json, "headers": headers or {}})
        return _FakeResponse(
            200, {"success": True, "messageId": "m1", "threadId": "t1"}
        )


@pytest.fixture
def composer() -> EmailComposerService:
    return EmailComposerService(
        database=None,
        config={"api_gateway_url": "http://gw:3001", "mock_mode": True},
    )


@pytest.fixture(autouse=True)
def _patch_session(monkeypatch: pytest.MonkeyPatch):
    import services.email_composer_service as mod

    _FakeSession.calls = []
    monkeypatch.setattr(mod.aiohttp, "ClientSession", _FakeSession)
    yield
    _FakeSession.calls = []


def _payload() -> EmailPayload:
    return EmailPayload(
        to=["vendor@example.com"],
        subject="Re: your wines",
        body_html="<p>hello</p>",
        body_text="hello",
        reply_to="orders@mudavym.com",
        thread_id="19f365aac4e6",
        in_reply_to="<wineops-123@wineops.ai>",
        references="<a@x> <b@y>",
    )


# ---------------------------------------------------------------------------
# F1 — the caller carries a service credential
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_carries_the_admin_key_header(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is True
    assert len(_FakeSession.calls) == 1
    headers = _FakeSession.calls[0]["headers"]
    assert headers.get("X-Admin-Key") == "s3cret-value"


@pytest.mark.asyncio
async def test_threading_fields_are_still_sent(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    await composer.send_via_gateway(_payload())

    body = _FakeSession.calls[0]["json"]
    assert body["replyTo"] == "orders@mudavym.com"
    assert body["threadId"] == "19f365aac4e6"
    assert body["inReplyTo"] == "<wineops-123@wineops.ai>"
    assert body["references"] == "<a@x> <b@y>"


# ---------------------------------------------------------------------------
# F1b — FAIL CLOSED: no credential means no send
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unset_admin_key_does_not_send_at_all(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is False
    # The point of failing closed: nothing left the process. An unauthenticated
    # attempt would 401 anyway, but it would also be indistinguishable in the
    # logs from a gateway outage.
    assert _FakeSession.calls == []


@pytest.mark.asyncio
async def test_empty_admin_key_is_treated_as_unset(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("ADMIN_API_KEY", "   ")

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is False
    assert _FakeSession.calls == []


@pytest.mark.asyncio
async def test_missing_credential_is_classified_a_DEFINITE_refusal(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    """The classification decides whether a vendor gets a second purchase order.

    Nothing was transmitted, so this is provably not delivered — it must land in
    `_is_definite_send_refusal`'s allow-list, which releases the conversation for
    retry instead of parking it as "the vendor may hold this message".
    """
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)

    result = await composer.send_via_gateway(_payload())

    assert ProviderConversationAgent._is_definite_send_refusal(result["error"])


# ---------------------------------------------------------------------------
# A non-200 must name itself
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_refused_send_reports_the_status_not_unknown_error(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    class _Refusing(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(401, {"statusCode": 401, "message": "Unauthorized"})

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _Refusing)

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is False
    # "Unknown error" is what this returned for the whole outage: the gateway's
    # 401 body has no `error` key, so `result.get("error", "Unknown error")` hid
    # the single most diagnostic fact about the failure.
    assert "401" in result["error"]
    assert result["error"] != "Unknown error"
