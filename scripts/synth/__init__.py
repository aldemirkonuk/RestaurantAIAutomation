"""Synthetic restaurant factory (Phase 37)."""

from scripts.synth.ids import SIM_NS, sim_org_id, sim_restaurant_id, sim_slug
from scripts.synth.recipes import (
    RestaurantProfile,
    UnknownArchetypeError,
    apply_overrides,
    list_archetypes,
    load_recipe,
)
from scripts.synth.write_set import (
    SYNTH_WRITE_SET,
    TEARDOWN_TABLES,
    WriteSetTeardownMismatchError,
    assert_write_set_equals_teardown,
)

__all__ = [
    "SIM_NS",
    "sim_restaurant_id",
    "sim_slug",
    "sim_org_id",
    "RestaurantProfile",
    "UnknownArchetypeError",
    "apply_overrides",
    "list_archetypes",
    "load_recipe",
    "SYNTH_WRITE_SET",
    "TEARDOWN_TABLES",
    "WriteSetTeardownMismatchError",
    "assert_write_set_equals_teardown",
]
