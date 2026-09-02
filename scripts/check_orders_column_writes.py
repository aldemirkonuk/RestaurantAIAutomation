#!/usr/bin/env python3
"""Guard: every key written to a REGISTERED table must be a real column of it.

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
1. INSERTS, ON TABLES WHOSE SPEC SAYS `enforce_inserts=False`. For
   `procurement_orders` that is deliberate: `.update()` is the write path its
   defect was found in, and its insert paths carry separate, already-documented debt
   (`20260901150000_order_line_capture_and_units.sql:190` records two agent
   paths that write `wine_name` and `actual_delivery`, neither a column). They
   are COUNTED and REPORTED on every run under `--report-inserts`, so the hole
   is measured rather than hidden, but they do not fail the build here. Closing
   them is a separate change with a separate decision behind it.
2. TABLES NOT IN `TABLES`. Every table not registered below is invisible here.
   This is a registry, not a sweep: each entry carries its own measured floors,
   its own debt list and its own decision about whether inserts FAIL or are
   merely reported, and none of those can be guessed. `check_order_capture_contract.py`
   Contract E is the wide, shallow pass over every table -- but only over INLINE
   `.insert({...})` object literals, so it cannot see an update, a payload built
   in a local `const`, or an array built by `.push()`. The two are complements.
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
from functools import lru_cache

MIGRATIONS_DIR = "supabase/migrations"

TS_ROOTS = [
    "apps/api-gateway/src",
    # Scanned rather than dropped: if the web app ever grows a direct PostgREST
    # write to one of these tables, that is precisely when someone needs to be told.
    "apps/web/src",
]

TS_SKIP_RE = re.compile(r"(\.spec\.tsx?$|\.test\.tsx?$|/__tests__/|/__mocks__/|/e2e/)")


@dataclass(frozen=True)
class Debt:
    """One already-broken write, pinned to the FILE it is broken in.

    Keyed by column alone, a debt entry silently covers every other site that
    writes the same column -- including one added tomorrow. `calendar_events`
    made that concrete: `priority` and `tags` were written from TWO files, and a
    column-only entry would have gone green over both while only one was
    actually being tracked. So an entry names its files, and a write of the same
    column from anywhere else is NEW.
    """

    reason: str
    #: Path suffixes this debt covers. A site outside them is a NEW violation.
    files: tuple[str, ...]


@dataclass(frozen=True)
class TableSpec:
    """One registered table, with the floors and the debt that belong to IT.

    Nothing here is shared between tables by default. A floor measured on
    `procurement_orders` says nothing about `calendar_events`, and a debt entry
    is always about a specific site in a specific file.
    """

    name: str
    #: Below this, the SQL parse has rotted and every written key would look
    #: like a violation. Measured, then floored well under the measurement.
    min_columns: int
    #: Below this, the extractor has stopped finding call sites -- which reads
    #: as a clean tree, the same lie in a new place.
    min_update_sites: int
    min_insert_sites: int
    #: True -> an insert naming a phantom column FAILS. False -> reported only.
    enforce_inserts: bool
    #: Shrink-only debt ratchet, enforced in both directions. See KNOWN_BAD below.
    known_bad: dict[str, Debt]
    #: Payloads this guard cannot read. A measurement, not a budget.
    dynamic_ceiling: int


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
PROCUREMENT_ORDERS_KNOWN_BAD: dict[str, Debt] = {
    "location_id": Debt(
        files=("procurement/procurement.service.ts",),
        reason=(
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
    ),
}

CALENDAR_EVENTS_KNOWN_BAD: dict[str, Debt] = {
    "priority": Debt(
        files=("procurement/procurement.service.ts",),
        reason=(
        "procurement.service.ts createCalendarEventForOrder (~:1969). "
        "`calendar_events` has never had `priority` or `tags` -- verified against "
        "production 2026-09-02, 0 of 2 present in information_schema. "
        "recurring-orders.service.ts wrote both too and is FIXED in this change "
        "(ADR 0068); the procurement.service.ts site is owned by a concurrent "
        "change and is recorded here so this guard is green-on-arrival rather "
        "than blocked on someone else's branch. DELETE BOTH ENTRIES the moment "
        "that site is fixed -- the ratchet fails if they stop matching."
        ),
    ),
    "tags": Debt(
        files=("procurement/procurement.service.ts",),
        reason=(
        "procurement.service.ts createCalendarEventForOrder (~:1970). Same site "
        "and same fix as calendar_events.priority. Note the write is also the "
        "READ side of a dead linkage: the pre-fix recurring materialiser looked "
        "its own event up with `.like(\"tags\", '%uuid%')`."
        ),
    ),
}

TABLES: tuple[TableSpec, ...] = (
    TableSpec(
        name="procurement_orders",
        # Production has 56 columns; the repo's migrations replay to the same 56.
        min_columns=40,
        # Measured 2026-09-01: 12 update sites across the gateway.
        min_update_sites=6,
        min_insert_sites=1,
        # Reported, not enforced -- see WHAT IT DOES NOT CATCH #1.
        enforce_inserts=False,
        known_bad=PROCUREMENT_ORDERS_KNOWN_BAD,
        dynamic_ceiling=0,
    ),
    TableSpec(
        name="calendar_events",
        # Production has 33 columns before this change's migration, 34 after
        # (verified 2026-09-02). A floor of 20 catches a rotted parse without
        # tripping on an ordinary ALTER.
        min_columns=20,
        # Measured 2026-09-02 on this branch.
        min_update_sites=4,
        min_insert_sites=3,
        # ENFORCED. Unlike procurement_orders, this table's defect WAS in the
        # insert path -- `preCreateCalendarEvents` bulk-inserts, and the delivery
        # event is a single insert. A guard that reported them without failing
        # would have been green across the entire outage it exists to prevent.
        enforce_inserts=True,
        known_bad=CALENDAR_EVENTS_KNOWN_BAD,
        dynamic_ceiling=0,
    ),
)


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
#
# The patterns are built PER TABLE. They used to be module-level constants with
# the one table name interpolated in; making them a function is the whole of the
# generalisation on this side.
# ---------------------------------------------------------------------------
@lru_cache(maxsize=None)
def _table_sql_patterns(table: str) -> tuple[re.Pattern, ...]:
    return (
        re.compile(
            r"\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:ONLY\s+)?"
            r"(?:\"?public\"?\.)?\"?(" + re.escape(table) + r")\"?\s*\(",
            re.I,
        ),
        re.compile(
            r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:\"?public\"?\.)?\"?"
            + re.escape(table)
            + r"\"?\b",
            re.I,
        ),
        re.compile(
            r"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:\"?public\"?\.)?\"?"
            + re.escape(table)
            + r"\"?",
            re.I,
        ),
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


def declared_columns(
    migrations: pathlib.Path, table: str
) -> tuple[set[str], list[str], int]:
    """Replay the migration directory in version order. (columns, problems, files)."""
    create_re, alter_re, drop_table_re = _table_sql_patterns(table)
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

        for m in create_re.finditer(text):
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

        if drop_table_re.search(text):
            columns.clear()
            created = False

        # ALTER TABLE <table> ... up to the terminating semicolon. One statement
        # can carry several `add column if not exists` clauses -- migration
        # 20260901150000 adds created_by, source and recurring_order_id in one.
        for m in alter_re.finditer(text):
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
            f"no CREATE TABLE for '{table}' found in {MIGRATIONS_DIR} -- either the "
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


@lru_cache(maxsize=None)
def _from_table_re(table: str) -> re.Pattern:
    return re.compile(r"\.from\s*\(\s*[\"'`]" + re.escape(table) + r"[\"'`]\s*\)")


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


def resolve_array_payload(
    text: str, name: str, call_at: int
) -> tuple[list[str], int, bool]:
    """Keys of the object literals pushed into a local array. (keys, unreadable, found).

    WHY THIS EXISTS. `preCreateCalendarEvents` builds its payload as

        const events: any[] = [];
        while (...) { events.push({ ...one event... }); }
        await ...from("calendar_events").insert(events);

    An extractor that understands only object literals and `const x = {...}`
    reports that site as UNREADABLE. That is not a false pass -- the ceiling
    turns it into a failure -- but it is the wrong failure: the guard would say
    "I cannot see this" about the single site the whole change is for, and the
    obvious way to make the message go away is to raise the ceiling. So the
    shape is read instead of merely counted.

    Scoped to the region between the array's nearest preceding declaration and
    the call, for the same reason `resolve_identifier_payload` is: two arrays
    with the same name in two methods must not pool their keys.
    """
    decl_end = -1
    for m in re.finditer(
        r"\b(?:const|let|var)\s+" + re.escape(name) + r"\b[^=;{]*=\s*\[", text
    ):
        if m.start() >= call_at:
            break
        _, end = _balanced(text, m.end() - 1, "[", "]")
        if end == -1:
            continue
        decl_end = end

    if decl_end == -1:
        return [], 0, False

    keys: list[str] = []
    dynamic = 0

    # Elements of the initial literal, plus everything pushed before the call.
    region = text[decl_end:call_at]
    for m in re.finditer(
        r"\b" + re.escape(name) + r"\.(?:push|unshift)\s*\(", region
    ):
        arg, end = _balanced(region, m.end() - 1, "(", ")")
        if end == -1:
            dynamic += 1
            continue
        arg = arg.strip()
        if not arg.startswith("{"):
            # `events.push(buildOne())` -- unreadable, and counted as such.
            dynamic += 1
            continue
        body, e = _balanced(arg, 0, "{", "}")
        if e == -1:
            dynamic += 1
            continue
        k, d = object_literal_keys(body)
        keys.extend(k)
        dynamic += d

    if not keys and not dynamic:
        # An array that is declared and never pushed to is not something this
        # guard can say anything about. Report it rather than passing it.
        return [], 1, True
    return sorted(set(keys)), dynamic, True


def extract_sites(text: str, path: str, table: str) -> list[WriteSite]:
    """Every `.from("<table>")....update|insert(payload)` in one file."""
    sites: list[WriteSite] = []
    for m in _from_table_re(table).finditer(text):
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
            at = m.end() + op_m.end()
            keys, dyn, found = resolve_identifier_payload(text, arg, at)
            if not found:
                # Not an object -- try the array shape (`const rows = []` plus
                # `rows.push({...})`), which is how a bulk insert is built.
                keys, dyn, found = resolve_array_payload(text, arg, at)
            if not found:
                site.resolved = False
                site.why = (
                    f"payload variable '{arg}' is not declared as an object or "
                    f"array literal earlier in this file"
                )
            else:
                site.keys, site.dynamic_keys = keys, dyn
        elif arg.startswith("["):
            # An inline array of object literals: `.insert([{...}, {...}])`.
            body, e = _balanced(arg, 0, "[", "]")
            if e == -1:
                site.resolved = False
                site.why = "unbalanced array literal"
            else:
                keys: list[str] = []
                dyn = 0
                for part in _split_top_level(body):
                    part = part.strip()
                    if part.startswith("{"):
                        ob, oe = _balanced(part, 0, "{", "}")
                        if oe == -1:
                            dyn += 1
                            continue
                        k, d = object_literal_keys(ob)
                        keys.extend(k)
                        dyn += d
                    elif part:
                        dyn += 1
                site.keys, site.dynamic_keys = sorted(set(keys)), dyn
        elif arg.startswith("..."):
            site.resolved = False
            site.why = "spread payload"
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


def scan(repo: pathlib.Path, table: str) -> tuple[list[WriteSite], list[str]]:
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
            if table not in raw:
                continue
            sites.extend(
                extract_sites(strip_ts_comments(raw), str(f.relative_to(repo)), table)
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

SELF_TEST_ARRAY = """
export class Bulk {
  async run() {
    const events: any[] = [];
    while (true) {
      events.push({ restaurant_id: r, status: "pending", priority: "MEDIUM" });
    }
    await this.db.supabase.from("calendar_events").insert(events);
  }
}
"""

SELF_TEST_ARRAY_SCOPING = """
export class TwoArrays {
  async first() {
    const rows: any[] = [];
    rows.push({ status: "pending" });
    await this.db.supabase.from("calendar_events").insert(rows);
  }
  async second() {
    const rows: any[] = [];
    rows.push({ leaked_from_second: 1 });
    await this.db.supabase.from("calendar_events").insert(rows);
  }
}
"""

SELF_TEST_INLINE_ARRAY = """
export class InlineArray {
  async run() {
    await this.db.supabase
      .from("calendar_events")
      .insert([{ status: "pending" }, { bogus_inline: 1 }]);
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
        cols, probs, n = declared_columns(d, "procurement_orders")
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
    bad = extract_sites(
        strip_ts_comments(SELF_TEST_BAD), "self_test_bad.ts", "procurement_orders"
    )
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

    good = extract_sites(
        strip_ts_comments(SELF_TEST_GOOD), "self_test_good.ts", "procurement_orders"
    )
    good_keys = set(good[0].keys) if good else set()
    check("good fixture yields a site", len(good) == 1)
    check("good fixture is CLEAN", not [k for k in good_keys if k not in schema], sorted(good_keys))

    other = extract_sites(
        strip_ts_comments(SELF_TEST_OTHER_TABLE), "self_test_other.ts", "procurement_orders"
    )
    check("another table's update is not attributed here", other == [], str(other))

    commented = extract_sites(
        strip_ts_comments(SELF_TEST_COMMENTED), "self_test_comment.ts", "procurement_orders"
    )
    com_keys = set(k for s in commented for k in s.keys)
    check("commented-out call sites ignored", com_keys == {"status"}, sorted(com_keys))

    weird = extract_sites(
        strip_ts_comments(SELF_TEST_UNRESOLVABLE), "self_test_weird.ts", "procurement_orders"
    )
    check(
        "an unreadable payload is reported, not silently skipped",
        len(weird) == 1 and not weird[0].resolved,
        str(weird),
    )

    print()
    print("== --self-test: the generalisation (a second table, and bulk inserts)")
    # The whole point of parameterising the table: a write to calendar_events
    # must be found when calendar_events is asked for, and NOT when
    # procurement_orders is.
    arr_cal = extract_sites(
        strip_ts_comments(SELF_TEST_ARRAY), "self_test_array.ts", "calendar_events"
    )
    arr_po = extract_sites(
        strip_ts_comments(SELF_TEST_ARRAY), "self_test_array.ts", "procurement_orders"
    )
    arr_keys = set(arr_cal[0].keys) if arr_cal else set()
    check("a bulk insert built by .push() is READ, not just counted", len(arr_cal) == 1 and arr_cal[0].resolved, str(arr_cal))
    check("pushed object keys are extracted", {"restaurant_id", "status", "priority"} <= arr_keys, sorted(arr_keys))
    check("the same file yields nothing for a table it does not write", arr_po == [], str(arr_po))

    scoped = extract_sites(
        strip_ts_comments(SELF_TEST_ARRAY_SCOPING), "self_test_scope.ts", "calendar_events"
    )
    check("two same-named arrays yield two sites", len(scoped) == 2, str(len(scoped)))
    check(
        "a later array's keys are not attributed to the earlier insert",
        bool(scoped) and "leaked_from_second" not in set(scoped[0].keys),
        str(scoped[0].keys) if scoped else "no sites",
    )

    inline = extract_sites(
        strip_ts_comments(SELF_TEST_INLINE_ARRAY), "self_test_inline.ts", "calendar_events"
    )
    inline_keys = set(inline[0].keys) if inline else set()
    check("an inline array of literals is read", {"status", "bogus_inline"} <= inline_keys, sorted(inline_keys))

    check("the registry has at least two tables", len(TABLES) >= 2, str([s.name for s in TABLES]))
    check(
        "every debt entry pins itself to at least one file",
        all(e.files for spec in TABLES for e in spec.known_bad.values()),
    )
    # The hole a column-only debt list leaves: the SAME column written from a
    # DIFFERENT file must still be NEW.
    fake = TableSpec(
        name="calendar_events", min_columns=1, min_update_sites=0,
        min_insert_sites=0, enforce_inserts=True,
        known_bad={"tags": Debt(reason="x", files=("owned/by_someone_else.ts",))},
        dynamic_ceiling=0,
    )
    entry = fake.known_bad["tags"]
    check(
        "debt covers only the file it names",
        any("elsewhere/mine.ts".endswith(f) for f in entry.files) is False
        and any("owned/by_someone_else.ts".endswith(f) for f in entry.files) is True,
    )
    check(
        "every registered table enforces or explicitly waives inserts",
        all(isinstance(s.enforce_inserts, bool) for s in TABLES),
    )

    print()
    if ok:
        print("PASS -- the guard detects what it claims to detect.")
        return 0
    print("FAIL (exit 2) -- the guard's own detection is broken; its verdict on the")
    print("       real tree cannot be trusted.")
    return 2


# ---------------------------------------------------------------------------
def check_table(
    repo: pathlib.Path, spec: TableSpec, args: argparse.Namespace
) -> tuple[int, list[str]]:
    """Run the whole comparison for one table. (fail_flag, blocked_reasons)."""
    blocked: list[str] = []
    fail = 0

    migrations = repo / MIGRATIONS_DIR
    columns, sql_problems, nfiles = declared_columns(migrations, spec.name)
    blocked.extend(sql_problems)

    print()
    print(f"########## {spec.name} ##########")
    print(
        f"== {MIGRATIONS_DIR} declares {len(columns)} columns on '{spec.name}' "
        f"(replayed across {nfiles} file(s))"
    )
    if len(columns) < spec.min_columns:
        blocked.append(
            f"only {len(columns)} columns parsed for '{spec.name}', below the "
            f"{spec.min_columns} floor. The SQL patterns have rotted, and every "
            f"key the code writes would look like a violation."
        )

    sites, scan_problems = scan(repo, spec.name)
    blocked.extend(scan_problems)
    updates = [s for s in sites if s.op == "update"]
    inserts = [s for s in sites if s.op == "insert"]

    enforced = updates + (inserts if spec.enforce_inserts else [])
    reported_only = [] if spec.enforce_inserts else inserts

    print(
        f"== code writes to '{spec.name}': {len(updates)} update site(s), "
        f"{len(inserts)} insert site(s); inserts are "
        f"{'ENFORCED' if spec.enforce_inserts else 'reported only'}"
    )
    if args.list_sites:
        for s in sites:
            detail = (
                "keys=" + ",".join(sorted(s.keys))
                if s.resolved
                else "UNRESOLVED: " + s.why
            )
            print(f"     {s.path}:{s.line}  .{s.op}({s.arg[:40]}...)  {detail}")

    if not updates:
        blocked.append(
            f"ZERO `.from(\"{spec.name}\").update(...)` sites found. This tree has "
            f"had them since the baseline; finding none means the extraction "
            f"pattern rotted, not that the code is clean."
        )
    elif len(updates) < spec.min_update_sites:
        blocked.append(
            f"only {len(updates)} update site(s) found for '{spec.name}', below "
            f"the {spec.min_update_sites} floor. The extractor is missing call sites."
        )
    if len(inserts) < spec.min_insert_sites:
        blocked.append(
            f"only {len(inserts)} insert site(s) found for '{spec.name}', below "
            f"the {spec.min_insert_sites} floor. The extractor is missing call sites."
        )

    # --- the blind spot, always printed ------------------------------------
    unresolved = [s for s in enforced if not s.resolved]
    unresolved_reported = [s for s in reported_only if not s.resolved]
    dynamic_keys = sum(s.dynamic_keys for s in enforced)
    print(
        f"== blind spot (enforced paths): {len(unresolved)} unreadable payload(s), "
        f"{dynamic_keys} unreadable key(s); ceiling is {spec.dynamic_ceiling}"
    )
    for s in unresolved:
        print(f"     {s.path}:{s.line}  .{s.op}()  {s.why}")
    if len(unresolved) + dynamic_keys > spec.dynamic_ceiling:
        fail = 1
        print()
        print(
            f"FAIL: '{spec.name}' unreadable set grew from {spec.dynamic_ceiling} "
            f"to {len(unresolved) + dynamic_keys}."
        )
        print("   -> Build the payload as an object literal, or as a local `const`")
        print("      this guard can follow.")
        print("   -> If it genuinely cannot be static, raise the spec's")
        print("      dynamic_ceiling and say which site was added and why. Raising")
        print("      it silently is how a guard stops covering its own input.")

    # --- the comparison ----------------------------------------------------
    violations: dict[str, list[WriteSite]] = {}
    for s in enforced:
        for k in s.keys:
            if k not in columns:
                violations.setdefault(k, []).append(s)

    # Split per SITE, not per column: a column on the debt list is only debt in
    # the files that entry names.
    def _covered(column: str, site: WriteSite) -> bool:
        entry = spec.known_bad.get(column)
        return bool(entry) and any(site.path.endswith(f) for f in entry.files)

    new: dict[str, list[WriteSite]] = {}
    debt: dict[str, list[WriteSite]] = {}
    matched_debt: set[str] = set()
    for k, ss in violations.items():
        for s in ss:
            if _covered(k, s):
                debt.setdefault(k, []).append(s)
                matched_debt.add(k)
            else:
                new.setdefault(k, []).append(s)

    print(
        f"== {len(violations)} key(s) written that are not columns "
        f"({len(debt)} known debt, {len(new)} NEW)"
    )

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
        print(
            f"FAIL: {len(new)} key(s) written to '{spec.name}' that no migration declares:"
        )
        for k, ss in sorted(new.items()):
            print(f"     {k}")
            for s in ss:
                print(f"       {s.path}:{s.line}  (.{s.op})")
        print()
        print("   -> PostgREST answers PGRST204 and the whole write is rejected --")
        print("      including every other column in the same payload.")
        print("   -> Write it to the column that exists, or add a migration. Do NOT")
        print("      add it to the spec's known_bad: that list records what was")
        print("      already broken when this guard landed, not a way to keep adding.")

    # Ratchet, both directions.
    for k in spec.known_bad:
        if k in columns:
            fail = 1
            print()
            print(
                f"FAIL: '{spec.name}.{k}' is on the debt list but {MIGRATIONS_DIR} "
                f"now declares it."
            )
            print("   -> Delete the entry. A fixed write left on the list is a hole the")
            print("      guard will happily ignore the next time it reappears.")
        elif k not in matched_debt:
            fail = 1
            print()
            print(
                f"FAIL: '{spec.name}.{k}' is on the debt list but no code in "
                f"{', '.join(spec.known_bad[k].files)} writes it any more."
            )
            print("   -> Delete the entry. An entry the guard never matches is one")
            print("      nobody notices is wrong.")
            print("   -> If this is calendar_events.priority/.tags: ADR 0066 "
                  "(fix/order-calendar-event)")
            print("      just removed the last writer. Delete BOTH entries here AND "
                  "the two in")
            print("      scripts/check_order_capture_contract.py KNOWN_BAD_COLUMNS. "
                  "See ADR 0068.")

    # --- the measured, non-failing hole ------------------------------------
    if reported_only:
        reported_violations: dict[str, list[WriteSite]] = {}
        for s in reported_only:
            for k in s.keys:
                if k not in columns:
                    reported_violations.setdefault(k, []).append(s)
        print()
        print(
            f"== INSERT paths (reported, not enforced -- see the docstring): "
            f"{len(reported_violations)} key(s) that are not columns, "
            f"{len(unresolved_reported)} unreadable payload(s)"
        )
        for s in unresolved_reported:
            print(f"     {s.path}:{s.line}  .insert()  {s.why}")
        if reported_violations and args.report_inserts:
            for k, ss in sorted(reported_violations.items()):
                print(f"     {k}")
                for s in ss:
                    print(f"       {s.path}:{s.line}")
        elif reported_violations:
            print(
                f"     {', '.join(sorted(reported_violations))}   "
                f"(--report-inserts for sites)"
            )

    return fail, blocked


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--self-test", action="store_true", help="prove the guard detects a known-bad input")
    ap.add_argument("--list-sites", action="store_true", help="print every write site found")
    ap.add_argument(
        "--table",
        action="append",
        help="check only these registered tables (default: all)",
    )
    ap.add_argument(
        "--report-inserts",
        action="store_true",
        help="also list insert-path violations on tables where they are reported, never failed",
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    repo = pathlib.Path(__file__).resolve().parent.parent

    migrations = repo / MIGRATIONS_DIR
    if not migrations.is_dir():
        print(f"BLOCKED: '{MIGRATIONS_DIR}' does not exist -- nothing to check against.")
        print("FAIL (exit 2)")
        return 2

    specs = TABLES
    if args.table:
        wanted = {t.lower() for t in args.table}
        specs = tuple(s for s in TABLES if s.name.lower() in wanted)
        unknown = wanted - {s.name.lower() for s in TABLES}
        if unknown:
            # Asking for a table that is not registered must never look like a
            # clean run over it.
            print(f"BLOCKED: not registered in TABLES: {', '.join(sorted(unknown))}")
            print("FAIL (exit 2)")
            return 2
    if not specs:
        print("BLOCKED: no tables selected -- a run that checks nothing is not a pass.")
        print("FAIL (exit 2)")
        return 2

    fail = 0
    blocked: list[str] = []
    for spec in specs:
        f, b = check_table(repo, spec, args)
        fail |= f
        blocked.extend(f"[{spec.name}] {x}" for x in b)

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
        print("FAIL (exit 1) -- the code writes a key its table does not have.")
        return 1
    names = ", ".join(s.name for s in specs)
    print(f"PASS -- every enforced key written to {names} is a real column of it,")
    print("       or is on that table's shrink-only debt list.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
