"""Generator write-set ↔ teardown table equality gate (D-11 / D-12).

Full teardown behavior lands in 37-03. This module owns the shared constant
lists so Wave 0 gate tests and later seed/teardown import one source of truth.

Notes
-----
- ``master_wine_library`` / ``master_wine_library_submissions`` are ALWAYS in
  the write-set (seed inserts provisional sim wines with source=sim /
  uuid5 ``sim.wine.*``). Library teardown (37-03) is sim-filtered only —
  never wholesale wipe.
- ``users``: seed upserts shared SIM_* persona mirror rows; teardown must
  NO-OP delete of SIM_* Auth users (D-13 / D-17). Auth users are durable.
- Never include ``inventory_stock`` (absent in live cloud).
- ADR 0093 additions carry a note saying whether an FK already cascades them.
  They are listed regardless: a cascade lives in a migration nobody connects to
  this file, and "it is covered by a cascade" is exactly the assumption that
  leaves simulated rows in a real tenant when the migration changes.
"""

from __future__ import annotations

from typing import Sequence

# Keep lists identical — assert_write_set_equals_teardown enforces equality.
SYNTH_WRITE_SET: list[str] = [
    "organizations",
    "organization_members",
    "restaurants",
    "users",  # mirror rows only — Auth users are NOT deleted on teardown
    "user_restaurant_access",
    "restaurant_menus",
    "menu_items",
    "restaurant_inventory",
    "master_wine_library",  # always — provisional sim wines
    "master_wine_library_submissions",  # always — sim submissions
    "sim_ground_truth_facts",
    "sim_ground_truth_runs",
    # Written INDIRECTLY: `scripts.simulate --apply` posts through
    # POST /pos-hub/webhook/generic_webhook/:restaurantId, and the hub upserts
    # pos_checks. The rows never pass through seed.py, which is exactly why this
    # entry is easy to forget and why forgetting it is leakage — simulated service
    # would survive teardown and blend into a tenant's analytics forever.
    "pos_checks",
    # Written INDIRECTLY: the same POS-hub webhook queues any wine line it
    # can't resolve to an inventory item here instead of dropping it
    # (decision B20) — same leakage risk as pos_checks above.
    "pos_unresolved_lines",
    # SimPOS testbed tables (decisions C23/C24): the fake POS terminal's own
    # state, seeded once from the sim menu then free to diverge (that
    # divergence is the whole point — it's what the drift agent finds).
    # simpos_check_lines/simpos_checks/simpos_tables are written by the
    # SimPOS terminal UI, not by seed.py, for the same reason pos_checks is
    # indirect above.
    "simpos_catalog",
    "simpos_tables",
    "simpos_checks",
    "simpos_check_lines",
    # ── ADR 0093 harness (D-11/D-12) ────────────────────────────────────────
    # The scenario harness writes rows the sim seed never wrote. Every one of
    # these is listed EXPLICITLY even where an FK already cascades: the rule
    # here is an explicit list, not implicit cascade (teardown.py:41). A
    # cascade is a property of the schema and can be changed by a migration
    # nobody connects to this file; an entry cannot.
    #
    # Written DIRECTLY by seed.py's apply path (ADR 0093 D4): opening stock is
    # materialised through apply_stock_movement, which writes one lot and one
    # ledger row per stocked SKU. Before this, seed_sim_restaurant set
    # `stock_live` directly and created NO lots — and `stock_live` is a
    # projection of `inventory_lots`, so a seeded tenant showed 12 bottles and
    # raised `no stock to pour` on the first glass.
    "inventory_lots",  # cascade-covered via restaurant_inventory; listed anyway
    "inventory_transactions",  # cascade-covered via restaurants; listed anyway
    # Written INDIRECTLY by a scenario run: the POS hub's depletion path and
    # the glass-pour RPC.
    "pour_events",  # NO FK to restaurants — nothing cascades these
    "wine_consumption_log",  # cascade-covered via restaurants and inventory
    # Written INDIRECTLY: the hub resolves POS lines against these, and the
    # catalog matcher proposes new ones.
    "pos_item_mappings",  # NO FK to restaurants (only inventory_id, cascading)
    "pos_catalog_match_proposals",  # candidate_inventory_id is SET NULL, not cascade
    # Written INDIRECTLY: a check carries a table, and pos_checks.table_id
    # references restaurant_tables with NO on-delete action — so pos_checks
    # MUST be deleted first or this delete fails. See DELETE_ORDER.
    "restaurant_tables",  # NO FK to restaurants
    # Written INDIRECTLY by the user-side path a scenario exercises on demand:
    # the low-stock sweep persists an inbox row per member, and the insight
    # generator writes analytics_insights.
    "notifications",  # cascade-covered via restaurants; listed anyway
    "analytics_insights",  # NO FK to restaurants
    # Written DIRECTLY by the scenario runner: one row per run, holding the
    # expectation the verifier compares against (ADR 0093 D2).
    "sim_scenario_runs",  # cascade-covered via restaurants; listed anyway
]

TEARDOWN_TABLES: list[str] = list(SYNTH_WRITE_SET)


class WriteSetTeardownMismatchError(ValueError):
    """Raised when SYNTH_WRITE_SET and TEARDOWN_TABLES diverge."""


def assert_write_set_equals_teardown(
    write_set: Sequence[str] | None = None,
    teardown: Sequence[str] | None = None,
) -> None:
    """Raise WriteSetTeardownMismatchError if the two table sets differ."""
    ws = set(write_set if write_set is not None else SYNTH_WRITE_SET)
    td = set(teardown if teardown is not None else TEARDOWN_TABLES)
    if ws != td:
        only_write = sorted(ws - td)
        only_teardown = sorted(td - ws)
        raise WriteSetTeardownMismatchError(
            "SYNTH_WRITE_SET != TEARDOWN_TABLES; "
            f"only_in_write_set={only_write}; only_in_teardown={only_teardown}"
        )
