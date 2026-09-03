"""Shared sim-tenant teardown registry (D-11..D-13).

Single source used by ``pnpm synth:teardown``, CLI, FastAPI admin routes, and
``conftest_prod`` — do not fork a second table list.

Hard locks
----------
- Resolve restaurants via ``slug LIKE 'sim-%'`` (UUID PKs).
- Never delete ``e2e-test-restaurant`` (slug or id).
- Never delete SIM_* Auth users (``users`` handler is an explicit NO-OP).
- ``master_wine_library*`` deletes are **sim-filtered only** (never wholesale).
- Never raise — failures tagged Sentry ``sim-orphan``.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Iterable, Mapping, MutableMapping, Sequence

from scripts.synth.write_set import (
    SYNTH_WRITE_SET,
    TEARDOWN_TABLES,
    assert_write_set_equals_teardown,
)

logger = logging.getLogger(__name__)

# Re-export: TEARDOWN_TABLES is the write-set (single source of truth).
assert list(TEARDOWN_TABLES) == list(SYNTH_WRITE_SET)

E2E_ANCHOR_GUARD = "e2e-test-restaurant"

# FK-safe delete order (plan interfaces). ``users`` is NO-OP — not listed.
DELETE_ORDER: list[str] = [
    # Nothing references pos_checks, so it goes first. Written indirectly by
    # `scripts.simulate --apply` via the POS hub ingress rather than by seed.py.
    "pos_checks",
    # Same reasoning — nothing references pos_unresolved_lines.
    "pos_unresolved_lines",
    # AFTER pos_checks, and this is not cosmetic: `pos_checks.table_id`
    # references `restaurant_tables(id)` with NO on-delete action (verified in
    # the baseline migration), so deleting the tables first raises 23503 and
    # the whole teardown for that tenant reports an orphan.
    "restaurant_tables",
    # SimPOS testbed tables. Children before parents even though the FKs are
    # ON DELETE CASCADE/SET NULL — explicit order, not implicit cascade.
    "simpos_check_lines",
    "simpos_checks",
    "simpos_tables",
    "simpos_catalog",
    # ADR 0093: one row per scenario run, holding that run's expectation.
    "sim_scenario_runs",
    "sim_ground_truth_facts",
    "sim_ground_truth_runs",
    # ADR 0093: the user-side rows a scenario causes. Neither is referenced by
    # anything, so they can sit anywhere before `restaurants`.
    "notifications",
    "analytics_insights",
    # ── the inventory chain, children first ─────────────────────────────────
    # Everything that points at a lot or an inventory row goes before the lots,
    # and the lots before restaurant_inventory. inventory_lots cascades from
    # restaurant_inventory, but the cascade is a schema fact this file cannot
    # see; the explicit delete is what makes the coverage checkable.
    "pour_events",
    "wine_consumption_log",
    "inventory_transactions",
    "pos_catalog_match_proposals",
    "pos_item_mappings",
    "inventory_lots",
    "restaurant_inventory",
    "menu_items",
    "restaurant_menus",
    "master_wine_library_submissions",
    "master_wine_library",
    "user_restaurant_access",
    "restaurants",
    "organization_members",
    "organizations",
]

NOOP_TABLES: frozenset[str] = frozenset({"users"})


class WriteSetTeardownCoverageError(ValueError):
    """Raised when write-set ↔ teardown handlers/tables are incomplete."""


def filter_sim_restaurant_ids(rows: Iterable[Mapping[str, Any]]) -> list[str]:
    """Drop e2e anchor even if it somehow appears in a sim-like query."""
    out: list[str] = []
    for row in rows:
        rid = str(row.get("id") or "")
        slug = str(row.get("slug") or "")
        if rid == E2E_ANCHOR_GUARD or slug == E2E_ANCHOR_GUARD:
            continue
        if not slug.startswith("sim-"):
            continue
        if rid:
            out.append(rid)
    return out


def resolve_sim_restaurant_ids(client: Any) -> list[str]:
    """SELECT id FROM restaurants WHERE slug LIKE 'sim-%' (anchor hard-guarded)."""
    try:
        resp = (
            client.table("restaurants")
            .select("id,slug")
            .like("slug", "sim-%")
            .execute()
        )
        data = getattr(resp, "data", None) or []
        return filter_sim_restaurant_ids(data)
    except Exception as exc:  # noqa: BLE001 — never raise from resolve
        _capture_sim_orphan(exc, context={"phase": "resolve_sim_restaurant_ids"})
        return []


def resolve_sim_org_ids(client: Any, sim_restaurant_ids: Sequence[str]) -> list[str]:
    """Org ids owned by sim restaurants (via restaurants.organization_id)."""
    if not sim_restaurant_ids:
        return []
    try:
        resp = (
            client.table("restaurants")
            .select("organization_id")
            .in_("id", list(sim_restaurant_ids))
            .execute()
        )
        data = getattr(resp, "data", None) or []
        orgs: list[str] = []
        for row in data:
            oid = row.get("organization_id")
            if oid and str(oid) not in orgs:
                orgs.append(str(oid))
        return orgs
    except Exception as exc:  # noqa: BLE001
        _capture_sim_orphan(exc, context={"phase": "resolve_sim_org_ids"})
        return []


def resolve_sim_wine_ids(client: Any, sim_restaurant_ids: Sequence[str]) -> list[str]:
    """Collect provisional wine ids linked to sim restaurants."""
    wine_ids: list[str] = []
    if not sim_restaurant_ids:
        return wine_ids
    try:
        resp = (
            client.table("master_wine_library_submissions")
            .select("matched_master_id")
            .in_("restaurant_id", list(sim_restaurant_ids))
            .execute()
        )
        for row in getattr(resp, "data", None) or []:
            mid = row.get("matched_master_id")
            if mid and str(mid) not in wine_ids:
                wine_ids.append(str(mid))
    except Exception as exc:  # noqa: BLE001
        _capture_sim_orphan(exc, context={"phase": "resolve_sim_wine_ids_submissions"})
    try:
        resp = (
            client.table("restaurant_inventory")
            .select("master_wine_id")
            .in_("restaurant_id", list(sim_restaurant_ids))
            .execute()
        )
        for row in getattr(resp, "data", None) or []:
            mid = row.get("master_wine_id")
            if mid and str(mid) not in wine_ids:
                wine_ids.append(str(mid))
    except Exception as exc:  # noqa: BLE001
        _capture_sim_orphan(exc, context={"phase": "resolve_sim_wine_ids_inventory"})
    return wine_ids


def _delete_by_restaurant_id(
    client: Any, table: str, sim_ids: Sequence[str]
) -> None:
    if not sim_ids:
        return
    client.table(table).delete().in_("restaurant_id", list(sim_ids)).execute()


def _handler_by_restaurant(table: str) -> Callable[..., None]:
    def _h(
        client: Any,
        *,
        sim_ids: Sequence[str],
        org_ids: Sequence[str],
        wine_ids: Sequence[str],
        **_kwargs: Any,
    ) -> None:
        _delete_by_restaurant_id(client, table, sim_ids)

    _h.__name__ = f"delete_{table}"
    return _h


def _handler_users_noop(
    client: Any,
    *,
    sim_ids: Sequence[str],
    org_ids: Sequence[str],
    wine_ids: Sequence[str],
    auth_admin_delete: Callable[..., Any] | None = None,
    **_kwargs: Any,
) -> None:
    """Durable SIM_* personas — never delete Auth users or public.users mirrors."""
    return None


def _handler_master_wine_library_submissions(
    client: Any,
    *,
    sim_ids: Sequence[str],
    org_ids: Sequence[str],
    wine_ids: Sequence[str],
    **_kwargs: Any,
) -> None:
    if sim_ids:
        client.table("master_wine_library_submissions").delete().in_(
            "restaurant_id", list(sim_ids)
        ).execute()


def _handler_master_wine_library(
    client: Any,
    *,
    sim_ids: Sequence[str],
    org_ids: Sequence[str],
    wine_ids: Sequence[str],
    **_kwargs: Any,
) -> None:
    """Sim-filtered only — NEVER ``DELETE FROM master_wine_library`` wholesale."""
    if wine_ids:
        client.table("master_wine_library").delete().in_("id", list(wine_ids)).execute()
    try:
        client.table("master_wine_library").delete().eq(
            "source", "sim"
        ).execute()
    except Exception:  # noqa: BLE001 — column may differ; wine_ids path is primary
        pass


def _handler_restaurants(
    client: Any,
    *,
    sim_ids: Sequence[str],
    org_ids: Sequence[str],
    wine_ids: Sequence[str],
    **_kwargs: Any,
) -> None:
    safe = [i for i in sim_ids if i != E2E_ANCHOR_GUARD]
    if not safe:
        return
    client.table("restaurants").delete().in_("id", safe).execute()


def _handler_organization_members(
    client: Any,
    *,
    sim_ids: Sequence[str],
    org_ids: Sequence[str],
    wine_ids: Sequence[str],
    **_kwargs: Any,
) -> None:
    if org_ids:
        client.table("organization_members").delete().in_(
            "organization_id", list(org_ids)
        ).execute()


def _handler_organizations(
    client: Any,
    *,
    sim_ids: Sequence[str],
    org_ids: Sequence[str],
    wine_ids: Sequence[str],
    **_kwargs: Any,
) -> None:
    if org_ids:
        client.table("organizations").delete().in_("id", list(org_ids)).execute()


TEARDOWN_HANDLERS: dict[str, Callable[..., None]] = {
    "pos_checks": _handler_by_restaurant("pos_checks"),
    "pos_unresolved_lines": _handler_by_restaurant("pos_unresolved_lines"),
    "simpos_check_lines": _handler_by_restaurant("simpos_check_lines"),
    "simpos_checks": _handler_by_restaurant("simpos_checks"),
    "simpos_tables": _handler_by_restaurant("simpos_tables"),
    "simpos_catalog": _handler_by_restaurant("simpos_catalog"),
    "sim_ground_truth_facts": _handler_by_restaurant("sim_ground_truth_facts"),
    "sim_ground_truth_runs": _handler_by_restaurant("sim_ground_truth_runs"),
    # ADR 0093 harness. Every one of these carries a NOT NULL `restaurant_id`
    # (checked against supabase/migrations/20260805000000_baseline_from_production.sql
    # and 20260805133000_pos_unresolved_lines_and_review_queues.sql for
    # pos_catalog_match_proposals), so the by-restaurant handler is correct for
    # all of them and no bespoke resolver is needed.
    "sim_scenario_runs": _handler_by_restaurant("sim_scenario_runs"),
    "restaurant_tables": _handler_by_restaurant("restaurant_tables"),
    "pour_events": _handler_by_restaurant("pour_events"),
    "wine_consumption_log": _handler_by_restaurant("wine_consumption_log"),
    "inventory_transactions": _handler_by_restaurant("inventory_transactions"),
    "inventory_lots": _handler_by_restaurant("inventory_lots"),
    "pos_item_mappings": _handler_by_restaurant("pos_item_mappings"),
    "pos_catalog_match_proposals": _handler_by_restaurant(
        "pos_catalog_match_proposals"
    ),
    "notifications": _handler_by_restaurant("notifications"),
    "analytics_insights": _handler_by_restaurant("analytics_insights"),
    "restaurant_inventory": _handler_by_restaurant("restaurant_inventory"),
    "menu_items": _handler_by_restaurant("menu_items"),
    "restaurant_menus": _handler_by_restaurant("restaurant_menus"),
    "master_wine_library_submissions": _handler_master_wine_library_submissions,
    "master_wine_library": _handler_master_wine_library,
    "user_restaurant_access": _handler_by_restaurant("user_restaurant_access"),
    "restaurants": _handler_restaurants,
    "organization_members": _handler_organization_members,
    "organizations": _handler_organizations,
    "users": _handler_users_noop,
}


def assert_teardown_coverage() -> None:
    """List equality + one handler per write-set table (D-11/D-12)."""
    assert_write_set_equals_teardown()
    handlers = set(TEARDOWN_HANDLERS.keys())
    write = set(SYNTH_WRITE_SET)
    if handlers != write:
        raise WriteSetTeardownCoverageError(
            "TEARDOWN_HANDLERS != SYNTH_WRITE_SET; "
            f"only_in_handlers={sorted(handlers - write)}; "
            f"only_in_write_set={sorted(write - handlers)}"
        )
    for table in SYNTH_WRITE_SET:
        if table in NOOP_TABLES:
            continue
        if table not in DELETE_ORDER:
            raise WriteSetTeardownCoverageError(
                f"DELETE_ORDER missing non-noop table: {table}"
            )
    # ORDER, not just membership. A table listed but deleted after its parent
    # raises 23503 and is reported as an orphan — which reads, from the outside,
    # exactly like a table nobody listed. These pairs are the ones with a real
    # FK or a real dependency (ADR 0093 D-11/D-12).
    for child, parent in (
        ("pos_checks", "restaurant_tables"),  # pos_checks.table_id, no on-delete
        ("pour_events", "inventory_lots"),
        ("wine_consumption_log", "inventory_lots"),
        ("inventory_transactions", "inventory_lots"),
        ("pos_catalog_match_proposals", "inventory_lots"),
        ("pos_item_mappings", "inventory_lots"),
        ("inventory_lots", "restaurant_inventory"),  # FK, ON DELETE CASCADE
        ("restaurant_inventory", "restaurants"),
        ("sim_scenario_runs", "restaurants"),
        ("notifications", "restaurants"),
        ("analytics_insights", "restaurants"),
    ):
        if child not in DELETE_ORDER or parent not in DELETE_ORDER:
            raise WriteSetTeardownCoverageError(
                f"DELETE_ORDER missing {child!r} or {parent!r}"
            )
        if DELETE_ORDER.index(child) > DELETE_ORDER.index(parent):
            raise WriteSetTeardownCoverageError(
                f"DELETE_ORDER deletes {parent!r} before {child!r}; "
                "children come first or the delete raises 23503 and the row "
                "survives teardown inside a real tenant"
            )
    if "restaurant_menus" not in DELETE_ORDER:
        raise WriteSetTeardownCoverageError(
            "DELETE_ORDER must include restaurant_menus"
        )
    if "menus" in DELETE_ORDER or "menus" in TEARDOWN_HANDLERS:
        raise WriteSetTeardownCoverageError(
            "use restaurant_menus, never shorthand menus"
        )


def refuse_multi_archetype_apply_unless_ready(
    *,
    archetypes: Sequence[str],
    apply: bool,
    coverage_assert: Callable[[], None] | None = None,
) -> None:
    """Refuse cloud ``--apply`` unless write-set ↔ teardown coverage is green.

    Prefer always requiring equality (single-archetype included) when apply=True.
    Dry-run (apply=False) skips the gate.
    """
    if not apply:
        return
    checker = coverage_assert or assert_teardown_coverage
    checker()
    _ = archetypes


def _capture_sim_orphan(
    exc: BaseException,
    *,
    context: MutableMapping[str, Any] | None = None,
) -> None:
    logger.warning("sim teardown orphan: %s context=%s", exc, context)
    try:
        import sentry_sdk

        sentry_sdk.capture_message(
            f"Sim teardown: orphaned records could not be deleted: {exc}",
            level="warning",
            tags={"sim-orphan": "true"},
            extras={"context": dict(context or {}), "error": str(exc)},
        )
    except Exception:  # noqa: BLE001 — Sentry optional
        pass


def teardown_sim(
    client: Any | None = None,
    *,
    apply: bool = False,
    auth_admin_delete: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """FK-safe sim teardown. Never raises. Default dry-run (apply=False)."""
    result: dict[str, Any] = {
        "ok": True,
        "apply": bool(apply),
        "dry_run": not bool(apply),
        "sim_restaurant_ids": [],
        "org_ids": [],
        "wine_ids": [],
        "deleted": [],
        "errors": [],
        "orphans": [],
    }
    try:
        if client is None:
            client = _default_supabase_client()
            if client is None:
                result["errors"].append("no supabase client")
                return result

        sim_ids = resolve_sim_restaurant_ids(client)
        sim_ids = [i for i in sim_ids if i != E2E_ANCHOR_GUARD]
        org_ids = resolve_sim_org_ids(client, sim_ids)
        wine_ids = resolve_sim_wine_ids(client, sim_ids)
        result["sim_restaurant_ids"] = list(sim_ids)
        result["org_ids"] = list(org_ids)
        result["wine_ids"] = list(wine_ids)

        if not apply:
            result["tables"] = list(DELETE_ORDER) + list(NOOP_TABLES)
            return result

        try:
            TEARDOWN_HANDLERS["users"](
                client,
                sim_ids=sim_ids,
                org_ids=org_ids,
                wine_ids=wine_ids,
                auth_admin_delete=auth_admin_delete,
            )
        except Exception as exc:  # noqa: BLE001
            _capture_sim_orphan(exc, context={"table": "users"})
            result["errors"].append({"table": "users", "error": str(exc)})
            result["orphans"].append("users")

        for table in DELETE_ORDER:
            handler = TEARDOWN_HANDLERS[table]
            try:
                handler(
                    client,
                    sim_ids=sim_ids,
                    org_ids=org_ids,
                    wine_ids=wine_ids,
                    auth_admin_delete=auth_admin_delete,
                )
                result["deleted"].append(table)
            except Exception as exc:  # noqa: BLE001 — never raise
                _capture_sim_orphan(
                    exc, context={"table": table, "sim_ids": list(sim_ids)}
                )
                result["errors"].append({"table": table, "error": str(exc)})
                result["orphans"].append(table)
        return result
    except Exception as exc:  # noqa: BLE001 — absolute never-raise
        _capture_sim_orphan(exc, context={"phase": "teardown_sim"})
        result["errors"].append({"table": "*", "error": str(exc)})
        result["orphans"].append("*")
        result["ok"] = True
        return result


def _default_supabase_client() -> Any | None:
    import os

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client

        return create_client(url, key)
    except Exception as exc:  # noqa: BLE001
        _capture_sim_orphan(exc, context={"phase": "create_client"})
        return None


__all__ = [
    "DELETE_ORDER",
    "E2E_ANCHOR_GUARD",
    "NOOP_TABLES",
    "TEARDOWN_HANDLERS",
    "TEARDOWN_TABLES",
    "WriteSetTeardownCoverageError",
    "assert_teardown_coverage",
    "filter_sim_restaurant_ids",
    "refuse_multi_archetype_apply_unless_ready",
    "resolve_sim_restaurant_ids",
    "teardown_sim",
]
