"""
The error tracker must never learn who a person is (Python runtime).

Mirrors apps/web/src/__tests__/lib/error-tracking-pii.test.ts and
apps/api-gateway/src/common/error-tracking/sentry-pii.spec.ts. The three
runtimes are tested separately on purpose: they hold three copies of one rule
with no shared module, and scripts/check_sentry_pii_scope.py fails the build if
those copies drift. A single shared test would hide exactly that drift.
"""

import json
import logging
from unittest.mock import patch

import pytest

from utils.sentry_client import (
    PII_KEYS,
    PII_USER_KEYS,
    SENSITIVE_HEADERS,
    SentryClient,
    scrub_sentry_event,
    scrub_text,
)


class TestScrubSentryEvent:
    def test_strips_identity_but_keeps_opaque_ids(self):
        event = scrub_sentry_event(
            {
                "user": {
                    "id": "user-1",
                    "email": "chef@restaurant.example",
                    "username": "Ada Chef",
                    "ip_address": "203.0.113.4",
                    "restaurant_id": "rest-1",
                }
            }
        )
        assert event["user"] == {"id": "user-1", "restaurant_id": "rest-1"}

    @pytest.mark.parametrize("header", SENSITIVE_HEADERS)
    def test_removes_each_credential_header(self, header):
        event = scrub_sentry_event(
            {"request": {"headers": {header: "secret", "user-agent": "pytest"}}}
        )
        assert event["request"]["headers"] == {"user-agent": "pytest"}

    def test_removes_credential_headers_whatever_the_casing(self):
        # WSGI/ASGI servers disagree about header casing; a case-sensitive pop
        # is the classic way a scrubber silently stops scrubbing.
        event = scrub_sentry_event(
            {"request": {"headers": {"Authorization": "Bearer x", "Cookie": "s=1"}}}
        )
        assert event["request"]["headers"] == {}

    def test_removes_cookies(self):
        event = scrub_sentry_event({"request": {"cookies": {"session": "abc"}}})
        assert "cookies" not in event["request"]

    def test_strips_identity_from_extra_request_body_and_contexts(self):
        # The TypeScript scrubbers always did this; the Python one did not,
        # which made three "identical" scrubbers three different rules.
        event = scrub_sentry_event(
            {
                "extra": {
                    "email": "chef@restaurant.example",
                    "phone": "555-0100",
                    "order_id": "ord-9",
                },
                "request": {
                    "data": {"name": "Ada Chef", "password": "hunter2", "note": "keep"}
                },
                "contexts": {
                    "order": {"total": 42},
                    "account": {
                        "first_name": "Ada",
                        "last_name": "Chef",
                        "plan": "pro",
                    },
                },
            }
        )
        assert event["extra"] == {"order_id": "ord-9"}
        # Dropped whole, not key-scrubbed. PR #427 round 5.
        assert "data" not in event["request"]
        assert event["contexts"]["order"] == {"total": 42}
        assert event["contexts"]["account"] == {"plan": "pro"}

    @pytest.mark.parametrize("key", PII_KEYS)
    def test_removes_each_pii_key_from_extra(self, key):
        event = scrub_sentry_event({"extra": {key: "sensitive", "kept": "yes"}})
        assert event["extra"] == {"kept": "yes"}

    def test_removes_pii_keys_whatever_the_casing(self):
        event = scrub_sentry_event({"extra": {"Email": "chef@restaurant.example"}})
        assert event["extra"] == {}

    def test_survives_non_dict_free_form_containers(self):
        # `extra` and a context are caller-assembled; nothing types them.
        event = scrub_sentry_event(
            {"extra": "not-a-dict", "contexts": {"trace": None}, "request": {"data": 7}}
        )
        assert event["extra"] == "not-a-dict"

    def test_accepts_the_hint_sentry_always_passes(self):
        assert scrub_sentry_event({"user": {"id": "u"}}, {"exc_info": None}) is not None

    def test_leaves_an_event_with_nothing_to_scrub_untouched(self):
        event = scrub_sentry_event({"message": "boom", "extra": {"order_id": "ord-9"}})
        assert event == {"message": "boom", "extra": {"order_id": "ord-9"}}

    def test_survives_a_malformed_event(self):
        # before_send raising would drop the event entirely and hide the error
        # it was reporting, so every branch is type-guarded.
        assert scrub_sentry_event({"request": "not-a-dict", "user": None}) is not None


