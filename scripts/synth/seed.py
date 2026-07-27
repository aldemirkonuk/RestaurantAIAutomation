"""Dry-run seed plans + atomic apply via seed_sim_restaurant RPC (SYNTH-03/04).

Default path is dry-run (``apply=False``). Cloud mutations require ``apply=True``.
CLI ``--apply`` multi-archetype gate lands in 37-03 — not here.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, Mapping

from scripts.synth.auth_personas import PERSONA_ROLES, ensure_personas
from scripts.synth.ids import SIM_NS, sim_org_id, sim_restaurant_id, sim_slug
from scripts.synth.oracle import SEED_VERSION, build_facts, build_run_row
from scripts.synth.recipes import apply_overrides, load_recipe
from scripts.synth.snapshots import MENUS_DIR, load_snapshot
from scripts.synth.write_set import SYNTH_WRITE_SET

REPO_ROOT = Path(__file__).resolve().parents[2]


def sim_wine_id(signature_hash: str) -> str:
    """Deterministic provisional master_wine_library id (sim.wine.*)."""
    return str(uuid.uuid5(SIM_NS, f"sim.wine.{signature_hash}"))


def sim_menu_id(archetype_id: str) -> str:
    return str(uuid.uuid5(SIM_NS, f"sim.menu.{archetype_id}"))


def sim_inventory_id(archetype_id: str, signature_hash: str) -> str:
    return str(uuid.uuid5(SIM_NS, f"sim.inventory.{archetype_id}.{signature_hash}"))


def sim_menu_item_id(archetype_id: str, signature_hash: str) -> str:
    return str(uuid.uuid5(SIM_NS, f"sim.menu_item.{archetype_id}.{signature_hash}"))


def sim_submission_id(archetype_id: str, signature_hash: str) -> str:
    return str(uuid.uuid5(SIM_NS, f"sim.submission.{archetype_id}.{signature_hash}"))


def sim_run_id(archetype_id: str) -> str:
    return str(uuid.uuid5(SIM_NS, f"sim.oracle_run.{archetype_id}"))


def compute_opening_stock(
    item: Mapping[str, Any],
    opening_cfg: Mapping[str, Any],
    *,
    restaurant_price_tier: str | None = None,
) -> int:
    """Compute opening bottles for a SKU from archetype opening_stock (D-07).

    Precedence: by_primary_type → by_price_tier (restaurant tier) → default_bottles.
    Clamped to [min_bottles, max_bottles].
    """
    default = int(opening_cfg.get("default_bottles", 12))
    min_b = int(opening_cfg.get("min_bottles", 0))
    max_b = int(opening_cfg.get("max_bottles", 9999))
    by_type = dict(opening_cfg.get("by_primary_type") or {})
    by_tier = dict(opening_cfg.get("by_price_tier") or {})

    primary = item.get("primary_type")
    bottles = default
    if primary and primary in by_type:
        bottles = int(by_type[primary])
    elif restaurant_price_tier and restaurant_price_tier in by_tier:
        bottles = int(by_tier[restaurant_price_tier])

    return max(min_b, min(max_b, bottles))


def _snapshot_sha256(archetype_id: str) -> tuple[str, str]:
    path = MENUS_DIR / f"{archetype_id}.json"
    rel = f"datasets/sim/menus/{archetype_id}.json"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return rel, digest


def _placeholder_roster() -> list[dict[str, Any]]:
    """Dry-run roster placeholders — real user_ids come from ensure_personas on apply."""
    out = []
    for role in ("owner", "manager", "staff"):
        out.append(
            {
                "role": role,
                "user_id": str(uuid.uuid5(SIM_NS, f"sim.persona.{role}")),
                "email": f"sim-{role}@wineops.internal",
                "email_domain": "wineops.internal",
            }
        )
    return out


def build_seed_plan(
    archetype_id: str,
    overrides: dict[str, Any] | None = None,
    *,
    roster: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a structured dry-run seed plan — no network (SYNTH-03).

    Plan tables are always a subset of ``SYNTH_WRITE_SET``. Provisional
    ``master_wine_library`` (+ submissions) rows are ALWAYS included.
    """
    profile = apply_overrides(load_recipe(archetype_id), overrides)
    snapshot = load_snapshot(archetype_id)
    items = list(snapshot.get("items") or [])
    restaurant_id = sim_restaurant_id(archetype_id)
    org_id = sim_org_id(archetype_id)
    slug = sim_slug(archetype_id)
    menu_id = sim_menu_id(archetype_id)
    snap_path, snap_sha = _snapshot_sha256(archetype_id)
    opening_cfg = profile.opening_stock
    threshold_min = int(opening_cfg.get("threshold_min", 5))
    price_tier = (profile.defaults or {}).get("price_tier")
    roster_rows = roster if roster is not None else _placeholder_roster()

    wines: list[dict[str, Any]] = []
    submissions: list[dict[str, Any]] = []
    menu_items: list[dict[str, Any]] = []
    inventory: list[dict[str, Any]] = []
    opening_map: dict[str, dict[str, Any]] = {}

    for item in items:
        sig = item["signature_hash"]
        wine_id = sim_wine_id(sig)
        stock_live = compute_opening_stock(
            item, opening_cfg, restaurant_price_tier=price_tier
        )
        wine_row = {
            "id": wine_id,
            "name": item.get("wine_name"),
            "producer": item.get("producer"),
            "vintage": item.get("vintage"),
            "region": item.get("region"),
            "country": item.get("country"),
            "grape_variety": item.get("grape_variety"),
            "wine_type": item.get("primary_type"),
            "signature_hash": sig,
            "source": "sim",
            "enrichment_source": "sim",
            "data_enrichment": {"source": "sim", "archetype_id": archetype_id},
        }
        wines.append(wine_row)
        submissions.append(
            {
                "id": sim_submission_id(archetype_id, sig),
                "restaurant_id": restaurant_id,
                "signature_hash": sig,
                "status": "accepted",
                "matched_master_id": wine_id,
                "payload": {
                    "source": "sim",
                    "wine_name": item.get("wine_name"),
                    "producer": item.get("producer"),
                    "bottle_price": item.get("bottle_price"),
                    "by_glass_price": item.get("by_glass_price"),
                },
            }
        )
        menu_items.append(
            {
                "id": sim_menu_item_id(archetype_id, sig),
                "menu_id": menu_id,
                "restaurant_id": restaurant_id,
                "name": item.get("wine_name"),
                "producer": item.get("producer"),
                "vintage": None if item.get("vintage") is None else str(item.get("vintage")),
                "region": item.get("region"),
                "country": item.get("country"),
                "grape_variety": item.get("grape_variety"),
                "bottle_price": item.get("bottle_price"),  # snapshot only
                "by_glass_price": item.get("by_glass_price"),
                "wine_library_id": wine_id,
                "source": "manual",
                "status": "approved",
            }
        )
        inv_row = {
            "id": sim_inventory_id(archetype_id, sig),
            "restaurant_id": restaurant_id,
            "master_wine_id": wine_id,
            "wine_name": item.get("wine_name"),
            "stock_live": stock_live,
            "threshold_min": threshold_min,
            "custom_price": item.get("bottle_price"),
            "is_active": True,
        }
        inventory.append(inv_row)
        opening_map[sig] = {
            "stock_live": stock_live,
            "threshold_min": threshold_min,
            "wine_name": item.get("wine_name"),
            "master_wine_id": wine_id,
        }

    run_id = sim_run_id(archetype_id)
    run_row = build_run_row(
        profile=profile.to_dict(),
        snapshot=snapshot,
        snapshot_path=snap_path,
        snapshot_sha256=snap_sha,
        restaurant_id=restaurant_id,
        run_id=run_id,
        seed_version=SEED_VERSION,
    )
    facts = build_facts(
        profile=profile.to_dict(),
        snapshot=snapshot,
        roster=roster_rows,
        opening=opening_map,
        restaurant_id=restaurant_id,
        run_id=run_id,
    )

    org_row = {
        "id": org_id,
        "name": f"{profile.restaurant.get('name', profile.display_name)} Org",
    }
    restaurant_row = {
        "id": restaurant_id,
        "organization_id": org_id,
        "name": profile.restaurant.get("name"),
        "slug": slug,
        "timezone": profile.restaurant.get("timezone"),
        "city": profile.restaurant.get("city"),
        "country": profile.restaurant.get("country"),
        "cuisine_type": profile.defaults.get("cuisine"),
        "default_threshold_min": threshold_min,
        "is_active": True,
    }
    menu_row = {
        "id": menu_id,
        "restaurant_id": restaurant_id,
        "name": "Wine List",
        "menu_type": "beverage",
        "status": "active",
        "season": "year_round",
    }
    ura_rows = [
        {
            "user_id": m["user_id"],
            "restaurant_id": restaurant_id,
            "role": m["role"],
            "is_active": True,
        }
        for m in roster_rows
    ]
    org_member_rows = [
        {
            "organization_id": org_id,
            "user_id": m["user_id"],
            "role": m["role"],
        }
        for m in roster_rows
    ]
    user_mirrors = [
        {
            "user_id": m["user_id"],
            "email": m.get("email"),
            "name": f"Sim {m['role'].title()}",
            "role": m["role"],
        }
        for m in roster_rows
    ]

    tables = {
        "organizations": {"row_count": 1},
        "organization_members": {"row_count": len(org_member_rows)},
        "restaurants": {"row_count": 1},
        "users": {"row_count": len(user_mirrors)},
        "user_restaurant_access": {"row_count": len(ura_rows)},
        "restaurant_menus": {"row_count": 1},
        "menu_items": {"row_count": len(menu_items)},
        "restaurant_inventory": {"row_count": len(inventory)},
        "master_wine_library": {"row_count": len(wines)},
        "master_wine_library_submissions": {"row_count": len(submissions)},
        "sim_ground_truth_runs": {"row_count": 1},
        "sim_ground_truth_facts": {"row_count": len(facts)},
    }
    # Sanity: planned tables ⊆ write-set
    unknown = set(tables) - set(SYNTH_WRITE_SET)
    if unknown:
        raise RuntimeError(f"seed plan tables not in SYNTH_WRITE_SET: {sorted(unknown)}")

    payload = {
        "organization": org_row,
        "organization_members": org_member_rows,
        "restaurant": restaurant_row,
        "users": user_mirrors,
        "user_restaurant_access": ura_rows,
        "restaurant_menu": menu_row,
        "menu_items": menu_items,
        "restaurant_inventory": inventory,
        "master_wine_library": wines,
        "master_wine_library_submissions": submissions,
        "oracle_run": run_row,
        "oracle_facts": facts,
    }

    return {
        "archetype_id": archetype_id,
        "restaurant_id": restaurant_id,
        "org_id": org_id,
        "slug": slug,
        "dry_run": True,
        "apply": False,
        "profile": profile.to_dict(),
        "snapshot_path": snap_path,
        "snapshot_sha256": snap_sha,
        "sku_count": len(items),
        "tables": tables,
        "samples": {
            "restaurants": [restaurant_row],
            "user_restaurant_access": ura_rows,
            "menu_items": menu_items[:3],
            "restaurant_inventory": inventory[:3],
            "master_wine_library": wines[:3],
        },
        "payload": payload,
        "persona_roles": dict(PERSONA_ROLES),
    }


