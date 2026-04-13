#!/usr/bin/env python3
"""
Import local JSONL wine library into Supabase master_wine_library.

Only inserts these columns (others NULL):
  - wine_id
  - sequential_id
  - name
  - producer
  - vintage
  - price_reference
  - primary_type
  - grape_variety
  - country
  - region
  - appellation
  - sub_region
  - wine_structure
  - sensory_profile
  - quality_classification
  - source
  - data_enrichment

Usage:
  python3 services/database/import_master_wine_library.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError as exc:
    raise SystemExit(
        "psycopg2 is required. Install with:\n"
        "  pip install psycopg2-binary"
    ) from exc


ROOT = Path(__file__).resolve().parents[2]
JSONL_PATH = ROOT / "library" / "wineops_basic_v1.jsonl"


def _get_db_url() -> str:
    url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if not url:
        raise SystemExit(
            "DATABASE_URL or SUPABASE_DB_URL is required in your environment."
        )
    return url


def _iter_rows(path: Path) -> Iterable[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def _map_row(raw: Dict[str, Any]) -> Tuple[Any, ...]:
    classification = raw.get("classification") or {}
    source = raw.get("source") or {}
    quality_signals = raw.get("quality_signals") or {}

    # Length checks for varchar columns (log only)
    varchar_limits = {
        "wine_id": 20,
        "name": 255,
        "producer": 255,
        "primary_type": 50,
        "country": 100,
        "region": 100,
        "appellation": 150,
        "sub_region": 100,
        "source": 100,
    }
    varchar_values = {
        "wine_id": raw.get("WINE_ID"),
        "name": raw.get("name"),
        "producer": raw.get("producer"),
        "primary_type": classification.get("primary_type"),
        "country": classification.get("country"),
        "region": classification.get("region"),
        "appellation": classification.get("appellation"),
        "sub_region": classification.get("sub_region"),
        "source": "wineops_basic_v1",
    }

    def _truncate(value: Any, limit: int, field: str) -> Any:
        if isinstance(value, str) and len(value) > limit:
            return value[:limit]
        return value
    for field, limit in varchar_limits.items():
        value = varchar_values.get(field)
        if isinstance(value, str) and len(value) > limit:
            pass

    return (
        _truncate(raw.get("WINE_ID"), varchar_limits["wine_id"], "wine_id"),
        source.get("line"),  # sequential_id
        _truncate(raw.get("name"), varchar_limits["name"], "name"),
        _truncate(raw.get("producer"), varchar_limits["producer"], "producer"),
        raw.get("vintage"),
        raw.get("price"),
        _truncate(classification.get("primary_type"), varchar_limits["primary_type"], "primary_type"),
        _truncate(classification.get("grape_variety"), 65535, "grape_variety"),
        _truncate(classification.get("country"), varchar_limits["country"], "country"),
        _truncate(classification.get("region"), varchar_limits["region"], "region"),
        _truncate(classification.get("appellation"), varchar_limits["appellation"], "appellation"),
        _truncate(classification.get("sub_region"), varchar_limits["sub_region"], "sub_region"),
        json.dumps(raw.get("wine_structure")) if raw.get("wine_structure") is not None else None,
        json.dumps(raw.get("sensory_profile")) if raw.get("sensory_profile") is not None else None,
        json.dumps(quality_signals) if quality_signals else None,
        "wineops_basic_v1",
        json.dumps({"schema_version": raw.get("schema_version"), "built_at": raw.get("built_at")}),
    )


def main() -> None:
    if not JSONL_PATH.exists():
        raise SystemExit(f"JSONL not found: {JSONL_PATH}")

    rows: List[Tuple[Any, ...]] = []
    for raw in _iter_rows(JSONL_PATH):
        rows.append(_map_row(raw))

    if not rows:
        print("No rows found in JSONL.")
        return

    db_url = _get_db_url()
    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            sql = """
                INSERT INTO public.master_wine_library (
                    wine_id,
                    sequential_id,
                    name,
                    producer,
                    vintage,
                    price_reference,
                    primary_type,
                    grape_variety,
                    country,
                    region,
                    appellation,
                    sub_region,
                    wine_structure,
                    sensory_profile,
                    quality_classification,
                    source,
                    data_enrichment
                )
                VALUES %s
                ON CONFLICT (wine_id) DO UPDATE SET
                    sequential_id = EXCLUDED.sequential_id,
                    name = EXCLUDED.name,
                    producer = EXCLUDED.producer,
                    vintage = EXCLUDED.vintage,
                    price_reference = EXCLUDED.price_reference,
                    primary_type = EXCLUDED.primary_type,
                    grape_variety = EXCLUDED.grape_variety,
                    country = EXCLUDED.country,
                    region = EXCLUDED.region,
                    appellation = EXCLUDED.appellation,
                    sub_region = EXCLUDED.sub_region,
                    wine_structure = EXCLUDED.wine_structure,
                    sensory_profile = EXCLUDED.sensory_profile,
                    quality_classification = EXCLUDED.quality_classification,
                    source = EXCLUDED.source,
                    data_enrichment = EXCLUDED.data_enrichment
            """
            execute_values(cur, sql, rows, page_size=200)
        conn.commit()
        print(f"Imported {len(rows)} rows into master_wine_library.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
