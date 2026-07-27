"""Oracle run + fact payload builders for Phase 41 (SYNTH-04 / D-08..D-09).

Never include passwords or JWTs in roster/profile payloads.
Sell prices in menu_price facts are copied from the snapshot only (D-04).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence
from uuid import uuid4

FACT_TYPES: tuple[str, ...] = (
    "profile",
    "roster",
    "sku",
    "menu_price",
    "opening_stock",
    "menu_quality_meta",
)

SEED_VERSION = "1.0.0"

SYNTH_01_KNOBS: tuple[str, ...] = (
    "cuisine",
    "size",
    "wine_program_depth",
    "sales_volume",
    "price_tier",
    "ordering_rhythm",
)


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _email_domain(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    return email.rsplit("@", 1)[-1].lower()


def _priced_count(items: Iterable[Mapping[str, Any]]) -> int:
    n = 0
    for row in items:
        if row.get("bottle_price") is not None or row.get("by_glass_price") is not None:
            n += 1
    return n


def build_run_row(
    *,
    profile: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    snapshot_path: str,
    snapshot_sha256: str,
    restaurant_id: str,
    run_id: str | None = None,
    seed_version: str = SEED_VERSION,
) -> dict[str, Any]:
    """Build a sim_ground_truth_runs row dict (not yet persisted)."""
    items = list(snapshot.get("items") or [])
    defaults = dict(profile.get("defaults") or {})
    params = {k: defaults.get(k) for k in SYNTH_01_KNOBS}
    menu_quality = snapshot.get("menu_quality") or "partial"
    if menu_quality not in ("full", "partial"):
        menu_quality = "partial"
    return {
        "id": run_id or str(uuid4()),
        "restaurant_id": restaurant_id,
        "archetype_id": profile.get("archetype_id") or snapshot.get("archetype_id"),
        "seed_version": seed_version,
        "menu_quality": menu_quality,
        "snapshot_path": snapshot_path,
        "snapshot_sha256": snapshot_sha256,
        "params": params,
        "sku_count": len(items),
        "priced_sku_count": _priced_count(items),
        "seeded_at": _utcnow(),
    }


def build_facts(
    *,
    profile: Mapping[str, Any],
    snapshot: Mapping[str, Any],
    roster: Sequence[Mapping[str, Any]],
    opening: Mapping[str, Mapping[str, Any]],
    restaurant_id: str,
    run_id: str,
) -> list[dict[str, Any]]:
    """Emit all six fact_types with Phase-41 payload contracts.

    ``opening`` is keyed by signature_hash →
    ``{stock_live, threshold_min, wine_name, master_wine_id}``.
    """
    facts: list[dict[str, Any]] = []
    recorded_at = _utcnow()
    defaults = dict(profile.get("defaults") or {})

    def _row(
        fact_type: str,
        payload: dict[str, Any],
        *,
        sku_key: str | None = None,
        entity_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "id": str(uuid4()),
            "run_id": run_id,
            "restaurant_id": restaurant_id,
            "fact_type": fact_type,
            "sku_key": sku_key,
            "entity_ref": entity_ref or {},
            "payload": payload,
            "recorded_at": recorded_at,
        }

    # profile — full SYNTH-01 params echo
    facts.append(
        _row(
            "profile",
            {k: defaults.get(k) for k in SYNTH_01_KNOBS}
            | {
                "archetype_id": profile.get("archetype_id"),
                "display_name": profile.get("display_name"),
                "restaurant": dict(profile.get("restaurant") or {}),
            },
            entity_ref={"restaurant_id": restaurant_id},
        )
    )

    # roster — never password
    for member in roster:
        email = member.get("email")
        facts.append(
            _row(
                "roster",
                {
                    "role": member["role"],
                    "user_id": member["user_id"],
                    "email_domain": _email_domain(email) if email else member.get("email_domain"),
                },
                entity_ref={"user_id": member["user_id"], "role": member["role"]},
            )
        )

    items = list(snapshot.get("items") or [])
    for item in items:
        sig = item.get("signature_hash") or ""
        facts.append(
            _row(
                "sku",
                {
                    "signature_hash": sig,
                    "name": item.get("wine_name"),
                    "producer": item.get("producer"),
                    "vintage": item.get("vintage"),
                },
                sku_key=sig,
            )
        )
        # menu_price from snapshot only — never invent
        facts.append(
            _row(
                "menu_price",
                {
                    "bottle_price": item.get("bottle_price"),
                    "by_glass_price": item.get("by_glass_price"),
                    "currency": "USD",
                },
                sku_key=sig,
            )
        )

    for sig, stock in opening.items():
        facts.append(
            _row(
                "opening_stock",
                {
                    "stock_live": stock["stock_live"],
                    "threshold_min": stock["threshold_min"],
                    "wine_name": stock["wine_name"],
                    "master_wine_id": stock["master_wine_id"],
                },
                sku_key=sig,
                entity_ref={"master_wine_id": stock["master_wine_id"]},
            )
        )

    facts.append(
        _row(
            "menu_quality_meta",
            {
                "menu_quality": snapshot.get("menu_quality") or "partial",
                "sku_count": len(items),
                "priced_sku_count": _priced_count(items),
                "source_url": snapshot.get("source_url"),
                "source_name": snapshot.get("source_name"),
                "extraction_model": snapshot.get("extraction_model"),
            },
        )
    )

    return facts


__all__ = [
    "FACT_TYPES",
    "SEED_VERSION",
    "build_facts",
    "build_run_row",
]
