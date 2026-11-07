"""
A letter is filed in the house it was written to, never in another house that
lists the same vendor address (QA round 25, cross-tenant BLOCKER).

`providers` is unique on `(restaurant_id, lower(contact_email))`, so two
houses may list one address. EmailParsingAgent looked the sender up across
every house, took the first row, and took the house from that row's order or
from `default_restaurant_id`: a house-A letter was stored as house B's
conversation, on house B's vendor and order, and house B was notified.

The gateway that received the letter now decides the house and stamps it on
the event (`shared-mailbox-house.ts`, house inbox, dedicated domain). Every
read here is scoped to it, and an event with no house is attributed to no
house; the gateway bridge holds it for the operator. House B's rows come
first in every fixture, so "the first row of any house" is house B's.
"""

import asyncio
import json
import logging

import pytest

from agents.email_parsing_agent import EmailParsingAgent
from mail_store import Store, rows

ORDER = "id restaurant_id provider_id wine_name quantity status"
CONV = "id restaurant_id order_id thread_id gmail_thread_id message_id"


def _houses():
    return {
        "providers": rows(
            "id restaurant_id contact_email primary_contact",
            ("prov-B", "house-B", "sales@bigdist.com", None),
            ("prov-A", "house-A", "Sales@BigDist.com", None),
            ("prov-B2", "house-B", None, {"email": "orders@shared.example"}),
            ("prov-A2", "house-A", None, {"email": "orders@shared.example"}),
        ),
        # ordX is a house-B order that names house A's vendor: scoping the
        # order reads by vendor alone would hand it to house A.
        "procurement_orders": rows(
            ORDER,
            ("ordB", "house-B", "prov-B", "Opus One Reserve", 6, "ordered"),
            ("ordX", "house-B", "prov-A", "Opus One Reserve", 12, "ordered"),
            ("ordA", "house-A", "prov-A", "Barolo Riserva", 3, "ordered"),
        ),
        "procurement_conversations": rows(
            CONV,
            ("convB", "house-B", "ordB", "thr-B", "T-shared", "<m-b@bigdist.com>"),
            ("convA", "house-A", "ordA", "thr-A", "T-A", "<m-a@bigdist.com>"),
        ),
    }


def _agent(store, model=None):
    agent = object.__new__(EmailParsingAgent)
    agent.logger = logging.getLogger("test_email_house_scope")
    # The round-25 worst case: the config default names the other house.
    agent.raw_config = {"default_restaurant_id": "house-B"}
    agent.gemini_model, agent.db, agent.calls = model, store, []

    def record(name):
        async def _rec(*a, **_k):
            agent.calls.append((name, a))

        return _rec

    async def intent(*_a, **_k):
        return "general"

    agent._detect_intent = intent
    agent._generate_thread_summary = record("summary")
    agent._route_to_procurement = record("route")
    agent._notify_frontend = record("notify")
    agent._flag_for_review = record("flag")
    return agent


def _letter(**over):
    return {
        "from": "Sales <sales@bigdist.com>",
        "subject": "Re: Barolo Riserva",
        "body": "Confirmed for Friday.",
        "gmail_thread_id": "",
        "message_id_header": "<new@bigdist.com>",
        "in_reply_to": "",
        "references": "",
        "restaurant_id": "house-A",
        "house_resolution": "vendor",
        **over,
    }


def _file(payload, model=None):
    store = Store(_houses())
    agent = _agent(store, model)
    asyncio.run(agent._process_inbound_email(payload))
    stored = [p for t, p in store.inserts if t == "procurement_conversations"]
    houses = {
        a for _n, args in agent.calls for a in args if str(a).startswith("house-")
    }
    return stored, agent.calls, houses, store


def _filed(row):
    return (row["restaurant_id"], row["provider_id"], row["order_id"])


def test_a_letter_to_house_A_is_filed_under_house_A_only():
    stored, calls, houses, _ = _file(_letter())
    assert [_filed(r) for r in stored] == [("house-A", "prov-A", "ordA")]
    assert ("notify", ("house-A", "ordA", "prov-A", "Re: Barolo Riserva", 0.6)) in calls
    # Neither the config default nor house B's rows named any house.
    assert houses == {"house-A"}


def test_a_letter_about_the_other_house_wine_matches_no_order():
    # "Opus One Reserve" is on order in house B only (ordB, and ordX).
    stored, calls, houses, _ = _file(_letter(subject="Re: Opus One Reserve"))
    assert [_filed(r) for r in stored] == [("house-A", "prov-A", None)]
    assert not [c for c in calls if c[0] in ("route", "flag")]
    assert houses == {"house-A"}


def test_the_language_model_cannot_pick_the_other_house_order():
    class _Reply:
        text = json.dumps({"order_id": "ordX", "confidence": 0.95})
        usage_metadata = None

    class _Model:
        async def generate_content_async(self, _prompt):
            return _Reply()

    stored, calls, _h, _ = _file(_letter(subject="Re: Opus One Reserve"), _Model())
    assert [_filed(r) for r in stored] == [("house-A", "prov-A", None)]
    assert not [c for c in calls if c[0] == "route"]


@pytest.mark.parametrize(
    "over",
    [{"gmail_thread_id": "T-shared"}, {"in_reply_to": "<m-b@bigdist.com>"}],
    ids=["gmail-thread", "reply-header"],
)
def test_another_house_thread_is_not_this_house_thread(over):
    stored, _calls, houses, _ = _file(_letter(subject="Re: hi", body="x", **over))
    assert [_filed(r) for r in stored] == [("house-A", "prov-A", None)]
    assert stored[0]["parent_message_id"] is None
    assert stored[0]["thread_id"] != "thr-B"
    assert houses == {"house-A"}


def test_this_house_thread_still_matches():
    stored, calls, _h, _ = _file(_letter(gmail_thread_id="T-A", subject="Re: hi"))
    row = stored[0]
    assert (row["order_id"], row["thread_id"], row["parent_message_id"]) == (
        "ordA",
        "thr-A",
        "convA",
    )
    assert (
        "route",
        ("ordA", "prov-A", "house-A", "Re: hi", "Confirmed for Friday."),
    ) in calls


@pytest.mark.parametrize("house", [None, "", "   "])
def test_a_letter_with_no_house_is_attributed_to_no_house(house):
    payload = _letter(restaurant_id=house, house_resolution="vendor_in_many_houses")
    stored, calls, _h, store = _file(payload)
    assert (stored, calls) == ([], [])
    # Not even a lookup: nothing about the letter is read against any house.
    assert store.reads == []


def test_the_house_on_the_event_is_trimmed():
    stored, _c, _h, _ = _file(_letter(restaurant_id="  house-A "))
    assert [_filed(r) for r in stored] == [("house-A", "prov-A", "ordA")]


@pytest.mark.parametrize(
    "house, address, want",
    [
        ("house-A", "sales@bigdist.com", "prov-A"),
        ("house-B", "sales@bigdist.com", "prov-B"),
        ("house-A", "orders@shared.example", "prov-A2"),
        ("house-B", "orders@shared.example", "prov-B2"),
        ("house-C", "sales@bigdist.com", None),
        ("house-C", "orders@shared.example", None),
        (None, "sales@bigdist.com", None),
        ("", "sales@bigdist.com", None),
    ],
)
def test_the_provider_lookup_answers_only_from_the_house(house, address, want):
    store = Store(_houses())
    found = asyncio.run(_agent(store)._find_provider_by_email(address, house))
    assert found == want
    if not house:
        assert store.reads == []
