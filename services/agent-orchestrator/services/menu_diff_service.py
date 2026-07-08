"""
MenuDiffService — Phase 11 TEMP-03 / TEMP-04

Compares a new crawl wine list against the restaurant_wine_roster baseline.
Emits menu_changes events (added/removed/price_change).
Upserts restaurant_wine_roster to reflect the new current state.

CRITICAL GUARD: empty new_wines list is always skipped — it signals a crawl
failure, not "all wines removed". Treat it as a no-op.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class MenuDiffService:
    """
    Synchronous diff engine. All Supabase calls are sync (supabase-py pattern).
    """

    def __init__(self, supabase_client: Any) -> None:
        self.supabase = supabase_client

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    def run_diff(
        self,
        restaurant_id: str,
        new_wines: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Core diff: new crawl set ↔ current roster → menu_changes events → upsert roster.

        Returns a summary dict: {"added": N, "removed": N, "price_changed": N, "skipped": bool}.

        GUARD: if len(new_wines) == 0, return skipped — do NOT create mass-removal events.
        """
        if not new_wines:
            logger.info(
                "menu_diff: skipping diff for restaurant_id=%s — empty crawl result",
                restaurant_id,
            )
            return {
                "added": 0,
                "removed": 0,
                "price_changed": 0,
                "skipped": True,
                "reason": "empty_crawl",
            }

        # Build lookup from new crawl (keyed by signature_hash)
        new_hashes: Dict[str, Dict[str, Any]] = {
            w["signature_hash"]: w for w in new_wines if w.get("signature_hash")
        }

        if not new_hashes:
            logger.warning(
                "menu_diff: all %d wines missing signature_hash for restaurant_id=%s — skipping",
                len(new_wines),
                restaurant_id,
            )
            return {
                "added": 0,
                "removed": 0,
                "price_changed": 0,
                "skipped": True,
                "reason": "no_hashes",
            }

        # Fetch current roster
        old_roster: Dict[str, Dict[str, Any]] = self._fetch_roster(restaurant_id)

        # Compute set operations
        added_hashes = set(new_hashes) - set(old_roster)
        removed_hashes = set(old_roster) - set(new_hashes)
        shared_hashes = set(new_hashes) & set(old_roster)
        price_changed_hashes = {
            h for h in shared_hashes if self._price_gate(new_hashes[h], old_roster[h])
        }

        # Build menu_changes events
        now_iso = datetime.now(timezone.utc).isoformat()
        events: List[Dict[str, Any]] = []

        for h in added_hashes:
            events.append(
                self._change_event(
                    restaurant_id,
                    h,
                    "added",
                    old_value=None,
                    new_value=new_hashes[h],
                    detected_at=now_iso,
                )
            )
        for h in removed_hashes:
            events.append(
                self._change_event(
                    restaurant_id,
                    h,
                    "removed",
                    old_value=old_roster[h],
                    new_value=None,
                    detected_at=now_iso,
                )
            )
        for h in price_changed_hashes:
            events.append(
                self._change_event(
                    restaurant_id,
                    h,
                    "price_change",
                    old_value=old_roster[h],
                    new_value=new_hashes[h],
                    detected_at=now_iso,
                )
            )

        # Persist events
        if events:
            try:
                self.supabase.table("menu_changes").insert(events).execute()
                logger.info(
                    "menu_diff: restaurant_id=%s — %d added, %d removed, %d price_changed",
                    restaurant_id,
                    len(added_hashes),
                    len(removed_hashes),
                    len(price_changed_hashes),
                )
            except Exception as exc:
                logger.error("menu_diff: failed to insert menu_changes: %s", exc)
                raise

        # Upsert roster (updates last_seen_at for existing; inserts new)
        self._upsert_roster(restaurant_id, list(new_hashes.values()))

        return {
            "added": len(added_hashes),
            "removed": len(removed_hashes),
            "price_changed": len(price_changed_hashes),
            "skipped": False,
        }

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    def _fetch_roster(self, restaurant_id: str) -> Dict[str, Dict[str, Any]]:
        """Return current roster rows keyed by signature_hash."""
        try:
            resp = (
                self.supabase.table("restaurant_wine_roster")
                .select(
                    "signature_hash, wine_name, price_reference, first_seen_at, last_seen_at"
                )
                .eq("restaurant_id", restaurant_id)
                .execute()
            )
            return {row["signature_hash"]: row for row in (resp.data or [])}
        except Exception as exc:
            logger.error(
                "menu_diff: failed to fetch roster for %s: %s", restaurant_id, exc
            )
            return {}

    @staticmethod
    def _price_gate(new_wine: Dict[str, Any], old_roster_row: Dict[str, Any]) -> bool:
        """
        D-03 price change gate: abs(new-old) >= $1.00 AND relative change >= 3%.
        Returns False for None prices or zero old_price (avoids ZeroDivisionError).
        """
        new_p = new_wine.get("price_reference")
        old_p = old_roster_row.get("price_reference")
        if new_p is None or old_p is None or old_p == 0:
            return False
        try:
            abs_diff = abs(float(new_p) - float(old_p))
            rel_diff = abs_diff / float(old_p)
            return abs_diff >= 1.0 and rel_diff >= 0.03
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _build_snapshot(wine: Dict[str, Any]) -> Dict[str, Any]:
        """
        D-03: Build JSONB snapshot dict for menu_changes old_value/new_value.
        Shape: {wine_name, producer, vintage, price_reference, signature_hash}
        """
        return {
            "wine_name": wine.get("wine_name"),
            "producer": wine.get("producer"),
            "vintage": wine.get("vintage"),
            "price_reference": wine.get("price_reference"),
            "signature_hash": wine.get("signature_hash"),
        }

    def _change_event(
        self,
        restaurant_id: str,
        signature_hash: str,
        change_type: str,
        old_value: Optional[Dict[str, Any]],
        new_value: Optional[Dict[str, Any]],
        detected_at: str,
    ) -> Dict[str, Any]:
        """Build a menu_changes row dict."""
        return {
            "restaurant_id": restaurant_id,
            "wine_signature_hash": signature_hash,
            "change_type": change_type,
            "old_value": self._build_snapshot(old_value) if old_value else None,
            "new_value": self._build_snapshot(new_value) if new_value else None,
            "detected_at": detected_at,
        }

    def _upsert_roster(
        self, restaurant_id: str, new_wines: List[Dict[str, Any]]
    ) -> None:
        """
        Upsert restaurant_wine_roster rows.
        On conflict (restaurant_id, signature_hash): update last_seen_at + price_reference.
        On insert: set first_seen_at and last_seen_at = NOW().

        Note: first_seen_at is supplied but NOT overwritten on conflict — Supabase PostgREST
        upsert updates only non-conflict columns; the DB constraint preserves the original
        first_seen_at value for existing rows.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        rows = []
        for wine in new_wines:
            h = wine.get("signature_hash")
            if not h:
                continue
            rows.append(
                {
                    "restaurant_id": restaurant_id,
                    "signature_hash": h,
                    "wine_name": wine.get("wine_name"),
                    "price_reference": wine.get("price_reference"),
                    "first_seen_at": now_iso,
                    "last_seen_at": now_iso,
                }
            )
        if not rows:
            return
        try:
            self.supabase.table("restaurant_wine_roster").upsert(
                rows,
                on_conflict="restaurant_id,signature_hash",
            ).execute()
        except Exception as exc:
            logger.error(
                "menu_diff: failed to upsert roster for %s: %s", restaurant_id, exc
            )
            raise
