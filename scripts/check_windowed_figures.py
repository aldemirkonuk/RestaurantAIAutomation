#!/usr/bin/env python3
"""
Guard: a figure from a capped query is a floor, and an unknown is not a zero.

    ./scripts/check_windowed_figures.py
    ./scripts/check_windowed_figures.py --self-test

WHY THIS IS A GUARD AND NOT A CONVENTION
----------------------------------------
Six figures on the rebuilt /receiving were server-side windows rendered as
totals, and there was not one `≥` on the page:

    RcStaffLane.tsx:181     `deliveries.length`, a 25-row page, printed as
                            "N out for delivery" — while the gateway had
                            returned the exact `total` and the hook threw it
                            away (useReceivingNextData.ts:94).
    RcManagerQueue.tsx:91   lane counts filtered from a `.limit(100)` list.
    RcManagerQueue.tsx:390  the at-risk total summed over the same list.
    RcManagerQueue.tsx:121  the uncounted strip, built behind `.limit(500)`.
    RcOwnerLedger.tsx       every recovery figure, behind `.limit(5000)` with
                            no `.order()`.

and two neighbouring shapes said "unknown" and "zero" with the same mark:

    RcManagerQueue.tsx:261  `dollarsAtRisk > 0 ? fmtMoneyWhole(…) : EM`
                            printed a MEASURED $0 as an em dash, on a row whose
                            next field printed a literal `0`. One row could read
                            "$— · 0 open claims".
    useReceivingNextData:250 `unverified: known ? … : []` — so the shrinkage
                            safety net rendered "nothing uncounted" exactly when
                            its query failed.

That is one rule wearing seven hats, which is the signature of something a
command should hold rather than a reviewer.

WHAT THIS GUARD CHECKS — AND WHAT IT EXPLICITLY DOES NOT
--------------------------------------------------------
The rule as stated in prose — "a value derived from a capped query must not
render as a total" — is NOT decidable by static analysis. The cap is a numeric
literal inside a Supabase query builder in a NestJS service; the value crosses
an HTTP boundary, is reshaped by a react-query `queryFn`, flows through a
`useMemo`, and is finally interpolated into JSX. Proving the link needs
interprocedural dataflow across two languages and a network hop. Any guard
claiming to do that would be lying, and a lying guard is worse than none.

So this is narrowed to five things that ARE mechanically checkable, each of
which is a real regression barrier for one of the defects above:

  W1  DECLARED WINDOW == ACTUAL CAP. The page keeps a `SERVER_WINDOWS` register
      whose entries each cite the gateway query that imposes them. Every
      declared number must still appear as a `.limit(N)` in the file it cites.
      This is the rot that matters most: change `.limit(100)` to `.limit(250)`
      server-side and the page's floor prose ("capped at 100 rows") becomes a
      confident falsehood that reads exactly like a measurement.

  W2  A DECLARED WINDOW IS ACTUALLY CONSUMED. Every key in the register must be
      referenced outside its own declaration, and any renderer that references
      the register must also use a floor marker (`GE`, `fmtIntFloor`,
      `fmtMoneyWholeFloor`). Deleting the `≥` while keeping the constant is the
      cheapest way to silently undo this work.

  W3  NO MEASURED ZERO FOLDED INTO AN UNKNOWN. The shape `x > 0 ? fmt(x) : EM`
      is forbidden in the page tree. It is the literal pre-fix expression, it is
      syntactic, and it has no legitimate use here: a real zero renders as the
      zero, an absent figure renders as the dash, and `num()` already separates
      them. The same rule forbids a view-model FIELD whose unanswered branch is
      `[]` — restricted to object properties on purpose, because a helper that
      parses local storage and returns `[]` for a malformed value is reporting
      "no pins", which is a measurement rather than a silenced query.

  W4  UNKNOWN-CAPABLE FIELDS KEEP THEIR `| null`. The three fields whose whole
      job is to express "the query did not answer" must stay nullable. Widening
      `UnverifiedDelivery[] | null` back to `UnverifiedDelivery[]` is what let
      a failed fetch render as "nothing uncounted".

  W5  A CAPPED FETCH MAY NOT DISCARD ITS OWN CARDINALITY. A `queryFn` that
      sends a `limit` must read `total` or `hasMore` from the response. This is
      the closest honest approximation of the stated rule that a command can
      hold: it does not prove the figure is floor-marked downstream, but it
      does prove the exact count was not thrown away at the door — which is the
      specific mistake that forced a page length to stand in for a total.

WHAT IT DOES NOT COVER, STATED PLAINLY
--------------------------------------
- It does not trace a value from a `.limit()` to a JSX node. See above.
- It does not verify that a floor marker is attached to the RIGHT figure. W2
  proves markers exist in a file that knows about windows; it cannot prove the
  `≥` sits on the windowed number rather than on a neighbouring one.
- It does not read the gateway's own rendering, or any other page. A second
  page repeating this defect is a second guard's job; conflating them would let
  a green run here be read as a stronger claim than it is.
- It cannot see a cap introduced by PostgREST defaults or by a database view.

W6  A PAGE HOOK'S QUERY KEY CARRIES THE TENANT. Every `queryKey` in a guarded
      page hook must include an identifier resolved from the active restaurant.
      The gateway scopes these endpoints by tenant through a header the client
      stamps from localStorage (services/api/client.ts:67-69) — the key never
      sees it — so an unkeyed cache serves the PREVIOUS restaurant's rows after
      a switch. This is syntactic and exact: the key literal either contains the
      tenant token or it does not. It is what /receipts shipped without after
      PR #212 fixed the identical thing on /receiving, which is the definition
      of a rule a reviewer cannot be trusted to hold.

      It does NOT prove the token holds the right value, only that the key is
      tenant-shaped. A hook that resolves the id incorrectly passes W6.

W7  AN IMPORTED QUERY HOOK THE PAGE DEPENDS ON IS ALSO TENANT-KEYED. W6 reads
      only the page's own files, and that is not where a page's cache
      necessarily lives: /communications gets its conversation book from
      `useProcurementConversationHistory` in the SHARED
      `hooks/queries/useConversationQueries.ts`, whose key was the constant
      `['procurement','history']`. W6 could never have seen it, so a green W6
      would have been a green tick over the page's largest cache bucket.

      Each page therefore names the imported hooks it depends on, BY FUNCTION,
      and the guard extracts that one function body and checks its key. Naming
      the function rather than the file is deliberate: the same shared file
      holds `useConversations`, whose filter-keyed cache belongs to a different
      page and is not this page's to judge.

SCOPE. Five pages: `apps/web/src/pages/receiving/next`,
`apps/web/src/pages/receipts/next`, `apps/web/src/pages/communications/next`,
`apps/web/src/pages/documents-reports/next` and `apps/web/src/pages/team`
(that last one BOTH halves — the `next/` redesign and the `command/` legacy
desk are one route behind one flag, and the tenant leak this guard's W6 exists
for was on the redesigned half while the legacy half had it right), plus the
gateway files their registers cite and the shared query hooks they name. Each
page declares its own register, renderers and nullable contract in PAGES below;
adding a sixth page means adding a sixth entry, not a second script. A page
absent from PAGES is NOT checked, and this guard makes no claim about it.

A NOTE ON /team's MARKER, BECAUSE THE WRONG ONE WOULD BE A LIE. `floor_markers`
is a per-page tuple for a reason. /team has exactly one server-side window and
it does not bound a COUNT: `performance.service.ts:139` computes a median and
an inter-quartile band over the most recent 200 `server_sales` rows. The honest
mark on a statistic drawn from a capped sample is a ceiling on the sample
("over <=200 services"), never a floor on a total, so /team's marker is `LE`
and not `GE`. Forcing a floor there to satisfy a guard would have produced a
precise-looking falsehood, which is the class this file exists to stop.

The Sorting Office (`/documents-reports`) was added after it shipped a routine
count out of a 100-row timeline window with no `≥` on it, twelve lines below a
sentence promising the floor rule — while the four drawers and the header
above it all carried the mark correctly. One figure missed by a reviewer on a
page whose own prose states the rule is the argument for holding it here.

NEVER VACUOUS
-------------
Exit 0 pass, 1 violation, **2 cannot check**. Exit 2 blocks in CI exactly like
exit 1. Every anchor this guard depends on — the register, the cited gateway
files, the `.limit(` calls inside them, the interfaces W4 reads — is verified to
exist before any rule is evaluated, because a guard that passes because its
anchor moved is a green check mark over an unexamined surface. That is how six
windowed figures shipped as totals in the first place.

REGISTERING A PAGE MEANS GIVING IT FIXTURES — READ THIS BEFORE RESOLVING A
CONFLICT IN THIS FILE
-------------------------------------------------------------------------
Two branches once grew this guard at the same time and each added a different
fourth page. The naive union — take the newer file, paste in the other side's
`PageSpec` — parses, covers every rule, and exits 0 against the real tree. Then
`--self-test` reports `cannot-check` for EVERY case, because `_scaffold` builds
a synthetic tree with no files for the newly registered page and the exit-2
branch fires on all of them.

That output is not a broken self-test. It is the self-test STOPPING and SAYING
SO — the exact behaviour the section above buys, working in our favour. Which
makes the hazard not the red run but the two ways of turning it green that are
both worse than leaving it red:

  1. Dropping the page from PAGES. Instant green, bought by shrinking what is
     checked, with nothing recording that the page left the guard's scope.
  2. Softening the fixture-less case to exit 0. Also instant green, and it
     retires the exit-2 branch entirely: from then on ANY page registered
     without fixtures passes. That is the vacuity this guard family has
     produced five times, this file's own `"GE" in src` — satisfied by the
     word `MERGE` — among them.

The resolution is neither. It is to ADD THE FIXTURES: a `CLEAN_*` hook and
renderer for the page, `CLEAN_*` sources for every gateway file its register
cites, the `_scaffold` writes for all of them, and one self-test case per rule
the page actually exercises — including any rule that did not exist when the
page's own branch was written (W7 is how this happened: the Sorting Office's
`threadsTotal` and `draftsPending` both live in shared hooks W6 cannot see, and
a `PageSpec` carrying `imported_query_hooks=()` would have been a green tick
over both).

And `--self-test` passes only when EVERY CASE passes. The command exiting 0 is
not the claim; `self_test()` returns 1 on any failure, so read the case lines.
A green `guard exit=0` against the real tree says nothing about whether the
guard can still fail — that is what the self-test is for.
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

GATEWAY_ROOT = Path("apps/api-gateway/src")


@dataclass(frozen=True)
class PageSpec:
    """One rebuilt page this guard holds. Everything is per-page on purpose."""

    name: str
    hooks: Path
    renderers: tuple[Path, ...]
    register: str
    floor_markers: tuple[str, ...]
    # interface -> the fields whose job is to say "the query did not answer"
    nullable_contract: dict[str, list[str]]
    # A query key literal must contain one of these tokens to be tenant-shaped.
    tenant_tokens: tuple[str, ...]
    # Whether W6 is ENFORCED for this page. False is never a silent skip: it is
    # printed on every clean run, with the reason, so "not checked" can never be
    # read as "checked and fine".
    tenant_keyed: bool
    tenant_note: str = ""
    # W7 — (file, exported function name) pairs: shared query hooks this page's
    # cache actually lives in. Named by FUNCTION so a shared file's other hooks,
    # which belong to other pages, are not judged here.
    imported_query_hooks: tuple[tuple[Path, str], ...] = ()


_RECEIVING = Path("apps/web/src/pages/receiving/next")
_RECEIPTS = Path("apps/web/src/pages/receipts/next")
_COMMS = Path("apps/web/src/pages/communications/next")
_SORTING_OFFICE = Path("apps/web/src/pages/documents-reports/next")
_TEAM_NEXT = Path("apps/web/src/pages/team/next")
_TEAM_CMD = Path("apps/web/src/pages/team/command")
_QUERY_HOOKS = Path("apps/web/src/hooks/queries/useConversationQueries.ts")
_DRAFT_HOOKS = Path("apps/web/src/hooks/queries/useDraftEmailQueries.ts")

PAGES = (
    PageSpec(
        name="/receiving",
        hooks=_RECEIVING / "useReceivingNextData.ts",
        renderers=(
            _RECEIVING / "RcStaffLane.tsx",
            _RECEIVING / "RcManagerQueue.tsx",
            _RECEIVING / "RcOwnerLedger.tsx",
            _RECEIVING / "RcOutboxRail.tsx",
        ),
        register="SERVER_WINDOWS",
        floor_markers=("GE", "fmtIntFloor", "fmtMoneyWholeFloor"),
        nullable_contract={
            "ManagerQueueData": ["unverified"],
            "OutboxData": ["queued"],
            "QueueItemVM": ["atRisk", "openClaimsFloor"],
        },
        tenant_tokens=("rid", "restaurantId"),
        # NOT ENFORCED, and this is a measurement, not an assumption: three of
        # this page's keys are bare today — `receiving-next-queue`,
        # `receiving-next-recovery`, `receiving-next-credit-drafts`. The lane is
        # owned by an unmerged branch, so turning W6 on here would fail CI on
        # somebody else's work rather than fix it. Flip this to True in the
        # change that keys those three.
        tenant_keyed=False,
        tenant_note=(
            "3 bare keys remain: receiving-next-queue, receiving-next-recovery, "
            "receiving-next-credit-drafts"
        ),
    ),
    PageSpec(
        name="/receipts",
        hooks=_RECEIPTS / "useReceiptsNextData.ts",
        renderers=(_RECEIPTS / "ReceiptsNext.tsx",),
        register="RECEIPTS_SERVER_WINDOWS",
        floor_markers=("GE",),
        nullable_contract={
            # `deliveriesWithoutPaper` answered `[]` on a FAILED fetch, which
            # renders identically to a caught-up door. It must be able to say
            # it does not know.
            "ReceiptsNextData": ["deliveriesWithoutPaper", "verifiedCount"],
        },
        tenant_tokens=("rid", "restaurantId"),
        tenant_keyed=True,
    ),
    PageSpec(
        name="/communications",
        hooks=_COMMS / "useCommsNextData.ts",
        renderers=(_COMMS / "CommunicationsNext.tsx",),
        register="COMMS_SERVER_WINDOWS",
        floor_markers=("GE",),
        nullable_contract={
            # Every glance figure must be able to say it does not know. The page
            # has FIVE sources and only one of them used to have a failure
            # surface, so four figures rendered a failure as the em dash the ADR
            # reserves for "has not answered".
            "CommsGlance": ["threads", "draftsPending", "sentLast30", "schedules"],
        },
        tenant_tokens=("rid", "restaurantId"),
        tenant_keyed=True,
        imported_query_hooks=(
            # The conversation book — the page's largest bucket, and the one W6
            # structurally cannot see because it lives in a shared file.
            (_QUERY_HOOKS, "useProcurementConversationHistory"),
            (_QUERY_HOOKS, "useConversationThreads"),
            (_DRAFT_HOOKS, "useActiveConversations"),
        ),
    ),
    PageSpec(
        name="/documents-reports",
        hooks=_SORTING_OFFICE / "useSortingOfficeData.ts",
        renderers=(_SORTING_OFFICE / "DocumentsReportsNext.tsx",),
        register="SO_SERVER_WINDOWS",
        floor_markers=("GE",),
        nullable_contract={
            # Every figure on the Sorting Office is a count, so every one of
            # them has to be able to say the register did not answer. The page
            # renders `—` for null and a digit for a measurement, which is the
            # only thing separating a dead gateway from an empty cellar here.
            "SortingOfficeData": [
                "waiting",
                "reportsTotal",
                "paperCount",
                "paperNeedsReviewCount",
                "threadsTotal",
                "draftsPending",
                "timelineCount",
                "todayRoutine",
            ],
        },
        tenant_tokens=("rid", "restaurantId"),
        tenant_keyed=True,
        # W7 did not exist when this page was added, and it is not optional
        # here: TWO of the eight fields in the contract above —
        # `threadsTotal` (useSortingOfficeData.ts:352) and `draftsPending`
        # (:353) — are served entirely from these shared hooks, which live
        # outside the page tree where W6 structurally cannot reach them.
        # Leaving this tuple empty would have registered the page while
        # leaving a quarter of its glance figures unchecked.
        imported_query_hooks=(
            (_QUERY_HOOKS, "useConversationThreads"),
            (_DRAFT_HOOKS, "useActiveConversations"),
        ),
    ),
    PageSpec(
        name="/team",
        hooks=_TEAM_NEXT / "useTeamNextData.ts",
        # BOTH halves. /team is one route behind one flag, and the two halves
        # disagreed about this exact rule: the legacy desk keyed every query by
        # `activeRestaurantId` from the day it shipped, and the redesign that
        # replaces it shipped three bare keys. Listing only the half being
        # rebuilt would have made a green run mean "the half that was already
        # right is still right".
        # The parity build (2026-09-04) split the redesigned half into files;
        # every one of them is listed, because W6 can only see the files this
        # tuple names and a query in an unlisted renderer would be a bucket
        # nobody checks while the run still prints "clean".
        renderers=(
            _TEAM_NEXT / "TeamNext.tsx",
            _TEAM_NEXT / "WeekGrid.tsx",
            _TEAM_NEXT / "RosterSheet.tsx",
            _TEAM_NEXT / "ShiftSheet.tsx",
            _TEAM_NEXT / "TeamOverlays.tsx",
            _TEAM_NEXT / "TeamRecord.tsx",
            _TEAM_NEXT / "PerformanceCard.tsx",
            _TEAM_NEXT / "MyShiftsNext.tsx",
            _TEAM_CMD / "ManagerShiftDesk.tsx",
            _TEAM_CMD / "MyShifts.tsx",
            _TEAM_CMD / "OpsRulesPanel.tsx",
            _TEAM_CMD / "PerformancePanel.tsx",
        ),
        register="TEAM_SERVER_WINDOWS",
        # A ceiling, not a floor — see the header note. /team's one window caps
        # the SAMPLE a median is computed over, not a count being reported.
        floor_markers=("LE",),
        nullable_contract={
            # `shiftsThisWeek` used to be `blockedShifts: number`, which could
            # only ever say "0 blocked" when the week had not answered; and
            # `coverageRules` used to not exist at all, which is why an empty
            # rule file and a staffed week printed the same sentence.
            "CertExposureVM": ["shiftsThisWeek"],
            "TeamNextData": ["week", "coverageRules", "membersCount", "certsOnFile"],
        },
        # `activeRestaurantId` is spelled out because 'restaurantId' is NOT a
        # substring of it (capital R) — the legacy half would have failed a
        # token list that only carried the other two.
        tenant_tokens=("rid", "restaurantId", "activeRestaurantId"),
        tenant_keyed=True,
        # W7 checks shared hooks a page DECLARES. /team declares none: every
        # query it reads is a `useQuery` in one of the TWELVE files above —
        # eight on the rebuilt half since the 2026-09-04 parity build split it,
        # four on the legacy one — so W6 sees all of them. That is a
        # measurement, not an omission, and it is printed on every clean run so
        # it cannot be read as "checked and fine". Keep this count honest: it is
        # the sentence a reader trusts instead of counting the tuple.
        imported_query_hooks=(),
    ),
)

# `x > 0 ? something : EM` — a measured zero rendered as an unknown.
ZERO_AS_UNKNOWN = re.compile(r">\s*0\s*\?[^\n]{0,120}?:\s*EM\b")

# `unverified: known ? … : [],` — a VIEW-MODEL FIELD whose unanswered branch is
# an empty list. Deliberately restricted to an object property: a local helper
# that parses storage and returns `[]` for a malformed value is answering
# "there are no pins", which is a measurement, not a silenced query.
EMPTY_AS_UNKNOWN = re.compile(
    r"^\s*[A-Za-z_$][\w$]*:\s*[^\n]*?\?[^\n?]*?:\s*\[\]\s*,?\s*$", re.MULTILINE
)


class CannotCheck(Exception):
    """An anchor this guard depends on is missing. Never a silent skip."""


@dataclass
class Report:
    drift: list[str] = field(default_factory=list)
    unconsumed: list[str] = field(default_factory=list)
    zero_as_unknown: list[str] = field(default_factory=list)
    lost_null: list[str] = field(default_factory=list)
    discarded_count: list[str] = field(default_factory=list)
    untenanted_key: list[str] = field(default_factory=list)

    def violations(self) -> list[str]:
        return (
            self.drift
            + self.unconsumed
            + self.zero_as_unknown
            + self.lost_null
            + self.discarded_count
            + self.untenanted_key
        )


def read(root: Path, rel: Path) -> str:
    p = root / rel
    if not p.is_file():
        raise CannotCheck(f"anchor file is missing: {rel}")
    return p.read_text(encoding="utf-8")


# ── the register ─────────────────────────────────────────────────────────────

ENTRY = re.compile(r"^\s*([A-Z_]+):\s*(\d+),", re.MULTILINE)
CITE = re.compile(r"([A-Za-z0-9_.-]+\.ts):(\d+)")

# `queryKey: [ … ]` — the literal array, which either names the tenant or does not.
QUERY_KEY = re.compile(r"queryKey:\s*\[([^\]]*)\]")

# `queryKey: someKeys.forRestaurant(rid)` and `queryKey: someKeys.all` — a key
# FACTORY or a shared constant. Without this the matcher saw only array
# literals, so a hook that moved its key behind either became invisible to
# W6/W7 while still looking checked: the same vacuity class as the
# `useQuery<T>({` bug above, and the reason both are tested below. At least one
# dot is required so a bare local (`queryKey: key`) still trips the
# no-keys-found CannotCheck rather than being judged on its variable name.
QUERY_KEY_CALL = re.compile(
    r"queryKey:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\s*\([^()]*\))?)"
)


# Whole `import … from '…'` statements, single- or multi-line, WITH OR WITHOUT
# the trailing semicolon. Stripped before W2 looks for a floor marker, so an
# unused import cannot stand in for a use.
#
# The optional semicolon is not cosmetic. The first version of this required
# one, and /team's legacy half is written semicolon-free — so on that page a
# leftover `import { LE }` would have satisfied the marker check after every
# use of it was deleted, which is vacuity #3 in this file's collection. It is
# tested below on a semicolon-free renderer for exactly that reason.
IMPORT_LINE = re.compile(
    r"^\s*import\s(?:[\s\S]*?from\s*)?['\"][^'\"]+['\"];?[ \t]*$",
    re.MULTILINE,
)


def query_keys(text: str) -> list[str]:
    """Every key EXPRESSION in `text` — array literals and factory calls alike."""
    return QUERY_KEY.findall(text) + QUERY_KEY_CALL.findall(text)


def parse_register(src: str, page: PageSpec) -> list[tuple[str, int, str]]:
    """(key, cap, cited gateway file basename) for each declared window."""
    register_start = f"export const {page.register} = {{"
    start = src.find(register_start)
    if start < 0:
        raise CannotCheck(
            f"`{register_start}` not found in {page.hooks} — the register this "
            "guard reads has been renamed or deleted."
        )
    end = src.find("} as const;", start)
    if end < 0:
        raise CannotCheck(f"{page.register} is not closed with `}} as const;`")
    body = src[start + len(register_start) : end]

    out: list[tuple[str, int, str]] = []
    for m in ENTRY.finditer(body):
        key, cap = m.group(1), int(m.group(2))
        # The citation lives in the doc comment immediately above the entry.
        preceding = body[: m.start()]
        cites = CITE.findall(preceding)
        if not cites:
            raise CannotCheck(
                f"{page.register}.{key} declares a cap with no `<file>.ts:<line>` "
                "citation above it — the guard cannot tell which query imposes it."
            )
        out.append((key, cap, cites[-1][0]))

    if not out:
        raise CannotCheck(
            f"{page.register} parsed to zero entries. Every rule below would pass "
            "vacuously, which is the exact failure this guard exists to prevent."
        )
    return out


def resolve_gateway(root: Path, basename: str) -> Path:
    hits = sorted((root / GATEWAY_ROOT).rglob(basename))
    if not hits:
        raise CannotCheck(
            f"cited gateway file `{basename}` does not exist under {GATEWAY_ROOT} — "
            "the citation is stale, so the declared cap cannot be verified."
        )
    return hits[0]


# ── W5: a capped fetch must keep its cardinality ─────────────────────────────


# `useQuery({` AND `useQuery<T[]>({`. The generic form was invisible to an
# earlier version of this regex, which made W5 and W6 pass on a hook whose every
# query was annotated — a guard that checks nothing and prints "clean". That is
# the failure mode this whole file exists to prevent, so it is tested below.
USE_QUERY = re.compile(r"use(?:Infinite)?Query\s*(?:<[^()<>]*(?:<[^()<>]*>[^()<>]*)*>)?\s*\(\s*\{")


def query_bodies(src: str) -> list[str]:
    """Each `useQuery({ … })` argument, by brace matching."""
    bodies: list[str] = []
    for m in USE_QUERY.finditer(src):
        depth, i = 0, m.end() - 1
        while i < len(src):
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
                if depth == 0:
                    bodies.append(src[m.end() - 1 : i + 1])
                    break
            i += 1
    return bodies


def function_body(src: str, name: str) -> str | None:
    """
    The body of `export function <name>(…) { … }`, by brace matching.

    The parameter list is stepped over rather than searched past: these hooks are
    declared `useConversationThreads(filters: ConversationFilters = {})`, so the
    first `{` after the name belongs to a DEFAULT ARGUMENT. Matching on it would
    return an empty body and W7 would then report "holds no queryKey" on a hook
    whose key is fine — a guard crying wolf is on its way to being switched off.
    """
    m = re.search(rf"export\s+function\s+{re.escape(name)}\s*\(", src)
    if not m:
        return None
    # Walk the parameter list to its closing paren.
    depth, i = 0, m.end() - 1
    while i < len(src):
        if src[i] == "(":
            depth += 1
        elif src[i] == ")":
            depth -= 1
            if depth == 0:
                break
        i += 1
    else:
        return None
    brace = src.find("{", i)
    if brace < 0:
        return None
    depth, i = 0, brace
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[brace : i + 1]
        i += 1
    return None


def run(root: Path) -> Report:
    """Every rule, for every page in PAGES. A page is never skipped silently."""
    rep = Report()
    for page in PAGES:
        run_page(root, page, rep)
    return rep


def run_page(root: Path, page: PageSpec, rep: Report) -> None:
    hooks_src = read(root, page.hooks)
    renderer_src = {r: read(root, r) for r in page.renderers}

    windows = parse_register(hooks_src, page)

    # ── W1 — declared cap still matches the query that imposes it ────────────
    for key, cap, basename in windows:
        gateway = resolve_gateway(root, basename)
        text = gateway.read_text(encoding="utf-8")
        if ".limit(" not in text and f"min({cap}" not in text.replace(" ", ""):
            raise CannotCheck(
                f"`{basename}` holds no `.limit(` and no `min({cap}` at all, so "
                f"{page.register}.{key} cannot be verified against it. The anchor "
                "moved — fix the citation, do not delete the entry."
            )
        # A cap is imposed either by a literal `.limit(N)` or by a clamp the
        # controller applies before it (`Math.min(200, …)` then `.limit(n)`),
        # which is how /receipts' 100 is bounded. Both count; neither is assumed.
        clamped = re.findall(r"Math\.min\(\s*(\d+)", text)
        if f".limit({cap})" not in text and not any(int(c) >= cap for c in clamped):
            found = sorted(set(re.findall(r"\.limit\((\d+)\)", text)))
            rep.drift.append(
                f"[window drift] {page.name}: {page.register}.{key} declares {cap} but "
                f"{basename} neither has `.limit({cap})` (it has: {', '.join(found) or 'none'}) "
                f"nor a `Math.min` clamp that admits it (it has: {', '.join(clamped) or 'none'}). "
                "The page's floor prose now names a cap the server does not use."
            )

    # ── W2 — the register is consumed, and its consumers mark floors ─────────
    all_page = hooks_src + "".join(renderer_src.values())
    for key, _cap, _basename in windows:
        uses = len(re.findall(rf"{page.register}\.{key}\b", all_page))
        if uses == 0:
            rep.unconsumed.append(
                f"[unconsumed window] {page.name}: {page.register}.{key} is declared but "
                "never referenced. A cap nobody reads cannot be marking any figure."
            )
    for rel, src in renderer_src.items():
        # A marker must be USED, not merely named. Two vacuities were measured
        # here while extending this guard to /communications, both by deleting
        # the ≥ from the live strip and watching the guard print "clean":
        #
        #   1. `"GE" in src` was a SUBSTRING test, so any file containing
        #      `MERGE` or `GET` satisfied it — and this page's own header
        #      comment says MERGE.
        #   2. Even matched as an identifier, the leftover `import { GE }`
        #      satisfied it after every use was gone.
        #
        # So imports are stripped before the search. tsc would also catch (2) as
        # TS6133, but a guard that passes because another tool might fail is not
        # holding the rule it claims to hold.
        body = IMPORT_LINE.sub("", src)
        if page.register in src and not any(
            re.search(rf"\b{re.escape(mk)}\b", body) for mk in page.floor_markers
        ):
            rep.unconsumed.append(
                f"[no floor marker] {rel} knows about {page.register} but uses none of "
                f"{', '.join(page.floor_markers)}. ADR 0051 clause 2: a windowed count "
                "renders as a floor."
            )

    # ── W3 — a measured zero is not an unknown ───────────────────────────────
    for rel, src in list(renderer_src.items()) + [(page.hooks, hooks_src)]:
        for m in ZERO_AS_UNKNOWN.finditer(src):
            line = src[: m.start()].count("\n") + 1
            rep.zero_as_unknown.append(
                f"[zero as unknown] {rel}:{line} — `{m.group(0).strip()}` renders a "
                "MEASURED zero as the unknown dash. ADR 0051 clause 1: the two must "
                "be distinguishable. Use num() to get null-or-number and format that."
            )
    for m in EMPTY_AS_UNKNOWN.finditer(hooks_src):
        line = hooks_src[: m.start()].count("\n") + 1
        rep.zero_as_unknown.append(
            f"[empty as unknown] {page.hooks}:{line} — a conditional falls back to `[]`. "
            "In this file an unanswered query must be null, or a failed fetch renders "
            "as an empty list and a safety net goes silent when it is needed most."
        )

    # ── W4 — the unknown-capable fields keep their null ──────────────────────
    for iface, fields in page.nullable_contract.items():
        m = re.search(rf"interface {iface}[^{{]*\{{(.*?)\n\}}", hooks_src, re.S)
        if not m:
            raise CannotCheck(
                f"interface {iface} not found in {page.hooks} — W4 has no contract "
                "to check."
            )
        body = m.group(1)
        for fname in fields:
            fm = re.search(rf"^\s*{fname}\s*:\s*([^;]+);", body, re.M)
            if not fm:
                raise CannotCheck(
                    f"{iface}.{fname} not found — the field W4 guards was renamed or "
                    "removed. Update the contract deliberately, do not drop the check."
                )
            if "null" not in fm.group(1):
                rep.lost_null.append(
                    f"[unknown lost] {iface}.{fname} is `{fm.group(1).strip()}` with no "
                    "`| null`. This field's job is to say the query did not answer; "
                    "without null it can only say 'empty', which is a measurement."
                )

    # ── W5 — a capped fetch keeps its own cardinality ────────────────────────
    for body in query_bodies(hooks_src):
        if "queryFn" not in body:
            continue
        if not re.search(r"\blimit\b", body):
            continue
        # A queryFn that reads the register is asking for the cap ON PURPOSE and
        # marks the result as a floor (W2 proves the marker exists); it is not
        # discarding a count the gateway offered, because these list endpoints
        # return a bare array with no total to discard.
        if page.register in body:
            continue
        if not re.search(r"\btotal\b", body) and not re.search(r"\bhasMore\b", body):
            key = re.search(r"queryKey:\s*\[\s*'([^']+)'", body)
            name = key.group(1) if key else "an unnamed query"
            rep.discarded_count.append(
                f"[cardinality discarded] {page.name}: the `{name}` query sends a `limit` "
                "but reads neither `total` nor `hasMore` from the response, and does not "
                f"declare its cap in {page.register}. The exact count is sitting in the "
                "payload; without it the page can only render a page length, which is a "
                "window dressed as a total."
            )

    # ── W6 — every query key carries the tenant ──────────────────────────────
    if not page.tenant_keyed:
        return
    # ONLY the `useQuery({...})` arguments. A `queryClient.invalidateQueries({
    # queryKey: ['receipts-next'] })` is a PREFIX for cache eviction, not a
    # bucket anything is stored under, and flagging it would train people to
    # silence the rule.
    hook_bodies = query_bodies(hooks_src)
    # A hook that mentions useQuery but parses to zero bodies means the matcher
    # lost its grip on the syntax — the exact way this rule once went vacuous.
    if "useQuery" in hooks_src and not hook_bodies:
        raise CannotCheck(
            f"{page.hooks} contains `useQuery` but none could be parsed. W6 and W5 "
            "would both pass on a file they never read."
        )
    bodies = hook_bodies + [b for src in renderer_src.values() for b in query_bodies(src)]
    keys = [k for b in bodies for k in query_keys(b)]
    if not keys:
        raise CannotCheck(
            f"no `queryKey: [...]` found in any parsed useQuery in {page.name}'s hook "
            "or renderers. W6 would pass vacuously, which is how /receipts kept three "
            "bare keys through a tenant-keying sweep."
        )
    for k in keys:
        flat = k.replace("\n", " ").strip()
        if not any(tok in flat for tok in page.tenant_tokens):
            rep.untenanted_key.append(
                f"[untenanted key] {page.name}: `queryKey: [{flat}]` names no tenant "
                f"(looked for {', '.join(page.tenant_tokens)}). The gateway scopes this "
                "endpoint by restaurant through a header the key never sees, so after a "
                "restaurant switch this cache bucket serves the PREVIOUS tenant's rows."
            )

    # ── W7 — the shared hooks this page's cache actually lives in ────────────
    for rel, fname in page.imported_query_hooks:
        src = read(root, rel)
        body = function_body(src, fname)
        if body is None:
            raise CannotCheck(
                f"{page.name}: `export function {fname}` not found in {rel}. This page "
                "declares it as a query hook it depends on; if it was renamed or moved, "
                "update the declaration — do not drop the check, because W6 cannot see "
                "this file at all."
            )
        hook_keys = query_keys(body)
        if not hook_keys:
            raise CannotCheck(
                f"{page.name}: {rel}::{fname} holds no `queryKey: [...]`. W7 would pass "
                "vacuously on the bucket it exists to check."
            )
        for k in hook_keys:
            flat = k.replace("\n", " ").strip()
            if not any(tok in flat for tok in page.tenant_tokens):
                rep.untenanted_key.append(
                    f"[untenanted key] {page.name}: {rel}::{fname} uses "
                    f"`queryKey: [{flat}]`, which names no tenant (looked for "
                    f"{', '.join(page.tenant_tokens)}). This hook lives OUTSIDE the page "
                    "tree, so W6 never sees it — and it is where this page's conversation "
                    "book is cached."
                )


def verdict(rep: Report) -> str:
    return "clean" if not rep.violations() else "violation"


# ── self-test ────────────────────────────────────────────────────────────────

CLEAN_HOOKS = """
export const SERVER_WINDOWS = {
  /** receiving.service.ts:375 — the queue's own rows. */
  QUEUE_ITEMS: 100,
} as const;

