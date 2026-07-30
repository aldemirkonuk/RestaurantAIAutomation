"""Mirror of the hub's wine-detection fallback, for measuring it.

`PosHubService.resolveWine` tries `pos_item_mappings` first and falls back to a
keyword scan of the item NAME (not the category). On a fresh tenant there are no
mappings, so the keyword scan is the whole of it.

This module reimplements that scan so a simulator run can report its hit rate
BEFORE anything is posted. That number is a precondition, not trivia: if generated
wine names largely miss the heuristic, the analytics ingress records them as food,
and a run that "succeeded" proves nothing about the wine pipeline.

Kept in lockstep with `apps/api-gateway/src/pos-hub/pos-hub.service.ts`. If the
list there changes and this one does not, the reported rate becomes a comfortable
fiction — so `scripts/test_simulate.py` asserts the two lists match.
"""

from __future__ import annotations

import random
from datetime import date, timedelta
from typing import Any

from scripts.simulate.service import FOOD_ITEMS, WineList, generate_service

#: Verbatim from PosHubService.WINE_WORDS, in the same order. Note " rose " keeps
#: its trailing space there to avoid matching "rosemary"; the leading space is
#: dropped because the TS code uses `includes` on a lowercased name.
WINE_WORDS: tuple[str, ...] = (
    "wine",
    "vino",
    "şarap",
    "sarap",
    "rosé",
    "rose ",
    "champagne",
    "prosecco",
    "cava",
    "brut",
    "chardonnay",
    "sauvignon",
    "riesling",
    "pinot",
    "merlot",
    "cabernet",
    "syrah",
    "shiraz",
    "malbec",
    "tempranillo",
    "nebbiolo",
    "sangiovese",
    "grenache",
    "zinfandel",
    "chianti",
    "bordeaux",
    "burgundy",
    "rioja",
    "barolo",
)


def looks_like_wine(name: str) -> bool:
    """The hub's fallback heuristic: substring scan of the lowercased name."""
    lowered = (name or "").lower()
    return any(word in lowered for word in WINE_WORDS)


def detection_report(
    wine_list: WineList,
    *,
    base_covers: int,
    seed: int,
    days: int,
) -> dict[str, Any]:
    """Measure how much of a run's wine the keyword fallback would catch."""
    start = date.today() - timedelta(days=days)
    wine_items = 0
    hits = 0
    misses: list[str] = []
    seen_misses: set[str] = set()

    for offset in range(days):
        day = start + timedelta(days=offset)
        for check in generate_service(
            day, wines=wine_list, base_covers=base_covers, seed=seed
        ):
            for item in check.items:
                if not item.is_wine:
                    continue
                wine_items += 1
                if looks_like_wine(item.name):
                    hits += 1
                elif item.name not in seen_misses:
                    seen_misses.add(item.name)
                    misses.append(item.name)

    # A food item that reads as wine would inflate depletion against wines that
    # were never poured, so it is worth counting separately.
    food_false_positives = sorted(
        name for name, _cat, _price in FOOD_ITEMS if looks_like_wine(name)
    )

    return {
        "wine_items": wine_items,
        "hits": hits,
        "hit_rate": (hits / wine_items) if wine_items else 0.0,
        "misses": misses,
        "distinct_misses": len(misses),
        "food_false_positives": food_false_positives,
    }
