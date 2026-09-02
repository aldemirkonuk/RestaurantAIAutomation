#!/usr/bin/env python3
"""Guard: every key written to `procurement_orders` must be a real column of it.

WHY THIS EXISTS
---------------
`procurement.service.ts` verifyReceipt built its update payload as

    const update: Record<string, any> = {
      status,
      notes: body.note ?? undefined,     # <- no such column
    };

`procurement_orders` has `delivery_notes`, `manager_notes` and
`discrepancy_notes`. It has never had `notes`. Verified against production on
2026-09-01: 56 columns, and that is not one of them.

The `?? undefined` is what made it survive. supabase-js drops undefined-valued
keys from the JSON body, so the request only ever CARRIED a `notes` key on the
runs where a manager actually typed a note -- that is, only when documenting a
discrepancy. Every quiet delivery passed. The one that mattered got PGRST204
AFTER the ledger correction and the vendor credit claim had already been
written, leaving the order permanently half-verified: status, match_status,
accepted_quantity, invoice_* and the price-history row never landed, and the
retry failed identically. A defect that fires only on the unhappy path, after
the irreversible writes, is exactly the shape a test suite does not stumble on.

WHY NOTHING ELSE CATCHES IT
---------------------------
  * TypeScript cannot. The payload is `Record<string, any>` -- and even a typed
    Database generic would only be as right as the generated types.
  * scripts/check_queried_tables_exist.py works at RELATION granularity. It is
    explicit about this in its own docstring ("WHAT IT DOES NOT CATCH: 1.
    COLUMNS"). `procurement_orders` exists, so that guard is correctly silent.
  * scripts/check_schema_parity.sh compares a database to a database. Both
    sides agree that `notes` does not exist. They are RIGHT. The code is wrong,
    and application code is not in that check's universe at all.

This guard adds the missing comparison: what the CODE WRITES vs what the
MIGRATIONS DECLARE, at column granularity, for one table.

  ./scripts/check_orders_column_writes.py
  ./scripts/check_orders_column_writes.py --self-test   # prove it can detect
  ./scripts/check_orders_column_writes.py --list-sites  # show every site found

Exit 0 = clean.  Exit 1 = a violation.  Exit 2 = the guard could not check what
it claims to check.

NEVER VACUOUS
-------------
Every "found nothing" path is a FAILURE, not a pass:
  * migrations directory missing / unreadable            -> exit 2
  * `procurement_orders` not found in the migrations     -> exit 2
  * fewer than MIN_COLUMNS columns parsed                -> exit 2
  * a scanned root does not exist                        -> exit 2
  * ZERO update sites found                              -> exit 2
  * fewer than MIN_UPDATE_SITES found                    -> exit 2
  * a payload the extractor cannot read, over the ceiling-> exit 1
  * a KNOWN_BAD entry that is now a real column          -> exit 1 (prune it)
  * a KNOWN_BAD entry nothing writes any more            -> exit 1 (prune it)
The floors matter more than the ceiling. A guard that silently stops finding
call sites reports a clean tree, which is the same lie in a new place -- see
the `absence-reported-as-health` note in project memory.

WHAT IT DOES NOT CATCH -- read this before trusting it
------------------------------------------------------
1. INSERTS. Scoped to `.update()` on purpose: this is the write path the defect
   was found in, and the insert paths carry separate, already-documented debt
   (`20260901150000_order_line_capture_and_units.sql:190` records two agent
   paths that write `wine_name` and `actual_delivery`, neither a column). They
   are COUNTED and REPORTED on every run under `--report-inserts`, so the hole
   is measured rather than hidden, but they do not fail the build here. Closing
   them is a separate change with a separate decision behind it.
2. OTHER TABLES. One table, deliberately. The extractor generalises, the column
   census does not -- and a guard that half-covers twenty tables is worse than
   one that fully covers the table a defect was just found in.
3. NON-LITERAL KEYS. `update[someVar] = x` cannot be resolved by reading the
   file. Counted, reported, and ratcheted by DYNAMIC_CEILING.
4. RAW SQL. Anything issued as a SQL string is invisible here.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
from dataclasses import dataclass, field

TABLE = "procurement_orders"
MIGRATIONS_DIR = "supabase/migrations"

TS_ROOTS = [
    "apps/api-gateway/src",
    # Scanned rather than dropped: if the web app ever grows a direct PostgREST
    # write to this table, that is precisely when someone needs to be told.
    "apps/web/src",
]

TS_SKIP_RE = re.compile(r"(\.spec\.tsx?$|\.test\.tsx?$|/__tests__/|/__mocks__/|/e2e/)")

# Sanity floors. Production has 56 columns; the repo's migrations replay to the
# same 56. If this parse ever returns a handful, the SQL patterns have rotted
# and every key in the codebase would look like a violation.
MIN_COLUMNS = 40
# Measured 2026-09-01: 12 update sites across the gateway. A floor well under
# that catches "the extraction pattern stopped matching" without tripping on
# ordinary refactors.
MIN_UPDATE_SITES = 6

# ---------------------------------------------------------------------------
# KNOWN_BAD -- the shrink-only debt ratchet.
#
# NOT approvals. These are writes already broken when this guard landed,
# recorded so the guard can be green-on-arrival and therefore actually block the
# next one. Same posture as KNOWN_MISSING in check_queried_tables_exist.py.
#
# The list is enforced in both directions: an entry that becomes a real column
# fails, and an entry nothing writes any more fails. The only way to touch it is
# to make it shorter.
# ---------------------------------------------------------------------------
KNOWN_BAD: dict[str, str] = {
    "location_id": (
        "procurement.service.ts updateOrder. Same defect class as `notes`, found "
        "by this guard while it was being written for `notes`. `location_id` is "
        "not a column of procurement_orders in supabase/migrations/ OR in "
        "production (checked 2026-09-01, 56 columns). Same `?? undefined` shape, "
        "so it only fires when a client actually sends `locationId` -- and no "
        "client does today: UpdateOrderDto.locationId exists "
        "(dto/procurement.dto.ts:191) and apps/web has an OrderLocationField "
        "component, but nothing wires the field to the PATCH. DELIBERATELY NOT "
        "FIXED HERE: the fix is either a migration adding the column or deleting "
        "the feature, and that is a decision, not a default (CLAUDE.md 0.1). "
        "Filed for the founder; delete this line when it is settled."
    ),
}

# Payload arguments the extractor could not read (`.update(buildIt())`, a spread
# from an unknown source). A measurement, not a budget: the guard fails if it
# grows, so the blind spot cannot expand unnoticed. Measured 2026-09-01: 0.
DYNAMIC_CEILING = 0


# ---------------------------------------------------------------------------
# Comment stripping (line count preserved so reported line numbers stay real)
# ---------------------------------------------------------------------------
def strip_ts_comments(text: str) -> str:
    """Only a `//` that STARTS a line is a comment -- otherwise `https://` dies.

    Block comments are a state machine, and only when the opener starts its
    line, so a `/*` inside a string literal cannot swallow live code. Both rules
    are lifted from scripts/check_queried_tables_exist.py, which learned them
    the hard way (commit 7109522d).
    """
    out: list[str] = []
    in_block = False
    for line in text.split("\n"):
        stripped = line.lstrip()
        if in_block:
            out.append("")
            if "*/" in line:
                in_block = False
            continue
        if stripped.startswith("//") or stripped.startswith("*"):
            out.append("")
            continue
        if stripped.startswith("/*") or stripped.startswith("{/*"):
            out.append("")
            if "*/" not in stripped[stripped.index("/*") + 2 :]:
                in_block = True
            continue
        out.append(line)
    return "\n".join(out)


def strip_sql_comments(text: str) -> str:
    """A CREATE TABLE inside a comment is prose, not schema."""
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return "\n".join(re.sub(r"--.*$", "", line) for line in text.split("\n"))


# ---------------------------------------------------------------------------
# What supabase/migrations/ says the columns ARE
# ---------------------------------------------------------------------------
CREATE_TABLE_RE = re.compile(
    r"\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:ONLY\s+)?"
    r"(?:\"?public\"?\.)?\"?(" + TABLE + r")\"?\s*\(",
    re.I,
)
ALTER_TABLE_RE = re.compile(
    r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:\"?public\"?\.)?\"?"
    + TABLE
    + r"\"?\b",
    re.I,
)
ADD_COLUMN_RE = re.compile(
    r"\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\"?([a-z_][a-z0-9_]*)\"?", re.I
)
DROP_COLUMN_RE = re.compile(
    r"\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?\"?([a-z_][a-z0-9_]*)\"?", re.I
)
RENAME_COLUMN_RE = re.compile(
    r"\bRENAME\s+(?:COLUMN\s+)?\"?([a-z_][a-z0-9_]*)\"?\s+TO\s+\"?([a-z_][a-z0-9_]*)\"?",
    re.I,
)
DROP_TABLE_RE = re.compile(
    r"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:\"?public\"?\.)?\"?" + TABLE + r"\"?", re.I
)

# Words that open a table CONSTRAINT rather than a column, inside CREATE TABLE.
CONSTRAINT_LEAD_RE = re.compile(
    r"^\s*(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|LIKE)\b", re.I
)
# `ADD CONSTRAINT foo ...` is not `ADD COLUMN foo`.
ADD_NON_COLUMN_RE = re.compile(
    r"\bADD\s+(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b", re.I
)


def _split_top_level(body: str) -> list[str]:
    """Split a CREATE TABLE body on commas that are not inside parentheses."""
    parts, depth, cur = [], 0, []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        parts.append("".join(cur))
    return parts


def _balanced_paren(text: str, open_idx: int) -> tuple[str, int]:
    """Body between text[open_idx] == '(' and its match. ('', -1) if unbalanced."""
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1 : i], i
    return "", -1


def declared_columns(migrations: pathlib.Path) -> tuple[set[str], list[str], int]:
    """Replay the migration directory in version order. (columns, problems, files)."""
    columns: set[str] = set()
    problems: list[str] = []
    created = False
    files = sorted(p for p in migrations.glob("*.sql"))

    for f in files:
        try:
            text = strip_sql_comments(f.read_text(encoding="utf-8", errors="replace"))
        except OSError as exc:
            problems.append(f"could not read {f.name}: {exc}")
            continue

        for m in CREATE_TABLE_RE.finditer(text):
            body, end = _balanced_paren(text, m.end() - 1)
            if end == -1:
                problems.append(f"unbalanced CREATE TABLE parens in {f.name}")
                continue
            created = True
            for part in _split_top_level(body):
                part = part.strip()
                if not part or CONSTRAINT_LEAD_RE.match(part):
                    continue
                name = re.match(r'^"?([a-z_][a-z0-9_]*)"?', part, re.I)
                if name:
                    columns.add(name.group(1).lower())

        if DROP_TABLE_RE.search(text):
            columns.clear()
            created = False

        # ALTER TABLE <table> ... up to the terminating semicolon. One statement
        # can carry several `add column if not exists` clauses -- migration
        # 20260901150000 adds created_by, source and recurring_order_id in one.
        for m in ALTER_TABLE_RE.finditer(text):
            semi = text.find(";", m.end())
            stmt = text[m.end() : semi if semi != -1 else len(text)]
            for clause in _split_top_level(stmt):
                if ADD_NON_COLUMN_RE.search(clause):
                    continue
                add = ADD_COLUMN_RE.search(clause)
                if add:
                    columns.add(add.group(1).lower())
            for d in DROP_COLUMN_RE.finditer(stmt):
                columns.discard(d.group(1).lower())
            for r in RENAME_COLUMN_RE.finditer(stmt):
                columns.discard(r.group(1).lower())
                columns.add(r.group(2).lower())

    if not created:
        problems.append(
            f"no CREATE TABLE for '{TABLE}' found in {MIGRATIONS_DIR} -- either the "
            f"table was renamed or the SQL patterns have rotted"
        )
    return columns, problems, len(files)


# ---------------------------------------------------------------------------
# What the code WRITES
# ---------------------------------------------------------------------------
@dataclass
class WriteSite:
    path: str
    line: int
    op: str  # "update" | "insert"
    arg: str
    keys: list[str] = field(default_factory=list)
    resolved: bool = True
    why: str = ""
    dynamic_keys: int = 0


FROM_TABLE_RE = re.compile(r"\.from\s*\(\s*[\"'`]" + TABLE + r"[\"'`]\s*\)")
OP_RE = re.compile(r"\.(update|insert)\s*\(")
IDENT_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def _balanced(text: str, open_idx: int, opener: str, closer: str) -> tuple[str, int]:
    depth = 0
    i = open_idx
    while i < len(text):
        ch = text[i]
        if ch in "\"'`":
            quote = ch
            i += 1
            while i < len(text) and text[i] != quote:
                i += 2 if text[i] == "\\" else 1
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return text[open_idx + 1 : i], i
        i += 1
    return "", -1


def object_literal_keys(body: str) -> tuple[list[str], int]:
    """Top-level keys of an object literal body. (keys, count_of_unreadable).

    Depth-aware, so `metadata: { orderId }` contributes `metadata` and not
    `orderId`. A spread (`...rest`) or a computed key (`[k]: v`) is counted as
    unreadable rather than guessed at.
    """
    keys: list[str] = []
    dynamic = 0
    depth = 0
    i = 0
    at_key_position = True
    while i < len(body):
        ch = body[i]
        if ch in "\"'`" and depth == 0 and at_key_position:
            quote = ch
            j = i + 1
            buf = []
            while j < len(body) and body[j] != quote:
                buf.append(body[j])
                j += 2 if body[j] == "\\" else 1
            name = "".join(buf)
            # A quoted key is only a key if a colon follows it.
            k = j + 1
            while k < len(body) and body[k].isspace():
                k += 1
            if k < len(body) and body[k] == ":":
                keys.append(name)
                at_key_position = False
            i = j + 1
            continue
        if ch in "\"'`":
            _, end = _balanced(body, i, ch, ch)
            i = (end if end != -1 else i) + 1
            continue
        if ch in "{[(":
            depth += 1
            i += 1
            continue
        if ch in "}])":
            depth -= 1
            i += 1
            continue
        if ch == "," and depth == 0:
            at_key_position = True
            i += 1
            continue
        if depth == 0 and at_key_position:
            if body.startswith("...", i):
                dynamic += 1
                at_key_position = False
                i += 3
                continue
            m = re.match(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*([:,}]|$)", body[i:])
            if m:
                keys.append(m.group(1))
                at_key_position = False
                i += m.end(1)
                continue
            if body[i] == "[":  # computed key, unreachable (handled above)
                dynamic += 1
                at_key_position = False
            if not body[i].isspace():
                at_key_position = False
        i += 1
    return keys, dynamic


ASSIGN_KEY_RE = r"(?:\.([A-Za-z_$][A-Za-z0-9_$]*)|\[\s*[\"'`]([a-z_][a-z0-9_]*)[\"'`]\s*\])\s*="
DYNAMIC_ASSIGN_RE = r"\[\s*(?![\"'`])[^\]]+\]\s*="


def resolve_identifier_payload(
    text: str, name: str, call_at: int
) -> tuple[list[str], int, bool]:
    """Keys assigned to a local object variable. (keys, unreadable, found_any).

    Covers the three shapes this codebase actually uses to build a payload
    before handing it to `.update()`:
        const NAME = { ... };
        Object.assign(NAME, { ... });
        NAME.key = ...;   /   NAME["key"] = ...;

    This is the part that matters. An extractor that read only inline object
    literals would have missed the `notes` defect entirely, because verifyReceipt
    builds `const update: Record<string, any> = {...}` and passes the variable --
    and a guard that cannot see the one defect it was written for is worse than
    no guard at all.

    SCOPED to the region between the NEAREST PRECEDING declaration of `name` and
    the call site at `call_at`. A file-wide search is wrong and was measured to
    be wrong: `procurement.service.ts` declares `const updatePayload` twice, in
    two different methods writing two different tables, and a file-wide search
    attributed the second one's `updatePayload.content = ...` to the first one's
    update -- reporting a `content` column write that does not exist. A guard
    that invents violations gets switched off, so this window is not a nicety.
    """
    keys: list[str] = []
    dynamic = 0

    decl_start = -1
    decl_body_end = -1
    for m in re.finditer(
        r"\b(?:const|let|var)\s+" + re.escape(name) + r"\b[^=;{]*=\s*\{", text
    ):
        if m.start() >= call_at:
            break
        body, end = _balanced(text, m.end() - 1, "{", "}")
        if end == -1:
            continue
        decl_start, decl_body_end = m.start(), end
        decl_keys, decl_dyn = object_literal_keys(body)

    if decl_start == -1:
        return [], 0, False

    keys.extend(decl_keys)
    dynamic += decl_dyn

    # Mutations between the declaration and the call. Anything after the call
    # belongs to a later statement (or a later redeclaration) and is not part of
    # this payload.
    region = text[decl_body_end:call_at]

    for m in re.finditer(
        r"\bObject\.assign\s*\(\s*" + re.escape(name) + r"\s*,\s*\{", region
    ):
        body, end = _balanced(region, m.end() - 1, "{", "}")
        if end != -1:
            k, d = object_literal_keys(body)
            keys.extend(k)
            dynamic += d

    for m in re.finditer(r"\b" + re.escape(name) + ASSIGN_KEY_RE, region):
        keys.append(m.group(1) or m.group(2))

    for _ in re.finditer(r"\b" + re.escape(name) + DYNAMIC_ASSIGN_RE, region):
        dynamic += 1

    return sorted(set(keys)), dynamic, True


def extract_sites(text: str, path: str) -> list[WriteSite]:
    """Every `.from("procurement_orders")....update|insert({...})` in one file."""
    sites: list[WriteSite] = []
    for m in FROM_TABLE_RE.finditer(text):
        # The chain belongs to this .from() until the statement ends or another
        # .from() begins. Without that bound, a later `.update()` on a different
        # table would be attributed here.
        rest = text[m.end() :]
        stop = len(rest)
        nxt = re.search(r"\.from\s*\(", rest)
        if nxt:
            stop = min(stop, nxt.start())
        depth = 0
        for i, ch in enumerate(rest[:stop]):
            if ch in "({[":
                depth += 1
            elif ch in ")}]":
                depth -= 1
            elif ch == ";" and depth <= 0:
                stop = i
                break
        window = rest[:stop]

        op_m = OP_RE.search(window)
        if not op_m:
            continue
        arg_body, end = _balanced(window, op_m.end() - 1, "(", ")")
        line = text.count("\n", 0, m.start()) + 1
        if end == -1:
            sites.append(
                WriteSite(path, line, op_m.group(1), "<unbalanced>", resolved=False,
                          why="could not find the closing paren of the payload")
            )
            continue

        arg = arg_body.strip()
        site = WriteSite(path, line, op_m.group(1), arg)

        if arg.startswith("{"):
            body, e = _balanced(arg, 0, "{", "}")
            if e == -1:
                site.resolved = False
                site.why = "unbalanced object literal"
            else:
                site.keys, site.dynamic_keys = object_literal_keys(body)
        elif IDENT_RE.match(arg):
            keys, dyn, found = resolve_identifier_payload(
                text, arg, m.end() + op_m.end()
            )
            if not found:
                site.resolved = False
                site.why = (
                    f"payload variable '{arg}' is not declared as an object "
                    f"literal earlier in this file"
                )
            else:
                site.keys, site.dynamic_keys = keys, dyn
        elif arg.startswith("[") or arg.startswith("..."):
            site.resolved = False
            site.why = "array / spread payload"
        else:
            site.resolved = False
            site.why = f"payload expression is not a literal or an identifier: {arg[:60]}"

        sites.append(site)
    return sites


def collect_files(root: pathlib.Path) -> list[pathlib.Path]:
    out: list[pathlib.Path] = []
    for ext in ("*.ts", "*.tsx"):
        for f in root.rglob(ext):
            if TS_SKIP_RE.search(str(f)) or TS_SKIP_RE.search(f.name):
                continue
            out.append(f)
    return sorted(out)


def scan(repo: pathlib.Path) -> tuple[list[WriteSite], list[str]]:
    sites: list[WriteSite] = []
    problems: list[str] = []
    for r in TS_ROOTS:
        rp = repo / r
        if not rp.is_dir():
            problems.append(f"scanned root '{r}' does not exist -- the tree moved")
            continue
        for f in collect_files(rp):
            try:
                raw = f.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                problems.append(f"could not read {f}: {exc}")
                continue
            if TABLE not in raw:
                continue
            sites.extend(
                extract_sites(strip_ts_comments(raw), str(f.relative_to(repo)))
            )
    return sites, problems


# ---------------------------------------------------------------------------
# Self-test: prove the guard detects a known-bad input.
# ---------------------------------------------------------------------------
SELF_TEST_BAD = """
export class Bad {
  async verify(body: any) {
    const update: Record<string, any> = {
      status,
      notes: body.note ?? undefined,
      metadata: { orderId: 1, notAColumn: 2 },
    };
    Object.assign(update, { match_status: "x", bogus_assigned: 1 });
    update.also_bogus = 2;
    update["quoted_bogus"] = 3;
    await this.db.supabase
      .from("procurement_orders")
      .update(update)
      .eq("id", id);
  }
}
"""

SELF_TEST_GOOD = """
export class Good {
  async verify(body: any) {
    await this.db.supabase
      .from("procurement_orders")
      .update({ status, delivery_notes: body.note, quantity_received: 3 })
      .eq("id", id);
  }
}
"""

SELF_TEST_OTHER_TABLE = """
export class Other {
  async run() {
    await this.db.supabase.from("restaurant_inventory").update({ notes: 1 }).eq("id", id);
    await this.db.supabase.from("procurement_orders").select("*").eq("id", id).single();
  }
}
"""

SELF_TEST_COMMENTED = """
export class Commented {
  async run() {
    // .from("procurement_orders").update({ notes: 1 })
    /* .from("procurement_orders").update({ also_fake: 1 }) */
    await this.db.supabase.from("procurement_orders").update({ status }).eq("id", id);
  }
}
"""

SELF_TEST_UNRESOLVABLE = """
export class Weird {
  async run() {
    await this.db.supabase.from("procurement_orders").update(buildPayload()).eq("id", id);
  }
}
"""

SELF_TEST_SQL = """
create table public.procurement_orders (
  id uuid not null,
  status varchar(50) not null,
  delivery_notes text,
  constraint procurement_orders_pkey primary key (id)
);
alter table public.procurement_orders
  add column if not exists created_by uuid,
  add column if not exists source varchar(20);
