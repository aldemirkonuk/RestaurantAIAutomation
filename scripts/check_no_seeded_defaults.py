#!/usr/bin/env python3
"""
Guard: a rebuilt surface never installs data a tenant did not create.

    ./scripts/check_no_seeded_defaults.py
    ./scripts/check_no_seeded_defaults.py --self-test

WHY THIS IS A GUARD AND NOT A CONVENTION
----------------------------------------
`apps/web/src/hooks/useStorageLocations.ts` declared four cellar zones with
invented capacities and temperatures — Main Cellar 500 slots 55°F 70%, Bar Stock
100 slots 58°F, Overflow Storage 200 slots, VIP Reserve 50 slots 53°F — and used
them three ways at once:

    :81   `placeholderData` — shown before the query answered
    :76   the queryFn's RETURN VALUE when the server sent an empty array
    :100  the `??` fallback when the fetch failed

Because the queryFn *returned* them, the effect at `:107-139` could not tell a
fallback from a measurement, its `allAreDefaults` guard passed, and it **POSTed
all four into the tenant's own `storage_locations` table**.

Measured on production `exzueerziesmczwlhomd`, 2026-09-02: 87 rows across 7
tenants, **84 of them carrying one of those four names**, across **6 tenants**,
first written 2026-05-20, most recent 2026-07-30 — 21 rows per name. It re-seeded
repeatedly, because `didSeedRef` was reset on every failure (`:137`).

Three different truths — "not asked yet", "asked, none exist", "asked, no answer"
— rendered as one confident list of four, and one of them was durable.

A reviewer will not catch the next one. Each of the three uses reads as
defensive programming in isolation; the damage only appears when you notice the
second one makes the seeding effect's guard unfalsifiable. That is a shape a
command can hold.

THE FOUR RULES
--------------
(S1) NO FABRICATED ROW SET. A module-level array of two or more object literals
     that each carry an `id:`, three or more keys, and at least one key OUTSIDE
     the descriptor vocabulary (id/label/value/name/color/…) is a table of rows.
     In a rebuilt surface, rows come from the server. That last condition is
     what separates a seed from a dropdown: `REFUSAL_REASONS` in
     receiving/next/DoorModel.ts is `{ id, label }` per entry and describes a
     UI vocabulary; `DEFAULT_LOCATIONS` carried `capacity`, `currentCount`,
     `temperature` and `humidity` — measurements about a real cellar, invented.
     A descriptor list only describes; a row asserts.

(S2) NO `placeholderData` EXCEPT `keepPreviousData`. A placeholder enters the
     tree in the same shape as a measurement and nothing downstream can tell
     them apart — the seed defect with a shorter life. `placeholderData: []` is
     included on purpose: it makes "still loading" and "measured, none" render
     identically, which is ADR 0051 clause 1 wearing a different hat.
     `keepPreviousData` is exempt because it shows a real earlier measurement.

(S3) NO WRITE LOOP OVER A MODULE CONSTANT. `CONST.map(x => api.post(...))` is
     the act of installing a literal into a tenant's database. Nothing else in
     these trees has that shape.

(S4) THE FIXED HOOK KEEPS ITS THREE STATES. `useStorageLocations.ts` must still
     express "unknown" — a nullable `capacity`, a `locationsUnavailable` flag —
     and must not name any of the four invented zones. Widening `capacity` back
     to `number` restores a fabricated denominator under the cellar map's fill
     bar without touching a single literal, so S1–S3 would not see it.

THE FIFTH RULE — THE SERVER SIDE (added 2026-09-02, ADR 0088)
-------------------------------------------------------------
(S5) NO INVENTED MEASUREMENT IN A ROW THE GATEWAY WRITES. Inside
     SERVER_SCAN_ROOTS, an object literal shaped like a database row (three or
     more snake_case keys) must not assign a **wholly literal** number to a key
     in the measurement vocabulary (`…_wage`, `…_cost`, `capacity…`, `…_pct`,
     `…_count`, `…_days`, …).

     The shape it exists for, from `team.service.ts` before ADR 0088:

         hourly_wage: a.role === "staff" ? 22 : a.role === "manager" ? 28 : 32,

     — described in its own comment as a "mock wage". Measured on production
     2026-09-02: **all 11 `team_members` rows carried exactly those literals**
     (8 at $32.00, 3 at $28.00). Not a fallback for missing data — the entire
     dataset — and the sole input to `laborCost()`, `shifts.labor_cost`, the
     week total, the Tonight-labor pulse, the per-shift labour lens and the CSV
     export's "Labor cost" column.

     "Wholly literal" is the whole rule. `x ?? 1` and `dto.qty || 1` are
     excluded: one branch is a caller value, so the column can still carry
     something real. A ternary whose every branch is a number cannot — no input
     reaches the row, and the condition (a role, a type) only chooses which
     invention to write.

     WHY S5 IS NOT ANCHORED ON `.insert(`. The defect above inserts `rows`, an
     array built by `.map()` several lines earlier. A rule anchored on
     `.insert({…})` sees nothing at all — verified by writing that rule first
     and watching it return zero hits against the pre-fix file. The row shape
     itself is the anchor, because it survives being passed around.

WHAT THIS GUARD DOES NOT CLAIM
------------------------------
- It does not prove a rendered figure was measured. That needs dataflow across
  a network hop and is undecidable here; `check_windowed_figures.py` says the
  same thing about its own rule, for the same reason.
- **It reads only part of `apps/api-gateway`.** This header used to say it read
  none of it, on the grounds that "a server-side fabrication guard is a
  different scan with different anchors". The scan is indeed different — S5
  above has its own vocabulary, its own anchor and its own root list — but a
  second script would have been a second thing to remember to run, so it lives
  here and reports under its own heading. A green run means S1–S4 over the web
  roots AND S5 over the server roots; neither borrows the other's confidence.
- **S5 is not enforced across the whole gateway.** Run over
  `apps/api-gateway/src` entire, the rule reports 10 hits outside its roots, on
  2026-09-02, in modules other work owns:

      calendar/calendar.service.ts:484            generation_horizon_days: 90
      common/orchestrator/prospects.service.ts:220 message_count: 1
      pos-hub/pos-mapping-review.service.ts:141    line_count: 0, unit_count: 0
      pos-hub/pos-mapping-review.service.ts:346    line_count: 0, unit_count: 0
      procurement/procurement.service.ts:2335      reminder_days_before: 1
      procurement/recurring-orders.service.ts:769  days_until: 2
      procurement/recurring-orders.service.ts:976  reminder_days_before: 1
      procurement/recurring-orders.service.ts:1124 reminder_days_before: 2

  They are listed rather than silently excluded, because a root list that
  quietly omits its findings is the fault this guard is about. Several are
  probably legitimate (a counter initialised to zero, a policy default nobody
  measures); triaging them belongs to the sessions that own those modules, and
  each root joins SERVER_SCAN_ROOTS when it has been.
- Two gateway files cannot be scrubbed at all —
  `inventory/photo-count.service.ts` and `menus/parsers/scan-parser.service.ts`
  raise `unterminated backtick`. They are outside SERVER_SCAN_ROOTS today; if a
  root ever contains them the guard exits 2 rather than skipping them.
- It does not police the legacy pages. ADR 0051 binds rebuilt surfaces only,
  deliberately; the SCAN_ROOTS below are that list and grow with it.
- It does not judge prose. `CellarMapView`'s empty state says "Create zones like
  Main Cellar, VIP Reserve, or Bar Stock" — that is an instruction to a human,
  not a row, and S4's name check is scoped to the hook for exactly that reason.
- Rule S2 is not enforced outside SCAN_ROOTS. `useTemplates.ts`,
  `useUserPreferences.ts` and `useSommelierQueries.ts` still carry a
  `placeholderData` today; they back legacy surfaces and are named here rather
  than silently excluded.

WHY A NEW FILE RATHER THAN AN EXTENSION (still true of `check_windowed_figures`)
--------------------------------------------------------------------------------
`check_windowed_figures.py` is scoped, by its own header, to
`apps/web/src/pages/receiving/next` plus the gateway files its `SERVER_WINDOWS`
register cites, and every one of its cannot-check anchors is that register.
Folding a seeding rule into it would mean a missing receiving register decides
the exit code of a check about a different tree — one guard, two unrelated
claims, one exit code. Nothing is duplicated: the rule families and the scanned
files are disjoint, and all three ADR 0051 guards cross-reference each other.

ONE SOUNDNESS TRADE, STATED
---------------------------
The scrubber treats a `'` or `"` with no matching quote before the newline as
ordinary text, not as a string opener — otherwise a JSX apostrophe swallows the
rest of the file (four real files in the scanned set have one). The cost is that
a genuinely unterminated single-quoted string is read as prose rather than
raising. Such a file does not compile, so `tsc` catches it first; an unterminated
TEMPLATE literal still raises, and so do unbalanced brackets.

NEVER VACUOUS
-------------
Exit 0 pass, 1 violation, **2 cannot check**. Exit 2 blocks in CI exactly like
exit 1.

`scripts/check_no_direct_stock_writes.sh:63` is the cautionary tale this guard
was written against: it calls `rg --type tsx`, which is not a ripgrep file type.
rg exits 2 with `unrecognized file type: tsx`, `2>/dev/null || true` swallows it,
the match set is empty, and the script prints PASS. It examined zero lines for
its entire life. So `--self-test` here does not only flag synthetic strings: it
asserts against the REAL repository that every scan root resolved to files, that
the expected files are among them, and that the scrubber actually parsed them.
A guard that cannot prove it saw the tree has not checked the tree.
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# The rebuilt surfaces ADR 0051 binds. Add a directory here when a page is
# rebuilt; do not add one to silence a finding.
SCAN_ROOTS = [
    Path("apps/web/src/pages/inventory/command"),
    Path("apps/web/src/pages/receiving/next"),
    Path("apps/web/src/pages/dashboard/next"),
    Path("apps/web/src/pages/orders/next"),
    Path("apps/web/src/pages/receipts/next"),
    Path("apps/web/src/pages/providers/next"),
    Path("apps/web/src/pages/team/next"),
    Path("apps/web/src/pages/documents-reports/next"),
    Path("apps/web/src/pages/communications/next"),
    # p4 wave (2026-09-02): seven more rebuilt surfaces, each builder ran the guard
    # on a copy with its own directory added before this line was written.
    Path("apps/web/src/pages/reports/next"),
    Path("apps/web/src/pages/notifications/next"),
    Path("apps/web/src/pages/recommendations/next"),
    Path("apps/web/src/pages/calendar/next"),
    Path("apps/web/src/pages/settings/next"),
    Path("apps/web/src/pages/profile/next"),
    Path("apps/web/src/pages/cellar/next"),
]

# Hooks that back those surfaces. These are data hooks, so a fabricated row set
# here reaches a rebuilt page even though the file does not live under one.
SCAN_HOOKS = [
    Path("apps/web/src/hooks/useStorageLocations.ts"),
]

# S4's anchor. If this file moves, the guard says so rather than passing.
PINNED_HOOK = Path("apps/web/src/hooks/useStorageLocations.ts")

# S5's roots — gateway modules whose row writes have been triaged. Grows one
# module at a time, as each is triaged; see the header for the 10 measured hits
# that sit outside it today.
SERVER_SCAN_ROOTS = [
    Path("apps/api-gateway/src/team"),
    Path("apps/api-gateway/src/restaurants"),
]

# S5's anchor. `ensureRosterFromAccess` in this file wrote 100% of production's
# wage data from a literal; if the file moves, the guard says so.
PINNED_SERVER_FILE = Path("apps/api-gateway/src/team/team.service.ts")

# S5: column names that assert a MEASUREMENT about the world. A row may carry
# an invented `status: "active"`; it may not carry an invented `hourly_wage`.
MEASUREMENT_KEY = re.compile(
    r"(?:^|_)(wage|cost|price|capacity|quantity|qty|amount|total|rate|pct|"
    r"percent|target|temperature|humidity|threshold|hours|minutes|weight|"
    r"volume|abv|score|level|count|bottles|days)(?:_|$)",
    re.I,
)

# A database column, as opposed to a DTO field or a React prop.
SNAKE_KEY = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$")

# The four zone names measured in production. Not a stylistic blocklist —
# these are the exact strings 84 tenant rows carry.
INVENTED_ZONES = ("Main Cellar", "Bar Stock", "Overflow Storage", "VIP Reserve")

# S4: the shapes that express "we do not know".
PINNED_UNKNOWN_SHAPES = (
    # a capacity nobody entered is unknown, not 100
    re.compile(r"capacity\s*:\s*number\s*\|\s*null"),
    # a failed fetch is said in words, not rendered as four zones
    re.compile(r"\blocationsUnavailable\b"),
)

SUFFIXES = (".ts", ".tsx")
SKIP_NAME = re.compile(r"\.(test|spec|stories)\.(ts|tsx)$")


class CannotCheck(Exception):
    """An anchor this guard depends on is missing. Exit 2 — never a pass."""


# ── TypeScript scrubbing ─────────────────────────────────────────────────────
# Hand-rolled, for the same reason check_analytics_cost_honesty.py hand-rolls
# one: a guard that needs `npm install` to run is a guard that gets skipped.


def _closes_on_this_line(src: str, start: int, quote: str) -> bool:
    """
    A `'` or `"` opens a string only if a matching unescaped quote follows it
    before the newline — JS single/double-quoted strings cannot span lines.

    Without this the scrubber swallows a JSX apostrophe. Four real files in the
    scanned set contain one (`ReceiptDepth.tsx`, `DoorCredit.tsx`,
    `RcStaffLane.tsx`, `DocumentsReportsNext.tsx`); with the naive rule the guard
    raised on them, which is at least honest, but it would have blocked CI on
    prose. Template literals keep the multi-line rule.
    """
    i = start + 1
    while i < len(src) and src[i] != "\n":
        if src[i] == "\\":
            i += 2
            continue
        if src[i] == quote:
            return True
        i += 1
    return False


def scrub(src: str, keep_strings: bool = False) -> str:
    """
    Blank comments, and (unless `keep_strings`) string/template *content*,
    preserving offsets so line numbers still map. `${…}` interiors inside
    templates are always kept — they are real code.

    Two views, because the rules need both. S1–S3 read code with strings blanked
    so prose cannot trip them. S4's zone-name check reads code with strings KEPT
    and comments blanked, because `const FALLBACK = 'VIP Reserve'` is the
    fabrication coming back while `// used to seed 'VIP Reserve'` is history.
    """
    out = list(src)
    i, n = 0, len(src)
    state: str | None = None

    def blank(idx: int, is_comment: bool = True) -> None:
        if not is_comment and keep_strings:
            return
        if src[idx] != "\n":
            out[idx] = " "

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if state is None:
            if ch == "/" and nxt == "/":
                state, _ = "//", (blank(i), blank(i + 1))
                i += 2
                continue
            if ch == "/" and nxt == "*":
                state, _ = "/*", (blank(i), blank(i + 1))
                i += 2
                continue
            if ch == "`":
                state = ch
                i += 1
                continue
            if ch in "\"'":
                if _closes_on_this_line(src, i, ch):
                    state = ch
                    i += 1
                    continue
                # A bare apostrophe in JSX text. Not a string opener.
                i += 1
                continue
            i += 1
            continue
        if state == "//":
            if ch == "\n":
                state = None
            else:
                blank(i)
            i += 1
            continue
        if state == "/*":
            if ch == "*" and nxt == "/":
                blank(i)
                blank(i + 1)
                state = None
                i += 2
                continue
            blank(i)
            i += 1
            continue
        # inside a string or template literal
        if ch == "\\":
            blank(i, is_comment=False)
            if i + 1 < n:
                blank(i + 1, is_comment=False)
            i += 2
            continue
        if state == "`" and ch == "$" and nxt == "{":
            depth, j = 1, i + 2
            while j < n and depth > 0:
                if src[j] == "{":
                    depth += 1
                elif src[j] == "}":
                    depth -= 1
                j += 1
            i = j
            continue
        if ch == state:
            state = None
            i += 1
            continue
        blank(i, is_comment=False)
        i += 1

    if state is not None:
        raise CannotCheck(
            f"unterminated {state!r} while scrubbing — the guard cannot read "
            "this file, so it must not report it as clean"
        )
    return "".join(out)


def match_bracket(src: str, open_at: int) -> int:
    """Index just past the bracket that closes the one at `open_at`."""
    pairs = {"[": "]", "{": "}", "(": ")"}
    close = pairs[src[open_at]]
    depth, i = 0, open_at
    while i < len(src):
        if src[i] in pairs:
            depth += 1
        elif src[i] in pairs.values():
            depth -= 1
            if depth == 0:
                if src[i] != close:
                    raise CannotCheck("unbalanced brackets while scanning")
                return i + 1
        i += 1
    raise CannotCheck("unterminated bracket while scanning")


def line_of(src: str, idx: int) -> int:
    return src.count("\n", 0, idx) + 1


# ── the rules ────────────────────────────────────────────────────────────────

# A module-level `const NAME[: Type] = [` — column 0, so not a local.
MODULE_ARRAY = re.compile(r"^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*\[", re.M)
MODULE_CONST = re.compile(r"^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]", re.M)
PLACEHOLDER = re.compile(r"\bplaceholderData\s*:\s*([^,\n]+)")
WRITE_CALL = re.compile(r"\.(post|put|patch)\s*\(")

# Keys that only DESCRIBE a choice — the vocabulary of a dropdown, a tab strip,
# a legend, a route table. An object built solely from these asserts nothing
# about a tenant, so a list of them is not seeded data.
DESCRIPTOR_KEYS = {
    "id", "key", "value", "label", "name", "title", "short", "description",
    "icon", "color", "tone", "order", "href", "to", "path", "slug", "type",
    "kind", "group", "disabled", "hint", "placeholder", "test", "variant",
}


def top_level_objects(body: str) -> list[str]:
    """Object literals directly inside an array body (depth-1 `{…}` spans)."""
    objs, depth, i, start = [], 0, 0, None
    while i < len(body):
        ch = body[i]
        if ch in "[({":
            depth += 1
            if ch == "{" and depth == 1:
                start = i
        elif ch in "])}":
            if ch == "}" and depth == 1 and start is not None:
                objs.append(body[start : i + 1])
                start = None
            depth -= 1
        i += 1
    return objs


def object_keys(obj: str) -> list[str]:
    """Top-level `key:` names inside one object literal."""
    keys, depth, i = [], 0, 0
    while i < len(obj):
        ch = obj[i]
        if ch in "[({":
            depth += 1
        elif ch in "])}":
            depth -= 1
        elif depth == 1:
            km = re.match(r"([A-Za-z_$][\w$]*)\s*:", obj[i:])
            if km and (i == 0 or not re.match(r"[\w$]", obj[i - 1])):
                keys.append(km.group(1))
                i += km.end()
                continue
        i += 1
    return keys


def check_row_set(rel: str, code: str, rep: "Report") -> None:
    """
    S1 — a module-level array of two or more object literals that carry an
    `id:` AND at least one key outside DESCRIPTOR_KEYS.

    The second condition is what separates a table of rows from a label lookup.
    `REFUSAL_REASONS` in receiving/next/DoorModel.ts is `{ id, label }` per
    entry: a UI vocabulary keyed by a TypeScript union, describing nothing about
    a tenant. `DEFAULT_LOCATIONS` carried `capacity`, `currentCount`,
    `temperature` and `humidity` — measurements about a real cellar, invented.
    A descriptor list only describes; a row asserts.
    """
    for m in MODULE_ARRAY.finditer(code):
        name = m.group(1)
        open_at = code.index("[", m.end() - 1)
        end = match_bracket(code, open_at)
        body = code[open_at + 1 : end - 1]
        rows: list[tuple[str, list[str]]] = []
        for obj in top_level_objects(body):
            keys = object_keys(obj)
            if "id" not in keys or len(keys) < 3:
                continue
            domain = [k for k in keys if k.lower() not in DESCRIPTOR_KEYS]
            if domain:
                rows.append((obj, domain))
        if len(rows) >= 2:
            domain_keys = sorted({k for _o, ks in rows for k in ks})
            rep.row_sets.append(
                f"{rel}:{line_of(code, m.start())}  `{name}` is a module-level array of "
                f"{len(rows)} object literals carrying an `id:` and the domain field(s) "
                f"{', '.join(domain_keys[:6])} — a table of rows written into the source. "
                "On a rebuilt surface rows come from the server."
            )


def check_placeholder(rel: str, code: str, rep: "Report") -> None:
    """S2 — no placeholderData except keepPreviousData."""
    for m in PLACEHOLDER.finditer(code):
        value = m.group(1).strip()
        if "keepPreviousData" in value:
            continue
        rep.placeholders.append(
            f"{rel}:{line_of(code, m.start())}  `placeholderData: {value}` — a placeholder "
            "reaches the tree in the same shape as a measurement, so nothing downstream "
            "can tell them apart. Use the query's pending state instead."
        )


def check_write_loop(rel: str, code: str, rep: "Report") -> None:
    """S3 — `CONST.map(… .post/.put/.patch …)`, the act of installing a literal."""
    consts = {m.group(1) for m in MODULE_CONST.finditer(code)}
    for m in re.finditer(r"\b([A-Za-z_$][\w$]*)\s*\.map\s*\(", code):
        name = m.group(1)
        if name not in consts:
            continue
        open_at = code.index("(", m.end() - 1)
        end = match_bracket(code, open_at)
        body = code[open_at:end]
        hit = WRITE_CALL.search(body)
        if hit:
            rep.write_loops.append(
                f"{rel}:{line_of(code, m.start())}  `{name}.map(… {hit.group(0)}…)` writes a "
                "module constant into a tenant's database. 84 production rows across 6 "
                "tenants came from exactly this loop."
            )


# ── S5: the server side ──────────────────────────────────────────────────────


def object_spans(code: str) -> list[tuple[int, str]]:
    """Every balanced `{…}` span in the file, with its start offset.

    Deliberately anchor-free. The defect S5 exists for builds its row inside a
    `.map()` and inserts the resulting array many lines later, so any rule that
    starts from `.insert({` sees nothing — measured, not assumed.
    """
    spans: list[tuple[int, str]] = []
    stack: list[int] = []
    for i, ch in enumerate(code):
        if ch == "{":
            stack.append(i)
        elif ch == "}":
            if stack:
                start = stack.pop()
                spans.append((start, code[start : i + 1]))
    if stack:
        raise CannotCheck("unterminated `{` while scanning for row literals")
    return spans


def key_values(obj: str) -> list[tuple[str, str]]:
    """
    Top-level `key: value` pairs inside one object literal.

    The value runs to the next `,` or the closing `}` **at depth 1**, not to the
    end of the line: `{ restaurant_id: rid, capacity_bottles: 500 }` on one line
    has to yield two pairs, not one. (An earlier line-terminated version yielded
    one, and the single-line self-test case is what caught it.)
    """
    out: list[tuple[str, str]] = []
    depth, i = 0, 0
    while i < len(obj):
        ch = obj[i]
        if ch in "[({":
            depth += 1
            i += 1
            continue
        if ch in "])}":
            depth -= 1
            i += 1
            continue
        if depth == 1:
            km = re.match(r"([A-Za-z_$][\w$]*)\s*:", obj[i:])
            if km and (i == 0 or not re.match(r"[\w$]", obj[i - 1])):
                j = i + km.end()
                vdepth, start = 0, j
                while j < len(obj):
                    c = obj[j]
                    if c in "[({":
                        vdepth += 1
                    elif c in "])}":
                        if vdepth == 0:
                            break  # the object's own closing brace
                        vdepth -= 1
                    elif c == "," and vdepth == 0:
                        break
                    j += 1
                out.append((km.group(1), obj[start:j].strip()))
                i = j
                continue
        i += 1
    return out


def wholly_literal_number(value: str) -> bool:
    """
    True when NO caller input can reach this column.

    `22` → True. `a.role === "staff" ? 22 : 28` → True: the condition only picks
    which invention to write. `dto.qty ?? 1` and `x || 0` → False: one branch is
    a real value, so the column can carry something measured.
    """
    v = value.strip().rstrip(",")
    if not v:
        return False
    if "??" in v or "||" in v:
        return False
    branches: list[str] = []
    depth, cur, i = 0, "", 0
    while i < len(v):
        c = v[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        if depth == 0 and c == "?":
            cur = ""  # the condition is discarded; only the branches are values
            i += 1
            continue
        if depth == 0 and c == ":":
            branches.append(cur.strip())
            cur = ""
            i += 1
            continue
        cur += c
        i += 1
    branches.append(cur.strip())
    branches = [b for b in branches if b]
    if not branches:
        return False
    return all(re.fullmatch(r"-?\d+(?:\.\d+)?", b) for b in branches)


def check_server_row(rel: str, code: str, rep: "Report") -> None:
    """S5 — a row-shaped literal must not assert an invented measurement."""
    for at, obj in object_spans(code):
        pairs = key_values(obj)
        if sum(1 for k, _ in pairs if SNAKE_KEY.match(k)) < 3:
            continue  # not a database row — a DTO, an options bag, a props object
        for key, value in pairs:
            if MEASUREMENT_KEY.search(key) and wholly_literal_number(value):
                rep.server_rows.append(
                    f"{rel}:{line_of(code, at)}  `{key}: {value[:60]}` — a row written "
                    "by the gateway asserts a measurement no caller supplied. "
                    "`team_members.hourly_wage` was written this way and became "
                    "100% of production's wage data (11 of 11 rows, 2026-09-02)."
                )


def check_server_pin(root: Path, rep: "Report") -> None:
    """S5's anchor: the file that wrote production's wage data still exists."""
    path = root / PINNED_SERVER_FILE
    if not path.is_file():
        raise CannotCheck(
            f"{PINNED_SERVER_FILE} is missing. S5 pins the file whose backfill wrote "
            "every wage in production; if it moved, repoint the pin rather than "
            "losing the check."
        )


def check_pins(root: Path, rep: "Report") -> None:
    """S4 — the fixed hook keeps its unknown-capable shapes and its silence."""
    path = root / PINNED_HOOK
    if not path.is_file():
        raise CannotCheck(
            f"{PINNED_HOOK} is missing. S4 pins the file that seeded 84 production "
            "rows; if it moved, repoint the pin rather than losing the check."
        )
    src = path.read_text(encoding="utf-8")
    # comments blanked, string literals preserved
    code = scrub(src, keep_strings=True)
    for pattern in PINNED_UNKNOWN_SHAPES:
        if not pattern.search(src):
            rep.lost_unknown.append(
                f"{PINNED_HOOK}  no match for /{pattern.pattern}/ — the shape that lets this "
                "hook say 'we do not know' is gone. Unknown then renders as a measurement."
            )
    for zone in INVENTED_ZONES:
        # Comments are blanked, strings are not: a name in a comment is history,
        # a name in a string literal or an identifier is the fabrication back.
        if zone in code or zone.replace(" ", "") in code:
            rep.lost_unknown.append(
                f"{PINNED_HOOK}  names {zone!r} in code. That is one of the four zones "
                "84 tenant rows carry; it must not be reintroduced here."
            )


# ── inventory + report ───────────────────────────────────────────────────────


@dataclass
class Report:
    files: list[str] = field(default_factory=list)
    server_files: list[str] = field(default_factory=list)
    roots_seen: dict[str, int] = field(default_factory=dict)
    scanned_chars: int = 0
    server_scanned_chars: int = 0
    row_sets: list[str] = field(default_factory=list)
    placeholders: list[str] = field(default_factory=list)
    write_loops: list[str] = field(default_factory=list)
    lost_unknown: list[str] = field(default_factory=list)
    server_rows: list[str] = field(default_factory=list)

    def violations(self) -> list[str]:
        return (
            self.row_sets
            + self.placeholders
            + self.write_loops
            + self.lost_unknown
            + self.server_rows
        )


def server_inventory(root: Path) -> tuple[list[Path], dict[str, int]]:
    """S5's files. A root that resolves to nothing is CANNOT CHECK."""
    files: list[Path] = []
    per_root: dict[str, int] = {}
    for rel in SERVER_SCAN_ROOTS:
        d = root / rel
        if not d.is_dir():
            raise CannotCheck(
                f"server scan root {rel} does not exist. It is listed as a triaged "
                "gateway module; repoint it or remove the entry deliberately. A "
                "missing root must never read as nothing to check."
            )
        found = sorted(
            p
            for p in d.rglob("*")
            if p.suffix == ".ts" and not SKIP_NAME.search(p.name)
        )
        if not found:
            raise CannotCheck(
                f"server scan root {rel} exists but holds no .ts file the guard would read."
            )
        per_root[str(rel)] = len(found)
        files.extend(found)
    return files, per_root


