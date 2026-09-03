#!/usr/bin/env python3
"""Guard: every column a read NAMES must be declared by supabase/migrations/.

WHY THIS EXISTS
---------------
ADR 0073 (2026-09-02) fixed two functions that found a calendar event with

    .select("id, tags")

against `calendar_events`, a table that has never had a `tags` column. PostgREST
answers 42703 and **fails the entire query** -- a bad column in a select list is
exactly as fatal as one in an insert payload. Both functions then destructured
only `data`, so `events` came back `undefined`, `(events || [])` was empty, and
each returned having done nothing, indistinguishable from a run that
legitimately found no event. `absence-reported-as-health`, class O.

`check_order_capture_contract.py` was green on that tree, at exit 0, for the
whole life of the defect. Its `WRITE_SITE_RE` matches `.insert|update|upsert`
only, so a column named in a `.select()` is outside its universe. It was not
wrong; it was **structurally incapable of seeing the thing it looked like it
covered** -- which is the same fault as the bug it missed, one level up.

This guard adds the read side. It is the column-level counterpart of
`check_queried_tables_exist.py`, which asks the same question about relations:

    that guard   does the TABLE the code reads exist?
    this guard   do the COLUMNS the code names in that read exist?

WHY A SIBLING SCRIPT AND NOT A SIXTH CONTRACT
---------------------------------------------
`check_order_capture_contract.py` is 1300 lines and all five of its contracts
are write-path; its name, docstring and fixture are about order capture. A read
contract there stretches all three, and its self-test fixture would have to grow
a second axis. It is also the file two other changes touched this week (#234,
and the ADR 0073 branch, which had to repair its self-test), so restructuring it
is the highest-conflict edit available.

Reuse is by loading the three helpers BY PATH -- `declared_columns`,
`ts_sources`, `strip_comments` -- so there is exactly one migration parser and
one comment stripper in the repo. That is the repo's own idiom for sharing guard
code (`_od_collisions.py`, `check_beverage_identity_parity.py`).

WHAT IT READS
-------------
Both halves of a read name columns, and both 42703 the whole statement:

    .from("t").select("a, b")           the projection
    .from("t").eq("a", v) / .order(...) the filters

Plus a third shape, added by ADR 0093, which fails DIFFERENTLY and worse:

    .from("t").select("*")  ->  row.some_column      a row property read

A phantom column in the first two shapes 42703s the statement, so the query at
least fails. A phantom column in the third is plain `undefined` at runtime --
no error to swallow, no status code, just a wrong answer computed confidently.
`recipient-resolver.service.ts` read two such columns for eight months while
this guard reported PASS, because `"*"` names no column and the names appear
only as property accesses. Covered via the ROW_PROPERTY_READS registry below,
which is explicit rather than inferred and rots loudly (exit 2) rather than
silently.

Filters were measured before being included rather than assumed: 1375 filter
arguments across the gateway, **zero** of them dotted/embedded (`providers.name`
-- the false-positive shape this could have drowned in) and one non-identifier.
Excluding them would have left 10 live instances of this exact defect unseen on
the theory that they might be noisy, when the measurement says they are not.

WHAT IT CANNOT READ, AND SAYS SO
--------------------------------
  * `.select()` with no argument, and `"*"`  -- name no column. Skipped.
  * an embedded resource -- `providers(name)`, `inventory:inventory_id(...)`,
    `providers!left(name)`. Resolving the embedded relation needs the FK graph,
    which is not in reach of a static parse, so the whole parenthesised token is
    skipped rather than guessed at.
  * a column list that is a runtime value -- `.select(col)`. Counted as
    UNREADABLE, never as zero columns, and ceilinged. A guard that reads a
    dynamic select as "no bad columns here" is this file's own bug class.

Static string forms ARE resolved, because leaving them unreadable would have
blinded the guard to the long multi-column selects most likely to hide a bad
column: double/single quotes, backtick template literals with no `${}`,
`"a, b" + "c, d"` concatenation, and a same-file `const X = "..."`. Doing so
took the unreadable set from 26 sites to 2.

EXIT CODES
    0  every named column exists, or is on the shrink-only debt list
    1  a read names a column no migration declares, or the debt list is stale
    2  CANNOT CHECK -- never 0. The roots are missing, the helpers would not
       load, the migration parse collapsed, the site pattern matched nothing,
       or a ROW_PROPERTY_READS entry points at a file or variable that is gone.
"""
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
import tempfile
from pathlib import Path

MIGRATIONS = "supabase/migrations"
READ_ROOTS = ["apps/api-gateway/src"]

# Sanity floor for the shared migration parse. The production baseline alone
# declares ~170 tables; a handful means the SQL patterns rotted and every column
# in the codebase would look missing.
MIN_TABLES_WITH_COLUMNS = 150

# The site pattern matching nothing means it rotted against a formatter change.
# Measured 602 select sites and 1375 filter arguments on 2026-09-02; these floors
# are deliberately far below that, because they exist to catch total collapse,
# not drift.
MIN_SELECT_SITES = 200
MIN_FILTER_ARGS = 400

