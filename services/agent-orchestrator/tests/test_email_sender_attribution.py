"""
EmailParsingAgent sender attribution — QA round 22, N-1 (2026-11-07).

`_extract_email` took the first `<...>` in the From header, so
`"Sales <sales@bigdist.com>" <attacker@evil.example>` was looked up as the
vendor and filed against its provider and orders. The rule now matches the
gateway's `inbound-headers.ts parseSender`: the addr-spec of exactly one From
mailbox, and a From not shaped like exactly one mailbox names nobody.

The case table is the same one `inbound-headers.spec.ts` runs ("N-1 tail"),
so the two consumers of `email.inbound.received` cannot disagree on a shape.
"""

import asyncio
import base64
import logging

import pytest

from agents.email_parsing_agent import EmailParsingAgent

VENDOR = "sales@bigdist.com"


def _agent():
    agent = object.__new__(EmailParsingAgent)
    agent.logger = logging.getLogger("test_email_sender_attribution")
    return agent


def sender_address(header):
    """What every caller (lines 124/174/410/487 at the time of writing) sees:
    the agent's own ``_extract_email``. Kept as the agent method, not the
    module helper, so this file fails behaviourally on the old parser rather
    than on an import."""
    return _agent()._extract_email(header)


def _b64(s: str) -> str:
    return "=?UTF-8?B?" + base64.b64encode(s.encode("utf-8")).decode() + "?="


# (label, From header, expected address or None)
CASES = [
    # display-name forgeries resolve to the real sender
    (
        "quoted display name",
        '"Sales <sales@bigdist.com>" <attacker@evil.example>',
        "attacker@evil.example",
    ),
    (
        "comment carries vendor",
        '"x" <attacker@evil.example> (sales@bigdist.com)',
        "attacker@evil.example",
    ),
    (
        "comment with angle",
        "Sales (<sales@bigdist.com>) <attacker@evil.example>",
        "attacker@evil.example",
    ),
    (
        "RFC 2047 name decoding to an angle",
        _b64("Sales <sales@bigdist.com>") + " <attacker@evil.example>",
        "attacker@evil.example",
    ),
    (
        "escaped quote in name",
        '"Sales\\" <sales@bigdist.com>" <attacker@evil.example>',
        "attacker@evil.example",
    ),
    # ambiguous shapes name nobody
    ("nested comment", "attacker@evil.example (a (b <sales@bigdist.com>))", None),
    ("address as display name", "sales@bigdist.com <attacker@evil.example>", None),
    ("angle then bare", "<sales@bigdist.com> attacker@evil.example", None),
    ("two angles", "Sales <sales@bigdist.com> <attacker@evil.example>", None),
    ("two mailboxes", "sales@bigdist.com, attacker@evil.example", None),
    ("two mailboxes, attacker first", "attacker@evil.example, sales@bigdist.com", None),
    ("unterminated quote", '"Sales <sales@bigdist.com> <attacker@evil.example>', None),
    ("quoted local part", '"sales@bigdist.com"@evil.example', None),
    ("quoted local part, angled", 'X <"sales@bigdist.com"@evil.example>', None),
    ("source route", "<@evil.example:sales@bigdist.com>", None),
    ("group carrying vendor", "undisclosed: sales@bigdist.com;", None),
    ("group carrying attacker", "Vendors: attacker@evil.example;", None),
    ("CRLF injection", "Sales\r\nFrom: sales@bigdist.com", None),
    (
        "CRLF injection after a real address",
        "attacker@evil.example\r\nFrom: sales@bigdist.com",
        None,
    ),
    ("folded injection", "Sales\r\n From: sales@bigdist.com", None),
    ("NUL injection", "attacker@evil.example\x00<sales@bigdist.com>", None),
    ("two bare addresses", "attacker@evil.example sales@bigdist.com", None),
    ("empty", "", None),
    ("display only", "Sales Team", None),
    # ordinary shapes still attribute
    ("bare", "john@x.com", "john@x.com"),
    ("upper case", "SALES@BigDist.com", "sales@bigdist.com"),
    ("quoted name with comma", '"Doe, John" <John@X.com>', "john@x.com"),
    ("angle with trailing comment", "<a@x.com> (Ahmet)", "a@x.com"),
    ("unicode name and domain", "Ahmet Yılmaz <ahmet@vendör.com>", "ahmet@vendör.com"),
    ("folded between name and angle", "Ahmet\r\n <ahmet@x.com>", "ahmet@x.com"),
]


@pytest.mark.parametrize("label,header,want", CASES, ids=[c[0] for c in CASES])
def test_sender_address_table(label, header, want):
    assert sender_address(header) == want


FORGED = [c for c in CASES if c[2] != VENDOR]


@pytest.mark.parametrize("label,header,want", FORGED, ids=[c[0] for c in FORGED])
def test_no_forged_shape_resolves_to_the_vendor(label, header, want):
    assert sender_address(header) != VENDOR


class _Stop(Exception):
    pass


def _run(agent, from_header, lookups):
    async def no_match(*_a, **_k):
        return None

    async def find_provider(email):
        lookups.append(email)
        raise _Stop()  # the attribution decision is all this test needs

    agent._match_by_gmail_thread_id = no_match
    agent._match_by_headers = no_match
    agent._match_by_context = no_match
    agent._find_provider_by_email = find_provider
    payload = {
        "from": from_header,
        "subject": "Re: order",
        "body": "Please wire the deposit to the new IBAN",
        "gmail_thread_id": "",
        "in_reply_to": "",
        "references": "",
    }
    try:
        asyncio.run(agent._process_inbound_email(payload))
    except _Stop:
        pass


def test_extract_email_is_the_module_rule():
    from agents.email_parsing_agent import sender_address as module_rule

    agent = _agent()
    for _label, header, _want in CASES:
        assert agent._extract_email(header) == module_rule(header)


def test_a_forged_display_name_is_looked_up_as_the_attacker():
    lookups: list = []
    _run(_agent(), '"Sales <sales@bigdist.com>" <attacker@evil.example>', lookups)
    assert lookups == ["attacker@evil.example"]


@pytest.mark.parametrize(
    "header",
    [
        "<sales@bigdist.com> attacker@evil.example",
        "undisclosed: sales@bigdist.com;",
        "Sales\r\nFrom: sales@bigdist.com",
        "attacker@evil.example\x00<sales@bigdist.com>",
    ],
)
def test_an_ambiguous_from_is_never_looked_up(header):
    lookups: list = []
    _run(_agent(), header, lookups)
    assert lookups == []
