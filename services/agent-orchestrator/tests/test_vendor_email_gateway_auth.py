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

import json
from pathlib import Path
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


HOUSE_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa"
PROVIDER_A = "cccccccc-0000-4000-8000-cccccccccccc"
CONVO_A = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee"
ORDER_A = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb"


def _payload(**overrides: Any) -> EmailPayload:
    # ADR 0149 #19: a service send names the house, the vendor and the
    # conversation or order it is for, or it does not leave this process.
    fields: Dict[str, Any] = dict(
        to=["vendor@example.com"],
        subject="Re: your wines",
        body_html="<p>hello</p>",
        body_text="hello",
        reply_to="orders@mudavym.com",
        thread_id="19f365aac4e6",
        in_reply_to="<wineops-123@wineops.ai>",
        references="<a@x> <b@y>",
        restaurant_id=HOUSE_A,
        provider_id=PROVIDER_A,
        conversation_id=CONVO_A,
        order_id=ORDER_A,
    )
    fields.update(overrides)
    return EmailPayload(**fields)


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


# ---------------------------------------------------------------------------
# ADR 0149 #19 — "Two doors, both locked": the service door names what it sends
# ---------------------------------------------------------------------------
#
# The gateway's `POST /communications/email` now refuses (403) a service send
# that does not name the house, the vendor, and the conversation or order, and
# checks every recipient against that vendor's addresses in the house's book
# (apps/api-gateway/src/communications/relay/relay-email.service.ts). These pin
# the caller's half of that contract.

REPO_ROOT = Path(__file__).resolve().parents[3]
GATEWAY_FIXTURE = (
    REPO_ROOT
    / "apps"
    / "api-gateway"
    / "src"
    / "communications"
    / "relay"
    / "orchestrator-send.fixture.json"
)
requires_monorepo = pytest.mark.skipif(
    not GATEWAY_FIXTURE.exists(),
    reason="gateway fixture not present (standalone service checkout)",
)


@pytest.mark.asyncio
async def test_the_request_names_the_house_vendor_conversation_and_order(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    await composer.send_via_gateway(_payload())

    body = _FakeSession.calls[0]["json"]
    assert body["restaurantId"] == HOUSE_A
    assert body["providerId"] == PROVIDER_A
    assert body["conversationId"] == CONVO_A
    assert body["orderId"] == ORDER_A


@pytest.mark.parametrize(
    "overrides, named",
    [
        pytest.param({"restaurant_id": None}, "restaurant_id", id="no-house"),
        pytest.param({"provider_id": None}, "provider_id", id="no-vendor"),
        pytest.param(
            {"conversation_id": None, "order_id": None},
            "conversation_id or order_id",
            id="no-conversation-or-order",
        ),
    ],
)
@pytest.mark.asyncio
async def test_a_send_that_names_nothing_never_leaves_and_is_a_definite_refusal(
    composer: EmailComposerService,
    monkeypatch: pytest.MonkeyPatch,
    overrides: Dict[str, Any],
    named: str,
):
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    result = await composer.send_via_gateway(_payload(**overrides))

    assert result["success"] is False
    assert named in result["error"]
    assert _FakeSession.calls == []
    # Nothing was transmitted, so the conversation is released for retry
    # rather than parked as "the vendor may hold this".
    assert ProviderConversationAgent._is_definite_send_refusal(result["error"])


@pytest.mark.asyncio
async def test_either_the_conversation_or_the_order_is_enough(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    await composer.send_via_gateway(_payload(conversation_id=None))
    await composer.send_via_gateway(_payload(order_id=None))

    assert len(_FakeSession.calls) == 2
    assert "conversationId" not in _FakeSession.calls[0]["json"]
    assert "orderId" not in _FakeSession.calls[1]["json"]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422, 429])