# The measured size of the blind spot: reads whose column list is a runtime
# value. Two on 2026-09-02 -- `.select(col)` in scheduled-tasks.service.ts and
# `.select(select)` in conversations.service.ts. It may SHRINK freely; growing
# it is a deliberate act that needs this line edited, because every addition is
# a read this guard has stopped looking at.
UNREADABLE_READ_CEILING = 2


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


# ---------------------------------------------------------------------------
# The shared parse. Loaded BY PATH, with SystemExit caught: a stray module-level
# sys.exit() over there -- one lost `if __name__ == "__main__"` away -- is a
# BaseException, so `except Exception` would let it terminate THIS guard with
# that file's status. For exit 0 that means this check silently never ran.
# ---------------------------------------------------------------------------
def _load_shared(root: Path):
    path = root / "scripts" / "check_order_capture_contract.py"
    if not path.is_file():
        raise CannotCheck(f"{path} is missing; the shared migration parse is gone")
    try:
        spec = importlib.util.spec_from_file_location("_occ_shared", path)
        if spec is None or spec.loader is None:
            raise CannotCheck(f"{path} could not be loaded as a module")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except BaseException as e:  # noqa: BLE001 - SystemExit is the point
        raise CannotCheck(f"{path} would not import: {e!r}") from e
    for fn in (
        "declared_columns",
        "ts_sources",
        "strip_comments",
        "_split_top_level",
        # Its CannotCheck is a DIFFERENT class from this file's. Without
        # translating it, a blind shared parse escapes as an uncaught exception
        # and Python exits 1 — which CI reads as "a column is missing" when the
        # truth is "this guard could not look". Exactly the confusion the exit-2
        # state exists to prevent.
        "CannotCheck",
    ):
        if not hasattr(mod, fn):
            raise CannotCheck(f"{path} no longer exports {fn}(); the reuse contract broke")
    return mod


# ---------------------------------------------------------------------------
# KNOWN_BAD_READ_COLUMNS -- the shrink-only debt ratchet.
#
# NOT approved. These are reads already broken when this guard landed, recorded
# so it can be green on arrival and therefore block the NEXT one. Every entry
# was measured against supabase/migrations/ on 2026-09-02, and each names the
# column the table actually has where one is obvious.
#
# Enforced in both directions: an entry the schema now declares is a FAILURE
# (delete it), and an entry nothing reads any more is a FAILURE (delete it).
# The only way to touch this list is to make it shorter.
# ---------------------------------------------------------------------------
KNOWN_BAD_READ_COLUMNS: dict[str, str] = {
    "procurement_orders.wine_name": (
        "The name lives on `restaurant_inventory.wine_name`, reached through the "
        "`inventory:inventory_id(wine_name)` embed the same file uses elsewhere. "
        "Read by communications.controller.ts and dashboard.service.ts:440."
    ),
    "procurement_orders.negotiated_price_per_bottle": (
        "No such column. The table carries `final_price` and `suggested_price`. "
        "communications.controller.ts, two sites."
    ),
    "procurement_orders.target_price_per_bottle": (
        "Same site and same shape as negotiated_price_per_bottle."
    ),
    "procurement_conversations.manager_approval_status": (
        "No such column; the table has `status`. communications.controller.ts:881."
    ),
    "providers.contact_name": (
        "The table has `contact_first_name` and `contact_last_name` (also "
        "`primary_contact`). communications.service.ts:445."
    ),
    "provider_promotions.savings_realized": (
        "No such column. provider-intelligence.service.ts:205 selects it AND "
        "filters `.gt` + `.order` on it, so all three fail together."
    ),
    "provider_promotions.times_used": (
        "No such column. Same select as savings_realized."
    ),
    "users.avatar_url": (
        "No such column. Read by members.service.ts:85, team.service.ts:136 and "
        ":182 -- three sites, so every team/member listing 42703s."
    ),
    "users.auth_provider": (
        "The column is `oauth_provider`. members.service.ts:85, same select as "
        "avatar_url."
    ),
    "master_wine_library.wine_name": (
        "The table has `name`, `display_name`, `normalized_name`. "
        "storage-locations.service.ts:284."
    ),
    "notifications.manager_id": (
        "The table has `recipient_id` and `user_id`. database.service.ts:113."
    ),
    "user_restaurant_access.granted_at": (
        "No such column. members.service.ts:71 orders by it."
    ),
    "restaurants.toast_restaurant_guid": (
        "No such column on `restaurants`; the POS linkage lives in the toast "
        "tables. toast.service.ts:340."
    ),
}


