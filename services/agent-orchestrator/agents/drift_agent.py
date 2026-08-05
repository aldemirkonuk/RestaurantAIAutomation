"""
Drift Agent — SimPOS catalog ↔ WineOps mappings/inventory
=========================================================
Compares ``simpos_catalog`` against ``pos_item_mappings`` and
``restaurant_inventory`` for sim-namespace restaurants only (decision C31:
slug must start with ``sim-``).

Tiered autonomy:
  - Safe / auto-healable → ``pos_catalog_match_proposals`` (match_method=
    ``drift_agent``) or info-level resolved findings for already-unmapped
    inactive catalog rows.
  - Money / stock → ``drift_findings`` with status ``open`` (never auto-applied).

Snapshot-hash based: hash of sorted
``(external_item_id, wine_name, vintage, size_ml, price, is_active)``.
Unchanged hash → decision_log only, no findings.
Every run and every finding writes a ``decision_log`` row.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any, Dict, List, Optional, Set

from core.base_agent import BaseAgent

POS_SOURCE = "simpos"
DECISION_SNAPSHOT = "drift_snapshot"
DECISION_FINDING = "drift_finding"
DECISION_CHECK = "drift_check"


def compute_catalog_snapshot_hash(catalog_rows: List[Dict[str, Any]]) -> str:
    """Deterministic hash over catalog identity fields (sorted)."""
    tuples = []
    for row in catalog_rows:
        tuples.append(
            (
                str(row.get("external_item_id") or ""),
                str(row.get("wine_name") or ""),
                row.get("vintage"),
                row.get("size_ml"),
                _normalize_price(row.get("price")),
                bool(row.get("is_active", True)),
            )
        )
    tuples.sort(key=lambda t: t[0])
    payload = json.dumps(tuples, sort_keys=False, default=str, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalize_price(value: Any) -> str:
    if value is None:
        return ""
    try:
        return f"{Decimal(str(value)):.2f}"
    except Exception:
        return str(value)


def _inventory_menu_price(inv: Dict[str, Any]) -> Optional[str]:
    for key in ("menu_price_current", "custom_price", "target_price"):
        if inv.get(key) is not None:
            return _normalize_price(inv.get(key))
    return None


class DriftAgent(BaseAgent):
    """Periodic SimPOS ↔ WineOps drift detector with tiered autonomy."""

    async def initialize(self) -> None:
        self.logger.info("Initializing Drift Agent (sim-namespace only)")
        self.logger.info("✓ Drift Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("system.control", "system.schedule.drift_check"),
            ("pos.events", "pos.catalog.changed"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> Dict[str, Any]:
        payload = message.get("payload") or message
        restaurant_id = payload.get("restaurant_id")
        if restaurant_id:
            return await self.check_restaurant(restaurant_id)
        return await self.scan_all_sim_restaurants()

    # =========================================================================
    # Public entry points
    # =========================================================================

    async def scan_all_sim_restaurants(self) -> Dict[str, Any]:
        """Scan every restaurant whose slug starts with ``sim-``."""
        restaurants = await self._list_sim_restaurants()
        results = []
        for rest in restaurants:
            rid = rest["id"]
            try:
                results.append(await self.check_restaurant(rid, slug=rest.get("slug")))
            except Exception as exc:
                self.logger.error(
                    f"Drift check failed for {rid}: {exc}", exc_info=True
                )
                results.append(
                    {
                        "restaurant_id": rid,
                        "error": str(exc),
                        "unchanged": False,
                        "findings": [],
                    }
                )
        return {
            "restaurants_scanned": len(restaurants),
            "results": results,
        }

    async def check_restaurant(
        self, restaurant_id: str, slug: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Run one drift check for a restaurant.

        Always writes a decision_log row for the check. If the snapshot hash
        matches the previous run, returns early with ``unchanged=True``.
        """
        if slug is None:
            slug = await self._get_restaurant_slug(restaurant_id)
        if not slug or not str(slug).startswith("sim-"):
            await self.log_decision(
                decision_type=DECISION_CHECK,
                inputs={"restaurant_id": restaurant_id, "slug": slug},
                output={"skipped": True, "reason": "not_sim_namespace"},
                reasoning="Sim-namespace guard (C31): refuse non-sim restaurants",
                confidence=1.0,
                restaurant_id=restaurant_id,
            )
            return {
                "restaurant_id": restaurant_id,
                "skipped": True,
                "reason": "not_sim_namespace",
                "unchanged": True,
                "findings": [],
            }

        catalog = await self._load_catalog(restaurant_id)
        snapshot_hash = compute_catalog_snapshot_hash(catalog)
        previous_hash = await self._load_previous_snapshot_hash(restaurant_id)

        if previous_hash and previous_hash == snapshot_hash:
            await self.log_decision(
                decision_type=DECISION_SNAPSHOT,
                inputs={
                    "restaurant_id": restaurant_id,
                    "catalog_count": len(catalog),
                },
                output={
                    "unchanged": True,
                    "snapshot_hash": snapshot_hash,
                    "previous_hash": previous_hash,
                },
                reasoning="Catalog snapshot hash unchanged since last drift check — no-op",
                confidence=1.0,
                restaurant_id=restaurant_id,
            )
            return {
                "restaurant_id": restaurant_id,
                "unchanged": True,
                "snapshot_hash": snapshot_hash,
                "findings": [],
            }

        mappings = await self._load_mappings(restaurant_id)
        inventory_by_id = await self._load_inventory_by_id(restaurant_id)

        findings = await self._detect_findings(
            restaurant_id=restaurant_id,
            catalog=catalog,
            mappings=mappings,
            inventory_by_id=inventory_by_id,
        )

        await self.log_decision(
            decision_type=DECISION_SNAPSHOT,
            inputs={
                "restaurant_id": restaurant_id,
                "catalog_count": len(catalog),
                "mapping_count": len(mappings),
            },
            output={
                "unchanged": False,
                "snapshot_hash": snapshot_hash,
                "previous_hash": previous_hash,
                "finding_count": len(findings),
                "finding_types": [f["finding_type"] for f in findings],
            },
            reasoning=(
                f"Catalog snapshot changed; detected {len(findings)} drift finding(s)"
            ),
            confidence=1.0,
            restaurant_id=restaurant_id,
        )

        return {
            "restaurant_id": restaurant_id,
            "unchanged": False,
            "snapshot_hash": snapshot_hash,
            "previous_hash": previous_hash,
            "findings": findings,
        }

    # =========================================================================
    # Detection + tiered autonomy
    # =========================================================================

    async def _detect_findings(
        self,
        restaurant_id: str,
        catalog: List[Dict[str, Any]],
        mappings: List[Dict[str, Any]],
        inventory_by_id: Dict[str, Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        mapped_ext: Dict[str, Dict[str, Any]] = {
            m["external_item_id"]: m
            for m in mappings
            if m.get("external_item_id") and m.get("inventory_id")
        }
        mapped_ids: Set[str] = set(mapped_ext.keys())
        catalog_by_ext = {
            c["external_item_id"]: c for c in catalog if c.get("external_item_id")
        }

        findings: List[Dict[str, Any]] = []

        for item in catalog:
            ext_id = item.get("external_item_id")
            if not ext_id:
                continue
            is_active = bool(item.get("is_active", True))
            mapping = mapped_ext.get(ext_id)

            if is_active and ext_id not in mapped_ids:
                # Safe: propose a new mapping (never silent write to pos_item_mappings)
                finding = await self._handle_new_item(restaurant_id, item)
                findings.append(finding)
                continue

            if not is_active and ext_id not in mapped_ids:
                # Safe info: inactive + already unmapped
                finding = await self._handle_removed_unmapped(restaurant_id, item)
                findings.append(finding)
                continue

            if not is_active and mapping:
                # Catalog deactivated but mapping still present — human should review
                finding = await self._write_drift_finding(
                    restaurant_id=restaurant_id,
                    finding_type="removed_item",
                    severity="warning",
                    details={
                        "external_item_id": ext_id,
                        "wine_name": item.get("wine_name"),
                        "mapping_id": mapping.get("id"),
                        "inventory_id": mapping.get("inventory_id"),
                        "reason": "catalog_inactive_mapping_present",
                    },
                    auto_healed=False,
                    status="open",
                    reasoning=(
                        "Catalog item deactivated while pos_item_mappings still points "
                        "at inventory — requires human approval to unmap"
                    ),
                )
                findings.append(finding)
                continue

            if is_active and mapping:
                inv = inventory_by_id.get(mapping["inventory_id"]) or {}
                price_finding = await self._maybe_price_change(
                    restaurant_id, item, mapping, inv
                )
                if price_finding:
                    findings.append(price_finding)

                stock_finding = await self._maybe_stock_mismatch(
                    restaurant_id, item, mapping, inv
                )
                if stock_finding:
                    findings.append(stock_finding)

        # Mappings whose external_item_id no longer exists in catalog at all
        for ext_id, mapping in mapped_ext.items():
            if ext_id not in catalog_by_ext:
                finding = await self._write_drift_finding(
                    restaurant_id=restaurant_id,
                    finding_type="removed_item",
                    severity="warning",
                    details={
                        "external_item_id": ext_id,
                        "mapping_id": mapping.get("id"),
                        "inventory_id": mapping.get("inventory_id"),
                        "item_name": mapping.get("item_name"),
                        "reason": "catalog_row_missing",
                    },
                    auto_healed=False,
                    status="open",
                    reasoning=(
                        "pos_item_mappings references an external_item_id absent from "
                        "simpos_catalog — requires human review"
                    ),
                )
                findings.append(finding)

        return findings

    async def _handle_new_item(
        self, restaurant_id: str, item: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Auto-healable: queue a catalog match proposal (pending)."""
        ext_id = item["external_item_id"]
        wine_name = item.get("wine_name") or "Unknown"
        proposal_id = await self._upsert_match_proposal(
            restaurant_id=restaurant_id,
            external_item_id=ext_id,
            item_name=wine_name,
        )
        decision_id = await self.log_decision(
            decision_type=DECISION_FINDING,
            inputs={
                "finding_type": "new_item",
                "external_item_id": ext_id,
                "wine_name": wine_name,
                "price": item.get("price"),
            },
            output={
                "action": "proposal",
                "proposal_id": proposal_id,
                "auto_healed": True,
            },
            reasoning=(
                "New active SimPOS catalog item with no pos_item_mappings row — "
                "queued pos_catalog_match_proposals (match_method=drift_agent)"
            ),
            confidence=0.9,
            restaurant_id=restaurant_id,
        )
        return {
            "finding_type": "new_item",
            "severity": "info",
            "status": "proposed",
            "auto_healed": True,
            "proposal_id": proposal_id,
            "decision_log_id": decision_id,
            "details": {"external_item_id": ext_id, "wine_name": wine_name},
        }

    async def _handle_removed_unmapped(
        self, restaurant_id: str, item: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Safe info: inactive catalog row already unmapped — auto-healed."""
        details = {
            "external_item_id": item.get("external_item_id"),
            "wine_name": item.get("wine_name"),
            "reason": "inactive_already_unmapped",
        }
        decision_id = await self.log_decision(
            decision_type=DECISION_FINDING,
            inputs={"finding_type": "removed_item", **details},
            output={"action": "noop", "auto_healed": True, "status": "resolved"},
            reasoning=(
                "Inactive catalog row is already unmapped — info-level auto-heal, "
                "no proposal or open finding required"
            ),
            confidence=1.0,
            restaurant_id=restaurant_id,
        )
        # Durable info row for auditability; marked resolved + auto_healed
        finding_id = await self._insert_drift_finding(
            restaurant_id=restaurant_id,
            finding_type="removed_item",
            severity="info",
            details=details,
            auto_healed=True,
            status="resolved",
            decision_log_id=decision_id,
        )
        return {
            "finding_type": "removed_item",
            "severity": "info",
            "status": "resolved",
            "auto_healed": True,
            "finding_id": finding_id,
            "decision_log_id": decision_id,
            "details": details,
        }

    async def _maybe_price_change(
        self,
        restaurant_id: str,
        item: Dict[str, Any],
        mapping: Dict[str, Any],
        inv: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        catalog_price = _normalize_price(item.get("price"))
        inv_price = _inventory_menu_price(inv)
        if not catalog_price or not inv_price:
            return None
        if catalog_price == inv_price:
            return None
        return await self._write_drift_finding(
            restaurant_id=restaurant_id,
            finding_type="price_change",
            severity="warning",
            details={
                "external_item_id": item.get("external_item_id"),
                "wine_name": item.get("wine_name"),
                "inventory_id": mapping.get("inventory_id"),
                "catalog_price": catalog_price,
                "inventory_price": inv_price,
            },
            auto_healed=False,
            status="open",
            reasoning=(
                "SimPOS catalog price differs from restaurant_inventory menu price — "
                "money-touching change requires human approval"
            ),
        )

    async def _maybe_stock_mismatch(
        self,
        restaurant_id: str,
        item: Dict[str, Any],
        mapping: Dict[str, Any],
        inv: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """
        Stock-touching mismatches that must never auto-apply.

        Triggers:
          - POS sells the SKU (catalog active) but WineOps inventory is inactive
          - physical_stock is set and differs from stock_live
        """
        if not inv:
            return await self._write_drift_finding(
                restaurant_id=restaurant_id,
                finding_type="stock_mismatch",
                severity="critical",
                details={
                    "external_item_id": item.get("external_item_id"),
                    "inventory_id": mapping.get("inventory_id"),
                    "reason": "mapped_inventory_missing",
                },
                auto_healed=False,
                status="open",
                reasoning=(
                    "Mapping points at a missing inventory row while catalog is active"
                ),
            )

        if inv.get("is_active") is False:
            return await self._write_drift_finding(
                restaurant_id=restaurant_id,
                finding_type="stock_mismatch",
                severity="warning",
                details={
                    "external_item_id": item.get("external_item_id"),
                    "inventory_id": mapping.get("inventory_id"),
                    "wine_name": item.get("wine_name"),
                    "reason": "catalog_active_inventory_inactive",
                    "stock_live": inv.get("stock_live"),
                },
                auto_healed=False,
                status="open",
                reasoning=(
                    "SimPOS catalog is active but restaurant_inventory.is_active is "
                    "false — stock/availability drift requires human approval"
                ),
            )

        physical = inv.get("physical_stock")
        live = inv.get("stock_live")
        if physical is not None and live is not None and int(physical) != int(live):
            return await self._write_drift_finding(
                restaurant_id=restaurant_id,
                finding_type="stock_mismatch",
                severity="critical",
                details={
                    "external_item_id": item.get("external_item_id"),
                    "inventory_id": mapping.get("inventory_id"),
                    "wine_name": item.get("wine_name"),
                    "physical_stock": physical,
                    "stock_live": live,
                    "reason": "physical_vs_live",
                },
                auto_healed=False,
                status="open",
                reasoning=(
                    "physical_stock differs from stock_live — stock-touching drift "
                    "requires human approval (never auto-apply)"
                ),
            )
        return None

    async def _write_drift_finding(
        self,
        restaurant_id: str,
        finding_type: str,
        severity: str,
        details: Dict[str, Any],
        auto_healed: bool,
        status: str,
        reasoning: str,
    ) -> Dict[str, Any]:
        decision_id = await self.log_decision(
            decision_type=DECISION_FINDING,
            inputs={"finding_type": finding_type, "severity": severity, **details},
            output={
                "action": "drift_finding",
                "auto_healed": auto_healed,
                "status": status,
            },
            reasoning=reasoning,
            confidence=0.95,
            restaurant_id=restaurant_id,
        )
        finding_id = await self._insert_drift_finding(
            restaurant_id=restaurant_id,
            finding_type=finding_type,
            severity=severity,
            details=details,
            auto_healed=auto_healed,
            status=status,
            decision_log_id=decision_id,
        )
        return {
            "finding_type": finding_type,
            "severity": severity,
            "status": status,
            "auto_healed": auto_healed,
            "finding_id": finding_id,
            "decision_log_id": decision_id,
            "details": details,
        }

    # =========================================================================
    # Persistence helpers
    # =========================================================================

    async def _upsert_match_proposal(
        self,
        restaurant_id: str,
        external_item_id: str,
        item_name: str,
    ) -> Optional[str]:
        sb = self.database.supabase
        try:
            existing = (
                sb.table("pos_catalog_match_proposals")
                .select("id")
                .eq("restaurant_id", restaurant_id)
                .eq("source", POS_SOURCE)
                .eq("external_item_id", external_item_id)
                .eq("status", "pending")
                .limit(1)
                .execute()
            )
            if existing.data:
                return existing.data[0].get("id")

            result = (
                sb.table("pos_catalog_match_proposals")
                .insert(
                    {
                        "restaurant_id": restaurant_id,
                        "source": POS_SOURCE,
                        "external_item_id": external_item_id,
                        "item_name": item_name,
                        "candidate_inventory_id": None,
                        "candidate_master_wine_id": None,
                        "confidence": None,
                        "match_method": "drift_agent",
                        "status": "pending",
                    }
                )
                .select("id")
                .execute()
            )
            if result.data:
                return result.data[0].get("id")
        except Exception as exc:
            self.logger.warning(f"Failed to upsert match proposal: {exc}")
        return None

    async def _insert_drift_finding(
        self,
        restaurant_id: str,
        finding_type: str,
        severity: str,
        details: Dict[str, Any],
        auto_healed: bool,
        status: str,
        decision_log_id: Optional[str],
    ) -> Optional[str]:
        try:
            row: Dict[str, Any] = {
                "restaurant_id": restaurant_id,
                "finding_type": finding_type,
                "severity": severity,
                "details": details,
                "auto_healed": auto_healed,
                "status": status,
            }
            if decision_log_id:
                row["decision_log_id"] = decision_log_id
            result = (
                self.database.supabase.table("drift_findings")
                .insert(row)
                .select("id")
                .execute()
            )
            if result.data:
                return result.data[0].get("id")
        except Exception as exc:
            self.logger.warning(f"Failed to insert drift_finding: {exc}")
        return None

    async def _load_previous_snapshot_hash(
        self, restaurant_id: str
    ) -> Optional[str]:
        """Read last snapshot hash from decision_log output metadata."""
        try:
            result = (
                self.database.supabase.table("decision_log")
                .select("output")
                .eq("agent_name", self.agent_name)
                .eq("decision_type", DECISION_SNAPSHOT)
                .eq("restaurant_id", restaurant_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if result.data:
                output = result.data[0].get("output") or {}
                return output.get("snapshot_hash")
        except Exception as exc:
            self.logger.warning(f"Failed to load previous snapshot hash: {exc}")
        return None

    async def _list_sim_restaurants(self) -> List[Dict[str, Any]]:
        try:
            result = (
                self.database.supabase.table("restaurants")
                .select("id, slug")
                .like("slug", "sim-%")
                .execute()
            )
            return result.data or []
        except Exception as exc:
            self.logger.error(f"Failed to list sim restaurants: {exc}")
            return []

    async def _get_restaurant_slug(self, restaurant_id: str) -> Optional[str]:
        try:
            result = (
                self.database.supabase.table("restaurants")
                .select("slug")
                .eq("id", restaurant_id)
                .limit(1)
                .execute()
            )
            if result.data:
                return result.data[0].get("slug")
        except Exception as exc:
            self.logger.warning(f"Failed to load restaurant slug: {exc}")
        return None

    async def _load_catalog(self, restaurant_id: str) -> List[Dict[str, Any]]:
        result = (
            self.database.supabase.table("simpos_catalog")
            .select(
                "id, external_item_id, wine_name, vintage, size_ml, price, is_active"
            )
            .eq("restaurant_id", restaurant_id)
            .execute()
        )
        return result.data or []

    async def _load_mappings(self, restaurant_id: str) -> List[Dict[str, Any]]:
        result = (
            self.database.supabase.table("pos_item_mappings")
            .select("id, external_item_id, item_name, inventory_id, master_wine_id")
            .eq("restaurant_id", restaurant_id)
            .in_("source", [POS_SOURCE, "*"])
            .execute()
        )
        return result.data or []

    async def _load_inventory_by_id(
        self, restaurant_id: str
    ) -> Dict[str, Dict[str, Any]]:
        result = (
            self.database.supabase.table("restaurant_inventory")
            .select(
                "id, wine_name, stock_live, physical_stock, is_active, "
                "menu_price_current, custom_price, target_price"
            )
            .eq("restaurant_id", restaurant_id)
            .execute()
        )
        rows = result.data or []
        return {r["id"]: r for r in rows if r.get("id")}
