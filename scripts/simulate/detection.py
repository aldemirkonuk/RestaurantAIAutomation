"""Mirror of the hub's wine-detection fallback, for measuring it.

`PosHubService.resolveWine` tries `pos_item_mappings` first and falls back to two
signals: the POS CATEGORY, then a keyword scan of the item NAME. On a fresh tenant
there are no mappings, so those two signals are the whole of it.

This module reimplements both so a simulator run can report their hit rates BEFORE
anything is posted. Those numbers are a precondition, not trivia: if generated wine
names miss the fallback, the analytics ingress records them as food, and a run that
"succeeded" proves nothing about the wine pipeline.

Two rates are reported, because they answer different questions:

  - `hit_rate` is what the system actually does — category first, name second. It
    is the number that predicts whether wine analytics will be right for a tenant
    whose POS sends categories.
  - `name_hit_rate` is the backstop alone, with the category withheld. It is the
    number for a POS that sends no category, and it is the one that was 35.2% on
    the bistro list when WINE_WORDS held grapes but no appellations.

Reporting only the first would hide a regression in the second, since every wine
in the snapshots carries a wine category.

Kept in lockstep with `apps/api-gateway/src/pos-hub/pos-hub.service.ts` and with
`POSIntegrationAgent` on the other ingress. If a list there changes and this one
does not, the reported rate becomes a comfortable fiction — so
`scripts/test_simulate.py` asserts all three copies match.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Literal

from scripts.simulate.service import FOOD_ITEMS, WineList, generate_service

#: Verbatim from pos-hub.service.ts, in the same order. See the TypeScript for why
#: each list is drawn where it is — in particular why 'pecorino' and 'bianco' are
#: absent from WINE_WORDS, and why 'beverage' is absent from NON_WINE_CATEGORY_WORDS.
WINE_CATEGORY_WORDS: tuple[str, ...] = (
    "wine",
    "wines",
    "vino",
    "vini",
    "vin",
    "vins",
    "vinho",
    "vinhos",
    "weine",
    "şarap",
    "sarap",
    "şaraplar",
    "saraplar",
)

WINE_STYLE_CATEGORY_WORDS: tuple[str, ...] = (
    "champagne",
    "sparkling",
    "bubbles",
    "bubbly",
    "prosecco",
    "cava",
    "rosé",
    "rose",
    "rosato",
    "by the glass",
    "by the bottle",
    "btg",
    "cellar",
    "sommelier",
    "somm",
)

NON_WINE_CATEGORY_WORDS: tuple[str, ...] = (
    "beer",
    "beers",
    "draft",
    "draught",
    "cider",
    "seltzer",
    "kombucha",
    "cocktail",
    "cocktails",
    "mocktail",
    "spirit",
    "spirits",
    "liquor",
    "whiskey",
    "whisky",
    "bourbon",
    "vodka",
    "gin",
    "tequila",
    "mezcal",
    "rum",
    "sake",
    "water",
    "soda",
    "juice",
    "coffee",
    "espresso",
    "tea",
    "food",
    "kitchen",
    "appetizer",
    "appetizers",
    "starter",
    "starters",
    "snack",
    "snacks",
    "salad",
    "salads",
    "soup",
    "soups",
    "pasta",
    "pizza",
    "entree",
    "entrée",
    "entrees",
    "main",
    "mains",
    "side",
    "sides",
    "dessert",
    "desserts",
    "bread",
    "charcuterie",
    "cheese",
    "sushi",
    "raw bar",
    "breakfast",
    "brunch",
    "lunch",
    "kids",
    "retail",
    "merch",
)

WINE_WORDS: tuple[str, ...] = (
    "wine",
    "vino",
    "vinho",
    "vin santo",
    "şarap",
    "sarap",
    "rosé",
    "rose",
    "rosato",
    "rosado",
    "red blend",
    "white blend",
    "meritage",
    "cuvee",
    "cuvée",
    "house red",
    "house white",
    "cru",
    "reserva",
    "riserva",
    "port",
    "sherry",
    "madeira",
    "winery",
    "vineyard",
    "weingut",
    "domaine",
    "chateau",
    "château",
    "tenuta",
    "quinta",
    "vignoble",
    "champagne",
    "prosecco",
    "cava",
    "brut",
    "blanc de",
    "cremant",
    "crémant",
    "franciacorta",
    "lambrusco",
    "sekt",
    "chardonnay",
    "sauvignon",
    "riesling",
    "pinot",
    "merlot",
    "cabernet",
    "syrah",
    "sirah",
    "shiraz",
    "malbec",
    "tempranillo",
    "nebbiolo",
    "sangiovese",
    "grenache",
    "garnacha",
    "zinfandel",
    "viognier",
    "chenin",
    "gamay",
    "semillon",
    "sémillon",
    "mourvedre",
    "mourvèdre",
    "monastrell",
    "cinsault",
    "carignan",
    "marsanne",
    "roussanne",
    "petit verdot",
    "gewurztraminer",
    "gewürztraminer",
    "moscato",
    "muscat",
    "carmenere",
    "carménère",
    "pinotage",
    "tannat",
    "torrontes",
    "torrontés",
    "chianti",
    "barolo",
    "barbaresco",
    "montalcino",
    "brunello",
    "montepulciano",
    "vernaccia",
    "valpolicella",
    "ripasso",
    "amarone",
    "soave",
    "gavi",
    "roero",
    "etna",
    "taurasi",
    "orvieto",
    "frascati",
    "bolgheri",
    "morellino",
    "cannonau",
    "cerasuolo",
    "super tuscan",
    "barbera",
    "dolcetto",
    "arneis",
    "vermentino",
    "verdicchio",
    "falanghina",
    "fiano",
    "greco",
    "grechetto",
    "grillo",
    "ribolla",
    "vitovska",
    "rossese",
    "malvasia",
    "trebbiano",
    "garganega",
    "cortese",
    "corvina",
    "nerello",
    "mascalese",
    "aglianico",
    "avola",
    "timorasso",
    "bellone",
    "friulano",
    "teroldego",
    "lagrein",
    "sagrantino",
    "negroamaro",
    "primitivo",
    "bordeaux",
    "burgundy",
    "bourgogne",
    "chablis",
    "sancerre",
    "vouvray",
    "chinon",
    "muscadet",
    "pouilly",
    "gigondas",
    "cotes du",
    "côtes du",
    "chateauneuf",
    "châteauneuf",
    "beaujolais",
    "macon",
    "mâcon",
    "sauternes",
    "medoc",
    "médoc",
    "pauillac",
    "margaux",
    "montrachet",
    "echezeaux",
    "échezeaux",
    "corton",
    "romanee",
    "romanée",
    "bonnezeaux",
    "rioja",
    "priorat",
    "ribera",
    "rueda",
    "bierzo",
    "mencia",
    "mencía",
    "albarino",
    "albariño",
    "alvarinho",
    "verdejo",
    "godello",
    "txakoli",
    "txakolina",
    "tinto",
    "tinta",
    "tintillo",
    "douro",
    "dao",
    "dão",
    "alentejo",
    "touriga",
    "gruner",
    "grüner",
    "veltliner",
    "blaufrankisch",
    "blaufränkisch",
    "zweigelt",
    "spatlese",
    "spätlese",
    "kabinett",
    "trocken",
    "assyrtiko",
    "xinomavro",
    "agiorgitiko",
    "agioritiko",
    "malagousia",
    "moschofilero",
    "moscofilero",
    "monemvasia",
    "monemvasios",
    "kidonitsa",
    "savatiano",
    "retsina",
    "santorini",
    "nemea",
    "okuzgozu",
    "öküzgözü",
    "bogazkere",
    "boğazkere",
    "kalecik",
    "narince",
    "calkarasi",
    "çalkarası",
)

CategoryVerdict = Literal["wine", "not_wine", "unknown"]


def _bounded(words: tuple[str, ...]) -> re.Pattern[str]:
    """One alternation per list, compiled once.

    Python's `\\w` is unicode-aware, which is what the TypeScript side spells out
    as `[\\p{L}\\p{N}_]` so the two matchers agree character for character.
    """
    return re.compile(
        r"(?<!\w)(?:" + "|".join(re.escape(w) for w in words) + r")(?!\w)",
        re.IGNORECASE,
    )


_WINE_CATEGORY_RE = _bounded(WINE_CATEGORY_WORDS)
_WINE_STYLE_CATEGORY_RE = _bounded(WINE_STYLE_CATEGORY_WORDS)
_NON_WINE_CATEGORY_RE = _bounded(NON_WINE_CATEGORY_WORDS)
_WINE_WORD_RE = _bounded(WINE_WORDS)


def classify_wine_category(category: str | None) -> CategoryVerdict:
    """Signal 1: what the POS category says."""
    value = (category or "").strip()
    if not value:
        return "unknown"
    if _WINE_CATEGORY_RE.search(value):
        return "wine"
    if _NON_WINE_CATEGORY_RE.search(value):
        return "not_wine"
    if _WINE_STYLE_CATEGORY_RE.search(value):
        return "wine"
    return "unknown"


def looks_like_wine(name: str) -> bool:
    """Signal 2: the hub's name backstop, matched on word boundaries."""
    return bool(_WINE_WORD_RE.search(name or ""))