export interface QueueItemVM {
  atRisk: number | null;
  openClaimsFloor: number | null;
}

export interface ManagerQueueData {
  unverified: UnverifiedDelivery[] | null;
}

export interface OutboxData {
  queued: QueuedReceiptVM[] | null;
}

export function useThing() {
  const q = useQuery({
    queryKey: ['receiving-next-open-orders', rid],
    queryFn: async () => {
      const { data } = await apiClient.get('/procurement/orders', { params: { limit: 25 } });
      return { orders: data?.orders ?? [], total: num(data?.total), hasMore: data?.hasMore === true };
    },
  });
  const itemsAtFloor = items.length >= SERVER_WINDOWS.QUEUE_ITEMS;
  return { itemsAtFloor };
}
"""

CLEAN_RENDERER = """
import { GE, fmtIntFloor, fmtMoneyWholeFloor } from './rc-format';
import { SERVER_WINDOWS } from './useReceivingNextData';
export function R() {
  return <span title={`cap ${SERVER_WINDOWS.QUEUE_ITEMS}`}>{fmtIntFloor(n, atFloor)}{GE}</span>;
}
"""

CLEAN_GATEWAY = """
export class ReceivingService {
  async managerQueue() {
    return this.db.from("x").select("*").limit(100);
  }
}
"""


CLEAN_RECEIPTS_HOOKS = """
export const RECEIPTS_SERVER_WINDOWS = {
  /** documents.controller.ts:117 — `Math.min(200, …)` hard-caps every list. */
  QUEUE_ITEMS: 100,
} as const;

