#!/usr/bin/env python3
"""An order writes a line, a unit default never multiplies, and price_history has a writer.

WHY THIS GUARD EXISTS
---------------------
Three defects shipped together and had the same shape: a table the design
depended on had no writer, or a fallback filled a gap with a confident guess.
Measured against production on 2026-09-01 — 2 procurement_orders, 1
procurement_order_items, 0 procurement_documents, 0 price_history — none of them
had yet produced a visible failure, which is exactly why they survived review.

  A. `createOrder` wrote a header and no line. `matchDocumentLines` returns early
     when an order has no lines (`document-intake.service.ts`), so the entire
     invoice line-matching engine was unreachable code.
  B. `bottles_total = dto.quantity` ignored `unit_type` (five CASES booked five
     bottles) and `normalizeUom(input.countedUom) ?? "case"` at the receiving
     door fell back to the one unit that MULTIPLIES (24 against a 12-pack booked
     288 bottles). Same wound, two ends.
  C. `price_history` was correctly designed, correctly indexed, and had ZERO
     writers repo-wide, so no price series could ever exist.

Each is a one-line regression: delete the line write, re-add a `?? "case"`, drop
the price insert. None of them breaks a test that existed before this change and
none of them is visible in production until months of data are already wrong. So
the fix is not done until something blocks the regression — the solve-it-once
rule (`memory/solve-it-once-means-add-a-guard`).

EXIT CODES
----------
  0  all three contracts hold
  1  a contract is broken — the message names which, and where
  2  CANNOT CHECK: a file this guard reads is missing or its shape changed so
     the guard can no longer see what it claims to. Never silently passes.

`--self-test` proves the exit-code invariants against synthetic trees, including
that each check actually FAILS on a tree carrying the corresponding pre-fix
defect. A guard that has never been shown to fire is not evidence.
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

GATEWAY_SRC = "apps/api-gateway/src"
PROCUREMENT = f"{GATEWAY_SRC}/procurement"
SERVICE = f"{PROCUREMENT}/procurement.service.ts"
RECEIVING = f"{PROCUREMENT}/receiving.service.ts"
MIGRATIONS = "supabase/migrations"

LINE_TABLE = "procurement_order_items"
PRICE_TABLE = "price_history"

# Units whose bottle count is quantity x pack size. A fallback to one of these
# is the defect: it turns "we do not know the unit" into a silent multiplication.
MULTIPLYING_UNITS = ("case", "cases", "pack", "packs", "split_case", "split_cases")

# `?? "case"`, `|| 'cases'`, `?? "pack"` — a nullish/or fallback landing on a
# multiplying unit. Written to match either quote style and any spacing.
MULTIPLYING_FALLBACK = re.compile(
    r"(?:\?\?|\|\|)\s*[\"']("
    + "|".join(re.escape(u) for u in MULTIPLYING_UNITS)
    + r")[\"']"
)

# A `.insert(` / `.upsert(` against a table, allowing the Supabase builder to be
# split across lines by the formatter.
def writer_re(table: str) -> re.Pattern[str]:
    return re.compile(
        r"""\.from\(\s*["']""" + re.escape(table) + r"""["']\s*\)"""
        r"""[\s\S]{0,400}?\.(?:insert|upsert)\(""",
    )


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


def read(root: Path, rel: str) -> str:
    p = root / rel
    if not p.is_file():
        raise CannotCheck(f"{rel} not found under {root}")
    try:
        return p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:  # pragma: no cover - defensive
        raise CannotCheck(f"{rel} is unreadable: {e}") from e


def ts_sources(root: Path, rel_dir: str) -> list[tuple[str, str]]:
    base = root / rel_dir
    if not base.is_dir():
        raise CannotCheck(f"{rel_dir} is not a directory under {root}")
    out: list[tuple[str, str]] = []
    for p in sorted(base.rglob("*.ts")):
        if p.name.endswith(".spec.ts"):
            continue
        try:
            out.append((str(p.relative_to(root)), p.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError) as e:  # pragma: no cover
            raise CannotCheck(f"{p} is unreadable: {e}") from e
    if not out:
        raise CannotCheck(f"{rel_dir} contains no non-spec .ts files")
    return out


def strip_comments(src: str) -> str:
    """Blank out comments, preserving line count and string literals.

    Written as a state machine rather than a regex because the first draft used
    `line.split("//")[0]` and immediately reported this very guard's own prose —
    a JSDoc paragraph describing the `?? "case"` defect — as the defect. A guard
    that fires on the sentence explaining the bug makes the bug undocumentable.
    """
    out: list[str] = []
    i, n = 0, len(src)
    quote: str | None = None
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "\"'`":
            quote = c
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                out.append("\n" if src[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def method_body(src: str, name: str, rel: str) -> str:
    """The text of one class method, by brace matching from its signature.

    The parameter list is balanced FIRST. Taking the first `{` after the name
    would land inside an inline object parameter type — `provenance?: { source:
    OrderSource }` — and return that type literal as the whole method body, which
    is how the first draft of this guard reported a correct createOrder as broken.
    """
    m = re.search(
        r"^\s*(?:(?:private|public|protected|static|async)\s+)*"
        + re.escape(name)
        + r"\s*\(",
        src,
        re.M,
    )
    if not m:
        raise CannotCheck(
            f"{rel}: method {name}() not found — the shape this guard reads has changed"
        )

    open_paren = src.index("(", m.end() - 1)
    depth = 0
    close_paren = -1
    for j in range(open_paren, len(src)):
        if src[j] == "(":
            depth += 1
        elif src[j] == ")":
            depth -= 1
            if depth == 0:
                close_paren = j
                break
    if close_paren < 0:
        raise CannotCheck(f"{rel}: {name}()'s parameter list is unbalanced")

    i = src.find("{", close_paren)
    if i < 0:
        raise CannotCheck(f"{rel}: {name}() has no body")
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                body = src[i : j + 1]
                if len(body) < 40:
                    raise CannotCheck(
                        f"{rel}: {name}()'s body came out as {len(body)} characters "
                        f"({body!r}) — the brace matching landed somewhere it should not"
                    )
                return body
    raise CannotCheck(f"{rel}: {name}() has no matching closing brace")


# ---------------------------------------------------------------------------
# Contract A — an order cannot be created without a line row.
# ---------------------------------------------------------------------------
def check_order_writes_a_line(root: Path) -> list[str]:
    # Comments stripped throughout: this file's own prose names the tables and
    # the columns at length, and a guard that counted documentation as code
    # would be satisfied by a comment describing a write that no longer happens.
    src = strip_comments(read(root, SERVICE))
    bad: list[str] = []

    if not writer_re(LINE_TABLE).search(src):
        bad.append(
            f"{SERVICE} contains no insert into {LINE_TABLE}. An order with no line "
            f"is invisible to matchDocumentLines, which returns early when an order "
            f"has no lines — the whole invoice matching engine goes dark."
        )
        return bad

    body = method_body(src, "createOrder", SERVICE)
    # Both exits from createOrder must write a line: the dedup/merge path that
    # updates an existing open order, and the insert path.
    calls = len(re.findall(r"\bthis\.upsertOrderLine\(", body))
    if calls < 2:
        bad.append(
            f"{SERVICE}: createOrder() calls this.upsertOrderLine() {calls} time(s); "
            f"expected 2 — the merge path and the insert path both end in an order "
            f"that must carry a line. A merge that skipped it would leave the header "
            f"and the line disagreeing, and the matcher reads the line."
        )

    writer_body = method_body(src, "upsertOrderLine", SERVICE)
    if not writer_re(LINE_TABLE).search(writer_body):
        bad.append(
            f"{SERVICE}: upsertOrderLine() no longer inserts into {LINE_TABLE}."
        )
    if "master_wine_id" not in writer_body:
        bad.append(
            f"{SERVICE}: upsertOrderLine() no longer sets master_wine_id. "
            f"inventory_id is this restaurant's shelf slot; master_wine_id is the "
            f"wine, and it is the only identity an invoice can be matched on."
        )
    if re.search(r"\btotal_bottles\s*:", writer_body):
        bad.append(
            f"{SERVICE}: upsertOrderLine() writes total_bottles, which is GENERATED "
            f"ALWAYS AS (quantity * bottles_per_unit). Postgres raises 428C9 and the "
            f"order fails."
        )
    return bad


# ---------------------------------------------------------------------------
# Contract B — no unit default silently multiplies.
# ---------------------------------------------------------------------------
def check_no_multiplying_default(root: Path) -> list[str]:
    bad: list[str] = []

    for rel, src in ts_sources(root, PROCUREMENT):
        for n, line in enumerate(strip_comments(src).splitlines(), 1):
            m = MULTIPLYING_FALLBACK.search(line)
            if m:
                bad.append(
                    f"{rel}:{n} falls back to the multiplying unit {m.group(1)!r} "
                    f"({line.strip()[:90]!r}). An absent or misspelt unit then books "
                    f"quantity x pack size: 24 counted against a 12-pack becomes 288 "
                    f"bottles of live stock, silently. Refuse instead (ADR 0011)."
                )

    # The door must fail closed rather than resolve to anything at all.
    recv = strip_comments(read(root, RECEIVING))
    door = method_body(recv, "recordDoorReceipt", RECEIVING)
    if not re.search(r"normalizeUom\(", door):
        bad.append(
            f"{RECEIVING}: recordDoorReceipt() no longer normalises the counted "
            f"unit through normalizeUom()."
        )
    elif not re.search(r"BadRequestException|throw ", door):
        bad.append(
            f"{RECEIVING}: recordDoorReceipt() normalises the unit but never "
            f"refuses one it cannot read. normalizeUom returns null rather than "
            f"guessing; something has to act on that null."
        )

    # The database half of the pair. Code that emits a canonical unit is only
    # half a contract if the column still accepts anything.
    mig_dir = root / MIGRATIONS
    if not mig_dir.is_dir():
        raise CannotCheck(f"{MIGRATIONS} is not a directory under {root}")
    all_sql = "\n".join(
        p.read_text(encoding="utf-8", errors="replace")
        for p in sorted(mig_dir.glob("*.sql"))
    )
    if not all_sql.strip():
        raise CannotCheck(f"{MIGRATIONS} contains no readable .sql")
    if not re.search(
        r"procurement_orders_unit_type_check", all_sql
    ):
        bad.append(
            f"{MIGRATIONS}: no CHECK constraint named procurement_orders_unit_type_check. "
            f"procurement_document_lines.uom has one and procurement_orders.unit_type "
            f"must too, or the column accepts a plural nothing reads and a typo "
            f"nothing converts."
        )
    return bad


# ---------------------------------------------------------------------------
# Contract C — price_history has at least one writer.
# ---------------------------------------------------------------------------
def check_price_history_has_a_writer(root: Path) -> list[str]:
    pattern = writer_re(PRICE_TABLE)
    for rel, src in ts_sources(root, GATEWAY_SRC):
        # Cheap raw pass first; only pay for comment-stripping on a hit, so a
        # commented-out writer cannot satisfy the contract.
        if pattern.search(src) and pattern.search(strip_comments(src)):
            return []
    return [
        f"nothing under {GATEWAY_SRC} inserts into {PRICE_TABLE}. The table is keyed "
        f"(restaurant, master wine, provider, price, effective_date, source, order) "
        f"and indexed on (master_wine_id, provider_id, effective_date DESC) — with no "
        f"writer it stays empty forever and no price series can exist for any wine "
        f"from any vendor."
    ]


CHECKS = (
    ("order line capture", check_order_writes_a_line),
    ("unit defaults", check_no_multiplying_default),
    ("price_history writer", check_price_history_has_a_writer),
)


def run(root: Path) -> tuple[int, list[str]]:
    findings: list[str] = []
    for label, fn in CHECKS:
        for f in fn(root):
            findings.append(f"[{label}] {f}")
    return (1 if findings else 0), findings


def main() -> int:
    try:
        code, findings = run(ROOT)
    except CannotCheck as e:
        print(f"CANNOT CHECK -- {e}")
        return 2
    if findings:
        print(f"FAIL -- {len(findings)} broken capture contract(s):")
        for f in findings:
            print(f"  - {f}")
        return 1
    print(
        "PASS -- an order writes its line, no unit default multiplies, "
        "price_history has a writer."
    )
    return 0


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
def _fixture(tmp: Path) -> Path:
    """A minimal tree that satisfies all three contracts."""
    root = tmp / "tree"
    (root / PROCUREMENT).mkdir(parents=True)
    (root / MIGRATIONS).mkdir(parents=True)

    (root / SERVICE).write_text(
        """
export class ProcurementService {
  /**
   * Doc prose that names `procurement_order_items` and `price_history` and even
   * the old `?? "case"` fallback, none of which may count as code.
   */
  async createOrder(
    a: string,
    b: string,
    c: any,
    provenance?: { source: string; recurringOrderId?: string | null },
  ): Promise<any> {
    if (existing) {
      await this.upsertOrderLine({ orderId: existing.id });
      return merged;
    }
    await this.databaseService.supabase.from("procurement_orders").insert(payload);
    await this.upsertOrderLine({ orderId: order.id });
    return order;
  }

  private async upsertOrderLine(args: {
    restaurantId: string;
    orderId: string;
  }): Promise<void> {
    const line = { master_wine_id: id, bottles_per_unit: 12 };
    await this.databaseService.supabase
      .from("procurement_order_items")
      .insert(line);
  }

  private async recordPriceHistory(args: any) {
    await this.databaseService.supabase.from("price_history").insert({ price: 1 });
  }
}
""",
        encoding="utf-8",
    )
    (root / RECEIVING).write_text(
        """
export class ReceivingService {
  async recordDoorReceipt(input: any) {
    const uom = normalizeUom(input.countedUom);
    if (!uom) throw new BadRequestException("state the unit");
    return uom;
  }
}
""",
        encoding="utf-8",
    )
    (root / MIGRATIONS / "20260901150000_units.sql").write_text(
        "alter table public.procurement_orders "
        "add constraint procurement_orders_unit_type_check check (true);\n",
        encoding="utf-8",
    )
    return root


def self_test() -> int:
    failures: list[str] = []

    def expect(label: str, got: int, want: int) -> None:
        if got != want:
            failures.append(f"{label}: exit {got}, expected {want}")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        root = _fixture(tmp)

        code, findings = run(root)
        expect("clean tree", code, 0)
        if findings:
            failures.append(f"clean tree reported: {findings}")

        # A. the line write deleted — the exact pre-fix state of createOrder.
        svc = (root / SERVICE).read_text(encoding="utf-8")
        (root / SERVICE).write_text(
            svc.replace('.from("procurement_order_items")\n      .insert(line);', "// gone"),
            encoding="utf-8",
        )
        expect("line writer removed", run(root)[0], 1)

        # A2. the merge path stops writing a line — half a fix.
        (root / SERVICE).write_text(
            svc.replace("await this.upsertOrderLine({ orderId: existing.id });", ""),
            encoding="utf-8",
        )
        expect("merge path skips the line", run(root)[0], 1)

        # A3. writing the GENERATED column.
        (root / SERVICE).write_text(
            svc.replace("bottles_per_unit: 12", "total_bottles: 60"), encoding="utf-8"
        )
        expect("writes the generated column", run(root)[0], 1)
        (root / SERVICE).write_text(svc, encoding="utf-8")

        # B. the multiplying fallback, restored exactly as it was pre-fix.
        recv = (root / RECEIVING).read_text(encoding="utf-8")
        (root / RECEIVING).write_text(
            recv.replace(
                "const uom = normalizeUom(input.countedUom);\n"
                '    if (!uom) throw new BadRequestException("state the unit");',
                'const uom = normalizeUom(input.countedUom) ?? "case";',
            ),
            encoding="utf-8",
        )
        expect("multiplying fallback", run(root)[0], 1)

        # B2. the same fallback inside a comment is NOT a finding — a guard that
        # fires on prose describing the bug makes the prose unwritable. Both
        # comment forms, because the first draft used `line.split("//")[0]` and
        # therefore reported a JSDoc block as live code.
        (root / RECEIVING).write_text(
            recv.replace(
                "  async recordDoorReceipt",
                '  // This was `normalizeUom(x) ?? "case"`, which multiplies.\n'
                "  /**\n"
                '   * And this block also says `?? "case"` and `|| \'cases\'`.\n'
                "   */\n"
                "  async recordDoorReceipt",
            ),
            encoding="utf-8",
        )
        code, findings = run(root)
        expect("comment describing the defect", code, 0)
        if findings:
            failures.append(f"comment flagged as code: {findings}")

        # B2b. a string literal that merely CONTAINS the words is not a fallback.
        (root / RECEIVING).write_text(
            recv.replace(
                "    return uom;",
                '    const help = "use bottle or case";\n    return uom + help;',
            ),
            encoding="utf-8",
        )
        code, findings = run(root)
        expect("unit names inside a message string", code, 0)
        if findings:
            failures.append(f"message string flagged: {findings}")

        # B3. normalising but never refusing.
        (root / RECEIVING).write_text(
            "export class ReceivingService {\n"
            "  async recordDoorReceipt(input: any) {\n"
            "    const uom = normalizeUom(input.countedUom) || fallback;\n"
            "    return uom;\n"
            "  }\n"
            "}\n",
            encoding="utf-8",
        )
        expect("normalises but never refuses", run(root)[0], 1)
        (root / RECEIVING).write_text(recv, encoding="utf-8")

        # B4. the CHECK constraint missing from every migration.
        mig = root / MIGRATIONS / "20260901150000_units.sql"
        sql = mig.read_text(encoding="utf-8")
        mig.write_text("-- nothing\n", encoding="utf-8")
        expect("no unit_type CHECK", run(root)[0], 1)
        mig.write_text(sql, encoding="utf-8")

        # C. price_history loses its only writer.
        (root / SERVICE).write_text(
            svc.replace('.from("price_history").insert({ price: 1 })', "noop()"),
            encoding="utf-8",
        )
        expect("price_history has no writer", run(root)[0], 1)
        (root / SERVICE).write_text(svc, encoding="utf-8")

        # CANNOT CHECK, not PASS: every way the guard can go blind. Each runs
        # against its own fresh tree so one mutation cannot mask the next.
        def blind(label: str, mutate) -> None:
            blind_root = _fixture(Path(tempfile.mkdtemp(dir=td)))
            mutate(blind_root)
            try:
                run(blind_root)
            except CannotCheck:
                return
            failures.append(f"{label}: did not raise CannotCheck")

        blind("service file missing", lambda r: (r / SERVICE).unlink())
        blind(
            "createOrder renamed away",
            lambda r: (r / SERVICE).write_text(
                (r / SERVICE).read_text(encoding="utf-8").replace(
                    "async createOrder", "async placeOrder"
                ),
                encoding="utf-8",
            ),
        )
        blind(
            "upsertOrderLine renamed away",
            lambda r: (r / SERVICE).write_text(
                (r / SERVICE).read_text(encoding="utf-8").replace(
                    "private async upsertOrderLine", "private async writeLine"
                ),
                encoding="utf-8",
            ),
        )
        blind(
            "migrations directory gone",
            lambda r: (
                [p.unlink() for p in (r / MIGRATIONS).glob("*.sql")],
                (r / MIGRATIONS).rmdir(),
            ),
        )
        blind(
            "procurement directory emptied of source",
            lambda r: [
                p.unlink() for p in (r / PROCUREMENT).rglob("*.ts")
            ],
        )

    print("== --self-test: order capture contract")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   a compliant tree exits 0")
    print("   deleting the line insert exits 1")
    print("   a merge path that skips the line exits 1")
    print("   writing the GENERATED total_bottles column exits 1")
    print('   restoring `normalizeUom(x) ?? "case"` exits 1')
    print("   the same text inside a // or /** */ comment does NOT fire")
    print("   the unit names inside a message string do NOT fire")
    print("   an inline object parameter type does not truncate the method body")
    print("   normalising the unit but never refusing one exits 1")
    print("   dropping the procurement_orders unit_type CHECK exits 1")
    print("   removing price_history's only writer exits 1")
    print("   a missing file, a renamed method, or a missing migrations dir exits 2")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description=(
            "An order writes a line, no unit default multiplies, "
            "and price_history has a writer."
        )
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the exit-code invariants against synthetic trees, then exit",
    )
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
