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


# ── ADR 0093 harness additions (D-11/D-12) ──────────────────────────────────
# Named one by one rather than looped over an exported constant: a loop over
# the list under test proves only that it equals itself.


@pytest.mark.parametrize(
    "table",
    [
        "sim_scenario_runs",
        "restaurant_tables",
        "pour_events",
        "inventory_transactions",
        "inventory_lots",
        "wine_consumption_log",
        "notifications",
        "analytics_insights",
        "pos_item_mappings",
        "pos_catalog_match_proposals",
    ],
)
def test_adr_0093_table_is_in_the_write_set_and_teardown(table: str):
    assert table in SYNTH_WRITE_SET
    assert table in TEARDOWN_TABLES


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
