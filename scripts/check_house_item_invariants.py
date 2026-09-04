#!/usr/bin/env python3
"""The house item is the ledger's key -- the invariants that keep it true.

ADR 0115 / OD-113. The founder decided on 2026-09-03 that one house item id
carries stock, par, counts and orders for every beverage, and that a wine's
library link is an attribute rather than the key. Migration
`20260903171000_the_house_item_is_the_ledgers_key.sql` is phase 1 of that.

WHY THIS FILE EXISTS AT ALL
---------------------------
Because the database will not hold these invariants for us. Measured against
production on 2026-09-03 with `pg_constraint`, the four hottest ledger tables
reference `restaurant_inventory` by CONVENTION, with no foreign key:

    inventory_transactions.inventory_id   NOT NULL, no FK
    inventory_transactions.wine_id        NOT NULL, no FK
    pour_events.inventory_id              NOT NULL, no FK
    inventory_lots.master_wine_id         NOT NULL, no FK
    inventory_alert_state.inventory_id    NOT NULL, no FK
    inventory_lot_revaluations.inventory_id  NOT NULL, no FK

So any cut-over plan drawn from foreign keys reports the ledger as untouched,
and any tool that trusts referential integrity here is reading a promise nobody
made. This script is the enforcement. It is not a nicety around the migration;
it is the half of the migration the database cannot express.

NOT WIRED INTO CI YET -- ON PURPOSE
-----------------------------------
ADR 0115 is `Proposed` and its migration is written and NOT applied. A blocking
guard against an unapplied migration would fail every build, so this file is
deliberately absent from `.github/workflows/`. The parent session wires it in at
lock time, alongside the migration. Until then, run it by hand.

Its own honest behaviour on today's tree is therefore **exit 2**: the columns it
checks do not exist yet, and "nothing to check" is never a pass here.

EXIT CODES
----------
    0   every invariant that could be checked held, and at least one was
        actually checked against something
    1   an invariant is broken
    2   COULD NOT CHECK -- no database, no migration, or nothing to look at.
        Never a pass. A guard that reports absence as health is this repo's
        cardinal fault (see `.planning/decisions/0086`, `0094`), and this one is
        checking the ledger, where that fault is most expensive.

USAGE
-----
    python3 scripts/check_house_item_invariants.py [--dsn DSN]
    python3 scripts/check_house_item_invariants.py --self-test [--dsn DSN]

The DSN is taken from `--dsn`, else `$HOUSE_ITEM_GUARD_DSN`, else
`$SUPABASE_DB_URL`, else a `SUPABASE_DB_URL=` line in `.env`. `--self-test`
needs a throwaway database it may write to inside a transaction it rolls back;
point it at a local build, never at production.
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys
from dataclasses import dataclass, field

try:
    import psycopg2
except ImportError:  # pragma: no cover - environment problem, not a finding
    print("COULD NOT CHECK: psycopg2 is not installed. Exit 2. This is not a pass.")
    sys.exit(2)

REPO = pathlib.Path(__file__).resolve().parent.parent
MIGRATION = REPO / "supabase/migrations/20260903171000_the_house_item_is_the_ledgers_key.sql"

# The five columns phase 1 adds or relaxes. Their absence is the signal that the
# migration has not landed, which is COULD NOT CHECK and not a finding.
REQUIRED_COLUMNS = ("kind", "uom", "display_name", "beverage_id", "identity_provenance")

# INVARIANT 1's population. Every one of these carries an inventory_id that is
# meant to name a house item; the third column says whether the DATABASE holds
# it, which is what makes the guard necessary rather than redundant.
STOCK_REFERENCES = (
    ("inventory_lots", "inventory_id", True),
    ("inventory_transactions", "inventory_id", False),
    ("pour_events", "inventory_id", False),
    ("stock_counts", "inventory_id", True),
    ("pos_item_mappings", "inventory_id", True),
    ("inventory_alert_state", "inventory_id", False),
    ("inventory_lot_revaluations", "inventory_id", False),
    ("wine_consumption_log", "inventory_id", True),
)


class CouldNotCheck(Exception):
    """Raised when the scan cannot be trusted. Always exit 2, never 0."""


@dataclass
class Finding:
    invariant: str
    detail: str


@dataclass
class Report:
    failures: list[Finding] = field(default_factory=list)
    checked: list[str] = field(default_factory=list)
    vacuous: list[str] = field(default_factory=list)

    @property
    def substantive(self) -> bool:
        """Did anything actually get looked at? A report of nothing is exit 2."""
        return bool(self.checked)


# --------------------------------------------------------------------------
# helpers


def _table_exists(cur, table: str) -> bool:
    cur.execute(
        "SELECT to_regclass(%s) IS NOT NULL", (f"public.{table}",)
    )
    return bool(cur.fetchone()[0])


def _one(cur, sql: str, params: tuple = ()):
    # Pass no parameter sequence at all when there is none: psycopg2 treats `%`
    # as an interpolation marker whenever one is given, and these queries carry
    # LIKE patterns such as '%house_key%'.
    if params:
        cur.execute(sql, params)
    else:
        cur.execute(sql)
    row = cur.fetchone()
    return row[0] if row else None


# --------------------------------------------------------------------------
# the invariants


def _inv1_stock_rows_key_on_a_house_item(cur, rep: Report) -> None:
    """Every stock row keys on a house item."""
    name = "1. every stock row keys on a house item"
    looked_at = 0
    for table, column, has_fk in STOCK_REFERENCES:
        if not _table_exists(cur, table):
            # A table that does not exist in this build is not a finding, but it
            # is also not a check. Say so rather than counting it as clean.
            rep.vacuous.append(f"{name} -- {table} does not exist in this database")
            continue
        population = _one(
            cur, f"SELECT count(*) FROM public.{table} WHERE {column} IS NOT NULL"
        )
        if population == 0:
            rep.vacuous.append(f"{name} -- {table}.{column}: 0 rows to check")
            continue
        looked_at += population
        orphans = _one(
            cur,
            f"""SELECT count(*) FROM public.{table} t
                 WHERE t.{column} IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM public.restaurant_inventory ri
                                    WHERE ri.id = t.{column})""",
        )
        if orphans:
            enforced = "an FK exists and is being bypassed" if has_fk else "NO FK -- nothing but this guard was ever going to catch it"
            rep.failures.append(
                Finding(
                    name,
                    f"{orphans} of {population} {table}.{column} row(s) name a house "
                    f"item that does not exist ({enforced}).",
                )
            )
    if looked_at:
        rep.checked.append(f"{name} ({looked_at} ledger rows)")


def _inv2_kind_and_uom(cur, rep: Report) -> None:
    """No house item without a kind and a uom -- and no DEFAULT on either."""
    name = "2. no house item without a kind and a uom"

    # Structural half. This one is checkable on an empty database and is the
    # more important of the two: a DEFAULT is how a keg silently becomes a
    # bottle, which is the exact failure ADR 0115 exists to stop.
    for column in ("kind", "uom", "display_name", "identity_provenance"):
        has_default = _one(
            cur,
            """SELECT d.adbin IS NOT NULL
                 FROM pg_attribute a
                 LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                WHERE a.attrelid = 'public.restaurant_inventory'::regclass
                  AND a.attname = %s""",
            (column,),
        )
        if has_default:
            rep.failures.append(
                Finding(
                    name,
                    f"restaurant_inventory.{column} has acquired a DEFAULT. That is "
                    "how an item nobody described becomes a bottle of wine; ADR 0115 "
                    "forbids it and the migration asserts its absence.",
                )
            )
        not_null = _one(
            cur,
            """SELECT attnotnull FROM pg_attribute
                WHERE attrelid = 'public.restaurant_inventory'::regclass AND attname = %s""",
            (column,),
        )
        if not not_null:
            rep.failures.append(
                Finding(name, f"restaurant_inventory.{column} is nullable again.")
            )
    rep.checked.append(f"{name} -- NOT NULL and no DEFAULT on 4 columns")

    # Row half.
    population = _one(cur, "SELECT count(*) FROM public.restaurant_inventory")
    if population == 0:
        rep.vacuous.append(f"{name} -- restaurant_inventory: 0 rows to check")
        return
    bad = _one(
        cur,
        """SELECT count(*) FROM public.restaurant_inventory
            WHERE kind IS NULL OR uom IS NULL
               OR display_name IS NULL OR identity_provenance IS NULL""",
    )
    if bad:
        rep.failures.append(
            Finding(name, f"{bad} of {population} house item(s) carry no kind, uom, name or provenance.")
        )
    rep.checked.append(f"{name} ({population} house items)")


def _inv3_pos_mappings(cur, rep: Report) -> None:
    """Every POS mapping resolves to a house item, and agrees with it."""
    name = "3. every POS mapping resolves to a house item"
    if not _table_exists(cur, "pos_item_mappings"):
        rep.vacuous.append(f"{name} -- pos_item_mappings does not exist")
        return
    population = _one(cur, "SELECT count(*) FROM public.pos_item_mappings")
    if population == 0:
        rep.vacuous.append(f"{name} -- pos_item_mappings: 0 rows to check")
        return

    # A mapping that names a wine its own house item does not name is two
    # answers to one question, which is how a till line lands on the wrong
    # bottle (ADR 0030).
    disagree = _one(
        cur,
        """SELECT count(*) FROM public.pos_item_mappings m
             JOIN public.restaurant_inventory ri ON ri.id = m.inventory_id
            WHERE m.master_wine_id IS NOT NULL
              AND ri.master_wine_id IS DISTINCT FROM m.master_wine_id""",
    )
    if disagree:
        rep.failures.append(
            Finding(
                name,
                f"{disagree} of {population} POS mapping(s) name a master_wine_id that "
                "their own house item does not carry.",
            )
        )
    rep.checked.append(f"{name} ({population} mappings)")


def _inv4_house_key_is_never_stored(cur, rep: Report) -> None:
    """beverage_house_key() is a reporting key and must never reach a row."""
    name = "4. beverage_house_key is never written to a row"
    if _one(cur, "SELECT to_regprocedure('public.beverage_house_key(text,text)') IS NULL"):
        rep.vacuous.append(f"{name} -- beverage_house_key() does not exist in this database")
        return

    stored = _one(
        cur,
        """SELECT count(*) FROM information_schema.columns c
             JOIN information_schema.tables t
               ON t.table_schema = c.table_schema AND t.table_name = c.table_name
              AND t.table_type = 'BASE TABLE'
            WHERE c.table_schema = 'public' AND c.column_name LIKE '%house_key%'""",
    )
    if stored:
        rep.failures.append(
            Finding(
                name,
                f"{stored} base-table column(s) named like a stored house key. ADR 0108 "
                "forbids this outright: the key is deliberately coarser than "
                "beverage_identity_key and does not inherit its zero-false-merge "
                "property, so a stored copy will be used to merge something.",
            )
        )

    in_default = _one(
        cur,
        """SELECT count(*) FROM pg_attrdef d
            WHERE pg_get_expr(d.adbin, d.adrelid) ILIKE '%beverage_house_key%'""",
    )
    if in_default:
        rep.failures.append(
            Finding(name, f"{in_default} column DEFAULT(s) call beverage_house_key().")
        )

    in_trigger = _one(
        cur,
        """SELECT count(DISTINCT p.oid)
             FROM pg_trigger tg
             JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE NOT tg.tgisinternal
              AND pg_get_functiondef(p.oid) ILIKE '%beverage_house_key%'""",
    )
    if in_trigger:
        rep.failures.append(
            Finding(name, f"{in_trigger} trigger function(s) call beverage_house_key().")
        )
    rep.checked.append(f"{name} -- columns, defaults and trigger bodies")


def _inv5_identity_links_are_consistent(cur, rep: Report) -> None:
    """One row, one catalogue, and a stated provenance that matches it."""
    name = "5. the identity link is consistent"
    population = _one(cur, "SELECT count(*) FROM public.restaurant_inventory")
    if population == 0:
        rep.vacuous.append(f"{name} -- restaurant_inventory: 0 rows to check")
        return

    checks = (
        (
            "carry both a wine and a beverage link",
            "master_wine_id IS NOT NULL AND beverage_id IS NOT NULL",
        ),
        (
            "are kind='wine' with no wine behind them",
            "kind = 'wine' AND master_wine_id IS NULL",
        ),
        (
            "claim a wine-library provenance with no wine link",
            "identity_provenance IN ('wine_library','backfill') AND master_wine_id IS NULL",
        ),
        (
            "claim a beverage-catalogue provenance with no catalogue link",
            "identity_provenance = 'beverage_catalogue' AND beverage_id IS NULL",
        ),
    )
    for label, predicate in checks:
        bad = _one(cur, f"SELECT count(*) FROM public.restaurant_inventory WHERE {predicate}")
        if bad:
            rep.failures.append(Finding(name, f"{bad} house item(s) {label}."))
    rep.checked.append(f"{name} ({population} house items, 4 predicates)")


def _inv6_house_items_view(cur, rep: Report) -> None:
    """The view must not read past the table's RLS, and must stay off the browser roles."""
    name = "6. the house_items view is security_invoker and ungranted"
    if _one(cur, "SELECT to_regclass('public.house_items') IS NULL"):
        rep.failures.append(
            Finding(name, "the house_items view is missing; the migration created it.")
        )
        return
    invoker = _one(
        cur,
        """SELECT coalesce('security_invoker=true' = ANY(reloptions), false)
             FROM pg_class WHERE oid = 'public.house_items'::regclass""",
    )
    if not invoker:
        rep.failures.append(
            Finding(
                name,
                "house_items is not security_invoker. Without it the view runs with the "
                "definer's rights and reads straight past restaurant_inventory's RLS -- "
                "one house would read another's items.",
            )
        )
    for role in ("anon", "authenticated"):
        if _one(cur, "SELECT has_table_privilege(%s, 'public.house_items', 'SELECT')", (role,)):
            rep.failures.append(
                Finding(name, f"house_items is SELECTable by {role} -- that is a cross-tenant read.")
            )
    rep.checked.append(name)