export interface ReceiptsNextData {
  deliveriesWithoutPaper: UnverifiedDelivery[] | null;
  verifiedCount: number | null;
}

export function useReceiptsNextData() {
  const rid = useActiveRestaurantId();
  const queueQ = useQuery({
    queryKey: ['receipts-next', 'queue', rid],
    queryFn: () => documentsApi.list({ limit: RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS }),
    enabled,
  });
  return { queueCapped: queue.length >= RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS };
}
"""

CLEAN_RECEIPTS_RENDERER = """
import { GE } from './rc2-format';
import { RECEIPTS_SERVER_WINDOWS } from './useReceiptsNextData';
export function R() {
  const q = useQuery({ queryKey: ['receipts-next', 'doc', rid, id], queryFn: f });
  return <span title={`${RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS}`}>{cap ? GE : ''}{n}</span>;
}
"""

CLEAN_DOCS_GATEWAY = """
export class DocumentsController {
  async list(@Query("limit") limit?: string) {
    const n = Math.min(200, Math.max(1, parseInt(limit ?? "50", 10) || 50));
    return this.db.from("procurement_documents").select("*").limit(n);
  }
}
"""

CLEAN_COMMS_HOOKS = """
export const COMMS_SERVER_WINDOWS = {
  /** procurement.service.ts:3635 — getConversationHistory ends `.limit(100)`. */
  HISTORY_ROWS: 100,
} as const;