class TestSetUser:
    def test_forwards_only_opaque_identifiers(self):
        client = SentryClient()
        client._initialized = True
        with patch("utils.sentry_client.sentry_sdk") as sdk:
            client.set_user("user-1", restaurant_id="rest-1")
        sdk.set_user.assert_called_once_with(
            {"id": "user-1", "restaurant_id": "rest-1"}
        )

    def test_no_longer_accepts_an_email_argument(self):
        # The parameters are gone rather than ignored: a signature that accepts
        # an email is an invitation to pass one, and send_default_pii=False
        # does not cover anything set explicitly through set_user().
        client = SentryClient()
        client._initialized = True
        with patch("utils.sentry_client.sentry_sdk"):
            with pytest.raises(TypeError):
                client.set_user("user-1", email="chef@restaurant.example")


def test_scrub_lists_match_the_typescript_runtimes():
    """
    Canonical lists, kept identical in three places by
    scripts/check_sentry_pii_scope.py. Asserted here as well so a one-sided
    edit fails the unit suite too, not only the guard.
    """
    assert PII_USER_KEYS == ("email", "username", "name", "ip_address")
    assert sorted(PII_KEYS) == [
        "address",
        "email",
        "first_name",
        "ip_address",
        "last_name",
        "name",
        "password",
        "phone",
        "phone_number",
        "ssn",
        "username",
    ]
    assert sorted(SENSITIVE_HEADERS) == [
        "authorization",
        "cookie",
        "proxy-authorization",
        "x-api-key",
    ]


@pytest.mark.parametrize(
    "raw,want",
    [
        (
            "https://mudavym.com/reset-password?token=abc",
            "https://mudavym.com/reset-password",
        ),
        (
            "https://mudavym.com/verify-email?token=abc",
            "https://mudavym.com/verify-email",
        ),
        ("https://mudavym.com/x?a=1&token=abc&b=2", "https://mudavym.com/x"),
        (
            "https://mudavym.com/reset-password#token=abc",
            "https://mudavym.com/reset-password",
        ),
        ("https://mudavym.com/invite/SECRET", "https://mudavym.com/invite/<redacted>"),
        (
            "https://mudavym.com/studio/invite/S",
            "https://mudavym.com/studio/invite/<redacted>",
        ),
        # the @Public() iCal feed: a tenant-wide, never-expiring bearer. PR #427's
        # own security audit BLOCKED the first version of this fix for missing it.
        ("/api/v1/calendar/feed/9f3c1a.ics", "/api/v1/calendar/feed/<redacted>"),
        (
            "/api/v1/recommendations/digest/unsubscribe/TOK",
            "/api/v1/recommendations/digest/unsubscribe/<redacted>",
        ),
        # only ONE segment goes, so the route stays legible to an on-call
        ("/api/v1/auth/invite/CODE/accept", "/api/v1/auth/invite/<redacted>/accept"),
        ("/invite/SECRET?x=1", "/invite/<redacted>"),
        ("https://mudavym.com/orders", "https://mudavym.com/orders"),
        ("/", "/"),
        ("", ""),
    ],
)
def test_scrub_url_keeps_origin_and_path_only(raw, want):
    """Founder ruling 2026-09-21: strip the query entirely, redact a path-borne token."""
    from utils.sentry_client import scrub_url

    assert scrub_url(raw) == want


def test_scrub_sentry_event_applies_it():
    from utils.sentry_client import scrub_sentry_event

    event = {"request": {"url": "https://mudavym.com/reset-password?token=SECRET"}}
    scrub_sentry_event(event)
    assert event["request"]["url"] == "https://mudavym.com/reset-password"
    assert "SECRET" not in repr(event)


def test_scrub_url_never_raises():
    """It runs inside before_send on an error path; it must not add a second failure."""
    from utils.sentry_client import scrub_url

    for raw in ("http://[::1", "%%%", "?", "#"):
        scrub_url(raw)


