"""Wave 0 / Wave 1 — SYNTH write-set ↔ teardown equality gate (D-11 / D-12)."""

from __future__ import annotations

import pytest

from scripts.synth.write_set import (
    SYNTH_WRITE_SET,
    TEARDOWN_TABLES,
    WriteSetTeardownMismatchError,
    assert_write_set_equals_teardown,
)


REQUIRED_TABLES = {
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
    "sim_ground_truth_facts",
    "sim_ground_truth_runs",
}

# Tables written INDIRECTLY through the POS hub rather than by seed.py. They are
# listed separately because that is exactly why they get forgotten: nothing in
# seed.py mentions them, so a reader auditing the write-set against the seeder
# finds them complete. pos_item_mappings and pos_catalog_match_proposals were
# missing until 2026-08-25 and left 92 production mappings pointing at deleted
# inventory (ADR 0012).
INDIRECT_POS_TABLES = {
    "pos_checks",
    "pos_unresolved_lines",
    "pos_item_mappings",
    "pos_catalog_match_proposals",
}


def test_synth_write_set_equals_teardown_tables():
    assert set(SYNTH_WRITE_SET) == set(TEARDOWN_TABLES)
    assert_write_set_equals_teardown()


def test_synth_write_set_includes_required_tables():
    assert REQUIRED_TABLES.issubset(set(SYNTH_WRITE_SET))
    assert "inventory_stock" not in SYNTH_WRITE_SET
    assert "inventory_stock" not in TEARDOWN_TABLES


def test_indirect_pos_tables_are_torn_down():
    """Every POS table the hub writes behind seed.py's back must be torn down.

    The failure this guards is not a missing delete — it is a SURVIVING one.
    A pos_item_mappings row that outlives its restaurant_inventory row names a
    stock target that no longer exists, so a matching POS line skips the
    unresolved-line queue (pos-hub.service.ts:347) and then fails inside
    apply_stock_movement, depleting nothing and queueing nothing.
    """
    missing = INDIRECT_POS_TABLES - set(SYNTH_WRITE_SET)
    assert not missing, f"POS tables written indirectly but never torn down: {missing}"


def test_indirect_pos_tables_have_teardown_handlers():
    from scripts.synth.teardown import DELETE_ORDER, TEARDOWN_HANDLERS

    for table in sorted(INDIRECT_POS_TABLES):
        assert table in TEARDOWN_HANDLERS, f"no teardown handler for {table}"
        assert table in DELETE_ORDER, f"{table} missing from DELETE_ORDER"


def test_pos_mappings_deleted_before_the_inventory_they_point_at():
    """Children before parents — explicit order, never implicit FK cascade.

    pos_item_mappings.inventory_id cascades on delete since ADR 0012, so the
    rows would go either way; pos_catalog_match_proposals has no such FK and
    would leak. Asserting the order keeps both correct for the same reason the
    simpos_* tables are ordered explicitly despite their own cascades.
    """
    from scripts.synth.teardown import DELETE_ORDER

    inventory_at = DELETE_ORDER.index("restaurant_inventory")
    for table in ("pos_item_mappings", "pos_catalog_match_proposals"):
        assert DELETE_ORDER.index(table) < inventory_at, (
            f"{table} must be deleted before restaurant_inventory"
        )


def test_assert_write_set_equals_teardown_raises_on_drift():
    with pytest.raises(WriteSetTeardownMismatchError):
        assert_write_set_equals_teardown(
            write_set=list(SYNTH_WRITE_SET) + ["extra_table"],
            teardown=TEARDOWN_TABLES,
        )


def test_apply_gate_requires_handler_coverage():
    """D-11/D-12: multi-archetype --apply needs list equality AND handlers."""
    from scripts.synth.teardown import assert_teardown_coverage

    assert_teardown_coverage()


def test_multi_archetype_apply_calls_gate(monkeypatch):
    """generate --apply with ≥2 archetypes aborts when gate fails."""
    from scripts.synth.teardown import (
        WriteSetTeardownCoverageError,
        refuse_multi_archetype_apply_unless_ready,
    )

    def boom():
        raise WriteSetTeardownCoverageError("simulated gate failure")

    with pytest.raises(WriteSetTeardownCoverageError):
        refuse_multi_archetype_apply_unless_ready(
            archetypes=["bistro", "cafe"],
            apply=True,
            coverage_assert=boom,
        )


def test_single_archetype_apply_still_requires_gate():
    from scripts.synth.teardown import (
        WriteSetTeardownCoverageError,
        refuse_multi_archetype_apply_unless_ready,
    )

    def boom():
        raise WriteSetTeardownCoverageError("gate red")

    with pytest.raises(WriteSetTeardownCoverageError):
        refuse_multi_archetype_apply_unless_ready(
            archetypes=["bistro"],
            apply=True,
            coverage_assert=boom,
        )


def test_dry_run_skips_apply_gate():
    from scripts.synth.teardown import refuse_multi_archetype_apply_unless_ready

    # apply=False must not invoke coverage assert
    called = {"n": 0}

    def boom():
        called["n"] += 1
        raise RuntimeError("should not run")

    refuse_multi_archetype_apply_unless_ready(
        archetypes=["bistro", "cafe"],
        apply=False,
        coverage_assert=boom,
    )
    assert called["n"] == 0