alter table public.procurement_orders
  drop constraint if exists procurement_orders_source_check,
  add  constraint procurement_orders_source_check check (source is null);
alter table public.procurement_orders add column quantity_received integer;
alter table public.procurement_orders drop column source;
alter table public.procurement_orders rename column created_by to placed_by;
-- alter table public.procurement_orders add column commented_out text;
"""


def self_test() -> int:
    """Assert the guard both FIRES on bad input and STAYS QUIET on good input.

    A detector that only ever says yes is not a detector, so both directions are
    checked, along with the two ways this guard could go quietly blind: reading a
    different table's write, and reading a commented-out one.
    """
    ok = True

    def check(label: str, condition: bool, detail: object = "") -> None:
        nonlocal ok
        # Detail is printed only on a failure: a self-test that dumps its
        # fixtures on every green run trains people to stop reading it.
        suffix = f"  {detail}" if (detail and not condition) else ""
        print(f"   {'PASS' if condition else 'FAIL'}  {label}{suffix}")
        if not condition:
            ok = False

    print("== --self-test: SQL column replay")
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        d = pathlib.Path(tmp)
        (d / "0001_x.sql").write_text(SELF_TEST_SQL, encoding="utf-8")
        cols, probs, n = declared_columns(d)
    check("CREATE TABLE columns parsed", {"id", "status", "delivery_notes"} <= cols, sorted(cols))
    check("table CONSTRAINT is not read as a column", "constraint" not in cols)
    check("multi-clause ADD COLUMN IF NOT EXISTS parsed", "source" not in cols and "placed_by" in cols)
    check("plain ADD COLUMN parsed", "quantity_received" in cols)
    check("DROP COLUMN removes it", "source" not in cols)
    check("RENAME COLUMN moves it", "created_by" not in cols and "placed_by" in cols)
    check("ADD CONSTRAINT is not read as ADD COLUMN", "procurement_orders_source_check" not in cols)
    check("commented-out ADD COLUMN ignored", "commented_out" not in cols)
    check("no parse problems reported", not probs, str(probs))

    print()
    print("== --self-test: call-site extraction")
    bad = extract_sites(strip_ts_comments(SELF_TEST_BAD), "self_test_bad.ts")
    check("one update site found in the bad fixture", len(bad) == 1, f"got {len(bad)}")
    bad_keys = set(bad[0].keys) if bad else set()
    check("literal key read", "notes" in bad_keys)
    check("Object.assign key read", "bogus_assigned" in bad_keys)
    check("member assignment read", "also_bogus" in bad_keys)
    check("bracket-string assignment read", "quoted_bogus" in bad_keys)
    check("nested object keys NOT hoisted", "notAColumn" not in bad_keys, sorted(bad_keys))

    schema = {"status", "delivery_notes", "quantity_received", "metadata", "match_status"}
    violations = sorted(k for k in bad_keys if k not in schema)
    check(
        "bad fixture is DETECTED",
        {"notes", "bogus_assigned", "also_bogus", "quoted_bogus"} <= set(violations),
        str(violations),
    )

    good = extract_sites(strip_ts_comments(SELF_TEST_GOOD), "self_test_good.ts")
    good_keys = set(good[0].keys) if good else set()
    check("good fixture yields a site", len(good) == 1)
    check("good fixture is CLEAN", not [k for k in good_keys if k not in schema], sorted(good_keys))

    other = extract_sites(strip_ts_comments(SELF_TEST_OTHER_TABLE), "self_test_other.ts")
    check("another table's update is not attributed here", other == [], str(other))

    commented = extract_sites(strip_ts_comments(SELF_TEST_COMMENTED), "self_test_comment.ts")
    com_keys = set(k for s in commented for k in s.keys)
    check("commented-out call sites ignored", com_keys == {"status"}, sorted(com_keys))

    weird = extract_sites(strip_ts_comments(SELF_TEST_UNRESOLVABLE), "self_test_weird.ts")
    check(
        "an unreadable payload is reported, not silently skipped",
        len(weird) == 1 and not weird[0].resolved,
        str(weird),
    )

    print()
    if ok:
        print("PASS -- the guard detects what it claims to detect.")
        return 0
    print("FAIL (exit 2) -- the guard's own detection is broken; its verdict on the")
    print("       real tree cannot be trusted.")
    return 2


# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--self-test", action="store_true", help="prove the guard detects a known-bad input")
    ap.add_argument("--list-sites", action="store_true", help="print every write site found")
    ap.add_argument(
        "--report-inserts",
        action="store_true",
        help="also list insert-path violations (reported, never failed -- see the docstring)",
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    repo = pathlib.Path(__file__).resolve().parent.parent
    blocked: list[str] = []
    fail = 0

    # --- what the schema says --------------------------------------------
    migrations = repo / MIGRATIONS_DIR
    if not migrations.is_dir():
        print(f"BLOCKED: '{MIGRATIONS_DIR}' does not exist -- nothing to check against.")
        print("FAIL (exit 2)")
        return 2
    columns, sql_problems, nfiles = declared_columns(migrations)
    blocked.extend(sql_problems)

    print(f"== {MIGRATIONS_DIR} declares {len(columns)} columns on '{TABLE}' "
          f"(replayed across {nfiles} file(s))")
    if len(columns) < MIN_COLUMNS:
        blocked.append(
            f"only {len(columns)} columns parsed for '{TABLE}', below the "
            f"{MIN_COLUMNS} floor. The SQL patterns have rotted, and every key "
            f"the code writes would look like a violation."
        )

    # --- what the code writes ---------------------------------------------
    sites, scan_problems = scan(repo)
    blocked.extend(scan_problems)
    updates = [s for s in sites if s.op == "update"]
    inserts = [s for s in sites if s.op == "insert"]

    print(f"== code writes to '{TABLE}': {len(updates)} update site(s), "
          f"{len(inserts)} insert site(s)")
    if args.list_sites:
        for s in sites:
            print(f"     {s.path}:{s.line}  .{s.op}({s.arg[:40]}...)  "
                  f"{'keys=' + ','.join(sorted(s.keys)) if s.resolved else 'UNRESOLVED: ' + s.why}")

    if not updates:
        blocked.append(
            f"ZERO `.from(\"{TABLE}\").update(...)` sites found. This tree has "
            f"had them since the baseline; finding none means the extraction "
            f"pattern rotted, not that the code is clean."
        )
    elif len(updates) < MIN_UPDATE_SITES:
        blocked.append(
            f"only {len(updates)} update site(s) found, below the "
            f"{MIN_UPDATE_SITES} floor. The extractor is missing call sites."
        )

    # --- the blind spot, always printed ------------------------------------
    #
    # Ratcheted over the UPDATE sites only, because updates are what this guard
    # enforces. An unreadable insert payload is printed below it, in the same
    # breath as the insert violations it belongs with -- claiming to ratchet a
    # blind spot on a path the guard does not check would be its own small lie.
    unresolved = [s for s in sites if not s.resolved and s.op == "update"]
    unresolved_inserts = [s for s in sites if not s.resolved and s.op == "insert"]
    dynamic_keys = sum(s.dynamic_keys for s in sites if s.op == "update")
    print(f"== blind spot (update paths): {len(unresolved)} unreadable payload(s), "
          f"{dynamic_keys} unreadable key(s); ceiling is {DYNAMIC_CEILING}")
    for s in unresolved:
        print(f"     {s.path}:{s.line}  .{s.op}()  {s.why}")
    if len(unresolved) + dynamic_keys > DYNAMIC_CEILING:
        fail = 1
        print()
        print(f"FAIL: the unreadable set grew from {DYNAMIC_CEILING} to "
              f"{len(unresolved) + dynamic_keys}.")
        print("   -> Build the payload as an object literal, or as a local `const`")
        print("      this guard can follow.")
        print("   -> If it genuinely cannot be static, raise DYNAMIC_CEILING and say")
        print("      in the comment which site was added and why. Raising it silently")
        print("      is how a guard stops covering its own input.")

    # --- the comparison ----------------------------------------------------
    violations: dict[str, list[WriteSite]] = {}
    for s in updates:
        for k in s.keys:
            if k not in columns:
                violations.setdefault(k, []).append(s)

    new = {k: v for k, v in violations.items() if k not in KNOWN_BAD}
    debt = {k: v for k, v in violations.items() if k in KNOWN_BAD}

    print(f"== {len(violations)} key(s) written that are not columns "
          f"({len(debt)} known debt, {len(new)} NEW)")

    if debt:
        print()
        print("   KNOWN DEBT -- broken today, tracked, not approved:")
        for k, ss in sorted(debt.items()):
            first = f"{ss[0].path}:{ss[0].line}"
            more = f" (+{len(ss) - 1} more)" if len(ss) > 1 else ""
            print(f"     {k:24s} {first}{more}")

    if new:
        fail = 1
        print()
        print(f"FAIL: {len(new)} key(s) written to '{TABLE}' that no migration declares:")
        for k, ss in sorted(new.items()):
            print(f"     {k}")
            for s in ss:
                print(f"       {s.path}:{s.line}")
        print()
        print("   -> PostgREST answers PGRST204 and the whole update is rejected --")
        print("      including every other column in the same payload.")
        print("   -> Write it to the column that exists, or add a migration. Do NOT")
        print("      add it to KNOWN_BAD: that list records what was already broken")
        print("      when this guard landed, not a way to keep adding to it.")

    # Ratchet, both directions.
    for k in KNOWN_BAD:
        if k in columns:
            fail = 1
            print()
            print(f"FAIL: '{k}' is on the debt list but {MIGRATIONS_DIR} now declares it.")
            print("   -> Delete the entry. A fixed write left on the list is a hole the")
            print("      guard will happily ignore the next time it reappears.")
        elif k not in violations:
            fail = 1
            print()
            print(f"FAIL: '{k}' is on the debt list but no code writes it any more.")
            print("   -> Delete the entry. An entry the guard never matches is one")
            print("      nobody notices is wrong.")

    # --- the measured, non-failing hole ------------------------------------
    insert_violations: dict[str, list[WriteSite]] = {}
    for s in inserts:
        for k in s.keys:
            if k not in columns:
                insert_violations.setdefault(k, []).append(s)
    print()
    print(f"== INSERT paths (reported, not enforced -- see the docstring): "
          f"{len(insert_violations)} key(s) that are not columns, "
          f"{len(unresolved_inserts)} unreadable payload(s)")
    for s in unresolved_inserts:
        print(f"     {s.path}:{s.line}  .insert()  {s.why}")
    if insert_violations and args.report_inserts:
        for k, ss in sorted(insert_violations.items()):
            print(f"     {k}")
            for s in ss:
                print(f"       {s.path}:{s.line}")
    elif insert_violations:
        print(f"     {', '.join(sorted(insert_violations))}   (--report-inserts for sites)")

    # --- verdict -----------------------------------------------------------
    print()
    if blocked:
        print("BLOCKED: this guard could not check what it claims to check.")
        for b in blocked:
            print(f"   * {b}")
        print()
        print("FAIL (exit 2) -- reported as a failure, not a pass. A check that goes")
        print("       green because it found nothing to inspect is the exact shape of")
        print("       the defect it was written to catch.")
        return 2
    if fail:
        print(f"FAIL (exit 1) -- the code writes a key '{TABLE}' does not have.")
        return 1
    print(f"PASS -- every key written to '{TABLE}' is a real column of it,")
    print(f"       or is on the shrink-only debt list ({len(KNOWN_BAD)} entries).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