def test_a_non_string_url_is_left_alone():
    from utils.sentry_client import scrub_sentry_event

    event = {"request": {"url": 42}}
    scrub_sentry_event(event)
    assert event["request"]["url"] == 42


def test_query_string_is_dropped_because_asgi_puts_the_query_there():
    """In the ASGI integration `url` is built WITHOUT the querystring
    (_asgi_common._get_url), so scrubbing only `url` was a no-op for the thing
    this fix is named after. Found by PR #427's security audit."""
    from utils.sentry_client import scrub_sentry_event

    event = {"request": {"url": "/reset-password", "query_string": "token=SECRET"}}
    scrub_sentry_event(event)
    assert "query_string" not in event["request"]
    assert "SECRET" not in repr(event)


# PR #427's round-2 audit found request["url"]/query_string being clean was not
# enough: the OpenTelemetry-shaped integrations Sentry's own SDK ships keep a
# separate copy of the URL in contexts["trace"]["data"] and each span's own
# "data", and event["transaction"] is the raw path too -- none of it reached by
# _scrub_pii_keys's key-name pass over contexts. Shapes mirror the JS SDKs'
# real event/span/context types (types-hoist/{event,context,span}.d.ts), not a
# hand-picked literal, so the three runtimes are exercised the same way.


def test_scrubs_transaction_name_and_trace_data_calendar_feed_token():
    from utils.sentry_client import scrub_sentry_event

    event = {
        "request": {"url": "/api/v1/calendar/feed/<redacted>"},  # already fixed
        "transaction": "GET /api/v1/calendar/feed/SECRETTOKEN.ics",
        "contexts": {
            "trace": {
                "span_id": "abc123",
                "trace_id": "def456",
                "data": {
                    "url": "http://mudavym.com/api/v1/calendar/feed/SECRETTOKEN.ics",
                    "http.url": "http://mudavym.com/api/v1/calendar/feed/SECRETTOKEN.ics",
                    "http.target": "/api/v1/calendar/feed/SECRETTOKEN.ics",
                },
            }
        },
    }
    scrub_sentry_event(event)
    assert event["transaction"] == "GET /api/v1/calendar/feed/<redacted>"
    assert (
        event["contexts"]["trace"]["data"]["url"]
        == "http://mudavym.com/api/v1/calendar/feed/<redacted>"
    )
    assert (
        event["contexts"]["trace"]["data"]["http.target"]
        == "/api/v1/calendar/feed/<redacted>"
    )
    assert "SECRETTOKEN" not in repr(event)


def test_deletes_trace_data_http_query_inbound_webhook_secret():
    from utils.sentry_client import scrub_sentry_event

    event = {
        "contexts": {
            "trace": {
                "span_id": "abc123",
                "trace_id": "def456",
                "data": {
                    "http.url": "http://mudavym.com/api/v1/inbound-email?secret=SECRET",
                    "http.query": "secret=SECRET",
                },
            }
        }
    }
    scrub_sentry_event(event)
    assert "http.query" not in event["contexts"]["trace"]["data"]
    assert (
        event["contexts"]["trace"]["data"]["http.url"]
        == "http://mudavym.com/api/v1/inbound-email"
    )
    assert "SECRET" not in repr(event)


def test_scrubs_every_spans_own_data():
    from utils.sentry_client import scrub_sentry_event

    event = {
        "spans": [
            {
                "span_id": "s1",
                "trace_id": "t1",
                "data": {"http.url": "https://mudavym.com/invite/SECRETCODE"},
            },
            {
                "span_id": "s2",
                "trace_id": "t1",
                "data": {"http.query": "secret=SECRET"},
            },
        ]
    }
    scrub_sentry_event(event)
    assert (
        event["spans"][0]["data"]["http.url"] == "https://mudavym.com/invite/<redacted>"
    )
    assert "http.query" not in event["spans"][1]["data"]
    assert "SECRET" not in repr(event)


def test_no_trace_context_does_not_raise():
    from utils.sentry_client import scrub_sentry_event

    event = {"request": {"url": "/orders"}}
    scrub_sentry_event(event)
    assert "contexts" not in event


