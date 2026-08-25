"""Deterministic UUID5 + sim-* slug helpers for synthetic tenants.

Live restaurants.id is UUID — never use string PKs like ``sim-bistro``.
Teardown filters restaurants via ``slug LIKE 'sim-%'``.
"""

from __future__ import annotations

import uuid

# Fixed project namespace (DNS namespace UUID — stable across runs).
SIM_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def sim_restaurant_id(archetype_id: str) -> str:
    """Return deterministic UUID5 string for a sim restaurant PK."""
    return str(uuid.uuid5(SIM_NS, f"sim.restaurant.{archetype_id}"))


def sim_org_id(archetype_id: str) -> str:
    """Return deterministic UUID5 string for a sim organization PK."""
    return str(uuid.uuid5(SIM_NS, f"sim.org.{archetype_id}"))


def sim_slug(archetype_id: str) -> str:
    """Return ``sim-{archetype_id}`` slug used for teardown filters."""
    return f"sim-{archetype_id}"