export interface CommsGlance {
  threads: number | null;
  draftsPending: number | null;
  sentLast30: number | null;
  sentLast30Truncated: boolean;
  schedules: number | null;
}

export function useCommsNextData() {
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? '';
  const schedulesQ = useQuery<ScheduledReport[]>({
    queryKey: ['report-schedules', restaurantId],
    queryFn: listReportSchedules,
  });
  const gmailQ = useQuery<{ configured: boolean }>({
    queryKey: ['comms-gmail-watch-status', restaurantId],
    queryFn: async () => (await apiClient.get('/x')).data,
  });
  const truncated = (historyQ.data?.length ?? 0) >= COMMS_SERVER_WINDOWS.HISTORY_ROWS;
  return { truncated, schedulesQ, gmailQ };
}
"""

# The header deliberately says MERGE and the body calls GET: both contain the
# substring "GE", which is how the marker check went vacuous the first time.
CLEAN_COMMS_RENDERER = """
/** MAKEOVER-VERDICTS: MERGE with a warning on both sides. */
import { EM, GE, MONO } from './cm-format';
import { COMMS_SERVER_WINDOWS, useCommsNextData } from './useCommsNextData';
export function R() {
  const t = `cap ${COMMS_SERVER_WINDOWS.HISTORY_ROWS}`;
  return <span title={t}>{unknown ? EM : floor ? `${GE}${value}` : value}</span>;
}
"""

CLEAN_QUERY_HOOKS = """
export const procurementHistoryKeys = {
  all: ['procurement', 'history'] as const,
  forRestaurant: (restaurantId: string) => ['procurement', 'history', restaurantId] as const,
}