# ---------------------------------------------------------------------------
# PR #427 round 3 (2026-09-25): every token-bearing route, in every container
# an event can carry a URL in. Mirrors the two TypeScript tables on purpose.
# The assertion is on the WHOLE serialized event, so a container nobody named
# still fails the test if it carries the token.
# ---------------------------------------------------------------------------

REAL_TOKENS = {
    "reset": "pkce_e1f3a5c7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7",
    "verify": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZXJpZnkifQ.Zk3pQ7rT9vX1bD5fH8jL2nP4sU6wY0aC",
    "invite": "k7Qm2VxP9rTzL4nW",
    "studio": "3f9c2a7e-5b1d-4e8f-a6c0-9d2b7e4f1a3c",
    "feed": "9f2c4e6a8b0d1f3e5a7c9b1d3f5e7a9c0b2d4f6e8a0c2e4f6a8b0d2f4e6a8c0b",
    "unsubscribe": "u5b1e0c8f2a4d6b9e3c7f1a5d8b2e6c0f",
    "device": "ExponentPushToken[xk8S2LmQ0pZr7Tn4Yv1WcA]",
    "oauth": "4/0AanRRrs8Hq2ZtX9pL4mKw7",
    "inbound": "whsec_3JfK8mQ2pL9vX5tR",
}
_API = "https://api.mudavym.com/api/v1"
TOKEN_ROUTES = [
    (
        f"https://mudavym.com/reset-password?token={REAL_TOKENS['reset']}&type=recovery",
        REAL_TOKENS["reset"],
    ),
    (f"{_API}/auth/verify-email?token={REAL_TOKENS['verify']}", REAL_TOKENS["verify"]),
    (f"{_API}/auth/invite/{REAL_TOKENS['invite']}/accept", REAL_TOKENS["invite"]),
    (f"{_API}/restaurants/r1/invites/{REAL_TOKENS['invite']}", REAL_TOKENS["invite"]),
    (
        f"https://mudavym.com/studio/invite/{REAL_TOKENS['studio']}",
        REAL_TOKENS["studio"],
    ),
    (f"{_API}/calendar/feed/{REAL_TOKENS['feed']}.ics", REAL_TOKENS["feed"]),
    (
        f"{_API}/analytics/digest/unsubscribe/{REAL_TOKENS['unsubscribe']}",
        REAL_TOKENS["unsubscribe"],
    ),
    (f"{_API}/mobile/devices/{REAL_TOKENS['device']}", REAL_TOKENS["device"]),
    (
        f"{_API}/integrations/oauth/google/callback?code={REAL_TOKENS['oauth']}&state=s1",
        REAL_TOKENS["oauth"],
    ),
    (f"{_API}/inbound-email?secret={REAL_TOKENS['inbound']}", REAL_TOKENS["inbound"]),
    # api/studio_routes.py looks a studio invite up BY its token, so supabase-py
    # (httpx) puts it in an outgoing query -- the Python runtime's own vector.
    (
        f"https://ref.supabase.co/rest/v1/studio_invites?select=%2A&token=eq.{REAL_TOKENS['studio']}",
        REAL_TOKENS["studio"],
    ),
]


def _event_carrying(url, token):
    path = url.split("://", 1)[1]
    path = path[path.find("/") :]
    bare, _, query = url.partition("?")
    return {
        "message": f"failed at {url}",
        "transaction": f"GET {path}",
        "request": {
            "url": url,
            "query_string": query,
            "headers": {"Referer": url, "User-Agent": "ua"},
        },
        "breadcrumbs": {
            "values": [
                {
                    "type": "http",
                    "category": "httplib",
                    "data": {
                        "url": bare,
                        "http.method": "GET",
                        "http.query": query,
                        "http.fragment": f"access_token={token}",
                    },
                },
                {
                    "type": "log",
                    "category": "httpx",
                    "message": f'HTTP Request: GET {url} "HTTP/1.1 200 OK"',
                    "data": {},
                },
            ]
        },
        "logentry": {
            "message": "lookup failed for %s",
            "params": [url],
            "formatted": f"lookup failed for {url}",
        },
        "exception": {
            "values": [
                {
                    "type": "HTTPStatusError",
                    "value": f"Client error '404 Not Found' for url '{url}'",
                    "stacktrace": {
                        "frames": [
                            {
                                "filename": url,
                                "abs_path": url,
                                "vars": {"request": f"<Request('GET', '{url}')>"},
                            }
                        ]
                    },
                }
            ]
        },
        "contexts": {"trace": {"data": {"url": url, "http.url": url}}},
        "spans": [{"data": {"url.full": url}}],
    }


