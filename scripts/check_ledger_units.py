#!/usr/bin/env python3
"""Guard: a ledger quantity cannot be written without a unit, and a lot cannot
disagree with its item's canonical unit.

WHY THIS GUARD EXISTS
---------------------
ADR 0070 (Locked, 2026-09-02) keeps `inventory_lots.qty` and
`inventory_transactions.quantity_before/after/change` as `integer` and makes
every ledger row state its own unit. ADR 0075 settles the vocabulary, the
enforcement mechanism, and the allocation algorithm.

Four things can silently undo that, and none of them breaks a test that existed
before it:

  A. Dropping `uom NOT NULL`, the CHECK, the fill-from-item trigger, or the
     composite foreign key. Each is one `ALTER`. Afterwards a lot can carry no
     unit, or a unit its item disagrees with, and `trg_project_stock_from_lots`
     will happily `SUM(qty)` 25 against 25000 and project a nonsense on-hand
     figure. There is no constraint violation and no error — ADR 0070 §10.5
     calls this option F's own failure mode.

  B. The two halves of the vocabulary drifting apart. `LEDGER_UOMS` in
     `apps/api-gateway/src/inventory-ledger/ledger-units.ts` and the three SQL
     CHECK constraints are one list written twice. A fifth unit added to either
     half alone surfaces as a 23514 in production, not in CI.

  C. A quantity divided with `/` or `Math.round(x / n)` instead of
     `allocateRemainderSafe`. One third has no finite representation at any
     scale, so an equal three-way split of 1000 must allocate 333 + 333 + 334.
     The naive split silently destroys or creates units, and the residue lands
     in `inventory_lot_rollup`'s weighted-average-cost divisor, which is guarded
     only by `sum(qty) > 0`.

  D. The SQL FIFO depletion loop being rewritten as a proportional split.
     `apply_stock_movement` and `transfer_stock` deplete by integer subtraction
     and `LEAST`, which is exact and leaves no residue. That exactness is a
     property of the code shape, and nothing else in CI asserts it.

This is intentionally text analysis over SQL and TypeScript rather than a
database check. The arm that needs a live database lives in schema-parity.yml,
and — as of 2026-09-02 — it cannot see nullability, CHECK constraints, UNIQUE
constraints, or triggers at all, which is most of what this guard protects.

EXIT CODES
----------
  0  every contract holds
  1  a contract is broken — the message names which, and where
  2  CANNOT CHECK: a file this guard reads is missing, or its shape changed so
     the guard can no longer see what it claims to. Never silently passes; a
     vacuous pass is the failure mode ADR 0025 exists to end.

`--self-test` proves the exit-code invariants against synthetic trees, including
that each check actually FAILS on a tree carrying the corresponding pre-fix
defect. A guard that has never been shown to fire is not evidence.

PROVEN AGAINST THE PRE-FIX TREE (2026-09-02)
--------------------------------------------
Run against `origin/main` — the tree before this work — it exits **2**: the
ledger migration and `ledger-units.ts` do not exist there, so the guard cannot
check what it claims to and says so instead of going green. Run against the
post-fix tree with any one of the eleven pre-fix defects injected, it exits
**1** and names the defect. Both paths block CI; neither is a silent pass.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MIGRATIONS = "supabase/migrations"
LEDGER_MIGRATION = f"{MIGRATIONS}/20260902120000_ledger_unit_typed_quantities.sql"
UNITS_TS = "apps/api-gateway/src/inventory-ledger/ledger-units.ts"
LEDGER_DIR = "apps/api-gateway/src/inventory-ledger"

# The SQL objects that make a unitless or disagreeing ledger row impossible.
# Each is a (description, regex) pair searched across the whole migration set,
# so a later migration may legitimately move one — but not delete it.
REQUIRED_SQL = [
    (
        "inventory_lots.uom is NOT NULL",
        re.compile(
            r"alter\s+table\s+(?:public\.)?inventory_lots\s+alter\s+column\s+uom\s+set\s+not\s+null",
            re.I,
        ),
    ),
    (
        "inventory_transactions.uom is NOT NULL",
        re.compile(
            r"alter\s+table\s+(?:public\.)?inventory_transactions\s+alter\s+column\s+uom\s+set\s+not\s+null",
            re.I,
        ),
    ),
    (
        "restaurant_inventory.canonical_uom is NOT NULL",
        re.compile(
            r"alter\s+column\s+canonical_uom\s+set\s+not\s+null",
            re.I,
        ),
    ),
    (
        "the fill-from-item function exists",
        re.compile(
            r"create\s+or\s+replace\s+function\s+(?:public\.)?ledger_uom_from_item\s*\(",
            re.I,
        ),
    ),
    (
        "the fill-from-item trigger is attached to inventory_lots",
        re.compile(
            r"create\s+trigger\s+trg_ledger_uom_from_item[\s\S]{0,200}?on\s+(?:public\.)?inventory_lots",
            re.I,
        ),
    ),
    (
        "the fill-from-item trigger is attached to inventory_transactions",
        re.compile(
            r"create\s+trigger\s+trg_ledger_uom_from_item[\s\S]{0,200}?on\s+(?:public\.)?inventory_transactions",
            re.I,
        ),
    ),
    (
        "the composite foreign key pins a lot's uom to its item",
        re.compile(
            r"foreign\s+key\s*\(\s*inventory_id\s*,\s*uom\s*\)\s*"
            r"references\s+(?:public\.)?restaurant_inventory\s*\(\s*id\s*,\s*canonical_uom\s*\)",
            re.I,
        ),
    ),
    (
        "that foreign key is ON UPDATE RESTRICT, never CASCADE",
        # CASCADE would relabel a lot from mg to ml WITHOUT rescaling qty.
        re.compile(
            r"references\s+(?:public\.)?restaurant_inventory\s*\(\s*id\s*,\s*canonical_uom\s*\)"
            r"[\s\S]{0,120}?on\s+update\s+restrict",
            re.I,
        ),
    ),
    (
        "the trigger refuses a uom that disagrees with the item",
        re.compile(r"disagrees\s+with\s+the\s+item", re.I),
    ),
]

# A quantity divided without the remainder-safe allocator. Matched inside the
# inventory-ledger module only; analytics and forecasting divide legitimately.
NAIVE_SPLIT = re.compile(
    r"Math\.(?:round|floor|ceil)\s*\(\s*[\w$.]*(?:qty|quantity|Qty|Quantity)[\w$.]*\s*/",
)

# The FIFO depletion shape that makes conservation exact. Each is checked in the
# NEWEST migration that defines the function, not in the union of all of them —
# the baseline carries a superseded copy of `apply_stock_movement`, and a union
# search would let the live definition rot while the dead one kept the guard
# green. That is the absence-reported-as-health fault in guard form.
FIFO_SHAPES = [
    (
        "apply_stock_movement depletes by exact integer subtraction",
        re.compile(r"function\s+(?:public\.)?apply_stock_movement\s*\(", re.I),
        re.compile(r"v_remaining\s*:=\s*v_remaining\s*-\s*v_lot\.qty", re.I),
    ),
    (
        "transfer_stock moves LEAST(lot, remaining), not a proportional share",
        re.compile(r"function\s+(?:public\.)?transfer_stock\s*\(", re.I),
        re.compile(r"v_move\s*:=\s*LEAST\s*\(\s*v_lot\.qty\s*,\s*v_remaining\s*\)", re.I),
    ),
]

# The version this migration introduced the contract at. Anything NEWER that
# drops one of the objects is a regression the union search above cannot see.
LEDGER_VERSION = "20260902120000"

UNDOES_THE_CONTRACT = [
    (
        "drops the fill-from-item trigger",
        re.compile(r"drop\s+trigger\s+(?:if\s+exists\s+)?trg_ledger_uom_from_item", re.I),
    ),
    (
        "drops the composite foreign key",
        re.compile(
            r"drop\s+constraint\s+(?:if\s+exists\s+)?inventory_lots_item_uom_fkey", re.I
        ),
    ),
    (
        "drops a uom NOT NULL",
        re.compile(r"alter\s+column\s+(?:uom|canonical_uom)\s+drop\s+not\s+null", re.I),
    ),
    (
        "drops a uom CHECK",
        re.compile(r"drop\s+constraint\s+(?:if\s+exists\s+)?\w*_uom_check", re.I),
    ),
    (
        "drops the canonical_uom column",
        re.compile(r"drop\s+column\s+(?:if\s+exists\s+)?canonical_uom", re.I),
    ),
]


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


def read(rel: str) -> str:
    p = ROOT / rel
    if not p.is_file():
        raise CannotCheck(f"{rel} is missing")
    text = p.read_text(encoding="utf-8", errors="replace")
    if not text.strip():
        raise CannotCheck(f"{rel} is empty")
    return text


def migration_files() -> list[Path]:
    d = ROOT / MIGRATIONS
    if not d.is_dir():
        raise CannotCheck(f"{MIGRATIONS}/ is missing")
    files = sorted(d.glob("*.sql"))
    if not files:
        raise CannotCheck(f"{MIGRATIONS}/ contains no .sql files")
    return files


def all_migrations() -> str:
    return "\n".join(
        f.read_text(encoding="utf-8", errors="replace") for f in migration_files()
    )


def newest_defining(pattern: re.Pattern[str], what: str) -> str:
    """Body of the newest migration that defines `what`, comments stripped.

    Migration versions sort lexicographically, which is what Supabase itself
    uses to order them, so the last match is the definition that wins.
    """
    hits = [
        f
        for f in migration_files()
        if pattern.search(strip_sql_comments(f.read_text(encoding="utf-8", errors="replace")))
    ]
    if not hits:
        raise CannotCheck(
            f"no migration defines {what}; the guard cannot check a function "
            "that is not there."
        )
    return strip_sql_comments(hits[-1].read_text(encoding="utf-8", errors="replace"))


def strip_sql_comments(sql: str) -> str:
    """Drop `-- ...` lines so a rule quoted in a comment cannot satisfy the guard.

    This is the same trap `check_order_capture_contract.py` guards: the
    migration explains every constraint in prose directly above it, and prose
    that matches the pattern would make the guard pass on a tree where the
    constraint had been deleted.
    """
    return re.sub(r"--[^\n]*", "", sql)


def ts_vocabulary(text: str) -> list[str]:
    m = re.search(r"LEDGER_UOMS\s*=\s*\[([^\]]*)\]", text)
    if not m:
        raise CannotCheck(
            f"{UNITS_TS} no longer declares LEDGER_UOMS as an array literal"
        )
    units = re.findall(r'"([a-z_]+)"', m.group(1))
    if not units:
        raise CannotCheck(f"{UNITS_TS} declares LEDGER_UOMS but it parsed empty")
    return units


def sql_vocabularies(migration: str) -> list[list[str]]:
    """Every `check (<col> = any (array['a'::text, ...]))` in the ledger migration."""
    checks = re.findall(
        r"check\s*\(\(?\w+(?:::text)?\s*=\s*any\s*\(array\[([^\]]*)\]\)\)?\)",
        migration,
        re.I,
    )
    out = []
    for body in checks:
        lits = re.findall(r"'([a-z_]+)'::text", body)
        if lits:
            out.append(lits)
    return out


def check_sql_enforcement(failures: list[str]) -> None:
    sql = strip_sql_comments(all_migrations())
    for description, pattern in REQUIRED_SQL:
        if not pattern.search(sql):
            failures.append(
                f"[sql] {description} — no migration declares it any more. "
                "A ledger row can now carry no unit, or a unit its item "
                "disagrees with. ADR 0070 / ADR 0075."
            )


def check_vocabulary_parity(failures: list[str]) -> None:
    ts = sorted(ts_vocabulary(read(UNITS_TS)))
    migration = strip_sql_comments(read(LEDGER_MIGRATION))
    vocabs = sql_vocabularies(migration)

    if len(vocabs) != 3:
        raise CannotCheck(
            f"{LEDGER_MIGRATION} declares {len(vocabs)} unit CHECK constraints, "
            "expected 3 (canonical_uom, inventory_lots.uom, "
            "inventory_transactions.uom). The guard can no longer see the "
            "vocabulary it compares against."
        )

    for i, vocab in enumerate(vocabs):
        if sorted(vocab) != ts:
            failures.append(
                f"[vocabulary] CHECK #{i + 1} in {LEDGER_MIGRATION} accepts "
                f"{sorted(vocab)} but LEDGER_UOMS in {UNITS_TS} is {ts}. "
                "One list written twice: a unit added to one half alone "
                "surfaces as a 23514 in production, not here."
            )


def check_allocator(failures: list[str]) -> None:
    text = read(UNITS_TS)
    if "export function allocateRemainderSafe" not in text:
        failures.append(
            f"[allocation] {UNITS_TS} no longer exports allocateRemainderSafe. "
            "ADR 0070 makes remainder-safe allocation required, not optional: "
            "one third has no finite representation at any scale, so an equal "
            "three-way split of 1000 must allocate 333 + 333 + 334."
        )
        return

    # The body must not BE the naive split it exists to replace.
    body = text.split("export function allocateRemainderSafe", 1)[1]
    if "Math.floor" not in body:
        failures.append(
            "[allocation] allocateRemainderSafe no longer floors its shares. "
            "The largest-remainder method needs a floor plus a leftover pass; "
            "without it the shares do not sum to the total."
        )

    d = ROOT / LEDGER_DIR
    if not d.is_dir():
        raise CannotCheck(f"{LEDGER_DIR}/ is missing")
    sources = [p for p in d.rglob("*.ts") if not p.name.endswith(".spec.ts")]
    if not sources:
        raise CannotCheck(f"{LEDGER_DIR}/ contains no non-spec TypeScript")
    for path in sources:
        for n, line in enumerate(
            path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
        ):
            if line.lstrip().startswith(("*", "//")):
                continue
            if NAIVE_SPLIT.search(line):
                rel = path.relative_to(ROOT)
                failures.append(
                    f"[allocation] {rel}:{n} divides a quantity with "
                    "Math.round/floor/ceil. Use allocateRemainderSafe: the "
                    "naive split destroys or creates units, and the residue "
                    "becomes inventory_lot_rollup's WAC divisor.\n"
                    f"    {line.strip()}"
                )


def check_fifo_exactness(failures: list[str]) -> None:
    for description, defines, shape in FIFO_SHAPES:
        body = newest_defining(defines, description)
        if not shape.search(body):
            failures.append(
                f"[fifo] {description} — that shape is gone from the newest "
                "migration defining it. FIFO depletion is exact only while it "
                "subtracts whole integers; a proportional split reintroduces "
                "the residue ADR 0070 chose integers to avoid."
            )


APPLY_STOCK_MOVEMENT = re.compile(
    r"function\s+(?:public\.)?apply_stock_movement\s*\(", re.I
)
MARKS_DEPLETED = re.compile(
    r"status\s*=\s*CASE\s+WHEN\s+open_bottle_ml\s*>\s*0\s+THEN\s+status\s+ELSE\s+'depleted'",
    re.I,
)
DELETES_A_LOT = re.compile(r"delete\s+from\s+(?:public\.)?inventory_lots", re.I)


def check_depleted_lots_survive(failures: list[str]) -> None:
    """A depleted lot is marked, not deleted.

    `inventory_lots.status` has declared 'depleted' since the baseline and
    nothing ever set it, because the row was erased at the moment it became
    true. Marking is what makes the lot id stable enough for a transformation to
    point at, and what keeps the consumed lot's own unit_cost readable.
    """
    body = newest_defining(APPLY_STOCK_MOVEMENT, "apply_stock_movement")

    if not MARKS_DEPLETED.search(body):
        failures.append(
            "[depletion] apply_stock_movement no longer marks an emptied lot "
            "`status = 'depleted'` (guarded on open_bottle_ml = 0). Without it "
            "`status` declares a value nothing ever sets, any foreign key to an "
            "input lot is unstable, and the consumed lot's unit_cost is gone."
        )
    if DELETES_A_LOT.search(body):
        failures.append(
            "[depletion] apply_stock_movement DELETEs from inventory_lots "
            "again. A draw that exactly empties a lot must mark it, not erase "
            "it — the delete also destroyed any open_bottle_ml the lot still "
            "held."
        )

    # The presence-based expressions that must stay qty-aware now that
    # zero-quantity rows persist. Checked in the newest definition of the view.
    rollup = newest_defining(
        re.compile(r"view\s+(?:public\.)?inventory_lot_rollup\s+as", re.I),
        "inventory_lot_rollup",
    )
    # Each column's expression runs from the end of the PREVIOUS `AS <name>` to
    # the start of its own. A fixed-width look-back would spill into the
    # neighbouring column and find its `qty > 0` instead — a guard that reads
    # the wrong expression is a guard that passes for the wrong reason.
    aliases = [(m.group(1).lower(), m.start(), m.end()) for m in re.finditer(r"AS\s+(\w+)\b", rollup, re.I)]
    by_name = {name: i for i, (name, _, _) in enumerate(aliases)}

    for column in ("has_invoice_cost", "live_lot_count", "live_location_count"):
        if column not in by_name:
            raise CannotCheck(
                f"inventory_lot_rollup no longer has a {column} column; the "
                "guard cannot check the filter it claims to."
            )
        i = by_name[column]
        start = aliases[i - 1][2] if i > 0 else 0
        expr = rollup[start : aliases[i][1]]
        if "qty > 0" not in expr:
            failures.append(
                f"[depletion] inventory_lot_rollup.{column} counts or tests "
                "PRESENCE without `qty > 0`. Depleted lots now persist, so it "
                "would keep counting an emptied lot as stock on hand."
            )


def check_nothing_undoes_the_contract(failures: list[str]) -> None:
    """A later migration must not quietly drop what this one added.

    The enforcement search above is a union over every migration, so a `DROP`
    landing after the `ADD` would leave it green. This is the ratchet.
    """
    for path in migration_files():
        version = path.name[:14]
        if version <= LEDGER_VERSION:
            continue
        sql = strip_sql_comments(path.read_text(encoding="utf-8", errors="replace"))
        for description, pattern in UNDOES_THE_CONTRACT:
            for m in pattern.finditer(sql):
                # `drop ... if exists` immediately followed by a re-`add` in the
                # same statement group is the idempotent-rewrite idiom, not a
                # removal. Look ahead for an `add constraint`/`create trigger`
                # within the next 400 characters.
                tail = sql[m.end() : m.end() + 400].lower()
                if "add  constraint" in tail or "add constraint" in tail or "create trigger" in tail:
                    continue
                failures.append(
                    f"[ratchet] {path.name} {description}, and nothing "
                    "re-adds it. ADR 0070's guarantee is that a ledger row "
                    "cannot carry no unit or a unit its item disagrees with; "
                    "this migration removes the mechanism."
                )


def check_cross_unit_aggregate(failures: list[str]) -> None:
    svc = ROOT / LEDGER_DIR / "inventory-ledger.service.ts"
    if not svc.is_file():
        raise CannotCheck(f"{LEDGER_DIR}/inventory-ledger.service.ts is missing")
    text = svc.read_text(encoding="utf-8", errors="replace")

    if "getTransactionSummary" not in text:
        raise CannotCheck(
            "inventory-ledger.service.ts no longer has getTransactionSummary; "
            "the guard cannot check the aggregate it claims to."
        )
    body = text.split("getTransactionSummary", 1)[1]
    if "uom" not in body[:6000]:
        failures.append(
            "[aggregate] getTransactionSummary sums quantity_change without "
            "reference to uom. ADR 0070: a cross-unit aggregate must convert "
            "or refuse, never silently sum — 25 kg of flour plus 25000 mg of "
            "saffron is not 25025 of anything."
        )


def main() -> int:
    failures: list[str] = []
    try:
        check_sql_enforcement(failures)
        check_vocabulary_parity(failures)
        check_allocator(failures)
        check_fifo_exactness(failures)
        check_depleted_lots_survive(failures)
        check_nothing_undoes_the_contract(failures)
        check_cross_unit_aggregate(failures)
    except CannotCheck as e:
        print(f"CANNOT CHECK: {e}", file=sys.stderr)
        print(
            "This is exit 2, not a skip. Fix the anchor or update the guard; "
            "do not delete the CI step.",
            file=sys.stderr,
        )
        return 2

    if failures:
        print("FAIL: the ledger unit contract is broken.\n")
        for f in failures:
            print(f"  {f}\n")
        print("See .planning/decisions/0070-a-quantity-states-its-own-unit.md")
        print("and .planning/decisions/0075-ledger-unit-vocabulary-and-allocation.md")
        return 1

    print("PASS — every ledger quantity states a unit, the unit belongs to the")
    print("item, the two vocabularies agree, allocation is remainder-safe, FIFO")
    print("depletion is exact, and the summary aggregate is unit-aware.")
    return 0


# ---------------------------------------------------------------------------
# --self-test
# ---------------------------------------------------------------------------


def _sandbox(fn) -> int:
    """Run `fn(root)` against a copy of the tree with ROOT repointed at it."""
    global ROOT
    original = ROOT
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "tree"
        root.mkdir()
        for rel in (MIGRATIONS, LEDGER_DIR):
            src = original / rel
            dst = root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.is_dir():
                shutil.copytree(src, dst)
        fn(root)
        ROOT = root
        try:
            return main()
        finally:
            ROOT = original


def self_test() -> int:
    failures: list[str] = []

    def case(label: str, expected: int, mutate) -> None:
        got = _sandbox(mutate)
        if got != expected:
            failures.append(f"{label}: expected exit {expected}, got {got}")

    def edit(root: Path, rel: str, old: str, new: str) -> None:
        p = root / rel
        text = p.read_text(encoding="utf-8")
        if old not in text:
            raise AssertionError(f"self-test anchor missing in {rel}: {old!r}")
        p.write_text(text.replace(old, new, 1), encoding="utf-8")

    case("a compliant tree", 0, lambda r: None)

    case(
        "dropping the lots NOT NULL",
        1,
        lambda r: edit(
            r,
            LEDGER_MIGRATION,
            "alter table public.inventory_lots\n  alter column uom set not null;",
            "-- removed",
        ),
    )

    case(
        "dropping the composite foreign key",
        1,
        lambda r: edit(
            r,
            LEDGER_MIGRATION,
            "foreign key (inventory_id, uom)",
            "foreign key (inventory_id)",
        ),
    )

    case(
        "turning ON UPDATE RESTRICT into CASCADE",
        1,
        lambda r: edit(
            r, LEDGER_MIGRATION, "on update restrict", "on update cascade"
        ),
    )

    case(
        "dropping the fill-from-item trigger on lots",
        1,
        lambda r: edit(
            r,
            LEDGER_MIGRATION,
            "create trigger trg_ledger_uom_from_item\n  before insert or update of uom, inventory_id on public.inventory_lots",
            "-- removed\n-- was: public.inventory_lots",
        ),
    )

    case(
        "adding a unit to SQL but not to TypeScript",
        1,
        lambda r: edit(
            r,
            LEDGER_MIGRATION,
            "check (uom::text = any (array[\n         'each'::text, 'bottle'::text, 'mg'::text, 'ml'::text\n       ]));",
            "check (uom::text = any (array[\n         'each'::text, 'bottle'::text, 'mg'::text, 'ml'::text, 'kg'::text\n       ]));",
        ),
    )

    case(
        "adding a unit to TypeScript but not to SQL",
        1,
        lambda r: edit(
            r,
            UNITS_TS,
            'LEDGER_UOMS = ["each", "bottle", "mg", "ml"]',
            'LEDGER_UOMS = ["each", "bottle", "mg", "ml", "kg"]',
        ),
    )

    case(
        "deleting the remainder-safe allocator",
        1,
        lambda r: edit(
            r, UNITS_TS, "export function allocateRemainderSafe", "function unusedAllocator"
        ),
    )

    case(
        "reintroducing a naive Math.round(qty / n) split",
        1,
        lambda r: edit(
            r,
            UNITS_TS,
            "export function allocateRemainderSafe(total: number, weights: number[]): number[] {",
            "export function allocateRemainderSafe(total: number, weights: number[]): number[] {\n"
            "  const qtyShare = Math.round(qtyTotal / weights.length);\n"
            "  void qtyShare;",
        ),
    )

    case(
        "rewriting FIFO depletion as something other than integer subtraction",
        1,
        lambda r: edit(
            r,
            LEDGER_MIGRATION,
            "v_remaining := v_remaining - v_lot.qty;",
            "v_remaining := round(v_remaining::numeric / 2)::int;",
        ),
    )

    case(
        "going back to DELETEing an emptied lot",
        1,
        lambda r: edit(
            r,
            LEDGER_MIGRATION,
            "UPDATE inventory_lots\n           SET qty = 0,\n"
            "               status = CASE WHEN open_bottle_ml > 0 THEN status ELSE 'depleted' END,\n"
            "               updated_at = now()\n         WHERE id = v_lot.id;",
            "DELETE FROM inventory_lots WHERE id = v_lot.id;",
        ),
    )

    case(
        "letting live_lot_count count depleted lots again",
        1,
        lambda r: edit(
            r,
            LEDGER_MIGRATION,
            "count(*) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (qty > 0))) AS live_lot_count",
            "count(*) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS live_lot_count",
        ),
    )

    case(
        "a LATER migration dropping the trigger the union search would miss",
        1,
        lambda r: (r / MIGRATIONS / "20261231000000_regression.sql").write_text(
            "drop trigger if exists trg_ledger_uom_from_item on public.inventory_lots;\n",
            encoding="utf-8",
        ),
    )

    case(
        "a LATER migration dropping a uom NOT NULL",
        1,
        lambda r: (r / MIGRATIONS / "20261231000000_regression.sql").write_text(
            "alter table public.inventory_lots alter column uom drop not null;\n",
            encoding="utf-8",
        ),
    )

    case(
        "a LATER migration that drops and immediately re-adds is NOT flagged",
        0,
        lambda r: (r / MIGRATIONS / "20261231000000_rewrite.sql").write_text(
            "alter table public.inventory_lots\n"
            "  drop constraint if exists inventory_lots_uom_check;\n"
            "alter table public.inventory_lots\n"
            "  add  constraint inventory_lots_uom_check check (uom is not null);\n",
            encoding="utf-8",
        ),
    )

    case(
        "reverting getTransactionSummary to a unit-blind sum",
        1,
        lambda r: _strip_uom_from_summary(r),
    )

    case(
        "the same rule present only inside a SQL comment",
        1,
        lambda r: _comment_out_fk(r),
    )

    case(
        "a missing ledger-units.ts",
        2,
        lambda r: (r / UNITS_TS).unlink(),
    )

    case(
        "a missing migrations directory",
        2,
        lambda r: shutil.rmtree(r / MIGRATIONS),
    )

    case(
        "a ledger-units.ts that no longer declares LEDGER_UOMS",
        2,
        lambda r: edit(r, UNITS_TS, "LEDGER_UOMS = [", "SOMETHING_ELSE = ["),
    )

    case(
        "a migration whose three unit CHECKs became two",
        2,
        lambda r: edit(
            r,
            LEDGER_MIGRATION,
            "add  constraint inventory_transactions_uom_check\n       check (uom::text = any (array[\n         'each'::text, 'bottle'::text, 'mg'::text, 'ml'::text\n       ]));",
            "add  constraint inventory_transactions_uom_check check (uom is not null);",
        ),
    )

    case(
        "a missing getTransactionSummary",
        2,
        lambda r: edit(
            r,
            f"{LEDGER_DIR}/inventory-ledger.service.ts",
            "getTransactionSummary",
            "getSummaryRenamed",
        ),
    )

    print("== --self-test: ledger unit contract")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   a compliant tree exits 0")
    print("   dropping inventory_lots.uom NOT NULL exits 1")
    print("   dropping the composite foreign key exits 1")
    print("   turning ON UPDATE RESTRICT into CASCADE exits 1")
    print("   dropping the fill-from-item trigger exits 1")
    print("   a unit added to SQL alone exits 1")
    print("   a unit added to TypeScript alone exits 1")
    print("   deleting allocateRemainderSafe exits 1")
    print("   a naive Math.round(qty / n) split exits 1")
    print("   FIFO depletion rewritten as a rounding division exits 1")
    print("   going back to DELETEing an emptied lot exits 1")
    print("   live_lot_count counting depleted lots again exits 1")
    print("   a LATER migration dropping the trigger or a NOT NULL exits 1")
    print("   a LATER migration that drops and re-adds in place exits 0")
    print("   a unit-blind getTransactionSummary exits 1")
    print("   a constraint present only inside a comment exits 1")
    print("   a missing file, a renamed anchor, or a lost CHECK exits 2")
    print("PASS")
    return 0


def _strip_uom_from_summary(root: Path) -> None:
    p = root / LEDGER_DIR / "inventory-ledger.service.ts"
    text = p.read_text(encoding="utf-8")
    head, _, tail = text.partition("getTransactionSummary")
    # Remove every mention of uom from the summary body so the guard sees the
    # pre-ADR-0070 unit-blind shape.
    p.write_text(head + "getTransactionSummary" + tail.replace("uom", "qtyKey"), encoding="utf-8")


def _comment_out_fk(root: Path) -> None:
    p = root / LEDGER_MIGRATION
    text = p.read_text(encoding="utf-8")
    old = (
        "       foreign key (inventory_id, uom)\n"
        "       references public.restaurant_inventory (id, canonical_uom)\n"
        "       on update restrict on delete cascade;"
    )
    if old not in text:
        raise AssertionError("self-test anchor missing: composite FK block")
    new = (
        "-- foreign key (inventory_id, uom)\n"
        "--        references public.restaurant_inventory (id, canonical_uom)\n"
        "--        on update restrict on delete cascade;"
    )
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description=(
            "A ledger quantity cannot be written without a unit, and a lot "
            "cannot disagree with its item's canonical unit."
        )
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the exit-code invariants against synthetic trees, then exit",
    )
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
