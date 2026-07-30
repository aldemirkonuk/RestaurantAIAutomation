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
