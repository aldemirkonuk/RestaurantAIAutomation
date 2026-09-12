#!/usr/bin/env python3
"""Guard: every read of the price register goes through ONE enforcement point.

WHY THIS EXISTS
---------------
The founder, 2026-09-05 (batch 56), answered "All real." when asked whether the
fifteen houses of ADR 0128's census are real independently owned restaurants,
and accepted the consequence recorded verbatim in ADR 0126:

    the contributor floors researched in `p4be-market.md` apply as written, and
    the register's tenancy boundary (nine hand-written filters and no RLS
    policy) must be fixed before any cross-house read

`vendor_price_observations.restaurant_id` has two states: a house's own row, or
NULL meaning EVERYONE'S, VERBATIM. The gateway holds the service role, which
BYPASSES row level security, so the application query IS the tenancy boundary --
there is nothing behind it. A boundary spelled out by hand at each call site
fails in the direction nobody sees: an omitted `.or()` does not throw, it returns
MORE rows, and the extra rows are another house's buying terms.

So the rule: `.from("vendor_price_observations")` and
`.from("price_index_postings")` may be READ only through
`scopePriceRegisterRead` in `apps/api-gateway/src/price-register/visibility.ts`.

WHAT COUNTS AS A READ
---------------------
A supabase-js chain `.from("<table>")` (or supabase-py `.table("<table>")`)
whose statement contains a `.select(` and NOT `.insert(` / `.upsert(` /
`.update(` / `.delete(`. A write's trailing `.select("id")` returns the ids of
the rows THAT CALL wrote, so a write is not a read of the register and is
ignored -- ADR 0117 governs what may be written.

WHAT MAKES A READ COMPLIANT
---------------------------
The `.from("<table>")` sits INSIDE the first argument of a
`scopePriceRegisterRead(...)` call whose SECOND argument names the same table --
either as the string literal or as the exported constant
(`VENDOR_PRICE_OBSERVATIONS` / `PRICE_INDEX_POSTINGS`):

    scopePriceRegisterRead(
      client.from("vendor_price_observations").select(COLUMNS),
      VENDOR_PRICE_OBSERVATIONS,
      { kind: "houseAndOpenMarket", restaurantId },
    ).gte("observed_at", from)

The arguments are found by balancing brackets, not by a proximity window. That
is deliberate and it is the difference between a guard and a suggestion: a
window credits a read for a scope call that happens to sit near it, and the
first version of this file did exactly that -- an unscoped read two lines below
a compliant one passed, and so did a scope call naming the WRONG table, because
the table name it was matching was the one inside the first argument. Both are
in the self-test as regressions.

The consequence is that the WRAPPING form above is the only compliant shape. The
reassignment form (`q = scopePriceRegisterRead(q, t, scope)`) is refused, because
its first argument is a bare identifier and nothing static can prove which query
that identifier holds. `scopePriceRegisterRead` returns the builder, so wrapping
composes with anything that follows.

THE ALLOWLIST, AND WHY IT IS NOT A HOLE
---------------------------------------
Four reads live in modules owned by other builds in this wave
(`procurement/**`, `notifications/**`, `distributor-feed/**`) and were left
untouched on purpose rather than edited across an ownership line. Each is
allowlisted BY FILE, with the owner, the reason, and -- the part that matters --
the exact text that must still be in the file for the entry to stand:

  * two of the four already carry, by hand, the identical predicate the
    enforcement point applies. They are duplication, not leaks.
  * the other two project no row at all (`count`/`id`).

If that pinned text disappears, or the file grows a read beyond the counted
number, the entry no longer describes the file and the guard exits 2 -- CANNOT
CHECK -- rather than continuing to pass. An allowlist that cannot rot into a
silent pass is a record; one that can is the absence-reported-as-health fault
this repository keeps meeting.

WHAT IT CANNOT SEE, AND SAYS SO
-------------------------------
  * A read assembled at runtime (the table name in a variable) is invisible to
    a static parse. The NEVER-VACUOUS checks below are the only defence: if
    either table name disappears from the roots, or the enforcement point stops
    exporting its function, that is exit 2.
  * The chain window is a fixed character count, so a `.select(` written very
    far below its `.from(` reads as "not a read" -- and an unterminated call is
    not guessed at, it simply credits nothing. Both fall the safe way.
  * It reads TypeScript and Python, not SQL: a migration's own SELECT is schema
    work and `supabase/migrations` is deliberately not a read root.
  * Test files (`*.spec.*`, `*.test.*`, `__fixtures__/`, `__mocks__/`) are not
    scanned. They build hand-written doubles, not live reads, and scanning them
    would make the guard argue with its own test fixtures.

EXIT CODES
    0  PASS -- every live read passes through the enforcement point (counts
       printed, including the allowlisted ones by name)
    1  FAIL -- a read does not (file:line)
    2  CANNOT CHECK -- never 0. A root is missing, a table name has vanished
       from the tree, the enforcement point is gone or no longer exports its
       function, the TypeScript constant and the migration's CHECK disagree
       about the third state's name, or an allowlist entry no longer describes
       its file.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
from pathlib import Path

TABLES = ("vendor_price_observations", "price_index_postings")

# The one file allowed to hold the rule. Relative to the repo root.
ENFORCEMENT_POINT = "apps/api-gateway/src/price-register/visibility.ts"
ENFORCEMENT_FN = "scopePriceRegisterRead"

# The migration that defines the third visibility state, and the name it must
# use. The TS constant and this CHECK are two copies of one string; if they ever
# drift, the exclusion predicate silently stops excluding anything.
VISIBILITY_MIGRATION = (
    "supabase/migrations/20260906100000_the_register_states_who_may_see_a_row.sql"
)
THIRD_STATE = "contributed_aggregate_only"

# Every root a read could live in. A missing one is exit 2: a guard that
# silently stops looking at the orchestrator is worse than no guard.
READ_ROOTS = [
    "apps/api-gateway/src",
    "apps/web/src",
    "apps/mobile",
    "services/agent-orchestrator",
]

SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".py"}
SKIP_DIRS = {"node_modules", "dist", "build", ".next", "__pycache__", ".venv", "venv"}
TEST_MARKERS = (".spec.", ".test.", "__fixtures__", "__mocks__", "__tests__")

# Same window size as `check_read_columns_exist.py`'s SELECT_SITE_RE, so the two
# guards agree on where a statement ends.
CHAIN_WINDOW = 600

# ---------------------------------------------------------------------------
# The allowlist. Measured on `feat/mudavym-design-p4`, 2026-09-05.
#
# `reads`   how many read chains of the register the file holds TODAY. One more
#           than this and the entry no longer describes the file: exit 2.
# `pinned`  text that must still be present. Its absence means the read changed
#           shape and the reason below may no longer be true: exit 2.
# ---------------------------------------------------------------------------
ALLOWLIST: dict[str, dict] = {
    "apps/api-gateway/src/procurement/procurement.service.ts": {
        "owner": "procurement/** -- another build in this wave (2026-09-05)",
        "reads": 2,
        "pinned": [
            # `recordPriceSighting`'s dedup existence check. Projects an id and
            # nothing else; keyed on the source ref and the content hash, both
            # of which name the document this house holds.
            '.eq("source_ref", provisional.sourceRef)',
            # `priorSightingUnitPrices` already spells, by hand, the identical
            # predicate `scopePriceRegisterRead`'s `houseAndOpenMarket` applies.
            # Duplication, not a leak.
            "restaurant_id.is.null,restaurant_id.eq.",
        ],
        "reason": (
            "one read projects only an id for a dedup check; the other already "
            "carries the identical tenancy predicate by hand. Converting them "
            "means editing a file another builder holds open in this same "
            "worktree. Convert on merge."
        ),
    },
    "apps/api-gateway/src/notifications/producers/market-price.producer.ts": {
        "owner": "notifications/** -- another build in this wave (2026-09-05)",
        "reads": 1,
        "pinned": [
            '.select("id", { count: "exact", head: true })',
            "restaurant_id.is.null,restaurant_id.eq.",
        ],
        "reason": (
            "a head count that returns a number and no row, already carrying "
            "the identical tenancy predicate by hand. Convert on merge."
        ),
    },
    "apps/api-gateway/src/distributor-feed/price-code-mappings.service.ts": {
        "owner": "distributor-feed/** -- another build in this wave (2026-09-05)",
        "reads": 1,
        "pinned": [
            '.select("id", { count: "exact", head: true })',
            '.eq("price_code_mapping_id", mappingId)',
        ],
        "reason": (
            "a head count of the rows one mapping admitted. It projects no row, "
            "and the mapping it is keyed to is itself house-scoped -- but that "
            "is an argument about the INPUT, not about the query, which is "
            "exactly why it is written down here rather than assumed. Convert "
            "on merge."
        ),
    },
}


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


# ---------------------------------------------------------------------------
# Comment stripping. Shared with the sibling guards BY PATH so there is exactly
# one comment stripper in the repo (the idiom `check_read_columns_exist.py`
# established). If that file is gone, this one refuses rather than scanning
# commented-out code as if it were live.
# ---------------------------------------------------------------------------
def _strip_comments(root: Path, text: str, suffix: str) -> str:
    if suffix == ".py":
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
    path = root / "scripts" / "check_read_columns_exist.py"
    if not path.is_file():
        raise CannotCheck(
            f"{path} is missing; its comment stripper is this guard's only defence "
            f"against reading a commented-out query as a live one."
        )
    import importlib.util

    spec = importlib.util.spec_from_file_location("_crce_shared_prr", path)
    if spec is None or spec.loader is None:
        raise CannotCheck(f"{path} could not be loaded as a module.")
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except SystemExit as e:
        raise CannotCheck(f"{path} exited during import with status {e.code}.")
    except Exception as e:  # noqa: BLE001 -- any import failure is CANNOT CHECK
        raise CannotCheck(f"{path} raised during import: {e}")
    try:
        shared = mod._load_shared(root)
    except Exception as e:  # noqa: BLE001
        raise CannotCheck(f"the shared comment stripper would not load: {e}")
    if not hasattr(shared, "strip_comments"):
        raise CannotCheck("the shared parse no longer exports strip_comments.")
    return shared.strip_comments(text)


# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------
def _chain_re(table: str) -> re.Pattern[str]:
    return re.compile(
        r"""\.(?:from|table)\(\s*["']""" + table + r"""["']\s*\)"""
        r"""((?:(?!\.(?:from|table)\(|;)[\s\S]){0,%d})""" % CHAIN_WINDOW
    )


SELECT_IN_CHAIN_RE = re.compile(r"\.select\(")
WRITE_IN_CHAIN_RE = re.compile(r"\.(?:insert|upsert|update|delete)\(")

CONST_FOR_TABLE = {
    "vendor_price_observations": "VENDOR_PRICE_OBSERVATIONS",
    "price_index_postings": "PRICE_INDEX_POSTINGS",
}


SCOPE_CALL_RE = re.compile(re.escape(ENFORCEMENT_FN) + r"\s*\(")

OPEN = {"(": ")", "[": "]", "{": "}"}
CLOSE = {")": "(", "]": "[", "}": "{"}


def _split_args(src: str, open_paren: int) -> list[tuple[int, int]] | None:
    """Spans of the top-level arguments of the call whose `(` is at `open_paren`.

    Brackets are balanced and string/template literals are skipped, so a comma
    inside `{ kind: "x", because: "a, b" }` never splits an argument. Returns
    None when the call is unterminated within the file, which is a parse this
    guard must not guess at.
    """
    depth = 0
    args: list[tuple[int, int]] = []
    start = open_paren + 1
    i = open_paren
    quote: str | None = None
    n = len(src)
    while i < n:
        ch = src[i]
        if quote is not None:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in "\"'`":
            quote = ch
            i += 1
            continue
        if ch in OPEN:
            depth += 1
            i += 1
            continue
        if ch in CLOSE:
            depth -= 1
            if depth == 0:
                args.append((start, i))
                return args
            i += 1
            continue
        if ch == "," and depth == 1:
            args.append((start, i))
            start = i + 1
        i += 1
    return None


def _scope_calls(src: str, table: str) -> list[tuple[int, int]]:
    """(arg1 start, arg1 end) for every scope call whose SECOND argument names
    `table`. The first argument's span is what a read must sit inside."""
    named = {f'"{table}"', f"'{table}'", CONST_FOR_TABLE[table]}
    out: list[tuple[int, int]] = []
    for m in SCOPE_CALL_RE.finditer(src):
        open_paren = src.index("(", m.start() + len(ENFORCEMENT_FN))
        args = _split_args(src, open_paren)
        if not args or len(args) < 2:
            continue
        second = src[args[1][0] : args[1][1]].strip()
        if second in named:
            out.append(args[0])
    return out


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
            if any(m in p.name for m in TEST_MARKERS) or any(
                m in p.parts for m in ("__fixtures__", "__mocks__", "__tests__")
            ):
                continue
            files.append(p)
    return files


def _check_enforcement_point(root: Path) -> None:
    path = root / ENFORCEMENT_POINT
    if not path.is_file():
        raise CannotCheck(
            f"{ENFORCEMENT_POINT} is missing. There is no enforcement point to "
            f"check reads against, so every read would trivially 'fail' or, worse, "
            f"a future edit could delete the rule and leave this guard passing."
        )
    src = path.read_text(encoding="utf-8", errors="replace")
    if f"export function {ENFORCEMENT_FN}" not in src:
        raise CannotCheck(
            f"{ENFORCEMENT_POINT} no longer exports `{ENFORCEMENT_FN}`. The name "
            f"this guard greps for and the name the code uses have diverged."
        )
    for table in TABLES:
        if table not in src:
            raise CannotCheck(
                f"{ENFORCEMENT_POINT} no longer names `{table}`; it cannot be "
                f"applying that table's rule."
            )
    if THIRD_STATE not in src:
        raise CannotCheck(
            f"{ENFORCEMENT_POINT} no longer names the third visibility state "
            f"`{THIRD_STATE}`, so nothing excludes it from a read."
        )

    mig = root / VISIBILITY_MIGRATION
    if not mig.is_file():
        raise CannotCheck(
            f"{VISIBILITY_MIGRATION} is missing. The column and CHECK that give "
            f"`{THIRD_STATE}` its meaning are not in the tree."
        )
    msrc = mig.read_text(encoding="utf-8", errors="replace")
    if THIRD_STATE not in msrc or "vpo_visibility_check" not in msrc:
        raise CannotCheck(
            f"{VISIBILITY_MIGRATION} no longer defines `vpo_visibility_check` "
            f"naming `{THIRD_STATE}`. The TypeScript constant and the database "
            f"CHECK are two copies of one string and they have drifted."
        )


def run(root: Path) -> tuple[int, list[str], dict[str, int]]:
    """(exit code, findings, counts). Raises CannotCheck for exit 2."""
    _check_enforcement_point(root)
    files = _iter_sources(root)
    if not files:
        raise CannotCheck("no source files under the read roots; the roots rotted.")

    chain_res = {t: _chain_re(t) for t in TABLES}

    findings: list[str] = []
    counts = {
        "files_scanned": len(files),
        "mentions": 0,
        "reads": 0,
        "scoped": 0,
        "writes": 0,
        "allowlisted": 0,
    }
    allow_seen: dict[str, int] = {k: 0 for k in ALLOWLIST}

    for path in sorted(files):
        raw = path.read_text(encoding="utf-8", errors="replace")
        if not any(t in raw for t in TABLES):
            continue
        rel = path.relative_to(root).as_posix()
        if rel == ENFORCEMENT_POINT:
            continue
        src = _strip_comments(root, raw, path.suffix)
        if not any(t in src for t in TABLES):
            continue

        def line_of(pos: int) -> int:
            return src.count("\n", 0, pos) + 1

        for table in TABLES:
            counts["mentions"] += src.count(table)
            # The spans of the first argument of every scope call naming THIS
            # table. A read is compliant when it sits inside one of them, and
            # each span may cover at most one read.
            spans = _scope_calls(src, table)
            used: dict[int, int] = {i: 0 for i in range(len(spans))}

            for m in chain_res[table].finditer(src):
                chain = m.group(1)
                if WRITE_IN_CHAIN_RE.search(chain):
                    counts["writes"] += 1
                    continue
                if not SELECT_IN_CHAIN_RE.search(chain):
                    continue
                counts["reads"] += 1
                line = line_of(m.start())

                if rel in ALLOWLIST:
                    allow_seen[rel] += 1
                    counts["allowlisted"] += 1
                    continue

                inside = [
                    i
                    for i, (a, b) in enumerate(spans)
                    if a <= m.start() and m.start() < b
                ]
                if inside:
                    i = inside[0]
                    used[i] += 1
                    if used[i] > 1:
                        findings.append(
                            f"{rel}:{line} is the {used[i]}th read of `{table}` inside "
                            f"ONE `{ENFORCEMENT_FN}` call's first argument. A scope is "
                            f"applied to the builder it wraps; a second query nested in "
                            f"the same argument is not scoped by it."
                        )
                        continue
                    counts["scoped"] += 1
                    continue
                harm = (
                    "an unscoped read returns every house's rows"
                    if table == "vendor_price_observations"
                    else "an unscoped read returns held books that nobody has admitted"
                )
                findings.append(
                    f"{rel}:{line} reads `{table}` without passing through "
                    f"`{ENFORCEMENT_FN}`. The gateway holds the service role, so no "
                    f"RLS policy is behind this query: {harm}. Wrap it -- "
                    f"`{ENFORCEMENT_FN}(client.from(\"{table}\").select(...), "
                    f'"{table}", {{ kind: ... }})` -- and name the scope. A read '
                    f"that really must cross houses says so with "
                    f"`{{ kind: 'everyHouse', because: '...' }}`. The `.from(` must "
                    f"sit INSIDE the call's first argument: a nearby scope call does "
                    f"not scope this query, and the reassignment form "
                    f"(`q = {ENFORCEMENT_FN}(q, ...)`) cannot be checked statically."
                )

    # The allowlist must still describe the files it names, or it is a record of
    # something that is no longer there.
    for rel, entry in ALLOWLIST.items():
        path = root / rel
        if not path.is_file():
            raise CannotCheck(
                f"allowlisted file {rel} no longer exists. Remove the entry rather "
                f"than leaving the guard carrying a permission for nothing."
            )
        text = path.read_text(encoding="utf-8", errors="replace")
        for pin in entry["pinned"]:
            if pin not in text:
                raise CannotCheck(
                    f"allowlisted file {rel} no longer contains {pin!r}. The read "
                    f"changed shape, so the reason recorded for it -- {entry['reason']} "
                    f"-- may no longer be true. Re-measure and update the entry, or "
                    f"convert the read."
                )
        if allow_seen[rel] > entry["reads"]:
            raise CannotCheck(
                f"allowlisted file {rel} now holds {allow_seen[rel]} register read(s), "
                f"more than the {entry['reads']} that were measured and reasoned about. "
                f"The new one has no permission; convert it or re-measure the entry."
            )

    # NEVER VACUOUS. A tree where the table names have vanished is not a clean
    # tree, it is a guard looking at nothing.
    if counts["mentions"] == 0:
        raise CannotCheck(
            "neither register table is named anywhere under the read roots. Either "
            "the tables were renamed or the roots rotted; this guard would report a "
            "clean tree while checking nothing."
        )

    return (1 if findings else 0), findings, counts


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    try:
        code, findings, counts = run(root)
    except CannotCheck as e:
        print("== price register reads are scoped: CANNOT CHECK")
        print(f"   {e}")
        return 2

    print("== price register reads are scoped")
    print(f"   files scanned          {counts['files_scanned']}")
    print(f"   table mentions         {counts['mentions']}")
    print(f"   writes (ignored)       {counts['writes']}")
    print(f"   reads                  {counts['reads']}")
    print(f"   through {ENFORCEMENT_FN}  {counts['scoped']}")
    print(f"   allowlisted            {counts['allowlisted']}")
    for rel, entry in ALLOWLIST.items():
        print(f"     - {rel} ({entry['reads']}) -- {entry['owner']}")
    if findings:
        for f in findings:
            print(f"   FAIL -- {f}")
        return 1
    print("PASS")
    return 0


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
SVC = "apps/api-gateway/src/vendor-intel/ladder.service.ts"


def _fixture(root: Path) -> Path:
    """A minimal tree with the enforcement point, the migration, the shared
    comment stripper, and one compliant read."""
    real = Path(__file__).resolve().parent.parent
    for rel in READ_ROOTS:
        (root / rel).mkdir(parents=True, exist_ok=True)
        (root / rel / ".keep").write_text("", encoding="utf-8")
    (root / "scripts").mkdir(parents=True, exist_ok=True)
    shutil.copy(
        real / "scripts" / "check_read_columns_exist.py",
        root / "scripts" / "check_read_columns_exist.py",
    )
    # The shared parse the stripper loads lives beside it; copy whatever the
    # real guard reaches for by copying the whole scripts dir's python files.
    for p in (real / "scripts").glob("*.py"):
        target = root / "scripts" / p.name
        if not target.exists():
            shutil.copy(p, target)
    shared_dir = real / "scripts" / "lib"
    if shared_dir.is_dir():
        shutil.copytree(shared_dir, root / "scripts" / "lib", dirs_exist_ok=True)

    ep = root / ENFORCEMENT_POINT
    ep.parent.mkdir(parents=True, exist_ok=True)
    ep.write_text(
        "export const VENDOR_PRICE_OBSERVATIONS = \"vendor_price_observations\";\n"
        "export const PRICE_INDEX_POSTINGS = \"price_index_postings\";\n"
        f'export const CONTRIBUTED_AGGREGATE_ONLY = "{THIRD_STATE}";\n'
        f"export function {ENFORCEMENT_FN}(q: any, table: any, scope: any) {{\n"
        "  return q;\n"
        "}\n",
        encoding="utf-8",
    )
    mig = root / VISIBILITY_MIGRATION
    mig.parent.mkdir(parents=True, exist_ok=True)
    mig.write_text(
        "ALTER TABLE public.vendor_price_observations ADD COLUMN IF NOT EXISTS visibility TEXT;\n"
        "ALTER TABLE public.vendor_price_observations ADD CONSTRAINT vpo_visibility_check\n"
        f"  CHECK (visibility IS NULL OR visibility IN ('house','open_market','{THIRD_STATE}'));\n",
        encoding="utf-8",
    )
    svc = root / SVC
    svc.parent.mkdir(parents=True, exist_ok=True)
    svc.write_text(
        'import { VENDOR_PRICE_OBSERVATIONS, scopePriceRegisterRead } from "../price-register/visibility";\n'
        "export class LadderService {\n"
        "  async ladder(id: string) {\n"
        "    return scopePriceRegisterRead(\n"
        '      this.db.supabase.from("vendor_price_observations").select("raw_price"),\n'
        "      VENDOR_PRICE_OBSERVATIONS,\n"
        '      { kind: "houseAndOpenMarket", restaurantId: id },\n'
        "    ).limit(10);\n"
        "  }\n"
        "  async record(row: any) {\n"
        '    await this.db.supabase.from("vendor_price_observations").insert(row).select("id");\n'
        "  }\n"
        "}\n",
        encoding="utf-8",
    )
    # The allowlist is checked against the REAL files, so the fixture needs them
    # too. Copy them verbatim; that is also what makes a rotted pin detectable.
    for rel in ALLOWLIST:
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(real / rel, target)
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
        root = _fixture(Path(td) / "a")
        c, findings, counts = run(root)
        expect("a compliant read and a write", c, 0)
        if counts["reads"] != 1 + sum(e["reads"] for e in ALLOWLIST.values()):
            failures.append(f"read count wrong: {counts}")
        if counts["scoped"] != 1:
            failures.append(f"scoped count wrong: {counts}")
        if counts["writes"] < 1:
            failures.append(f"the insert was not counted as a write: {counts}")

        base = (root / SVC).read_text(encoding="utf-8")

        # A. the whole point: an unscoped read fails.
        (root / SVC).write_text(
            base.replace(
                "  async record(row: any) {",
                "  async leak(id: string) {\n"
                '    return this.db.supabase.from("vendor_price_observations")\n'
                '      .select("raw_price").limit(10);\n'
                "  }\n"
                "  async record(row: any) {",
            ),
            encoding="utf-8",
        )
        c, findings, _ = run(root)
        expect("an unscoped read", c, 1)
        if not any("without passing through" in f for f in findings):
            failures.append(f"unscoped read not reported: {findings}")

        # A2. a hand-written tenancy filter is NOT compliant. It is exactly what
        # this guard exists to replace: correct today, silently wrong tomorrow.
        (root / SVC).write_text(
            base.replace(
                "  async record(row: any) {",
                "  async byHand(id: string) {\n"
                '    return this.db.supabase.from("vendor_price_observations")\n'
                '      .select("raw_price")\n'
                "      .or(`restaurant_id.is.null,restaurant_id.eq.${id}`);\n"
                "  }\n"
                "  async record(row: any) {",
            ),
            encoding="utf-8",
        )
        expect("a hand-written .or() filter", code_of(root), 1)

        # A3. the postings table is guarded too.
        (root / SVC).write_text(
            base.replace(
                "  async record(row: any) {",
                "  async postings(state: string) {\n"
                '    return this.db.supabase.from("price_index_postings")\n'
                '      .select("price").eq("state", state);\n'
                "  }\n"
                "  async record(row: any) {",
            ),
            encoding="utf-8",
        )
        expect("an unscoped postings read", code_of(root), 1)

        # B. a scope call naming the OTHER table does not credit this read.
        (root / SVC).write_text(
            base.replace(
                "  async record(row: any) {",
                "  async wrongTable(state: string) {\n"
                "    return scopePriceRegisterRead(\n"
                '      this.db.supabase.from("price_index_postings").select("price"),\n'
                "      VENDOR_PRICE_OBSERVATIONS,\n"
                '      { kind: "openMarketOnly" },\n'
                "    );\n"
                "  }\n"
                "  async record(row: any) {",
            ),
            encoding="utf-8",
        )
        expect("a scope call naming the wrong table", code_of(root), 1)

        # C. a second read that merely sits NEAR a compliant one is not covered
        #    by it. This is the regression that made the first version of this
        #    guard a suggestion rather than a check.
        (root / SVC).write_text(
            base.replace(
                "  async record(row: any) {",
                "  async second(id: string) {\n"
                '    return this.db.supabase.from("vendor_price_observations")\n'
                '      .select("raw_price").eq("restaurant_id", id);\n'
                "  }\n"
                "  async record(row: any) {",
            ),
            encoding="utf-8",
        )
        c, findings, _ = run(root)
        expect("a second read with no scope call of its own", c, 1)

        # C2. the reassignment form is refused: nothing static can prove which
        #     query a bare identifier holds.
        (root / SVC).write_text(
            base.replace(
                "  async record(row: any) {",
                "  async reassigned(id: string) {\n"
                '    let q = this.db.supabase.from("vendor_price_observations").select("raw_price");\n'
                "    q = scopePriceRegisterRead(q, VENDOR_PRICE_OBSERVATIONS, "
                '{ kind: "openMarketOnly" });\n'
                "    return q;\n"
                "  }\n"
                "  async record(row: any) {",
            ),
            encoding="utf-8",
        )
        expect("the reassignment form", code_of(root), 1)

        # D. the constant form of the table name is accepted.
        (root / SVC).write_text(
            base.replace('VENDOR_PRICE_OBSERVATIONS,', '"vendor_price_observations",'),
            encoding="utf-8",
        )
        expect("the string-literal form of the second argument", code_of(root), 0)

        # E. the same defect inside a comment does NOT fire.
        (root / SVC).write_text(
            base.replace(
                "  async record(row: any) {",
                '  // from("vendor_price_observations").select("raw_price") was read here\n'
                "  async record(row: any) {",
            ),
            encoding="utf-8",
        )
        expect("the defect written in a comment", code_of(root), 0)

        # F. a test file is not scanned.
        (root / SVC).write_text(base, encoding="utf-8")
        spec = root / SVC.replace("ladder.service.ts", "ladder.service.spec.ts")
        spec.write_text(
            'const q = db.from("vendor_price_observations").select("raw_price");\n',
            encoding="utf-8",
        )
        expect("an unscoped read inside a .spec. file", code_of(root), 0)
        spec.unlink()

        # G. CANNOT CHECK, each on its own fresh tree.
        def blind(label: str, mutate) -> None:
            r = _fixture(Path(tempfile.mkdtemp(dir=td)) / "b")
            mutate(r)
            if code_of(r) != 2:
                failures.append(f"{label}: expected CannotCheck (2)")

        blind("a read root is gone", lambda r: shutil.rmtree(r / READ_ROOTS[0]))
        blind(
            "the enforcement point is gone",
            lambda r: (r / ENFORCEMENT_POINT).unlink(),
        )
        blind(
            "the enforcement point stopped exporting its function",
            lambda r: (r / ENFORCEMENT_POINT).write_text(
                "export const VENDOR_PRICE_OBSERVATIONS = 'x';\n", encoding="utf-8"
            ),
        )
        blind(
            "the migration's CHECK and the constant disagree",
            lambda r: (r / VISIBILITY_MIGRATION).write_text(
                "ALTER TABLE public.vendor_price_observations ADD COLUMN visibility TEXT;\n",
                encoding="utf-8",
            ),
        )
        blind(
            "an allowlisted file lost its pinned text",
            lambda r: (r / next(iter(ALLOWLIST))).write_text(
                "export class Empty {}\n", encoding="utf-8"
            ),
        )
        blind(
            "an allowlisted file is gone",
            lambda r: (r / next(iter(ALLOWLIST))).unlink(),
        )
        blind(
            "the table names vanished from the tree",
            lambda r: [
                (r / SVC).write_text("export class LadderService {}\n", encoding="utf-8"),
                [
                    (r / rel).write_text("export class Empty {}\n", encoding="utf-8")
                    for rel in ALLOWLIST
                ],
            ],
        )
        blind(
            "the shared comment stripper is gone",
            lambda r: (r / "scripts" / "check_read_columns_exist.py").unlink(),
        )

    print("== --self-test: price register reads are scoped")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   a read wrapped in scopePriceRegisterRead exits 0; an .insert() is ignored")
    print("   an unscoped read of EITHER register table exits 1")
    print("   a hand-written .or() tenancy filter exits 1 -- it is what this replaces")
    print("   a scope call naming the OTHER table does not credit the read")
    print("   a read that merely sits NEAR a scope call exits 1")
    print("   the reassignment form q = scope(q, ...) exits 1")
    print("   the string-literal and constant forms of the table argument both count")
    print("   the defect inside a comment does NOT fire; .spec. files are not scanned")
    print("   a missing read root, a missing or renamed enforcement point, a")
    print("   migration whose CHECK no longer names the third state, an allowlist")
    print("   entry whose pinned text or file is gone, vanished table names, or a")
    print("   missing comment stripper all exit 2 -- never 0")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="prove the failure path fires")
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