# ---------------------------------------------------------------------------
# ROW_PROPERTY_READS -- the third read shape, added by ADR 0093.
#
# WHY THIS EXISTS. The two collectors below read the PROJECTION and the
# FILTERS. Both need a column name to appear as a string literal. A read of the
# form
#
#     const { data } = await client.from("notification_preferences").select("*")
#     ...
#     if (prefs.order_channels) { ... }
#
# names its columns in NEITHER place: `"*"` names no column, and the column
# name only ever appears as a property access. This guard passed on
# `origin/main` while `recipient-resolver.service.ts` read two columns that no
# migration has ever declared -- for eight months, in production, mis-routing
# every notification it touched. The guard was not wrong; the read was outside
# the universe its docstring claims. This closes that gap for the sites where a
# `select("*")` row is destructured and read by name.
#
# WHY IT IS A REGISTRY AND NOT INFERENCE. Deciding which table a bare
# `prefs.foo` belongs to needs the type of `prefs`, which needs a TypeScript
# program, not a regex. Guessing would produce false positives on every
# unrelated object in the codebase. So the mapping is declared, and the honesty
# comes from the never-vacuous rule instead:
#
#   an entry whose file is gone, or whose variable no longer appears, is
#   CANNOT CHECK (exit 2) -- never a silent pass.
#
# That is the same contract the rest of this file holds itself to. An entry
# that rots announces itself; it does not quietly stop looking.
#
# TO ADD AN ENTRY: point it at a `select("*")` (or embed) read whose row is
# then accessed by property name. Do not add one for a select that already
# names its columns as a literal -- the projection collector has it covered.
# ---------------------------------------------------------------------------
ROW_PROPERTY_READS: dict[str, tuple[str, str]] = {
    "apps/api-gateway/src/communications/recipient-resolver.service.ts::prefs": (
        "notification_preferences",
        "getNotificationPreferences() does .select('*') and checkChannelPreference() "
        "reads the row by property name. This is the exact site of ADR 0093: it read "
        "`order_channels` and `report_channels`, which the table has never had.",
    ),
    "apps/api-gateway/src/communications/recipient-resolver.service.ts::pref": (
        "notification_preferences",
        "The loop variable over the same .select('*') result, one frame up in "
        "getNotificationPreferences().",
    ),
}

# `<var>.<ident>`, not followed by `(` -- a method call is not a column read.
PROPERTY_READ_RE_TEMPLATE = r"\b{var}\.([a-z_][a-z0-9_]*)\b(?!\s*\()"


def _property_read_findings(root: Path, cols: dict, shared) -> tuple[list[str], int]:
    """Check every ROW_PROPERTY_READS entry. Returns (findings, reads seen)."""
    findings: list[str] = []
    total_reads = 0

    for entry, (table, why) in sorted(ROW_PROPERTY_READS.items()):
        rel, _, var = entry.partition("::")
        path = root / rel
        if not path.is_file():
            raise CannotCheck(
                f"ROW_PROPERTY_READS names {rel}, which does not exist. Either the "
                f"file moved -- repoint the entry -- or the read is gone and the "
                f"entry must be deleted. It is NOT checking anything meanwhile."
            )
        if table not in cols:
            raise CannotCheck(
                f"ROW_PROPERTY_READS maps {entry} to table {table!r}, which "
                f"{MIGRATIONS} does not declare. Every column would look missing."
            )

        src = shared.strip_comments(path.read_text(encoding="utf-8"))
        matches = list(
            re.finditer(PROPERTY_READ_RE_TEMPLATE.format(var=re.escape(var)), src)
        )
        if not matches:
            raise CannotCheck(
                f"ROW_PROPERTY_READS names {entry}, but no `{var}.<column>` read "
                f"remains in {rel}. The variable was renamed or the read deleted; "
                f"this entry is looking at nothing. Repoint it or delete it."
            )

        total_reads += len(matches)
        for m in matches:
            col = m.group(1)
            if col in cols[table]:
                continue
            key = f"{table}.{col}"
            if key in KNOWN_BAD_READ_COLUMNS:
                continue
            line = src.count("\n", 0, m.start()) + 1
            findings.append(
                f"{rel}:{line} reads {var}.{col} off a {table} row, but no migration "
                f"in {MIGRATIONS} declares {key}. The property is `undefined` at "
                f"runtime — no error, no 42703, just a silently wrong answer. "
                f"({why})"
            )

    return findings, total_reads


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

# `.from("t")` followed, within one statement, by `.select(`. The negative
# lookahead stops the window from running past the end of the statement or into
# the next builder, which is what keeps `.from(A) ... .select(B-on-another-chain)`
# from being paired.
SELECT_SITE_RE = re.compile(
    r"""\.from\(\s*["']([a-z][a-z0-9_]*)["']\s*\)"""
    r"""(?:(?!\.from\(|;)[\s\S]){0,600}?"""
    r"""\.select\("""
)

# The same window, but capturing it so every filter inside can be walked.
FILTER_SITE_RE = re.compile(
    r"""\.from\(\s*["']([a-z][a-z0-9_]*)["']\s*\)"""
    r"""((?:(?!\.from\(|;)[\s\S]){0,600})"""
)
FILTER_ARG_RE = re.compile(
    r"""\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|order|not|filter)"""
    r"""\(\s*["']([^"'\n]+)["']"""
)

# One string literal: double, single, or a template with no `${}` interpolation.
_STRING_LITERAL = r'''(?:"[^"]*"|'[^']*'|`[^`$]*`)'''

