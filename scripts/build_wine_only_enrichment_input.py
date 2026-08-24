#!/usr/bin/env python3
"""Build a wine-only input directory for resuming enrichment (plan A10).

Why this exists
---------------
2,099 corpus entries are unenriched, but only ~1,448 of them are WINE. The
rest are spirits, beer, sake, cider and cocktails -- all of which have since
been migrated out of master_wine_library into `beverages` / `cocktails`
(plan §2.1, §3). Enriching them with a wine-specific sommelier prompt would
spend money to produce wine attributes for a bottle of gin, for rows that no
longer live in the wine library at all.

This filters the extracted corpus down to just the wine-classified,
still-unenriched entries, so the resume run pays for exactly what it needs
(~$2.76 rather than ~$4).

Classification is delegated to `wine_classify_beverage_kind()` in the
database -- the SAME function that decides `master_wine_library.beverage_kind`
(plan §2.0) -- not a fresh keyword list written here. A second, drifting copy
of that vocabulary is exactly the "one fact, two homes" defect this plan
closes everywhere else.

Usage
-----
    python3 scripts/build_wine_only_enrichment_input.py --out <dir>
    python3 scripts/enrich_wines.py --in <dir> --out datasets/menu_corpus/enriched

The second command is safe to point at the real corpus directory: since
2026-08-18, enrich_wines.py carries forward every prior record its input does
not cover, so a filtered input can no longer truncate enriched.json.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import unicodedata

import psycopg2

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXTRACTED = ROOT / "datasets/menu_corpus/extracted"
ENRICHED = ROOT / "datasets/menu_corpus/enriched/enriched.json"


def norm(value) -> str:
    s = unicodedata.normalize("NFD", str(value or ""))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def key_of(entry: dict) -> tuple:
    return tuple(norm(entry.get(f)) for f in ("producer", "name", "vintage"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True,
                        help="directory to write the filtered extraction files into")
    args = parser.parse_args()

    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        dsn = next(
            line.split("=", 1)[1].strip()
            for line in (ROOT / ".env").read_text().splitlines()
            if line.startswith("SUPABASE_DB_URL=")
        )
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()

    docs = json.loads(ENRICHED.read_text())
    unenriched = [d for d in docs if d.get("enrichment") is None]
    print(f"corpus: {len(docs)} entries, {len(unenriched)} unenriched")

    categories = sorted({(d.get("extracted", {}).get("category") or "").strip()
                         for d in unenriched})
    kind_by_category: dict[str, str] = {}
    for category in categories:
        cur.execute("SELECT kind FROM wine_classify_beverage_kind(NULL, %s)", (category,))
        kind_by_category[category] = cur.fetchone()[0]

    wine_keys = {
        key_of(d["extracted"])
        for d in unenriched
        if kind_by_category.get((d.get("extracted", {}).get("category") or "").strip()) == "wine"
    }
    print(f"wine-classified and still unenriched: {len(wine_keys)}")
    skipped = {k: sum(1 for d in unenriched
                      if kind_by_category.get((d.get("extracted", {}).get("category") or "").strip()) == k)
               for k in sorted(set(kind_by_category.values())) if k != "wine"}
    print(f"skipped as non-wine (now in beverages/cocktails): {skipped}")

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for stale in out.glob("*.json"):
        stale.unlink()

    written = 0
    for path in sorted(EXTRACTED.glob("*.json")):
        if path.name == "manifest.json":
            continue
        doc = json.loads(path.read_text())
        keep = [w for w in doc["wines"] if key_of(w) in wine_keys]
        if keep:
            (out / path.name).write_text(
                json.dumps({**doc, "wines": keep}, ensure_ascii=False, indent=1)
            )
            written += len(keep)

    print(f"\nwrote {written} wine entries across "
          f"{len(list(out.glob('*.json')))} menu files -> {out}")
    print(f"\nnext:\n  python3 scripts/enrich_wines.py --in {out} "
          f"--out datasets/menu_corpus/enriched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
