#!/usr/bin/env python3
"""Build a labelled evaluation set for identity/merge decisions, from real menus.

Why this exists
---------------
Matcher precision was previously measured against probes I generated myself,
which cannot find the errors I did not think to simulate. This set is different:
its labels come from the world, not from an assumption.

    Two DIFFERENT entries on the SAME menu are different products.

A restaurant does not print one bottle twice at two prices. So every pair of
distinct entries within a single menu is a free NEGATIVE label, and there are
tens of thousands of them. That is the instrument that turns "is our merge
policy safe?" from an opinion into a number.

Two caveats are handled rather than ignored:

  * Extraction sometimes emits the same bottle twice on one menu, once with the
    producer echoed into the name ("Maker's Mark | Bourbon" and "Maker's Mark |
    Maker's Mark Bourbon"). Those pairs are NOT negatives; they are flagged
    `artifact` and excluded from the negative set.
  * Some rows are under-identified -- the extractor wrote the appellation into
    the producer field, so six different Hermitage Blanc wines are stored
    identically. Those pairs are unlabelable by construction: no matcher can
    separate rows that carry no distinguishing information. They are flagged
    `under_identified` and excluded, because counting them as false merges
    would blame the matcher for an extraction defect.

Positives are built without hand labelling too: two entries on DIFFERENT menus
that coincide under an aggressive orthographic canonicalisation are the same
product spelt differently ("Johnnie Walker Blue" / "Johnnie Walker Blue Label").
The positive set is small and is honestly reported as such -- it bounds recall
loosely, while the negative set bounds precision tightly. That asymmetry matches
the risk: a false merge is silent and global, a false split is visible and cheap.

Output: datasets/merge_eval/entries.json -- rows with menu attribution and
flags. Pairs are derived at test time so the fixture stays small and the pairing
rule stays visible in the test rather than baked into data.
"""
from __future__ import annotations

import collections
import json
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXTRACTED = ROOT / "datasets/menu_corpus/extracted"
OUT = ROOT / "datasets/merge_eval"

SPIRIT = re.compile(
    r"\b(whisk|bourbon|rye|scotch|vodka|gin|rum|tequila|mezcal|cognac|armagnac|"
    r"brandy|liqueur|amaro|aperol|campari|vermouth|absinthe|pisco|cachaca|soju|"
    r"shochu)\b"
)
BEER = re.compile(r"\b(beer|lager|pilsner|ipa|ale|stout|porter|hefeweizen|cider)\b")
SAKE = re.compile(r"\b(sake|junmai|ginjo|daiginjo|nigori|honjozo)\b")

# Appellations and regions that menus routinely place in the producer column.
# A row whose producer is one of these and whose name repeats it carries no
# identity: several different growers collapse onto one string.
APPELLATION_HINT = re.compile(
    r"\b(hermitage|cornas|cote|cotes|rotie|brune|blonde|rhone|petrus|chablis|"
    r"sancerre|pouilly|chateauneuf|barolo|barbaresco|brunello|chianti|rioja|"
    r"champagne|bourgogne|meursault|puligny|chassagne|gevrey|vosne|nuits|"
    r"margaux|pauillac|saint|pomerol|medoc|graves|sauternes|beaujolais|"
    r"morgon|fleurie|etna|soave|valpolicella|priorat|ribera|douro|mosel)\b"
)


def norm(value) -> str:
    s = unicodedata.normalize("NFD", str(value or ""))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def canon_loose(text: str) -> str:
    """Aggressive canonicalisation used ONLY to propose positives."""
    for pattern, repl in (
        (r"\byrs?\b|\byears?\b|\byo\b", "yr"),
        (r"\bthe\b", ""),
        (r"\blabel\b", ""),
        (r"\bsingle malt\b", ""),
        (r"\bscotch\b|\bwhisky\b|\bwhiskey\b|\bbourbon\b", ""),
        (r"\bold\b", ""),
        (r"\s+", " "),
    ):
        text = re.sub(pattern, repl, text)
    return text.strip()


def category_of(blob: str) -> str:
    if SAKE.search(blob):
        return "sake"
    if BEER.search(blob):
        return "beer"
    if SPIRIT.search(blob):
        return "spirit"
    return "wine"


def is_artifact(pa: str, na: str, pb: str, nb: str) -> bool:
    """One row is the other with the producer echoed into the name."""
    a, b = norm(na), norm(nb)
    ka, kb = norm(pa), norm(pb)
    return (
        a == norm(f"{kb} {b}")
        or b == norm(f"{ka} {a}")
        or a == norm(f"{ka} {b}")
        or b == norm(f"{kb} {a}")
    )


def main() -> None:
    entries: list[dict] = []
    for path in sorted(EXTRACTED.glob("*.json")):
        if path.name == "manifest.json":
            continue
        for wine in json.loads(path.read_text())["wines"]:
            producer = wine.get("producer") or ""
            name = wine.get("name") or ""
            if not (producer or name):
                continue
            blob = norm(" ".join(str(wine.get(k) or "") for k in
                                 ("name", "producer", "category", "region", "grape_variety")))
            np_, nn = norm(producer), norm(name)
            entries.append({
                "menu": path.stem,
                "producer": producer,
                "name": name,
                "vintage": wine.get("vintage"),
                "price": wine.get("bottle_price") or wine.get("by_glass_price"),
                "category": category_of(blob),
                # A row that repeats its producer as its whole name, where that
                # producer looks like a place, cannot be told apart from its
                # neighbours. Excluded from labelling, and a defect in its own
                # right -- see BEVERAGE_CATALOGUE_ARCHITECTURE.md §3.5.
                "under_identified": bool(np_ and np_ == nn and APPELLATION_HINT.search(np_)),
            })

    by_menu: dict[str, list[int]] = collections.defaultdict(list)
    for idx, entry in enumerate(entries):
        by_menu[entry["menu"]].append(idx)

    negatives = artifacts = skipped = 0
    for indices in by_menu.values():
        for i, a in enumerate(indices):
            for b in indices[i + 1:]:
                ea, eb = entries[a], entries[b]
                if ea["under_identified"] or eb["under_identified"]:
                    skipped += 1
                elif is_artifact(ea["producer"], ea["name"], eb["producer"], eb["name"]):
                    artifacts += 1
                elif norm(f"{ea['producer']} {ea['name']}") == norm(f"{eb['producer']} {eb['name']}"):
                    artifacts += 1
                else:
                    negatives += 1

    buckets: dict[str, list[int]] = collections.defaultdict(list)
    for idx, entry in enumerate(entries):
        buckets[canon_loose(norm(f"{entry['producer']} {entry['name']}"))].append(idx)
    positives = sum(
        1
        for indices in buckets.values()
        for i, a in enumerate(indices)
        for b in indices[i + 1:]
        if entries[a]["menu"] != entries[b]["menu"]
        and norm(f"{entries[a]['producer']} {entries[a]['name']}")
        != norm(f"{entries[b]['producer']} {entries[b]['name']}")
    )

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "entries.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1))
    manifest = {
        "entries": len(entries),
        "menus": len(by_menu),
        "by_category": dict(collections.Counter(e["category"] for e in entries)),
        "under_identified": sum(1 for e in entries if e["under_identified"]),
        "derived_negative_pairs": negatives,
        "excluded_extraction_artifacts": artifacts,
        "excluded_under_identified_pairs": skipped,
        "derived_positive_pairs": positives,
        "label_rule": "same menu + different entry => different products",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    for key, value in manifest.items():
        print(f"  {key:<34} {value}")


if __name__ == "__main__":
    main()