# `const NAME = "a" + "b";`
#
# The concatenation is written as `<lit>(\s*\+\s*<lit>)*` — one literal, then
# each further literal introduced BY a `+`. The obvious form,
# `(?:\s*<lit>\s*\+?)+`, is a REDOS: the `+` is optional and the `\s*` can
# match empty on either side, so one input has exponentially many parses.
# Measured on `let $="" ""…` — 0.002s at 12 repetitions, 1.675s at 22 (CodeQL
# py/redos, flagged on this file's first push). This form has one parse per
# input. Keep it that way: never make the `+` optional here.
CONST_RE = re.compile(
    r"""(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*"""
    r"""(""" + _STRING_LITERAL + r"""(?:\s*\+\s*""" + _STRING_LITERAL + r""")*)\s*;"""
)
STRING_PIECE_RE = re.compile(r"""(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)""")
IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _call_arg(src: str, open_paren: int) -> str | None:
    """Text between the parens of the call whose `(` is at src[open_paren]."""
    depth, i, n = 0, open_paren, len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            q, i = c, i + 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == q:
                    break
                i += 1
            i += 1
            continue
        if c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
            if depth == 0:
                return src[open_paren + 1 : i]
        i += 1
    return None


def _static_string(expr: str, consts: dict[str, str]) -> str | None:
    """The value of `expr` if it is statically knowable, else None.

    Handles a quoted literal, a `${}`-free template literal, a `+` chain of
    those, and a same-file const bound to any of them. Returns None for a
    runtime value -- the caller must count that, never ignore it.
    """
    expr = expr.strip()
    if not expr:
        return None
    if IDENT_RE.match(expr) or re.match(r"^[A-Z_][A-Z0-9_]*$", expr):
        return consts.get(expr)
    pieces = STRING_PIECE_RE.findall(expr)
    if not pieces:
        return None
    # Every non-string fragment must be whitespace or a `+`, or this is an
    # interpolation we cannot resolve.
    if re.sub(STRING_PIECE_RE, "", expr).strip(" \t\r\n+") != "":
        return None
    return "".join(a or b or c for a, b, c in pieces)


def _columns_in_select(text: str, split) -> tuple[list[str], int]:
    """(column names named at the top level, count of tokens not understood)."""
    named: list[str] = []
    puzzling = 0
    for raw in split(text):
        tok = raw.strip()
        if not tok or tok == "*":
            continue
        if "(" in tok:
            continue  # embedded resource: needs the FK graph, not guessed at
        if ":" in tok:
            tok = tok.split(":")[-1].strip()  # alias:column
        tok = tok.split("!")[0].strip()  # providers!left
        tok = tok.split("::")[0].strip()  # a cast
        if not tok or tok == "*":
            continue
        if "->" in tok:
            tok = tok.split("->")[0].strip()  # jsonb path: the column is the root
        if not IDENT_RE.match(tok):
            puzzling += 1
            continue
        named.append(tok)
    return named, puzzling


def collect(root: Path, shared) -> tuple[list[str], set[str], int, int, int]:
    """(findings, keys seen, select sites, filter args, unreadable reads)."""
    cols = shared.declared_columns(root)
    if len(cols) < MIN_TABLES_WITH_COLUMNS:
        raise CannotCheck(
            f"parsed columns for only {len(cols)} tables from {MIGRATIONS} "
            f"(floor {MIN_TABLES_WITH_COLUMNS}). The SQL parse collapsed; every "
            "column in the codebase would look missing."
        )

    findings: list[str] = []
    seen: set[str] = set()
    select_sites = filter_args = unreadable = 0

    for rel_root in READ_ROOTS:
        for rel, raw in shared.ts_sources(root, rel_root):
            src = shared.strip_comments(raw)
            consts = {
                m.group(1): "".join(
                    a or b or c for a, b, c in STRING_PIECE_RE.findall(m.group(2))
                )
                for m in CONST_RE.finditer(src)
            }

            def report(table: str, col: str, at: int, how: str) -> None:
                if col in cols[table]:
                    return
                key = f"{table}.{col}"
                seen.add(key)
                if key in KNOWN_BAD_READ_COLUMNS:
                    return
                line = src.count("\n", 0, at) + 1
                findings.append(
                    f"{rel}:{line} {how} {table}.{col}, which no migration in "
                    f"{MIGRATIONS} declares. PostgREST answers 42703 and fails the "
                    f"WHOLE query — silently, if the caller does not read `error`. "
                    f"Read the column the table actually has, or add it in a migration."
                )

            for m in SELECT_SITE_RE.finditer(src):
                table = m.group(1).lower()
                if table not in cols:
                    continue  # relation-level absence is check_queried_tables_exist's job
                arg = _call_arg(src, m.end() - 1)
                if arg is None:
                    unreadable += 1
                    continue
                parts = shared._split_top_level(arg)
                first = parts[0].strip() if parts else ""
                if not first:
                    continue  # `.select()` names no column
                text = _static_string(first, consts)
                if text is None:
                    unreadable += 1
                    continue
                select_sites += 1
                named, puzzling = _columns_in_select(text, shared._split_top_level)
                unreadable += puzzling
                for col in named:
                    report(table, col, m.start(), "selects")

            for m in FILTER_SITE_RE.finditer(src):
                table = m.group(1).lower()
                if table not in cols:
                    continue
                for f in FILTER_ARG_RE.finditer(m.group(2)):
                    col = f.group(2).strip()
                    filter_args += 1
                    if "." in col:
                        continue  # embedded filter: providers.name
                    if not IDENT_RE.match(col):
                        unreadable += 1
                        continue
                    report(table, col, m.start() + f.start(), f".{f.group(1)}() filters on")

    # The third shape: a `select("*")` row read by property name (ADR 0093).
    # Raises CannotCheck rather than passing when an entry has rotted.
    prop_findings, prop_reads = _property_read_findings(root, cols, shared)
    findings.extend(prop_findings)
    # Feed the debt ratchet's "nothing reads it any more" direction: a property
    # read is still a read, so an entry only covered here must not look unread.
    seen.update(
        f"{ROW_PROPERTY_READS[e][0]}.{c}"
        for e in ROW_PROPERTY_READS
        for c in _property_columns_in(root, e, shared)
    )

    return findings, seen, select_sites, filter_args, unreadable, prop_reads


