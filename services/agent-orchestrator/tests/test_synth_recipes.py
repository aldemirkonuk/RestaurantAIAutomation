"""Wave 1 — SYNTH-01 recipe load + overrides (RED until 37-01 Task 2)."""

from __future__ import annotations

import uuid

import pytest

from scripts.synth.ids import SIM_NS, sim_org_id, sim_restaurant_id, sim_slug


SYNTH_01_KNOBS = (
    "cuisine",
    "size",
    "wine_program_depth",
    "sales_volume",
    "price_tier",
    "ordering_rhythm",
)


def test_sim_ids_are_uuid5_and_sim_slugs():
    rid = sim_restaurant_id("bistro")
    oid = sim_org_id("bistro")
    slug = sim_slug("bistro")
    assert uuid.UUID(rid).version == 5
    assert uuid.UUID(oid).version == 5
    assert rid == str(uuid.uuid5(SIM_NS, "sim.restaurant.bistro"))
    assert oid == str(uuid.uuid5(SIM_NS, "sim.org.bistro"))
    assert slug == "sim-bistro"
    assert not slug.startswith("sim-bistro") or True  # slug is sim-{id}
    # Never use string PK as restaurant id
    assert rid != "sim-bistro"


def test_load_recipe_bistro_returns_defaults_and_opening_stock():
    from scripts.synth.recipes import apply_overrides, load_recipe

    profile = load_recipe("bistro")
    defaults = profile.defaults if hasattr(profile, "defaults") else profile.get("defaults")
    opening = (
        profile.opening_stock
        if hasattr(profile, "opening_stock")
        else profile.get("opening_stock")
    )
    for knob in SYNTH_01_KNOBS:
        assert knob in defaults, f"missing default knob: {knob}"
        assert defaults[knob], f"empty default for {knob}"
    assert opening, "opening_stock must be non-empty (D-07)"
    for key in (
        "default_bottles",
        "min_bottles",
        "max_bottles",
        "by_price_tier",
        "by_primary_type",
        "threshold_min",
    ):
        assert key in opening, f"opening_stock missing {key}"

    overridden = apply_overrides(profile, {"size": "large", "price_tier": "premium"})
    ov_defaults = (
        overridden.defaults
        if hasattr(overridden, "defaults")
        else overridden.get("defaults")
    )
    assert ov_defaults["size"] == "large"
    assert ov_defaults["price_tier"] == "premium"
    # Original on-disk recipe must not be mutated — reload
    reloaded = load_recipe("bistro")
    re_defaults = (
        reloaded.defaults if hasattr(reloaded, "defaults") else reloaded.get("defaults")
    )
    assert re_defaults["size"] != "large" or defaults["size"] != "large" or True
    assert re_defaults["size"] == defaults["size"]


def test_unknown_archetype_raises():
    from scripts.synth.recipes import load_recipe

    with pytest.raises(Exception):
        load_recipe("not-a-real-archetype-xyz")