INVARIANTS = (
    _inv1_stock_rows_key_on_a_house_item,
    _inv2_kind_and_uom,
    _inv3_pos_mappings,
    _inv4_house_key_is_never_stored,
    _inv5_identity_links_are_consistent,
    _inv6_house_items_view,
)


# --------------------------------------------------------------------------


def scan(cur) -> Report:
    if not _table_exists(cur, "restaurant_inventory"):
        raise CouldNotCheck(
            "public.restaurant_inventory does not exist -- this is not the "
            "Mudavym schema, or the baseline has not been applied"
        )

    cur.execute(
        """SELECT attname FROM pg_attribute
            WHERE attrelid = 'public.restaurant_inventory'::regclass
              AND attname = ANY(%s) AND NOT attisdropped""",
        (list(REQUIRED_COLUMNS),),
    )
    present = {r[0] for r in cur.fetchall()}
    missing = [c for c in REQUIRED_COLUMNS if c not in present]
    if missing:
        raise CouldNotCheck(
            "migration 20260903171000_the_house_item_is_the_ledgers_key.sql has not "
            f"been applied -- restaurant_inventory is missing {', '.join(missing)}. "
            "ADR 0115 is Proposed and the migration is gated, so this is the EXPECTED "
            "answer on today's tree. It is exit 2, not a pass: there are no house "
            "items to hold invariants over yet."
        )

    rep = Report()
    for check in INVARIANTS:
        check(cur, rep)
    return rep


