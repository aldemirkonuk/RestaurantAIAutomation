#!/usr/bin/env python3
"""Parity check: SQL beverage_identity_key() vs Python residual_key().

The migration comment on beverage_identity_key() (20260817070000) commits to
keeping the two implementations in lockstep -- eval_merge_policies.py's
0-false-merge measurement across 732,874 pairs only transfers to the SQL
function if it computes the SAME key. This is the check that proves it,
byte-for-byte, on every entry in the merge-eval corpus, and it is how a real
divergence was caught before shipping: an early draft reused
wine_normalize_text (which expands trade abbreviations -- "St." -> "saint",
"Mt." -> "monte", correct for WINE matching) and it silently diverged from
the validated Python norm() on 67 of 4,822 entries.

Requires a live DB connection (SUPABASE_DB_URL in .env) -- not wired into
GitHub Actions CI, same as the other DB-dependent checks in this directory.
Run after any change to beverage_identity_key(), beverage_tokenize(),
beverage_normalize_text(), or scripts/eval_merge_policies.py's residual_key().
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import psycopg2


def load_eval_module(root: pathlib.Path):
    spec = importlib.util.spec_from_file_location(
        "eval_merge_policies", root / "scripts/eval_merge_policies.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def python_key_as_string(ev, entry: dict) -> str:
    brand, residual, _vintage = ev.residual_key(entry)
    residual_tokens = []
    for word, count in sorted(residual):
        residual_tokens.extend([word] * count)
    return " ".join(brand) + "||" + " ".join(residual_tokens)


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent
    ev = load_eval_module(root)

    entries = json.loads((root / "datasets/merge_eval/entries.json").read_text())
    dsn = next(
        line.split("=", 1)[1].strip()
        for line in (root / ".env").read_text().splitlines()
        if line.startswith("SUPABASE_DB_URL=")
    )
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("set statement_timeout='240s'")

    values_sql = ",".join(
        cur.mogrify("(%s,%s,%s)", (i, e["producer"], e["name"])).decode()
        for i, e in enumerate(entries)
    )
    cur.execute(
        f"""SELECT v.idx, public.beverage_identity_key(v.producer, v.name)
            FROM (VALUES {values_sql}) AS v(idx, producer, name)
            ORDER BY v.idx"""
    )
    sql_keys = dict(cur.fetchall())

    mismatches = []
    for i, entry in enumerate(entries):
        py_key = python_key_as_string(ev, entry)
        sql_key = sql_keys.get(i)
        if py_key != sql_key:
            mismatches.append((entry["producer"], entry["name"], py_key, sql_key))

    print(f"checked {len(entries):,} entries")
    if mismatches:
        print(f"\nFAILED: {len(mismatches)} divergences between SQL and Python:")
        for producer, name, py_key, sql_key in mismatches[:20]:
            print(f"  producer={producer!r} name={name!r}")
            print(f"    python: {py_key!r}")
            print(f"    sql   : {sql_key!r}")
        return 1

    print("PASSED: SQL beverage_identity_key() is byte-identical to Python "
          "residual_key() on every entry.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
