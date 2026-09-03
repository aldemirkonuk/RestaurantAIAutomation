"""Dry-run seed plans + atomic apply via seed_sim_restaurant RPC (SYNTH-03/04).

Default path is dry-run (``apply=False``). Cloud mutations require ``apply=True``.
``apply=True`` always runs write-set ↔ teardown coverage gate (D-11/D-12).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
import json
import uuid
from pathlib import Path
from typing import Any, Mapping, Sequence  # Any used by execute_atomic_seed conn

from scripts.synth.auth_personas import PERSONA_ROLES, ensure_personas
from scripts.synth.ids import SIM_NS, sim_org_id, sim_restaurant_id, sim_slug
from scripts.synth.oracle import SEED_VERSION, build_facts, build_run_row
from scripts.synth.recipes import apply_overrides, load_recipe
from scripts.synth.snapshots import MENUS_DIR, load_snapshot
from scripts.synth.write_set import SYNTH_WRITE_SET
from scripts.synth.identity import wine_signature_for_item

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


def opening_stock_idempotency_key(inventory_id: str) -> str:
    """The key that makes re-seeding a tenant a no-op rather than a double stock.

    `apply_stock_movement` returns the EXISTING transaction id when it sees a key
    it has already committed, so a second `--apply` against the same tenant adds
    no lots. Deterministic on the inventory id, which is itself uuid5 of
    (archetype, signature_hash) — so the key survives a re-seed of the same
    archetype.
    """
    return f"sim:opening:{inventory_id}"


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


@dataclass(frozen=True)
class WineIdentityPlan:
    """How a menu snapshot's lines map onto library rows and inventory rows.

    The crawl `signature_hash` groups lines by name + producer + vintage, and
    later lines under one hash can carry case-variant region/grape text. The
    library's UNIQUE identity is `wine_signature_hash(producer, name, vintage,
    country, region, grape)`, and `restaurant_inventory` is UNIQUE per
    (restaurant, wine). So (ADR 0093, measured 2026-09-03 on the bistro menu —
    92 hashes, 81 identities, 28 hashes with variant lines):

    * the FIRST line under a hash decides that hash's identity;
    * the FIRST hash carrying an identity owns the wine row AND the one
      inventory row; every other hash with that identity reuses both.

    The seed and the scenario engine both build their view of the tenant from
    this one function, so a menu line resolves to the same inventory row on the
    way in (seed) and on the way out (webhook, expectation, mapping).
    """

    identity_by_sig: dict[str, str]
    canonical_sig_by_sig: dict[str, str]
    wine_id_by_sig: dict[str, str]
    inventory_id_by_sig: dict[str, str]

    @property
    def identities(self) -> int:
        return len(set(self.canonical_sig_by_sig.values()))

    @property
    def collapsed(self) -> int:
        return len(self.canonical_sig_by_sig) - self.identities

    def owns(self, sig: str) -> bool:
        return self.canonical_sig_by_sig.get(sig) == sig


def plan_wine_identities(
    archetype_id: str, items: Sequence[Mapping[str, Any]]
) -> WineIdentityPlan:
    identity_by_sig: dict[str, str] = {}
    owner_by_identity: dict[str, str] = {}
    canonical: dict[str, str] = {}
    for item in items:
        sig = item["signature_hash"]
        if sig in identity_by_sig:
            continue
        identity = wine_signature_for_item(item)
        identity_by_sig[sig] = identity
        owner = owner_by_identity.setdefault(identity, sig)
        canonical[sig] = owner
    return WineIdentityPlan(
        identity_by_sig=identity_by_sig,
        canonical_sig_by_sig=canonical,
        wine_id_by_sig={s: sim_wine_id(o) for s, o in canonical.items()},
        inventory_id_by_sig={
            s: sim_inventory_id(archetype_id, o) for s, o in canonical.items()
        },
    )


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
    # The library's identity is wine_signature_hash(producer, name, vintage,
    # country, region, grape) and it is UNIQUE. Two menu lines with different
    # crawl hashes but the same six fields are ONE library row, so the first
    # line to carry an identity owns the wine; later lines reuse its id. Without
    # this the seed_sim_restaurant transaction collided on the index and rolled
    # back (bistro: 92 line hashes, 81 identities — measured 2026-09-03).
    ident_plan = plan_wine_identities(archetype_id, items)
    identity_by_sig = ident_plan.identity_by_sig
    identity_collapsed = 0

    for idx, item in enumerate(items):
        sig = item["signature_hash"]
        first_seen = sig not in seen_wine_sigs
        identity = identity_by_sig[sig]
        wine_id = ident_plan.wine_id_by_sig[sig]
        inventory_id = ident_plan.inventory_id_by_sig[sig]
        stock_live = compute_opening_stock(
            item, opening_cfg, restaurant_price_tier=price_tier
        )
        if first_seen:
            seen_wine_sigs.add(sig)
            if ident_plan.owns(sig):
                # This hash owns the identity: one provisional wine, one inventory row.
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
                        # The trigger recomputes this from the six identity fields;
                        # the crawl hash is kept only so the row says where it came from.
                        "signature_hash": sig,
                        "source": "sim",
                        "data_enrichment": {
                            "source": "sim",
                            "archetype_id": archetype_id,
                            "library_identity": identity,
                        },
                    }
                )
            else:
                # Same six fields as an earlier line: the library would collapse
                # them into one row, so the plan does too.
                identity_collapsed += 1
            # One submission and one inventory row per distinct menu line,
            # both pointing at the wine that owns the identity.
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
            if ident_plan.owns(sig):
                # restaurant_inventory is UNIQUE per (restaurant, wine): the
                # owning hash carries the one row; collapsed hashes pour from it.
                inventory.append(
                    {
                        "id": inventory_id,
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
                "vintage": (
                    None if item.get("vintage") is None else str(item.get("vintage"))
                ),
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

    # The rows the apply path will materialise as lots (ADR 0093 D4). Computed
    # here so the DRY-RUN plan reports them: a plan that omits what --apply will
    # write is a plan nobody can check the result against.
    stocked = [row for row in inventory if int(row.get("stock_live") or 0) > 0]

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
        # ADR 0093 D1. In the DRY-RUN plan too, so `generate` without --apply
        # shows the hours the tenant would get. `seed_sim_restaurant` is a
        # SECURITY DEFINER function defined in the 4.9 MB baseline and does not
        # know this column, so the apply path PATCHes it separately (see
        # `_write_operating_hours`) rather than editing a function the schema
        # parity check would compare on the next merge.
        "operating_hours": profile.restaurant.get("operating_hours"),
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
        # ADR 0093 D4: the apply path materialises opening stock through
        # `apply_stock_movement`, one lot and one ledger row per STOCKED SKU.
        # Rows with zero opening stock get nothing — a zero-delta call is a
        # no-op in the RPC and a lot of zero bottles is not a fact.
        "inventory_lots": {"row_count": len(stocked)},
        "inventory_transactions": {"row_count": len(stocked)},
    }
    # Sanity: planned tables ⊆ write-set
    unknown = set(tables) - set(SYNTH_WRITE_SET)
    if unknown:
        raise RuntimeError(
            f"seed plan tables not in SYNTH_WRITE_SET: {sorted(unknown)}"
        )

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
        "library_identities": ident_plan.identities,
        "identity_collapsed": identity_collapsed,
        "identity_by_sig": identity_by_sig,
        "inventory_id_by_sig": ident_plan.inventory_id_by_sig,
        "wine_id_by_sig": ident_plan.wine_id_by_sig,
        "tables": tables,
        # What --apply will send to `apply_stock_movement`, keyed by the
        # idempotency key that makes a re-run a no-op.
        "opening_stock_plan": [
            {
                "inventory_id": row["id"],
                "stock_live": int(row["stock_live"]),
                "idempotency_key": opening_stock_idempotency_key(row["id"]),
            }
            for row in stocked
        ],
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

        # `operating_hours` is written here as well as by the apply path's PATCH
        # (ADR 0093 D1): this function claims to write the restaurant row, and a
        # row it writes without the hours would be a tenant whose scenarios have
        # nothing to place themselves inside.
        cur.execute(
            "INSERT INTO restaurants "
            "(id, organization_id, name, slug, timezone, operating_hours, city, "
            "country, cuisine_type, default_threshold_min, is_active) "
            "VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s) "
            "ON CONFLICT (id) DO UPDATE SET "
            "organization_id=EXCLUDED.organization_id, name=EXCLUDED.name, "
            "slug=EXCLUDED.slug, timezone=EXCLUDED.timezone, "
            "operating_hours=EXCLUDED.operating_hours, city=EXCLUDED.city, "
            "country=EXCLUDED.country, cuisine_type=EXCLUDED.cuisine_type, "
            "default_threshold_min=EXCLUDED.default_threshold_min, "
            "is_active=EXCLUDED.is_active",
            (
                restaurant_id,
                restaurant.get("organization_id"),
                restaurant.get("name"),
                slug,
                restaurant.get("timezone"),
                (
                    None
                    if restaurant.get("operating_hours") is None
                    else json.dumps(restaurant["operating_hours"])
                ),
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
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for RPC apply"
        )
    url = f"{supabase_url.rstrip('/')}/rest/v1/rpc/seed_sim_restaurant"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    resp = httpx.post(
        url, json={"payload": dict(payload)}, headers=headers, timeout=120.0
    )
    if resp.status_code >= 400:
        raise RuntimeError(
            f"seed_sim_restaurant RPC failed status={resp.status_code} body={resp.text[:500]}"
        )
    data = resp.json()
    if isinstance(data, dict):
        return data
    return {"ok": True, "result": data}


def _service_rest_caller(
    method: str,
    path: str,
    *,
    json_body: Any = None,
    params: Mapping[str, str] | None = None,
) -> Any:
    """One service-role REST call against PostgREST, raising on any 4xx/5xx.

    The same headers `_call_seed_rpc_http` builds. Injectable at the `apply_seed`
    boundary as `rest_caller` so every unit test below runs with NO network.
    """
    import os

    import httpx

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for the apply path"
        )
    url = f"{supabase_url.rstrip('/')}{path}"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        # Without this a PATCH returns 204 and no body — fine, but asking for the
        # representation means a PATCH that matched NOTHING is visible as an
        # empty list rather than as a silent success.
        "Prefer": "return=representation",
    }
    resp = httpx.request(
        method,
        url,
        json=json_body,
        params=dict(params or {}),
        headers=headers,
        timeout=120.0,
    )
    if resp.status_code >= 400:
        raise RuntimeError(
            f"{method} {path} failed status={resp.status_code} body={resp.text[:500]}"
        )
    if not resp.content:
        return None
    try:
        return resp.json()
    except ValueError:
        return None


def _write_operating_hours(plan: Mapping[str, Any], rest_caller) -> dict[str, Any]:
    """PATCH `restaurants.operating_hours` from the archetype (ADR 0093 D1).

    Separate from the seed RPC on purpose: `seed_sim_restaurant` is SECURITY
    DEFINER and defined in the 4.9 MB baseline dump, and editing it would put a
    hand-written function in front of the schema parity check on the next merge
    (ADR 0093 D4 rejected the same move for lots, for the same reason).
    """
    restaurant_id = plan["restaurant_id"]
    hours = (plan.get("profile") or {}).get("restaurant", {}).get("operating_hours")
    if hours is None:
        # The recipe loader REQUIRES the key, so this is unreachable through
        # load_recipe. It is refused rather than PATCHed as null, because a sim
        # tenant with unknown hours would make every scenario placed against it
        # fall back to a guessed schedule — the thing ADR 0093 exists to remove.
        raise RuntimeError(
            f"archetype {plan.get('archetype_id')!r} has no operating_hours; "
            "refusing to seed a tenant whose hours are unknown"
        )
    rows = rest_caller(
        "PATCH",
        "/rest/v1/restaurants",
        json_body={"operating_hours": hours},
        params={"id": f"eq.{restaurant_id}"},
    )
    # `Prefer: return=representation` means a PATCH that matched no row comes
    # back as []. Reporting that as a successful write is exactly the
    # absence-reported-as-health shape.
    if isinstance(rows, list) and len(rows) == 0:
        raise RuntimeError(
            f"operating_hours PATCH matched no restaurant {restaurant_id}"
        )
    return {"operating_hours_written": True, "operating_hours": hours}


def _materialise_opening_stock(plan: Mapping[str, Any], rest_caller) -> dict[str, Any]:
    """Turn planned `stock_live` into real lots through the one stock door (D4).

    WHY THIS EXISTS. `seed_sim_restaurant` writes `restaurant_inventory.stock_live`
    directly and creates NO `inventory_lots` rows (`pg_get_functiondef`: zero
    mentions of the table, checked on production 2026-09-02). But `stock_live` is
    a PROJECTION maintained by `trg_project_stock_from_lots`, and both depletion
    RPCs read lots only. A freshly seeded sim tenant therefore showed 12 bottles
    and raised `no stock to pour` on the first glass —
    `scripts/check_no_direct_stock_writes.sh` guards exactly this in TypeScript
    and cannot see inside a SQL function.

    So the seed sends every stocked row through `apply_stock_movement`, the same
    door a real receipt uses, which writes the lot AND the ledger row and lets the
    trigger set `stock_live` itself.

    No `p_unit_cost` and no `p_cost_provenance`: the RPC then labels the lot
    `estimated`, which is the honest label for a quantity nobody has costed.
    Passing a provenance without a price is refused by the RPC since ADR 0078, and
    passing `invoice` over a made-up number would be the lie that ADR forbids.
    """
    restaurant_id = plan["restaurant_id"]
    planned = list(plan.get("opening_stock_plan") or [])

    # Which of these keys the ledger ALREADY holds, read BEFORE calling.
    # `apply_stock_movement` returns the original transaction's id on a replay,
    # which is indistinguishable from a fresh write at the call site — so the
    # only honest way to report "already present" is to look first. Counting
    # every call as a new lot would make a re-seed report work it did not do.
    existing_rows = rest_caller(
        "GET",
        "/rest/v1/inventory_transactions",
        params={
            "restaurant_id": f"eq.{restaurant_id}",
            "select": "idempotency_key",
        },
    )
    if existing_rows is None:
        raise RuntimeError(
            "could not read inventory_transactions before materialising opening "
            "stock; refusing to guess whether the lots already exist"
        )
    existing_keys = {
        str(r.get("idempotency_key")) for r in existing_rows if r.get("idempotency_key")
    }

    materialised = 0
    already_present = 0

    for row in planned:
        replayed = row["idempotency_key"] in existing_keys
        rest_caller(
            "POST",
            "/rest/v1/rpc/apply_stock_movement",
            json_body={
                "p_inventory_id": row["inventory_id"],
                "p_stock_state": "live",
                "p_delta": int(row["stock_live"]),
                "p_transaction_type": "initial",
                "p_source": "system",
                "p_reason": "sim opening stock (ADR 0093 D4)",
                "p_idempotency_key": row["idempotency_key"],
            },
        )
        if replayed:
            already_present += 1
        else:
            materialised += 1

    # ── The readback. This is the point of the whole function. ──────────────
    # A seed that reported success over phantom stock is the fault being fixed;
    # reporting success over a FAILED materialisation would be the same fault
    # one layer up. So read what the database actually holds and compare.
    rows = rest_caller(
        "GET",
        "/rest/v1/restaurant_inventory",
        params={
            "restaurant_id": f"eq.{restaurant_id}",
            "select": "id,stock_live",
        },
    )
    if rows is None:
        raise RuntimeError(
            "opening-stock readback returned no body; refusing to report a seed "
            "as successful without seeing the stock it claims to have written"
        )
    actual = {str(r["id"]): int(r.get("stock_live") or 0) for r in rows}
    expected = {
        str(r["id"]): int(r.get("stock_live") or 0)
        for r in (plan.get("payload") or {}).get("restaurant_inventory") or []
    }
    mismatches = [
        {"inventory_id": iid, "expected": qty, "actual": actual.get(iid)}
        for iid, qty in expected.items()
        if actual.get(iid) != qty
    ]
    if mismatches:
        raise RuntimeError(
            "opening stock does not match the plan after materialisation "
            f"({len(mismatches)} of {len(expected)} rows disagree); "
            f"first: {mismatches[:3]}"
        )

    return {
        "lots_materialised": materialised,
        "lots_already_present": already_present,
        "stock_verified": len(expected),
    }


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


def _resolve_library_identities(plan: dict[str, Any], rest_caller) -> dict[str, Any]:
    """Before the seed RPC: prove the identity mirror, and reuse library rows that exist.

    Two things the RPC cannot do for itself (ADR 0093, seed collision found
    2026-09-03):

    1. **Parity.** Every planned wine's identity is recomputed by the SQL
       function `wine_signature_hash` and compared with the Python mirror in
       `scripts/synth/identity.py`. Any difference raises — a seed that collapsed
       on a stale rule would collide inside the transaction exactly as before,
       and a mirror that drifted silently is worse than none.
    2. **Reuse.** `master_wine_library.signature_hash` is UNIQUE, and the library
       already holds 4,094 real wines. A sim wine whose identity exists is not
       inserted; every reference to its provisional id (inventory, submissions,
       menu items, opening-stock plan, ground-truth facts) is repointed at the
       existing row. Teardown deletes only `sim.wine.*` ids, so the real row is
       never touched.
    """
    payload = plan["payload"]
    wines = list(payload.get("master_wine_library") or [])
    identity_by_sig: dict[str, str] = dict(plan.get("identity_by_sig") or {})
    if not wines:
        return {
            "library_reused": 0,
            "library_inserted": 0,
            "identity_parity_checked": 0,
            "library_remap": {},
        }

    # (1) parity, one RPC per planned wine
    drift: list[str] = []
    for w in wines:
        sql_hash = rest_caller(
            "POST",
            "/rest/v1/rpc/wine_signature_hash",
            json_body={
                "p_producer": w.get("producer"),
                "p_name": w.get("name"),
                "p_vintage": w.get("vintage"),
                "p_country": w.get("country"),
                "p_region": w.get("region"),
                "p_grape_variety": w.get("grape_variety"),
            },
        )
        expected = identity_by_sig.get(w.get("signature_hash"))
        if not isinstance(sql_hash, str) or sql_hash != expected:
            drift.append(
                f"{w.get('producer')} / {w.get('name')}: sql={sql_hash!r} mirror={expected!r}"
            )
    if drift:
        raise RuntimeError(
            "seed refused: scripts/synth/identity.py no longer matches "
            f"wine_signature_hash() for {len(drift)} wine(s) — fix the mirror first. "
            + "; ".join(drift[:3])
        )

    # (2) reuse existing library rows, chunked so the filter stays a sane URL
    identities = sorted({identity_by_sig[w["signature_hash"]] for w in wines})
    existing_by_identity: dict[str, str] = {}
    for i in range(0, len(identities), 50):
        chunk = identities[i : i + 50]
        rows = rest_caller(
            "GET",
            "/rest/v1/master_wine_library",
            params={
                "select": "id,signature_hash",
                "signature_hash": f"in.({','.join(chunk)})",
            },
        )
        for r in rows or []:
            existing_by_identity[str(r["signature_hash"])] = str(r["id"])
    remap: dict[str, str] = {}
    kept: list[dict[str, Any]] = []
    for w in wines:
        existing = existing_by_identity.get(identity_by_sig[w["signature_hash"]])
        if existing and existing != w["id"]:
            remap[w["id"]] = existing
        else:
            kept.append(w)
    payload["master_wine_library"] = kept

    def _walk(obj: Any) -> Any:
        if isinstance(obj, dict):
            return {k: _walk(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_walk(v) for v in obj]
        if isinstance(obj, str) and obj in remap:
            return remap[obj]
        return obj

    if remap:
        for key in (
            "restaurant_inventory",
            "master_wine_library_submissions",
            "menu_items",
            "oracle_facts",
        ):
            if key in payload:
                payload[key] = _walk(payload[key])
        for key in ("opening_stock_plan", "opening_map"):
            if key in plan:
                plan[key] = _walk(plan[key])
    return {
        "library_reused": len(remap),
        "library_inserted": len(kept),
        "identity_parity_checked": len(wines),
        "library_remap": remap,
    }


def _bind_personas_to_restaurant(
    plan: Mapping[str, Any], rest_caller
) -> dict[str, Any]:
    """Point each persona's `users.restaurant_id` at the tenant just seeded.

    The gateway signs `restaurantId` into the session from `users.restaurant_id`
    and its tenant guard compares that claim with the `:restaurantId` in every
    path — a persona whose mirror row carries NULL is refused with "Tenant
    isolation violation" on the very tenant it was seeded into (measured
    2026-09-03, ADR 0093 live day). The three personas are shared across sim
    tenants, so the last tenant seeded is the one they act in.
    """
    payload = plan["payload"]
    restaurant_id = str(plan["restaurant_id"])
    user_ids = [
        str(u["user_id"]) for u in (payload.get("users") or []) if u.get("user_id")
    ]
    if not user_ids:
        return {"personas_bound": 0}
    rest_caller(
        "PATCH",
        "/rest/v1/users",
        params={"user_id": f"in.({','.join(user_ids)})"},
        json_body={"restaurant_id": restaurant_id},
    )
    rows = rest_caller(
        "GET",
        "/rest/v1/users",
        params={
            "select": "user_id,restaurant_id",
            "user_id": f"in.({','.join(user_ids)})",
        },
    )
    bound = [r for r in (rows or []) if str(r.get("restaurant_id")) == restaurant_id]
    if len(bound) != len(user_ids):
        raise RuntimeError(
            f"persona binding: expected {len(user_ids)} users bound to {restaurant_id}, "
            f"read back {len(bound)} — the seed must not report success over personas "
            "the gateway would refuse"
        )
    return {"personas_bound": len(bound)}


def apply_seed(
    archetype_id: str,
    *,
    apply: bool = False,
    overrides: dict[str, Any] | None = None,
    rpc_caller=None,
    rest_caller=None,
) -> dict[str, Any]:
    """Dry-run by default. When ``apply=True``, ensure personas then RPC/TX.

    Prefer ``seed_sim_restaurant`` RPC; ``DATABASE_URL`` + ``execute_atomic_seed``
    is secondary. ``rpc_caller`` is injectable for unit tests.

    After the RPC succeeds, two things the RPC itself cannot do (ADR 0093):

    1. PATCH ``restaurants.operating_hours`` from the archetype (D1).
    2. Materialise the planned ``stock_live`` as real ``inventory_lots`` through
       ``apply_stock_movement``, then READ IT BACK and refuse to report success
       if the database disagrees with the plan (D4).

    ``rest_caller`` is the injectable seam for both, so unit tests exercise them
    with no network.

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
    # An injected `rpc_caller` means a test harness. Reaching for the real
    # network for the REST half would make a unit test silently talk to the only
    # Supabase project there is — production. Refuse loudly instead.
    if rpc_caller is not None and rest_caller is None:
        raise RuntimeError(
            "apply_seed: rpc_caller was injected but rest_caller was not. The "
            "apply path resolves library identities, PATCHes operating_hours and "
            "materialises opening stock over REST (ADR 0093); inject a rest_caller "
            "so the test does not reach the network."
        )
    caller = rest_caller if rest_caller is not None else _service_rest_caller
    # ADR 0093: prove the identity mirror and reuse existing library rows BEFORE
    # the atomic seed, so the transaction cannot collide on the UNIQUE index.
    plan.update(_resolve_library_identities(plan, caller))
    payload = build_rpc_payload(plan)

    if rpc_caller is not None:
        result = rpc_caller(payload)
    else:
        try:
            result = _call_seed_rpc_http(payload)
        except Exception:
            if os.environ.get("DATABASE_URL"):
                result = _call_seed_via_database_url(payload)
            else:
                raise
    plan["rpc_result"] = result

    # ADR 0093. Both steps run only AFTER the seed RPC succeeded, and both
    # raise on failure: a seed that reported success over a tenant with no
    # hours, or with phantom stock, is the exact fault this is fixing.
    plan.update(_write_operating_hours(plan, caller))
    plan.update(_bind_personas_to_restaurant(plan, caller))
    plan.update(_materialise_opening_stock(plan, caller))
    return plan


__all__ = [
    "apply_seed",
    "build_rpc_payload",
    "build_seed_plan",
    "compute_opening_stock",
    "execute_atomic_seed",
    "opening_stock_idempotency_key",
    "plan_wine_identities",
    "sim_wine_id",
]
