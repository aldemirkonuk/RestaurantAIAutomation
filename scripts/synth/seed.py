"""Dry-run seed plans + atomic apply via seed_sim_restaurant RPC (SYNTH-03/04).

Default path is dry-run (``apply=False``). Cloud mutations require ``apply=True``.
``apply=True`` always runs write-set ↔ teardown coverage gate (D-11/D-12).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, Mapping  # Any used by execute_atomic_seed conn

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
    seen_wine_sigs: set[str] = set()

    for idx, item in enumerate(items):
        sig = item["signature_hash"]
        wine_id = sim_wine_id(sig)
        stock_live = compute_opening_stock(
            item, opening_cfg, restaurant_price_tier=price_tier
        )
        if sig not in seen_wine_sigs:
            seen_wine_sigs.add(sig)
            wines.append(
                {
                    "id": wine_id,
                    # Live schema requires wine_id (varchar(20)) in addition to uuid id
                    "wine_id": f"sim{sig.replace('-', '')[:17]}",
                    "name": item.get("wine_name"),
                    "producer": item.get("producer"),
                    "vintage": item.get("vintage"),
                    "region": item.get("region"),
                    "country": item.get("country"),
                    "grape_variety": item.get("grape_variety"),
                    # Live schema: primary_type + source (not wine_type / enrichment_source)
                    "primary_type": item.get("primary_type") or "unknown",
                    "signature_hash": sig,
                    "source": "sim",
                    "data_enrichment": {"source": "sim", "archetype_id": archetype_id},
                }
            )
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
            inventory.append(
                {
                    "id": sim_inventory_id(archetype_id, sig),
                    "restaurant_id": restaurant_id,
                    "master_wine_id": wine_id,
                    "wine_name": item.get("wine_name"),
                    "stock_live": stock_live,
                    "threshold_min": threshold_min,
                    "custom_price": item.get("bottle_price"),
                    "is_active": True,
                }
            )
            opening_map[sig] = {
                "stock_live": stock_live,
                "threshold_min": threshold_min,
                "wine_name": item.get("wine_name"),
                "master_wine_id": wine_id,
            }
        # Menu rows stay 1:1 with snapshot lines; disambiguate duplicate hashes by index
        menu_items.append(
            {
                "id": sim_menu_item_id(archetype_id, f"{sig}:{idx}"),
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


def execute_atomic_seed(payload: Mapping[str, Any], conn: Any) -> dict[str, Any]:
    """Fail-closed single-TX writer (secondary DATABASE_URL / unit-test path).

    Writes live SYNTH_WRITE_SET rows then oracle. Any exception → ROLLBACK.
    Prefer ``seed_sim_restaurant`` SECURITY DEFINER RPC in production (primary).
    """
    restaurant = payload["restaurant"]
    slug = str(restaurant.get("slug") or "")
    if not slug.startswith("sim-"):
        raise ValueError(f"refusing non-sim slug: {slug!r}")
    restaurant_id = restaurant["id"]

    cur = conn.cursor()
    try:
        org = payload["organization"]
        cur.execute(
            "INSERT INTO organizations (id, name) VALUES (%s, %s) "
            "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
            (org["id"], org["name"]),
        )

        cur.execute(
            "INSERT INTO restaurants "
            "(id, organization_id, name, slug, timezone, city, country, "
            "cuisine_type, default_threshold_min, is_active) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (id) DO UPDATE SET "
            "organization_id=EXCLUDED.organization_id, name=EXCLUDED.name, "
            "slug=EXCLUDED.slug, timezone=EXCLUDED.timezone, city=EXCLUDED.city, "
            "country=EXCLUDED.country, cuisine_type=EXCLUDED.cuisine_type, "
            "default_threshold_min=EXCLUDED.default_threshold_min, "
            "is_active=EXCLUDED.is_active",
            (
                restaurant_id,
                restaurant.get("organization_id"),
                restaurant.get("name"),
                slug,
                restaurant.get("timezone"),
                restaurant.get("city"),
                restaurant.get("country"),
                restaurant.get("cuisine_type"),
                restaurant.get("default_threshold_min"),
                restaurant.get("is_active", True),
            ),
        )

        for user in payload.get("users") or []:
            cur.execute(
                "INSERT INTO users (user_id, email, name, role, email_verified) "
                "VALUES (%s,%s,%s,%s,%s) "
                "ON CONFLICT (user_id) DO UPDATE SET "
                "email=EXCLUDED.email, name=EXCLUDED.name, role=EXCLUDED.role, "
                "email_verified=EXCLUDED.email_verified",
                (
                    user["user_id"],
                    user.get("email"),
                    user.get("name"),
                    user.get("role"),
                    True,
                ),
            )

        for member in payload.get("organization_members") or []:
            cur.execute(
                "INSERT INTO organization_members "
                "(organization_id, user_id, role) VALUES (%s,%s,%s) "
                "ON CONFLICT (organization_id, user_id) DO UPDATE SET role=EXCLUDED.role",
                (member["organization_id"], member["user_id"], member["role"]),
            )

        for ura in payload.get("user_restaurant_access") or []:
            cur.execute(
                "INSERT INTO user_restaurant_access "
                "(user_id, restaurant_id, role, is_active) VALUES (%s,%s,%s,%s) "
                "ON CONFLICT (user_id, restaurant_id) DO UPDATE SET "
                "role=EXCLUDED.role, is_active=EXCLUDED.is_active",
                (
                    ura["user_id"],
                    ura["restaurant_id"],
                    ura["role"],
                    ura.get("is_active", True),
                ),
            )

        for wine in payload.get("master_wine_library") or []:
            vintage = wine.get("vintage")
            try:
                vintage_i = int(vintage) if vintage is not None else None
            except (TypeError, ValueError):
                vintage_i = None
            cur.execute(
                "INSERT INTO master_wine_library "
                "(id, wine_id, name, producer, vintage, region, country, grape_variety, "
                "primary_type, signature_hash, source, data_enrichment) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb) "
                "ON CONFLICT (id) DO UPDATE SET "
                "name=EXCLUDED.name, producer=EXCLUDED.producer, "
                "signature_hash=EXCLUDED.signature_hash, "
                "source=EXCLUDED.source, primary_type=EXCLUDED.primary_type, "
                "data_enrichment=EXCLUDED.data_enrichment",
                (
                    wine["id"],
                    wine.get("wine_id") or f"sim-{wine['id'][:8]}",
                    wine.get("name"),
                    wine.get("producer"),
                    vintage_i,
                    wine.get("region"),
                    wine.get("country"),
                    wine.get("grape_variety"),
                    wine.get("primary_type") or "unknown",
                    wine.get("signature_hash"),
                    wine.get("source") or "sim",
                    json.dumps(wine.get("data_enrichment") or {"source": "sim"}),
                ),
            )

        for sub in payload.get("master_wine_library_submissions") or []:
            cur.execute(
                "INSERT INTO master_wine_library_submissions "
                "(id, restaurant_id, signature_hash, status, matched_master_id, payload) "
                "VALUES (%s,%s,%s,%s,%s,%s::jsonb) "
                "ON CONFLICT (id) DO UPDATE SET "
                "status=EXCLUDED.status, matched_master_id=EXCLUDED.matched_master_id, "
                "payload=EXCLUDED.payload",
                (
                    sub["id"],
                    sub.get("restaurant_id"),
                    sub.get("signature_hash"),
                    sub.get("status") or "accepted",
                    sub.get("matched_master_id"),
                    json.dumps(sub.get("payload") or {}),
                ),
            )

        menu = payload["restaurant_menu"]
        cur.execute(
            "INSERT INTO restaurant_menus "
            "(id, restaurant_id, name, menu_type, status, season) "
            "VALUES (%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (id) DO UPDATE SET "
            "name=EXCLUDED.name, menu_type=EXCLUDED.menu_type, status=EXCLUDED.status",
            (
                menu["id"],
                menu["restaurant_id"],
                menu.get("name") or "Wine List",
                menu.get("menu_type") or "beverage",
                menu.get("status") or "active",
                menu.get("season") or "year_round",
            ),
        )

        # Replace menu/inventory for idempotent re-seed
        cur.execute(
            "DELETE FROM menu_items WHERE restaurant_id = %s",
            (restaurant_id,),
        )
        cur.execute(
            "DELETE FROM restaurant_inventory WHERE restaurant_id = %s",
            (restaurant_id,),
        )

        for item in payload.get("menu_items") or []:
            cur.execute(
                "INSERT INTO menu_items "
                "(id, menu_id, restaurant_id, name, producer, vintage, region, "
                "country, grape_variety, bottle_price, by_glass_price, "
                "wine_library_id, source, status) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    item["id"],
                    item["menu_id"],
                    item["restaurant_id"],
                    item.get("name"),
                    item.get("producer"),
                    item.get("vintage"),
                    item.get("region"),
                    item.get("country"),
                    item.get("grape_variety"),
                    item.get("bottle_price"),
                    item.get("by_glass_price"),
                    item.get("wine_library_id"),
                    item.get("source") or "manual",
                    item.get("status") or "approved",
                ),
            )

        for inv in payload.get("restaurant_inventory") or []:
            cur.execute(
                "INSERT INTO restaurant_inventory "
                "(id, restaurant_id, master_wine_id, wine_name, stock_live, "
                "threshold_min, is_active) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (
                    inv["id"],
                    inv["restaurant_id"],
                    inv.get("master_wine_id"),
                    inv.get("wine_name"),
                    inv["stock_live"],
                    inv.get("threshold_min"),
                    inv.get("is_active", True),
                ),
            )

        # Oracle last — failure rolls back live rows (D-10)
        cur.execute(
            "DELETE FROM sim_ground_truth_facts WHERE restaurant_id = %s",
            (restaurant_id,),
        )
        cur.execute(
            "DELETE FROM sim_ground_truth_runs WHERE restaurant_id = %s",
            (restaurant_id,),
        )

        run = payload["oracle_run"]
        cur.execute(
            "INSERT INTO sim_ground_truth_runs "
            "(id, restaurant_id, archetype_id, seed_version, menu_quality, "
            "snapshot_path, snapshot_sha256, params, sku_count, priced_sku_count) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)",
            (
                run["id"],
                run["restaurant_id"],
                run["archetype_id"],
                run["seed_version"],
                run["menu_quality"],
                run["snapshot_path"],
                run["snapshot_sha256"],
                json.dumps(run.get("params") or {}),
                run["sku_count"],
                run["priced_sku_count"],
            ),
        )

        for fact in payload.get("oracle_facts") or []:
            cur.execute(
                "INSERT INTO sim_ground_truth_facts "
                "(id, run_id, restaurant_id, fact_type, sku_key, entity_ref, payload) "
                "VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)",
                (
                    fact["id"],
                    fact["run_id"],
                    fact["restaurant_id"],
                    fact["fact_type"],
                    fact.get("sku_key"),
                    json.dumps(fact.get("entity_ref") or {}),
                    json.dumps(fact.get("payload") or {}),
                ),
            )

        conn.commit()
        return {"ok": True, "restaurant_id": restaurant_id, "slug": slug}
    except Exception:
        conn.rollback()
        raise
    finally:
        close = getattr(cur, "close", None)
        if callable(close):
            close()


def _call_seed_rpc_http(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Primary apply path: PostgREST RPC → seed_sim_restaurant(payload)."""
    import os

    import httpx

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for RPC apply")
    url = f"{supabase_url.rstrip('/')}/rest/v1/rpc/seed_sim_restaurant"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    resp = httpx.post(url, json={"payload": dict(payload)}, headers=headers, timeout=120.0)
    if resp.status_code >= 400:
        raise RuntimeError(
            f"seed_sim_restaurant RPC failed status={resp.status_code} body={resp.text[:500]}"
        )
    data = resp.json()
    if isinstance(data, dict):
        return data
    return {"ok": True, "result": data}


