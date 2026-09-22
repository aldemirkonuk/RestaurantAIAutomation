"""
The error tracker must never learn who a person is (Python runtime).

Mirrors apps/web/src/__tests__/lib/error-tracking-pii.test.ts and
apps/api-gateway/src/common/error-tracking/sentry-pii.spec.ts. The three
runtimes are tested separately on purpose: they hold three copies of one rule
with no shared module, and scripts/check_sentry_pii_scope.py fails the build if
those copies drift. A single shared test would hide exactly that drift.
"""

from unittest.mock import patch

import pytest

from utils.sentry_client import (
    PII_KEYS,
    PII_USER_KEYS,
    SENSITIVE_HEADERS,
    SentryClient,
    scrub_sentry_event,
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
        assert event["request"]["data"] == {"note": "keep"}
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
        event["spans"][0]["data"]["http.url"]
        == "https://mudavym.com/invite/<redacted>"
    )
    assert "http.query" not in event["spans"][1]["data"]
    assert "SECRET" not in repr(event)


def test_no_trace_context_does_not_raise():
    from utils.sentry_client import scrub_sentry_event

    event = {"request": {"url": "/orders"}}
    scrub_sentry_event(event)
    assert "contexts" not in event