@pytest.mark.asyncio
async def test_a_gateway_refusal_names_the_door_s_sentence(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch, status: int
):
    """A Nest refusal body carries `error` (the bare phrase) AND `message` (the
    sentence). The sentence is the diagnosis, so it is what gets reported.

    [CORRECTED 2026-09-19: whether a relay 4xx counts as a DEFINITE refusal is
    no longer an open fork for 400/401/403/422 — ADR 0099's founder decision
    (lane answers batch 4) split them by code. See
    `test_a_relay_400_403_or_422_is_a_definite_refusal` and
    `test_a_relay_401_stays_ambiguous_and_parks_for_a_person` below for that;
    404 and 429 are untouched and remain genuinely open (see
    `test_a_relay_404_or_429_is_unchanged_and_still_ambiguous`).] This test
    asserts only the sentence, not the classification, across every status the
    relay can answer with."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    sentence = (
        "someone@elsewhere.example is not among that vendor's addresses in "
        "this house's book. Nothing was sent."
    )

    class _Refusing(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(
                status,
                {"statusCode": status, "message": sentence, "error": "Forbidden"},
            )

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _Refusing)

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is False
    assert f"HTTP {status}" in result["error"]
    assert sentence in result["error"]
    # Not the bare phrase: "Forbidden" is what the old reading reported.
    assert not result["error"].endswith("— Forbidden")


@pytest.mark.parametrize("status", [500, 502, 503, 504])
@pytest.mark.asyncio
async def test_a_5xx_stays_ambiguous(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch, status: int
):
    """A 5xx can follow an accepted send or come from a proxy: never proof.

    FAILED before 2026-09-17 for every status here: the composer words it
    "gateway refused the send: HTTP 503 — ...", and "503 " matched the SMTP
    permanent-failure pattern, so a 502 after an accepted send released the
    conversation for a retry — a duplicate vendor mail."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    class _Failing(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(status, {"statusCode": status, "message": "upstream"})

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _Failing)

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is False
    assert not ProviderConversationAgent._is_definite_send_refusal(result["error"])