export function useConversations(filters: ConversationFilters = {}) {
  return useQuery({ queryKey: conversationKeys.list(filters), queryFn: f })
}

export function useConversationThreads(filters: ConversationFilters = {}) {
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? ''
  return useQuery({
    queryKey: [...conversationKeys.lists(), 'byThread', restaurantId, filters],
    queryFn: f,
  })
}

export function useProcurementConversationHistory() {
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? ''
  return useQuery({
    queryKey: procurementHistoryKeys.forRestaurant(restaurantId),
    queryFn: f,
  })
}
"""

CLEAN_DRAFT_HOOKS = """
export function useActiveConversations() {
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? ''
  return useQuery({ queryKey: activeConversationKeys.list(restaurantId), queryFn: f })
}
"""

CLEAN_PROCUREMENT_GATEWAY = """
export class ProcurementService {
  async getConversationHistory(restaurantId: string) {
    return this.db.from("procurement_conversations").select("*").limit(100);
  }
}
"""

CLEAN_SO_HOOKS = """
export const SO_SERVER_WINDOWS = {
  /** documents.controller.ts:117 — `Math.min(200, …)` hard-caps every list. */
  PAPER: 100,
  /** logs-timeline.service.ts:99 — `Math.min(200, …)` clamps the feed. */
  TIMELINE: 100,
  /** reports.service.ts:95 — `Math.min(200, …)` bounds the report page. */
  REPORTS: 100,
} as const;

export interface TodayRoutine {
  count: number;
  countCapped: boolean;
}

export interface SortingOfficeData {
  waiting: WaitingRow[] | null;
  reportsTotal: number | null;
  paperCount: number | null;
  paperNeedsReviewCount: number | null;
  threadsTotal: number | null;
  draftsPending: number | null;
  timelineCount: number | null;
  todayRoutine: TodayRoutine | null;
}

export function useSortingOfficeData(): SortingOfficeData {
  const rid = useAuth().activeRestaurantId ?? '';
  const threadsQ = useConversationThreads();
  const activeQ = useActiveConversations();
  const reportsQ = useQuery<{ reports: GeneratedReport[]; total: number }>({
    queryKey: ['sorting-office', 'reports', rid],
    queryFn: () => listReportsWithTotal({ limit: SO_SERVER_WINDOWS.REPORTS }),
  });
  const paperQ = useQuery<ProcurementDocument[]>({
    queryKey: ['sorting-office', 'paper', rid],
    queryFn: () => documentsApi.list({ limit: SO_SERVER_WINDOWS.PAPER }),
  });
  const timelineQ = useQuery<TimelineResponse>({
    queryKey: ['sorting-office', 'timeline', rid],
    queryFn: async () =>
      apiClient.get(`/logs/timeline/${rid}`, { params: { limit: SO_SERVER_WINDOWS.TIMELINE } }),
  });
  return { paperCapped: paper.length >= SO_SERVER_WINDOWS.PAPER };
}
"""

CLEAN_SO_RENDERER = """
import { EM, GE } from './so-format';
import { SO_SERVER_WINDOWS } from './useSortingOfficeData';
export function R() {
  const crossQ = useQuery({ queryKey: ['sorting-office', 'cross-file', rid, report.id], queryFn: f });
  return (
    <span title={`at most ${SO_SERVER_WINDOWS.TIMELINE} events`}>
      {value === null ? EM : `${capped ? GE : ''}${value}`}
    </span>
  );
}
"""

CLEAN_TIMELINE_GATEWAY = """
export class LogsTimelineService {
  async getTimeline(restaurantId: string, opts: { limit?: number } = {}) {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    return this.db.from("pos_checks").select("*").limit(limit);
  }
}
"""

CLEAN_REPORTS_GATEWAY = """
export class ReportsService {
  async listReports(restaurantId: string, opts: { limit?: number } = {}) {
    const limit = Math.min(200, Math.max(1, Math.trunc(opts.limit ?? 100) || 100));
    return this.supabase.from("generated_reports").select("*", { count: "exact" }).limit(limit);
  }
}
"""

# /team's hook. Note the semicolons here and their ABSENCE in the legacy
# renderers below: the page is written in both styles and the guard has to cope
# with both, which is why CLEAN_TEAM_PERF carries a semicolon-free import.
CLEAN_TEAM_HOOKS = """
export const TEAM_SERVER_WINDOWS = {
  /** performance.service.ts:139 — the team benchmark ends `.limit(200)`. */
  BENCHMARK_SERVICES: 200,
} as const;

export interface CertExposureVM {
  shiftsThisWeek: number | null;
}

export interface TeamNextData {
  week: WeekPayload | null;
  coverageRules: CoverageRule[] | null;
  membersCount: number | null;
  certsOnFile: number | null;
}