# --------------------------------------------------------------------------


def resolve_dsn(explicit: str | None) -> str:
    if explicit:
        return explicit
    for var in ("HOUSE_ITEM_GUARD_DSN", "SUPABASE_DB_URL"):
        if os.environ.get(var):
            return os.environ[var]
    env = REPO / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("SUPABASE_DB_URL="):
                return line.split("=", 1)[1].strip()
    raise CouldNotCheck(
        "no database. Pass --dsn, or set HOUSE_ITEM_GUARD_DSN or SUPABASE_DB_URL, "
        "or put SUPABASE_DB_URL= in .env"
    )


def print_report(rep: Report) -> None:
    for line in rep.checked:
        print(f"  checked   {line}")
    for line in rep.vacuous:
        print(f"  NOT CHECKED  {line}")


# --------------------------------------------------------------------------
# self-test


def _break_and_expect(conn, label: str, sql: str, invariant_prefix: str) -> str | None:
    """Break one invariant inside a savepoint; the scan must see it."""
    cur = conn.cursor()
    cur.execute("SAVEPOINT probe")
    try:
        cur.execute(sql)
        rep = scan(cur)
        hit = [f for f in rep.failures if f.invariant.startswith(invariant_prefix)]
        if not hit:
            return f"{label}: the guard did not see it"
        return None
    finally:
        cur.execute("ROLLBACK TO SAVEPOINT probe")