# ---------------------------------------------------------------------------
# ADR 0099 (locked 2026-09-19, founder decision, lane answers batch 4):
# "relay 4xx = split by code (400/403/422 final, 401 parks)".
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", [400, 403, 422])
@pytest.mark.asyncio
async def test_a_relay_400_403_or_422_is_a_definite_refusal(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch, status: int
):
    """The relay's own structural refusals — a malformed request (400), a
    door refusing what the request names (403), or a guardrail (422) — are
    all decided before any transport exists, so they prove non-delivery, the
    same footing as the SMTP 5xx case above."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    class _Refusing(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(
                status, {"statusCode": status, "message": "refused", "error": "x"}
            )

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _Refusing)

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is False
    assert ProviderConversationAgent._is_definite_send_refusal(result["error"])


# ---------------------------------------------------------------------------
# ADR 0099 (locked 2026-09-19, narrowed 2026-09-21, founder decision): "a
# 400/403/422 relay refusal is FINAL = 'Close, no retry'". `_is_definite_send_
# refusal` above is UNCHANGED by this — it still classifies these three codes
# "definite" — what changed is which function the CALLER (`_handle_
# conversation_approved`) consults first, so the two must never disagree on
# the codes they share.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", [400, 403, 422])
def test_relay_final_refusal_code_matches_400_403_and_422(status: int):
    text = f"gateway refused the send: HTTP {status} — refused"
    assert ProviderConversationAgent._relay_final_refusal_code(text) == str(status)


@pytest.mark.parametrize("status", [401, 404, 429, 500, 503])
def test_relay_final_refusal_code_is_none_for_every_other_code(status: int):
    """401 (ambiguous, parks) and every code the founder's answer did not
    name (404, 429, 5xx) fall through to `_is_definite_send_refusal`
    unchanged — this function must never widen past exactly {400, 403, 422}."""
    text = f"gateway refused the send: HTTP {status} — refused"
    assert ProviderConversationAgent._relay_final_refusal_code(text) is None


@pytest.mark.parametrize(
    "text",
    [
        "",
        None,
        "no email delivery method available: ADMIN_API_KEY is not configured",
        "invalid_grant: Bad Request",
        "550 5.1.1 user unknown",
    ],
)
def test_relay_final_refusal_code_is_none_for_non_relay_shaped_errors(text):
    """Every OTHER definite-refusal shape `_is_definite_send_refusal` already
    recognises (no credential, SMTP 5xx, ...) does not carry the relay's own
    'gateway refused the send: HTTP ...' sentence, so this function must leave
    them alone — they keep going through `_release_send_claim` ('released for
    retry'), not `_close_relay_refused`."""
    assert ProviderConversationAgent._relay_final_refusal_code(text) is None


@pytest.mark.parametrize(
    "text",
    [
        # A 5xx may follow an accepted send. Its detail is the gateway's (or an
        # upstream's) text, which can quote another refusal sentence.
        "gateway refused the send: HTTP 503 — upstream said: "
        "gateway refused the send: HTTP 422 — refused",
        # A 200 `success: false` carries the provider's own error text.
        "gateway refused the send: HTTP 200 — provider error quoting "
        "gateway refused the send: HTTP 403 — refused",
    ],
)
def test_relay_final_refusal_code_reads_only_the_composer_s_own_status(text):
    """Only the status `send_via_gateway` wrote at the FRONT of its sentence
    decides. A relay-final code quoted later, inside the detail, must not close
    a send that may have reached the vendor: RELAY_REFUSED tells the manager
    "not sent", and a resend from there is the duplicate order this classifier
    exists to prevent (last call, 2026-09-21: a mutant that closed on ANY
    quoted 400/403/422 passed all 85 tests before this one)."""
    assert ProviderConversationAgent._relay_final_refusal_code(text) is None


@pytest.mark.asyncio
async def test_a_relay_401_stays_ambiguous_and_parks_for_a_person(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    """Unlike 400/403/422, a 401 means the ORCHESTRATOR's own service key is
    wrong, empty or missing at the gateway — a fixable config problem, not
    proof about whether the vendor got the message — so it is left ambiguous
    on purpose and parks the conversation for a person."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    class _Refusing(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(
                401,
                {
                    "statusCode": 401,
                    "message": "Unauthorized",
                    "error": "Unauthorized",
                },
            )

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _Refusing)

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is False
    assert not ProviderConversationAgent._is_definite_send_refusal(result["error"])


@pytest.mark.parametrize("status", [404, 429])
@pytest.mark.asyncio
async def test_a_relay_404_or_429_is_unchanged_and_still_ambiguous(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch, status: int
):
    """404 and 429 are not part of the founder's 2026-09-19 answer, which named
    only 400/403/422/401 — a regression guard against accidentally widening
    the classifier past what was actually decided, not a new decision of its
    own. Still genuinely open."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    class _Refusing(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(
                status, {"statusCode": status, "message": "refused", "error": "x"}
            )

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _Refusing)

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is False
    assert not ProviderConversationAgent._is_definite_send_refusal(result["error"])


@pytest.mark.parametrize("status", [400, 403, 422])
@pytest.mark.asyncio
async def test_a_relay_400_403_or_422_end_to_end_closes_with_no_retry(
    monkeypatch: pytest.MonkeyPatch, status: int
):
    """End to end through `_handle_conversation_approved`: for each of the
    three relay-final codes, the row CLOSES as RELAY_REFUSED — the claim is
    NOT handed back, and nothing raises to trigger a bus retry.

    [CORRECTED 2026-09-21, founder: superseded the 2026-09-19 "released for
    retry" behaviour this test asserted before ("relay 4xx = split by code")
    — "a 400/403/422 relay refusal is FINAL = 'Close, no retry'"."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    class _Refusing(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(
                status, {"statusCode": status, "message": "refused", "error": "x"}
            )

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _Refusing)
    agent = _approved_agent(_approved_conversation())

    # No raise — closing is quiet, it never triggers a bus retry.
    await agent._handle_conversation_approved({"conversation_id": CONVO_A})

    assert agent.database.supabase.conversation["status"] == "RELAY_REFUSED"
    reason = agent.database.supabase.conversation["relay_refusal_reason"]
    assert f"HTTP {status}" in reason
    assert "refused" in reason


@pytest.mark.asyncio
async def test_a_relay_401_end_to_end_parks_for_a_person(
    monkeypatch: pytest.MonkeyPatch,
):
    """End to end: a 401 does NOT raise — it parks the conversation as
    SEND_UNCONFIRMED for a person to reconcile, same as any other ambiguous
    failure, and never a duplicate purchase order."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    class _Refusing(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(
                401,
                {
                    "statusCode": 401,
                    "message": "Unauthorized",
                    "error": "Unauthorized",
                },
            )

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _Refusing)
    agent = _approved_agent(_approved_conversation())

    await agent._handle_conversation_approved({"conversation_id": CONVO_A})

    assert agent.database.supabase.conversation["status"] == "SEND_UNCONFIRMED"


