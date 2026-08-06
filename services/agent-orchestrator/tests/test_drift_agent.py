"""
Unit tests for DriftAgent — SimPOS catalog ↔ WineOps drift.

Covers (mocked DB):
  1. new_item → pos_catalog_match_proposals (match_method=drift_agent)
  2. price_change → drift_findings (open, not auto-applied)
  3. unchanged snapshot hash → no-op (decision_log only, no findings)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

from agents.drift_agent import (
    DECISION_FINDING,
    DECISION_SNAPSHOT,
    DriftAgent,
    compute_catalog_snapshot_hash,
)


REST_ID = "sim-rest-uuid-1"
INV_ID = "inv-uuid-1"


class _TableRouter:
    """
    Routes supabase.table(name) calls to per-table chain mocks and records inserts.
    """

    def __init__(self, tables: Dict[str, List[Dict[str, Any]]]):
        self.tables = {k: list(v) for k, v in tables.items()}
        self.inserts: Dict[str, List[Dict[str, Any]]] = {}
        self._chains: Dict[str, MagicMock] = {}

    def table(self, name: str) -> MagicMock:
        if name not in self._chains:
            self._chains[name] = self._make_chain(name)
        return self._chains[name]

    def _make_chain(self, name: str) -> MagicMock:
        chain = MagicMock(name=f"chain:{name}")
        state: Dict[str, Any] = {
            "filters": {},
            "order_desc": False,
            "limit": None,
            "pending_insert": None,
            "select_cols": "*",
            "in_filters": {},
        }

        def select(*_a, **_k):
            return chain

        def eq(col, val):
            state["filters"][col] = val
            return chain

        def like(col, pattern):
            # Only used for restaurants.slug LIKE 'sim-%'
            state["filters"][f"{col}__like"] = pattern
            return chain

        def in_(col, values):
            state["in_filters"][col] = set(values)
            return chain

        def order(_col, desc=False):
            state["order_desc"] = desc
            return chain

        def limit(n):
            state["limit"] = n
            return chain

        def insert(row):
            state["pending_insert"] = row
            return chain

        def execute():
            result = MagicMock()
            if state["pending_insert"] is not None:
                row = dict(state["pending_insert"])
                row.setdefault("id", f"{name}-id-{len(self.inserts.get(name, [])) + 1}")
                self.inserts.setdefault(name, []).append(row)
                self.tables.setdefault(name, []).append(row)
                result.data = [row]
                state["pending_insert"] = None
                state["filters"] = {}
                state["in_filters"] = {}
                state["limit"] = None
                return result

            rows = list(self.tables.get(name, []))
            for col, val in state["filters"].items():
                if col.endswith("__like"):
                    real = col.replace("__like", "")
                    prefix = str(val).rstrip("%")
                    rows = [r for r in rows if str(r.get(real, "")).startswith(prefix)]
                else:
                    rows = [r for r in rows if r.get(col) == val]
            for col, values in state["in_filters"].items():
                rows = [r for r in rows if r.get(col) in values]

            if name == "decision_log" and state.get("order_desc"):
                # Newest first — tests prepend newer rows when needed
                pass

            if state["limit"] is not None:
                rows = rows[: state["limit"]]

            result.data = rows
            state["filters"] = {}
            state["in_filters"] = {}
            state["limit"] = None
            return result

        chain.select.side_effect = select
        chain.eq.side_effect = eq
        chain.like.side_effect = like
        chain.in_.side_effect = in_
        chain.order.side_effect = order
        chain.limit.side_effect = limit
        chain.insert.side_effect = insert
        chain.execute.side_effect = execute
        return chain


def _make_agent(
    tables: Dict[str, List[Dict[str, Any]]]
) -> tuple[DriftAgent, _TableRouter]:
    router = _TableRouter(tables)
    db = MagicMock()
    db.supabase.table.side_effect = router.table
    agent = DriftAgent(
        agent_name="drift_agent",
        message_bus=MagicMock(),
        database=db,
        config={},
    )
    agent.logger = MagicMock()
    return agent, router


def _base_tables(
    catalog: Optional[List[Dict[str, Any]]] = None,
    mappings: Optional[List[Dict[str, Any]]] = None,
    inventory: Optional[List[Dict[str, Any]]] = None,
    decision_log: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    return {
        "restaurants": [{"id": REST_ID, "slug": "sim-bistro"}],
        "simpos_catalog": catalog or [],
        "pos_item_mappings": mappings or [],
        "restaurant_inventory": inventory or [],
        "decision_log": decision_log or [],
        "pos_catalog_match_proposals": [],
        "drift_findings": [],
    }


# ---------------------------------------------------------------------------
# Snapshot hash helper
# ---------------------------------------------------------------------------


def test_snapshot_hash_is_order_independent():
    a = [
        {
            "external_item_id": "b",
            "wine_name": "B",
            "vintage": 2020,
            "size_ml": 750,
            "price": 40,
            "is_active": True,
        },
        {
            "external_item_id": "a",
            "wine_name": "A",
            "vintage": 2019,
            "size_ml": 750,
            "price": 30,
            "is_active": True,
        },
    ]
    b = list(reversed(a))
    assert compute_catalog_snapshot_hash(a) == compute_catalog_snapshot_hash(b)


# ---------------------------------------------------------------------------
# new_item → proposal
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_new_item_creates_match_proposal():
    catalog = [
        {
            "id": "cat-1",
            "restaurant_id": REST_ID,
            "external_item_id": "ext-new-1",
            "wine_name": "Caymus Cabernet",
            "vintage": 2021,
            "size_ml": 750,
            "price": 95.00,
            "is_active": True,
        }
    ]
    agent, router = _make_agent(_base_tables(catalog=catalog))

    result = await agent.check_restaurant(REST_ID)

    assert result["unchanged"] is False
    assert len(result["findings"]) == 1
    finding = result["findings"][0]
    assert finding["finding_type"] == "new_item"
    assert finding["auto_healed"] is True
    assert finding["status"] == "proposed"

    proposals = router.inserts.get("pos_catalog_match_proposals", [])
    assert len(proposals) == 1
    assert proposals[0]["match_method"] == "drift_agent"
    assert proposals[0]["status"] == "pending"
    assert proposals[0]["external_item_id"] == "ext-new-1"
    assert proposals[0]["source"] == "simpos"

    # Must NOT write an open drift_finding for safe new_item auto-heal
    open_findings = [
        f for f in router.inserts.get("drift_findings", []) if f.get("status") == "open"
    ]
    assert open_findings == []

    decision_types = [
        d["decision_type"] for d in router.inserts.get("decision_log", [])
    ]
    assert DECISION_FINDING in decision_types
    assert DECISION_SNAPSHOT in decision_types


# ---------------------------------------------------------------------------
# price_change → drift_finding (not auto)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_price_change_writes_open_drift_finding_not_auto():
    catalog = [
        {
            "id": "cat-1",
            "restaurant_id": REST_ID,
            "external_item_id": "ext-1",
            "wine_name": "Opus One",
            "vintage": 2018,
            "size_ml": 750,
            "price": 450.00,  # drifted
            "is_active": True,
        }
    ]
    mappings = [
        {
            "id": "map-1",
            "restaurant_id": REST_ID,
            "external_item_id": "ext-1",
            "item_name": "Opus One",
            "inventory_id": INV_ID,
            "master_wine_id": "mw-1",
            "source": "simpos",
        }
    ]
    inventory = [
        {
            "id": INV_ID,
            "restaurant_id": REST_ID,
            "wine_name": "Opus One",
            "stock_live": 4,
            "physical_stock": None,
            "is_active": True,
            "menu_price_current": 420.00,  # WineOps still at old price
            "custom_price": None,
            "target_price": None,
        }
    ]
    agent, router = _make_agent(
        _base_tables(catalog=catalog, mappings=mappings, inventory=inventory)
    )

    result = await agent.check_restaurant(REST_ID)

    assert result["unchanged"] is False
    price_findings = [
        f for f in result["findings"] if f["finding_type"] == "price_change"
    ]
    assert len(price_findings) == 1
    assert price_findings[0]["auto_healed"] is False
    assert price_findings[0]["status"] == "open"
    assert price_findings[0]["severity"] == "warning"

    drift_rows = router.inserts.get("drift_findings", [])
    assert len(drift_rows) == 1
    assert drift_rows[0]["finding_type"] == "price_change"
    assert drift_rows[0]["auto_healed"] is False
    assert drift_rows[0]["status"] == "open"

    # Must NOT create a mapping proposal for price changes
    assert router.inserts.get("pos_catalog_match_proposals", []) == []


# ---------------------------------------------------------------------------
# unchanged snapshot → no-op
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unchanged_snapshot_is_noop():
    catalog = [
        {
            "id": "cat-1",
            "restaurant_id": REST_ID,
            "external_item_id": "ext-1",
            "wine_name": "Stable Wine",
            "vintage": 2020,
            "size_ml": 750,
            "price": 50.00,
            "is_active": True,
        }
    ]
    snap = compute_catalog_snapshot_hash(catalog)
    decision_log = [
        {
            "id": "dl-prev",
            "agent_name": "drift_agent",
            "decision_type": DECISION_SNAPSHOT,
            "restaurant_id": REST_ID,
            "output": {"snapshot_hash": snap, "unchanged": False},
            "created_at": "2026-08-05T10:00:00Z",
        }
    ]
    # Even with a "new" unmapped item present, unchanged hash short-circuits
    agent, router = _make_agent(
        _base_tables(catalog=catalog, decision_log=decision_log)
    )

    result = await agent.check_restaurant(REST_ID)

    assert result["unchanged"] is True
    assert result["findings"] == []
    assert router.inserts.get("pos_catalog_match_proposals", []) == []
    assert router.inserts.get("drift_findings", []) == []

    # Still writes a decision_log for the check
    logs = router.inserts.get("decision_log", [])
    assert len(logs) == 1
    assert logs[0]["decision_type"] == DECISION_SNAPSHOT
    assert logs[0]["output"]["unchanged"] is True


# ---------------------------------------------------------------------------
# C31 guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_sim_restaurant_is_skipped():
    tables = _base_tables()
    tables["restaurants"] = [{"id": "prod-rest", "slug": "downtown-bistro"}]
    agent, router = _make_agent(tables)

    result = await agent.check_restaurant("prod-rest")

    assert result.get("skipped") is True
    assert result["reason"] == "not_sim_namespace"
    assert router.inserts.get("pos_catalog_match_proposals", []) == []
    assert router.inserts.get("drift_findings", []) == []