def inventory(root: Path) -> tuple[list[Path], dict[str, int]]:
    """
    Every file this guard claims to read, plus a per-root count.

    A root that resolves to zero files is CANNOT CHECK, not a quiet pass: that
    is precisely the state check_no_direct_stock_writes.sh has been in.
    """
    files: list[Path] = []
    per_root: dict[str, int] = {}

    for rel in SCAN_ROOTS:
        d = root / rel
        if not d.is_dir():
            raise CannotCheck(
                f"scan root {rel} does not exist. It is listed as a rebuilt surface; "
                "either the page moved (repoint it) or it was deleted (remove the entry "
                "deliberately). A missing root must never read as nothing to check."
            )
        found = sorted(
            p
            for p in d.rglob("*")
            if p.suffix in SUFFIXES and not SKIP_NAME.search(p.name)
        )
        if not found:
            raise CannotCheck(
                f"scan root {rel} exists but holds no .ts/.tsx file the guard would read."
            )
        per_root[str(rel)] = len(found)
        files.extend(found)

    for rel in SCAN_HOOKS:
        p = root / rel
        if not p.is_file():
            raise CannotCheck(
                f"backing hook {rel} is missing. It is scanned because a fabricated row "
                "set there reaches a rebuilt page; repoint it rather than dropping it."
            )
        per_root[str(rel)] = 1
        files.append(p)

    return files, per_root


