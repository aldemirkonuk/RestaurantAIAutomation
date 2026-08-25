#!/usr/bin/env python3
"""
Stage 3 of the library backfill: load enriched wines into master_wine_library.

    python3 scripts/load_enriched_wines.py --in /tmp/enriched          # dry run
    python3 scripts/load_enriched_wines.py --in /tmp/enriched --apply

Matching first, always. Every wine goes through match_library_wines_batch
before anything is written, so a wine already in the library is UPDATED with
the attributes it was missing rather than inserted a second time. Loading 4,800
wines without that step would undo the deduplication work outright.

WHAT GETS WRITTEN, AND WHAT DOES NOT
------------------------------------
Identity fields (name, producer, vintage) are never overwritten on an existing
row. They are what the row is keyed on, and rewriting them from a different
restaurant's menu would silently move the row out from under everything that
references it.

Attribute fields are filled only where the existing row is NULL. A curated
value must beat a model-inferred one, and "enrichment" that overwrites better
data with worse is not enrichment.

PROVENANCE IS RECORDED, NOT ASSUMED
-----------------------------------
Model knowledge is not a source. Each row records how its attributes were
arrived at, so a consumer can tell a recalled fact from a reasoned default:

  knowledge=known     library_tier 2, review_status 'pending',  confidence 0.80
  knowledge=inferred  library_tier 3, review_status 'pending',  confidence 0.50
  knowledge=unknown   library_tier 3, review_status 'needs_review'

`inferred` rows are precisely the population the web-research agent should
verify, and research_eligible_submissions already selects tier-3 rows.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import unicodedata

import psycopg2
import psycopg2.extras

ROOT = pathlib.Path(__file__).resolve().parent.parent

CONFIDENCE = {"known": 0.80, "inferred": 0.50, "unknown": 0.0}
TIER = {"known": 2, "inferred": 3, "unknown": 3}
REVIEW = {"known": "pending", "inferred": "pending", "unknown": "needs_review"}

# Mirrors WineSubmissionsService.DIACRITICS / wine_normalize_text.
DIACRITICS = re.compile(
    "[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\ufe20-\ufe2f"
    "\\^`\u00a8\u00af\u00b4\u00b7\u00b8\u02b0-\u02ff"
    "\u0374\u0375\u037a\u0384\u0385]"
)
ABBREV = [
    (re.compile(r"\baz\.\s*agr\.\s*"), "azienda agricola "),
    (re.compile(r"\bdom\.\s*"), "domaine "),
    (re.compile(r"\bch\.\s*"), "chateau "),
    (re.compile(r"\bcht\.\s*"), "chateau "),
    (re.compile(r"\bbod\.\s*"), "bodegas "),
    (re.compile(r"\bwgt\.\s*"), "weingut "),
    (re.compile(r"\bten\.\s*"), "tenuta "),
    (re.compile(r"\bfatt\.\s*"), "fattoria "),
    (re.compile(r"\bcant\.\s*"), "cantina "),
    (re.compile(r"\bmarch\.\s*"), "marchesi "),
    (re.compile(r"\bste\.\s*"), "sainte "),
    (re.compile(r"\bst\.\s*"), "saint "),
    (re.compile(r"\bmt\.\s*"), "monte "),
]


def normalize(value) -> str:
    if not value:
        return ""
    s = DIACRITICS.sub("", unicodedata.normalize("NFD", str(value))).lower()
    for pat, rep in ABBREV:
        s = pat.sub(rep, s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def signature(producer, name, vintage, country, region, grape) -> str:
    key = "|".join([
        normalize(producer), normalize(name),
        str(vintage) if vintage is not None else "NV",
        normalize(country), normalize(region), normalize(grape),
    ])
    return hashlib.sha256(key.encode()).hexdigest()


def to_int(v):
    m = re.search(r"(19|20)\d{2}", str(v or ""))
    return int(m.group(0)) if m else None


def to_num(v):
    try:
        f = float(v)
        return f if f == f and abs(f) < 1e6 else None
    except Exception:
        return None


def load_env() -> dict:
    env = dict(os.environ)
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return env


def blocks(e: dict) -> tuple[dict, dict, dict]:
    """Split the flat enrichment into the library's three JSONB blocks."""
    structure = {k: e.get(k) for k in
                 ("body", "sweetness", "acidity", "tannins", "texture",
                  "finish", "alcohol_level")}
    structure["alcohol_pct"] = to_num(e.get("alcohol_pct"))
    sensory = {k: e.get(k) or [] for k in
               ("primary_aromas", "secondary_aromas", "tertiary_aromas",
                "flavor_profile")}
    sensory["aroma_complexity"] = e.get("aroma_complexity")
    sensory["flavor_intensity"] = e.get("flavor_intensity")
    quality = {
        "appellation_class": e.get("appellation_class"),
        "quality_level": e.get("quality_level"),
        "producer_tier": e.get("producer_tier"),
        "reserve_status": bool(e.get("reserve_status")),
        "vintage_quality": e.get("vintage_quality") or "Unknown",
        "awards_ratings": [],
    }
    return (
        {k: v for k, v in structure.items() if v is not None},
        {k: v for k, v in sensory.items() if v is not None},
        {k: v for k, v in quality.items() if v is not None},
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="/tmp/enriched")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--batch", type=int, default=200)
    args = ap.parse_args()

    env = load_env()
    conn = psycopg2.connect(env["SUPABASE_DB_URL"])
    conn.autocommit = False
    cur = conn.cursor()

    docs = json.loads((pathlib.Path(args.inp) / "enriched.json").read_text())
    print(f"{'APPLY' if args.apply else 'DRY RUN'}: {len(docs)} enriched wine(s)\n")

    cur.execute("SELECT count(*) FROM master_wine_library")
    before = cur.fetchone()[0]

    stats = {"matched_updated": 0, "matched_skipped": 0, "inserted": 0,
             "no_enrichment": 0, "dup_in_batch": 0}
    seen_signatures: set[str] = set()

    for start in range(0, len(docs), args.batch):
        chunk = docs[start:start + args.batch]
        probe = [{
            "name": d["extracted"].get("name"),
            "producer": d["extracted"].get("producer"),
            "vintage": str(d["extracted"].get("vintage") or ""),
            "region": d["extracted"].get("region"),
            "grape_variety": d["extracted"].get("grape_variety"),
        } for d in chunk]

        cur.execute(
            "SELECT input_index, id, confidence FROM match_library_wines_batch(%s::jsonb)",
            (json.dumps(probe),),
        )
        matches = {i: (mid, conf) for i, mid, conf in cur.fetchall() if mid}

        for j, d in enumerate(chunk):
            x, e = d["extracted"], d.get("enrichment")
            if not e or not e.get("knowledge"):
                stats["no_enrichment"] += 1
                continue

            knowledge = e["knowledge"]
            structure, sensory, quality = blocks(e)
            conf = CONFIDENCE[knowledge]
            confidences = {
                f: conf for f in
                ("primary_type", "grape_variety", "country", "region",
                 "appellation", "wine_structure", "sensory_profile",
                 "quality_classification")
            }
            enrich_meta = {
                "source": "menu_corpus_llm",
                "knowledge": knowledge,
                "model": "claude-haiku-4-5",
                "menus": x.get("menus", []),
                # The corpus is beverage lists, not wine lists: 374 of 2,400
                # items are amari, beers and spirits, which the model correctly
                # declines to give a primary_type. They belong in the library —
                # restaurants stock and sell them, and it already holds
                # Hendrick's and Monkey Shoulder — but they must stay
                # separable, so the menu's own category is kept verbatim.
                "menu_category": x.get("category"),
                "is_wine": bool(e.get("primary_type")),
            }

            mid, mconf = matches.get(j, (None, None))
            if mid:
                # Fill only what is missing. COALESCE keeps any curated value
                # already present — overwriting better data with an inference
                # is not enrichment.
                if args.apply:
                    cur.execute(
                        """UPDATE master_wine_library SET
                             -- coalesce, not CASE. A CASE that unconditionally
                             -- assigned the new value blanked this column
                             -- whenever the enrichment was 'unknown' (NULL),
                             -- and the column is NOT NULL. Keep any real
                             -- existing value; take the new one only if there
                             -- is one; otherwise stand pat.
                             -- (Do not write a placeholder token in a SQL
                             -- comment here: psycopg2 counts it as a real
                             -- parameter and the whole statement shifts.)
                             primary_type  = coalesce(nullif(primary_type,'unknown'),
                                                      %s, primary_type),
                             grape_variety = coalesce(grape_variety, %s),
                             country       = coalesce(nullif(country,'Unknown'),
                                                      %s, country),
                             region        = coalesce(region, %s),
                             sub_region    = coalesce(sub_region, %s),
                             appellation   = coalesce(appellation, %s),
                             wine_structure        = coalesce(wine_structure, %s::jsonb),
                             sensory_profile       = coalesce(sensory_profile, %s::jsonb),
                             quality_classification= coalesce(quality_classification, %s::jsonb),
                             serving_temp_celsius  = coalesce(serving_temp_celsius, %s),
                             glass_type            = coalesce(glass_type, %s),
                             decanting_recommended = coalesce(decanting_recommended, %s),
                             aging_potential_years = coalesce(aging_potential_years, %s),
                             farming               = coalesce(farming, %s),
                             aging_vessel          = coalesce(aging_vessel, %s),
                             field_confidences     = coalesce(field_confidences,'{}'::jsonb) || %s::jsonb,
                             data_enrichment       = coalesce(data_enrichment,'{}'::jsonb) || %s::jsonb,
                             updated_at = now()
                           WHERE id = %s""",
                        (e.get("primary_type"), e.get("grape_variety"),
                         e.get("country"), e.get("region"), e.get("sub_region"),
                         e.get("appellation"),
                         json.dumps(structure), json.dumps(sensory), json.dumps(quality),
                         to_num(e.get("serving_temp_celsius")), e.get("glass_type"),
                         e.get("decanting_recommended") if isinstance(e.get("decanting_recommended"), bool) else None,
                         to_num(e.get("aging_potential_years")),
                         e.get("farming"), e.get("aging_vessel"),
                         json.dumps(confidences), json.dumps(enrich_meta), mid),
                    )
                stats["matched_updated"] += 1
                continue

            vintage = to_int(x.get("vintage"))
            sig = signature(x.get("producer"), x.get("name"), vintage,
                            e.get("country"), e.get("region"), e.get("grape_variety"))
            if sig in seen_signatures:
                stats["dup_in_batch"] += 1
                continue
            seen_signatures.add(sig)

            if args.apply:
                cur.execute(
                    """INSERT INTO master_wine_library
                         (wine_id, name, producer, vintage, primary_type,
                          grape_variety, country, region, sub_region, appellation,
                          price_reference, bottle_size_ml,
                          wine_structure, sensory_profile, quality_classification,
                          serving_temp_celsius, glass_type, decanting_recommended,
                          aging_potential_years, farming, aging_vessel,
                          library_tier, review_status, source, signature_source,
                          signature_hash, normalized_name, normalized_producer,
                          field_confidences, data_enrichment)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,750,
                               %s::jsonb,%s::jsonb,%s::jsonb,
                               %s,%s,%s,%s,%s,%s,
                               %s,%s,'menu_corpus','menu_corpus',
                               %s, wine_normalize_text(%s), wine_normalize_text(%s),
                               %s::jsonb,%s::jsonb)
                       ON CONFLICT (signature_hash) DO NOTHING""",
                    (f"MC_{sig[:14]}", x.get("name"),
                     x.get("producer") or x.get("name"), vintage,
                     e.get("primary_type") or "unknown", e.get("grape_variety"),
                     e.get("country") or "Unknown", e.get("region"),
                     e.get("sub_region"), e.get("appellation"),
                     to_num(x.get("bottle_price")),
                     json.dumps(structure), json.dumps(sensory), json.dumps(quality),
                     to_num(e.get("serving_temp_celsius")), e.get("glass_type"),
                     e.get("decanting_recommended") if isinstance(e.get("decanting_recommended"), bool) else None,
                     to_num(e.get("aging_potential_years")),
                     e.get("farming"), e.get("aging_vessel"),
                     TIER[knowledge], REVIEW[knowledge],
                     # Normalize the SAME value the producer column receives.
                     # Passing the raw producer here while the column takes
                     # `producer or name` desynced them: 28 rows landed with a
                     # populated producer and an EMPTY normalized_producer, and
                     # the matcher scores an empty-vs-present producer as 0.0,
                     # so those wines could not match even themselves.
                     sig, x.get("name"), x.get("producer") or x.get("name"),
                     json.dumps(confidences), json.dumps(enrich_meta)),
                )
            stats["inserted"] += 1

        if args.apply:
            conn.commit()
        print(f"  {min(start + args.batch, len(docs))}/{len(docs)}"
              f"  matched={stats['matched_updated']} new={stats['inserted']}", flush=True)

    if not args.apply:
        conn.rollback()

    cur.execute("SELECT count(*) FROM master_wine_library")
    after = cur.fetchone()[0]
    conn.rollback()

    print(f"\nlibrary rows: {before} -> {after}" if args.apply
          else f"\nlibrary rows: {before} (unchanged — dry run)")
    for k, v in stats.items():
        print(f"  {k:<18} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
