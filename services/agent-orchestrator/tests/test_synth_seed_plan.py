"""Wave 2 — SYNTH-03 dry-run seed plan (37-02)."""

from __future__ import annotations


from scripts.synth.ids import sim_org_id, sim_restaurant_id, sim_slug
from scripts.synth.seed import build_seed_plan
from scripts.synth.write_set import SYNTH_WRITE_SET


REQUIRED_PLAN_TABLES = {
    "organizations",
    "organization_members",
    "restaurants",
    "users",
    "user_restaurant_access",
    "restaurant_menus",
    "menu_items",
    "restaurant_inventory",
    "master_wine_library",
    "master_wine_library_submissions",
    "sim_ground_truth_runs",
    "sim_ground_truth_facts",
}


def test_build_seed_plan_dry_run_covers_synth03_surfaces():
    plan = build_seed_plan("bistro")

    assert plan["archetype_id"] == "bistro"
    assert plan["restaurant_id"] == sim_restaurant_id("bistro")
    assert plan["org_id"] == sim_org_id("bistro")
    assert plan["slug"] == sim_slug("bistro")
    assert plan["slug"].startswith("sim-")
    assert plan.get("apply") is False or plan.get("dry_run") is True

    tables = plan["tables"]
    assert set(tables.keys()) == REQUIRED_PLAN_TABLES or REQUIRED_PLAN_TABLES.issubset(
        set(tables.keys())
    )
    # Subset of SYNTH_WRITE_SET
    assert set(tables.keys()).issubset(set(SYNTH_WRITE_SET))

    assert tables["organizations"]["row_count"] == 1
    assert tables["restaurants"]["row_count"] == 1
    assert tables["user_restaurant_access"]["row_count"] == 3
    assert tables["restaurant_menus"]["row_count"] == 1
    assert tables["menu_items"]["row_count"] >= 1
    # Inventory/library are unique-by-signature_hash; menu_items keep 1:1 snapshot lines
    assert tables["restaurant_inventory"]["row_count"] >= 1
    assert (
        tables["restaurant_inventory"]["row_count"] <= tables["menu_items"]["row_count"]
    )
    # Library ALWAYS planned (W6 lock) — one provisional wine per unique signature
    assert (
        tables["master_wine_library"]["row_count"]
        == tables["restaurant_inventory"]["row_count"]
    )
    assert (
        tables["master_wine_library_submissions"]["row_count"]
        == tables["master_wine_library"]["row_count"]
    )
    assert tables["sim_ground_truth_runs"]["row_count"] == 1
    assert tables["sim_ground_truth_facts"]["row_count"] >= 6

    # Inventory uses stock_live — never inventory_stock
    inv_sample = plan["samples"]["restaurant_inventory"][0]
    assert "stock_live" in inv_sample
    assert "inventory_stock" not in inv_sample

    # Menu prices from snapshot only
    menu_sample = plan["samples"]["menu_items"][0]
    assert "bottle_price" in menu_sample
    assert "by_glass_price" in menu_sample

    # Provisional wine UUID5 sim.wine.* + source=sim
    wine = plan["samples"]["master_wine_library"][0]
    assert (
        wine.get("source") == "sim"
        or (wine.get("data_enrichment") or {}).get("source") == "sim"
    )
    assert wine["id"]  # deterministic uuid string

    # Roster roles
    ura_roles = {r["role"] for r in plan["samples"]["user_restaurant_access"]}
    assert ura_roles == {"owner", "manager", "staff"}

    # Dry-run must not embed passwords
    blob = str(plan).lower()
    assert "password" not in blob or "password_hash" not in blob
    assert "eyj" not in blob


def test_build_seed_plan_respects_overrides():
    plan = build_seed_plan(
        "bistro", overrides={"price_tier": "premium", "size": "large"}
    )
    assert plan["profile"]["defaults"]["price_tier"] == "premium"
    assert plan["profile"]["defaults"]["size"] == "large"


def test_build_seed_plan_tables_subset_of_write_set_for_all_archetypes():
    from scripts.synth.recipes import list_archetypes

    for arch in list_archetypes():
        plan = build_seed_plan(arch)
        assert set(plan["tables"].keys()).issubset(set(SYNTH_WRITE_SET))
        assert "inventory_stock" not in plan["tables"]