def run(root: Path) -> Report:
    files, per_root = inventory(root)
    rep = Report(roots_seen=per_root)

    for path in files:
        rel = str(path.relative_to(root))
        rep.files.append(rel)
        src = path.read_text(encoding="utf-8")
        try:
            code = scrub(src)
        except CannotCheck as exc:
            raise CannotCheck(f"{rel}: {exc}") from exc
        rep.scanned_chars += len(code)
        check_row_set(rel, code, rep)
        check_placeholder(rel, code, rep)
        check_write_loop(rel, code, rep)

    if rep.scanned_chars == 0:
        raise CannotCheck(
            "every scanned file was empty after scrubbing — nothing was examined."
        )

    check_pins(root, rep)

    # S5 — the server side.
    server_files, server_roots = server_inventory(root)
    rep.roots_seen.update(server_roots)
    for path in server_files:
        rel = str(path.relative_to(root))
        rep.server_files.append(rel)
        src = path.read_text(encoding="utf-8")
        try:
            code = scrub(src)
        except CannotCheck as exc:
            raise CannotCheck(f"{rel}: {exc}") from exc
        rep.server_scanned_chars += len(code)
        check_server_row(rel, code, rep)

    if rep.server_scanned_chars == 0:
        raise CannotCheck(
            "every server file was empty after scrubbing — S5 examined nothing."
        )
    check_server_pin(root, rep)
    return rep


