"""QA round 24 (2026-11-07), the agent half.

Item 1: a From that names no single address is held by the gateway bridge,
filed under no vendor; this agent files nothing for it and says so.

Item 2: SPF, DKIM and DMARC were never consulted. When the receiving server's
own verdict (``ingress_authentication_results``, the topmost
Authentication-Results with Gmail's authserv-id, picked by the gateway
publisher) says a letter did not come from the vendor's domain, this agent
files nothing: no conversation row, no order thread, no routing. The gateway
bridge holds it in the house. The table mirrors
``apps/api-gateway/src/communications/sender-authentication.spec.ts``.
"""

import logging

import pytest

from agents.email_parsing_agent import sender_unconfirmed
from test_email_house_scope import _file, _letter

VENDOR = "sales@bigdist.com"
G = "mx.google.com"
FAIL = (
    f"{G}; dkim=none; spf=fail (google.com: domain of {VENDOR} does not "
    f"designate 203.0.113.9 as permitted sender) smtp.mailfrom={VENDOR}; "
    "dmarc=fail (p=REJECT) header.from=bigdist.com"
)
PASS = (
    f"{G}; dkim=pass header.i=@bigdist.com header.s=s1; spf=pass "
    f"smtp.mailfrom={VENDOR}; dmarc=pass (p=REJECT) header.from=bigdist.com"
)


@pytest.mark.parametrize(
    "verdict,want",
    [
        pytest.param(f"{G}; dmarc=fail header.from=bigdist.com", True, id="dmarc=fail"),
        pytest.param(FAIL, True, id="the full forged letter"),
        pytest.param(PASS, False, id="a clean pass"),
        pytest.param(f"{G}; spf=fail smtp.mailfrom={VENDOR}", True, id="spf=fail, no dkim"),
        pytest.param(f"{G}; spf=fail", True, id="spf=fail, no smtp.mailfrom named"),
        pytest.param(
            f"{G}; spf=fail smtp.mailfrom={VENDOR}; dkim=pass header.d=bigdist.com",
            False,
            id="spf=fail, vendor's own dkim passes (a forwarder)",
        ),
        pytest.param(
            f"{G}; spf=fail smtp.mailfrom={VENDOR}; dkim=pass header.i=@mail.bigdist.com",
            False,
            id="spf=fail, dkim passes for a subdomain of the vendor",
        ),
        pytest.param(
            f"{G}; spf=fail smtp.mailfrom={VENDOR}; dkim=pass header.d=evil.example",
            True,
            id="spf=fail, dkim passes for someone else's domain",
        ),
        pytest.param(
            f"{G}; spf=fail smtp.mailfrom=bounce@esp.example",
            False,
            id="spf=fail for an envelope that is not the vendor's",
        ),
        pytest.param(f"{G}; spf=softfail smtp.mailfrom={VENDOR}", False, id="softfail"),
        pytest.param(f"{G}; dmarc=none header.from=bigdist.com", False, id="dmarc=none"),
        pytest.param(f"{G}; dmarc=temperror", False, id="dmarc=temperror"),
        pytest.param(None, False, id="no verdict"),
        pytest.param("   ", False, id="empty verdict"),
        pytest.param(
            f"{G}; spf=pass (dmarc=fail) smtp.mailfrom={VENDOR}",
            False,
            id="a fail only in a comment",
        ),
        pytest.param(
            f'{G}; spf=pass smtp.mailfrom="dmarc=fail"',
            False,
            id="a fail only in a quoted string",
        ),
        pytest.param(f"{G}; DMARC=FAIL header.from=bigdist.com", True, id="upper case"),
    ],
)
def test_sender_unconfirmed_table(verdict, want):
    assert sender_unconfirmed(verdict, VENDOR) is want


def test_the_display_form_of_the_sender_is_read_as_its_address():
    verdict = f"{G}; spf=fail smtp.mailfrom={VENDOR}; dkim=pass header.d=bigdist.com"
    assert sender_unconfirmed(verdict, f"Sales <{VENDOR}>") is False


def test_an_unconfirmed_letter_is_not_filed_threaded_or_routed(caplog):
    # A real thread id of this house's order: a forged letter can carry one.
    payload = _letter(gmail_thread_id="T-A", ingress_authentication_results=FAIL)
    with caplog.at_level(logging.WARNING):
        stored, calls, _h, store = _file(payload)
    assert (stored, calls) == ([], [])
    assert store.reads == []
    assert "held by the gateway bridge" in caplog.text


def test_a_confirmed_letter_is_filed_as_before():
    payload = _letter(gmail_thread_id="T-A", ingress_authentication_results=PASS)
    stored, _calls, _h, _ = _file(payload)
    assert [(r["restaurant_id"], r["provider_id"], r["order_id"]) for r in stored] == [
        ("house-A", "prov-A", "ordA")
    ]


def test_a_forged_pass_in_the_header_map_is_never_read():
    # The header map keeps the sender's own last line; only the ingress verdict
    # counts.
    payload = _letter(
        ingress_authentication_results=FAIL,
        headers={"authentication-results": PASS},
    )
    stored, calls, _h, _ = _file(payload)
    assert (stored, calls) == ([], [])


def test_no_verdict_is_filed_as_before():
    stored, _calls, _h, _ = _file(_letter())
    assert len(stored) == 1


def test_a_from_that_names_nobody_is_left_to_the_bridge(caplog):
    payload = _letter(**{"from": f"a@x.example, {VENDOR}"})
    with caplog.at_level(logging.WARNING):
        stored, calls, _h, store = _file(payload)
    assert (stored, calls, store.reads) == ([], [], [])
    assert "held by the gateway bridge" in caplog.text