def _property_columns_in(root: Path, entry: str, shared) -> set[str]:
    """Every column name an entry's property reads name, bad ones included."""
    rel, _, var = entry.partition("::")
    path = root / rel
    if not path.is_file():
        return set()
    src = shared.strip_comments(path.read_text(encoding="utf-8"))
    return {
        m.group(1)
        for m in re.finditer(PROPERTY_READ_RE_TEMPLATE.format(var=re.escape(var)), src)
    }


def run(root: Path) -> tuple[int, list[str]]:
    shared = _load_shared(root)
    try:
        findings, seen, selects, filters, unreadable, prop_reads = collect(root, shared)
        declared = shared.declared_columns(root)
    except shared.CannotCheck as e:
        raise CannotCheck(f"the shared migration parse cannot check: {e}") from e

    # A pattern that matches nothing is the failure this guard exists to catch,
    # committed by the guard itself. Never a pass.
    if selects < MIN_SELECT_SITES:
        raise CannotCheck(
            f"found only {selects} readable select sites (floor {MIN_SELECT_SITES}). "
            "The site pattern rotted; a guard that looks at nothing reports health."
        )
    if filters < MIN_FILTER_ARGS:
        raise CannotCheck(
            f"found only {filters} filter arguments (floor {MIN_FILTER_ARGS}). "
            "The filter pattern rotted."
        )

    if unreadable > UNREADABLE_READ_CEILING:
        findings.append(
            f"[unreadable reads] {unreadable} reads name columns this guard cannot "
            f"resolve statically, over the ceiling of {UNREADABLE_READ_CEILING}. "
            "Each one is a read nobody is checking. Make the column list a literal, "
            "or raise the ceiling deliberately and say why."
        )

    # The ratchet, both directions.
    for entry in sorted(KNOWN_BAD_READ_COLUMNS):
        table, _, col = entry.partition(".")
        if table in declared and col in declared[table]:
            findings.append(
                f"KNOWN_BAD_READ_COLUMNS lists {entry}, but {MIGRATIONS} now declares "
                f"that column. Delete the entry — a fixed read left on the debt list "
                f"is a read this guard has stopped checking."
            )
        elif entry not in seen:
            findings.append(
                f"KNOWN_BAD_READ_COLUMNS lists {entry}, but nothing under "
                f"{', '.join(READ_ROOTS)} reads it any more. Delete the entry — a debt "
                f"list nobody prunes stops being a record of debt and becomes a list "
                f"of reads the guard has quietly stopped looking at."
            )

    return (1 if findings else 0), findings


def main() -> int:
    try:
        code, findings = run(Path.cwd())
    except CannotCheck as e:
        print(f"FAIL (exit 2) -- CANNOT CHECK: {e}")
        return 2
    if code:
        print(f"FAIL -- {len(findings)} read(s) name a column that does not exist:")
        for f in findings:
            print(f"  - {f}")
        return 1
    print(
        "PASS -- every column named in a .select(), a filter, or a registered "
        f"row-property read is declared by {MIGRATIONS}, or is on the shrink-only "
        f"debt list ({len(KNOWN_BAD_READ_COLUMNS)} entries). "
        f"[{len(ROW_PROPERTY_READS)} property-read sites checked]"
    )
    return 0


# ---------------------------------------------------------------------------
# --self-test: the failure path must have executed at least once.
# ---------------------------------------------------------------------------
SVC = "apps/api-gateway/src/orders/orders.service.ts"
# The ROW_PROPERTY_READS fixture: a `select("*")` row read by property name.
PROP_SVC = "apps/api-gateway/src/orders/order-prefs.service.ts"
PROP_ENTRY = f"{PROP_SVC}::row"


