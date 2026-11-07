"""
EmailIntelAgent asks "is this sender one of this house's vendors?" in two
lookups, ``providers`` and ``provider_contacts``. Both were scoped to the house
and escaped by the code, and no test failed when either was not (QA round 25,
M4). These run the method over a store with two houses, so a lookup that drops
its house or reads the sender as a LIKE pattern answers wrongly. With no house
there is no "this house": nothing is read and nothing is flagged.

They test the query the method makes. That query names ``providers.email`` and
``provider_contacts.restaurant_id``, which the production schema does not
have, and no publisher sets the ``from_email`` it reads (see the PR body).
"""

import asyncio
import logging

import pytest

from agents.email_intel_agent import EmailIntelAgent
from mail_store import Store, rows

PROVIDERS = {
    "providers": rows(
        "id restaurant_id email", ("p-B", "house-B", "sales@bigdist.com")
    ),
    "provider_contacts": [],
}
CONTACTS = {
    "providers": [],
    "provider_contacts": rows(
        "id restaurant_id email", ("c-B", "house-B", "anna@bigdist.com")
    ),
}


def _unknown(tables, house, sender):
    store = Store(tables)
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
            "id restaurant_id email", ("p", "house-B", "a%b@bigdist.com")
        ),
        "provider_contacts": [],
    }
    assert _unknown(tables, "house-B", "a*b@bigdist.com")[0] is False