def self_test(dsn: str) -> int:
    failures: list[str] = []
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        # (a) THE PRE-FIX CONTROL. Before the migration, the guard must refuse to
        #     answer rather than pass. A guard with no failing control is not
        #     evidence of anything.
        try:
            scan(cur)
        except CouldNotCheck as exc:
            if "20260903171000" not in str(exc):
                failures.append(f"control: refused for the wrong reason: {exc}")
            else:
                print("  ok  pre-migration tree -> COULD NOT CHECK (exit 2), not a pass")
        else:
            failures.append(
                "control: the guard PASSED a database where the migration has not been "
                "applied. That is the fault it exists to prevent."
            )

        cur.execute(MIGRATION.read_text())

        # (b) A clean, migrated database must pass -- and must actually have
        #     looked at something.
        cur.execute("SAVEPOINT clean")
        cur.execute(
            """INSERT INTO public.restaurants (id, name, slug)
               VALUES ('aaaaaaaa-0000-0000-0000-00000000f001','Guard House','guard-house-0115')"""
        )
        cur.execute(
            """INSERT INTO public.master_wine_library (id, wine_id, name, producer, primary_type, country)
               VALUES ('bbbbbbbb-0000-0000-0000-00000000f001','GW1','Guard Wine','Guard','red','Italy')"""
        )
        cur.execute(
            """INSERT INTO public.restaurant_inventory (id, restaurant_id, master_wine_id, wine_name)
               VALUES ('cccccccc-0000-0000-0000-00000000f001','aaaaaaaa-0000-0000-0000-00000000f001',
                       'bbbbbbbb-0000-0000-0000-00000000f001','Guard Wine 2016')"""
        )
        rep = scan(cur)
        if rep.failures:
            failures.append(
                "clean: a correct, migrated database reported "
                + "; ".join(f"{f.invariant} -- {f.detail}" for f in rep.failures)
            )
        elif not rep.substantive:
            failures.append("clean: the scan reported nothing checked, which must be exit 2")
        else:
            print(f"  ok  migrated tree -> clean, {len(rep.checked)} invariant group(s) checked")

        # (c) THE BROKEN FIXTURE the brief names: a stock row with no house item.
        problem = _break_and_expect(
            conn,
            "orphan ledger row",
            """INSERT INTO public.inventory_transactions
                 (restaurant_id, inventory_id, wine_id, transaction_type, source,
                  quantity_change, quantity_before, quantity_after)
               VALUES ('aaaaaaaa-0000-0000-0000-00000000f001',
                       '00000000-dead-dead-dead-000000000001', NULL,
                       'adjustment','manual', 1, 0, 1)""",
            "1.",
        )
        if problem:
            failures.append(problem)
        else:
            print("  ok  a stock row naming no house item -> caught (invariant 1)")

        # (d) The DEFAULT that would make a keg a bottle.
        problem = _break_and_expect(
            conn,
            "a DEFAULT on uom",
            "ALTER TABLE public.restaurant_inventory ALTER COLUMN uom SET DEFAULT 'bottle'",
            "2.",
        )
        if problem:
            failures.append(problem)
        else:
            print("  ok  a DEFAULT on uom -> caught (invariant 2)")

        # (e) Two identities wearing one id.
        problem = _break_and_expect(
            conn,
            "a row with both catalogue links",
            """UPDATE public.restaurant_inventory
                  SET identity_provenance = 'beverage_catalogue'
                WHERE id = 'cccccccc-0000-0000-0000-00000000f001'""",
            "5.",
        )
        if problem:
            failures.append(problem)
        else:
            print("  ok  a provenance its links do not support -> caught (invariant 5)")

        # (f) The view reading past RLS.
        problem = _break_and_expect(
            conn,
            "house_items losing security_invoker",
            "ALTER VIEW public.house_items SET (security_invoker = false)",
            "6.",
        )
        if problem:
            failures.append(problem)
        else:
            print("  ok  house_items without security_invoker -> caught (invariant 6)")

        # (g) A stored house key -- ADR 0108's one forbidden abuse.
        problem = _break_and_expect(
            conn,
            "a stored beverage_house_key",
            "ALTER TABLE public.restaurant_inventory ADD COLUMN house_key text",
            "4.",
        )
        if problem:
            failures.append(problem)
        else:
            print("  ok  a stored house_key column -> caught (invariant 4)")

    finally:
        conn.rollback()
        conn.close()

    if failures:
        print("\nSELF-TEST FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "\nSELF-TEST PASSED -- the guard refuses an unmigrated tree with exit 2, passes a "
        "correct one, and catches an orphan ledger row, a reintroduced DEFAULT, an "
        "inconsistent identity link, a view that lost security_invoker and a stored "
        "house key. Everything ran inside one transaction, which was rolled back."
    )
    return 0


# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="ADR 0115 house-item invariants.")
    ap.add_argument("--dsn", help="Postgres DSN to check")
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the guard catches each violation, inside a rolled-back transaction",
    )
    args = ap.parse_args()

    try:
        dsn = resolve_dsn(args.dsn)
    except CouldNotCheck as exc:
        print(f"COULD NOT CHECK: {exc}")
        print("Exit 2. This is not a pass.")
        return 2

    if args.self_test:
        try:
            return self_test(dsn)
        except CouldNotCheck as exc:
            print(f"COULD NOT CHECK: {exc}")
            print("Exit 2. This is not a pass.")
            return 2

    try:
        conn = psycopg2.connect(dsn, connect_timeout=10)
    except Exception as exc:  # noqa: BLE001 - any connection failure is exit 2
        print(f"COULD NOT CHECK: cannot reach the database: {type(exc).__name__}: {exc}")
        print("Exit 2. This is not a pass.")
        return 2

    conn.autocommit = True
    try:
        cur = conn.cursor()
        cur.execute("SET statement_timeout = '120s'")
        try:
            rep = scan(cur)
        except CouldNotCheck as exc:
            print(f"COULD NOT CHECK: {exc}")
            print("Exit 2. This is not a pass.")
            return 2
    finally:
        conn.close()

    print_report(rep)

    if rep.failures:
        print("\nFAIL -- the house item is not the ledger's key here:")
        for f in rep.failures:
            print(f"  [{f.invariant}] {f.detail}")
        print(
            "\nADR 0115 names these invariants and says why the database cannot hold "
            "them: four of the ledger's references to restaurant_inventory have no "
            "foreign key at all."
        )
        return 1

    if not rep.substantive:
        print(
            "\nCOULD NOT CHECK: nothing in this database exercised a single invariant. "
            "Exit 2. This is not a pass."
        )
        return 2

    print(
        f"\nPASS -- {len(rep.checked)} invariant group(s) held"
        + (f", {len(rep.vacuous)} had nothing to check." if rep.vacuous else ".")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