def _fixture(tmp: Path) -> Path:
    """A minimal tree whose reads all name real columns."""
    root = tmp / "repo"
    (root / MIGRATIONS).mkdir(parents=True)
    (root / "scripts").mkdir(parents=True)
    (root / "apps/api-gateway/src/orders").mkdir(parents=True)

    # The shared parse is loaded from the tree under test, so the fixture needs
    # its own copy. Reusing the real one keeps exactly one migration parser.
    real = Path(__file__).resolve().parent / "check_order_capture_contract.py"
    (root / "scripts" / "check_order_capture_contract.py").write_text(
        real.read_text(encoding="utf-8"), encoding="utf-8"
    )

    # MIN_TABLES_WITH_COLUMNS real tables, so the floor is cleared honestly.
    filler = "".join(
        f"create table public.t{i} (id uuid not null, restaurant_id uuid not null);\n"
        for i in range(MIN_TABLES_WITH_COLUMNS + 5)
    )
    (root / MIGRATIONS / "20260101000000_base.sql").write_text(
        filler
        + "create table public.orders (\n"
        "  id uuid not null,\n"
        "  restaurant_id uuid not null,\n"
        "  status varchar(50),\n"
        "  order_number varchar(50),\n"
        "  created_at timestamptz\n"
        ");\n"
        "create table public.debt_table (id uuid not null, restaurant_id uuid not null);\n",
        encoding="utf-8",
    )

    # Enough real sites to clear MIN_SELECT_SITES / MIN_FILTER_ARGS without the
    # floors being a lie: the fixture genuinely contains them.
    bulk = "".join(
        f'  async r{i}() {{\n'
        f'    await this.db.supabase.from("orders").select("id, status")\n'
        f'      .eq("restaurant_id", r).eq("status", s).order("created_at");\n'
        f'  }}\n'
        for i in range(MIN_SELECT_SITES + 20)
    )
    (root / SVC).write_text(
        "export class OrdersService {\n"
        "  async list() {\n"
        '    await this.db.supabase.from("orders")\n'
        '      .select("id, order_number, status")\n'
        '      .eq("restaurant_id", r)\n'
        '      .order("created_at", { ascending: false });\n'
        "  }\n"
        "  async starred() {\n"
        '    await this.db.supabase.from("orders").select("*, providers(name)");\n'
        "  }\n"
        "  async counted() {\n"
        '    await this.db.supabase.from("orders").select("*", { count: "exact" });\n'
        "  }\n"
        "  async bare() {\n"
        '    await this.db.supabase.from("orders").insert(x).select();\n'
        "  }\n"
        + bulk
        + "}\n",
        encoding="utf-8",
    )

    # A `select("*")` whose row is then read by property name — the shape the
    # projection and filter collectors are both blind to (ADR 0093). Every
    # column named here is real, so the clean tree stays clean.
    (root / PROP_SVC).write_text(
        "export class OrderPrefsService {\n"
        "  async load() {\n"
        '    const { data: row } = await this.db.supabase.from("orders")\n'
        '      .select("*").eq("restaurant_id", r).single();\n'
        "    if (row.status === 'open') return row.order_number;\n"
        "    return row.created_at;\n"
        "  }\n"
        "}\n",
        encoding="utf-8",
    )
    # The ratchet is shrink-only in BOTH directions, so a clean tree must contain
    # the debt it excuses. Synthetic, so paying off the real list never breaks
    # this fixture — the lesson ADR 0073 learned from the sibling guard.
    (root / "apps/api-gateway/src/orders/debt.ts").write_text(
        "export class Debt {\n"
        "  async r() {\n"
        '    await this.db.supabase.from("debt_table").select("id, zzz_debt_read");\n'
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

    real_debt = KNOWN_BAD_READ_COLUMNS
    real_ceiling = UNREADABLE_READ_CEILING
    real_props = ROW_PROPERTY_READS
    globals()["KNOWN_BAD_READ_COLUMNS"] = {
        "debt_table.zzz_debt_read": "synthetic, self-test only — see _fixture()."
    }
    # The real registry points at real repo files, which the fixture tree does
    # not have. Swap in a fixture-local entry, exactly as the debt list is.
    globals()["ROW_PROPERTY_READS"] = {
        PROP_ENTRY: ("orders", "synthetic, self-test only — see _fixture().")
    }
    try:
        with tempfile.TemporaryDirectory() as td:
            root = _fixture(Path(td))
            svc = (root / SVC).read_text(encoding="utf-8")

            code, findings = run(root)
            expect("clean tree", code, 0)
            if findings:
                failures.append(f"clean tree reported: {findings}")

            # A. THE DEFECT. The exact pre-fix line from ADR 0073.
            (root / SVC).write_text(
                svc.replace('.select("id, order_number, status")', '.select("id, tags")'),
                encoding="utf-8",
            )
            code, findings = run(root)
            expect("a select naming a phantom column", code, 1)
            if not any("selects orders.tags" in f for f in findings):
                failures.append(f"phantom select column not reported: {findings}")

            # B. a filter naming a phantom column is the same defect.
            (root / SVC).write_text(
                svc.replace('.eq("restaurant_id", r)', '.eq("tenant_id", r)', 1),
                encoding="utf-8",
            )
            code, findings = run(root)
            expect("a filter naming a phantom column", code, 1)
            if not any("filters on orders.tenant_id" in f for f in findings):
                failures.append(f"phantom filter column not reported: {findings}")

            # C. `"*"`, an embed, a count option and a bare `.select()` are NOT
            # findings. A guard that fires on these is one people switch off.
            (root / SVC).write_text(svc, encoding="utf-8")
            code, findings = run(root)
            if findings:
                failures.append(f"star/embed/count/bare select reported: {findings}")

            # C2. an embedded column that does not exist on the PARENT is still
            # skipped, not guessed at — the FK graph is out of reach.
            (root / SVC).write_text(
                svc.replace('.select("*, providers(name)")', '.select("*, providers(nope)")'),
                encoding="utf-8",
            )
            code, findings = run(root)
            expect("embedded resource is skipped, not guessed", code, 0)

            # D. the same phantom name inside a comment does NOT fire.
            (root / SVC).write_text(
                svc.replace(
                    "  async list() {",
                    '  // was .select("id, tags") before ADR 0073\n'
                    '  /* .eq("tenant_id", r) */\n'
                    "  async list() {",
                ),
                encoding="utf-8",
            )
            code, findings = run(root)
            expect("the defect described in a comment", code, 0)
            if findings:
                failures.append(f"comment fired: {findings}")

            # E. a runtime column list is UNREADABLE, never zero columns.
            (root / SVC).write_text(
                svc.replace('.select("id, order_number, status")', ".select(cols)"),
                encoding="utf-8",
            )
            try:
                globals()["UNREADABLE_READ_CEILING"] = 0
                code, findings = run(root)
                expect("a runtime select over the ceiling", code, 1)
                if not any("cannot resolve statically" in f for f in findings):
                    failures.append(f"unreadable read not counted: {findings}")
            finally:
                globals()["UNREADABLE_READ_CEILING"] = real_ceiling

            # E2. the same runtime name bound to a same-file const IS resolved,
            # and its bad column found.
            (root / SVC).write_text(
                svc.replace(
                    "export class OrdersService {",
                    'const COLS = "id, tags";\nexport class OrdersService {',
                ).replace('.select("id, order_number, status")', ".select(COLS)"),
                encoding="utf-8",
            )
            code, findings = run(root)
            expect("a const-bound select is resolved", code, 1)
            if not any("selects orders.tags" in f for f in findings):
                failures.append(f"const-bound select not resolved: {findings}")

            # E3. a template literal and a `+` chain are both resolved.
            (root / SVC).write_text(
                svc.replace('.select("id, order_number, status")', '.select(`id, tags`)'),
                encoding="utf-8",
            )
            expect("a template literal is resolved", run(root)[0], 1)
            (root / SVC).write_text(
                svc.replace('.select("id, order_number, status")', '.select("id, " + "tags")'),
                encoding="utf-8",
            )
            expect("a concatenated select is resolved", run(root)[0], 1)

            # F. an unrelated `.from(A)` and a `.select` on another chain are not
            # paired across a statement boundary.
            (root / SVC).write_text(
                svc.replace(
                    "  async starred() {",
                    "  async unrelated() {\n"
                    '    const t = await this.db.supabase.from("debt_table").select("id");\n'
                    '    await other.select("tags");\n'
                    "  }\n"
                    "  async starred() {",
                ),
                encoding="utf-8",
            )
            code, findings = run(root)
            expect("unrelated .from and .select are not paired", code, 0)
            if findings:
                failures.append(f"cross-statement pairing fired: {findings}")
            (root / SVC).write_text(svc, encoding="utf-8")

            # G. the ratchet, both directions.
            debt = root / "apps/api-gateway/src/orders/debt.ts"
            debt_src = debt.read_text(encoding="utf-8")
            debt.write_text("export class Debt {}\n", encoding="utf-8")
            code, findings = run(root)
            expect("a debt entry nothing reads any more", code, 1)
            if not any("reads it any more" in f for f in findings):
                failures.append(f"stale debt entry not reported: {findings}")
            debt.write_text(debt_src, encoding="utf-8")

            mig = root / MIGRATIONS / "20260101000000_base.sql"
            mig_src = mig.read_text(encoding="utf-8")
            mig.write_text(
                mig_src + "alter table public.debt_table add column zzz_debt_read int;\n",
                encoding="utf-8",
            )
            code, findings = run(root)
            expect("a debt entry the schema now declares", code, 1)
            if not any("now declares that column" in f for f in findings):
                failures.append(f"satisfied debt entry not reported: {findings}")
            mig.write_text(mig_src, encoding="utf-8")

            # G2. an EMPTY debt list is a legal state, not a broken one.
            try:
                globals()["KNOWN_BAD_READ_COLUMNS"] = {}
                debt.write_text("export class Debt {}\n", encoding="utf-8")
                code, findings = run(root)
                expect("an empty debt list is clean", code, 0)
            finally:
                globals()["KNOWN_BAD_READ_COLUMNS"] = {
                    "debt_table.zzz_debt_read": "synthetic, self-test only."
                }
                debt.write_text(debt_src, encoding="utf-8")

            # P. ROW_PROPERTY_READS — the third read shape (ADR 0093).
            # The defect this whole entry exists for: a column read off a
            # `select("*")` row by property name, which names no column in
            # either the projection or a filter, so A and B above cannot see it.
            prop = root / PROP_SVC
            prop_src = prop.read_text(encoding="utf-8")

            prop.write_text(
                prop_src.replace("row.order_number", "row.order_channels"),
                encoding="utf-8",
            )
            code, findings = run(root)
            expect("a property read naming a phantom column", code, 1)
            if not any("reads row.order_channels" in f for f in findings):
                failures.append(f"phantom property read not reported: {findings}")

            # P2. the same phantom name in a comment does NOT fire — the
            # stripper runs before the property scan, as it does for A and B.
            prop.write_text(
                prop_src.replace(
                    "  async load() {",
                    "  // row.order_channels was read here before ADR 0093\n"
                    "  async load() {",
                ),
                encoding="utf-8",
            )
            code, findings = run(root)
            expect("a property read described in a comment", code, 0)
            if findings:
                failures.append(f"commented property read fired: {findings}")

            # P3. a method call is not a column read.
            prop.write_text(
                prop_src.replace("row.created_at", "row.refresh()"),
                encoding="utf-8",
            )
            expect("a method call on the row", run(root)[0], 0)

            # P4. a bad property read already on the debt list is suppressed,
            # so the ratchet governs this shape too rather than routing round it.
            try:
                globals()["KNOWN_BAD_READ_COLUMNS"] = {
                    "orders.order_channels": "synthetic, self-test only.",
                    "debt_table.zzz_debt_read": "synthetic, self-test only.",
                }
                prop.write_text(
                    prop_src.replace("row.order_number", "row.order_channels"),
                    encoding="utf-8",
                )
                expect("a debt-listed property read", run(root)[0], 0)
            finally:
                globals()["KNOWN_BAD_READ_COLUMNS"] = {
                    "debt_table.zzz_debt_read": "synthetic, self-test only."
                }
            prop.write_text(prop_src, encoding="utf-8")

            # H. CANNOT CHECK, not PASS. Each on its own fresh tree so one
            # mutation cannot mask the next.
            def blind(label: str, mutate) -> None:
                r = _fixture(Path(tempfile.mkdtemp(dir=td)))
                mutate(r)
                try:
                    got, _ = run(r)
                except CannotCheck:
                    return
                failures.append(f"{label}: exit {got}, expected CannotCheck (2)")

            blind(
                "the shared parse is gone",
                lambda r: (r / "scripts/check_order_capture_contract.py").unlink(),
            )
            blind(
                "the shared parse stops exporting declared_columns",
                lambda r: (r / "scripts/check_order_capture_contract.py").write_text(
                    "def ts_sources(*a): pass\n", encoding="utf-8"
                ),
            )
            blind(
                "the migrations directory is gone",
                lambda r: (
                    [p.unlink() for p in (r / MIGRATIONS).glob("*.sql")],
                    (r / MIGRATIONS).rmdir(),
                ),
            )
            blind(
                "the migration parse collapses to a handful of tables",
                lambda r: (r / MIGRATIONS / "20260101000000_base.sql").write_text(
                    "create table public.orders (id uuid not null);\n", encoding="utf-8"
                ),
            )
            blind(
                "the source root is emptied",
                lambda r: [p.unlink() for p in (r / READ_ROOTS[0]).rglob("*.ts")],
            )
            # The rot cases for ROW_PROPERTY_READS. An entry that has stopped
            # looking at anything must SAY SO, not pass. This is the whole
            # reason a declared registry is acceptable in the first place.
            blind(
                "a registered property-read file is gone",
                lambda r: (r / PROP_SVC).unlink(),
            )
            blind(
                "a registered property-read variable is renamed away",
                lambda r: (r / PROP_SVC).write_text(
                    (r / PROP_SVC)
                    .read_text(encoding="utf-8")
                    .replace("row.", "renamed."),
                    encoding="utf-8",
                ),
            )
            blind(
                "the site pattern matches nothing",
                lambda r: (r / SVC).write_text(
                    "export class OrdersService {}\n", encoding="utf-8"
                ),
            )
    finally:
        globals()["KNOWN_BAD_READ_COLUMNS"] = real_debt
        globals()["ROW_PROPERTY_READS"] = real_props
        globals()["UNREADABLE_READ_CEILING"] = real_ceiling

    print("== --self-test: read columns exist")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   a tree whose reads name real columns exits 0")
    print('   .select("id, tags") against a table with no tags exits 1 (the ADR 0073 defect)')
    print('   .eq("tenant_id", …) against a table with no such column exits 1')
    print('   "*", an embed, a count option and a bare .select() do NOT fire')
    print("   an embedded resource is skipped, never guessed at")
    print("   the same defect written inside a // or /* */ comment does NOT fire")
    print("   a runtime column list counts as UNREADABLE, never as zero columns")
    print("   a const-bound, template-literal or concatenated select IS resolved")
    print("   an unrelated .from(A) and .select on another chain are NOT paired")
    print("   a debt entry nothing reads any more exits 1")
    print("   a debt entry the schema now declares exits 1")
    print("   an EMPTY debt list is clean, not broken")
    print("   a missing/blank shared parse, migrations dir, root or pattern exits 2")
    print("   a property read off a select(\"*\") row naming a phantom column exits 1")
    print("   that shape respects the comment stripper and the debt ratchet too")
    print("   a registered property-read whose file or variable is gone exits 2")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="prove the failure path fires")
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
