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

SCOPE. Six pages: `apps/web/src/pages/receiving/next`,
`apps/web/src/pages/receipts/next`, `apps/web/src/pages/communications/next`,
`apps/web/src/pages/documents-reports/next`, `apps/web/src/pages/team`
(that one BOTH halves for as long as both exist — the `next/` redesign and the
`command/` legacy desk are one route behind one flag, and the tenant leak this
guard's W6 exists for was on the redesigned half while the legacy half had it
right; see "/team's LEGACY HALF RETIRES" below) and
`apps/web/src/pages/logs/next`, plus the gateway files their registers cite and
the shared query hooks they name. Each page declares its own register,
renderers and nullable contract in PAGES below; adding a seventh page means
adding a seventh entry, not a second script. A page absent from PAGES is NOT
checked, and this guard makes no claim about it.

/logs ARRIVED LAST AND BROUGHT A SHAPE NOTHING HERE HAD SEEN. It is the first
guarded page whose feed is walked rather than read once, so its cache is a
`useInfiniteQuery` and not a `useQuery`. `USE_QUERY` has always spelled the
`Infinite` half optional, but until this page no fixture exercised it — an
optional group nothing tests is an assertion, not a measurement, and this
file's collection of vacuities is entirely made of those. Two /logs cases below
stand on it directly (`W6 sees a useInfiniteQuery`, and the generic-annotated
form of the same), because if the matcher ever loses its grip on that syntax
the page's only cache bucket becomes invisible to W5, W6 and W7 at once.

A NOTE ON /team's MARKER, BECAUSE THE WRONG ONE WOULD BE A LIE. `floor_markers`
is a per-page tuple for a reason. /team has exactly one server-side window and
it does not bound a COUNT: `performance.service.ts:139` computes a median and
an inter-quartile band over the most recent 200 `server_sales` rows. The honest
mark on a statistic drawn from a capped sample is a ceiling on the sample
("over <=200 services"), never a floor on a total, so /team's marker is `LE`
and not `GE`. Forcing a floor there to satisfy a guard would have produced a
precise-looking falsehood, which is the class this file exists to stop.

/team's LEGACY HALF RETIRES, AND THE GUARD MUST NOT GO BLIND WHILE IT DOES
(founder item 89, 2026-09-28: "Guard PR first, then delete")
--------------------------------------------------------------------------
ADR 0149's cutover (PR #494) deletes `pages/team/command/` whole. Its four
query files used to be named as ordinary renderers, so that deletion made this
guard exit 2. That was correct: a missing anchor is a refusal, never a skip.
There were two easy fixes and both were wrong. Dropping the four before the
deletion lands leaves the legacy half live on `main` with nothing reading its
keys. Softening a missing renderer to a skip is the vacuity that "NEVER VACUOUS"
below forbids on every page.

So a page may name a `retiring` half under one `retiring_root`. That half is in
exactly one of two states:
  - PRESENT: some .ts/.tsx file is still under the root, a lone test
    included, since a test still imports the half it tests. Every retiring
    file is then an anchor, the same as a renderer: it is read, W2/W3/W6 check
    it, and a missing one exits 2. A half-deleted legacy desk is an anchor that
    moved.
  - RETIRED: no .ts/.tsx file is left under the root. Nothing there can
    render a figure or hold a cache bucket, and every run SAYS it read none.

/team ALSO REFUSES A QUERY FILE IT DOES NOT NAME. The parity build of
2026-09-04 split the redesign into files. Three of them call `useQuery` and were
never listed here: `FormerStaff.tsx`, `SendGrantsSection.tsx` and
`useHouseAreas.ts`. All the while, the comment beside the tuple said every /team
query was in the files it named (v3.0-TECH-DEBT.md, 2026-09-28). A sentence
nothing re-reads is how that happened, so it is a check now. `query_tree` names
the page's directory. Every non-test source file under it that calls a
react-query hook must be named by the PageSpec, or the run exits 2.

Two matcher gaps had to close along with it. Two of those three files key their
caches through an undotted factory call (`grantKeys(restaurantId)`,
`areasKey(rid)`), and QUERY_KEY_CALL could not see that form. Listing the files
without widening the matcher would have been a green tick over two files W6
still could not read. `every_query_read` closes the second gap: every query
call on the page must parse, and must yield a key W6 can judge. Without it, a
key held in a bare local would pass unread, as long as some other query on the
page had a readable key. A third gap closed for every page: W6 and W7 used to
find a tenant token as a SUBSTRING, so `rid` inside `week-grid` counted
(`names_tenant`).

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
import shutil
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
    # W6's "no local query at all" exemption below is opt-in per page, not
    # automatic from `imported_query_hooks` alone. /receipts also declares an
    # imported hook (useProviders, for vendor names on the credit ledger's
    # rows) while still having real page-local reads every day; the exemption
    # is for a page whose OWN shape moved every bucket external, like
    # /communications after the ADR 0083 amendment, not for "no local call
    # happened to be found this run" (which a mutation — or a genuine future
    # regression that silently deletes a page's own reads — can produce just
    # as well as a deliberate shape). True only where that IS the page's real,
    # everyday shape.
    all_queries_imported: bool = False
    # A half of the page that is being deleted (ADR 0149's cutover), all of it
    # under `retiring_root`. PRESENT while any source file is left under the
    # root: then every file here is an anchor, read and checked like a
    # renderer. RETIRED once none is left: then none is read, and the clean run
    # says so. There is no third state, so a half-deleted desk exits 2. See the
    # header, "/team's LEGACY HALF RETIRES".
    retiring: tuple[Path, ...] = ()
    retiring_root: Path | None = None
    # When set, every non-test .ts/.tsx under this directory (recursively) that
    # calls a react-query hook must be `hooks`, a renderer, a retiring file or a
    # declared imported hook's file. Otherwise the run exits 2, because W6
    # cannot see a file this spec does not name. This is the check that stops
    # the tuple falling behind the page's files again.
    query_tree: Path | None = None
    # When True, every query-hook CALL in the page's files must parse to a
    # body, and every body must yield a key expression W6 can judge. False is
    # never silent: the clean run names every page that does not enforce it.
    every_query_read: bool = False