def verdict(rep: Report) -> str:
    return "violation" if rep.violations() else "clean"


# ── self-test ────────────────────────────────────────────────────────────────

# The exact pre-fix shape, lifted verbatim from useStorageLocations.ts@e3acc79a.
PREFIX_HOOK = """
const DEFAULT_LOCATIONS: StorageLocation[] = [
  { id: 'loc-1', name: 'Main Cellar', description: 'Primary wine storage', capacity: 500, currentCount: 0, temperature: '55°F', humidity: '70%', color: '#be123c' },
  { id: 'loc-2', name: 'Bar Stock', description: 'Ready-to-serve wines', capacity: 100, currentCount: 0, temperature: '58°F', color: '#f59e0b' },
  { id: 'loc-3', name: 'Overflow Storage', description: 'Secondary storage area', capacity: 200, currentCount: 0, color: '#10b981' },
  { id: 'loc-4', name: 'VIP Reserve', description: 'Premium wines for special occasions', capacity: 50, currentCount: 0, temperature: '53°F', humidity: '75%', color: '#8b5cf6' },
]

export interface StorageLocation {
  capacity: number
}

export function useStorageLocations() {
  const locationsQuery = useQuery<StorageLocation[]>({
    queryFn: async () => {
      const { data } = await apiClient.get(`/storage-locations/${restaurantId}`)
      if (Array.isArray(data) && data.length > 0) return data.map(mapServerLocation)
      return DEFAULT_LOCATIONS
    },
    placeholderData: DEFAULT_LOCATIONS,
    retry: 1,
  })
  const locations = locationsQuery.data ?? DEFAULT_LOCATIONS
  useEffect(() => {
    Promise.all(
      DEFAULT_LOCATIONS.map(loc =>
        apiClient.post(`/storage-locations/${restaurantId}`, { name: loc.name }),
      ),
    )
  }, [])
  return { locations }
}
"""

