#!/usr/bin/env python3
"""Turn the RECORDED price-index fixtures into identity + key rows (ADR 0124).

WHAT THIS IS FOR
----------------
`beverage_identities` starts empty and stays empty until somebody asserts a
bottle. Two of the sources this repo already carries state a product's producer,
name, size and pack on every row, and one of them also states a UPC — so those
rows can become identities by TRANSCRIPTION rather than by guess. That is the
only honest first fill available, and it is what this script produces.

  Iowa Liquor Products     upc (GTIN-12), item_no, im_desc, vendor_name,
                           bottle_volume_ml, pack
  Michigan LCC price book  LIQUOR CODE, ADA #, BRAND NAME, SIZE IN ML, PACK SIZE

DRY BY DEFAULT, AND NOT ARMED
-----------------------------
Running it prints the plan and writes nothing. `--emit-sql PATH` writes the
statements to a file so a person can read them before anything happens.
`--apply` is refused unless `--i-have-the-founders-word` is also given AND a
`--dsn` is supplied that is not the production project, following
`clean_vendor_catalogue_websites.py`. There is no default DSN on purpose: a
backfill that can find its own database is a backfill that can run by accident.

NOTHING HERE IS FETCHED
-----------------------
It reads the fixtures committed under
`apps/api-gateway/src/price-index/__fixtures__/`. No network call is made, and
the fixtures' own provenance (`MICHIGAN-PROVENANCE.md`, and the header note in
the Michigan file) travels into `assertion_note` on every row it produces.

WHY EVERY KEY IS ASSERTED SEPARATELY, AND WHY AMBIGUITY IS ALLOWED THROUGH
-------------------------------------------------------------------------
Measured on the full live Iowa file on 2026-09-05 (13,762 rows): `upc` is
present and check-digit-valid on 100% of rows, and 1,736 of the 9,118 distinct
values name more than one distinct `item_no`. This script therefore does NOT
deduplicate by UPC. It writes one identity per distinct (producer, name,
vintage, size, pack) and attaches the UPC to each of them, which is exactly the
state `joinByExactKey` refuses to resolve on its own. Collapsing them here
would be choosing, silently, which of three products a code means.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / "apps" / "api-gateway" / "src" / "price-index" / "__fixtures__"
IOWA_FIXTURE = FIXTURES / "iowa-liquor-products-2026-09-01.sample.ndjson"
MICHIGAN_FIXTURE = FIXTURES / "michigan-lcc-price-book-2025-08-03.sample.json"

PRODUCTION_PROJECT_MARKERS = ("exzueerziesmczwlhomd", "supabase.co")

MIN_SIZE_ML = 20
MAX_SIZE_ML = 30_000


# ---------------------------------------------------------------------------
# The same normalisation the gateway uses. Kept in lockstep by the self-test
# below, which asserts the exact strings apps/api-gateway/src/vendor-intel/
# beverage-identity.spec.ts asserts from the TypeScript side.
# ---------------------------------------------------------------------------

def normalize_identity_text(value: Optional[str]) -> str:
    if not value:
        return ""
    s = unicodedata.normalize("NFD", value)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def build_identity_key(producer: str, name: str, vintage: str,
                       size_ml: Optional[int], pack: Optional[int]) -> str:
    return "|".join([
        producer,
        name,
        vintage,
        "size?" if size_ml is None else str(size_ml),
        "pack?" if pack is None else str(pack),
    ])


def gtin_check_digit_valid(gtin14: str) -> bool:
    if not re.fullmatch(r"\d{14}", gtin14):
        return False
    digits = [int(c) for c in gtin14]
    total = sum(d * (3 if (12 - i) % 2 == 0 else 1) for i, d in enumerate(digits[:13]))
    return (10 - (total % 10)) % 10 == digits[13]


def normalise_gtin(raw: Optional[str]) -> Tuple[Optional[str], str]:
    s = (raw or "").strip()
    if not s:
        return None, "empty"
    if not s.isdigit():
        return None, "not_digits"
    if len(s) not in (8, 12, 13, 14):
        return None, "bad_length"
    g14 = s.zfill(14)
    if not gtin_check_digit_valid(g14):
        return None, "check_digit"
    return g14, "ok"


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------

class Plan:
    def __init__(self) -> None:
        # identity_key -> row
        self.identities: Dict[str, Dict[str, Any]] = {}
        # (namespace, value, identity_key) -> row
        self.keys: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
        self.refused: Counter = Counter()
        self.rows_read = 0

    def add_identity(self, *, producer_raw: str, name_raw: str, size_ml: Optional[int],
                     pack: Optional[int], display: str, note: str) -> Optional[str]:
        producer = normalize_identity_text(producer_raw)
        name = normalize_identity_text(name_raw)
        if not name:
            self.refused["no_name"] += 1
            return None
        if not producer:
            self.refused["no_producer"] += 1
            return None
        if size_ml is not None and not (MIN_SIZE_ML <= size_ml <= MAX_SIZE_ML):
            self.refused["size_out_of_range"] += 1
            return None
        if pack is not None and pack < 1:
            self.refused["pack_not_positive"] += 1
            return None
        # 'unstated', never 'nv': neither file says whether the bottle carries a
        # vintage, and "the source was silent" is not "the bottle has none".
        key = build_identity_key(producer, name, "unstated", size_ml, pack)
        self.identities.setdefault(key, {
            "identity_key": key,
            "producer_normalised": producer,
            "name_normalised": name,
            "vintage_text": "unstated",
            "size_ml": size_ml,
            "pack": pack,
            "display_label": display[:300],
            "assertion_method": "source_transcript",
            "assertion_note": note,
        })
        return key

    def add_key(self, identity_key: str, namespace: str, key_class: str,
                value: str, source_ref: str) -> None:
        self.keys.setdefault((namespace, value, identity_key), {
            "identity_key": identity_key,
            "key_namespace": namespace,
            "key_class": key_class,
            "key_value": value,
            "assertion_method": "source_transcript",
            "source_ref": source_ref,
        })


IOWA_NOTE = (
    "Transcribed from the recorded Iowa Liquor Products fixture "
    "(iowa-liquor-products-2026-09-01.sample.ndjson, report_as_of 2026-09-01, "
    "CC BY 4.0, Iowa Department of Revenue). No network fetch."
)
MICHIGAN_NOTE = (
    "Transcribed from the recorded Michigan LCC price book fixture "
    "(michigan-lcc-price-book-2025-08-03.sample.json, edition 2025-08-03; "
    "see MICHIGAN-PROVENANCE.md). Deliberately an OLD edition -- a shape "
    "fixture, never a current price. No network fetch."
)


def read_iowa(path: Path, plan: Plan) -> None:
    if not path.exists():
        plan.refused["iowa_fixture_missing"] += 1
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        plan.rows_read += 1
        volume = r.get("bottle_volume_ml")
        size_ml = int(volume) if isinstance(volume, (int, float)) and volume else None
        pack_raw = r.get("pack")
        pack = int(pack_raw) if isinstance(pack_raw, (int, float)) and pack_raw else None
        name = str(r.get("im_desc") or "").strip()
        producer = str(r.get("vendor_name") or "").strip()
        ident = plan.add_identity(
            producer_raw=producer, name_raw=name, size_ml=size_ml, pack=pack,
            display=f"{producer} {name}".strip(), note=IOWA_NOTE,
        )
        if ident is None:
            continue
        item_no = str(r.get("item_no") or "").strip()
        if item_no:
            plan.add_key(ident, "source:iowa-liquor-products", "source_local", item_no,
                         f"iowa-liquor-products#item={item_no}")
        g14, why = normalise_gtin(str(r.get("upc") or ""))
        if g14:
            plan.add_key(ident, "gtin", "global_standard", g14,
                         f"iowa-liquor-products#item={item_no}")
        else:
            plan.refused[f"upc_{why}"] += 1
        # `scc` is deliberately NOT transcribed. Measured on the live file
        # 2026-09-05: 10,201 rows carry one, across only 8 distinct values, and
        # 540 fail their own GS1 check digit. It is a placeholder column, and a
        # key that names 6,923 products is not a key.


def read_michigan(path: Path, plan: Plan) -> None:
    if not path.exists():
        plan.refused["michigan_fixture_missing"] += 1
        return
    doc = json.loads(path.read_text(encoding="utf-8"))
    rows = doc.get("rows") or []
    for row in rows:
        cells = [None if c is None else str(c).strip() for c in row]
        # The book's own two-line header: MI | ADA # | LIQUOR CODE | _ |
        # BRAND NAME | PROOF | SIZE IN ML | PACK SIZE | BASE PRICE |
        # LICENSEE PRICE | MINIMUM SHELF | NEW/CHNG
        if len(cells) < 8:
            continue
        ada, code, brand = cells[1], cells[2], cells[4]
        if not code or not code.isdigit():
            continue  # header and separator rows
        plan.rows_read += 1
        size_ml = int(cells[6]) if cells[6] and cells[6].replace(".", "").isdigit() else None
        pack = int(cells[7]) if cells[7] and cells[7].isdigit() else None
        # The book names a BRAND, not a producer. Using the brand for both is a
        # transcription of what the source states, and it is recorded as such.
        ident = plan.add_identity(
            producer_raw=brand or "", name_raw=brand or "", size_ml=size_ml, pack=pack,
            display=brand or "", note=MICHIGAN_NOTE,
        )
        if ident is None:
            continue
        plan.add_key(ident, "source:michigan-lcc-price-book", "source_local", code,
                     f"mlcc:price-book#liquor_code={code}")
        if ada and ada.isdigit():
            plan.add_key(ident, "source:michigan-lcc-ada", "source_local", ada,
                         f"mlcc:price-book#ada={ada}")


# ---------------------------------------------------------------------------
# Emission
# ---------------------------------------------------------------------------

def sql_literal(v: Any) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def emit_sql(plan: Plan) -> str:
    out: List[str] = [
        "-- Generated by scripts/backfill_identity_source_keys.py (ADR 0124).",
        "-- Every row is a TRANSCRIPTION of a recorded fixture. Nothing is fetched,",
        "-- nothing is deduplicated by GTIN, and no candidate is confirmed.",
        "BEGIN;",
    ]
    for row in plan.identities.values():
        out.append(
            "INSERT INTO public.beverage_identities "
            "(producer_normalised, name_normalised, vintage_text, size_ml, pack, "
            "display_label, assertion_method, assertion_note) VALUES ("
            + ", ".join([
                sql_literal(row["producer_normalised"]),
                sql_literal(row["name_normalised"]),
                sql_literal(row["vintage_text"]),
                sql_literal(row["size_ml"]),
                sql_literal(row["pack"]),
                sql_literal(row["display_label"]),
                sql_literal(row["assertion_method"]),
                sql_literal(row["assertion_note"]),
            ])
            + ") ON CONFLICT (identity_key) DO NOTHING;"
        )
    for row in plan.keys.values():
        out.append(
            "INSERT INTO public.beverage_identity_keys "
            "(identity_id, key_namespace, key_class, key_value, assertion_method, source_ref) "
            "SELECT id, "
            + ", ".join([
                sql_literal(row["key_namespace"]),
                sql_literal(row["key_class"]),
                sql_literal(row["key_value"]),
                sql_literal(row["assertion_method"]),
                sql_literal(row["source_ref"]),
            ])
            + " FROM public.beverage_identities WHERE identity_key = "
            + sql_literal(row["identity_key"])
            + " ON CONFLICT (key_namespace, key_value, identity_id) DO NOTHING;"
        )
    out.append("COMMIT;")
    return "\n".join(out) + "\n"


def self_test() -> int:
    """Assert the key format against the exact strings the TS spec asserts."""
    failures = 0
    cases = [
        (("probe producer", "probe wine", "2019", 750, 1),
         "probe producer|probe wine|2019|750|1"),
        (("krug", "grande cuvee", "nv", None, None),
         "krug|grande cuvee|nv|size?|pack?"),
    ]
    for args, expected in cases:
        got = build_identity_key(*args)
        if got != expected:
            print(f"FAIL build_identity_key{args} -> {got!r}, expected {expected!r}")
            failures += 1
    if normalize_identity_text("Château Margaux") != "chateau margaux":
        print("FAIL normalize_identity_text does not match normalizeIdentityText")
        failures += 1
    for upc, ok in [("00088004022723", True), ("00088004022724", False)]:
        if gtin_check_digit_valid(upc) is not ok:
            print(f"FAIL gtin_check_digit_valid({upc}) != {ok}")
            failures += 1
    print("self-test:", "PASS" if failures == 0 else f"{failures} FAILURE(S)")
    return 0 if failures == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--emit-sql", metavar="PATH", help="write the statements to a file")
    ap.add_argument("--apply", action="store_true", help="write to a database")
    ap.add_argument("--i-have-the-founders-word", action="store_true",
                    help="required with --apply")
    ap.add_argument("--dsn", help="required with --apply; never defaulted")
    ap.add_argument("--self-test", action="store_true", help="check the key format only")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    plan = Plan()
    read_iowa(IOWA_FIXTURE, plan)
    read_michigan(MICHIGAN_FIXTURE, plan)

    print(f"fixture rows read      {plan.rows_read}")
    print(f"identities proposed    {len(plan.identities)}")
    print(f"keys proposed          {len(plan.keys)}")
    by_ns = Counter(k[0] for k in plan.keys)
    for ns, n in sorted(by_ns.items()):
        print(f"  {ns:38} {n}")
    if plan.refused:
        print("refused:")
        for reason, n in sorted(plan.refused.items()):
            print(f"  {reason:38} {n}")
    ambiguous = Counter()
    for ns, value, _ in plan.keys:
        if ns == "gtin":
            ambiguous[value] += 1
    multi = {v: n for v, n in ambiguous.items() if n > 1}
    print(f"GTINs naming more than one identity in this plan: {len(multi)}"
          " (left ambiguous on purpose -- joinByExactKey refuses them)")

    if args.emit_sql:
        Path(args.emit_sql).write_text(emit_sql(plan), encoding="utf-8")
        print(f"SQL written to {args.emit_sql} -- read it before anything runs it.")

    if args.apply:
        if not args.i_have_the_founders_word:
            print("\nREFUSED: --apply needs --i-have-the-founders-word.", file=sys.stderr)
            return 2
        if not args.dsn:
            print("\nREFUSED: --apply needs an explicit --dsn. There is no default,"
                  " because a backfill that can find its own database can run by"
                  " accident.", file=sys.stderr)
            return 2
        if any(m in args.dsn for m in PRODUCTION_PROJECT_MARKERS):
            print("\nREFUSED: that DSN points at the production project. This script"
                  " does not write there.", file=sys.stderr)
            return 2
        print("\nREFUSED: no writer is implemented. Use --emit-sql and apply the file"
              " deliberately, so the statements are read by a person first.",
              file=sys.stderr)
        return 2

    print("\nDry run. Nothing was written and nothing was fetched.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