_RECEIVING = Path("apps/web/src/pages/receiving/next")
_RECEIPTS = Path("apps/web/src/pages/receipts/next")
_COMMS = Path("apps/web/src/pages/communications/next")
_SORTING_OFFICE = Path("apps/web/src/pages/documents-reports/next")
_TEAM_TREE = Path("apps/web/src/pages/team")
_TEAM_NEXT = _TEAM_TREE / "next"
_TEAM_CMD = _TEAM_TREE / "command"
_LOGS = Path("apps/web/src/pages/logs/next")
_QUERY_HOOKS = Path("apps/web/src/hooks/queries/useConversationQueries.ts")
_DRAFT_HOOKS = Path("apps/web/src/hooks/queries/useDraftEmailQueries.ts")
_CMS_SENDERS = _COMMS / "useSendersDeskData.ts"

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
        # The credit ledger lane (ADR 0149 row 22, 2026-09-25) renders the
        # list, the recovery figures and the memo picker behind three windows
        # of its own; its reads live in the same hooks file so W6 sees them.
        renderers=(_RECEIPTS / "ReceiptsNext.tsx", _RECEIPTS / "ReceiptsCredits.tsx"),
        register="RECEIPTS_SERVER_WINDOWS",
        floor_markers=("GE",),
        nullable_contract={
            # `deliveriesWithoutPaper` answered `[]` on a FAILED fetch, which
            # renders identically to a caught-up door. It must be able to say
            # it does not know.
            "ReceiptsNextData": ["deliveriesWithoutPaper", "verifiedCount"],
            # The ledger's list, figures and memos must each be able to say
            # they have not answered; `[]` would read as "no claims".
            "ReceiptsCreditsData": ["claims", "stats", "memos"],
        },
        tenant_tokens=("rid", "restaurantId"),
        tenant_keyed=True,
        imported_query_hooks=(
            # Vendor names on the credit ledger's rows.
            (Path("apps/web/src/hooks/queries/useProviderQueries.ts"), "useProviders"),
        ),
    ),
    PageSpec(
        name="/communications",
        hooks=_COMMS / "useCommsNextData.ts",
        renderers=(_COMMS / "CommunicationsNext.tsx",),
        register="COMMS_SERVER_WINDOWS",
        floor_markers=("GE",),
        nullable_contract={
            # Every glance figure must be able to say it does not know. The page
            # had FIVE sources and only one of them used to have a failure
            # surface, so four figures rendered a failure as the em dash the ADR
            # reserves for "has not answered". Since the ADR 0083 amendment of
            # 2026-09-25 it owns three; the schedules figure left with its card.
            "CommsGlance": ["threads", "draftsPending", "sentLast30"],
        },
        tenant_tokens=("rid", "restaurantId"),
        tenant_keyed=True,
        imported_query_hooks=(
            # The conversation book — the page's largest bucket, and the one W6
            # structurally cannot see because it lives in a shared file.
            (_QUERY_HOOKS, "useProcurementConversationHistory"),
            (_QUERY_HOOKS, "useConversationThreads"),
            (_DRAFT_HOOKS, "useActiveConversations"),
            # ADR 0160 open item 3 (2026-09-25) / PR #470 audit: useSendersDeskData.ts
            # is the page's OWN file (not a shared hook outside the tree), but its
            # queries are declared inside `useSenderRegister`/`useStrangers`, one
            # level below where W6 reads (useCommsNextData.ts + CommunicationsNext.tsx
            # only) — so before this line, neither `comms-senders` nor
            # `comms-strangers` was judged by anything. W7's per-function reader
            # does not care whether a file sits inside or outside the page tree; it
            # only needs `export function <name>`, which both have.
            (_CMS_SENDERS, "useSenderRegister"),
            (_CMS_SENDERS, "useStrangers"),
        ),
        # This page's real, everyday shape since the ADR 0083 amendment: every
        # cache bucket lives in one of the shared hooks above, never a local
        # `useQuery`. See the field's own docstring for why this is not the
        # default for a page that merely imports one shared hook.
        all_queries_imported=True,
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
        # The rebuilt half: every file that calls a query hook or renders one
        # of the two windowed figures (`PerformanceCard.tsx`, `TeamRecord.tsx`),
        # plus the four renderers listed since the 2026-09-04 parity build.
        # `FormerStaff.tsx`, `SendGrantsSection.tsx` and `useHouseAreas.ts` were
        # added 2026-09-28 (founder item 89). They had called `useQuery` since
        # they landed, with W6 never reading their keys. `query_tree` below is
        # what keeps this list from falling behind again: it refuses any
        # query-calling file under `pages/team` that is not named here.
        renderers=(
            _TEAM_NEXT / "TeamNext.tsx",
            _TEAM_NEXT / "WeekGrid.tsx",
            _TEAM_NEXT / "RosterSheet.tsx",
            _TEAM_NEXT / "ShiftSheet.tsx",
            _TEAM_NEXT / "TeamOverlays.tsx",
            _TEAM_NEXT / "TeamRecord.tsx",
            _TEAM_NEXT / "PerformanceCard.tsx",
            _TEAM_NEXT / "MyShiftsNext.tsx",
            _TEAM_NEXT / "FormerStaff.tsx",
            _TEAM_NEXT / "SendGrantsSection.tsx",
            _TEAM_NEXT / "useHouseAreas.ts",
        ),
        # The legacy half. ADR 0149's cutover (PR #494) deletes
        # `pages/team/command/` whole, per founder items 88 and 89. Until then
        # the legacy half ships on `main` behind the same flag, so these four
        # stay anchors and are checked like any renderer. Once no source file
        # is left under `command/`, none is read, and the clean run says so.
        retiring=(
            _TEAM_CMD / "ManagerShiftDesk.tsx",
            _TEAM_CMD / "MyShifts.tsx",
            _TEAM_CMD / "OpsRulesPanel.tsx",
            _TEAM_CMD / "PerformancePanel.tsx",
        ),
        retiring_root=_TEAM_CMD,
        # Both halves, recursively, so a legacy desk that was MOVED rather than
        # deleted shows up as an unlisted query file instead of retiring quietly.
        query_tree=_TEAM_TREE,
        every_query_read=True,
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
        # query it reads is a query-hook call in one of the files named above,
        # so W6 sees all of them. The sentence this used to be ("one of the
        # TWELVE files above") was false for weeks, with three query files
        # unlisted, because nothing re-read it. It is not a count to keep
        # honest by hand any more: `query_tree` refuses the run when it stops
        # being true. The empty tuple is printed on every clean run so it
        # cannot be read as "checked and fine".
        imported_query_hooks=(),
    ),
    PageSpec(
        name="/logs",
        hooks=_LOGS / "useLogsNextData.ts",
        # Both files. `EventSheet.tsx` declares no window and reads no query, so
        # W2's marker rule never applies to it — but W3 does, and an entry sheet
        # is exactly where `count > 0 ? n : EM` gets written. Listing it costs
        # nothing; leaving it out would make the run's "clean" cover one of the
        # page's two rendering files while reading as though it covered both.
        renderers=(_LOGS / "LogsNext.tsx", _LOGS / "EventSheet.tsx"),
        register="LOGS_SERVER_WINDOWS",
        floor_markers=("GE",),
        nullable_contract={
            # Each of these is a field whose whole job is to say the gateway did
            # not answer, and each has a specific lie attached to losing its
            # null. `hasMore: boolean` would make a gateway that predates the
            # field read as "nothing older exists", and the page would then
            # print "All N entries are on the page" about a window — ADR 0086's
            # own fault, one layer up. The three register fields would turn "did
            # not say" into "said none". `window` would print an unreported
            # clamp as "0 at a time".
            "LogsNextData": [
                "failure",
                "events",
                "counts",
                "sourcesQueried",
                "failedSources",
                "hasMore",
                "window",
            ],
            # A transport failure carries no HTTP status (a timeout, a DNS
            # failure, a CORS refusal). `status: number` could only say 0, and
            # the page prints the status beside the message.
            "FailureVM": ["status"],
        },
        tenant_tokens=("rid", "restaurantId"),
        tenant_keyed=True,
        # W7 reads the shared hooks a page DECLARES, and /logs declares none —
        # a measurement, not an omission. Its one cache bucket is the
        # `useInfiniteQuery` in `useLogsNextData.ts`, which W6 sees. The page's
        # other two hooks are not query hooks at all: `useAuth` is a context
        # read, and `useMudavymDesign` keeps its own promise map rather than a
        # react-query key (`useMudavymDesign.ts`, `flagCache`), so there is no
        # key there for W7 to judge. If either moves behind react-query, name it
        # here — W6 structurally cannot see it.
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
    # NOT violations. These are things a run deliberately did not read, such
    # as a retired half. They are printed with every verdict, so "not read"
    # can never pass for "read and fine".
    notes: list[str] = field(default_factory=list)

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
#
# An UNDOTTED CALL counts too (`queryKey: grantKeys(restaurantId)`,
# `queryKey: areasKey(rid)`), because a call is not a bare local: it has an
# argument list for the tenant to be in, or not. Until 2026-09-28 this form was
# invisible. Two of the three /team files added that day key every cache
# through it, so listing them without this would have been a green tick over
# two files W6 never read. The arguments are what gets judged. The factory's
# own body is not, which is the same boundary as a dotted factory: a factory
# that ignores its argument passes.
QUERY_KEY_CALL = re.compile(
    r"queryKey:\s*("
    r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\([^()]*\)"
    r"|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+"
    r")"
)

# A query-hook CALL SITE: every form ANY_QUERY_HOOK_CALL detects, followed by
# its argument list (generics allowed). An import names the hook without a
# paren, so it is not counted. `every_query_read` compares this count to the
# bodies USE_QUERY parsed, file by file. A `useQueries` or `useSuspenseQuery`
# call, or options that are not a brace literal, parse to nothing, and a file
# with one of those next to an ordinary `useQuery` would still "have a body".
QUERY_HOOK_CALL_SITE = re.compile(
    r"\buse(?:Suspense)?(?:Infinite)?Quer(?:y|ies)\s*"
    r"(?:<[^()<>]*(?:<[^()<>]*>[^()<>]*)*>)?\s*\("
)

# Test files never render a page. `query_tree` skips them, and only them.
TEST_SOURCE = re.compile(r"\.(?:test|spec|stories)\.tsx?$")


def names_tenant(flat_key: str, tokens: tuple[str, ...]) -> bool:
    """
    True when a tenant token appears in the key as a whole IDENTIFIER.

    Until 2026-09-28 this was `tok in flat`, a substring test. `rid` is a
    substring of `grid`, `bridge` and `ride`, so `['team-next-week-grid',
    weekStart]` named the tenant as far as W6 could tell. /team has a file
    called WeekGrid. That is this file's `"GE" in src` vacuity a second time,
    and it is tested below. Measured 2026-09-28: none of the 51 keys the
    amended guard reads on `main` changes verdict under the stricter test.
    """
    return any(
        re.search(rf"(?<![\w$]){re.escape(tok)}(?![\w$])", flat_key) for tok in tokens
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

# Detection only — every react-query hook FORM, not just `useQuery`/
# `useInfiniteQuery`. Added 2026-09-25 (PR #470 audit): W6's "is there a
# page-local query at all" test used the same two-form regex as USE_QUERY
# above, so a page whose local read was a `useQueries` or `useSuspenseQuery`
# call — neither parsed by USE_QUERY nor matched by the old detector — read as
# "no local query call" and, for any page with a declared shared hook, took
# the pass-vacuously branch below instead of raising CannotCheck. That is the
# same vacuity class line 594's comment already warns about, just for a form
# this guard didn't know existed. `useCellarNextData.ts` and
# `useReportsNextData.ts` both call `useQueries` today, though neither is a
# guarded PAGES entry yet (see `--self-test`, "W6 does not silently pass a
# useQueries call it cannot parse").
ANY_QUERY_HOOK_CALL = re.compile(r"\buse(?:Suspense)?(?:Infinite)?Quer(?:y|ies)\b")


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


def _source_files(base: Path) -> list[Path]:
    """Every non-test .ts/.tsx file under `base`, recursively."""
    return sorted(
        p
        for p in base.rglob("*")
        if p.is_file()
        and p.suffix in (".ts", ".tsx")
        and not TEST_SOURCE.search(p.name)
        and "__tests__" not in p.relative_to(base).parts
    )


def retiring_present(root: Path, page: PageSpec) -> bool:
    """
    PRESENT (True) or RETIRED (False). Never a third answer.

    Present means some source file is still under `retiring_root`, test files
    included. A lone test left behind still imports the half it tests, so that
    half has not gone. Once present, every retiring file is read through
    `read()`, which raises CannotCheck on a missing one.
    """
    if not page.retiring:
        return False
    if page.retiring_root is None or any(
        page.retiring_root not in r.parents for r in page.retiring
    ):
        raise CannotCheck(
            f"{page.name}: every `retiring` file must sit under `retiring_root`. "
            "Otherwise deleting the root could retire a file that still exists."
        )
    base = root / page.retiring_root
    if not base.is_dir():
        return False
    return any(p.is_file() and p.suffix in (".ts", ".tsx") for p in base.rglob("*"))


def unlisted_query_files(root: Path, page: PageSpec) -> list[Path]:
    """Files under `query_tree` that call a query hook and that this spec does not name."""
    assert page.query_tree is not None
    base = root / page.query_tree
    if not base.is_dir():
        raise CannotCheck(
            f"{page.name}: `query_tree` {page.query_tree} does not exist. The check "
            "that every query file is named has nothing to walk."
        )
    named = {
        page.hooks,
        *page.renderers,
        *page.retiring,
        # W7 reads a declared hook's function in this file, so the spec does name it.
        *(rel for rel, _fn in page.imported_query_hooks),
    }
    return [
        p.relative_to(root)
        for p in _source_files(base)
        if p.relative_to(root) not in named
        and ANY_QUERY_HOOK_CALL.search(p.read_text(encoding="utf-8"))
    ]


def run_page(root: Path, page: PageSpec, rep: Report) -> None:
    hooks_src = read(root, page.hooks)
    renderer_src = {r: read(root, r) for r in page.renderers}

    # The retiring half is read exactly like a renderer while it is present.
    # Once it is retired, the run SAYS it read none of it.
    if page.retiring:
        if retiring_present(root, page):
            renderer_src.update({r: read(root, r) for r in page.retiring})
        else:
            rep.notes.append(
                f"{page.name}: the retiring half ({page.retiring_root}) is RETIRED. No "
                f"source file is left under it, so its {len(page.retiring)} files were not "
                "read. There is nothing left there to check."
            )

    # A query file this spec does not name is a cache W6 cannot see. It is
    # refused here, before any rule runs, like every other missing anchor.
    if page.query_tree is not None:
        unlisted = unlisted_query_files(root, page)
        if unlisted:
            raise CannotCheck(
                f"{page.name}: {len(unlisted)} file(s) under {page.query_tree} call a "
                "query hook but are not named by its PageSpec, so W6 never reads their "
                "keys: " + ", ".join(str(u) for u in unlisted) + ". Name each one as a "
                "renderer. Do not narrow `query_tree`."
            )

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
    # A hook that mentions a query but parses to zero bodies means the matcher
    # lost its grip on the syntax — the exact way this rule once went vacuous.
    #
    # BOTH SPELLINGS, and that is not cosmetic. This read `"useQuery" in
    # hooks_src` until /logs arrived, and `"useQuery"` is not a substring of
    # `"useInfiniteQuery"` — so on the one page whose cache is a walked feed
    # this check was STRUCTURALLY DEAD: it could never fire, on the file it
    # exists to protect. The generic no-keys-found branch below would still
    # have caught it, which is why this was never a hole; but a check that
    # cannot fire on a page it is printed as covering is the shape this whole
    # file is written against, so it is matched as an identifier now and tested
    # on the Infinite form below.
    if ANY_QUERY_HOOK_CALL.search(hooks_src) and not hook_bodies:
        raise CannotCheck(
            f"{page.hooks} contains a query call but none could be parsed. W6 and W5 "
            "would both pass on a file they never read."
        )
    bodies = hook_bodies + [b for src in renderer_src.values() for b in query_bodies(src)]
    keys = [k for b in bodies for k in query_keys(b)]

    # Opt-in per page, and named on every clean run where it is off. Every
    # query-hook call must parse, and every parsed body must carry a key this
    # file can read. The page-wide "no keys at all" refusal below cannot see
    # ONE unreadable query among readable ones, because the others' keys
    # satisfy it. On /team that one would be a bucket W6 prints as checked.
    if page.every_query_read:
        for rel, src in [(page.hooks, hooks_src), *renderer_src.items()]:
            sites = len(QUERY_HOOK_CALL_SITE.findall(src))
            parsed = query_bodies(src)
            if sites != len(parsed):
                raise CannotCheck(
                    f"{page.name}: {rel} makes {sites} query-hook call(s), but only "
                    f"{len(parsed)} parsed to an options literal. A `useQueries`, a "
                    "`useSuspenseQuery`, or options built elsewhere would be a cache W6 "
                    "never reads."
                )
            for b in parsed:
                if not query_keys(b):
                    first = " ".join(b.split())[:80]
                    raise CannotCheck(
                        f"{page.name}: a query in {rel} has no key W6 can read "
                        f"(`{first}` …). W6 reads key literals and factory calls, and "
                        "this is neither (a bare local, or a computed key). Inline the "
                        "key or call a factory with the tenant as an argument."
                    )
    # A page whose EVERY cache bucket lives in a declared shared hook has no
    # page-local key to judge, and that is a shape, not a blind spot: W7 below
    # reads those hooks' keys and raises CannotCheck itself when one holds none.
    # /communications took this shape on 2026-09-25 (ADR 0083 amendment), when
    # its two page-local reads — the report schedules and the Gmail watch —
    # left the page, and its PageSpec says so with `all_queries_imported=True`.
    # The exemption needs THREE things: no query call anywhere in the page's
    # files (so an unparseable one still refuses below), the page's own word
    # that this is its everyday shape (so declaring an imported hook for one
    # incidental lookup — /receipts' useProviders, for vendor names on the
    # credit ledger's rows, while the page still has real local reads every
    # day — does not also excuse it), and at least one declared shared hook
    # (so a page with no reads at all still refuses).
    local_query_call = any(
        ANY_QUERY_HOOK_CALL.search(src)
        for src in [hooks_src, *renderer_src.values()]
    )
    if not keys and not local_query_call and page.all_queries_imported:
        pass
    elif not keys:
        raise CannotCheck(
            f"no `queryKey: [...]` found in any parsed useQuery in {page.name}'s hook "
            "or renderers. W6 would pass vacuously, which is how /receipts kept three "
            "bare keys through a tenant-keying sweep."
        )
    for k in keys:
        flat = k.replace("\n", " ").strip()
        if not names_tenant(flat, page.tenant_tokens):
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
            if not names_tenant(flat, page.tenant_tokens):
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

export interface ReceiptsCreditsData {
  claims: ProcurementCredit[] | null;
  stats: CreditStats | null;
  memos: ProcurementDocument[] | null;
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

# The shared vendor-name hook the credit ledger lane imports (W7).
_PROVIDER_HOOKS = Path("apps/web/src/hooks/queries/useProviderQueries.ts")
CLEAN_PROVIDER_HOOKS = """
export function useProviders(restaurantId: string, filters?: ProviderFilters) {
  return useQuery({
    queryKey: queryKeys.providers.list(restaurantId, filters),
    queryFn: () => fetchProviders(restaurantId, filters),
  });
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
}

export function useCommsNextData() {
  const historyQ = useProcurementConversationHistory();
  const threadsQ = useConversationThreads();
  const activeQ = useActiveConversations();
  const truncated = (historyQ.data?.length ?? 0) >= COMMS_SERVER_WINDOWS.HISTORY_ROWS;
  return { truncated, historyQ, threadsQ, activeQ };
}
"""

# A page-local read added back to the comms hook. Since 2026-09-25 the page has
# none (every bucket is a declared shared hook, W7), so W6's only job there is
# to judge one the day it returns.
COMMS_LOCAL_QUERY = """  const schedulesQ = useQuery<ScheduledReport[]>({
    queryKey: ['report-schedules'],
    queryFn: listReportSchedules,
  });
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

# PR #470's own page-local hooks (ADR 0160 open item 3): `comms-senders` and
# `comms-strangers`, both tenant-keyed. Added 2026-09-25 after the pr-audit-gate
# found this file listed as neither a hook nor a renderer for /communications,
# so W6 never judged either key. See "W6 the senders key/strangers key lost
# its tenant" below for the mutation that proves this fixture is now read.
CLEAN_COMMS_SENDERS_HOOKS = """
import { useQuery } from '@tanstack/react-query';
export function useSenderRegister(restaurantId) {
  return useQuery({
    queryKey: ['comms-senders', restaurantId],
    queryFn: () => apiClient.get('/senders/reputation'),
  });
}
export function useStrangers(restaurantId, allHouses) {
  return useQuery({
    queryKey: ['comms-strangers', restaurantId, allHouses ? 'all' : 'this'],
    queryFn: () => apiClient.get('/prospects'),
  });
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
  /** settings-audit.service.ts:252 — `Math.min(200, limit)`, then `.limit(capped)`. */
  TRAIL_ROWS: 100,
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
  const trailQ = useQuery({
    queryKey: ['team-next-trail', rid],
    queryFn: () => apiClient.get(`/settings-audit?limit=${TEAM_SERVER_WINDOWS.TRAIL_ROWS}`),
  });
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

# ── the rebuilt half's own query files ───────────────────────────────────────
# Until 2026-09-28 the scaffold gave the rebuilt `MyShiftsNext.tsx` and
# `PerformanceCard.tsx` the LEGACY bodies below (semicolon-free,
# `activeRestaurantId`), and gave every other rebuilt file CLEAN_TEAM_NEXT, which
# makes no query at all. So no self-test case exercised a single rebuilt query
# file in its own shape. The cutover deletes the legacy half, and then these are
# the only /team query fixtures left. They mirror the real files' key shapes:
# literal keys on `rid`, and the two undotted factories (`grantKeys`,
# `areasKey`/`awayKey`) that QUERY_KEY_CALL could not see before that day.

CLEAN_TEAM_RECORD = """
import { EM, LE } from './tm-format';
import { TEAM_SERVER_WINDOWS } from './useTeamNextData';
export function TeamRecord({ data }) {
  return <p>The last {LE}{TEAM_SERVER_WINDOWS.TRAIL_ROWS} changes{data.trail === null ? EM : ''}</p>;
}
"""

CLEAN_TEAM_PERF_CARD = """
import { useQuery } from '@tanstack/react-query';
import { useActiveRestaurantId, TEAM_SERVER_WINDOWS } from './useTeamNextData';
import { EM, LE } from './tm-format';
export function PerformanceCard({ memberId }) {
  const rid = useActiveRestaurantId();
  const q = useQuery({
    queryKey: ['team-next-performance', rid, memberId],
    queryFn: () => getMemberPerformance(memberId),
    enabled: !!rid && !!memberId,
  });
  return <p>{q.data ? `over ${LE}${TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES} of them` : EM}</p>;
}
"""

CLEAN_TEAM_MYSHIFTS_NEXT = """
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveRestaurantId } from './useTeamNextData';
export function MyShiftsNext({ weekStart }) {
  const rid = useActiveRestaurantId();
  const q = useQuery({ queryKey: ['team-next-my-week', rid, weekStart], queryFn: f, enabled: !!rid });
  const notesQ = useQuery({ queryKey: ['team-next-notes', rid, weekStart], queryFn: f, enabled: !!rid });
  return <div>{q.isError ? 'not known' : 'Off'}{notesQ.data ? '' : ''}</div>;
}
"""

CLEAN_TEAM_OVERLAYS = """
import { useMutation, useQuery } from '@tanstack/react-query';
import { useActiveRestaurantId } from './useTeamNextData';
export function TextSenders() {
  const rid = useActiveRestaurantId();
  const q = useQuery({ queryKey: ['team-next-text-senders', rid], queryFn: f, enabled: !!rid });
  return <div>{q.isError ? 'unknown' : 'ok'}</div>;
}
"""

CLEAN_TEAM_FORMER = """
import { useQuery } from '@tanstack/react-query';
import { useActiveRestaurantId } from './useTeamNextData';
export function FormerStaffSheet() {
  const rid = useActiveRestaurantId();
  const q = useQuery({
    queryKey: ['team-next-former-staff', rid],
    queryFn: () => getFormerStaff(rid ?? undefined),
    enabled: Boolean(rid),
    retry: false,
  });
  return <div>{q.isError ? 'unknown here, not nobody' : q.data?.people.length === 0 ? 'Nobody' : 'people'}</div>;
}
"""

# An undotted factory, and an eviction through the same factory. The eviction is
# a `queryClient` prefix, not a bucket, and must stay out of W6's sight.
CLEAN_TEAM_GRANTS = """
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
const grantKeys = (rid: string | null) => ['authority-grants', rid ?? ''] as const;
export function SendGrantsSection({ restaurantId }) {
  const qc = useQueryClient();
  const grants = useQuery({
    queryKey: grantKeys(restaurantId),
    queryFn: () => apiClient.get('/authority/grants').then((r) => r.data),
    enabled: !!restaurantId,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: grantKeys(restaurantId) });
  return <div>{grants.isError ? 'unknown' : 'ok'}</div>;
}
"""

CLEAN_TEAM_AREAS = """
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useActiveRestaurantId } from './useTeamNextData';
export const areasKey = (rid: string | null) => ['house-areas', rid] as const;
export const awayKey = (rid: string | null) => ['house-away', rid] as const;
export function useHouseAreas() {
  const rid = useActiveRestaurantId();
  const areasQ = useQuery({ queryKey: areasKey(rid), queryFn: getAreas, enabled: !!rid });
  const awayQ = useQuery({ queryKey: awayKey(rid), queryFn: getAway, enabled: !!rid });
  return { areas: areasQ.data ?? null, away: awayQ.data ?? null };
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

# The trail's cap is a clamp, not a literal, the same shape as /receipts' 100.
CLEAN_SETTINGS_AUDIT_GATEWAY = """
export class SettingsAuditService {
  async list(limit = 50) {
    const capped = Math.min(200, limit);
    return this.sb.from("system_audit_log").select("*").limit(capped);
  }
}
"""

# /logs. The ONLY fixture in this file whose cache is a `useInfiniteQuery`, and
# the reason that matters is written in the header: the `Infinite` half of
# USE_QUERY had no test behind it until this page arrived. Every rule below
# reaches this hook through that one matcher.
CLEAN_LOGS_HOOKS = """
export const LOGS_SERVER_WINDOWS = {
  /** logs-timeline.service.ts:106 — `Math.min(200, …)` clamps the feed; this page asks for 100 a page. */
  TIMELINE: 100,
} as const;

export interface FailureVM {
  status: number | null;
  message: string;
  forbidden: boolean;
}

export interface LogsNextData {
  state: ReadState;
  failure: FailureVM | null;
  events: TimelineEvent[] | null;
  counts: Partial<Record<string, number>> | null;
  sourcesQueried: TimelineSource[] | null;
  failedSources: TimelineSource[] | null;
  hasMore: boolean | null;
  window: number | null;
  stalled: boolean;
  readMore: () => void;
}

export function useLogsNextData(correlationId: string | null): LogsNextData {
  const rid = useAuth().activeRestaurantId ?? '';
  const q = useInfiniteQuery({
    queryKey: ['logs-next', 'timeline', rid, correlationId ?? ''],
    queryFn: async ({ pageParam }) => {
      const { data } = await apiClient.get(`/logs/timeline/${rid}`, {
        params: { limit: LOGS_SERVER_WINDOWS.TIMELINE, before: pageParam ?? undefined },
      });
      return data;
    },
    getNextPageParam: (last, _all, lastParam) =>
      last.hasMore === true && last.nextCursor !== lastParam ? last.nextCursor : undefined,
  });
  const atFloor = (q.data?.pages.length ?? 0) >= LOGS_SERVER_WINDOWS.TIMELINE;
  return { atFloor };
}
"""

CLEAN_LOGS_RENDERER = """
import { EM, GE } from './lg-format';
import { LOGS_SERVER_WINDOWS } from './useLogsNextData';
export default function LogsNext() {
  const floor = loaded >= LOGS_SERVER_WINDOWS.TIMELINE;
  return <span>{count === null ? EM : floor ? `${GE} ${count}` : count}</span>;
}
"""

# The entry sheet: no window, no query, no marker. It is listed as a renderer so
# W3 reads it, and its presence is what makes the "the entry sheet is missing"
# case below a cannot-check rather than a silently narrower run.
CLEAN_LOGS_SHEET = """
import { Sheet } from '@/components/mudavym';
import { EM, NOT_RECORDED } from './lg-format';
export function EventSheet({ event }) {
  return (
    <Sheet open={!!event} closeLabel="Close">
      {event ? event.summary : EM}
      {NOT_RECORDED}
    </Sheet>
  );
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
_LOGS_PAGE = _BY_NAME["/logs"]


def _team_file(name: str) -> Path:
    """
    A /team file BY NAME, from either half, never by tuple position.

    Until 2026-09-28 four /team cases wrote into `_TEAM.renderers[1]`, `[3]`
    and `[4]`. The parity build had long since re-pointed those slots at
    WeekGrid, ShiftSheet and TeamOverlays. So "the LEGACY desk's week key" was
    a legacy body written over a rebuilt file's name. The cases still passed,
    because a whole-file overwrite is caught wherever it lands. It was their
    names that lied. Exactly one match or this raises.
    """
    hits = [r for r in (_TEAM.hooks, *_TEAM.renderers, *_TEAM.retiring) if r.name == name]
    if len(hits) != 1:
        raise AssertionError(f"/team names {len(hits)} files called {name!r}, not one")
    return hits[0]


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
    # useSendersDeskData.ts (ADR 0160 open item 3): not a PageSpec renderer —
    # it is read only through the two `imported_query_hooks` entries above,
    # exactly like _QUERY_HOOKS/_DRAFT_HOOKS below, so it needs its own file
    # here rather than a slot in the renderers loop.
    (tmp / _CMS_SENDERS).parent.mkdir(parents=True, exist_ok=True)
    (tmp / _CMS_SENDERS).write_text(CLEAN_COMMS_SENDERS_HOOKS, encoding="utf-8")
    (tmp / _SO.hooks).write_text(CLEAN_SO_HOOKS, encoding="utf-8")
    for r in _SO.renderers:
        (tmp / r).write_text(CLEAN_SO_RENDERER, encoding="utf-8")
    (tmp / _QUERY_HOOKS).write_text(CLEAN_QUERY_HOOKS, encoding="utf-8")
    (tmp / _DRAFT_HOOKS).write_text(CLEAN_DRAFT_HOOKS, encoding="utf-8")
    (tmp / _PROVIDER_HOOKS).write_text(CLEAN_PROVIDER_HOOKS, encoding="utf-8")
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
    # Every renderer the /team tuple names gets a clean body: `zip` against a
    # five-body tuple silently stopped at the fifth file once the parity build
    # (0bc70f76) grew the tuple to twelve, and the self-test then reported
    # `cannot-check: anchor file is missing` for a file that exists on disk.
    # A rebuilt file with no entry here gets CLEAN_TEAM_NEXT, which makes no
    # query. Every rebuilt file that makes one has its own body.
    _team_bodies = {
        "TeamNext.tsx": CLEAN_TEAM_NEXT,
        "TeamRecord.tsx": CLEAN_TEAM_RECORD,
        "PerformanceCard.tsx": CLEAN_TEAM_PERF_CARD,
        "MyShiftsNext.tsx": CLEAN_TEAM_MYSHIFTS_NEXT,
        "TeamOverlays.tsx": CLEAN_TEAM_OVERLAYS,
        "FormerStaff.tsx": CLEAN_TEAM_FORMER,
        "SendGrantsSection.tsx": CLEAN_TEAM_GRANTS,
        "useHouseAreas.ts": CLEAN_TEAM_AREAS,
    }
    for rel in _TEAM.renderers:
        (tmp / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp / rel).write_text(_team_bodies.get(rel.name, CLEAN_TEAM_NEXT), encoding="utf-8")
    # The legacy half, as `main` has it until the cutover. By name, with no
    # default: a retiring file this map does not know is a KeyError here,
    # never a silent CLEAN_TEAM_NEXT that would drop its query from the test.
    _legacy_bodies = {
        "ManagerShiftDesk.tsx": CLEAN_TEAM_DESK,
        "MyShifts.tsx": CLEAN_TEAM_MYSHIFTS,
        "OpsRulesPanel.tsx": CLEAN_TEAM_OPS,
        "PerformancePanel.tsx": CLEAN_TEAM_PERF,
    }
    for rel in _TEAM.retiring:
        (tmp / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp / rel).write_text(_legacy_bodies[rel.name], encoding="utf-8")
    (tmp / GATEWAY_ROOT / "team" / "performance.service.ts").write_text(
        CLEAN_PERF_GATEWAY, encoding="utf-8"
    )
    (tmp / GATEWAY_ROOT / "settings-audit").mkdir(parents=True, exist_ok=True)
    (tmp / GATEWAY_ROOT / "settings-audit" / "settings-audit.service.ts").write_text(
        CLEAN_SETTINGS_AUDIT_GATEWAY, encoding="utf-8"
    )

    # /logs. Its cited gateway file is `logs-timeline.service.ts`, already
    # written above for the Sorting Office — SHARED on purpose, because it is
    # shared in the real tree too. That sharing is exactly why the two /logs W1
    # cases below assert on the message text: a mutation to that one file trips
    # both pages, so a verdict-only case would stay green with this page's
    # register entry deleted.
    (tmp / _LOGS_PAGE.hooks.parent).mkdir(parents=True, exist_ok=True)
    (tmp / _LOGS_PAGE.hooks).write_text(CLEAN_LOGS_HOOKS, encoding="utf-8")
    _logs_bodies = {
        "LogsNext.tsx": CLEAN_LOGS_RENDERER,
        "EventSheet.tsx": CLEAN_LOGS_SHEET,
    }
    for rel in _LOGS_PAGE.renderers:
        (tmp / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp / rel).write_text(_logs_bodies.get(rel.name, CLEAN_LOGS_RENDERER), encoding="utf-8")


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
                # Notes follow the violations, so a case can assert that a
                # CLEAN run still said what it did not read.
                got, detail = verdict(rep), "; ".join(rep.violations() + rep.notes)
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
        "W4 the credit ledger's claims widened away from | null",
        lambda t: (t / _RCP.hooks).write_text(
            CLEAN_RECEIPTS_HOOKS.replace(
                "claims: ProcurementCredit[] | null;",
                "claims: ProcurementCredit[];",
            ),
            encoding="utf-8",
        ),
        "violation",
        "ReceiptsCreditsData.claims",
    )
    case(
        "W7 the vendor-name hook the credit ledger imports lost its tenant",
        lambda t: (t / _PROVIDER_HOOKS).write_text(
            CLEAN_PROVIDER_HOOKS.replace(
                "queryKeys.providers.list(restaurantId, filters)",
                "queryKeys.providers.all",
            ),
            encoding="utf-8",
        ),
        "violation",
        "useProviders",
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
        "W6 a page-local comms read returns without its tenant",
        lambda t: (t / _CMS.hooks).write_text(
            CLEAN_COMMS_HOOKS.replace(
                "  const truncated =", COMMS_LOCAL_QUERY + "  const truncated ="
            ),
            encoding="utf-8",
        ),
        "violation",
        "report-schedules",
    )
    case(
        "W6 a page-local comms read with its tenant is judged clean",
        lambda t: (t / _CMS.hooks).write_text(
            CLEAN_COMMS_HOOKS.replace(
                "  const truncated =",
                COMMS_LOCAL_QUERY.replace("['report-schedules']", "['report-schedules', restaurantId]")
                + "  const truncated =",
            ),
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "W6 an unparseable page-local comms read still refuses",
        lambda t: (t / _CMS.hooks).write_text(
            CLEAN_COMMS_HOOKS.replace("  const truncated =", "  const q = useQuery(opts);\n  const truncated ="),
            encoding="utf-8",
        ),
        "cannot-check",
    )
    case(
        "W6 a keyless page-local comms read is not excused by the shared hooks",
        lambda t: (t / _CMS.hooks).write_text(
            CLEAN_COMMS_HOOKS.replace(
                "  const truncated =", "  const q = useQuery({ queryFn: listReportSchedules });\n  const truncated ="
            ),
            encoding="utf-8",
        ),
        "cannot-check",
    )
    case(
        # 2026-09-25 (PR #470 audit): a `useQueries`/`useSuspenseQuery` local
        # read must never be mistaken for "no local query call" — that misread
        # is what let the pass-vacuously exemption above wave through a form
        # neither USE_QUERY nor the old detector recognized.
        "W6 does NOT silently pass a useQueries call it cannot parse",
        lambda t: (t / _CMS.hooks).write_text(
            CLEAN_COMMS_HOOKS.replace(
                "  const truncated =",
                "  const results = useQueries({ queries: [{ queryKey: ['report-schedules'], queryFn: listReportSchedules }] });\n"
                "  const truncated =",
            ),
            encoding="utf-8",
        ),
        "cannot-check",
    )
    case(
        "W6 does NOT silently pass a useSuspenseQuery call it cannot parse",
        lambda t: (t / _CMS.hooks).write_text(
            CLEAN_COMMS_HOOKS.replace(
                "  const truncated =",
                "  const q = useSuspenseQuery({ queryKey: ['report-schedules'], queryFn: listReportSchedules });\n"
                "  const truncated =",
            ),
            encoding="utf-8",
        ),
        "cannot-check",
    )
    case(
        # ADR 0160 open item 3 / PR #470 audit: useSendersDeskData.ts sat
        # outside this PageSpec's hooks/renderers, so a dropped `restaurantId`
        # on either of its two queries would have gone unguarded. Now listed
        # as a renderer (see the PageSpec above), both keys are judged.
        "W6 the senders register key lost its tenant (comms-senders)",
        lambda t: (t / _CMS_SENDERS).write_text(
            CLEAN_COMMS_SENDERS_HOOKS.replace(
                "queryKey: ['comms-senders', restaurantId],",
                "queryKey: ['comms-senders'],",
            ),
            encoding="utf-8",
        ),
        "violation",
        "comms-senders",
    )
    case(
        "W6 the strangers key lost its tenant (comms-strangers)",
        lambda t: (t / _CMS_SENDERS).write_text(
            CLEAN_COMMS_SENDERS_HOOKS.replace(
                "queryKey: ['comms-strangers', restaurantId, allHouses ? 'all' : 'this'],",
                "queryKey: ['comms-strangers', allHouses ? 'all' : 'this'],",
            ),
            encoding="utf-8",
        ),
        "violation",
        "comms-strangers",
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
            # EVERY renderer: the page has two since the credit ledger lane,
            # and one left holding a useQuery would keep the matcher fed.
            [
                (t / r).write_text(
                    CLEAN_RECEIPTS_RENDERER.replace("useQuery({", "notAQuery({"), encoding="utf-8"
                )
                for r in _RCP.renderers
            ],
        )
        and None,
        "cannot-check",
    )

    # ── /team ────────────────────────────────────────────────────────────────
    # Every case names its file BY NAME (`_team_file`), never by tuple position.
    # They come in four groups. The rebuilt half, which is the whole page after
    # the cutover. The legacy half while it is PRESENT, which is `main` until
    # the cutover. The retirement itself, which is PR #494's tree. And the two
    # completeness checks, `query_tree` and `every_query_read`.
    print("\n-- /team --\n")

    def put(name: str, body: str):
        return lambda t: (t / _team_file(name)).write_text(body, encoding="utf-8")

    def retire_legacy(t: Path) -> None:
        shutil.rmtree(t / _TEAM_CMD)

    # The rebuilt half.
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
        "W6 a key that names the tenant only as a SUBSTRING (`rid` inside `grid`)",
        # Passed W6 until 2026-09-28: `tok in flat` found `rid` in `week-grid`.
        lambda t: (t / _TEAM.hooks).write_text(
            CLEAN_TEAM_HOOKS.replace(
                "'team-next-week', rid, weekStart]", "'team-next-week-grid', weekStart]"
            ),
            encoding="utf-8",
        ),
        "violation",
        expect_text="team-next-week-grid",
    )
    case(
        "W6 FormerStaff's key lost its tenant (a file W6 never read before 2026-09-28)",
        put(
            "FormerStaff.tsx",
            CLEAN_TEAM_FORMER.replace("'team-next-former-staff', rid]", "'team-next-former-staff']"),
        ),
        "violation",
        expect_text="team-next-former-staff",
    )
    case(
        "W6 SendGrants' undotted factory lost its tenant argument",
        # `.replace(…, 1)` changes the cache bucket only. The eviction below it
        # keeps the tenant, and W6 must not be reading evictions anyway.
        put(
            "SendGrantsSection.tsx",
            CLEAN_TEAM_GRANTS.replace("queryKey: grantKeys(restaurantId),", "queryKey: grantKeys(),", 1),
        ),
        "violation",
        expect_text="grantKeys()",
    )
    case(
        "W6 useHouseAreas' Away factory lost its tenant argument",
        put("useHouseAreas.ts", CLEAN_TEAM_AREAS.replace("queryKey: awayKey(rid)", "queryKey: awayKey(null)")),
        "violation",
        expect_text="awayKey(null)",
    )
    case(
        "W6 TeamOverlays' text-senders key lost its tenant",
        put(
            "TeamOverlays.tsx",
            CLEAN_TEAM_OVERLAYS.replace("'team-next-text-senders', rid]", "'team-next-text-senders']"),
        ),
        "violation",
        expect_text="team-next-text-senders",
    )
    case(
        "W6 MyShiftsNext's week key lost its tenant",
        put(
            "MyShiftsNext.tsx",
            CLEAN_TEAM_MYSHIFTS_NEXT.replace("'team-next-my-week', rid, weekStart]", "'team-next-my-week', weekStart]"),
        ),
        "violation",
        expect_text="team-next-my-week",
    )
    case(
        "W6 PerformanceCard's key lost its tenant",
        put(
            "PerformanceCard.tsx",
            CLEAN_TEAM_PERF_CARD.replace(
                "'team-next-performance', rid, memberId]", "'team-next-performance', memberId]"
            ),
        ),
        "violation",
        expect_text="team-next-performance",
    )
    case(
        "W2 PerformanceCard's ceiling mark was deleted but its import stayed",
        put("PerformanceCard.tsx", CLEAN_TEAM_PERF_CARD.replace("over ${LE}${", "over ${")),
        "violation",
        expect_text="PerformanceCard.tsx",
    )
    case(
        "W2 TeamRecord's trail mark was deleted but its import stayed",
        put("TeamRecord.tsx", CLEAN_TEAM_RECORD.replace("The last {LE}{", "The last {")),
        "violation",
        expect_text="TeamRecord.tsx",
    )
    case(
        "W1 the benchmark window drifted from the server's .limit(200)",
        lambda t: (t / GATEWAY_ROOT / "team" / "performance.service.ts").write_text(
            CLEAN_PERF_GATEWAY.replace("limit(200)", "limit(500)"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W1 the trail's clamp fell below the 100 the sheet declares",
        lambda t: (t / GATEWAY_ROOT / "settings-audit" / "settings-audit.service.ts").write_text(
            CLEAN_SETTINGS_AUDIT_GATEWAY.replace("Math.min(200,", "Math.min(50,"), encoding="utf-8"
        ),
        "violation",
        expect_text="TRAIL_ROWS",
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
        "W3 a measured zero folded into the dash in a rebuilt sheet",
        put("FormerStaff.tsx", CLEAN_TEAM_FORMER.replace(
            "return <div>", "return <div>{q.data?.people.length > 0 ? q.data.people.length : EM}",
        )),
        "violation",
        expect_text="FormerStaff.tsx",
    )

    # The legacy half, PRESENT: `main` until the cutover.
    case(
        "W6 the LEGACY desk's week key lost its tenant (the half that was right)",
        put(
            "ManagerShiftDesk.tsx",
            CLEAN_TEAM_DESK.replace("'team', 'week', activeRestaurantId, weekStart]", "'team', 'week', weekStart]"),
        ),
        "violation",
        expect_text="'team', 'week', weekStart",
    )
    case(
        "W6 the legacy Ops drawer's rule key lost its tenant",
        put(
            "OpsRulesPanel.tsx",
            CLEAN_TEAM_OPS.replace("'coverage-templates', activeRestaurantId]", "'coverage-templates']"),
        ),
        "violation",
        expect_text="coverage-templates",
    )
    case(
        "W6 the legacy performance key lost its tenant",
        put(
            "PerformancePanel.tsx",
            CLEAN_TEAM_PERF.replace(
                "'team', 'performance', activeRestaurantId, member?.id]",
                "'team', 'performance', member?.id]",
            ),
        ),
        "violation",
        expect_text="'team', 'performance', member?.id",
    )
    case(
        "W2 the legacy benchmark mark was deleted but its SEMICOLON-FREE import stayed",
        put(
            "PerformancePanel.tsx",
            CLEAN_TEAM_PERF.replace(
                "{LE}{TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES} of them", "{TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES}"
            ),
        ),
        "violation",
        expect_text="PerformancePanel.tsx",
    )
    case(
        "one legacy file is gone while the rest of the legacy half is still there",
        lambda t: (t / _team_file("ManagerShiftDesk.tsx")).unlink(),
        "cannot-check",
        expect_text="ManagerShiftDesk.tsx",
    )
    case(
        "the legacy query files are gone but a legacy TEST is left behind",
        # A lone test still imports the half it tests, so that half is not gone.
        lambda t: [
            (t / r).unlink() for r in _TEAM.retiring
        ] and (t / _TEAM_CMD / "TeamCommand.honesty.test.tsx").write_text(
            "import { ManagerShiftDesk } from './ManagerShiftDesk'\n", encoding="utf-8"
        ),
        "cannot-check",
        expect_text="anchor file is missing",
    )

    # The retirement: PR #494's tree.
    case(
        "the legacy half is deleted whole: clean, and the run SAYS it read none of it",
        retire_legacy,
        "clean",
        expect_text="RETIRED",
    )
    case(
        "an EMPTY legacy directory left behind also counts as retired",
        lambda t: [(t / r).unlink() for r in _TEAM.retiring] and None,
        "clean",
        expect_text="RETIRED",
    )

    def retired_and_leaky(t: Path) -> None:
        retire_legacy(t)
        put("SendGrantsSection.tsx", CLEAN_TEAM_GRANTS.replace(
            "queryKey: grantKeys(restaurantId),", "queryKey: grantKeys(),", 1
        ))(t)

    case(
        "legacy half retired AND a rebuilt key lost its tenant: the guard still fires",
        retired_and_leaky,
        "violation",
        expect_text="grantKeys()",
    )

    def retired_and_unmarked(t: Path) -> None:
        retire_legacy(t)
        put("PerformanceCard.tsx", CLEAN_TEAM_PERF_CARD.replace("over ${LE}${", "over ${"))(t)

    case(
        "legacy half retired AND the only benchmark mark left was deleted",
        # With PerformancePanel gone, PerformanceCard is the sole renderer of
        # the benchmark. Its mark must still be held.
        retired_and_unmarked,
        "violation",
        expect_text="PerformanceCard.tsx",
    )

    def retired_and_missing(t: Path) -> None:
        retire_legacy(t)
        (t / _team_file("useHouseAreas.ts")).unlink()

    case(
        "legacy half retired AND a rebuilt anchor is missing",
        retired_and_missing,
        "cannot-check",
        expect_text="useHouseAreas.ts",
    )

    def moved_not_deleted(t: Path) -> None:
        retire_legacy(t)
        moved = t / _TEAM_TREE / "legacy" / "ManagerShiftDesk.tsx"
        moved.parent.mkdir(parents=True)
        moved.write_text(CLEAN_TEAM_DESK, encoding="utf-8")

    case(
        "the legacy desk was MOVED under pages/team rather than deleted",
        # Retiring `command/` must not let the same queries live on next door.
        moved_not_deleted,
        "cannot-check",
        expect_text="legacy/ManagerShiftDesk.tsx",
    )

    # query_tree: every query file under pages/team is named.
    case(
        "query_tree: a new rebuilt file calls useQuery and is not named",
        lambda t: (t / _TEAM_NEXT / "BreakPlanner.tsx").write_text(
            "import { useQuery } from '@tanstack/react-query';\n"
            "export function BreakPlanner() {\n"
            "  const q = useQuery({ queryKey: ['team-next-breaks', rid], queryFn: f });\n"
            "  return null;\n}\n",
            encoding="utf-8",
        ),
        "cannot-check",
        expect_text="BreakPlanner.tsx",
    )
    case(
        "query_tree: a new file's useSuspenseQuery is a query file too",
        lambda t: (t / _TEAM_NEXT / "useBreaks.ts").write_text(
            "export const useBreaks = () => useSuspenseQuery({ queryKey: ['b', rid], queryFn: f });\n",
            encoding="utf-8",
        ),
        "cannot-check",
        expect_text="useBreaks.ts",
    )
    case(
        "query_tree: a TEST file that calls useQuery is not a page file",
        lambda t: (t / _TEAM_NEXT / "BreakPlanner.test.tsx").write_text(
            "const q = useQuery({ queryKey: ['x'], queryFn: f });\n", encoding="utf-8"
        ),
        "clean",
    )
    case(
        "query_tree: a new file that only EVICTS (useQueryClient) is not a query file",
        lambda t: (t / _TEAM_NEXT / "BreakSheet.tsx").write_text(
            "import { useMutation, useQueryClient } from '@tanstack/react-query';\n"
            "export function BreakSheet() {\n"
            "  const qc = useQueryClient();\n"
            "  void qc.invalidateQueries({ queryKey: ['team-next-breaks'] });\n"
            "  return null;\n}\n",
            encoding="utf-8",
        ),
        "clean",
    )

    # every_query_read: every call parses, every body has a key W6 can read.
    case(
        "every_query_read: SendGrants' key moved into a bare local",
        put(
            "SendGrantsSection.tsx",
            CLEAN_TEAM_GRANTS.replace("queryKey: grantKeys(restaurantId),", "queryKey: grantsKey,", 1),
        ),
        "cannot-check",
        expect_text="has no key W6 can read",
    )
    case(
        "every_query_read: a useQueries beside an ordinary useQuery in one file",
        # The file still has one parsed body, so a has-a-body test passes it.
        # The call count does not.
        put(
            "MyShiftsNext.tsx",
            CLEAN_TEAM_MYSHIFTS_NEXT.replace(
                "  const notesQ = useQuery({",
                "  const both = useQueries({ queries: [{ queryKey: ['team-next-extra'], queryFn: f }] });\n"
                "  const notesQ = useQuery({",
            ),
        ),
        "cannot-check",
        expect_text="MyShiftsNext.tsx makes 3 query-hook call(s), but only 2 parsed",
    )
    case(
        "every_query_read: a legacy query built from an options object elsewhere",
        put("MyShifts.tsx", CLEAN_TEAM_MYSHIFTS.replace(
            "const q = useQuery({ queryKey: ['team', 'my-week', activeRestaurantId, weekStart], queryFn: f })",
            "const q = useQuery(weekOptions(weekStart))",
        )),
        "cannot-check",
        expect_text="MyShifts.tsx makes 1 query-hook call(s), but only 0 parsed",
    )

    # Anchors.
    case(
        "the team register was deleted",
        lambda t: (t / _TEAM.hooks).write_text("export const nothing = 1;\n", encoding="utf-8"),
        "cannot-check",
    )
    case(
        "a rebuilt renderer added 2026-09-28 is missing",
        lambda t: (t / _team_file("FormerStaff.tsx")).unlink(),
        "cannot-check",
        expect_text="FormerStaff.tsx",
    )
    case(
        "a rebuilt renderer from the parity build is missing",
        lambda t: (t / _team_file("RosterSheet.tsx")).unlink(),
        "cannot-check",
        expect_text="RosterSheet.tsx",
    )
    case(
        "the cited performance service lost every .limit()",
        lambda t: (t / GATEWAY_ROOT / "team" / "performance.service.ts").write_text(
            "export class PerformanceService {}\n", encoding="utf-8"
        ),
        "cannot-check",
    )

    # ── /logs ────────────────────────────────────────────────────────────────
    # The first page here whose feed is WALKED. Two consequences run through
    # every case below: its cache is a `useInfiniteQuery`, so W5/W6 reach it
    # only through the optional `Infinite` half of USE_QUERY; and its cited
    # gateway file is shared with the Sorting Office, so both W1 cases assert on
    # the message text rather than on the verdict alone.
    print("\n-- /logs --\n")
    case(
        "W6 sees a useInfiniteQuery (the page's ONLY cache bucket)",
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace("'timeline', rid, correlationId", "'timeline', correlationId"),
            encoding="utf-8",
        ),
        "violation",
        expect_text="/logs",
    )
    case(
        "W6 sees a GENERIC-annotated useInfiniteQuery too",
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace("useInfiniteQuery({", "useInfiniteQuery<TimelinePage>({").replace(
                "'timeline', rid, correlationId", "'timeline', correlationId"
            ),
            encoding="utf-8",
        ),
        "violation",
        expect_text="/logs",
    )
    case(
        "W5 the walked feed stops reading its own hasMore and stops citing the cap",
        # Both halves at once, because either alone is legitimate: a queryFn
        # that names the register is asking for the cap deliberately, and one
        # that reads `hasMore` has kept its cardinality. Losing BOTH is a page
        # length standing in for a total — and on THIS page it is worse than
        # elsewhere, because `hasMore` is what the "Read older entries" control
        # and the floor mark are both computed from.
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace(
                "limit: LOGS_SERVER_WINDOWS.TIMELINE", "limit: 100"
            ).replace(
                "    getNextPageParam: (last, _all, lastParam) =>\n"
                "      last.hasMore === true && last.nextCursor !== lastParam ? last.nextCursor : undefined,\n",
                "",
            ),
            encoding="utf-8",
        ),
        "violation",
        expect_text="/logs",
    )
    case(
        "W1 the /logs register drifted past the server's clamp",
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace("TIMELINE: 100,", "TIMELINE: 250,"), encoding="utf-8"
        ),
        "violation",
        expect_text="/logs",
    )
    case(
        "W1 the timeline clamp fell below /logs' declared window",
        # The same mutation the Sorting Office already has a case for. Asserting
        # on "/logs" is what proves THIS page's register entry is live rather
        # than decoration riding on the other page's.
        lambda t: (t / GATEWAY_ROOT / "logs" / "logs-timeline.service.ts").write_text(
            CLEAN_TIMELINE_GATEWAY.replace("Math.min(200", "Math.min(25"), encoding="utf-8"
        ),
        "violation",
        expect_text="/logs",
    )
    case(
        "W2 the /logs floor marker was deleted but its IMPORT remained",
        lambda t: (t / _LOGS_PAGE.renderers[0]).write_text(
            CLEAN_LOGS_RENDERER.replace(
                "{count === null ? EM : floor ? `${GE} ${count}` : count}",
                "{count === null ? EM : count}",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W2 the /logs window is declared but every reader took the literal",
        lambda t: (
            (t / _LOGS_PAGE.hooks).write_text(
                CLEAN_LOGS_HOOKS.replace("LOGS_SERVER_WINDOWS.TIMELINE", "100"), encoding="utf-8"
            ),
            (t / _LOGS_PAGE.renderers[0]).write_text(
                CLEAN_LOGS_RENDERER.replace("LOGS_SERVER_WINDOWS.TIMELINE", "100"), encoding="utf-8"
            ),
        )
        and None,
        "violation",
        expect_text="/logs",
    )
    case(
        "W3 a measured zero on /logs rendered as the unknown dash",
        lambda t: (t / _LOGS_PAGE.renderers[0]).write_text(
            CLEAN_LOGS_RENDERER.replace(
                "{count === null ? EM : floor ? `${GE} ${count}` : count}",
                "{GE}{count > 0 ? String(count) : EM}",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W3 reads the ENTRY SHEET too, not just the page",
        # The sheet carries no window and no query, so W1/W2/W5/W6 never touch
        # it. If it were left out of `renderers` this mutation would be invisible
        # and the run would still print "clean".
        lambda t: (t / _LOGS_PAGE.renderers[1]).write_text(
            CLEAN_LOGS_SHEET.replace(
                "{event ? event.summary : EM}", "{event.count > 0 ? event.count : EM}"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W4 hasMore widened away, so an old gateway reads as 'nothing older exists'",
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace("hasMore: boolean | null;", "hasMore: boolean;"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W4 failedSources widened away, so 'did not say' becomes 'said none'",
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace(
                "failedSources: TimelineSource[] | null;", "failedSources: TimelineSource[];"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W4 the failure's status widened away from | null",
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace("status: number | null;", "status: number;"),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W3 a /logs register field whose unanswered branch is an empty list",
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace(
                "  return { atFloor };",
                "  return {\n    failedSources: known ? last.failedSources : [],\n    atFloor,\n  };",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "the /logs register was deleted",
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            "export const nothing = 1;\n", encoding="utf-8"
        ),
        "cannot-check",
    )
    case(
        "the /logs entry sheet is missing",
        lambda t: (t / _LOGS_PAGE.renderers[1]).unlink(),
        "cannot-check",
    )
    case(
        "a /logs nullable field was renamed",
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace("sourcesQueried:", "registersQueried:"), encoding="utf-8"
        ),
        "cannot-check",
    )
    case(
        "the /logs hook's query call vanished entirely",
        # No query call at all: the page's only bucket is gone and there is
        # nothing left to name it, so this lands on the generic no-keys-found
        # branch. It must read as cannot-check, never as clean.
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace("useInfiniteQuery({", "notAQuery({"), encoding="utf-8"
        ),
        "cannot-check",
        expect_text="no `queryKey: [...]` found",
    )
    case(
        "the matcher LOSES ITS GRIP on useInfiniteQuery and says so",
        # The vacuity that matters most on this page, and the one the anti-
        # vacuity branch could not catch until it was matched as an identifier:
        # the call is still there and still spelled `useInfiniteQuery`, but the
        # options are no longer a brace literal, so USE_QUERY finds nothing.
        # W5, W6 and W7 would all pass on a file they never read. The expected
        # message is the SPECIFIC one — landing on the generic no-keys branch
        # instead would mean the widened check is still dead.
        lambda t: (t / _LOGS_PAGE.hooks).write_text(
            CLEAN_LOGS_HOOKS.replace("useInfiniteQuery({", "useInfiniteQuery(\n    buildOptions({"),
            encoding="utf-8",
        ),
        "cannot-check",
        expect_text="contains a query call but none could be parsed",
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
        for n in rep.notes:
            print(f"  NOT read: {n}")
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
    # The two completeness checks are opt-in per page (2026-09-28, /team
    # first). Where they are off, the run says so rather than implying them.
    untreed = [pg.name for pg in PAGES if pg.query_tree is None]
    if untreed:
        print(
            "  NOT checked: that every file calling a query hook is named "
            "(`query_tree`) on " + ", ".join(untreed) + ". A query in a file "
            "those PageSpecs do not name is invisible to W6."
        )
    unread = [pg.name for pg in PAGES if pg.tenant_keyed and not pg.every_query_read]
    if unread:
        print(
            "  NOT checked: that every query call parses and carries a key W6 can "
            "read (`every_query_read`) on " + ", ".join(unread) + ". There, a key "
            "held in a bare local passes unread as long as another query on the "
            "page has a readable key."
        )
    for n in rep.notes:
        print(f"  NOT read: {n}")
    print("  See this file's header for the full boundary.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