CLEAN_HOOK = """
export interface StorageLocation {
  capacity: number | null
}

export function useStorageLocations() {
  const locationsQuery = useQuery<StorageLocation[]>({
    queryFn: async () => {
      const { data } = await apiClient.get(`/storage-locations/${restaurantId}`)
      if (!Array.isArray(data)) throw new Error('not a list')
      return data.map(mapServerLocation)
    },
    retry: 1,
  })
  const locations = locationsQuery.data ?? EMPTY_LOCATIONS
  const locationsUnavailable = locationsQuery.isError && locationsQuery.data === undefined
  return { locations, locationsUnavailable }
}
"""

CLEAN_PAGE = """
import { useStorageLocations } from '../../../hooks/useStorageLocations'
export function Page() {
  const { locations, locationsUnavailable } = useStorageLocations()
  if (locationsUnavailable) return <p>Storage zones could not be loaded</p>
  return <div>{locations.length}</div>
}
"""


# The exact pre-fix shape, lifted verbatim from team.service.ts@e5f44657.
PREFIX_SERVER = """
const rows = missing.map((a: any) => {
  const u = userMap.get(a.user_id)
  return {
    restaurant_id: restaurantId,
    user_id: a.user_id,
    display_name: u?.name || u?.email || "Team member",
    employment_type: "full_time",
    status: "active",
    // Seed mock wage so labor lens has something when tracking is on;
    hourly_wage: a.role === "staff" ? 22 : a.role === "manager" ? 28 : 32,
  }
})
await this.sb.from("team_members").insert(rows)
"""

