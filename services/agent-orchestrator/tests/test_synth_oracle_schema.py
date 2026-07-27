"""Wave 2 — SYNTH-04 oracle fact types + migration schema (37-02)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from scripts.synth.ids import SIM_NS, sim_restaurant_id, sim_slug
from scripts.synth.oracle import (
    FACT_TYPES,
    SEED_VERSION,
    build_facts,
    build_run_row,
)
from scripts.synth.recipes import load_recipe
from scripts.synth.snapshots import load_snapshot

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATION = (
    REPO_ROOT
    / "supabase"
    / "migrations"
    / "20260727230000_sim_ground_truth.sql"
)

REQUIRED_FACT_KEYS = {
    "profile": {"cuisine", "size", "wine_program_depth", "sales_volume", "price_tier", "ordering_rhythm"},
    "roster": {"role", "user_id", "email_domain"},
    "sku": {"signature_hash", "name", "producer", "vintage"},
    "menu_price": {"bottle_price", "by_glass_price", "currency"},
    "opening_stock": {"stock_live", "threshold_min", "wine_name", "master_wine_id"},
    "menu_quality_meta": {"menu_quality", "sku_count", "priced_sku_count"},
}


def test_migration_file_exists_with_oracle_tables_and_rpc():
    assert MIGRATION.is_file(), f"Missing migration: {MIGRATION}"
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "sim_ground_truth_runs" in sql
    assert "sim_ground_truth_facts" in sql
    assert "seed_sim_restaurant" in sql
    assert "SECURITY DEFINER" in sql
    # Fact-type CHECK covers all six Phase-41 types
    for ft in FACT_TYPES:
        assert ft in sql
    assert "ENABLE ROW LEVEL SECURITY" in sql
    # No anon/authenticated write policies on oracle tables
    assert not re.search(
        r"CREATE POLICY[^;]*ON\s+sim_ground_truth_(runs|facts)[^;]*"
        r"(FOR\s+(INSERT|UPDATE|DELETE|ALL)|TO\s+(anon|authenticated))",
        sql,
        re.IGNORECASE | re.DOTALL,
    )


def test_build_run_row_shape():
    profile = load_recipe("bistro")
    snapshot = load_snapshot("bistro")
    run = build_run_row(
        profile=profile.to_dict(),
        snapshot=snapshot,
        snapshot_path="datasets/sim/menus/bistro.json",
        snapshot_sha256="abc123",
        restaurant_id=sim_restaurant_id("bistro"),
    )
    assert run["restaurant_id"] == sim_restaurant_id("bistro")
    assert run["archetype_id"] == "bistro"
    assert run["seed_version"] == SEED_VERSION
    assert run["menu_quality"] in ("full", "partial")
    assert run["sku_count"] == len(snapshot["items"])
    assert isinstance(run["params"], dict)
    assert "cuisine" in run["params"]


def test_build_facts_emits_all_six_types_with_payload_keys():
    profile = load_recipe("bistro")
    snapshot = load_snapshot("bistro")
    restaurant_id = sim_restaurant_id("bistro")
    roster = [
        {"role": "owner", "user_id": "11111111-1111-1111-1111-111111111111", "email": "owner@wineops.internal"},
        {"role": "manager", "user_id": "22222222-2222-2222-2222-222222222222", "email": "mgr@wineops.internal"},
        {"role": "staff", "user_id": "33333333-3333-3333-3333-333333333333", "email": "staff@wineops.internal"},
    ]
    # opening map: signature_hash -> stock + master wine id
    opening = {}
    for item in snapshot["items"][:3]:
        sig = item["signature_hash"]
        opening[sig] = {
            "stock_live": 12,
            "threshold_min": 5,
            "wine_name": item["wine_name"],
            "master_wine_id": str(__import__("uuid").uuid5(SIM_NS, f"sim.wine.{sig}")),
        }

    facts = build_facts(
        profile=profile.to_dict(),
        snapshot=snapshot,
        roster=roster,
        opening=opening,
        restaurant_id=restaurant_id,
        run_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    )
    by_type = {}
    for fact in facts:
        by_type.setdefault(fact["fact_type"], []).append(fact)
        assert "password" not in str(fact["payload"]).lower()
        assert fact["restaurant_id"] == restaurant_id

    assert set(by_type.keys()) == set(FACT_TYPES)

    profile_fact = by_type["profile"][0]
    assert REQUIRED_FACT_KEYS["profile"].issubset(profile_fact["payload"].keys())

    assert len(by_type["roster"]) == 3
    for rf in by_type["roster"]:
        assert REQUIRED_FACT_KEYS["roster"].issubset(rf["payload"].keys())
        assert "password" not in rf["payload"]

    assert len(by_type["sku"]) == len(snapshot["items"])
    sku0 = by_type["sku"][0]
    assert REQUIRED_FACT_KEYS["sku"].issubset(sku0["payload"].keys())

    assert len(by_type["menu_price"]) == len(snapshot["items"])
    mp = by_type["menu_price"][0]
    assert REQUIRED_FACT_KEYS["menu_price"].issubset(mp["payload"].keys())
    # Prices must come from snapshot — find matching item
    sig = mp["sku_key"]
    src = next(i for i in snapshot["items"] if i["signature_hash"] == sig)
    assert mp["payload"]["bottle_price"] == src["bottle_price"]
    assert mp["payload"]["by_glass_price"] == src["by_glass_price"]

    assert len(by_type["opening_stock"]) == len(opening)
    os0 = by_type["opening_stock"][0]
    assert REQUIRED_FACT_KEYS["opening_stock"].issubset(os0["payload"].keys())

    mq = by_type["menu_quality_meta"][0]
    assert REQUIRED_FACT_KEYS["menu_quality_meta"].issubset(mq["payload"].keys())


def test_sim_slug_for_oracle_restaurant():
    assert sim_slug("bistro").startswith("sim-")
