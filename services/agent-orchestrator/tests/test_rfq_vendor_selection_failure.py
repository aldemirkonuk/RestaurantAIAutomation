"""A failed read is not a house with no vendors (ADR 0116, re-audit nit 1).

`RFQAgent._select_competitor_vendors` caught bare `Exception` and returned `[]`,
and its caller logged *"No vendors found for X"*. So three completely different
situations produced one indistinguishable outcome and one false sentence:

    the register was read, this house has no vendors     -> []  "No vendors found"
    the network dropped / the service key expired        -> []  "No vendors found"
    PostgREST answered 500                               -> []  "No vendors found"

The ADR 0116 blocker (a `ValidationError` escaping `find_many`) is fixed at the
repository now and can no longer reach here — but it was only ever the loudest
way into this funnel, not the only one. The funnel is the fault.

These tests pin the distinction at both levels: the selector RAISES on an
unreadable register, and the caller says which of the two happened while still
failing closed. They fail against a copy of the pre-fix file, which
`test_the_pre_fix_file_returned_an_empty_list` demonstrates directly rather than
asserting in prose.

    python3 -m pytest tests/test_rfq_vendor_selection_failure.py -q
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.rfq_agent import RFQAgent, VendorSelectionUnavailable  # noqa: E402
from core.database import Provider  # noqa: E402


class _APIError(Exception):
    """Stands in for postgrest's APIError — any non-Validation failure will do."""


def _agent(providers_result=None, raises: Exception | None = None) -> RFQAgent:
    """An RFQAgent whose provider repository either answers or fails.

    Built with `__new__` so no constructor side effects (settings, connections,
    base-agent wiring) run: the two methods under test touch only
    `self.database`, `self.logger` and `self.default_vendor_count`.
    """
    agent = RFQAgent.__new__(RFQAgent)
    agent.logger = logging.getLogger("rfq-test")
    agent.default_vendor_count = 3

    repo = MagicMock()
    if raises is not None:
        repo.get_active_providers = AsyncMock(side_effect=raises)
    else:
        repo.get_active_providers = AsyncMock(return_value=providers_result)

    agent.database = MagicMock()
    agent.database.providers = repo
    return agent


def _provider(pid: str, name: str, rating: float | None = None) -> Provider:
    return Provider.model_validate({"id": pid, "name": name, "rating": rating})


class TestTheSelectorSeparatesTheTwoStates:
    @pytest.mark.asyncio
    async def test_an_unreadable_register_RAISES_and_does_not_return_empty(self):
        """The nit, directly. An APIError must not become zero vendors."""
        agent = _agent(raises=_APIError("connection reset by peer"))

        with pytest.raises(VendorSelectionUnavailable) as caught:
            await agent._select_competitor_vendors(wine_name="Barolo", count=3)

        # The cause survives, with its type, so the log names what went wrong.
        assert "_APIError" in str(caught.value)
        assert "connection reset by peer" in str(caught.value)
        assert isinstance(caught.value.__cause__, _APIError)
        # And it says out loud what it is NOT.
        assert "NOT a house with no vendors" in str(caught.value)

    @pytest.mark.asyncio
    async def test_a_register_that_holds_nothing_returns_an_empty_list(self):
        """The other state, which must stay an ordinary empty list."""
        agent = _agent(providers_result=[])
        assert await agent._select_competitor_vendors(wine_name="Barolo", count=3) == []

    @pytest.mark.asyncio
    async def test_a_readable_register_still_sorts_and_caps(self):
        """The fix must not disturb what the method is actually for."""
        agent = _agent(
            providers_result=[
                _provider("p1", "Low", 1.0),
                _provider("p2", "High", 5.0),
                _provider("p3", "Mid", 3.0),
                _provider("p4", "None", None),
            ]
        )
        out = await agent._select_competitor_vendors(wine_name="Barolo", count=2)
        assert [p.name for p in out] == ["High", "Mid"]


class TestTheCallerSaysWhichFailureItWas:
    @staticmethod
    def _payload():
        return {
            "inventory_id": "i1",
            "wine_name": "Barolo",
            "restaurant_id": "r1",
        }

    @staticmethod
    def _with_inventory(agent: RFQAgent) -> RFQAgent:
        inv = MagicMock()
        inv.threshold_min = 4
        agent.database.inventory = MagicMock()
        agent.database.inventory.get_by_id = AsyncMock(return_value=inv)
        return agent

    @pytest.mark.asyncio
    async def test_an_unreadable_register_fails_closed_but_says_so(self, caplog):
        agent = self._with_inventory(_agent(raises=_APIError("503 from PostgREST")))

        with caplog.at_level(logging.WARNING, logger="rfq-test"):
            plan = await agent._build_rfq_plan(self._payload())

        # Behaviour unchanged: propose-only, fails closed, nothing contacted.
        assert plan is None
        # Record changed: the cause is named and the false claim is gone.
        assert "503 from PostgREST" in caplog.text
        assert "Nothing was proposed" in caplog.text
        assert "No vendors found" not in caplog.text, (
            "a failed read was reported as a house with no vendors — the exact "
            "sentence this fix exists to stop"
        )

    @pytest.mark.asyncio
    async def test_a_genuinely_empty_register_still_says_no_vendors(self, caplog):
        """The true version of the sentence must survive, and say why it is true."""
        agent = self._with_inventory(_agent(providers_result=[]))

        with caplog.at_level(logging.WARNING, logger="rfq-test"):
            plan = await agent._build_rfq_plan(self._payload())

        assert plan is None
        assert "No vendors found" in caplog.text
        assert "was read" in caplog.text


class TestThePreFixFileHadTheFault:
    """Not an assertion about history — the pre-fix file, executed.

    Loaded from `git show HEAD~:...` is not possible without git state changes,
    so the pre-fix SHAPE is reconstructed exactly: the `try/except Exception ->
    return []` that wrapped the whole body. If this ever stops demonstrating the
    fault, the reconstruction is wrong and the test above proves less than it
    claims.
    """

    @pytest.mark.asyncio
    async def test_the_old_shape_reports_a_failed_read_as_zero_vendors(self):
        async def old_select(database, count):
            try:
                providers = await database.providers.get_active_providers()
                if not providers:
                    return []
                return sorted(providers, key=lambda p: p.rating or 0, reverse=True)[
                    :count
                ]
            except Exception:  # noqa: BLE001 — this IS the pre-fix code
                return []

        agent = _agent(raises=_APIError("connection reset by peer"))
        assert await old_select(agent.database, 3) == [], (
            "the pre-fix shape no longer swallows the failure, so the "
            "reconstruction has drifted from what was actually fixed"
        )
        # Same input, current code: a raise, not an empty list.
        with pytest.raises(VendorSelectionUnavailable):
            await agent._select_competitor_vendors(wine_name="Barolo", count=3)