def _call_seed_via_database_url(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Secondary apply path when DATABASE_URL is set (same payload builder)."""
    import os

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL not set")
    try:
        import psycopg2  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("psycopg2 required for DATABASE_URL seed path") from exc
    conn = psycopg2.connect(dsn)
    try:
        return execute_atomic_seed(payload, conn)
    finally:
        conn.close()


def apply_seed(
    archetype_id: str,
    *,
    apply: bool = False,
    overrides: dict[str, Any] | None = None,
    rpc_caller=None,
) -> dict[str, Any]:
    """Dry-run by default. When ``apply=True``, ensure personas then RPC/TX.

    Prefer ``seed_sim_restaurant`` RPC; ``DATABASE_URL`` + ``execute_atomic_seed``
    is secondary. ``rpc_caller`` is injectable for unit tests.

    Cloud ``apply=True`` always requires write-set ↔ teardown coverage (D-11).
    """
    import os

    from scripts.synth.teardown import refuse_multi_archetype_apply_unless_ready

    if not apply:
        return build_seed_plan(archetype_id, overrides=overrides)

    refuse_multi_archetype_apply_unless_ready(
        archetypes=[archetype_id],
        apply=True,
    )

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

    try:
        result = _call_seed_rpc_http(payload)
    except Exception:
        if os.environ.get("DATABASE_URL"):
            result = _call_seed_via_database_url(payload)
        else:
            raise
    plan["rpc_result"] = result
    return plan


__all__ = [
    "apply_seed",
    "build_rpc_payload",
    "build_seed_plan",
    "compute_opening_stock",
    "execute_atomic_seed",
    "sim_wine_id",
]
