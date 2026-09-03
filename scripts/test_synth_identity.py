"""The seed's identity mirror, and the collapse/reuse it enables (ADR 0093).

Fixture: `datasets/sim/fixtures/wine-identity-vectors.json` — outputs of the SQL
functions `wine_signature_hash` / `wine_normalize_text` read from production on
2026-09-03. A mirror that stops matching this file would make the seed collide
inside its own transaction again, or worse, silently reuse the wrong wine.

    python3 -m pytest scripts/test_synth_identity.py -q
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.synth.identity import (
    wine_normalize_text,
    wine_signature_for_item,
    wine_signature_hash,
)
from scripts.synth.seed import _resolve_library_identities, build_seed_plan

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE = REPO_ROOT / "datasets" / "sim" / "fixtures" / "wine-identity-vectors.json"


@pytest.fixture(scope="module")
def fx() -> dict:
    return json.loads(FIXTURE.read_text())


def test_fixture_is_not_vacuous(fx):
    assert len(fx["vectors"]) >= 7
    assert len(fx["bistro_menu_identities"]) >= 90


def test_normalize_matches_sql_on_every_vector(fx):
    for v in fx["vectors"]:
        for k in ("p_producer", "p_name", "p_country", "p_region", "p_grape_variety"):
            assert wine_normalize_text(v["in"][k]) == v["norm"][k], (k, v["in"][k])


def test_hash_matches_sql_on_every_vector(fx):
    for v in fx["vectors"]:
        i = v["in"]
        got = wine_signature_hash(
            i["p_producer"],
            i["p_name"],
            i["p_vintage"],
            i["p_country"],
            i["p_region"],
            i["p_grape_variety"],
        )
        assert got == v["hash"], i["p_name"]


def test_hash_matches_sql_for_the_whole_bistro_menu(fx):
    mism = []
    for row in fx["bistro_menu_identities"]:
        i = row["in"]
        got = wine_signature_hash(
            i["p_producer"],
            i["p_name"],
            i["p_vintage"],
            i["p_country"],
            i["p_region"],
            i["p_grape_variety"],
        )
        if got != row["hash"]:
            mism.append(i["p_name"])
    assert mism == []


def test_the_menu_has_fewer_identities_than_line_hashes(fx):
    rows = fx["bistro_menu_identities"]
    assert len({r["signature_hash"] for r in rows}) == 92
    assert len({r["hash"] for r in rows}) == 81


def test_plan_collapses_lines_that_share_an_identity():
    plan = build_seed_plan("bistro")
    payload = plan["payload"]
    wines = payload["master_wine_library"]
    inventory = payload["restaurant_inventory"]
    subs = payload["master_wine_library_submissions"]
    assert len(wines) == plan["library_identities"] == 81
    assert plan["identity_collapsed"] == 11
    # restaurant_inventory is UNIQUE per (restaurant, wine): one row per
    # identity, owned by the first hash that carried it; one submission per
    # distinct menu line; every reference points at a wine the plan inserts
    assert len(inventory) == 81
    assert len(subs) == 92
    assert len(set(plan["inventory_id_by_sig"].values())) == 81
    assert len(plan["inventory_id_by_sig"]) == 92
    wine_ids = {w["id"] for w in wines}
    assert {r["master_wine_id"] for r in inventory} <= wine_ids
    assert len({r["master_wine_id"] for r in inventory}) == len(inventory)
    assert {s["matched_master_id"] for s in subs} <= wine_ids
    assert {m["wine_library_id"] for m in payload["menu_items"]} <= wine_ids
    # the library identity is what the trigger will recompute — no two inserted
    # wines may share one
    idents = [wine_signature_for_item(_as_item(w)) for w in wines]
    assert len(idents) == len(set(idents))


def _as_item(w: dict) -> dict:
    return {
        "producer": w.get("producer"),
        "wine_name": w.get("name"),
        "vintage": w.get("vintage"),
        "country": w.get("country"),
        "region": w.get("region"),
        "grape_variety": w.get("grape_variety"),
    }


class _FakeRest:
    """Answers parity with the Python mirror and pretends one wine already exists."""

    def __init__(self, existing: dict[str, str], drift_for: str | None = None):
        self.existing = existing
        self.drift_for = drift_for
        self.calls: list[tuple[str, str]] = []

    def __call__(self, method, path, *, json_body=None, params=None):
        self.calls.append((method, path))
        if path.endswith("/rpc/wine_signature_hash"):
            if self.drift_for and json_body["p_name"] == self.drift_for:
                return "0" * 64
            return wine_signature_hash(
                json_body["p_producer"],
                json_body["p_name"],
                json_body["p_vintage"],
                json_body["p_country"],
                json_body["p_region"],
                json_body["p_grape_variety"],
            )
        if path.endswith("/master_wine_library") and method == "GET":
            wanted = params["signature_hash"][len("in.(") : -1].split(",")
            return [
                {"id": self.existing[h], "signature_hash": h}
                for h in wanted
                if h in self.existing
            ]
        raise AssertionError(f"unexpected call {method} {path}")


def test_resolver_reuses_an_existing_library_row_everywhere():
    plan = build_seed_plan("bistro")
    first = plan["payload"]["master_wine_library"][0]
    identity = plan["identity_by_sig"][first["signature_hash"]]
    sim_id = first["id"]
    rest = _FakeRest({identity: "11111111-1111-1111-1111-111111111111"})
    out = _resolve_library_identities(plan, rest)
    assert out["library_reused"] == 1 and out["library_inserted"] == 80
    # the collapsed inventory row moved with its wine
    assert all(
        r["master_wine_id"] != sim_id for r in plan["payload"]["restaurant_inventory"]
    )
    assert out["identity_parity_checked"] == 81
    payload = plan["payload"]
    assert all(w["id"] != sim_id for w in payload["master_wine_library"])
    # every reference moved to the existing row, none left dangling
    refs = [r["master_wine_id"] for r in payload["restaurant_inventory"]]
    refs += [s["matched_master_id"] for s in payload["master_wine_library_submissions"]]
    refs += [m["wine_library_id"] for m in payload["menu_items"]]
    assert sim_id not in refs
    assert "11111111-1111-1111-1111-111111111111" in refs
    assert sim_id not in json.dumps(payload["oracle_facts"])
    assert sim_id not in json.dumps(plan["opening_stock_plan"])


def test_resolver_refuses_on_mirror_drift():
    plan = build_seed_plan("bistro")
    name = plan["payload"]["master_wine_library"][3]["name"]
    with pytest.raises(RuntimeError, match="no longer matches"):
        _resolve_library_identities(plan, _FakeRest({}, drift_for=name))


def test_resolver_with_nothing_existing_inserts_everything():
    plan = build_seed_plan("bistro")
    out = _resolve_library_identities(plan, _FakeRest({}))
    assert out == {
        "library_reused": 0,
        "library_inserted": 81,
        "identity_parity_checked": 81,
        "library_remap": {},
    }


def test_engine_snapshot_uses_the_seed_plan_inventory_rows():
    """The scenario engine must pour from the inventory rows the seed created."""
    from scripts.simulate.scenarios import (
        build_inventory_from_archetype,
        inventory_from_rest_rows,
    )
    from scripts.synth.seed import plan_wine_identities

    items = json.loads(
        (REPO_ROOT / "datasets" / "sim" / "menus" / "bistro.json").read_text()
    )["items"]
    ident = plan_wine_identities("bistro", items)
    snap = build_inventory_from_archetype("bistro", items)
    assert len(snap) == 92
    assert {row.id for row in snap.values()} == set(ident.inventory_id_by_sig.values())
    assert len({row.id for row in snap.values()}) == 81
    for sig, row in snap.items():
        assert row.id == ident.inventory_id_by_sig[sig]
    # the REST path: one row serving several hashes yields the same object per hash
    by_id: dict[str, list[str]] = {}
    for sig, inv_id in ident.inventory_id_by_sig.items():
        by_id.setdefault(inv_id, []).append(sig)
    shared_id = next(i for i, sigs in by_id.items() if len(sigs) > 1)
    rows = [
        {
            "id": shared_id,
            "wine_name": "X",
            "master_wine_id": "w",
            "stock_live": 4,
            "threshold_min": 2,
        }
    ]
    got = inventory_from_rest_rows(rows, signature_by_inventory_id=by_id)
    assert len(got) == len(by_id[shared_id]) >= 2
    assert len({id(v) for v in got.values()}) == 1


def test_personas_are_bound_to_the_seeded_tenant():
    from scripts.synth.seed import _bind_personas_to_restaurant

    plan = build_seed_plan("bistro")
    plan["payload"]["users"] = [
        {"user_id": "00000000-0000-0000-0000-000000000001"},
        {"user_id": "00000000-0000-0000-0000-000000000002"},
    ]
    calls: list[tuple] = []

    def rest(method, path, *, json_body=None, params=None):
        calls.append((method, path, params, json_body))
        if method == "GET":
            return [
                {"user_id": u, "restaurant_id": plan["restaurant_id"]}
                for u in (
                    "00000000-0000-0000-0000-000000000001",
                    "00000000-0000-0000-0000-000000000002",
                )
            ]
        return None

    out = _bind_personas_to_restaurant(plan, rest)
    assert out == {"personas_bound": 2}
    patch = next(c for c in calls if c[0] == "PATCH")
    assert patch[3] == {"restaurant_id": plan["restaurant_id"]}
    assert patch[2]["user_id"].startswith("in.(")

    def rest_unbound(method, path, *, json_body=None, params=None):
        return [] if method == "GET" else None

    with pytest.raises(RuntimeError, match="persona binding"):
        _bind_personas_to_restaurant(plan, rest_unbound)
