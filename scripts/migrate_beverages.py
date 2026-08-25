#!/usr/bin/env python3
"""Plan §2.1: migrate non-wine, non-cocktail rows out of master_wine_library
into beverages.

Snapshot -> dry-run -> apply -> invariant-check, the same discipline the
wine merges used. Selection predicate is `beverage_kind NOT IN ('wine',
'cocktail')` -- never `is_wine`, which is exactly the mistake plan §2.0 (A4)
fixed. Cocktails are excluded here on purpose; they get their own tables
(plan §3), not beverages.

Non-destructive by construction (arch §3.7, C9): source rows are
SOFT-deleted (deleted_at = now()), never hard-deleted. wine_repair_log has
an ON DELETE CASCADE to master_wine_library, so a hard delete would have
silently destroyed the audit trail for every prior repair on these rows --
found by checking the actual constraint before writing this, not assumed.
The new beverages row REUSES the same id as its source master_wine_library
row, so any historical reference by that UUID still resolves to something,
even though nothing today references these rows by FK (checked fresh
immediately before this script was written: only wine_repair_log does, and
that survives via the soft delete).

wine_structure/sensory_profile/quality_classification are NOT copied into
beverages.body/acidity/etc -- checked first: 0 of the 608 migrating rows
carry real sensory content (all {} or enrichment-boilerplate placeholders).
Those columns exist on beverages, ready for when a beverage-specific
enrichment pass populates them; nothing here fabricates data that isn't
there.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import psycopg2
import psycopg2.extras


def get_dsn(root: pathlib.Path) -> str:
    return next(
        line.split("=", 1)[1].strip()
        for line in (root / ".env").read_text().splitlines()
        if line.startswith("SUPABASE_DB_URL=")
    )


SELECT_SQL = """
    SELECT id, name, producer, country, region, price_reference,
           barcode, sku, upc, ean, library_tier, review_status,
           field_confidences, data_enrichment, embedding,
           data_enrichment->>'menu_category' AS menu_category
    FROM master_wine_library
    WHERE deleted_at IS NULL
      AND beverage_kind NOT IN ('wine', 'cocktail')
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                         help="Actually write. Without this, dry-run only.")
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parent.parent
    conn = psycopg2.connect(get_dsn(root))
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(SELECT_SQL)
    rows = cur.fetchall()
    print(f"migration population: {len(rows):,} rows "
          f"(beverage_kind NOT IN ('wine','cocktail'), live)")

    cur.execute("""SELECT beverage_kind, count(*) AS n FROM master_wine_library
                   WHERE deleted_at IS NULL AND beverage_kind NOT IN ('wine','cocktail')
                   GROUP BY 1 ORDER BY 2 DESC""")
    by_kind = {row["beverage_kind"]: row["n"] for row in cur.fetchall()}
    print(f"  by beverage_kind: {by_kind}")

    if not args.apply:
        print("\nDRY RUN -- no writes. Sample of what would migrate:")
        for r in rows[:5]:
            print(f"  {r['producer']!r} / {r['name']!r} "
                  f"[menu_category={r['menu_category']!r}]")
        print(f"\nRe-run with --apply to write {len(rows):,} rows to "
              f"beverages and soft-delete them from master_wine_library.")
        conn.rollback()
        return 0

    ids = [r["id"] for r in rows]
    inserted = 0
    for r in rows:
        cur.execute(
            """INSERT INTO beverages (
                   id, beverage_type, name, producer, country, region,
                   price_reference, barcode, sku, upc, ean,
                   library_tier, review_status, field_confidences,
                   data_enrichment, embedding
               ) VALUES (
                   %(id)s, public.beverage_classify_type(%(menu_category)s),
                   %(name)s, %(producer)s, %(country)s, %(region)s,
                   %(price_reference)s, %(barcode)s, %(sku)s, %(upc)s, %(ean)s,
                   %(library_tier)s, %(review_status)s, %(field_confidences)s,
                   %(data_enrichment)s, %(embedding)s
               )
               ON CONFLICT (id) DO NOTHING""",
            {
                "id": r["id"], "menu_category": r["menu_category"],
                "name": r["name"], "producer": r["producer"],
                "country": r["country"], "region": r["region"],
                "price_reference": r["price_reference"],
                "barcode": r["barcode"], "sku": r["sku"],
                "upc": r["upc"], "ean": r["ean"],
                "library_tier": r["library_tier"],
                "review_status": r["review_status"],
                "field_confidences": json.dumps(r["field_confidences"])
                    if r["field_confidences"] is not None else None,
                "data_enrichment": json.dumps(r["data_enrichment"])
                    if r["data_enrichment"] is not None else None,
                "embedding": r["embedding"],
            },
        )
        inserted += cur.rowcount

    print(f"inserted into beverages: {inserted}")

    # Soft-delete the source rows -- never hard delete (wine_repair_log
    # cascades on delete; checked before this script was written).
    cur.execute(
        """UPDATE master_wine_library
              SET deleted_at = now()
            WHERE id = ANY(%s::uuid[]) AND deleted_at IS NULL""",
        (ids,),
    )
    soft_deleted = cur.rowcount
    print(f"soft-deleted from master_wine_library: {soft_deleted}")

    # Invariant checks, inside the same transaction -- roll back rather than
    # commit a partial or inconsistent migration.
    cur.execute("SELECT count(*) AS n FROM beverages WHERE id = ANY(%s::uuid[])", (ids,))
    beverages_count = cur.fetchone()["n"]
    cur.execute(
        """SELECT count(*) AS n FROM master_wine_library
           WHERE id = ANY(%s::uuid[]) AND deleted_at IS NULL""",
        (ids,),
    )
    still_live_in_wine = cur.fetchone()["n"]

    ok = (
        inserted == len(rows)
        and soft_deleted == len(rows)
        and beverages_count == len(rows)
        and still_live_in_wine == 0
    )
    print(f"\ninvariants: inserted={inserted} soft_deleted={soft_deleted} "
          f"beverages_count={beverages_count} still_live_in_wine={still_live_in_wine} "
          f"-> {'OK' if ok else 'FAILED'}")

    if not ok:
        print("Rolling back -- invariant check failed.")
        conn.rollback()
        return 1

    conn.commit()
    print("Committed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