@pytest.mark.parametrize("url,token", TOKEN_ROUTES)
def test_round3_every_token_route_reaches_no_container(url, token):
    scrubbed = scrub_sentry_event(_event_carrying(url, token))
    assert token not in json.dumps(scrubbed)


def test_round3_keeps_what_triage_needs():
    url = f"{_API}/calendar/feed/{REAL_TOKENS['feed']}.ics"
    event = scrub_sentry_event(_event_carrying(url, REAL_TOKENS["feed"]))
    assert event["request"]["headers"]["Referer"] == f"{_API}/calendar/feed/<redacted>"
    assert event["request"]["headers"]["User-Agent"] == "ua"
    crumb = event["breadcrumbs"]["values"][0]["data"]
    assert "http.query" not in crumb and "http.fragment" not in crumb
    assert event["transaction"] == "GET /api/v1/calendar/feed/<redacted>"


def test_round3_scrub_text_leaves_ordinary_text_alone():
    plain = "Cannot read 'id' of None -- why? #3 in /orders/42"
    assert scrub_text(plain) == plain


def test_round3_filesystem_frame_paths_are_left_alone():
    event = {
        "exception": {
            "values": [
                {
                    "value": "x",
                    "stacktrace": {
                        "frames": [
                            {"abs_path": "/app/agents/mobile/devices/registry.py"}
                        ]
                    },
                }
            ]
        }
    }
    scrub_sentry_event(event)
    frame = event["exception"]["values"][0]["stacktrace"]["frames"][0]
    assert frame["abs_path"] == "/app/agents/mobile/devices/registry.py"


# ---------------------------------------------------------------------------
# On the WIRE, through the real sentry_sdk client and its own logging handlers.
#
# PR #427's round-2 audit found the leak in fields the SDK attaches that no
# hand-built fixture held. Here sentry_sdk builds the breadcrumb (its own
# BreadcrumbHandler, fed httpx's real INFO log line), the log event (its own
# EventHandler), and the exception (a real httpx.HTTPStatusError, with the
# frame locals include_local_variables attaches by default), and the assertion
# is on the serialized envelope bytes. This test is what found frames[].vars.
# ---------------------------------------------------------------------------


def _wire_client(include_local_variables=True):
    sentry_sdk = pytest.importorskip("sentry_sdk")
    from sentry_sdk.transport import Transport

    class _Capture(Transport):
        def __init__(self, options=None):
            super().__init__(options)
            self.sent = []

        def capture_envelope(self, envelope):
            self.sent.append(envelope.serialize().decode("utf-8", "replace"))

    client = sentry_sdk.Client(
        dsn="https://public@example.test/1",
        transport=_Capture,
        default_integrations=False,
        integrations=[],
        send_default_pii=False,
        # Explicit, not just the SDK default, so a test that passes False here
        # is actually exercising the same knob production sets in main.py and
        # sentry_client.py -- not relying on whatever the SDK ships as default.
        include_local_variables=include_local_variables,
        before_send=scrub_sentry_event,
        before_send_transaction=scrub_sentry_event,
    )
    return sentry_sdk, client


