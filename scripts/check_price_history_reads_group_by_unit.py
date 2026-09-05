#!/usr/bin/env python3
"""Guard: nothing reads `price_history` without saying which unit it means.

WHY THIS EXISTS
---------------
ADR 0119 Q4 (founder, 2026-09-05): *`price_history` carries a stated unit; kegs
and cases enter with their own unit; every comparison groups by unit first.*
The migration `20260905072500_the_price_series_states_its_unit.sql` made
`unit` NOT NULL with a seven-singular vocabulary CHECK and dropped its
`DEFAULT 'BOTTLE'`, and `recordPriceHistory` in
`apps/api-gateway/src/procurement/procurement.service.ts` writes it.

The half of that decision a CHECK constraint cannot enforce is the READ half.
Once a case price and a bottle price sit in the same table, a
`select("price").eq("inventory_id", …)` followed by a mean is wrong by the pack
size -- always in the direction that looks like a bargain, and never with an
error attached. That is `absence-reported-as-health`, class "writes-bad-data":
the query succeeds, the number is confident, and nothing anywhere says the two
rows were counted in different things.

So the rule lands as a guard NOW, while the cost of landing it is zero. Measured
on this tree with

    grep -rn "price_history" apps services --include='*.ts' --include='*.tsx' \
        --include='*.py' --include='*.sql' | grep -v /dist/

there is exactly ONE writer and ZERO readers. The Python agent's
`_get_price_history` reads `procurement_orders.price_per_bottle` -- a different
table that merely shares the phrase. A guard written against zero readers is
not idle: it is the only moment at which the rule can be free, and it exists so
the FIRST future reader that forgets to group by unit fails CI instead of
silently averaging a case price with a bottle price.

WHAT COUNTS AS A READ
---------------------
  * a supabase-js chain `.from("price_history")` … `.select(` (TS/TSX)
  * a supabase-py chain `.table("price_history")` … `.select(` (orchestrator)
  * raw SQL in either language: a `select` … `from price_history`
    (or `join price_history`), inside a string literal or a `.sql` file

THE SECOND ARM: GROUPING BY IDENTITY IS NOT A SUBSTITUTE FOR UNIT
-----------------------------------------------------------------
ADR 0124 Q5 (founder, 2026-09-05: *"Yes, identity_id on price_history now."*)
added a nullable `identity_id` to this table
(`20260906060000_a_price_names_the_bottle_it_priced.sql`) so the house's own
ledger keys on the same trade item the ladder does. That makes a NEW way to get
the original defect: group by `identity_id` alone and average.

It looks safe, and it is not. An identity fixes WHAT THE BOTTLE IS; a unit fixes
WHAT THE NUMBER COUNTS. One identity can be bought by the bottle in March and by
the case in April, and those two rows are both honest, both correctly identified,
and not addable. Grouping by identity without unit is therefore the SAME fault as
grouping by nothing -- it just looks like diligence while it happens.

So a read whose grouping key names `identity_id` and never names `unit` is exit
1, not exit 2: unlike the general aggregation case, the key IS visible here, and
it is visibly insufficient.

WHAT MAKES A READ COMPLIANT
---------------------------
  * it filters on the unit: `.eq("unit", …)`, `.in("unit", …)`, `.in_("unit", …)`,
    `.filter("unit", …)`, or a `where` clause naming `unit` in SQL; or
  * it groups by it: `group by … unit` in SQL; or
  * the TypeScript/Python that follows aggregates KEYED BY unit -- a key
    expression that names `unit` within the trailing window.

WHAT IT CANNOT SEE, AND SAYS SO
-------------------------------
An aggregation whose key this parser cannot follow is exit 2, never exit 0 and
never exit 1. If the trailing window contains aggregation vocabulary
(`reduce`, `groupBy`, `Map(`, `sum`, `avg`, `average`, `mean`) but no `unit`
anywhere in it, the guard does not know whether the grouping key is `unit`
reached through a variable, so it refuses. Calling that a PASS would reproduce
this file's own bug class one level up; calling it a FAIL would be a claim the
parse cannot support.

Two further limits, stated rather than hidden:
  * a read assembled at runtime (the table name in a variable) is invisible to
    a static parse. The NEVER-VACUOUS check below is the only defence: if the
    literal string `price_history` disappears from the roots entirely, that is
    exit 2, not a clean tree.
  * the trailing window is a fixed character count, so an aggregation written
    far below its query is judged as "no aggregation" -- i.e. FAIL, the safe
    direction.

EXIT CODES
    0  PASS -- every read of price_history states its unit (counts printed,
       including "0 readers today")
    1  FAIL -- a read neither filters on unit nor groups by it (file:line)
    2  CANNOT CHECK -- never 0. A root is missing, the table name has vanished
       from the tree, or an aggregation cannot be followed.
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

TABLE = "price_history"

# Every root a read could live in. A missing one is exit 2: a guard that
# silently stops looking at the orchestrator is worse than no guard.
READ_ROOTS = [
    "apps/api-gateway/src",
    "apps/web/src",
    "apps/mobile",
    "services/agent-orchestrator",
]

SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".py", ".sql"}

# Build output and dependencies are not source; a compiled copy of a read is
# the same read counted twice.
SKIP_DIRS = {"node_modules", "dist", "build", ".next", "__pycache__", ".venv", "venv"}

# How far past the `.select(` to look for an aggregation. Measured against the
# repo's own longest procurement chains (~600 chars in the sibling guard's
# SELECT_SITE_RE); doubled here because the aggregation is AFTER the await, not
# inside the chain.
TRAILING_WINDOW = 1200

# The chain window itself, same shape and size as check_read_columns_exist.py's
# SELECT_SITE_RE so the two guards agree on where a statement ends.
CHAIN_WINDOW = 600


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


# ---------------------------------------------------------------------------
# Comment stripping. Shared with the sibling guard BY PATH so there is exactly
# one comment stripper in the repo (the idiom `check_read_columns_exist.py`
# established). If that file is gone, this one refuses rather than scanning
# commented-out code as if it were live.
# ---------------------------------------------------------------------------
def _strip_comments(root: Path, text: str, suffix: str) -> str:
    if suffix == ".py":
        # `#` to end of line, but not inside a string literal. Handled by the
        # same conservative rule the SQL branch uses: drop a `#` only when the
        # quote counts before it are balanced.
        out = []
        for line in text.split("\n"):
            idx = line.find("#")
            while idx != -1:
                head = line[:idx]
                if head.count('"') % 2 == 0 and head.count("'") % 2 == 0:
                    line = head
                    break
                idx = line.find("#", idx + 1)
            out.append(line)
        return "\n".join(out)
    if suffix == ".sql":
        return re.sub(r"--[^\n]*", "", text)
    path = root / "scripts" / "check_read_columns_exist.py"
    if not path.is_file():
        raise CannotCheck(
            f"{path} is missing; its comment stripper is this guard's only defence "
            f"against reading a commented-out query as a live one."
        )
    import importlib.util

    spec = importlib.util.spec_from_file_location("_crce_shared", path)
    if spec is None or spec.loader is None:
        raise CannotCheck(f"{path} could not be loaded as a module.")
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except SystemExit as e:  # a stray module-level exit must not become ours
        raise CannotCheck(f"{path} exited during import with status {e.code}.")
    except Exception as e:
        raise CannotCheck(f"{path} raised during import: {e}")
    try:
        shared = mod._load_shared(root)
    except Exception as e:
        raise CannotCheck(f"the shared comment stripper would not load: {e}")
    if not hasattr(shared, "strip_comments"):
        raise CannotCheck("the shared parse no longer exports strip_comments.")
    return shared.strip_comments(text)


# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------
# A builder chain naming the table, captured up to the end of the statement.
CHAIN_RE = re.compile(
    r"""\.(?:from|table)\(\s*["']""" + TABLE + r"""["']\s*\)"""
    r"""((?:(?!\.(?:from|table)\(|;)[\s\S]){0,%d})""" % CHAIN_WINDOW
)
SELECT_IN_CHAIN_RE = re.compile(r"\.select\(")

# A unit filter, in either client's spelling. `in_` is supabase-py.
UNIT_FILTER_RE = re.compile(
    r"""\.(?:eq|in|in_|filter|neq|is|match)\(\s*["']unit["']"""
)
# `.match({ unit: … })` and `.eq(UNIT_COL, …)` are NOT matched above on purpose:
# a filter whose column is a runtime value is exactly the aggregation case --
# it goes to the unfollowable branch rather than being credited.

# Raw SQL that selects from the table.
SQL_READ_RE = re.compile(
    r"""\bselect\b[\s\S]{0,800}?\b(?:from|join)\s+(?:public\.)?""" + TABLE + r"""\b""",
    re.IGNORECASE,
)
SQL_UNIT_WHERE_RE = re.compile(r"\bwhere\b[\s\S]{0,400}?\bunit\b", re.IGNORECASE)
SQL_GROUP_BY_UNIT_RE = re.compile(r"\bgroup\s+by\b[^;]{0,200}?\bunit\b", re.IGNORECASE)

# Aggregation vocabulary in the code that FOLLOWS the read.
AGGREGATION_RE = re.compile(
    r"""\b(?:reduce|groupBy|group_by|new\s+Map\(|Map\(|sum|avg|average|mean|"""
    r"""statistics\.mean|aggregate)\b""",
    re.IGNORECASE,
)
# The key naming `unit` -- a property access, a dict key, or a bare mention.
UNIT_KEY_RE = re.compile(r"""\bunit\b""")

# The identity key, in either spelling. `\bunit\b` cannot match inside
# `identity_id`, so the two arms never credit each other by accident.
IDENTITY_KEY_RE = re.compile(r"""\b(?:identity_id|identityId)\b""")
SQL_GROUP_BY_IDENTITY_RE = re.compile(
    r"\bgroup\s+by\b[^;]{0,200}?\bidentity_id\b", re.IGNORECASE
)


def _iter_sources(root: Path) -> list[Path]:
    files: list[Path] = []
    for rel in READ_ROOTS:
        base = root / rel
        if not base.is_dir():
            raise CannotCheck(
                f"read root {rel} does not exist under {root}. This guard would "
                f"report a clean tree while looking at nothing."
            )
        for p in base.rglob("*"):
            if p.suffix not in SOURCE_SUFFIXES or not p.is_file():
                continue
            if any(part in SKIP_DIRS for part in p.parts):
                continue
            files.append(p)
    # `supabase/migrations` is deliberately NOT a read root: a migration's own
    # `select count(*) from price_history` is schema work, not a comparison.
    return files


def run(root: Path) -> tuple[int, list[str], dict[str, int]]:
    """(exit code, findings, counts). Raises CannotCheck for exit 2."""
    files = _iter_sources(root)
    if not files:
        raise CannotCheck("no source files under the read roots; the roots rotted.")

    findings: list[str] = []
    unfollowable: list[str] = []
    counts = {
        "files_scanned": len(files),
        "mentions": 0,
        "reads": 0,
        "compliant": 0,
        "sql_reads": 0,
        "identity_keyed": 0,
    }

    for path in sorted(files):
        raw = path.read_text(encoding="utf-8", errors="replace")
        if TABLE not in raw:
            continue
        rel = path.relative_to(root).as_posix()
        src = _strip_comments(root, raw, path.suffix)
        if TABLE not in src:
            continue
        counts["mentions"] += src.count(TABLE)

        def line_of(pos: int) -> int:
            return src.count("\n", 0, pos) + 1

        # --- builder chains -------------------------------------------------
        for m in CHAIN_RE.finditer(src):
            chain = m.group(1)
            if not SELECT_IN_CHAIN_RE.search(chain):
                continue  # a write, or a chain that names no projection
            counts["reads"] += 1
            line = line_of(m.start())
            if UNIT_FILTER_RE.search(chain):
                counts["compliant"] += 1
                continue
            tail = src[m.end() : m.end() + TRAILING_WINDOW]
            window = chain + tail

            # ARM 2 (ADR 0124 Q5). The grouping key names the identity and
            # never names the unit. The key is VISIBLE here, so this is a
            # finding rather than a refusal: an identity says which bottle,
            # not what the number counts.
            if IDENTITY_KEY_RE.search(window):
                counts["identity_keyed"] += 1
                if not UNIT_KEY_RE.search(window):
                    findings.append(
                        f"{rel}:{line} reads {TABLE} keyed on `identity_id` with no "
                        f"`unit` anywhere in the chain or the {TRAILING_WINDOW} "
                        f"characters that follow. Grouping by identity WITHOUT unit "
                        f"is the same fault as grouping by nothing, wearing a "
                        f"disguise: an identity fixes which bottle, a unit fixes "
                        f"what the number counts, and one bottle bought by the "
                        f"bottle in March and by the case in April is two honest "
                        f"rows that are not addable. Group by (identity_id, unit) "
                        f"-- the index "
                        f"`idx_price_history_identity_unit` exists for exactly that "
                        f"read -- and print the NULL identity as \"unidentified\" "
                        f"rather than dropping it (ADR 0124 Q5, ADR 0016)."
                    )
                    continue
                counts["compliant"] += 1
                continue

            if AGGREGATION_RE.search(window):
                if UNIT_KEY_RE.search(window):
                    counts["compliant"] += 1
                    continue
                unfollowable.append(
                    f"{rel}:{line} reads {TABLE} and then aggregates, but this "
                    f"parser cannot see the grouping key -- no `unit` appears "
                    f"anywhere in the {TRAILING_WINDOW} characters that follow. "
                    f"It is not knowable from here whether a case price is being "
                    f"averaged with a bottle price, so this guard refuses rather "
                    f"than guessing in either direction. Make the key literal, or "
                    f"add an explicit .eq(\"unit\", …)."
                )
                continue
            findings.append(
                f"{rel}:{line} reads {TABLE} without stating a unit: the chain "
                f"neither filters on `unit` nor groups by it, and nothing in the "
                f"{TRAILING_WINDOW} characters that follow aggregates. "
                f"`price_history.unit` is NOT NULL with a seven-value vocabulary "
                f"(ADR 0119 Q4, 2026-09-05): rows in this table are stated in "
                f"different units, so any comparison across them must group by "
                f"unit first. Averaging a case price with a bottle price is wrong "
                f"by the pack size, always in the direction that looks cheap."
            )

        # --- raw SQL --------------------------------------------------------
        for m in SQL_READ_RE.finditer(src):
            counts["reads"] += 1
            counts["sql_reads"] += 1
            line = line_of(m.start())
            stmt = src[m.start() : m.end() + TRAILING_WINDOW]
            states_unit = SQL_UNIT_WHERE_RE.search(stmt) or SQL_GROUP_BY_UNIT_RE.search(stmt)
            if SQL_GROUP_BY_IDENTITY_RE.search(stmt):
                counts["identity_keyed"] += 1
                if not states_unit:
                    findings.append(
                        f"{rel}:{line} groups {TABLE} by `identity_id` in raw SQL "
                        f"with no `unit` in the GROUP BY and none in the WHERE. "
                        f"The identity says which bottle; the unit says what the "
                        f"number counts. `GROUP BY identity_id, unit` (ADR 0124 Q5)."
                    )
                    continue
            if states_unit:
                counts["compliant"] += 1
                continue
            findings.append(
                f"{rel}:{line} selects from {TABLE} in raw SQL with no `unit` in "
                f"its WHERE and no `GROUP BY unit`. The column is NOT NULL and "
                f"carries seven different units (ADR 0119 Q4): this statement "
                f"compares numbers counted in different things."
            )

    # NEVER VACUOUS. The whole guard rests on the literal table name being
    # findable. If a rename or a runtime-assembled table name takes it out of
    # the tree, the honest answer is "cannot check", not "clean".
    if counts["mentions"] == 0:
        raise CannotCheck(
            f"the literal string {TABLE!r} appears nowhere under the read roots. "
            f"Either the table was renamed -- repoint TABLE -- or every reference "
            f"is now assembled at runtime, which this guard cannot see. It is "
            f"checking nothing meanwhile."
        )

    if unfollowable:
        raise CannotCheck(" ; ".join(unfollowable))
    return (1 if findings else 0), findings, counts


def main() -> int:
    try:
        code, findings, counts = run(Path.cwd())
    except CannotCheck as e:
        print(f"FAIL (exit 2) -- CANNOT CHECK: {e}")
        return 2
    if code:
        print(f"FAIL -- {len(findings)} read(s) of {TABLE} do not state a unit:")
        for f in findings:
            print(f"  - {f}")
        return 1
    readers = counts["reads"]
    tail = "0 readers today" if readers == 0 else f"{counts['compliant']}/{readers} state a unit"
    print(
        f"PASS -- every read of {TABLE} filters on `unit` or groups by it "
        f"({tail}; {counts['sql_reads']} raw-SQL read(s); {counts['mentions']} "
        f"mention(s) of the table across {counts['files_scanned']} source files "
        f"in {len(READ_ROOTS)} roots; {counts['identity_keyed']} identity-keyed "
        f"read(s), each also stating a unit)."
    )
    return 0


# ---------------------------------------------------------------------------
# --self-test: every branch must have executed at least once.
# ---------------------------------------------------------------------------
SVC = "apps/api-gateway/src/procurement/prices.service.ts"


def _fixture(tmp: Path) -> Path:
    """A tree with a writer and no readers -- the state of the repo today."""
    root = tmp / "repo"
    for rel in READ_ROOTS:
        (root / rel).mkdir(parents=True, exist_ok=True)
    (root / "scripts").mkdir(parents=True, exist_ok=True)
    real = Path(__file__).resolve().parent / "check_read_columns_exist.py"
    (root / "scripts" / "check_read_columns_exist.py").write_text(
        real.read_text(encoding="utf-8"), encoding="utf-8"
    )
    occ = Path(__file__).resolve().parent / "check_order_capture_contract.py"
    (root / "scripts" / "check_order_capture_contract.py").write_text(
        occ.read_text(encoding="utf-8"), encoding="utf-8"
    )
    (root / SVC).parent.mkdir(parents=True, exist_ok=True)
    (root / SVC).write_text(
        "export class PricesService {\n"
        "  async record(row) {\n"
        '    await this.db.supabase.from("price_history").insert(row);\n'
        "  }\n"
        "}\n",
        encoding="utf-8",
    )
    return root


def self_test() -> int:
    failures: list[str] = []

    def expect(label: str, got: int, want: int) -> None:
        if got != want:
            failures.append(f"{label}: exit {got}, expected {want}")

    def code_of(r: Path) -> int:
        try:
            return run(r)[0]
        except CannotCheck:
            return 2

    with tempfile.TemporaryDirectory() as td:
        # A. zero readers is a PASS, and it is COUNTED, not assumed.
        root = _fixture(Path(td) / "a")
        c, findings, counts = run(root)
        expect("a writer and no readers", c, 0)
        if counts["reads"] != 0:
            failures.append(f"zero-reader tree counted {counts['reads']} reads")
        if counts["mentions"] == 0:
            failures.append("zero-reader tree counted no mentions (would be vacuous)")

        svc = (root / SVC).read_text(encoding="utf-8")

        # B. a compliant read -- filters on unit.
        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async perBottle(id) {\n"
                '    return this.db.supabase.from("price_history")\n'
                '      .select("price, unit").eq("inventory_id", id)\n'
                '      .eq("unit", "bottle");\n'
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        c, findings, counts = run(root)
        expect("a read filtering on unit", c, 0)
        if counts["reads"] != 1 or counts["compliant"] != 1:
            failures.append(f"compliant read miscounted: {counts}")

        # B2. an aggregation KEYED by unit is compliant too.
        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async byUnit(id) {\n"
                '    const { data } = await this.db.supabase.from("price_history")\n'
                '      .select("price, unit").eq("inventory_id", id);\n'
                "    return (data || []).reduce((acc, r) => {\n"
                "      acc[r.unit] = (acc[r.unit] || 0) + r.price;\n"
                "      return acc;\n"
                "    }, {});\n"
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        expect("an aggregation keyed by unit", code_of(root), 0)

        # B3. ARM 2 (ADR 0124 Q5): identity AND unit together is compliant.
        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async byBottleAndUnit(id) {\n"
                '    const { data } = await this.db.supabase.from("price_history")\n'
                '      .select("price, unit, identity_id").eq("restaurant_id", id);\n'
                "    return (data || []).reduce((acc, r) => {\n"
                "      const k = `${r.identity_id ?? 'unidentified'}|${r.unit}`;\n"
                "      acc[k] = (acc[k] || 0) + r.price;\n"
                "      return acc;\n"
                "    }, {});\n"
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        c, findings, counts = run(root)
        expect("an identity-keyed read that also states the unit", c, 0)
        if counts["identity_keyed"] != 1:
            failures.append(f"identity-keyed read not counted: {counts}")

        # B4. the same read WITHOUT the unit is exit 1, not exit 2: the key is
        # visible and visibly insufficient.
        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async byBottle(id) {\n"
                '    const { data } = await this.db.supabase.from("price_history")\n'
                '      .select("price, identity_id").eq("restaurant_id", id);\n'
                "    return (data || []).reduce((acc, r) => {\n"
                "      acc[r.identity_id] = (acc[r.identity_id] || 0) + r.price;\n"
                "      return acc;\n"
                "    }, {});\n"
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        c, findings, _ = run(root)
        expect("an identity-keyed read with no unit", c, 1)
        if not any("same fault as grouping by nothing" in f for f in findings):
            failures.append(f"identity-without-unit not reported: {findings}")

        # B5. raw SQL, the same arm.
        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async sqlIdentityOnly() {\n"
                '    return this.db.query("select identity_id, avg(price) from price_history group by identity_id");\n'
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        c, findings, _ = run(root)
        expect("raw SQL grouping by identity alone", c, 1)
        if not any("says which bottle" in f for f in findings):
            failures.append(f"raw-SQL identity arm not reported: {findings}")

        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async sqlIdentityAndUnit() {\n"
                '    return this.db.query("select identity_id, unit, avg(price) from price_history group by identity_id, unit");\n'
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        expect("raw SQL grouping by identity AND unit", code_of(root), 0)

        # C. a NON-compliant read -- the whole point.
        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async average(id) {\n"
                '    return this.db.supabase.from("price_history")\n'
                '      .select("price").eq("inventory_id", id);\n'
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        c, findings, _ = run(root)
        expect("a read that states no unit", c, 1)
        if not any("without stating a unit" in f for f in findings):
            failures.append(f"non-compliant read not reported: {findings}")

        # C2. the same defect inside a comment does NOT fire.
        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                '  // from("price_history").select("price") was read here once\n'
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        expect("the defect written in a comment", code_of(root), 0)

        # D. an aggregation this parser cannot follow is exit 2, never 0 or 1.
        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async average(id) {\n"
                '    const { data } = await this.db.supabase.from("price_history")\n'
                '      .select("price").eq("inventory_id", id);\n'
                "    const key = this.pick();\n"
                "    return (data || []).reduce((a, r) => a + r.price, 0);\n"
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        expect("an aggregation whose key cannot be followed", code_of(root), 2)

        # E. raw SQL, both directions.
        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async sqlBad() {\n"
                '    return this.db.query("select avg(price) from price_history where inventory_id = $1");\n'
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        c, findings, _ = run(root)
        expect("raw SQL with no unit", c, 1)
        if not any("raw SQL" in f for f in findings):
            failures.append(f"raw-SQL defect not reported: {findings}")

        (root / SVC).write_text(
            svc.replace(
                "  async record(row) {",
                "  async sqlGood() {\n"
                '    return this.db.query("select unit, avg(price) from price_history group by unit");\n'
                "  }\n"
                "  async record(row) {",
            ),
            encoding="utf-8",
        )
        expect("raw SQL grouping by unit", code_of(root), 0)

        # F. a write is not a read.
        (root / SVC).write_text(svc, encoding="utf-8")
        expect("an insert is ignored", code_of(root), 0)

        # G. CANNOT CHECK, each on its own fresh tree.
        def blind(label: str, mutate) -> None:
            r = _fixture(Path(tempfile.mkdtemp(dir=td)))
            mutate(r)
            if code_of(r) != 2:
                failures.append(f"{label}: expected CannotCheck (2)")

        blind("a read root is gone", lambda r: __import__("shutil").rmtree(r / READ_ROOTS[0]))
        blind(
            "the table name has vanished from the tree",
            lambda r: (r / SVC).write_text("export class PricesService {}\n", encoding="utf-8"),
        )
        blind(
            "the shared comment stripper is gone",
            lambda r: (r / "scripts" / "check_read_columns_exist.py").unlink(),
        )

    print("== --self-test: price_history reads state their unit")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   a tree with a writer and NO readers exits 0, with the 0 counted")
    print('   .from("price_history").select(…).eq("unit", …) exits 0')
    print("   an aggregation keyed by r.unit exits 0")
    print("   an identity-keyed read that also states the unit exits 0")
    print("   an identity-keyed read with NO unit exits 1 (ADR 0124 Q5)")
    print("   raw SQL: GROUP BY identity_id alone exits 1, +unit exits 0")
    print("   a select with no unit filter and no aggregation exits 1")
    print("   the same defect inside a comment does NOT fire")
    print("   an aggregation whose grouping key cannot be followed exits 2")
    print("   raw SQL: no unit exits 1, GROUP BY unit exits 0")
    print("   an .insert() is a write and is ignored")
    print("   a missing read root, a vanished table name, or a missing")
    print("   comment stripper exits 2 -- never 0")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="prove the failure path fires")
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
