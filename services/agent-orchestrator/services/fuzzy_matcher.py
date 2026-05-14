from __future__ import annotations

from typing import List, Optional

from rapidfuzz import fuzz


class FuzzyMatcher:
    """
    Jaro-Winkler (token_sort_ratio) for provider names — tolerates punctuation drift.
    Levenshtein (token_set_ratio) for wine names — tolerates vintage year suffix inclusion.

    Used by ProviderCommunicationAgent for D-32-15 off-app invoice matching.

    Composite match score formula:
      provider_name  × 0.30
      wine_name      × 0.40
      qty_in_range   × 0.15  (bool: quantity within 30% of order quantity)
      date_in_range  × 0.15  (bool: invoice date within 45 days of order created_at)
    ─────────────────────────
    Total            1.00

    Thresholds (D-32-15):
      ≥ 0.80 → auto-suggest ("This invoice looks like order #X")
      0.50–0.80 → possible match (manager confirmation required)
      < 0.50 → no match (offer retroactive order creation)
    """

    AUTO_SUGGEST_THRESHOLD = 0.80
    POSSIBLE_MATCH_THRESHOLD = 0.50

    def match_provider_name(self, candidate: str, known_name: str) -> float:
        """
        Token sort ratio — reorders tokens before comparing.
        'Burgundy Imports LLC' vs 'Imports Burgundy' → 1.0 (not 0.6).
        Returns float 0.0–1.0.
        """
        if not candidate or not known_name:
            return 0.0
        return fuzz.token_sort_ratio(candidate.lower().strip(), known_name.lower().strip()) / 100.0

    def match_wine_name(self, candidate: str, known_name: str) -> float:
        """
        Token set ratio — best alignment of overlapping tokens.
        'Pommard 2019 1er Cru Villages' vs 'Pommard' → high score (superset match).
        Returns float 0.0–1.0.
        """
        if not candidate or not known_name:
            return 0.0
        return fuzz.token_set_ratio(candidate.lower().strip(), known_name.lower().strip()) / 100.0

    def compute_match_score(
        self,
        provider_score: float,
        wine_score: float,
        qty_within_30pct: bool,
        date_within_45d: bool,
    ) -> float:
        """
        Composite D-32-15 matching score.
        All inputs validated to [0.0, 1.0] range.
        """
        p = max(0.0, min(1.0, provider_score))
        w = max(0.0, min(1.0, wine_score))
        return (
            p * 0.30
            + w * 0.40
            + (0.15 if qty_within_30pct else 0.0)
            + (0.15 if date_within_45d else 0.0)
        )

    def classify_match(self, score: float) -> str:
        """
        Returns 'auto_suggest' | 'possible_match' | 'no_match' per D-32-15 thresholds.
        """
        if score >= self.AUTO_SUGGEST_THRESHOLD:
            return "auto_suggest"
        if score >= self.POSSIBLE_MATCH_THRESHOLD:
            return "possible_match"
        return "no_match"

    def best_order_match(
        self,
        extracted_provider: str,
        extracted_wine: str,
        extracted_quantity: Optional[float],
        extracted_date: Optional[str],
        orders: List[dict],
    ) -> Optional[dict]:
        """
        Find the best matching procurement_order from a list.
        Each order dict must have: provider_name, wine_name, quantity, created_at (ISO string).
        Returns the order dict with highest score, or None if no orders.
        """
        if not orders:
            return None

        best_score = -1.0
        best_order = None

        for order in orders:
            p_score = self.match_provider_name(extracted_provider, order.get("provider_name", ""))
            w_score = self.match_wine_name(extracted_wine, order.get("wine_name", ""))

            order_qty = order.get("quantity") or 0
            qty_ok = (
                bool(extracted_quantity)
                and order_qty > 0
                and abs(extracted_quantity - order_qty) / order_qty <= 0.30
            )

            date_ok = False  # Caller computes date proximity; default False
            if extracted_date and order.get("created_at"):
                try:
                    from datetime import datetime
                    inv_date = datetime.fromisoformat(extracted_date.replace("Z", "+00:00"))
                    ord_date = datetime.fromisoformat(order["created_at"].replace("Z", "+00:00"))
                    date_ok = abs((inv_date - ord_date).days) <= 45
                except (ValueError, TypeError):
                    pass

            score = self.compute_match_score(p_score, w_score, qty_ok, date_ok)
            if score > best_score:
                best_score = score
                best_order = {**order, "_match_score": score, "_match_class": self.classify_match(score)}

        return best_order


# ──────────────────────────────────────────────────────────────────────────
# Singleton
# ──────────────────────────────────────────────────────────────────────────

_fuzzy_matcher: Optional[FuzzyMatcher] = None


def get_fuzzy_matcher() -> FuzzyMatcher:
    global _fuzzy_matcher
    if _fuzzy_matcher is None:
        _fuzzy_matcher = FuzzyMatcher()
    return _fuzzy_matcher