@pytest.mark.asyncio
async def test_a_provider_failure_behind_a_200_reports_the_provider_s_error(
    composer: EmailComposerService, monkeypatch: pytest.MonkeyPatch
):
    """The relay calls the provider and answers 200 with `success: false` and the
    provider's words in `error`; that is what the caller must report."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    class _ProviderFailed(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(
                200,
                {
                    "success": False,
                    "error": "Gmail API quota exceeded",
                    "channel": "email",
                    "door": "orchestrator",
                },
            )

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _ProviderFailed)

    result = await composer.send_via_gateway(_payload())

    assert result["success"] is False
    assert "Gmail API quota exceeded" in result["error"]
    assert not ProviderConversationAgent._is_definite_send_refusal(result["error"])


# ---------------------------------------------------------------------------
# End to end on the orchestrator's side: an approved vendor mail, from the
# approval event to the bytes put on the wire, against the body the gateway's
# doors spec posts (relay-email.doors.spec.ts "sends the orchestrator's vendor
# mail end to end").
# ---------------------------------------------------------------------------


class _Result:
    def __init__(self, data: Any):
        self.data = data


class _Table:
    """Just enough PostgREST for `_handle_conversation_approved`: the draft read,
    the provider and order reads, the threading history, and the status writes."""

    def __init__(self, db: "_Db", name: str):
        self.db, self.name = db, name
        self.op: Optional[str] = None
        self.payload: Optional[Dict[str, Any]] = None
        self.filters: Dict[str, Any] = {}
        self.is_single = False
        self.is_list = False

    def select(self, *_a: Any, **_k: Any) -> "_Table":
        self.op = "select"
        return self

    def update(self, payload: Dict[str, Any]) -> "_Table":
        self.op, self.payload = "update", payload
        return self

    def eq(self, column: str, value: Any) -> "_Table":
        self.filters[column] = value
        return self

    def or_(self, *_a: Any, **_k: Any) -> "_Table":
        return self

    def order(self, *_a: Any, **_k: Any) -> "_Table":
        self.is_list = True
        return self

    def limit(self, *_a: Any, **_k: Any) -> "_Table":
        self.is_list = True
        return self

    def single(self) -> "_Table":
        self.is_single = True
        return self

    def execute(self) -> _Result:
        row = self.db.conversation
        if self.op == "update":
            if self.name == "procurement_conversations":
                expected = self.filters.get("status")
                if expected is not None and row.get("status") != expected:
                    return _Result([])
                row.update(self.payload or {})
                return _Result([dict(row)])
            return _Result([{}])
        if self.name == "procurement_conversations":
            return _Result(self.db.history if self.is_list else dict(row))
        if self.name == "providers":
            return _Result(self.db.provider)
        if self.name == "procurement_orders":
            return _Result(self.db.order)
        return _Result({})


class _Db:
    def __init__(self, conversation: Dict[str, Any]):
        self.conversation = conversation
        self.provider = {
            "name": "Vendor One",
            "primary_contact": {"name": "Ana", "email": "orders@vendor-one.example"},
        }
        self.order = {
            "id": ORDER_A,
            "wine_name": "Barolo 2019",
            "quantity": 12,
            "target_price_per_bottle": 40,
        }
        self.history = [
            {
                "direction": "inbound",
                "email_headers": {
                    "gmail_thread_id": "19f365aac4e6",
                    "message_id": "<wineops-123@wineops.ai>",
                },
            }
        ]

    def table(self, name: str) -> _Table:
        return _Table(self, name)


def _approved_agent(conversation: Dict[str, Any]) -> ProviderConversationAgent:
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    agent = object.__new__(ProviderConversationAgent)
    agent.logger = MagicMock()
    agent.database = SimpleNamespace(supabase=_Db(conversation))
    agent._active_sessions = {}
    agent.email_composer = EmailComposerService(
        database=None,
        config={"api_gateway_url": "http://gw:3001", "mock_mode": True},
    )
    return agent


def _approved_conversation(**overrides: Any) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "id": CONVO_A,
        "restaurant_id": HOUSE_A,
        "provider_id": PROVIDER_A,
        "order_id": ORDER_A,
        "message_text": "Could you quote 12 bottles?",
        "channel": "email",
        "status": "PENDING_APPROVAL",
        "message_id": None,
        "conversation_context": {},
    }
    row.update(overrides)
    return row


@requires_monorepo
@pytest.mark.asyncio
async def test_an_approved_vendor_mail_posts_exactly_the_body_the_gateway_admits(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")
    fixture = json.loads(GATEWAY_FIXTURE.read_text(encoding="utf-8"))
    agent = _approved_agent(_approved_conversation())

    await agent._handle_conversation_approved({"conversation_id": CONVO_A})

    assert len(_FakeSession.calls) == 1
    call = _FakeSession.calls[0]
    assert call["url"] == "http://gw:3001/communications/email"
    assert call["headers"].get("X-Admin-Key") == "s3cret-value"

    body = call["json"]
    # The same keys, so a field renamed on either side breaks one of the two
    # tests; and the same values for everything the gateway checks.
    assert sorted(body) == sorted(fixture)
    for key in fixture:
        if key == "bodyHtml":
            continue
        assert body[key] == fixture[key], key
    assert "Could you quote 12 bottles?" in body["bodyHtml"]

    # And the send was recorded as sent.
    assert agent.database.supabase.conversation["status"] == "SENT"


@pytest.mark.asyncio
async def test_a_door_refusal_is_never_recorded_as_sent_and_its_sentence_is_logged(
    monkeypatch: pytest.MonkeyPatch,
):
    """[CORRECTED 2026-09-19: a 403 is a DEFINITE refusal (ADR 0099, founder
    decision, lane answers batch 4) — it released the claim and raised.]
    [CORRECTED 2026-09-21: the founder narrowed that — a relay 403 is
    RELAY-FINAL ("Close, no retry"), so it now CLOSES the row as
    RELAY_REFUSED, carrying the gateway's own sentence, and does NOT raise
    (a raise is what would make the bus retry a request that would only be
    refused again).]"""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")

    import services.email_composer_service as mod

    class _Refusing(_FakeSession):
        def post(self, url: str, **kw: Any) -> _FakeResponse:  # type: ignore[override]
            _FakeSession.calls.append({"url": url, **kw})
            return _FakeResponse(
                403,
                {
                    "statusCode": 403,
                    "message": "Conversation is not one of this house's conversations. Nothing was sent.",
                    "error": "Forbidden",
                },
            )

    monkeypatch.setattr(mod.aiohttp, "ClientSession", _Refusing)
    agent = _approved_agent(_approved_conversation())

    # No raise: a relay-final refusal closes quietly, it does not retry.
    await agent._handle_conversation_approved({"conversation_id": CONVO_A})

    assert len(_FakeSession.calls) == 1
    assert agent.database.supabase.conversation["status"] != "SENT"
    # Relay-final refusal: CLOSED, not handed back and not left PENDING_APPROVAL.
    assert agent.database.supabase.conversation["status"] == "RELAY_REFUSED"
    reason = agent.database.supabase.conversation["relay_refusal_reason"]
    assert "HTTP 403" in reason
    assert "not one of this house's conversations" in reason


@pytest.mark.asyncio
async def test_an_approved_conversation_whose_row_names_no_house_never_leaves(
    monkeypatch: pytest.MonkeyPatch,
):
    """`procurement_conversations.restaurant_id` is NOT NULL, so this is the
    belt to that brace: without a house, nothing is transmitted, and because
    nothing was, the claim is released rather than parked."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")
    agent = _approved_agent(_approved_conversation(restaurant_id=None))

    with pytest.raises(RuntimeError, match="released for retry"):
        await agent._handle_conversation_approved({"conversation_id": CONVO_A})

    assert _FakeSession.calls == []
    assert agent.database.supabase.conversation["status"] == "PENDING_APPROVAL"