export function useTeamNextData() {
  const rid = useActiveRestaurantId();
  const weekQ = useQuery({ queryKey: ['team-next-week', rid, weekStart], queryFn: f });
  const rulesQ = useQuery({ queryKey: ['team-next-coverage-rules', rid], queryFn: f });
  return { week: weekQ.data ?? null, coverageRules: rulesQ.data === undefined ? null : rulesQ.data };
}
"""

CLEAN_TEAM_NEXT = """
import { EM } from './tm-format';
import { useTeamNextData } from './useTeamNextData';
export default function TeamNext() {
  const data = useTeamNextData();
  return <span>{data.membersCount === null ? EM : data.membersCount}</span>;
}
"""

# Semicolon-free, like the real legacy desk.
CLEAN_TEAM_DESK = """
import { useAuth } from '../../../contexts/AuthContext'
export function ManagerShiftDesk() {
  const { activeRestaurantId } = useAuth()
  const weekQ = useQuery<WeekPayload>({
    queryKey: ['team', 'week', activeRestaurantId, weekStart],
    queryFn: () => getWeek(weekStart),
  })
  return <div>{weekQ.isError ? 'unknown' : 'ok'}</div>
}
"""

CLEAN_TEAM_MYSHIFTS = """
import { useAuth } from '../../../contexts/AuthContext'
export function MyShifts() {
  const { activeRestaurantId } = useAuth()
  const q = useQuery({ queryKey: ['team', 'my-week', activeRestaurantId, weekStart], queryFn: f })
  return <div>{q.isError ? 'not known' : 'Off'}</div>
}
"""

CLEAN_TEAM_OPS = """
import { useAuth } from '../../../contexts/AuthContext'
export function OpsRulesPanel() {
  const { activeRestaurantId } = useAuth()
  const t = useQuery({ queryKey: ['team', 'coverage-templates', activeRestaurantId], queryFn: f })
  const c = useQuery({ queryKey: ['team', 'certs', activeRestaurantId], queryFn: f })
  return <div>{t.data?.length}{c.data?.length}</div>
}
"""

# The semicolon-free import is deliberate: strip it and the marker must be gone.
CLEAN_TEAM_PERF = """
import { useAuth } from '../../../contexts/AuthContext'
import { TEAM_SERVER_WINDOWS } from '../next/useTeamNextData'
import { LE } from '../next/tm-format'
export function PerformancePanel({ member }) {
  const { activeRestaurantId } = useAuth()
  const q = useQuery({ queryKey: ['team', 'performance', activeRestaurantId, member?.id], queryFn: f })
  return <div>{LE}{TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES} of them{q.data ? '' : ''}</div>
}
"""

CLEAN_PERF_GATEWAY = """
export class PerformanceService {
  async member() {
    return this.sb.from("server_sales").select("*").limit(200);
  }
}
"""

_TEAM = PAGES[3]

# Bound BY NAME, not by position. /documents-reports and /team were added on
# two branches at the same time and both took `PAGES[3]`; merged by position,
# the two names point at ONE spec and the other page's fixtures are never
# built — a self-test that still exits 0 while covering four pages of five.
# An index is a claim about ordering that nothing checks; a name is identity.
_BY_NAME = {pg.name: pg for pg in PAGES}
assert len(_BY_NAME) == len(PAGES), "two PAGES entries share a name"
_RCV = _BY_NAME["/receiving"]
_RCP = _BY_NAME["/receipts"]
_CMS = _BY_NAME["/communications"]
_SO = _BY_NAME["/documents-reports"]
_TEAM = _BY_NAME["/team"]


def _scaffold(tmp: Path) -> None:
    (tmp / _RCV.hooks.parent).mkdir(parents=True, exist_ok=True)
    (tmp / _RCP.hooks.parent).mkdir(parents=True, exist_ok=True)
    (tmp / _CMS.hooks.parent).mkdir(parents=True, exist_ok=True)
    (tmp / _SO.hooks.parent).mkdir(parents=True, exist_ok=True)
    (tmp / _QUERY_HOOKS.parent).mkdir(parents=True, exist_ok=True)
    (tmp / GATEWAY_ROOT / "procurement").mkdir(parents=True, exist_ok=True)
    (tmp / GATEWAY_ROOT / "logs").mkdir(parents=True, exist_ok=True)
    (tmp / GATEWAY_ROOT / "reports").mkdir(parents=True, exist_ok=True)
    (tmp / _RCV.hooks).write_text(CLEAN_HOOKS, encoding="utf-8")
    for r in _RCV.renderers:
        (tmp / r).write_text(CLEAN_RENDERER, encoding="utf-8")
    (tmp / _RCP.hooks).write_text(CLEAN_RECEIPTS_HOOKS, encoding="utf-8")
    for r in _RCP.renderers:
        (tmp / r).write_text(CLEAN_RECEIPTS_RENDERER, encoding="utf-8")
    (tmp / _CMS.hooks).write_text(CLEAN_COMMS_HOOKS, encoding="utf-8")
    for r in _CMS.renderers:
        (tmp / r).write_text(CLEAN_COMMS_RENDERER, encoding="utf-8")
    (tmp / _SO.hooks).write_text(CLEAN_SO_HOOKS, encoding="utf-8")
    for r in _SO.renderers:
        (tmp / r).write_text(CLEAN_SO_RENDERER, encoding="utf-8")
    (tmp / _QUERY_HOOKS).write_text(CLEAN_QUERY_HOOKS, encoding="utf-8")
    (tmp / _DRAFT_HOOKS).write_text(CLEAN_DRAFT_HOOKS, encoding="utf-8")
    (tmp / GATEWAY_ROOT / "procurement" / "receiving.service.ts").write_text(
        CLEAN_GATEWAY, encoding="utf-8"
    )
    (tmp / GATEWAY_ROOT / "procurement" / "documents.controller.ts").write_text(
        CLEAN_DOCS_GATEWAY, encoding="utf-8"
    )
    (tmp / GATEWAY_ROOT / "procurement" / "procurement.service.ts").write_text(
        CLEAN_PROCUREMENT_GATEWAY, encoding="utf-8"
    )
    (tmp / GATEWAY_ROOT / "logs" / "logs-timeline.service.ts").write_text(
        CLEAN_TIMELINE_GATEWAY, encoding="utf-8"
    )
    (tmp / GATEWAY_ROOT / "reports" / "reports.service.ts").write_text(
        CLEAN_REPORTS_GATEWAY, encoding="utf-8"
    )

    (tmp / _TEAM.hooks.parent).mkdir(parents=True, exist_ok=True)
    (tmp / _TEAM_CMD).mkdir(parents=True, exist_ok=True)
    (tmp / GATEWAY_ROOT / "team").mkdir(parents=True, exist_ok=True)
    (tmp / _TEAM.hooks).write_text(CLEAN_TEAM_HOOKS, encoding="utf-8")
    for rel, body in zip(
        _TEAM.renderers,
        (CLEAN_TEAM_NEXT, CLEAN_TEAM_DESK, CLEAN_TEAM_MYSHIFTS, CLEAN_TEAM_OPS, CLEAN_TEAM_PERF),
    ):
        (tmp / rel).write_text(body, encoding="utf-8")
    (tmp / GATEWAY_ROOT / "team" / "performance.service.ts").write_text(
        CLEAN_PERF_GATEWAY, encoding="utf-8"
    )


def self_test() -> int:
    failures: list[str] = []

    def case(name: str, mutate, expect: str, expect_text: str | None = None) -> None:
        """
        `expect_text` must appear in the reported detail. It exists because a
        mutation to a SHARED fixture is caught by every page that declares it,
        so the verdict alone cannot distinguish "this page's declaration is
        live" from "some other page's declaration caught it and this one is
        decoration". W7 on /documents-reports is exactly that shape: the two
        hooks it names are also named by /communications, so without asserting
        on the message these cases would pass with the declaration deleted.
        """
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
            missing = ok and expect_text is not None and expect_text not in detail
            if missing:
                ok = False
            print(f"   {'ok  ' if ok else 'FAIL'}  {name}: expected {expect}, got {got}")
            if missing:
                print(f"           but no message mentioned {expect_text!r}")
            if detail and (not ok or got != "clean"):
                print(f"           {detail.splitlines()[0][:150]}")
            if not ok:
                failures.append(name)

    print("== SELF-TEST — the guard must fire on the shapes it exists to catch\n")

    case("clean tree passes", lambda _: None, "clean")

    case(
        "W1 the server cap moved and the register did not",
        lambda t: (t / GATEWAY_ROOT / "procurement" / "receiving.service.ts").write_text(
            CLEAN_GATEWAY.replace("limit(100)", "limit(250)"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W2 the floor markers were deleted from a renderer",
        lambda t: (t / _RCV.renderers[1]).write_text(
            "import { SERVER_WINDOWS } from './useReceivingNextData';\n"
            "export function R() { return <span>{n}</span>; }\n",
            encoding="utf-8",
        ),
        "violation",
    )
    def orphan_the_window(t: Path) -> None:
        # The constant survives; every reader of it is replaced by a literal —
        # which is how a cap stops governing anything while still looking cited.
        (t / _RCV.hooks).write_text(
            CLEAN_HOOKS.replace("SERVER_WINDOWS.QUEUE_ITEMS", "999"), encoding="utf-8"
        )
        for r in _RCV.renderers:
            (t / r).write_text(
                CLEAN_RENDERER.replace("SERVER_WINDOWS.QUEUE_ITEMS", "999").replace(
                    "import { SERVER_WINDOWS } from './useReceivingNextData';\n", ""
                ),
                encoding="utf-8",
            )

    case("W2 a declared window nobody reads", orphan_the_window, "violation")
    case(
        "W3 a measured zero rendered as the unknown dash",
        lambda t: (t / _RCV.renderers[1]).write_text(
            CLEAN_RENDERER.replace(
                "{fmtIntFloor(n, atFloor)}",
                "{item.dollarsAtRisk > 0 ? fmtMoneyWhole(item.dollarsAtRisk) : EM}",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W3 a view-model field whose unanswered branch is an empty list",
        lambda t: (t / _RCV.hooks).write_text(
            CLEAN_HOOKS.replace(
                "  return { itemsAtFloor };",
                "  return {\n    unverified: known ? q.data!.unverified ?? [] : [],\n"
                "    itemsAtFloor,\n  };",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W3 does NOT fire on a storage parser that returns [] for a bad value",
        lambda t: (t / _RCV.hooks).write_text(
            CLEAN_HOOKS.replace(
                "  const itemsAtFloor",
                "  const pins = Array.isArray(arr) ? (arr as Pin[]) : [];\n  const itemsAtFloor",
            ),
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "W4 the unknown state widened away",
        lambda t: (t / _RCV.hooks).write_text(
            CLEAN_HOOKS.replace(
                "unverified: UnverifiedDelivery[] | null;", "unverified: UnverifiedDelivery[];"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W5 a capped fetch that discards total and hasMore",
        lambda t: (t / _RCV.hooks).write_text(
            CLEAN_HOOKS.replace(
                "return { orders: data?.orders ?? [], total: num(data?.total), hasMore: data?.hasMore === true };",
                "return data?.orders ?? [];",
            ),
            encoding="utf-8",
        ),
        "violation",
    )

    case(
        "W6 a receipts query key lost its tenant",
        lambda t: (t / _RCP.hooks).write_text(
            CLEAN_RECEIPTS_HOOKS.replace("'queue', rid]", "'queue']"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W6 a renderer's per-document key lost its tenant",
        lambda t: (t / _RCP.renderers[0]).write_text(
            CLEAN_RECEIPTS_RENDERER.replace("'doc', rid, id]", "'doc', id]"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W6 sees a GENERIC-annotated useQuery (the vacuity bug)",
        lambda t: (t / _RCP.hooks).write_text(
            CLEAN_RECEIPTS_HOOKS.replace("useQuery({", "useQuery<ProcurementDocument[]>({").replace(
                "'queue', rid]", "'queue']"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W6 does NOT fire on an invalidateQueries prefix",
        lambda t: (t / _RCP.renderers[0]).write_text(
            CLEAN_RECEIPTS_RENDERER.replace(
                "  return <span",
                "  qc.invalidateQueries({ queryKey: ['receipts-next'] });\n  return <span",
            ),
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "W4 the receipts unknown state widened away",
        lambda t: (t / _RCP.hooks).write_text(
            CLEAN_RECEIPTS_HOOKS.replace(
                "deliveriesWithoutPaper: UnverifiedDelivery[] | null;",
                "deliveriesWithoutPaper: UnverifiedDelivery[];",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W1 the documents controller's clamp fell below the declared cap",
        lambda t: (t / GATEWAY_ROOT / "procurement" / "documents.controller.ts").write_text(
            CLEAN_DOCS_GATEWAY.replace("Math.min(200", "Math.min(25"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W2 the receipts floor marker was deleted",
        lambda t: (t / _RCP.renderers[0]).write_text(
            CLEAN_RECEIPTS_RENDERER.replace("{cap ? GE : ''}", "").replace(
                "import { GE } from './rc2-format';\n", ""
            ),
            encoding="utf-8",
        ),
        "violation",
    )

    # ── /communications ──────────────────────────────────────────────────────
    print("\n-- /communications --\n")
    case(
        "W7 the SHARED history hook lost its tenant (W6 cannot see this file)",
        lambda t: (t / _QUERY_HOOKS).write_text(
            CLEAN_QUERY_HOOKS.replace(
                "queryKey: procurementHistoryKeys.forRestaurant(restaurantId),",
                "queryKey: procurementHistoryKeys.all,",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W7 the shared thread hook lost its tenant",
        lambda t: (t / _QUERY_HOOKS).write_text(
            CLEAN_QUERY_HOOKS.replace("'byThread', restaurantId, filters]", "'byThread', filters]"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W7 does NOT judge a shared file's OTHER hooks (useConversations)",
        lambda _: None,
        "clean",
    )
    case(
        "W6 the comms schedules key lost its tenant",
        lambda t: (t / _CMS.hooks).write_text(
            CLEAN_COMMS_HOOKS.replace("'report-schedules', restaurantId]", "'report-schedules']"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W2 the comms floor marker was deleted but its IMPORT remained",
        lambda t: (t / _CMS.renderers[0]).write_text(
            CLEAN_COMMS_RENDERER.replace(
                "{unknown ? EM : floor ? `${GE}${value}` : value}", "{unknown ? EM : value}"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W2 `MERGE` and `GET` do not count as the marker `GE`",
        lambda t: (t / _CMS.renderers[0]).write_text(
            CLEAN_COMMS_RENDERER.replace(
                "import { EM, GE, MONO } from './cm-format';\n", ""
            ).replace("{unknown ? EM : floor ? `${GE}${value}` : value}", "{await GET(x)}"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W4 a comms glance figure widened away from | null",
        lambda t: (t / _CMS.hooks).write_text(
            CLEAN_COMMS_HOOKS.replace("threads: number | null;", "threads: number;"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W1 the comms cap drifts from the server's .limit(100)",
        lambda t: (t / _CMS.hooks).write_text(
            CLEAN_COMMS_HOOKS.replace("HISTORY_ROWS: 100,", "HISTORY_ROWS: 250,"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W7 a declared shared hook was renamed",
        lambda t: (t / _QUERY_HOOKS).write_text(
            CLEAN_QUERY_HOOKS.replace(
                "export function useProcurementConversationHistory()",
                "export function useProcurementHistory()",
            ),
            encoding="utf-8",
        ),
        "cannot-check",
    )
    case(
        "W7 a declared shared hook holds no queryKey at all",
        lambda t: (t / _QUERY_HOOKS).write_text(
            CLEAN_QUERY_HOOKS.replace(
                "    queryKey: procurementHistoryKeys.forRestaurant(restaurantId),\n", ""
            ),
            encoding="utf-8",
        ),
        "cannot-check",
    )
    case(
        "the comms register was deleted",
        lambda t: (t / _CMS.hooks).write_text("export const nothing = 1;\n", encoding="utf-8"),
        "cannot-check",
    )

    # ── /documents-reports (the Sorting Office) ──────────────────────────────
    print("\n-- /documents-reports --\n")
    case(
        "W1 the timeline clamp fell below the Sorting Office's declared window",
        lambda t: (t / GATEWAY_ROOT / "logs" / "logs-timeline.service.ts").write_text(
            CLEAN_TIMELINE_GATEWAY.replace("Math.min(200", "Math.min(25"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W1 the reports page bound fell below the Sorting Office's declared window",
        lambda t: (t / GATEWAY_ROOT / "reports" / "reports.service.ts").write_text(
            CLEAN_REPORTS_GATEWAY.replace("Math.min(200", "Math.min(20"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W2 the Sorting Office's floor marker was deleted",
        lambda t: (t / _SO.renderers[0]).write_text(
            CLEAN_SO_RENDERER.replace("${capped ? GE : ''}", "").replace(
                "import { EM, GE } from './so-format';\n", "import { EM } from './so-format';\n"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W2 a Sorting Office window nobody reads",
        lambda t: (t / _SO.hooks).write_text(
            CLEAN_SO_HOOKS.replace("SO_SERVER_WINDOWS.REPORTS", "100"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W4 the Sorting Office's waiting queue lost its unknown",
        lambda t: (t / _SO.hooks).write_text(
            CLEAN_SO_HOOKS.replace("waiting: WaitingRow[] | null;", "waiting: WaitingRow[];"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W4 the routine roll lost its unknown",
        lambda t: (t / _SO.hooks).write_text(
            CLEAN_SO_HOOKS.replace(
                "todayRoutine: TodayRoutine | null;", "todayRoutine: TodayRoutine;"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W6 the Sorting Office's cross-file key lost its tenant",
        lambda t: (t / _SO.renderers[0]).write_text(
            CLEAN_SO_RENDERER.replace("'cross-file', rid, report.id]", "'cross-file', report.id]"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W6 sees the Sorting Office's GENERIC-annotated hook queries",
        # Every query in this hook is `useQuery<T>({`. The matcher that could
        # not see that form is what made W5 and W6 pass on a file they never
        # read, so the page that is written entirely in it gets its own case.
        lambda t: (t / _SO.hooks).write_text(
            CLEAN_SO_HOOKS.replace("'paper', rid]", "'paper']"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W3 a Sorting Office register whose unanswered branch is an empty list",
        lambda t: (t / _SO.hooks).write_text(
            CLEAN_SO_HOOKS.replace(
                "  return { paperCapped:",
                "  return {\n    waiting: known ? rows : [],\n    paperCapped:",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    # W7 arrived on the other branch, AFTER this page was written. These two
    # cases assert on the message text, not just the verdict: both hooks are
    # also declared by /communications, so a verdict-only case would stay green
    # with this page's `imported_query_hooks` deleted — a case that cannot fail
    # for the reason it names is the vacuity this file exists to prevent.
    case(
        "W7 the shared thread hook is checked FOR THE SORTING OFFICE too",
        lambda t: (t / _QUERY_HOOKS).write_text(
            CLEAN_QUERY_HOOKS.replace("'byThread', restaurantId, filters]", "'byThread', filters]"),
            encoding="utf-8",
        ),
        "violation",
        expect_text="/documents-reports",
    )
    case(
        "W7 the shared drafts hook is checked FOR THE SORTING OFFICE too",
        lambda t: (t / _DRAFT_HOOKS).write_text(
            CLEAN_DRAFT_HOOKS.replace(
                "activeConversationKeys.list(restaurantId)", "activeConversationKeys.all"
            ),
            encoding="utf-8",
        ),
        "violation",
        expect_text="/documents-reports",
    )

    print("\n-- and CANNOT CHECK must not read as a pass --\n")
    case(
        "the register was deleted",
        lambda t: (t / _RCV.hooks).write_text("export const nothing = 1;\n", encoding="utf-8"),
        "cannot-check",
    )
    case(
        "the cited gateway file is gone",
        lambda t: (t / GATEWAY_ROOT / "procurement" / "receiving.service.ts").unlink(),
        "cannot-check",
    )
    case(
        "the cited file lost every .limit()",
        lambda t: (t / GATEWAY_ROOT / "procurement" / "receiving.service.ts").write_text(
            "export class ReceivingService {}\n", encoding="utf-8"
        ),
        "cannot-check",
    )
    case(
        "a guarded field was renamed",
        lambda t: (t / _RCV.hooks).write_text(
            CLEAN_HOOKS.replace("unverified:", "uncounted:"), encoding="utf-8"
        ),
        "cannot-check",
    )
    case(
        "a renderer is missing",
        lambda t: (t / _RCV.renderers[2]).unlink(),
        "cannot-check",
    )
    case(
        "the receipts register was deleted",
        lambda t: (t / _RCP.hooks).write_text("export const nothing = 1;\n", encoding="utf-8"),
        "cannot-check",
    )
    case(
        "the Sorting Office register was deleted",
        lambda t: (t / _SO.hooks).write_text("export const nothing = 1;\n", encoding="utf-8"),
        "cannot-check",
    )
    case(
        "the cited timeline service is gone",
        lambda t: (t / GATEWAY_ROOT / "logs" / "logs-timeline.service.ts").unlink(),
        "cannot-check",
    )
    case(
        "a Sorting Office nullable field was renamed",
        lambda t: (t / _SO.hooks).write_text(
            CLEAN_SO_HOOKS.replace("timelineCount:", "logCount:"), encoding="utf-8"
        ),
        "cannot-check",
    )
    case(
        "a registered page with NO fixtures at all reports cannot-check",
        # The conflict this file's header warns about, as a case. Deleting the
        # page's whole tree is what a `PageSpec` merged in without fixtures
        # looks like to `_scaffold`. It must NOT read as a pass — and the
        # resolution is to add the fixtures, never to soften this branch.
        lambda t: (
            (t / _SO.hooks).unlink(),
            [(t / r).unlink() for r in _SO.renderers],
        )
        and None,
        "cannot-check",
    )
    case(
        "the receipts page holds no useQuery at all",
        lambda t: (
            (t / _RCP.hooks).write_text(
                CLEAN_RECEIPTS_HOOKS.replace("useQuery({", "notAQuery({"), encoding="utf-8"
            ),
            (t / _RCP.renderers[0]).write_text(
                CLEAN_RECEIPTS_RENDERER.replace("useQuery({", "notAQuery({"), encoding="utf-8"
            ),
        )
        and None,
        "cannot-check",
    )

    # ── /team ────────────────────────────────────────────────────────────────
    print("\n-- /team --\n")
    case(
        "W6 the redesign's week key lost its tenant",
        lambda t: (t / _TEAM.hooks).write_text(
            CLEAN_TEAM_HOOKS.replace("'team-next-week', rid, weekStart]", "'team-next-week', weekStart]"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W6 the redesign's coverage-rules key lost its tenant",
        lambda t: (t / _TEAM.hooks).write_text(
            CLEAN_TEAM_HOOKS.replace(
                "'team-next-coverage-rules', rid]", "'team-next-coverage-rules']"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W6 the LEGACY desk's week key lost its tenant (the half that was right)",
        lambda t: (t / _TEAM.renderers[1]).write_text(
            CLEAN_TEAM_DESK.replace(
                "'team', 'week', activeRestaurantId, weekStart]", "'team', 'week', weekStart]"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W6 the Ops drawer's rule key lost its tenant",
        lambda t: (t / _TEAM.renderers[3]).write_text(
            CLEAN_TEAM_OPS.replace(
                "'coverage-templates', activeRestaurantId]", "'coverage-templates']"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W6 the performance key lost its tenant",
        lambda t: (t / _TEAM.renderers[4]).write_text(
            CLEAN_TEAM_PERF.replace(
                "'team', 'performance', activeRestaurantId, member?.id]",
                "'team', 'performance', member?.id]",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W2 the benchmark's window mark was deleted but its SEMICOLON-FREE import stayed",
        lambda t: (t / _TEAM.renderers[4]).write_text(
            CLEAN_TEAM_PERF.replace("{LE}{TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES} of them", "{TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES}"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W1 the benchmark window drifted from the server's .limit(200)",
        lambda t: (t / GATEWAY_ROOT / "team" / "performance.service.ts").write_text(
            CLEAN_PERF_GATEWAY.replace("limit(200)", "limit(500)"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W4 CertExposureVM.shiftsThisWeek widened back to a plain number",
        lambda t: (t / _TEAM.hooks).write_text(
            CLEAN_TEAM_HOOKS.replace("shiftsThisWeek: number | null;", "shiftsThisWeek: number;"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W4 coverageRules widened away, so an empty rule file cannot be told from a silent one",
        lambda t: (t / _TEAM.hooks).write_text(
            CLEAN_TEAM_HOOKS.replace("coverageRules: CoverageRule[] | null;", "coverageRules: CoverageRule[];"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W3 the rule list falls back to [] when its query has not answered",
        lambda t: (t / _TEAM.hooks).write_text(
            CLEAN_TEAM_HOOKS.replace(
                "  return { week: weekQ.data ?? null, coverageRules: rulesQ.data === undefined ? null : rulesQ.data };",
                "  return {\n    coverageRules: known ? rulesQ.data : [],\n  };",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "the team register was deleted",
        lambda t: (t / _TEAM.hooks).write_text("export const nothing = 1;\n", encoding="utf-8"),
        "cannot-check",
    )
    case(
        "a team renderer is missing",
        lambda t: (t / _TEAM.renderers[2]).unlink(),
        "cannot-check",
    )
    case(
        "the cited performance service lost every .limit()",
        lambda t: (t / GATEWAY_ROOT / "team" / "performance.service.ts").write_text(
            "export class PerformanceService {}\n", encoding="utf-8"
        ),
        "cannot-check",
    )

    print()
    if failures:
        print(f"SELF-TEST FAILED — {len(failures)} case(s): {', '.join(failures)}")
        return 1
    print("SELF-TEST PASSED — the guard fires on every shape above.")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Windowed figures render as floors.")
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
            "\n   Exit 2 blocks exactly like a violation, on purpose. Six windowed\n"
            "   figures shipped as totals on one page; a guard that passes because\n"
            "   its anchor moved would have been a green tick over all six."
        )
        return 2

    if rep.violations():
        print("WINDOWED FIGURES — violations found:\n")
        for v in rep.violations():
            print(f"  {v}\n")
        print(f"{len(rep.violations())} violation(s). See ADR 0051 clauses 1 and 2.")
        return 1

    print("Windowed figures: clean.")
    print("  Checked: declared caps match the queries they cite; every declared")
    print("  window is consumed and its renderers carry floor markers; no measured")
    print("  zero is folded into an unknown; the unknown-capable fields keep their")
    print("  null; no capped fetch discards its own total/hasMore.")
    print("  NOT checked: dataflow from a .limit() to a JSX node — undecidable here.")
    for pg in PAGES:
        if not pg.tenant_keyed:
            print(
                f"  NOT checked: tenant-keyed query keys on {pg.name} "
                f"({pg.tenant_note}). Enforced on: "
                + ", ".join(x.name for x in PAGES if x.tenant_keyed)
            )
    # W7 reads only what a page DECLARES. A page that declares nothing gets a
    # vacuous W7, and a vacuous rule printed as part of a clean run is exactly
    # the absence-reported-as-health shape this guard was written against — so
    # it is named, every time, rather than folded into the tick above.
    bare = [pg.name for pg in PAGES if not pg.imported_query_hooks]
    if bare:
        print(
            "  NOT checked: W7 (shared query hooks outside the page tree) on "
            + ", ".join(bare)
            + " — those pages declare none, so W7 evaluated zero hooks there. "
            "If one starts importing a shared query hook, add it to that "
            "PageSpec: W6 structurally cannot see it."
        )
    print("  See this file's header for the full boundary.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
