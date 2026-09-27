"""
A look-up built from a house's own list leaves only once an owner has accepted
terms naming its host (the founder, 2026-09-25, item 33; ADR 0224).

Covers the gate itself and its two product call sites: web verification
(jobs/web_verify_tasks.py) and the research agent (jobs/research_tasks.py).
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional
from unittest.mock import AsyncMock, MagicMock, patch

from services.house_data_terms_gate import (
    SERPER_HOST,
    outside_lookup_allowed,
    snapshot_names_host,
)

HOUSE = "11111111-1111-1111-1111-111111111111"

NAMING_SERPER = {
    "version": 1,
    "subprocessors": [
        {"name": "Anthropic", "host": "api.anthropic.com"},
        {"name": "Serper", "host": "google.serper.dev"},
    ],
}
NOT_NAMING_SERPER = {
    "version": 1,
    "subprocessors": [{"name": "Anthropic", "host": "api.anthropic.com"}],
}


class _Query:
    """A chainable stand-in for one supabase-py table query."""

    def __init__(self, data: Any = None, raises: Optional[Exception] = None):
        self._data = data
        self._raises = raises
        self.eq_calls: list[tuple[str, Any]] = []

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.eq_calls.append((col, val))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def maybe_single(self):
        return self

    def update(self, *_a, **_k):
        return self

    def insert(self, *_a, **_k):
        return self

    def execute(self):
        if self._raises:
            raise self._raises
        return MagicMock(data=self._data)


class _Supabase:
    def __init__(self, tables: dict[str, _Query]):
        self.tables = tables
        self.asked: list[str] = []

    def table(self, name: str) -> _Query:
        self.asked.append(name)
        return self.tables.get(name) or _Query(data=[])


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------


def test_snapshot_names_host_exact_parent_and_comma_list():
    assert snapshot_names_host(NAMING_SERPER, SERPER_HOST)
    assert not snapshot_names_host(NOT_NAMING_SERPER, SERPER_HOST)
    parent = {"subprocessors": [{"host": "serper.dev"}]}
    assert snapshot_names_host(parent, SERPER_HOST)
    listed = {"subprocessors": [{"host": "maps.googleapis.com, places.googleapis.com"}]}
    assert snapshot_names_host(listed, "places.googleapis.com")
    # a suffix that is not a domain boundary is not a parent
    assert not snapshot_names_host(
        {"subprocessors": [{"host": "per.dev"}]}, SERPER_HOST
    )
    for junk in (
        None,
        "x",
        {},
        {"subprocessors": "x"},
        {"subprocessors": [1, {"host": 2}]},
    ):
        assert not snapshot_names_host(junk, SERPER_HOST)


def test_no_house_is_not_house_data():
    sb = _Supabase({})
    assert outside_lookup_allowed(sb, None, SERPER_HOST) == (True, "no_house")
    assert sb.asked == []  # nothing to read


def test_a_house_that_never_accepted_is_withheld():
    sb = _Supabase({"house_data_terms_acceptances": _Query(data=[])})
    assert outside_lookup_allowed(sb, HOUSE, SERPER_HOST) == (
        False,
        "terms_not_accepted",
    )


def test_accepted_terms_that_name_the_host_allow_it():
    q = _Query(data=[{"terms_version": 1, "terms_snapshot": NAMING_SERPER}])
    sb = _Supabase({"house_data_terms_acceptances": q})
    assert outside_lookup_allowed(sb, HOUSE, SERPER_HOST) == (True, "accepted")
    assert ("restaurant_id", HOUSE) in q.eq_calls  # scoped to THIS house


def test_accepted_terms_that_do_not_name_the_host_withhold_it():
    q = _Query(data=[{"terms_version": 1, "terms_snapshot": NOT_NAMING_SERPER}])
    sb = _Supabase({"house_data_terms_acceptances": q})
    assert outside_lookup_allowed(sb, HOUSE, SERPER_HOST) == (
        False,
        "terms_do_not_name_host",
    )


def test_an_unreadable_store_fails_closed():
    q = _Query(raises=RuntimeError("relation does not exist"))
    sb = _Supabase({"house_data_terms_acceptances": q})
    assert outside_lookup_allowed(sb, HOUSE, SERPER_HOST) == (
        False,
        "terms_unreadable",
    )


# ---------------------------------------------------------------------------
# Call site 1: web verification after a house's menu is read
# ---------------------------------------------------------------------------

_SUBMISSION = {
    "id": "sub-1",
    "restaurant_id": HOUSE,
    "payload": {"wine_name": "Puligny-Montrachet", "producer": "Domaine Leflaive"},
    "field_confidence": {
        "wine_name": {"value": "Puligny-Montrachet", "confidence": 0.97},
        "producer": {"value": "Domaine Leflaive", "confidence": 0.82},
        "region": {"value": "Burgundy", "confidence": 0.55},
    },
}


def _run_verify(acceptances: _Query):
    from jobs.web_verify_tasks import _verify_async

    sb = _Supabase(
        {
            "master_wine_library_submissions": _Query(data=_SUBMISSION),
            "house_data_terms_acceptances": acceptances,
        }
    )
    serper = AsyncMock(return_value=[])
    budget = MagicMock(return_value=True)
    ontology = MagicMock()
    with (
        patch("jobs.web_verify_tasks.create_client", return_value=sb),
        patch("services.serper_client.serper_search", serper),
        patch("jobs.web_verify_tasks.check_and_reserve_search_budget", budget),
        patch("services.web_verification_service.lookup_producer", return_value=None),
        patch("jobs.ontology_tasks.ontology_validate_task", ontology),
    ):
        result = asyncio.run(_verify_async("sub-1"))
    return result, serper, budget, ontology


def test_web_verify_withholds_the_search_until_the_owner_accepts():
    result, serper, budget, ontology = _run_verify(_Query(data=[]))
    assert result == {"wine_id": "sub-1", "status": "skipped_terms_not_accepted"}
    serper.assert_not_called()
    budget.assert_not_called()  # a withheld search reserves no budget
    ontology.delay.assert_called_once_with("sub-1")  # the chain still continues


def test_web_verify_searches_once_the_owner_accepted_terms_naming_serper():
    accepted = _Query(data=[{"terms_version": 1, "terms_snapshot": NAMING_SERPER}])
    result, serper, budget, _ontology = _run_verify(accepted)
    serper.assert_awaited_once()
    budget.assert_called_once()
    assert result == {"wine_id": "sub-1", "status": "no_search_results"}


# ---------------------------------------------------------------------------
# Call site 2: the research agent, per submission
# ---------------------------------------------------------------------------


def _run_research(acceptances: _Query):
    from jobs import research_tasks

    sb = _Supabase(
        {
            "master_wine_library_submissions": _Query(data=_SUBMISSION),
            "house_data_terms_acceptances": acceptances,
            "research_runs": _Query(data=[{"id": "run-1"}]),
        }
    )
    settings = MagicMock(supabase_url="http://x", supabase_key="k", redis_url=None)
    process = AsyncMock(side_effect=RuntimeError("stop after the gate"))
    with (
        patch.object(research_tasks, "get_settings", return_value=settings),
        patch.object(research_tasks, "get_spend_logger", return_value=MagicMock()),
        patch.object(
            research_tasks, "_check_daily_budget", AsyncMock(return_value=True)
        ),
        patch.object(research_tasks, "create_client", return_value=sb),
        patch.object(research_tasks, "is_eligible_for_research", return_value=True),
        patch.object(research_tasks, "_process_record", process),
    ):
        try:
            asyncio.run(research_tasks._research_async("sub-1", dry_run=True))
        except RuntimeError:
            pass
    return sb, process


def test_research_withholds_the_run_until_the_owner_accepts():
    sb, process = _run_research(_Query(data=[]))
    process.assert_not_called()
    assert "research_runs" not in sb.asked  # a withheld run never starts


def test_research_runs_once_the_owner_accepted_terms_naming_serper():
    accepted = _Query(data=[{"terms_version": 1, "terms_snapshot": NAMING_SERPER}])
    _sb, process = _run_research(accepted)
    process.assert_called_once()