@pytest.mark.asyncio
async def test_a_subject_line_break_from_database_text_is_collapsed_before_sending(
    monkeypatch: pytest.MonkeyPatch,
):
    """The gateway refuses a subject with a line break (it would add a MIME
    header). A wine name is database text, so the caller flattens it rather
    than have an approved vendor mail refused for a stray newline."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")
    agent = _approved_agent(_approved_conversation())
    agent.database.supabase.order = {
        "id": ORDER_A,
        "wine_name": "Barolo\r\nBcc: someone@elsewhere.example",
    }

    await agent._handle_conversation_approved({"conversation_id": CONVO_A})

    subject = _FakeSession.calls[0]["json"]["subject"]
    assert "\r" not in subject and "\n" not in subject
    assert subject == "Regarding Barolo Bcc: someone@elsewhere.example — Vendor One"


# ---------------------------------------------------------------------------
# The scarcity auto-hold says what happened
# ---------------------------------------------------------------------------


def _scarcity_agent() -> ProviderConversationAgent:
    from unittest.mock import AsyncMock

    agent = _approved_agent(_approved_conversation())
    agent.config = {}
    agent.publish = AsyncMock()
    return agent


def _published_notification(agent: ProviderConversationAgent) -> Dict[str, Any]:
    assert agent.publish.await_count == 1
    return agent.publish.await_args.kwargs["message_body"]["payload"]


@pytest.mark.asyncio
async def test_an_auto_hold_with_a_matched_order_is_sent_and_says_so(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")
    agent = _scarcity_agent()

    await agent._handle_scarcity_auto_reply(
        {
            "provider_id": PROVIDER_A,
            "restaurant_id": HOUSE_A,
            "order_id": ORDER_A,
            "wine_name": "Barolo 2019",
        }
    )

    assert len(_FakeSession.calls) == 1
    body = _FakeSession.calls[0]["json"]
    assert body["restaurantId"] == HOUSE_A
    assert body["orderId"] == ORDER_A
    assert "conversationId" not in body
    note = _published_notification(agent)
    assert note["title"] == "Auto-hold sent: Barolo 2019"
    assert note["auto_reply_sent_ok"] is True


@pytest.mark.asyncio
async def test_an_auto_hold_with_no_order_is_not_sent_and_the_notice_says_so(
    monkeypatch: pytest.MonkeyPatch,
):
    """It used to say "An automatic hold request was sent" whatever the send
    returned. A hold that names no order is refused before it leaves, and the
    manager is told that, with the reason."""
    monkeypatch.setenv("ADMIN_API_KEY", "s3cret-value")
    agent = _scarcity_agent()

    await agent._handle_scarcity_auto_reply(
        {
            "provider_id": PROVIDER_A,
            "restaurant_id": HOUSE_A,
            "wine_name": "Barolo 2019",
        }
    )

    assert _FakeSession.calls == []
    note = _published_notification(agent)
    assert note["title"] == "Auto-hold NOT sent: Barolo 2019"
    assert "No hold request was sent" in note["message"]
    assert "conversation_id or order_id" in note["message"]
    assert note["auto_reply_sent"] is None
    assert note["auto_reply_sent_ok"] is False


# ---------------------------------------------------------------------------
# 2026-09-17, ADR 0149 #19 review — the vendor HTML escapes the approved text
# ---------------------------------------------------------------------------


def test_the_vendor_html_escapes_the_approved_text_and_the_order_reference(
    composer: EmailComposerService,
):
    html = composer._wrap_html(
        'Hello <b>Ana</b> & team,\n<a href="https://elsewhere.example">x</a>\n\nThanks',
        {"order_number": "<img src=x onerror=alert(1)>"},
    )

    assert "<b>" not in html
    assert "<a href" not in html
    assert "<img" not in html
    assert "Hello &lt;b&gt;Ana&lt;/b&gt; &amp; team,<br/>&lt;a href=" in html
    assert "Ref: &lt;img src=x onerror=alert(1)&gt;" in html
    # Paragraphs and line breaks are still the composer's own markup.
    assert html.count('<p style="margin: 0 0 12px; line-height: 1.6;">') == 2
