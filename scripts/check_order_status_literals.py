#!/usr/bin/env python3
"""Guard: `procurement_orders.status` is an enum, and code must not spell it.

WHY THIS EXISTS
---------------
`procurement_orders.status` is written from `ProcurementOrderStatus`
(apps/api-gateway/src/procurement/dto/procurement.dto.ts) -- twelve UPPERCASE
members. Nine read sites across analytics, dashboard and goals compared the
column to the lowercase string `"delivered"`. Production holds `APPROVED` and
`PENDING` (measured 2026-09-01; zero lowercase rows have ever existed), so no
row could ever match:

  advanced-analytics.service.ts:290  vendor scorecard, lead time, on-time rate
  advanced-analytics.service.ts:437  cashflow / spend pacing
  goals.service.ts:320               purchase_spend goal series
  analytics.service.ts:154           loadDeliveredOrders -> HHI, spend
  insights/insight-generator.service.ts:239  the purchasing insight family
  dashboard.service.ts:322,438,569,832       spend, spend-by-month, bottles

Every one returned a STRUCTURAL ZERO: not "no data yet", but a number that
could never have been anything else -- rendered to the founder as though it had
been measured. That is `absence-reported-as-health` with the extra twist that
the absence is dressed as a measurement.

The sweep found more of the same class than the nine (all fixed in the same PR):

  dashboard.service.ts:141,145,548,704  "pending" / "awaiting_approval" /
                                        "in_transit" / "ordered" -- and
                                        `awaiting_approval` and `ordered` were
                                        never members under ANY casing, so a
                                        pure case fix would not have saved them
  ask-ai.service.ts:187,835             `.not("status","in",'("delivered",
                                        "cancelled")')` -- this one failed OPEN:
                                        nothing matched, so `NOT IN` matched
                                        EVERYTHING and closed orders were served
                                        as live candidates, including to the
                                        gate that decides whether to draft a
                                        vendor reply
  scheduled-tasks.service.ts:474,546    "SHIPPED" and "INVOICED" -- correct
                                        casing, nonexistent values

WHY THE TESTS DID NOT CATCH IT
------------------------------
Four fixtures spelled `status: "delivered"` -- the case the READER expected
rather than the case the WRITER writes -- and both spec harnesses stub the
Supabase builder with passthrough filters, so `.eq()` is never applied. The two
wrongs agreed and the suite went green. `dashboard.order-status.spec.ts` is the
counterexample: its stub honours the status filter, so a mis-cased comparison
returns nothing and the spend assertion drops to zero.

WHAT THIS GUARD CHECKS
----------------------
The enum member list is PARSED from the .ts file, never hardcoded here: if the
enum gains a member this guard learns it, and if the enum cannot be parsed the
guard exits 2 rather than checking against an empty set.

Two arms, because status comparisons reach the column two different ways:

  ARM 1  ATTRIBUTED. The site sits in a supabase chain rooted at
         `.from("procurement_orders")`. The table is known, so the rule is
         strict: EVERY string literal compared against `status` must be an
         exact enum member.

  ARM 2  UNATTRIBUTED. `o.status === "delivered"` on an array that was fetched
         earlier -- no `.from()` in reach. The table cannot be proven, so the
         rule is the high-confidence subset: a literal that matches an enum
         member CASE-INSENSITIVELY but is not exactly equal to it. `"delivered"`
         vs `DELIVERED` is caught; `"active"` (a menus row) is not a member in
         any casing and is ignored.

         Arm 2 only runs in files that actually touch `procurement_orders`.
         That single restriction removes every false positive this codebase
         has: calendar.service.ts compares `event.status === "cancelled"` and
         the email templates compare `data.status === "delivered"`, and neither
         file mentions procurement_orders at all.

WHY NOT "ANY status COMPARED TO A NON-MEMBER LITERAL"
-----------------------------------------------------
Because it does not work, and measuring that was the first thing this guard
did. `status` is a column on at least a dozen unrelated tables --
menus("active"), notifications("unread"), prospects("new"), wines("pending"),
simpos checks("open"/"voided"), recommendation_actions("snoozed"/"done"),
calendar_events("dismissed"), procurement_conversations("PENDING_APPROVAL") --
and JavaScript's own `Promise.allSettled` yields `.status === "fulfilled"`.
The naive rule fires on ~80 legitimate sites in `apps/api-gateway/src`, which
is not a guard anyone can keep green; it would be deleted or blanket-ignored
within a week. Table attribution is what makes the rule enforceable.

NEVER VACUOUS
-------------
Every "found nothing" path is a FAILURE, not a pass:
  * the source tree is missing                     -> exit 2
  * the enum file is missing or unparsable         -> exit 2
  * fewer than MIN_ENUM_MEMBERS parsed             -> exit 2
  * zero `.from("procurement_orders")` chains found -> exit 2 (the chain
    extractor rotted; arm 1 would silently check nothing)
  * zero status-comparison sites found at all      -> exit 2
  * an ALLOWLIST entry that no longer matches      -> exit 1, prune it

A guard that goes green because it found nothing to inspect is the exact shape
of the defect it was written to catch.

  ./scripts/check_order_status_literals.py
  ./scripts/check_order_status_literals.py --self-test
  ./scripts/check_order_status_literals.py --list-sites

Exit 0 = pass.  Exit 1 = violation.  Exit 2 = could not check.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys
import tempfile
from dataclasses import dataclass

SRC_ROOT = "apps/api-gateway/src"
ENUM_FILE = "apps/api-gateway/src/procurement/dto/procurement.dto.ts"
ENUM_NAME = "ProcurementOrderStatus"
TABLE = "procurement_orders"

# The enum had 12 members when this guard landed. A parse that returns a
# handful means the pattern rotted and every literal would look wrong.
MIN_ENUM_MEMBERS = 8

# Floors for the two extractors. Zero of either means the pattern rotted, not
# that the tree is clean -- both were well above these when this guard landed
# (14 procurement_orders chains, 100+ status comparisons).
MIN_CHAINS = 5
MIN_STATUS_SITES = 20

# How far a supabase chain is followed from its `.from(...)`. Chains in this
# codebase run 3-10 lines; 40 is slack without running into the next statement,
# and the chain is cut at the first line whose indentation returns to or below
# the `.from()` line's own indent (see `chain_span`).
MAX_CHAIN_LINES = 40

# ---------------------------------------------------------------------------
# ALLOWLIST -- shrink-only, and every entry is a MEASURED false positive.
#
# Keyed on (file suffix, literal, receiver identifier) rather than line number,
# so it does not rot the moment a line moves. An entry that stops matching is a
# FAILURE: it means the site was fixed or deleted and the exemption is now a
# hole the guard would happily ignore.
# ---------------------------------------------------------------------------
ALLOWLIST: dict[tuple[str, str, str], str] = {
    # `Promise.allSettled` yields PromiseSettledResult<T>, whose OWN `.status`
    # is "fulfilled" | "rejected". "rejected" collides with the enum's REJECTED
    # member. Both files genuinely query procurement_orders elsewhere, so the
    # file-affinity restriction does not exclude them; the receiver is a settled
    # result, not an order.
    (
        "dashboard/dashboard.service.ts",
        "rejected",
        "result",
    ): "PromiseSettledResult.status from Promise.allSettled, not an order status",
    (
        "analytics/insights/insight-generator.service.ts",
        "rejected",
        "r",
    ): "PromiseSettledResult.status from Promise.allSettled, not an order status",
    # Third instance of the same shape, added 2026-09-02 with ADR 0067's
    # reportSlice(): `r: PromiseSettledResult<any>` in analytics.service.ts.
    # Verified by reading the declaration, not by pattern-matching the name --
    # the receiver is the settled result itself, and the two arms are
    # "rejected" / value.error, never an order.
    (
        "analytics/analytics.service.ts",
        "rejected",
        "r",
    ): "PromiseSettledResult.status from Promise.allSettled, not an order status",
}

# ---------------------------------------------------------------------------
# KNOWN_BROKEN -- the shrink-only debt ratchet.
#
# These are NOT approved and NOT false positives. They are sites that were
# already broken when this guard landed and whose CORRECT value is a product
# question rather than a typo, recorded so the guard can be green-on-arrival
# and therefore actually block the next one. Same posture as KNOWN_MISSING in
# scripts/check_queried_tables_exist.py.
#
# Enforced in both directions: an entry that stops matching FAILS, because a
# fixed site left on the list is a hole the guard has stopped looking at.
# The only way to touch this list is to make it shorter.
# ---------------------------------------------------------------------------
KNOWN_BROKEN: dict[tuple[str, str, str], str] = {
}


# ---------------------------------------------------------------------------
# Comment stripping (line-count preserving, so reported lines stay real)
#
# Only a `//` that STARTS a line is a comment: stripping from `//` anywhere
# also eats the one in `https://`. Block comments are handled only when the
# opener starts its line, so a `/*` inside a string cannot swallow live code.
# Both lessons are already paid for in this repo -- see commit 7109522d and the
# header of check_queried_tables_exist.py.
# ---------------------------------------------------------------------------
def strip_ts_comments(text: str) -> str:
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


# ---------------------------------------------------------------------------
# Enum parsing -- derived, never hardcoded
# ---------------------------------------------------------------------------
ENUM_BLOCK_RE = re.compile(
    r"\benum\s+" + ENUM_NAME + r"\s*\{(.*?)\}", re.S
)
ENUM_MEMBER_RE = re.compile(r"""^\s*([A-Z][A-Z0-9_]*)\s*=\s*["']([^"']+)["']""", re.M)


def parse_enum(repo: pathlib.Path) -> tuple[set[str], list[str]]:
    """(member values, blockers)."""
    path = repo / ENUM_FILE
    if not path.is_file():
        return set(), [f"enum file '{ENUM_FILE}' does not exist"]
    text = strip_ts_comments(path.read_text(encoding="utf-8", errors="replace"))
    m = ENUM_BLOCK_RE.search(text)
    if not m:
        return set(), [f"could not find `enum {ENUM_NAME}` in {ENUM_FILE}"]
    values = {mm.group(2) for mm in ENUM_MEMBER_RE.finditer(m.group(1))}
    if len(values) < MIN_ENUM_MEMBERS:
        return values, [
            f"parsed only {len(values)} member(s) of {ENUM_NAME}, below the "
            f"{MIN_ENUM_MEMBERS} floor -- the member pattern has rotted, and every "
            f"literal would look wrong"
        ]
    return values, []


# ---------------------------------------------------------------------------
# Status comparison sites
# ---------------------------------------------------------------------------
@dataclass
class Site:
    path: str
    line: int
    literal: str
    receiver: str
    form: str  # "chain" | "member"
    attributed: bool


# `.eq("status", "X")`, `.neq("status", "X")`
EQ_RE = re.compile(r"""\.(?:eq|neq)\s*\(\s*["']status["']\s*,\s*["']([^"']*)["']\s*\)""")
# `.in("status", ["A", "B"])`
IN_RE = re.compile(r"""\.in\s*\(\s*["']status["']\s*,\s*\[([^\]]*)\]""")
# `.not("status", "in", '("A","B")')`
NOT_IN_RE = re.compile(
    r"""\.not\s*\(\s*["']status["']\s*,\s*["']in["']\s*,\s*["'`]\(([^)]*)\)["'`]"""
)
# `x.status === "X"` / `!==`
MEMBER_RE = re.compile(
    r"""(?:(\w+)\s*[.?])?\bstatus\s*[!=]==\s*["']([^"']*)["']"""
)
QUOTED_RE = re.compile(r"""["']([^"']+)["']""")

FROM_TABLE_RE = re.compile(r"""\.from\s*\(\s*["']([a-z_][a-z0-9_]*)["']""")
SKIP_RE = re.compile(r"(\.spec\.tsx?$|\.test\.tsx?$|/__tests__/|/__mocks__/|/e2e/)")


def chain_span(lines: list[str], start: int) -> int:
    """Last line index (inclusive) of the supabase chain beginning at `start`.

    The chain ends at the first later line whose indentation is <= the
    `.from()` line's indent and which is not itself a continuation (`.` or `)`).
    That keeps a chain from leaking into the next statement, which would
    mis-attribute the following query's filters to this table.
    """
    base = len(lines[start]) - len(lines[start].lstrip())
    end = min(start + MAX_CHAIN_LINES, len(lines) - 1)
    for i in range(start + 1, end + 1):
        line = lines[i]
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        head = line.lstrip()[0]
        if indent <= base and head not in ".)":
            return i - 1
    return end


def scan_file(rel: str, text: str) -> tuple[list[Site], int]:
    """(sites, number of procurement_orders chains found)."""
    lines = text.split("\n")
    sites: list[Site] = []

    # Line ranges belonging to a chain rooted at each table.
    attributed: dict[int, str] = {}
    chains = 0
    for i, line in enumerate(lines):
        for m in FROM_TABLE_RE.finditer(line):
            table = m.group(1)
            if table == TABLE:
                chains += 1
            for j in range(i, chain_span(lines, i) + 1):
                # First writer wins: a nested chain cannot steal an outer one's
                # lines, and the outer `.from()` is always seen first.
                attributed.setdefault(j, table)

    for i, line in enumerate(lines):
        table = attributed.get(i)
        # A site is checkable if it belongs to a procurement_orders chain, or
        # belongs to no chain at all (arm 2). A site inside ANOTHER table's
        # chain is that table's business.
        if table is not None and table != TABLE:
            continue
        is_attr = table == TABLE

        for m in EQ_RE.finditer(line):
            sites.append(Site(rel, i + 1, m.group(1), "", "chain", is_attr))
        for pat in (IN_RE, NOT_IN_RE):
            for m in pat.finditer(line):
                for q in QUOTED_RE.finditer(m.group(1)):
                    sites.append(Site(rel, i + 1, q.group(1), "", "chain", is_attr))
        for m in MEMBER_RE.finditer(line):
            sites.append(
                Site(rel, i + 1, m.group(2), m.group(1) or "", "member", is_attr)
            )
    return sites, chains


# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------
def evaluate(
    sites: list[Site], members: set[str], touches_table: dict[str, bool]
) -> tuple[list[Site], list[Site], list[Site], set[tuple[str, str, str]]]:
    """(violations, allowlisted, known-broken debt, entry keys that matched)."""
    lower = {m.lower(): m for m in members}
    violations: list[Site] = []
    exempt: list[Site] = []
    debt: list[Site] = []
    used: set[tuple[str, str, str]] = set()

    for s in sites:
        if s.attributed:
            # Strict: the table is proven.
            if s.literal in members:
                continue
        else:
            # Arm 2 only where the file demonstrably touches the table.
            if not touches_table.get(s.path):
                continue
            low = s.literal.lower()
            # Only a case-variant of a real member is confident enough here.
            if low not in lower or s.literal == lower[low]:
                continue

        def match(table: dict[tuple[str, str, str], str]) -> tuple | None:
            return next(
                (
                    k
                    for k in table
                    if s.path.endswith(k[0])
                    and s.literal == k[1]
                    and s.receiver == k[2]
                ),
                None,
            )

        key = match(ALLOWLIST)
        if key:
            used.add(key)
            exempt.append(s)
            continue
        key = match(KNOWN_BROKEN)
        if key:
            used.add(key)
            debt.append(s)
            continue
        violations.append(s)
    return violations, exempt, debt, used


def collect(repo: pathlib.Path) -> tuple[list[Site], int, dict[str, bool], int]:
    root = repo / SRC_ROOT
    sites: list[Site] = []
    chains = 0
    touches: dict[str, bool] = {}
    files = 0
    for f in sorted(root.rglob("*.ts")):
        rel = str(f.relative_to(repo))
        if SKIP_RE.search(rel):
            continue
        files += 1
        raw = f.read_text(encoding="utf-8", errors="replace")
        text = strip_ts_comments(raw)
        s, c = scan_file(rel, text)
        # File affinity: does this file deal with procurement_orders at all?
        # `.from("procurement_orders")`, or an import of the shared vocabulary,
        # or the DatabaseService helper that returns those rows.
        touches[rel] = bool(
            TABLE in text
            or "order-status" in text
            or "getProcurementOrders" in text
        )
        sites.extend(s)
        chains += c
    return sites, chains, touches, files


BAD_FIXTURE = '''
const client = supabase.from("procurement_orders");
await client.select("*").eq("status", "delivered");
const arrived = orders.filter((o) => o.status === "delivered");
'''
GOOD_FIXTURE = '''
const client = supabase.from("procurement_orders");
await client.select("*").in("status", ORDER_SPEND_STATUSES);
const arrived = orders.filter((o) => hasStatus(o.status, ORDER_SPEND_STATUSES));
'''


def self_test(members: set[str]) -> int:
    """Prove the guard detects a known-bad input and clears a known-good one."""
    print("== self-test")
    ok = True
    with tempfile.TemporaryDirectory() as td:
        for label, body, want in (
            ("known-bad", BAD_FIXTURE, 2),
            ("known-good", GOOD_FIXTURE, 0),
        ):
            p = pathlib.Path(td) / f"{label}.ts"
            p.write_text(body, encoding="utf-8")
            sites, chains, _, _ = collect_one(p)
            viol, _, _, _ = evaluate(sites, members, {str(p): True})
            got = len(viol)
            status = "ok " if got == want else "FAIL"
            if got != want:
                ok = False
            print(f"   {status} {label}: {got} violation(s), expected {want}")
            for v in viol:
                print(f"        line {v.line}: status vs \"{v.literal}\"")
        # The guard must also NOT fire on another table's chain.
        p = pathlib.Path(td) / "other-table.ts"
        p.write_text(
            'supabase.from("menus").select("*").eq("status", "active");\n',
            encoding="utf-8",
        )
        sites, _, _, _ = collect_one(p)
        viol, _, _, _ = evaluate(sites, members, {str(p): True})
        status = "ok " if not viol else "FAIL"
        if viol:
            ok = False
        print(f"   {status} other-table chain: {len(viol)} violation(s), expected 0")

    print()
    if ok:
        print("PASS -- the guard detects the defect it was written for.")
        return 0
    print("FAIL (exit 1) -- the guard no longer detects its own known-bad input.")
    return 1


def collect_one(path: pathlib.Path) -> tuple[list[Site], int, dict[str, bool], int]:
    text = strip_ts_comments(path.read_text(encoding="utf-8", errors="replace"))
    s, c = scan_file(str(path), text)
    return s, c, {str(path): True}, 1


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--self-test", action="store_true", help="prove it detects a known-bad input")
    ap.add_argument("--list-sites", action="store_true", help="print every status comparison found")
    args = ap.parse_args()

    repo = pathlib.Path(__file__).resolve().parent.parent
    blocked: list[str] = []

    members, enum_blockers = parse_enum(repo)
    blocked.extend(enum_blockers)
    if members:
        print(f"== {ENUM_NAME}: {len(members)} members parsed from {ENUM_FILE}")
        print("   " + ", ".join(sorted(members)))

    if args.self_test:
        if blocked:
            print()
            print("BLOCKED: cannot self-test without the enum.")
            for b in blocked:
                print(f"   * {b}")
            return 2
        return self_test(members)

    if not (repo / SRC_ROOT).is_dir():
        blocked.append(f"source tree '{SRC_ROOT}' does not exist -- ran from the wrong place?")
        sites, chains, touches, files = [], 0, {}, 0
    else:
        sites, chains, touches, files = collect(repo)

    print()
    print(f"== scanned {files} file(s) under {SRC_ROOT}")
    print(f"   {len(sites)} status comparison(s) considered")
    print(f"   {sum(1 for s in sites if s.attributed)} attributed to a {TABLE} chain")
    print(f"   {chains} `.from(\"{TABLE}\")` chain(s) found")
    print(f"   {sum(1 for v in touches.values() if v)} file(s) touch {TABLE}")

    if files and chains < MIN_CHAINS:
        blocked.append(
            f"only {chains} `.from(\"{TABLE}\")` chain(s) found, below the {MIN_CHAINS} "
            f"floor. The chain extractor has rotted and arm 1 is checking nothing."
        )
    if files and len(sites) < MIN_STATUS_SITES:
        blocked.append(
            f"only {len(sites)} status comparison(s) found, below the {MIN_STATUS_SITES} "
            f"floor. The comparison patterns have rotted."
        )

    if args.list_sites:
        print()
        for s in sorted(sites, key=lambda x: (x.path, x.line)):
            tag = "ORDER" if s.attributed else "  ?  "
            print(f"   [{tag}] {s.path}:{s.line}  status vs \"{s.literal}\"")

    violations, exempt, debt, used = evaluate(sites, members, touches)

    if exempt:
        print()
        print(f"   {len(exempt)} allowlisted site(s) (measured false positives):")
        for s in exempt:
            print(f"     {s.path}:{s.line}  {s.receiver}.status === \"{s.literal}\"")

    if debt:
        print()
        print(f"   {len(debt)} KNOWN-BROKEN site(s) -- broken today, tracked, NOT approved:")
        for s in debt:
            print(f"     {s.path}:{s.line}  status vs \"{s.literal}\"")
        print("   These send/return nothing in production right now. See KNOWN_BROKEN.")

    fail = 0

    # Ratchet: an entry that no longer matches is a hole.
    for key in list(ALLOWLIST) + list(KNOWN_BROKEN):
        if key not in used:
            fail = 1
            print()
            where = "allowlist" if key in ALLOWLIST else "KNOWN_BROKEN"
            print(f"FAIL: {where} entry {key} no longer matches any site.")
            print("   -> Delete it. An entry nobody matches is a hole the guard")
            print("      will silently apply to whatever moves into that shape next.")

    if violations:
        fail = 1
        print()
        print(f"FAIL: {len(violations)} status comparison(s) use a literal that is not a")
        print(f"      {ENUM_NAME} member:")
        for s in sorted(violations, key=lambda x: (x.path, x.line)):
            why = (
                f"not a member (chain on {TABLE})"
                if s.attributed
                else f"case-variant of {s.literal.upper()}"
            )
            print(f"     {s.path}:{s.line}  \"{s.literal}\"  -- {why}")
        print()
        print("   -> Do not retype the literal in the right case. Import the shared")
        print("      vocabulary from apps/api-gateway/src/procurement/order-status.ts:")
        print("      ORDER_SPEND_STATUSES, ORDER_ARRIVED_STATUSES, ORDER_CLOSED_STATUSES,")
        print("      and `hasStatus()` for in-memory filters. Which set a call site wants")
        print("      is a real question -- ADR 0058 records why they differ.")

    print()
    if blocked:
        print("BLOCKED: this guard could not check what it claims to check.")
        for b in blocked:
            print(f"   * {b}")
        print()
        print("FAIL (exit 2) -- reported as a failure, not a pass. A check that goes green")
        print("       because it found nothing to inspect is the exact shape of the defect")
        print("       it was written to catch.")
        return 2
    if fail:
        print("FAIL (exit 1) -- a status literal escaped the enum.")
        return 1
    print(f"PASS -- every {TABLE}.status comparison uses {ENUM_NAME}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