def test_round3_on_the_wire_no_token_leaves_through_the_real_sdk():
    httpx = pytest.importorskip("httpx")
    sentry_sdk, client = _wire_client()
    from sentry_sdk.integrations.logging import BreadcrumbHandler, EventHandler

    token = REAL_TOKENS["studio"]
    url = f"https://ref.supabase.co/rest/v1/studio_invites?select=%2A&token=eq.{token}"
    with sentry_sdk.isolation_scope() as isolation:
        isolation.set_client(client)
        with sentry_sdk.new_scope() as scope:
            scope.set_client(client)
            # httpx's own INFO line, exactly as httpx._client logs it.
            BreadcrumbHandler().handle(
                logging.LogRecord(
                    "httpx",
                    logging.INFO,
                    __file__,
                    1,
                    'HTTP Request: %s %s "%s %d %s"',
                    ("GET", httpx.URL(url), "HTTP/1.1", 404, "Not Found"),
                    None,
                )
            )
            EventHandler().handle(
                logging.LogRecord(
                    "api.studio_routes",
                    logging.ERROR,
                    __file__,
                    2,
                    "studio invite lookup failed for %s",
                    (url,),
                    None,
                )
            )
            try:
                httpx.Response(
                    404, request=httpx.Request("GET", url)
                ).raise_for_status()
            except httpx.HTTPStatusError:
                sentry_sdk.capture_exception()
    client.flush(2)

    wire = "\n".join(client.transport.sent)
    assert len(client.transport.sent) == 2
    assert "studio_invites" in wire
    assert token not in wire


def test_round3_on_the_wire_without_the_scrubber_the_token_does_leave():
    """The control: the same wire test with before_send disabled MUST leak, or
    the test above proves nothing about the scrubber."""
    httpx = pytest.importorskip("httpx")
    sentry_sdk, client = _wire_client()
    client.options["before_send"] = None
    token = REAL_TOKENS["studio"]
    url = f"https://ref.supabase.co/rest/v1/studio_invites?select=%2A&token=eq.{token}"
    with sentry_sdk.isolation_scope() as isolation:
        isolation.set_client(client)
        with sentry_sdk.new_scope() as scope:
            scope.set_client(client)
            try:
                httpx.Response(
                    404, request=httpx.Request("GET", url)
                ).raise_for_status()
            except httpx.HTTPStatusError:
                sentry_sdk.capture_exception()
    client.flush(2)
    assert token in "\n".join(client.transport.sent)


def test_round3_frame_locals_disabled_a_bare_token_no_longer_leaves():
    """CLOSED (PR #427 round 3, founder 2026-09-25: "stop sending locals").

    A frame local whose repr holds a BARE token -- no URL around it, e.g. a
    request body model -- is not URL-shaped, so scrub_text alone cannot see
    it (see the fixture-level proof this replaced, in git history at this
    test's old name). The fix is not a smarter scrubber: it is
    include_local_variables=False at both sentry_sdk.init() sites (main.py,
    sentry_client.py), so the SDK never attaches `vars` to a frame at all.
    This drives a real exception through the real SDK -- not a hand-built
    event fixture -- so it proves the init option, not just scrub_text.
    """
    sentry_sdk, client = _wire_client(include_local_variables=False)
    token = REAL_TOKENS["studio"]

    with sentry_sdk.isolation_scope() as isolation:
        isolation.set_client(client)
        with sentry_sdk.new_scope() as scope:
            scope.set_client(client)
            try:
                body = f"AcceptStudioInvite(token='{token}')"  # noqa: F841 (captured as a frame local)
                raise ValueError("boom")
            except ValueError:
                sentry_sdk.capture_exception()
    client.flush(2)

    wire = "\n".join(client.transport.sent)
    assert token not in wire


def test_round3_frame_locals_enabled_the_bare_token_does_leave():
    """Mutation companion to the test above: flip include_local_variables back
    to True (the SDK default) and the same bare-token scenario must leak --
    proving the passing test above is actually pinned to the init option, and
    not a no-op that would pass regardless of it (CLAUDE.md: 'a NO-OP mutation
    is a failed test')."""
    sentry_sdk, client = _wire_client(include_local_variables=True)
    token = REAL_TOKENS["studio"]

    with sentry_sdk.isolation_scope() as isolation:
        isolation.set_client(client)
        with sentry_sdk.new_scope() as scope:
            scope.set_client(client)
            try:
                body = f"AcceptStudioInvite(token='{token}')"  # noqa: F841 (captured as a frame local)
                raise ValueError("boom")
            except ValueError:
                sentry_sdk.capture_exception()
    client.flush(2)

    wire = "\n".join(client.transport.sent)
    assert token in wire
