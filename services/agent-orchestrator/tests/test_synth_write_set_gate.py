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


def test_synth_write_set_equals_teardown_tables():
    assert set(SYNTH_WRITE_SET) == set(TEARDOWN_TABLES)
    assert_write_set_equals_teardown()


def test_synth_write_set_includes_required_tables():
    assert REQUIRED_TABLES.issubset(set(SYNTH_WRITE_SET))
    assert "inventory_stock" not in SYNTH_WRITE_SET
    assert "inventory_stock" not in TEARDOWN_TABLES


def test_assert_write_set_equals_teardown_raises_on_drift():
    with pytest.raises(WriteSetTeardownMismatchError):
        assert_write_set_equals_teardown(
            write_set=list(SYNTH_WRITE_SET) + ["extra_table"],
            teardown=TEARDOWN_TABLES,
        )