CLEAN_SERVER = """
const rows = missing.map((a: any) => {
  const u = userMap.get(a.user_id)
  return {
    restaurant_id: restaurantId,
    user_id: a.user_id,
    display_name: u?.name || u?.email || "Team member",
    employment_type: "full_time",
    status: "active",
    hourly_wage: null,
  }
})
await this.sb.from("team_members").insert(rows)
"""


def _scaffold(
    tmp: Path,
    hook: str = CLEAN_HOOK,
    page: str = CLEAN_PAGE,
    server: str = CLEAN_SERVER,
) -> None:
    for rel in SCAN_ROOTS:
        (tmp / rel).mkdir(parents=True, exist_ok=True)
        (tmp / rel / "Page.tsx").write_text(page, encoding="utf-8")
    (tmp / PINNED_HOOK).parent.mkdir(parents=True, exist_ok=True)
    (tmp / PINNED_HOOK).write_text(hook, encoding="utf-8")
    for rel in SERVER_SCAN_ROOTS:
        (tmp / rel).mkdir(parents=True, exist_ok=True)
        (tmp / rel / "some.service.ts").write_text(server, encoding="utf-8")
    (tmp / PINNED_SERVER_FILE).parent.mkdir(parents=True, exist_ok=True)
    (tmp / PINNED_SERVER_FILE).write_text(server, encoding="utf-8")