def build_rpc_payload(plan: Mapping[str, Any]) -> dict[str, Any]:
    """Extract the JSON body passed to ``seed_sim_restaurant``."""
    return dict(plan["payload"])


def apply_seed(
    archetype_id: str,
    *,
    apply: bool = False,
    overrides: dict[str, Any] | None = None,
    rpc_caller=None,
) -> dict[str, Any]:
    """Dry-run by default. When ``apply=True``, ensure personas then call RPC.

    ``rpc_caller`` is injectable for unit tests: ``callable(payload) -> dict``.
    Full RPC body lands in Task 3 / migration; this stub raises until wired.
    """
    if not apply:
        return build_seed_plan(archetype_id, overrides=overrides)

    personas = ensure_personas()
    roster = [
        {
            "role": role,
            "user_id": personas[role]["user_id"],
            "email": personas[role]["email"],
            "email_domain": personas[role]["email"].rsplit("@", 1)[-1],
        }
        for role in ("owner", "manager", "staff")
    ]
    plan = build_seed_plan(archetype_id, overrides=overrides, roster=roster)
    plan["dry_run"] = False
    plan["apply"] = True
    payload = build_rpc_payload(plan)

    if rpc_caller is not None:
        result = rpc_caller(payload)
        plan["rpc_result"] = result
        return plan

    # Prefer supabase.rpc; optional DATABASE_URL path is secondary (Task 3).
    raise RuntimeError(
        "apply_seed(apply=True) requires rpc_caller or Task-3 seed_sim_restaurant wiring"
    )


__all__ = [
    "apply_seed",
    "build_rpc_payload",
    "build_seed_plan",
    "compute_opening_stock",
    "sim_wine_id",
]