def detect_wine(name: str, category: str | None = None) -> bool:
    """The hub's fallback in full: category first, name second."""
    verdict = classify_wine_category(category)
    if verdict != "unknown":
        return verdict == "wine"
    return looks_like_wine(name)


def detection_report(
    wine_list: WineList,
    *,
    base_covers: int,
    seed: int,
    days: int,
) -> dict[str, Any]:
    """Measure how much of a run's wine the fallback would catch."""
    start = date.today() - timedelta(days=days)
    wine_items = 0
    hits = 0
    name_hits = 0
    misses: list[str] = []
    name_misses: list[str] = []
    seen_misses: set[str] = set()
    seen_name_misses: set[str] = set()

    for offset in range(days):
        day = start + timedelta(days=offset)
        for check in generate_service(
            day, wines=wine_list, base_covers=base_covers, seed=seed
        ):
            for item in check.items:
                if not item.is_wine:
                    continue
                wine_items += 1
                if detect_wine(item.name, item.category):
                    hits += 1
                elif item.name not in seen_misses:
                    seen_misses.add(item.name)
                    misses.append(item.name)
                # The backstop on its own, for a POS that sends no category.
                if looks_like_wine(item.name):
                    name_hits += 1
                elif item.name not in seen_name_misses:
                    seen_name_misses.add(item.name)
                    name_misses.append(item.name)

    # A food item that reads as wine would inflate depletion against wines that
    # were never poured, so it is worth counting separately — and against the
    # real mechanism (category included), not the name scan alone.
    food_false_positives = sorted(
        name
        for name, category, _price in FOOD_ITEMS
        if detect_wine(name, category)
    )

    return {
        "wine_items": wine_items,
        "hits": hits,
        "hit_rate": (hits / wine_items) if wine_items else 0.0,
        "misses": misses,
        "distinct_misses": len(misses),
        "name_hits": name_hits,
        "name_hit_rate": (name_hits / wine_items) if wine_items else 0.0,
        "name_misses": name_misses,
        "distinct_name_misses": len(name_misses),
        "food_false_positives": food_false_positives,
    }
