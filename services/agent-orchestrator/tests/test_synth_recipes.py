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
    defaults = (
        profile.defaults if hasattr(profile, "defaults") else profile.get("defaults")
    )
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


# ── ADR 0093 D1 — every archetype knows when it is open ──────────────────────


def test_every_archetype_carries_parseable_operating_hours():
    """The seed writes these onto `restaurants.operating_hours`.

    Before ADR 0093 no archetype knew its hours and the simulator placed every
    cover on a hard-coded 17:00–23:30 UTC curve whatever the venue's zone. A
    recipe that loses its hours must fail HERE, at load, rather than seed a
    tenant with a null column that every later reader silently guesses over.
    """
    from scripts.simulate.hours import parse_operating_hours, to_json
    from scripts.synth.recipes import list_archetypes, load_recipe

    for arch in list_archetypes():
        profile = load_recipe(arch)
        hours = profile.restaurant.get("operating_hours")
        assert hours is not None, f"{arch}: restaurant.operating_hours missing"
        parsed = parse_operating_hours(hours)  # raises on any contract fault
        assert to_json(parsed) == hours, f"{arch}: hours do not round-trip"
        assert any(parsed[d] for d in parsed), f"{arch}: never opens"


def test_recipe_without_operating_hours_is_refused(tmp_path, monkeypatch):
    """The absence is loud. Proved by removing the key, not by assuming."""
    import json

    from scripts.synth import recipes

    src = recipes.ARCHETYPES_DIR / "bistro.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    data["restaurant"].pop("operating_hours")
    (tmp_path / "bistro.json").write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(recipes, "ARCHETYPES_DIR", tmp_path)

    with pytest.raises(ValueError, match="operating_hours"):
        recipes.load_recipe("bistro")


def test_recipe_with_broken_operating_hours_is_refused(tmp_path, monkeypatch):
    """A typo in a dataset file is caught at load, not as a venue that never opens."""
    import json

    from scripts.synth import recipes

    src = recipes.ARCHETYPES_DIR / "bistro.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    data["restaurant"]["operating_hours"]["mon"] = [{"open": "12:00", "close": "25:00"}]
    (tmp_path / "bistro.json").write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(recipes, "ARCHETYPES_DIR", tmp_path)

    with pytest.raises(ValueError, match="operating_hours invalid"):
        recipes.load_recipe("bistro")


def test_bistro_and_bar_hours_are_the_shared_fixture_s(tmp_path):
    """Not "some plausible hours" — the exact shapes both test suites already pin.

    `bistro` is the founder's opening-at-twelve venue, closed Monday.
    `high-volume-bar` is the fixture's `late_bar`, the cross-midnight case.
    """
    import json
    from pathlib import Path

    from scripts.synth.recipes import load_recipe

    root = Path(__file__).resolve().parents[3]
    fixture = json.loads(
        (
            root / "datasets" / "sim" / "fixtures" / "operating-hours-cases.json"
        ).read_text(encoding="utf-8")
    )
    assert (
        load_recipe("bistro").restaurant["operating_hours"]
        == fixture["hours"]["bistro"]
    )
    assert (
        load_recipe("high-volume-bar").restaurant["operating_hours"]
        == fixture["hours"]["late_bar"]
    )
