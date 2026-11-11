"""
EmailIntelAgent asks "is this sender one of this house's vendors?" in two
lookups, ``providers`` and ``provider_contacts``. Both were scoped to the house
and escaped by the code, and no test failed when either was not (QA round 25,
M4). These run the method over a store with two houses, so a lookup that drops
its house or reads the sender as a LIKE pattern answers wrongly. With no house
there is no "this house": nothing is read and nothing is flagged.

The store raises, as PostgREST does, on a column the baseline lacks.
"""

import asyncio
import logging
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from agents.email_intel_agent import EmailIntelAgent
from models.email_intel import EmailClassification
from mail_store import Store, rows

SQL = (
    Path(__file__).parents[3]
    / "supabase/migrations/20260805000000_baseline_from_production.sql"
)


def _columns(table):
    body = SQL.read_text().split(f"TABLE public.{table} (\n", 1)[1].split("\n);")[0]
    return {line.split()[0] for line in body.splitlines()}


SCHEMA = {t: _columns(t) for t in ("providers", "provider_contacts")}
PROVIDERS = {
    "providers": rows(
        "id restaurant_id contact_email", ("p-B", "house-B", "sales@bigdist.com")
    ),
    "provider_contacts": [],
}
CONTACTS = {
    "providers": rows("id restaurant_id", ("p-B", "house-B")),
    "provider_contacts": rows(
        "id provider_id email", ("c-B", "p-B", "anna@bigdist.com")
    ),
}


def _unknown(tables, house, sender):
    store = Store(tables, columns=SCHEMA)
    agent = object.__new__(EmailIntelAgent)
    agent.logger = logging.getLogger("test_email_intel_house_scope")
    agent.database = store
    return asyncio.run(agent._detect_unknown_sender(house, sender)), store


@pytest.mark.parametrize(
    "tables, sender",
    [(PROVIDERS, "Sales@BigDist.com"), (CONTACTS, "anna@bigdist.com")],
    ids=["providers", "contacts"],
)
def test_a_vendor_of_the_other_house_is_unknown_here(tables, sender):
    assert _unknown(tables, "house-B", sender)[0] is False
    assert _unknown(tables, "house-A", sender)[0] is True


@pytest.mark.parametrize(
    "tables, sender",
    [
        (PROVIDERS, "%@bigdist.com"),
        (PROVIDERS, "s_les@bigdist.com"),
        (PROVIDERS, "*@bigdist.com"),
        (CONTACTS, "%@bigdist.com"),
        (CONTACTS, "a__a@bigdist.com"),
        (CONTACTS, "*@bigdist.com"),
    ],
    ids=["prov-pct", "prov-under", "prov-star", "con-pct", "con-under", "con-star"],
)
def test_a_pattern_sender_is_not_a_known_vendor(tables, sender):
    assert _unknown(tables, "house-B", sender)[0] is True


@pytest.mark.parametrize("house", ["", "  ", None])
def test_with_no_house_nothing_is_read_and_nothing_flagged(house):
    unknown, store = _unknown(PROVIDERS, house, "stranger@nowhere.example")
    assert unknown is False
    assert store.reads == []


def test_a_star_address_reads_as_a_percent_address():
    # Measured live (QA round 25): PostgREST turns the escaped ``*`` into a
    # literal ``%``, so ``a*b@`` is taken for the vendor ``a%b@``. Recorded
    # here so the store above cannot drift from PostgREST unnoticed.
    tables = {
        "providers": rows(
            "id restaurant_id contact_email", ("p", "house-B", "a%b@bigdist.com")
        ),
        "provider_contacts": [],
    }
    assert _unknown(tables, "house-B", "a*b@bigdist.com")[0] is False


def _notified(sender, category="PROMO", verdict=None, house="house-A"):
    agent = object.__new__(EmailIntelAgent)
    agent.logger = logging.getLogger("test_email_intel_house_scope")
    agent.database = Store(PROVIDERS, columns=SCHEMA)
    for name in ("log_decision", "publish", "_notify", "_handle_promo"):
        setattr(agent, name, AsyncMock())
    agent._notify_unknown_sender = AsyncMock()
    agent._classify_email = AsyncMock(
        return_value=EmailClassification(
            category=category, confidence=0.9, reasoning=""
        )
    )
    letter = {"restaurant_id": house, "from": f"Ann <{sender}>", "subject": "s"}
    letter["ingress_authentication_results"] = verdict
    asyncio.run(agent._triage_inbound(letter))
    return [c.args[:2] for c in agent._notify_unknown_sender.await_args_list]


def test_a_stranger_writing_to_the_house_is_named_to_that_house():
    assert _notified("Stranger@Nowhere.example") == [
        ("house-A", "stranger@nowhere.example")
    ]
    assert _notified("Sales@BigDist.com", house="house-B") == []


@pytest.mark.parametrize(
    "kw",
    [
        {"category": "NOISE"},
        {"verdict": "mx.google.com; dmarc=fail header.from=nowhere.example"},
        {"house": ""},
    ],
    ids=["noise", "unconfirmed", "no-house"],
)
def test_no_notice(kw):
    assert _notified("stranger@nowhere.example", **kw) == []
