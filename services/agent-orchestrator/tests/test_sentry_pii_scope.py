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