def self_test() -> int:
    failures: list[str] = []

    def case(name: str, mutate, expect: str) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _scaffold(tmp)
            mutate(tmp)
            try:
                rep = run(tmp)
            except CannotCheck as exc:
                got, detail = "cannot-check", str(exc)
            else:
                got, detail = verdict(rep), "; ".join(rep.violations())
            ok = got == expect
            print(f"   {'ok  ' if ok else 'FAIL'}  {name}: expected {expect}, got {got}")
            if detail and (not ok or got != "clean"):
                print(f"           {detail.splitlines()[0][:160]}")
            if not ok:
                failures.append(name)

    print("== A. THE GUARD CAN SEE THE REAL TREE")
    print("   (check_no_direct_stock_writes.sh has printed PASS over zero lines")
    print("    for its entire life because nothing ever asserted this.)\n")

    try:
        files, per_root = inventory(REPO_ROOT)
        server_files, server_per_root = server_inventory(REPO_ROOT)
    except CannotCheck as exc:
        print(f"   FAIL  the real repository could not be inventoried: {exc}")
        return 1
    per_root.update(server_per_root)
    files = files + server_files

    scanned_chars = 0
    unreadable: list[str] = []
    for p in files:
        raw = p.read_text(encoding="utf-8")
        try:
            code = scrub(raw)
        except CannotCheck as exc:
            unreadable.append(f"{p.name}: {exc}")
            continue
        if len(code) != len(raw) or code.count("\n") != raw.count("\n"):
            unreadable.append(f"{p.name}: scrub changed the file's length or line count")
        scanned_chars += len(code)

    checks = [
        ("every scan root resolved to at least one file", all(v > 0 for v in per_root.values())),
        ("more than 10 real files are scanned", len(files) > 10),
        (
            "the hook that seeded production is among them",
            any(p.name == "useStorageLocations.ts" for p in files),
        ),
        ("the cellar map is among them", any(p.name == "CellarMapView.tsx" for p in files)),
        (
            "the gateway file that wrote production's wage data is among them",
            any(p.name == "team.service.ts" for p in server_files),
        ),
        ("more than 3 real gateway files are scanned", len(server_files) > 3),
        ("tests and stories are excluded", not any(SKIP_NAME.search(p.name) for p in files)),
        ("every real file parsed, offsets intact", not unreadable),
        ("the scrubber examined a non-trivial amount of code", scanned_chars > 10_000),
    ]
    for label, ok in checks:
        print(f"   {'ok  ' if ok else 'FAIL'}  {label}")
        if not ok:
            failures.append(label)
    for u in unreadable[:5]:
        print(f"           {u}")
    print(f"\n   {len(files)} file(s) across {len(per_root)} root(s), "
          f"{scanned_chars:,} chars of code examined.")
    for root_name, count in per_root.items():
        print(f"     {count:>3}  {root_name}")

    # The decisive check. Copy the REAL scanned files into a temp tree and run
    # the full rule set over them: once untouched (must be clean) and once with
    # a fabricated row set appended to a REAL file (must fire). This proves the
    # rules execute over real repository content, not only over fixtures — the
    # thing check_no_direct_stock_writes.sh never established about itself.
    print("\n   -- the rules run over the real files, not only over fixtures --")
    with tempfile.TemporaryDirectory() as td:
        mirror = Path(td)
        for p in files:
            rel = p.relative_to(REPO_ROOT)
            (mirror / rel).parent.mkdir(parents=True, exist_ok=True)
            (mirror / rel).write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
        try:
            got = verdict(run(mirror))
        except CannotCheck as exc:
            got = f"cannot-check ({exc})"
        ok = got == "clean"
        print(
            f"   {'ok  ' if ok else 'FAIL'}  a mirror of the real tree is clean: {got}"
            "\n           (this one doubles as a check on the tree: it fails both when"
            "\n            the guard is broken and when the tree has a real violation)"
        )
        if not ok:
            failures.append("mirror of the real tree is clean")

        victim = next(p for p in files if p.name == "CellarMapView.tsx")
        rel = victim.relative_to(REPO_ROOT)
        (mirror / rel).write_text(
            victim.read_text(encoding="utf-8")
            + "\nconst SEEDED_ZONES = [\n"
            "  { id: 'loc-1', name: 'Main Cellar', capacity: 500, temperature: '55°F' },\n"
            "  { id: 'loc-2', name: 'Bar Stock', capacity: 100, temperature: '58°F' },\n"
            "]\n",
            encoding="utf-8",
        )
        try:
            got = verdict(run(mirror))
        except CannotCheck as exc:
            got = f"cannot-check ({exc})"
        ok = got == "violation"
        print(
            f"   {'ok  ' if ok else 'FAIL'}  a seed appended to the REAL CellarMapView.tsx "
            f"is caught: {got}"
        )
        if not ok:
            failures.append("seed injected into a real file is caught")
        # restore it before the S5 injection, so the next result is S5's alone
        (mirror / rel).write_text(victim.read_text(encoding="utf-8"), encoding="utf-8")

        server_victim = REPO_ROOT / PINNED_SERVER_FILE
        (mirror / PINNED_SERVER_FILE).write_text(
            server_victim.read_text(encoding="utf-8")
            + "\nconst seededRow = {\n"
            "  restaurant_id: restaurantId,\n"
            "  user_id: a.user_id,\n"
            '  employment_type: "full_time",\n'
            '  hourly_wage: a.role === "staff" ? 22 : 32,\n'
            "}\n",
            encoding="utf-8",
        )
        try:
            got = verdict(run(mirror))
        except CannotCheck as exc:
            got = f"cannot-check ({exc})"
        ok = got == "violation"
        print(
            f"   {'ok  ' if ok else 'FAIL'}  the pre-fix wage literal appended to the REAL "
            f"team.service.ts is caught: {got}"
        )
        if not ok:
            failures.append("S5 fires on a real gateway file")

    print("\n== B. THE GUARD FIRES ON THE SHAPES IT EXISTS TO CATCH\n")

    case("the clean tree passes", lambda _t: None, "clean")
    case(
        "the exact pre-fix hook, verbatim",
        lambda t: (t / PINNED_HOOK).write_text(PREFIX_HOOK, encoding="utf-8"),
        "violation",
    )
    case(
        "S1 a fabricated row set on a rebuilt page",
        lambda t: (t / SCAN_ROOTS[0] / "Page.tsx").write_text(
            "const ROWS = [\n"
            "  { id: 'a', name: 'One', capacity: 500, temperature: '55F' },\n"
            "  { id: 'b', name: 'Two', capacity: 100, temperature: '58F' },\n]\n"
            + CLEAN_PAGE,
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "S1 does NOT fire on a two-element array with no id (an options list)",
        lambda t: (t / SCAN_ROOTS[0] / "Page.tsx").write_text(
            "const SORTS = [\n  { value: 'name', label: 'Name' },\n"
            "  { value: 'qty', label: 'Quantity' },\n]\n" + CLEAN_PAGE,
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "S1 does NOT fire on a single sentinel object",
        lambda t: (t / SCAN_ROOTS[0] / "Page.tsx").write_text(
            "const NONE = [{ id: '', name: '' }]\n" + CLEAN_PAGE, encoding="utf-8"
        ),
        "clean",
    )
    case(
        "S2 placeholderData with rows",
        lambda t: (t / SCAN_ROOTS[1] / "Page.tsx").write_text(
            "useQuery({ queryKey: ['x'], placeholderData: SOMETHING })\n" + CLEAN_PAGE,
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "S2 placeholderData: [] — loading indistinguishable from measured-empty",
        lambda t: (t / SCAN_ROOTS[1] / "Page.tsx").write_text(
            "useQuery({ queryKey: ['x'], placeholderData: [] })\n" + CLEAN_PAGE,
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "S2 does NOT fire on keepPreviousData (a real earlier measurement)",
        lambda t: (t / SCAN_ROOTS[1] / "Page.tsx").write_text(
            "useQuery({ queryKey: ['x'], placeholderData: keepPreviousData })\n" + CLEAN_PAGE,
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "S3 a write loop over a module constant",
        lambda t: (t / PINNED_HOOK).write_text(
            CLEAN_HOOK
            + "\nconst ZONES = [1, 2]\n"
            + "ZONES.map(z => apiClient.post(`/storage-locations/${rid}`, z))\n",
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "S3 does NOT fire on a read loop",
        lambda t: (t / PINNED_HOOK).write_text(
            CLEAN_HOOK + "\nconst ZONES = [1, 2]\nZONES.map(z => apiClient.get(`/z/${z}`))\n",
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "S4 the nullable capacity widened back to a number",
        lambda t: (t / PINNED_HOOK).write_text(
            CLEAN_HOOK.replace("capacity: number | null", "capacity: number"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "S4 the failure flag deleted",
        lambda t: (t / PINNED_HOOK).write_text(
            CLEAN_HOOK.replace("locationsUnavailable", "somethingElse"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "S4 an invented zone name coming back as a literal",
        lambda t: (t / PINNED_HOOK).write_text(
            CLEAN_HOOK + "\nconst FALLBACK_NAME = 'VIP Reserve'\n", encoding="utf-8"
        ),
        "violation",
    )
    case(
        "S4 does NOT fire on the same name in a comment (that is history)",
        lambda t: (t / PINNED_HOOK).write_text(
            "// Used to seed 'VIP Reserve' and 'Main Cellar' into tenant DBs.\n" + CLEAN_HOOK,
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "S5 the exact pre-fix wage backfill, verbatim",
        lambda t: (t / PINNED_SERVER_FILE).write_text(PREFIX_SERVER, encoding="utf-8"),
        "violation",
    )
    case(
        "S5 a bare literal measurement in a row",
        lambda t: (t / SERVER_SCAN_ROOTS[0] / "some.service.ts").write_text(
            CLEAN_SERVER
            + "\nconst z = { restaurant_id: rid, storage_zone: 'main', "
            "capacity_bottles: 500 }\n",
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "S5 does NOT fire on a caller value with a fallback (`?? 1`)",
        lambda t: (t / SERVER_SCAN_ROOTS[0] / "some.service.ts").write_text(
            CLEAN_SERVER
            + "\nconst z = { restaurant_id: rid, event_kind: 'x', "
            "reminder_days_before: dto.reminderDaysBefore ?? 1 }\n",
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "S5 does NOT fire on an options bag (not a row — no snake_case columns)",
        lambda t: (t / SERVER_SCAN_ROOTS[0] / "some.service.ts").write_text(
            CLEAN_SERVER
            + "\nconst opts = { retries: 3, timeoutHours: 2, backoffRate: 5 }\n",
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "S5 does NOT fire on a non-measurement column (`status`, `shift_type`)",
        lambda t: (t / SERVER_SCAN_ROOTS[0] / "some.service.ts").write_text(
            CLEAN_SERVER
            + "\nconst z = { restaurant_id: rid, member_id: m, shift_type: 'am', "
            "day_of_week: 3 }\n",
            encoding="utf-8",
        ),
        "clean",
    )

    print("\n== C. CANNOT CHECK MUST NOT READ AS A PASS\n")

    def delete_root(t: Path) -> None:
        d = t / SCAN_ROOTS[3]
        for p in d.glob("*"):
            p.unlink()
        d.rmdir()

    case("a scan root was deleted", delete_root, "cannot-check")
    case(
        "a scan root exists but holds no source file",
        lambda t: (t / SCAN_ROOTS[2] / "Page.tsx").unlink(),
        "cannot-check",
    )
    case(
        "the pinned hook is gone",
        lambda t: (t / PINNED_HOOK).unlink(),
        "cannot-check",
    )

    def delete_server_root(t: Path) -> None:
        d = t / SERVER_SCAN_ROOTS[1]
        for p in sorted(d.rglob("*"), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
        d.rmdir()

    case("a server scan root was deleted", delete_server_root, "cannot-check")
    case(
        "the pinned gateway file is gone",
        lambda t: (t / PINNED_SERVER_FILE).unlink(),
        "cannot-check",
    )
    case(
        "a file the scrubber cannot parse (unterminated template literal)",
        lambda t: (t / SCAN_ROOTS[0] / "Page.tsx").write_text(
            "const broken = `unterminated\n", encoding="utf-8"
        ),
        "cannot-check",
    )
    case(
        "a file with unbalanced brackets in a module array",
        lambda t: (t / SCAN_ROOTS[0] / "Page.tsx").write_text(
            "const ROWS = [\n  { id: 'a', capacity: 1 },\n", encoding="utf-8"
        ),
        "cannot-check",
    )

    print()
    if failures:
        print(f"SELF-TEST FAILED — {len(failures)} case(s): {', '.join(failures)}")
        print("   Fix the guard before trusting a pass.")
        return 1
    print("SELF-TEST PASSED — the guard sees the real tree, fires on every pre-fix")
    print("   shape, stays quiet on the legitimate neighbours, and reports")
    print("   cannot-check rather than passing when an anchor is gone.")
    return 0


# ── main ─────────────────────────────────────────────────────────────────────


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description="A rebuilt surface never installs data a tenant did not create."
    )
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    try:
        rep = run(REPO_ROOT)
    except CannotCheck as exc:
        print("CANNOT CHECK — this guard could not verify what it claims to.")
        print(f"   {exc}")
        print(
            "\n   Exit 2 blocks exactly like a violation, on purpose. A guard that\n"
            "   passes because its anchor moved is a green tick over an unexamined\n"
            "   surface: check_no_direct_stock_writes.sh printed PASS over zero\n"
            "   lines for its entire life, and four invented zones reached 84 rows\n"
            "   in 6 production tenants underneath a green CI."
        )
        return 2

    if rep.violations():
        if rep.row_sets:
            print(f"== FABRICATED ROW SET ({len(rep.row_sets)})")
            for v in rep.row_sets:
                print(f"   {v}\n")
        if rep.placeholders:
            print(f"== PLACEHOLDER SHAPED LIKE A MEASUREMENT ({len(rep.placeholders)})")
            for v in rep.placeholders:
                print(f"   {v}\n")
        if rep.write_loops:
            print(f"== A LITERAL WRITTEN INTO A TENANT DATABASE ({len(rep.write_loops)})")
            for v in rep.write_loops:
                print(f"   {v}\n")
        if rep.lost_unknown:
            print(f"== THE HOOK CAN NO LONGER SAY 'UNKNOWN' ({len(rep.lost_unknown)})")
            for v in rep.lost_unknown:
                print(f"   {v}\n")
        if rep.server_rows:
            print(
                f"== THE GATEWAY WRITES AN INVENTED MEASUREMENT ({len(rep.server_rows)})"
            )
            for v in rep.server_rows:
                print(f"   {v}\n")
        print(
            "ADR 0051: a rebuilt page shows live data or says it does not know, and\n"
            "nothing is pre-installed. An empty server response means NO ROWS; a\n"
            "failed fetch means UNKNOWN; neither means 'here are some'.\n"
            f"\n{len(rep.violations())} violation(s)."
        )
        return 1

    print(
        f"PASS — {len(rep.files)} web file(s) and {len(rep.server_files)} gateway file(s) "
        f"across {len(rep.roots_seen)} root(s); "
        f"{rep.scanned_chars:,} + {rep.server_scanned_chars:,} chars examined."
    )
    print("  S1-S4 (web): no module-level table of `id:`-bearing rows; no placeholderData")
    print("  except keepPreviousData; no write loop installing a module constant into")
    print("  a tenant database; and useStorageLocations still expresses unknown")
    print("  (nullable capacity, locationsUnavailable) and names no invented zone.")
    print("  S5 (gateway): no row-shaped literal in the triaged modules asserts a")
    print("  measurement no caller supplied.")
    print("  NOT checked: that a rendered figure was measured — undecidable here;")
    print("  and S5 covers only SERVER_SCAN_ROOTS, with the 10 hits outside it")
    print("  listed by name in this file's header rather than silently dropped.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
