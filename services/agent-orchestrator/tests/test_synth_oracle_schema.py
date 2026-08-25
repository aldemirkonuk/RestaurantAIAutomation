"""Wave 2 — SYNTH-04 oracle fact types + migration schema (37-02)."""

from __future__ import annotations

import re
from pathlib import Path


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
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"


def _schema_sql() -> str:
    """Every migration concatenated.

    This used to read one hardcoded file, 20260727230000_sim_ground_truth.sql.
    The schema baseline in adc4131 folded all per-feature migrations into a
    single dump and deleted that file, so the test failed on a missing path
    while the schema it was checking was entirely intact.
    """
    parts = [
        p.read_text(encoding="utf-8") for p in sorted(MIGRATIONS_DIR.glob("*.sql"))
    ]
    assert parts, f"No migrations found in {MIGRATIONS_DIR}"
    return "\n".join(parts)


def _table_def(table: str) -> str:
    """Just the CREATE TABLE block for `table`.

    Scoping matters more than it used to. The baseline is ~15k lines holding the
    whole schema, so a bare `assert "SECURITY DEFINER" in sql` or
    `assert "profile" in sql` would pass against the surrounding dump even if
    this table were dropped entirely. Slicing keeps each assertion about the
    thing it names.
    """
    sql = _schema_sql()
    match = re.search(
        rf"CREATE TABLE (?:public\.)?{table}\s*\((.*?)\n\);", sql, re.DOTALL
    )
    assert match, f"No CREATE TABLE for {table} in any migration"
    return match.group(1)


REQUIRED_FACT_KEYS = {
    "profile": {
        "cuisine",
        "size",
        "wine_program_depth",
        "sales_volume",
        "price_tier",
        "ordering_rhythm",
    },
    "roster": {"role", "user_id", "email_domain"},
    "sku": {"signature_hash", "name", "producer", "vintage"},
    "menu_price": {"bottle_price", "by_glass_price", "currency"},
    "opening_stock": {"stock_live", "threshold_min", "wine_name", "master_wine_id"},
    "menu_quality_meta": {"menu_quality", "sku_count", "priced_sku_count"},
}


def test_migration_file_exists_with_oracle_tables_and_rpc():
    sql = _schema_sql()

    # Both oracle tables are defined (the helper raises if either is absent).
    facts_def = _table_def("sim_ground_truth_facts")
    _table_def("sim_ground_truth_runs")

    # The seeding RPC exists and runs as definer — scoped to the function so a
    # SECURITY DEFINER elsewhere in the schema cannot satisfy this.
    fn = re.search(
        r"CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?seed_sim_restaurant\b.*?"
        r"(\$[A-Za-z_]*\$)",
        sql,
        re.DOTALL | re.IGNORECASE,
    )
    assert fn, "seed_sim_restaurant() is not defined in any migration"
    assert "SECURITY DEFINER" in sql[fn.start() : fn.end()]

    # Fact-type CHECK covers all six Phase-41 types. Asserted against the facts
    # table definition, not the whole schema: words like "profile" and "sku"
    # appear all over a full dump and would pass with the constraint deleted.
    for ft in FACT_TYPES:
        assert ft in facts_def, f"fact_type CHECK is missing {ft!r}"

    # RLS on the oracle tables specifically.
    for table in ("sim_ground_truth_facts", "sim_ground_truth_runs"):
        assert re.search(
            rf"ALTER TABLE (?:ONLY )?(?:public\.)?{table} ENABLE ROW LEVEL SECURITY",
            sql,
            re.IGNORECASE,
        ), f"{table} does not have RLS enabled"
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
        {
            "role": "owner",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "email": "owner@wineops.internal",
        },
        {
            "role": "manager",
            "user_id": "22222222-2222-2222-2222-222222222222",
            "email": "mgr@wineops.internal",
        },
        {
            "role": "staff",
            "user_id": "33333333-3333-3333-3333-333333333333",
            "email": "staff@wineops.internal",
        },
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
