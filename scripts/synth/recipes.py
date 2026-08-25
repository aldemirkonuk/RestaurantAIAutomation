"""Archetype recipe loader + profile overrides (SYNTH-01 / SYNTH-05).

Recipes are JSON under ``datasets/sim/archetypes/<id>.json`` — no PyYAML dep.
"""

from __future__ import annotations

import copy
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
ARCHETYPES_DIR = REPO_ROOT / "datasets" / "sim" / "archetypes"

# Locked five named presets (D-05) — no parameter-skin variants in v1.
KNOWN_ARCHETYPES: tuple[str, ...] = (
    "fine-dining",
    "bistro",
    "high-volume-bar",
    "cafe",
    "turkish-clone",
)

SYNTH_01_KNOBS: tuple[str, ...] = (
    "cuisine",
    "size",
    "wine_program_depth",
    "sales_volume",
    "price_tier",
    "ordering_rhythm",
)


class UnknownArchetypeError(KeyError):
    """Raised when archetype_id is not one of the five named presets."""


@dataclass
class OpeningStock:
    default_bottles: int
    min_bottles: int
    max_bottles: int
    by_price_tier: dict[str, int] = field(default_factory=dict)
    by_primary_type: dict[str, int] = field(default_factory=dict)
    threshold_min: int = 5


@dataclass
class RestaurantMeta:
    name: str
    timezone: str
    city: str
    country: str


@dataclass
class RestaurantProfile:
    archetype_id: str
    display_name: str
    snapshot: str
    defaults: dict[str, Any]
    opening_stock: dict[str, Any]
    restaurant: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "archetype_id": self.archetype_id,
            "display_name": self.display_name,
            "snapshot": self.snapshot,
            "defaults": dict(self.defaults),
            "opening_stock": dict(self.opening_stock),
            "restaurant": dict(self.restaurant),
        }


def list_archetypes() -> list[str]:
    """Return the five locked archetype ids in canonical order."""
    return list(KNOWN_ARCHETYPES)


def _recipe_path(archetype_id: str) -> Path:
    return ARCHETYPES_DIR / f"{archetype_id}.json"


def _validate_recipe(data: dict[str, Any], archetype_id: str) -> None:
    if data.get("archetype_id") != archetype_id:
        raise ValueError(
            f"archetype_id mismatch: file has {data.get('archetype_id')!r}, "
            f"expected {archetype_id!r}"
        )
    defaults = data.get("defaults") or {}
    missing = [k for k in SYNTH_01_KNOBS if k not in defaults]
    if missing:
        raise ValueError(f"{archetype_id}: defaults missing knobs {missing}")
    opening = data.get("opening_stock") or {}
    for key in (
        "default_bottles",
        "min_bottles",
        "max_bottles",
        "by_price_tier",
        "by_primary_type",
        "threshold_min",
    ):
        if key not in opening:
            raise ValueError(f"{archetype_id}: opening_stock missing {key}")
    restaurant = data.get("restaurant") or {}
    for key in ("name", "timezone", "city", "country"):
        if key not in restaurant:
            raise ValueError(f"{archetype_id}: restaurant missing {key}")
    if not data.get("snapshot"):
        raise ValueError(f"{archetype_id}: snapshot path required")
    if not data.get("display_name"):
        raise ValueError(f"{archetype_id}: display_name required")


def load_recipe(archetype_id: str) -> RestaurantProfile:
    """Load a named archetype recipe from disk into a RestaurantProfile."""
    if archetype_id not in KNOWN_ARCHETYPES:
        raise UnknownArchetypeError(
            f"Unknown archetype_id {archetype_id!r}; "
            f"expected one of {list(KNOWN_ARCHETYPES)}"
        )
    path = _recipe_path(archetype_id)
    if not path.is_file():
        raise FileNotFoundError(f"Archetype recipe not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    _validate_recipe(data, archetype_id)
    return RestaurantProfile(
        archetype_id=archetype_id,
        display_name=data["display_name"],
        snapshot=data["snapshot"],
        defaults=copy.deepcopy(data["defaults"]),
        opening_stock=copy.deepcopy(data["opening_stock"]),
        restaurant=copy.deepcopy(data["restaurant"]),
    )


def apply_overrides(
    profile: RestaurantProfile,
    overrides: dict[str, Any] | None,
) -> RestaurantProfile:
    """Return a new profile with knob overrides merged into defaults.

    Does not mutate ``profile`` or the on-disk recipe file.
    Unknown override keys that are not SYNTH-01 knobs are ignored for knobs
    but may be applied if present under a nested ``defaults`` key.
    """
    overrides = overrides or {}
    new_defaults = copy.deepcopy(profile.defaults)
    # Flat knob overrides
    for key, value in overrides.items():
        if key in SYNTH_01_KNOBS:
            new_defaults[key] = value
        elif key == "defaults" and isinstance(value, dict):
            for k, v in value.items():
                if k in SYNTH_01_KNOBS:
                    new_defaults[k] = v
    return RestaurantProfile(
        archetype_id=profile.archetype_id,
        display_name=profile.display_name,
        snapshot=profile.snapshot,
        defaults=new_defaults,
        opening_stock=copy.deepcopy(profile.opening_stock),
        restaurant=copy.deepcopy(profile.restaurant),
    )


__all__ = [
    "KNOWN_ARCHETYPES",
    "RestaurantProfile",
    "UnknownArchetypeError",
    "apply_overrides",
    "list_archetypes",
    "load_recipe",
]
