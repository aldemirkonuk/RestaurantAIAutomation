#!/usr/bin/env python3
"""Every Reading the bound ask can run has both of ADR 0145 build task 4's tests.

ADR 0145 (Locked 2026-09-12), build task 4: "The first N readings, each with
two tests -- one against a fixture DB with known rows asserting the figure
equals the value computed from those rows, one forcing a query error and
asserting the reply is `could_not_read` and never `not_in_your_books`." R5
made a non-zero list of such readings a condition of shipping `/ask` at all.

The bound ask (`bound-ask.service.ts`) runs exactly the Readings declared in
`reading-catalogue.ts` DECLARED, through `ReadingRunner`, and nothing else. So
the floor is: every declared Reading has a row in `reading-runner.spec.ts`'s
`known` table (a figure, the key it lives under, and a source to break), the
two `test.each(known)` blocks that turn each row into those two tests exist
and assert what task 4 says, and the per-source block (2026-09-25) that
breaks EVERY relation a Reading reads -- and requires those to be exactly its
declared shelves -- is still there.

Findings, each a token the self-test mutates for:

  MISSING FIGURE    a declared Reading with no `known` row.
  EXTRA FIGURE      a `known` row naming no declared Reading.
  DUPLICATE FIGURE  a Reading with two `known` rows.
  OFF-SHELF         a `known` row whose forced-error table is not one of the
                    Reading's declared `shelves`.
  NO FIGURE TEST    the `test.each(known)` block that asserts outcome "read"
                    and the known value is missing or no longer asserts both.
  NO ERROR TEST     the `test.each(known)` block that breaks the row's table
                    and asserts "could_not_read" is missing, no longer breaks
                    the table, or mentions "not_in_your_books".
  NO SOURCE MATRIX  the per-source block (every relation read, forced to
                    fail, `could_not_read`, union equal to the shelves) is
                    missing or lost one of those assertions.
  NO COVERAGE TEST  the test that the `known` ids equal the catalogue's ids.

This is the static half. Jest is the dynamic half: the tests themselves run
in "Test TypeScript". The guard exists because a jest suite cannot see its own
test being deleted (a removed `test.each` is a smaller green run).

Exit 0 pass, 1 a finding, 2 cannot check (a file or a shape this guard reads
is missing -- never reported as a pass). `--self-test` mutates in memory and
requires every mutation to be caught.

Run by `scripts/check_ask_field_classes.py` (both modes), which CI already
runs, and by a CLAIMS.jsonl row.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
READINGS = ROOT / "apps/api-gateway/src/ask-readings"
CATALOGUE_TS = READINGS / "reading-catalogue.ts"
SPEC_TS = READINGS / "reading-runner.spec.ts"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_ask_field_classes import CannotCheck, _block, parse_catalogue  # noqa: E402

KNOWN_ANCHOR = "const known: Array<[ReadingId, string, number, string]> ="
KNOWN_ROW = re.compile(r'\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(-?[\d.]+|null)\s*,\s*"([^"]+)"\s*\]')
MATRIX_ANCHOR = 'describe("ADR 0145 build task 4, per source'
COVERAGE = "expect(new Set(known.map(k => k[0]))).toEqual(new Set(READING_CATALOGUE.map(r => r.id)));"


def parse_known(spec: str) -> list[tuple[str, str, str, str]]:
    body = _block(spec, KNOWN_ANCHOR, "[", "]")
    # _block returns the outer array including nested rows; drop the outer brackets.
    inner = body[1:-1] if body.startswith("[") else body
    rows = KNOWN_ROW.findall(inner)
    leftovers = KNOWN_ROW.sub("", inner)
    leftovers = re.sub(r"//[^\n]*", "", leftovers)
    if re.search(r"[\[\]\"]", leftovers):
        raise CannotCheck(
            "the `known` table holds a row this guard cannot read: "
            + leftovers.strip()[:80]
        )
    if not rows:
        raise CannotCheck("no rows parsed from the `known` table")
    return rows


def _each_known_blocks(spec: str) -> list[str]:
    """The source of every `test.each(known)(...)` call, balanced."""
    out = []
    for m in re.finditer(r"test\.each\(known\)\(", spec):
        out.append(_block(spec[m.start() + len("test.each(known)") :], "", "(", ")"))
    return out


def check(catalogue_src: str, spec_src: str) -> list[str]:
    readings = parse_catalogue(catalogue_src)
    rows = parse_known(spec_src)
    failures: list[str] = []

    seen: dict[str, int] = {}
    for rid, _key, _value, table in rows:
        seen[rid] = seen.get(rid, 0) + 1
        if rid not in readings:
            failures.append(f"EXTRA FIGURE {rid}: a `known` row for no declared Reading")
            continue
        if table not in readings[rid]["shelves"]:
            failures.append(
                f"OFF-SHELF {rid}: forced-error table {table} is not one of its shelves {readings[rid]['shelves']}"
            )
    for rid, n in seen.items():
        if n > 1:
            failures.append(f"DUPLICATE FIGURE {rid}: {n} `known` rows")
    for rid in readings:
        if rid not in seen:
            failures.append(
                f"MISSING FIGURE {rid}: no `known` row -- no fixture-figure test and no forced-error test"
            )

    blocks = _each_known_blocks(spec_src)
    figure = [
        b
        for b in blocks
        if 'expect(finding.outcome).toBe("read")' in b
        and "expect(value(finding, key)).toBe(expected)" in b
    ]
    error = [
        b
        for b in blocks
        if "books.fail.add(table)" in b
        and 'expect(finding.outcome).toBe("could_not_read")' in b
        and "expect(finding.failedSources).toContain(table)" in b
        and "not_in_your_books" not in b
    ]
    if not figure:
        failures.append(
            'NO FIGURE TEST: no `test.each(known)` asserts outcome "read" and the known value'
        )
    if not error:
        failures.append(
            'NO ERROR TEST: no `test.each(known)` breaks the row\'s table and asserts "could_not_read"'
        )

    if MATRIX_ANCHOR not in spec_src:
        failures.append("NO SOURCE MATRIX: the per-source describe block is gone")
    else:
        matrix = _block(spec_src[spec_src.find(MATRIX_ANCHOR) :], "describe", "(", ")")
        for needle in (
            "test.each(READING_CATALOGUE.map(",
            "for (const make of [fixture, richFixture])",
            "books.fail.add(table)",
            'outcome: "could_not_read"',
            "expect(finding.failedSources).toContain(table)",
            ".shelves].sort()",
        ):
            if needle not in matrix:
                failures.append(f"NO SOURCE MATRIX: the per-source block lost `{needle}`")

    if COVERAGE not in spec_src:
        failures.append(
            "NO COVERAGE TEST: the test that the `known` ids equal the catalogue's ids is gone"
        )
    return failures


def run() -> int:
    try:
        failures = check(CATALOGUE_TS.read_text(), SPEC_TS.read_text())
    except (OSError, CannotCheck) as e:
        print(f"CANNOT CHECK -- {e}")
        return 2
    if failures:
        print("FAIL -- a Reading the bound ask can run lacks one of ADR 0145 build task 4's tests:")
        for f in failures:
            print(f"  - {f}")
        return 1
    n = len(parse_catalogue(CATALOGUE_TS.read_text()))
    print(
        f"PASS -- all {n} declared Readings have a fixture figure and a forced source error; the per-source matrix holds."
    )
    return 0


def self_test() -> int:
    try:
        base = [CATALOGUE_TS.read_text(), SPEC_TS.read_text()]
        real = check(*base)
    except (OSError, CannotCheck) as e:
        print(f"CANNOT CHECK -- {e}")
        return 2
    if real:
        print("SELF-TEST CANNOT RUN -- the real tree does not pass:", real)
        return 1

    def mut(i: int, old: str, new: str) -> list[str]:
        srcs = list(base)
        if old not in srcs[i]:
            raise CannotCheck(f"self-test anchor missing: {old[:60]}")
        srcs[i] = srcs[i].replace(old, new, 1)
        return srcs

    new_reading = (
        '  { id: "stock.aging", version: 1, title: "t", question: "q", subject: "none", window: false, '
        'shelves: ["inventory_lots"], meaning: "m", shows: ["inventory_lots.*"] },\n];'
    )
    cases = [
        (
            "a known row deleted",
            mut(1, '  ["goals.targets", "goal-a:target_value", 40, "analytics_goals"],\n', ""),
            "MISSING FIGURE",
        ),
        (
            "a new Reading declared with no fixture",
            mut(0, "\n];\n\n/** Every field a Reading can show", "\n" + new_reading + "\n\n/** Every field a Reading can show"),
            "MISSING FIGURE",
        ),
        (
            "a forced error aimed at a table the Reading never reads",
            mut(1, '["vendors.active", "vendors:count", 2, "providers"]', '["vendors.active", "vendors:count", 2, "pos_checks"]'),
            "OFF-SHELF",
        ),
        (
            "a Reading given two rows",
            mut(
                1,
                '  ["orders.due_today", "deliveries:count", 1, "procurement_orders"],\n',
                '  ["orders.due_today", "deliveries:count", 1, "procurement_orders"],\n  ["orders.due_today", "deliveries:count", 1, "procurement_orders"],\n',
            ),
            "DUPLICATE FIGURE",
        ),
        (
            "the figure assertion dropped",
            mut(1, "    expect(value(finding, key)).toBe(expected);\n", ""),
            "NO FIGURE TEST",
        ),
        (
            "the forced error no longer breaks the table",
            mut(1, "const books = fixture(); books.fail.add(table);\n    const finding = await run(books, id, id ===", "const books = fixture();\n    const finding = await run(books, id, id ==="),
            "NO ERROR TEST",
        ),
        (
            "a forced error accepted as an empty register",
            mut(
                1,
                '    expect(finding.outcome).toBe("could_not_read");\n    expect(finding.failedSources).toContain(table);\n    expect(finding.rows).toEqual([]);\n    expect(finding.rowsScanned).toBeNull();\n  });\n});',
                '    expect(finding.outcome).toBe("could_not_read");\n    expect(finding.failedSources).toContain(table);\n    expect(["could_not_read", "not_in_your_books"]).toContain(finding.outcome);\n    expect(finding.rows).toEqual([]);\n    expect(finding.rowsScanned).toBeNull();\n  });\n});',
            ),
            "NO ERROR TEST",
        ),
        (
            "the per-source block deleted",
            mut(1, MATRIX_ANCHOR, 'describe("some other block'),
            "NO SOURCE MATRIX",
        ),
        (
            "the per-source block stops walking the branches",
            mut(1, "for (const make of [fixture, richFixture])", "for (const make of [fixture])"),
            "NO SOURCE MATRIX",
        ),
        (
            "the per-source block no longer ties what it broke to the shelves",
            mut(1, ".shelves].sort()", ".shelves]"),
            "NO SOURCE MATRIX",
        ),
        (
            "the coverage test deleted",
            mut(1, COVERAGE, ""),
            "NO COVERAGE TEST",
        ),
    ]
    missed = []
    for name, srcs, token in cases:
        try:
            got = check(*srcs)
        except CannotCheck as e:
            got = [f"CANNOT {e}"]
        hit = any(g.startswith(token) for g in got)
        print(f"  {'caught' if hit else 'MISSED'}: {name}")
        if not hit:
            missed.append(name)
    if missed:
        print(f"SELF-TEST FAIL -- {len(missed)} mutation(s) not caught")
        return 1
    print(f"SELF-TEST PASS -- {len(cases)} mutations, all caught")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--self-test"]:
        sys.exit(self_test())
    if args:
        print("usage: check_ask_readings_have_fixtures.py [--self-test]")
        sys.exit(2)
    sys.exit(run())
