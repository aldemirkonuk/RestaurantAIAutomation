#!/usr/bin/env python3
"""Plan §3: migrate cocktail rows out of master_wine_library into cocktails.

Same discipline as scripts/migrate_beverages.py: snapshot -> dry-run ->
apply -> invariant-check, soft-delete the source (never hard-delete --
wine_repair_log CASCADEs on delete), reuse the source id for traceability.
Selection predicate is beverage_kind='cocktail', set by plan §2.0's
classifier -- never a category-name string match done ad hoc here.
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
    SELECT id, name, price_reference, data_enrichment, source,
           data_enrichment->>'menu_category' AS menu_category
    FROM master_wine_library
    WHERE deleted_at IS NULL AND beverage_kind = 'cocktail'
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parent.parent
    conn = psycopg2.connect(get_dsn(root))
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(SELECT_SQL)
    rows = cur.fetchall()
    print(f"migration population: {len(rows):,} cocktail rows")

    if not args.apply:
        print("\nDRY RUN -- no writes. Sample:")
        for r in rows[:5]:
            print(f"  {r['name']!r} [{r['menu_category']!r}] ${r['price_reference']}")
        print(f"\nRe-run with --apply to write {len(rows):,} rows to cocktails "
              f"and soft-delete them from master_wine_library.")
        conn.rollback()
        return 0

    ids = [r["id"] for r in rows]
    inserted = 0
    for r in rows:
        cur.execute(
            """INSERT INTO cocktails (
                   id, name, menu_section, price, data_enrichment, source
               ) VALUES (%(id)s, %(name)s, %(menu_section)s, %(price)s,
                         %(data_enrichment)s, %(source)s)
               ON CONFLICT (id) DO NOTHING""",
            {
                "id": r["id"], "name": r["name"], "menu_section": r["menu_category"],
                "price": r["price_reference"],
                "data_enrichment": json.dumps(r["data_enrichment"])
                    if r["data_enrichment"] is not None else None,
                "source": r["source"],
            },
        )
        inserted += cur.rowcount

    print(f"inserted into cocktails: {inserted}")

    cur.execute(
        """UPDATE master_wine_library SET deleted_at = now()
           WHERE id = ANY(%s::uuid[]) AND deleted_at IS NULL""",
        (ids,),
    )
    soft_deleted = cur.rowcount
    print(f"soft-deleted from master_wine_library: {soft_deleted}")

    cur.execute("SELECT count(*) AS n FROM cocktails WHERE id = ANY(%s::uuid[])", (ids,))
    cocktails_count = cur.fetchone()["n"]
    cur.execute(
        """SELECT count(*) AS n FROM master_wine_library
           WHERE id = ANY(%s::uuid[]) AND deleted_at IS NULL""",
        (ids,),
    )
    still_live = cur.fetchone()["n"]

    ok = (inserted == len(rows) and soft_deleted == len(rows)
          and cocktails_count == len(rows) and still_live == 0)
    print(f"\ninvariants: inserted={inserted} soft_deleted={soft_deleted} "
          f"cocktails_count={cocktails_count} still_live={still_live} "
          f"-> {'OK' if ok else 'FAILED'}")

    if not ok:
        print("Rolling back.")
        conn.rollback()
        return 1

    conn.commit()
    print("Committed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
