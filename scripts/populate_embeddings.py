#!/usr/bin/env python3
"""A13: populate master_wine_library.embedding and beverages.embedding.

Both columns have carried a live pgvector index (idx_master_wine_library_
embedding) over ZERO populated rows -- no semantic search, no cold-start
similarity, and the config for it already exists
(EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2,
EMBEDDING_DIMENSION=384 in .env) but nothing had ever called it. The model
was already an installed dependency (services/agent-orchestrator/
requirements.txt) with a stub in wine_matcher.py explicitly noting
"embedding generation requires a sentence-transformer model" and never
wiring one up. This is that wiring, local inference, no API cost.

Embedding input is display_name + region + country + the sensory
descriptors (arch §10.4: "natural embedding input is display name +
sensory profile + region") -- built AFTER plan §1 (display_name) so it
carries the full descriptive string, not the bare cuvee name.
"""
from __future__ import annotations

import argparse
import pathlib
import sys
import time

import psycopg2
import psycopg2.extras


def get_dsn(root: pathlib.Path) -> str:
    return next(
        line.split("=", 1)[1].strip()
        for line in (root / ".env").read_text().splitlines()
        if line.startswith("SUPABASE_DB_URL=")
    )


def _clean(value) -> str:
    """'Unknown' is this schema's sentinel for not-populated (arch §9.0) --
    treated as absent here too, or it becomes a literal noise token in every
    embedding for a row missing that field."""
    v = (value or "").strip()
    return "" if v.lower() == "unknown" else v


def wine_embed_text(row: dict) -> str:
    parts = [row.get("display_name") or row.get("name") or "", _clean(row.get("region")),
             _clean(row.get("country")), row.get("grape_variety") or ""]
    for label, value in (("acidity", row.get("acidity")), ("tannins", row.get("tannins")),
                          ("texture", row.get("texture")), ("finish", row.get("finish"))):
        if value:
            parts.append(f"{label} {value}")
    for key in ("primary_aromas", "secondary_aromas"):
        arr = row.get(key)
        if isinstance(arr, list) and arr:
            parts.append(" ".join(str(x) for x in arr))
    return " ".join(p for p in parts if p).strip()


def beverage_embed_text(row: dict) -> str:
    parts = [row.get("display_name") or row.get("name") or "", row.get("producer") or "",
             row.get("beverage_type") or "", _clean(row.get("region")), _clean(row.get("country"))]
    return " ".join(p for p in parts if p).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parent.parent
    conn = psycopg2.connect(get_dsn(root))
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute(
        """SELECT id, name, display_name, region, country, grape_variety,
                  acidity, tannins, texture, finish, primary_aromas, secondary_aromas
           FROM master_wine_library WHERE deleted_at IS NULL AND embedding IS NULL"""
    )
    wine_rows = cur.fetchall()
    cur.execute(
        """SELECT id, name, display_name, producer, beverage_type, region, country
           FROM beverages WHERE deleted_at IS NULL AND embedding IS NULL"""
    )
    beverage_rows = cur.fetchall()

    print(f"wines needing embedding: {len(wine_rows):,}")
    print(f"beverages needing embedding: {len(beverage_rows):,}")

    if not args.apply:
        if wine_rows:
            print(f"\nsample wine embed text: {wine_embed_text(wine_rows[0])!r}")
        if beverage_rows:
            print(f"sample beverage embed text: {beverage_embed_text(beverage_rows[0])!r}")
        print("\nDRY RUN -- no writes. Re-run with --apply.")
        return 0

    from sentence_transformers import SentenceTransformer

    t0 = time.time()
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    print(f"model loaded in {time.time()-t0:.1f}s")

    def embed_and_write(table: str, rows: list[dict], text_fn) -> int:
        written = 0
        for i in range(0, len(rows), args.batch_size):
            chunk = rows[i:i + args.batch_size]
            texts = [text_fn(r) for r in chunk]
            vecs = model.encode(texts, show_progress_bar=False)
            for row, vec in zip(chunk, vecs):
                cur.execute(
                    f"UPDATE {table} SET embedding = %s WHERE id = %s",
                    (vec.tolist(), row["id"]),
                )
                written += cur.rowcount
            print(f"  {table}: {min(i + args.batch_size, len(rows))}/{len(rows)}")
        return written

    t0 = time.time()
    wine_written = embed_and_write("master_wine_library", wine_rows, wine_embed_text)
    beverage_written = embed_and_write("beverages", beverage_rows, beverage_embed_text)
    print(f"\nembedded and wrote {wine_written} wine rows, {beverage_written} beverage rows "
          f"in {time.time()-t0:.1f}s")

    cur.execute("SELECT count(*) AS n FROM master_wine_library WHERE deleted_at IS NULL AND embedding IS NOT NULL")
    wine_total = cur.fetchone()["n"]
    cur.execute("SELECT count(*) AS n FROM beverages WHERE deleted_at IS NULL AND embedding IS NOT NULL")
    bev_total = cur.fetchone()["n"]
    print(f"total now embedded: wines={wine_total}, beverages={bev_total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
