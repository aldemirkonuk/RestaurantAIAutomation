#!/usr/bin/env python3
"""Guard: every relation the code queries must be defined by supabase/migrations/.

WHY THIS EXISTS
---------------
Five instances of one defect were found on 2026-08-26. In each, a migration
that CREATEs a table lives OUTSIDE `supabase/migrations/` -- in
`supabase/migrations_archive/` or `services/database/migrations_archive/` --
so it was never applied, production silently lacks the table, and the code
queries it anyway. PostgREST answers `PGRST205`, the caller logs nothing or
falls back to a default, and nothing goes red:

  restaurant_feature_flags     prod had the 7-column EAV table, not the
                               22-column one. Every toggle inert at the DB, and
                               `enable_ai_negotiation` could not be turned OFF
                               because the failed read fell back to "enabled".
  scheduled_reports            reports.service.ts -- insert and list have failed
                               100% of the time, silently.
  restaurant_inbound_addresses applied by some other route, so it EXISTS.
                               Proof that "it is in an archive" is not a
                               reliable signal in either direction.
  push_subscriptions           notification_agent.py -- the gateway's reader was
                               DELETED rather than repointed (ADR 0027); the
                               Python one still queries it.
  integration_oauth_connections/_states
                               Drive/Excel OAuth completes at Google, then fails
                               on the write.

WHY `Fresh database equals remote` DID NOT CATCH ANY OF THEM
-----------------------------------------------------------
schema-parity.yml compares a database against a database: a local one rebuilt
from `supabase/migrations/`, and production. For all five tables, BOTH sides
are equally wrong -- local does not create the table because the migration is
archived, and production does not have it because the migration was never
applied. The diff is empty. The job is green *because* the two agree, and they
agree on being wrong.

It also has no notion of application code at all. Its universe is columns and
functions; "does anything actually SELECT this" is not a question it can ask.

`20260805000000_baseline_from_production.sql` is why that blindness is total
rather than partial: it captured production as it stood on 2026-08-05, so every
table that had not been applied by then vanished from the repo's own idea of
the schema. After the baseline, local and remote were identical BY
CONSTRUCTION, and the parity check has been reporting that identity ever since.

WHAT THIS GUARD DOES
--------------------
It adds the third corner nothing was comparing:

    C  = relations the CODE queries               (static extraction, this script)
    L  = relations `supabase/migrations/` DEFINES ("what should exist")
    R  = relations PRODUCTION has                 ("what exists today")

  C - L   code queries something no migration in the live directory defines.
          Needs no secret. This is the arm that catches the defect class, and
          it catches `restaurant_inbound_addresses` too -- a table that exists
          in production only because someone applied it by hand, and that a
          rebuild would lose.
  C - R   code queries something production does not have. Needs the DB
          connection string schema-parity.yml already holds. Catches the case
          where the migration is in the right place but was never pushed.
  L vs R  already covered by scripts/check_schema_parity.sh, at column
          granularity. Not repeated here.

  ./scripts/check_queried_tables_exist.py                 # C vs L, hermetic
  ./scripts/check_queried_tables_exist.py --against-production
  ./scripts/check_queried_tables_exist.py --against-production --base origin/main
  ./scripts/check_queried_tables_exist.py --list-dynamic  # show the blind spot
  ./scripts/check_queried_tables_exist.py --self-test     # prove it can go red

Exit 0 = pass.  Exit 1 = violation.  Exit 2 = the guard could not check what it
claims to check (see NEVER VACUOUS).

`--base` -- WHY THE C - R ARM IS MERGE-AWARE (ADR 0095)
------------------------------------------------------
C - R asks "does production have what the code calls". On a `push` to `main`
that is exactly the right question: production and `main` are meant to be in
lockstep, so a call to an object production lacks IS failing at runtime right
now, and nothing here relaxes that.

On a pull request it is a question nobody posed. Migrations auto-apply on
MERGE, so a PR that adds one is comparing code that is not deployed against a
production that correctly does not have the object yet. The code and the
migration land together; neither is live. The guard printed
`(migrations DO define it -- never pushed)` -- an accurate description of a
non-defect -- and exited 1 anyway.

MEASURED, 2026-09-02: PR #243 added `record_stock_count` together with the
migration creating it, and this guard failed with *"1 function(s) the code
calls do not exist in PRODUCTION"*. Because this job's `name:` is a required
status check on `main`, that PR could not merge by any route that did not
either bypass the check or hand-apply the migration to production first --
and hand-applying manufactures the version mismatch that cost two sessions an
hour the same day. Both required contexts were removed from `main` to unblock
the day. This is what earns them back.

The fix, deliberately the same shape ADR 0092 gave the sibling check
`Fresh database equals remote`, because two shapes for one problem is how the
two guards start disagreeing: with `--base <ref>`, work out which migration
files this PR ADDS (`scripts/parity_migrations_added_by_pr.py`, three-dot,
`--diff-filter=A`), parse the migration directory a second time WITHOUT them,
and treat the difference as "introduced by this PR". An object production lacks
is expected exactly when it is in that difference.

WHAT THIS DELIBERATELY DOES NOT RELAX -- the whole ratchet:
  * An object NO migration declares still fails, in both modes. The exempt set
    is a SUBSET of what migrations declare, so a phantom relation cannot be in
    it. The hermetic C - L arm above is not touched at all.
  * A MODIFIED migration exempts nothing (`--diff-filter=A` only). Editing an
    already-applied migration to add a table is still a defect.
  * With no `--base` -- every `push` and `schedule` run -- the exempt set is
    empty and the behaviour is byte-for-byte what it was. `main` is as strict
    as it ever was.
  * An unresolvable base is exit 2, never a quiet strict run and never a quiet
    vacuous one. See NEVER VACUOUS.

WHAT IT DOES NOT CATCH -- read this before trusting it
------------------------------------------------------
1. COLUMNS -- and so NOT the restaurant_feature_flags instance. This works at
   relation granularity: table, view, RPC function. That table EXISTS, in
   supabase/migrations/ and in production; what differed was its shape.
   Production is EAV (`flag_name` varchar + `enabled` boolean) and the archived
   definition in services/database/migrations_archive/011_add_restaurant_feature_flags.sql
   is 22 `enable_*` boolean columns -- two different data models under one name.
   This arm is silent on it and so is check 2 of the sibling guard, because the
   live directory does declare the table.
   A column-level check was built and measured on 2026-08-26 (see the ADR):
   restaurant_feature_flags ranks FIRST at +22 archive-only columns, so the
   signal is real. It is reported, not enforced -- see the CENSUS in
   scripts/check_migrations_single_home.py and the open question in
   .planning/04-specs/HANDOFF-schema-guard.md.
2. DYNAMIC TABLE NAMES. `.from(someVariable)` cannot be resolved by reading one
   file. Simple module-level `const NAME = "literal"` IS resolved (that is how
   `.from(FEATURE_FLAGS_TABLE)` is covered). Everything else is counted,
   reported on every run, and ratcheted: DYNAMIC_CEILING below fails the build
   if the unresolvable set grows. A guard that quietly ignores a third of its
   call sites is the same lie in a new place.
3. RAW SQL. Anything issued as a SQL string rather than through the supabase
   client is invisible here.
4. RUNTIME SCHEMA CHANGES. Someone dropping a table in the dashboard is caught
   by the --against-production arm, and only on the runs that have the secret.

NEVER VACUOUS
-------------
Every "found nothing" path is a FAILURE, not a pass:
  * a scanned root does not exist                 -> exit 2
  * a root imports a client but yields no sites   -> exit 2, the pattern rotted
  * fewer than MIN_DECLARED relations parsed      -> exit 2, the SQL parse broke
  * a KNOWN_MISSING entry is now satisfied        -> exit 1, prune it (ratchet)
  * a KNOWN_MISSING entry is not queried any more -> exit 1, prune it
  * `--base` given and the base cannot be resolved-> exit 2, never a quiet
                                                     strict or vacuous run
  * `--base` names a migration not on disk        -> exit 2, the held-back list
                                                     does not describe this tree
  * the base parse falls under MIN_DECLARED       -> exit 2, the exclusion or
                                                     the SQL parse ate the tree
The last two of the first group matter as much as the first. A debt list nobody
prunes stops being a record of debt and becomes a list of relations the guard
has quietly stopped looking at.
"""

from __future__ import annotations

import argparse
import os
import pathlib
import re
import sys
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# What gets scanned
#
# The two roots the defect was found in are the gateway and the orchestrator.
# apps/web, apps/mobile and services/self-evolution hold their own supabase
# clients and are scanned by the same extractor -- leaving them out would mean
# declaring three more blind spots rather than checking three more roots.
# ---------------------------------------------------------------------------
TS_ROOTS = [
    "apps/api-gateway/src",
    "apps/web/src",
    # Zero call sites today: mobile talks to the gateway, not to PostgREST. It is
    # scanned anyway rather than dropped, because the two-signal vacuity test
    # below turns "mobile grew a supabase client" into a failure instead of a
    # silent gap. Dropping a root is how a root stops being checked.
    "apps/mobile/src",
]
PY_ROOTS = [
    "services/agent-orchestrator",
    "services/self-evolution",
]

# Signal that a root talks to PostgREST at all. A root that imports a supabase
# client but yields zero call sites means the extraction pattern rotted; a root
# with neither is legitimately empty. Two signals, so neither answer is assumed.
HAS_CLIENT_RE = re.compile(
    r"@supabase/supabase-js|from supabase import|create_client\(|createClient\("
)

MIGRATIONS_DIR = "supabase/migrations"

# Test files describe fixtures, not production queries. A spec that mocks
# `.from("whatever")` is not evidence the schema needs `whatever`.
TS_SKIP_RE = re.compile(r"(\.spec\.tsx?$|\.test\.tsx?$|/__tests__/|/__mocks__/|/e2e/)")
PY_SKIP_RE = re.compile(r"(/tests?/|/venv/|/__pycache__/|/site-packages/|_test\.py$|^test_)")

# Sanity floor for the SQL parse. The baseline alone defines 172 tables; if this
# parse ever returns a handful, the regexes have rotted and every table in the
# codebase would look missing.
MIN_DECLARED = 150

# ---------------------------------------------------------------------------
# KNOWN_MISSING -- the shrink-only debt ratchet.
#
# These are NOT approved. They are the relations already broken when this guard
# landed, recorded so the guard can be green-on-arrival and therefore actually
# block the next one. Same posture as PY_UNLOGGED_DEBT in
# scripts/check_model_calls_logged.sh.
#
# The list is shrink-only and enforced in both directions:
#   * an entry that is now declared        -> FAIL, delete the line
#   * an entry nothing queries any more    -> FAIL, delete the line
#   * a new undeclared relation            -> FAIL, write the migration
# The only way to touch this list is to make it shorter.
#
# `prod:yes` / `prod:no` in each entry is a query result from
# --against-production, measured 2026-08-26, not an opinion. Three sub-classes,
# and the difference matters:
#
#   A  ARCHIVED   a migration defines it, in an archive directory, so it was
#                 never applied. The class the founder found five of.
#   B  APPLIED    present in production, defined by NO migration in the live
#                 directory. It works today and a rebuild loses it silently.
#   C  PHANTOM    defined nowhere in this repository at all. The code queries a
#                 table nobody ever wrote a migration for.
# ---------------------------------------------------------------------------
KNOWN_MISSING: dict[str, str] = {
    # ---- A: archived migration, never applied. prod:no -> broken right now ----
    "scheduled_reports": (
        "[A prod:no] supabase/migrations_archive/20260208024921_baseline_schema.sql and "
        "services/database/migrations_archive/008_providers_and_reports.sql. "
        "reports.service.ts:165,185,208 insert and list; both have failed 100% of the "
        "time, silently. Unowned as of 2026-08-26."
    ),
    "push_subscriptions": (
        "[A prod:no] supabase/migrations_archive/20260208024921_baseline_schema.sql. "
        "DO NOT CREATE IT -- ADR 0027 / OD-95 settled that this is an abandoned storage "
        "model, not a missing table, and creating it would produce a permanently-empty "
        "second store beside the real one. The gateway's reader "
        "(recipient-resolver.service.ts) was DELETED on 2026-08-26; the entry stays alive "
        "only because notification_agent.py:1615 still queries it. This line is deleted "
        "when that reader is dealt with -- not when a migration lands."
    ),
    "notification_logs": (
        "[A prod:no] supabase/migrations_archive/20260208024921_baseline_schema.sql. "
        "notification_agent.py:1602 inserts every notification it sends into a table that "
        "does not exist. The delivery log has been empty since the baseline."
    ),
    "pos_webhook_logs": (
        "[A prod:no] supabase/migrations_archive/20260208024921_baseline_schema.sql. "
        "pos_integration_agent.py:951 writes it, reporting_agent.py:503 reads it."
    ),
    "provider_important_dates": (
        "[A prod:no] supabase/migrations_archive/20260208024921_baseline_schema.sql. "
        "calendar_agent.py:139,380."
    ),
    "provider_ratings": (
        "[A prod:no] supabase/migrations_archive/20260208024921_baseline_schema.sql and "
        "services/database/migrations_archive/008_providers_and_reports.sql. "
        "providers.service.ts:589 inserts a rating that is discarded."
    ),
    # ---- C: defined nowhere in this repository ----
    #
    # ALL SIX class-C entries were closed on 2026-08-26 under OD-99 / ADR 0028,
    # and the ratchet is doing its job: each line below was deleted only after
    # the last call site naming it was gone. Recorded here so the next session
    # does not re-derive the verdicts (they are not all the same verdict):
    #
    #   reports                -> REPOINTED to generated_reports, which exists.
    #                             dashboard.service.ts. + ADR 0020 honesty:
    #                             ReportSummaryDto.unavailable separates a
    #                             failed read from an empty archive.
    #   inventory_stock        -> REPOINTED to restaurant_inventory, which
    #                             carries every column under the same names.
    #                             reporting_agent.py. Its test asserted the
    #                             phantom name and was repointed with it.
    #   managers               -> REPOINTED to manager_report_profiles, which
    #                             is what generated_reports.profile_id points
    #                             at. demo/weekly_report_scheduler.py.
    #   provider_digital_twins -> DELETED. The real store is provider_knowledge
    #                             (category='relationship'), which
    #                             ProviderConversationAgent already reads.
    #   restaurant_wine_menus  -> DELETED. The push_subscriptions shape: the
    #                             JSONL files are the store every reader reads.
    #   wine_library           -> DELETED with its whole match phase, which had
    #                             never returned a candidate. Which table it
    #                             should have been is OD-102, not a default.
}

# Functions reached via .rpc(). Same ratchet, same rules.
#
# Emptied 2026-08-26 under OD-99 / ADR 0028. All five were class C -- no
# CREATE FUNCTION anywhere in the repo, absent from production (PGRST202) --
# and three shared a defect worth remembering: the fallback each author wrote
# for "the RPC isn't there" sat INSIDE the same try as the RPC call, so the
# exception jumped over it. They were unreachable code that made the call
# sites read as defensive. find_provider_by_email and get_inactive_providers
# now run the searches that were unreachable; get_low_stock_items' fallback
# became the body; jsonb_array_append (a WRITE, so its failure was data loss,
# not a degraded read) became an explicit read-modify-write;
# search_provider_conversations' reachable ilike fallback became the body.
#
# An empty dict is the correct end state of a shrink-only list, not a bug.
KNOWN_MISSING_FUNCTIONS: dict[str, str] = {}

# ---------------------------------------------------------------------------
# DYNAMIC_CEILING -- the measured size of the blind spot.
#
# Call sites whose table name cannot be resolved by reading the file. The
# number is not a budget; it is a measurement, and the guard fails if it grows
# so that the blind spot cannot expand without someone noticing. Lowering it is
# always fine. Raising it needs a comment here saying which call site was added
# and why it could not be a literal.
# ---------------------------------------------------------------------------
# MEASURED 2026-08-26: 24 of 1377 call sites (1.7%). All 24 are in
# services/agent-orchestrator/core/database.py -- a generic repository whose
# subclasses pass the table name to `super().__init__(supabase, "<literal>")`,
# plus a ContactRepository that sets `self.table` / `self.addresses_table`.
#
# Resolving them was measured rather than assumed, and deliberately NOT done.
# Behind those 24 sites are 11 distinct table names; 9 of the 11 are already in
# the queried set from literal call sites elsewhere, and the 2 that are not
# (rfq_requests, unit_conversions) are both declared by supabase/migrations/.
# So the entire blind spot changes no verdict today, and the resolution logic it
# would take -- reading a second positional argument out of a super() call --
# is a per-hierarchy guess that would report a wrong table name confidently.
# Measuring the hole and leaving it open beats plastering it with something that
# can be wrong in silence.
# 2026-08-26, raised 24 -> 25 for ONE site in recipient-resolver.service.ts
# (`const table = RecipientResolverService.PUSH_SUBSCRIPTION_TABLE`), then
# LOWERED 25 -> 24 the same day when ADR 0027 / OD-95 deleted that read
# outright rather than repointing it. Measured at 24 after the deletion.
# Resolving `const x = Class.CONST` remains a real gap in the extractor rather
# than an unknowable, and is the cheapest next thing to close if the count
# creeps again.
# 2026-09-02, raised 24 -> 26 for TWO sites in
# apps/api-gateway/src/analytics/dev-truth.service.ts: `client.from(table)` in
# reach() and swallow(), where `table` is the loop variable over SOURCE_TABLE
# and over an explicit probe list. These cannot be literals without defeating
# the instrument -- its entire job is to report row counts and read-failure
# states ACROSS the seven data sources at once, so the table name is the thing
# being iterated. The blind spot changes no verdict: every name it can take is
# a literal in the same file (SOURCE_TABLE's seven values plus five probes),
# so all twelve are already in the queried set from the map literal itself and
# are checked against migrations there. The module is dev-only and returns 404
# under NODE_ENV=production, so if it is ever deleted this should go back to 24.
DYNAMIC_CEILING = 26


# ---------------------------------------------------------------------------
# Comment stripping
# ---------------------------------------------------------------------------
def strip_ts_comments(text: str) -> str:
    """Remove // and /* */ comments, preserving line count.

    Line count is preserved so reported line numbers stay real.

    Only a `//` that STARTS a line is treated as a comment. An earlier guard in
    this repo stripped from `//` anywhere, which also ate the `//` in `https://`
    and made every real call site invisible.

    Block comments are handled as a state machine, but only when the opener is
    the first thing on its line (`/*`, `/**`, `{/*` -- the three shapes this
    codebase actually uses). Requiring line-start keeps a `/*` inside a string
    literal from swallowing live code. Without this, prose inside a JSX comment
    counts as a call site: App.tsx says "location.state.from (Login.tsx:36)"
    and was extracted as a table named `Login.tsx:36`.
    """
    out = []
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


def strip_py_comments(text: str) -> str:
    out = []
    for line in text.split("\n"):
        if line.lstrip().startswith("#"):
            out.append("")
        else:
            out.append(line)
    return "\n".join(out)


def strip_sql_comments(text: str) -> str:
    """Remove -- and /* */ from SQL, preserving line count.

    A CREATE TABLE inside a comment is prose, not schema. The repo has already
    shipped one guard that forgot this (commit 7109522d, "guard ignores
    comments").
    """
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return "\n".join(re.sub(r"--.*$", "", line) for line in text.split("\n"))


# ---------------------------------------------------------------------------
# Call-site extraction
# ---------------------------------------------------------------------------
@dataclass
class CallSite:
    path: str
    line: int
    kind: str  # "table" | "rpc"
    raw: str
    resolved: str | None = None
    via_const: bool = False

    @property
    def dynamic(self) -> bool:
        return self.resolved is None


@dataclass
class Extraction:
    sites: list[CallSite] = field(default_factory=list)
    per_root: dict[str, int] = field(default_factory=dict)
    roots_with_client: dict[str, bool] = field(default_factory=dict)
    const_map: dict[str, str] = field(default_factory=dict)
    ambiguous_consts: set[str] = field(default_factory=set)

    def tables(self) -> set[str]:
        return {s.resolved for s in self.sites if s.kind == "table" and s.resolved}

    def functions(self) -> set[str]:
        return {s.resolved for s in self.sites if s.kind == "rpc" and s.resolved}

    def dynamic_sites(self) -> list[CallSite]:
        return [s for s in self.sites if s.dynamic]


# A table-shaped literal: lowercase snake_case. Rejects "vendor-attachments"
# (a storage bucket) and "*" and select-list strings by construction.
TABLE_LITERAL_RE = re.compile(r"^[a-z][a-z0-9_]*$")

# `const FOO = "bar"` / `FOO: string = "bar"` / `static readonly FOO = "bar"`
TS_CONST_RE = re.compile(
    r"""(?:export\s+)?(?:static\s+)?(?:readonly\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*"""
    r"""(?::\s*[A-Za-z<>\[\]| ]+\s*)?=\s*["'`]([a-z][a-z0-9_]*)["'`]""",
    re.X,
)
TS_STATIC_CONST_RE = re.compile(
    r"""(?:private\s+|public\s+|protected\s+)?static\s+readonly\s+([A-Z][A-Z0-9_]{2,})\s*"""
    r"""(?::\s*[A-Za-z<>\[\]| ]+\s*)?=\s*["'`]([a-z][a-z0-9_-]*)["'`]""",
    re.X,
)
PY_CONST_RE = re.compile(
    r"""^([A-Z][A-Z0-9_]{2,})\s*(?::\s*str\s*)?=\s*["']([a-z][a-z0-9_]*)["']""",
    re.M,
)

# `.from(` / `.table(` / `.from_(` / `.rpc(` with whatever argument.
#
# The argument itself may not span lines, but the `\s*` after `\(` does consume
# a newline, so `.rpc(\n  "apply_stock_movement",` IS matched. Verified against
# all 24 multi-line call sites in the tree on 2026-08-26: 0 missed. That check
# matters because a miss here would NOT show up in the dynamic-site count -- it
# would be a silent hole, which is the exact failure mode this guard exists for.
TS_FROM_RE = re.compile(r"\.from\s*\(\s*([^)\n]*?)\s*[,)]")
TS_RPC_RE = re.compile(r"\.rpc\s*\(\s*([^,)\n]*?)\s*[,)]")
PY_TABLE_RE = re.compile(r"\.(?:table|from_)\s*\(\s*([^)\n]*?)\s*[,)]")
PY_RPC_RE = re.compile(r"\.rpc\s*\(\s*([^,)\n]*?)\s*[,)]")

# Anything ending in one of these immediately before `.from(` is not a table.
#   Array.from / Buffer.from / Object.from / Int8Array.from -> JS builtins
#   .storage           -> a Storage BUCKET, a different namespace entirely
#
# Matched against a whitespace-COLLAPSED lookback, not a whitespace-STRIPPED
# one: stripping turns `return Buffer` into `returnBuffer`, which kills the
# `\b` and lets every Buffer.from() through as a table name.
#
# This filter skips 152 sites, and a WRONG skip would be invisible. Audited
# 2026-08-26: 0 of the 152 takes a table-shaped string literal -- every one is
# Array.from(iterable). Storage buckets are additionally rejected by
# TABLE_LITERAL_RE, since this codebase's buckets are hyphenated.
NOT_A_TABLE_RECEIVER_RE = re.compile(
    r"(?:\bArray|\bBuffer|\bObject|\bString|\bNumber|\b\w*Array|\bstorage)\s*$"
)

STRING_LITERAL_RE = re.compile(r"""^["'`]([^"'`]*)["'`]$""")


def _resolve(arg: str, const_map: dict[str, str], ambiguous: set[str]) -> tuple[str | None, bool]:
    """(resolved_name, came_from_a_const). None means genuinely unresolvable."""
    arg = arg.strip()
    m = STRING_LITERAL_RE.match(arg)
    if m:
        value = m.group(1)
        return (value if TABLE_LITERAL_RE.match(value) else None), False
    # `SomeClass.CONST` and bare `CONST`
    tail = arg.split(".")[-1]
    if tail in ambiguous:
        return None, False
    if tail in const_map:
        return const_map[tail], True
    return None, False


def build_const_maps(files: list[pathlib.Path], lang: str) -> tuple[dict, set]:
    """Repo-wide NAME -> literal, plus the names that map to more than one value.

    A name with two different values anywhere in the tree is treated as
    unresolvable rather than guessed at. Guessing here would invent a table
    name and then confidently report it missing.
    """
    const_map: dict[str, str] = {}
    ambiguous: set[str] = set()
    patterns = (TS_CONST_RE, TS_STATIC_CONST_RE) if lang == "ts" else (PY_CONST_RE,)
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        text = strip_ts_comments(text) if lang == "ts" else strip_py_comments(text)
        for pat in patterns:
            for m in pat.finditer(text):
                name, value = m.group(1), m.group(2)
                if not TABLE_LITERAL_RE.match(value):
                    continue
                if name in const_map and const_map[name] != value:
                    ambiguous.add(name)
                else:
                    const_map[name] = value
    for name in ambiguous:
        const_map.pop(name, None)
    return const_map, ambiguous


def collect_files(root: pathlib.Path, lang: str) -> list[pathlib.Path]:
    exts = ("*.ts", "*.tsx") if lang == "ts" else ("*.py",)
    skip = TS_SKIP_RE if lang == "ts" else PY_SKIP_RE
    out: list[pathlib.Path] = []
    for ext in exts:
        for f in root.rglob(ext):
            rel = str(f)
            if skip.search(rel) or skip.search(f.name):
                continue
            out.append(f)
    return sorted(out)


def extract(repo: pathlib.Path) -> Extraction:
    ex = Extraction()

    for lang, roots in (("ts", TS_ROOTS), ("py", PY_ROOTS)):
        all_files: list[pathlib.Path] = []
        root_files: dict[str, list[pathlib.Path]] = {}
        for r in roots:
            rp = repo / r
            if not rp.is_dir():
                # NEVER VACUOUS: a root that moved must not read as "clean".
                ex.per_root[r] = -1
                root_files[r] = []
                continue
            files = collect_files(rp, lang)
            root_files[r] = files
            all_files.extend(files)

        const_map, ambiguous = build_const_maps(all_files, lang)
        ex.const_map.update(const_map)
        ex.ambiguous_consts.update(ambiguous)

        table_re = TS_FROM_RE if lang == "ts" else PY_TABLE_RE
        rpc_re = TS_RPC_RE if lang == "ts" else PY_RPC_RE
        stripper = strip_ts_comments if lang == "ts" else strip_py_comments

        for r in roots:
            count = 0
            has_client = False
            for f in root_files[r]:
                try:
                    raw_text = f.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                if HAS_CLIENT_RE.search(raw_text):
                    has_client = True
                text = stripper(raw_text)
                for kind, pat in (("table", table_re), ("rpc", rpc_re)):
                    for m in pat.finditer(text):
                        if kind == "table":
                            # Collapsed, not stripped: see NOT_A_TABLE_RECEIVER_RE.
                            before = re.sub(r"\s+", " ", text[max(0, m.start() - 80) : m.start()])
                            if NOT_A_TABLE_RECEIVER_RE.search(before):
                                continue
                        arg = m.group(1)
                        if not arg:
                            continue
                        resolved, via_const = _resolve(arg, const_map, ambiguous)
                        line = text.count("\n", 0, m.start()) + 1
                        ex.sites.append(
                            CallSite(
                                path=str(f.relative_to(repo)),
                                line=line,
                                kind=kind,
                                raw=arg,
                                resolved=resolved,
                                via_const=via_const,
                            )
                        )
                        count += 1
            ex.roots_with_client[r] = has_client
            ex.per_root.setdefault(r, 0)
            if ex.per_root[r] != -1:
                ex.per_root[r] = count
    return ex


# ---------------------------------------------------------------------------
# What supabase/migrations/ declares
# ---------------------------------------------------------------------------
CREATE_TABLE_RE = re.compile(
    r"\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:ONLY\s+)?"
    r"(?:\"?public\"?\.)?\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?",
    re.I,
)
CREATE_TEMP_TABLE_RE = re.compile(
    r"\bCREATE\s+(?:GLOBAL\s+|LOCAL\s+)?TEMP(?:ORARY)?\s+TABLE\b", re.I
)
CREATE_VIEW_RE = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    r"(?:\"?public\"?\.)?\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?",
    re.I,
)
DROP_TABLE_RE = re.compile(
    r"\bDROP\s+(?:MATERIALIZED\s+)?(?:TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?([^;]+)", re.I
)
RENAME_RE = re.compile(
    r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:\"?public\"?\.)?\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?"
    r"\s+RENAME\s+TO\s+\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?",
    re.I,
)
CREATE_FUNCTION_RE = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:\"?public\"?\.)?\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?",
    re.I,
)
DROP_FUNCTION_RE = re.compile(
    r"\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:\"?public\"?\.)?\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?",
    re.I,
)
# Non-public schemas are not PostgREST's `public` namespace and are skipped.
QUALIFIED_OTHER_SCHEMA_RE = re.compile(
    r"\b(auth|storage|extensions|realtime|vault|net|cron)\.", re.I
)


def declared_relations(
    migrations: pathlib.Path, exclude: frozenset[str] = frozenset()
) -> tuple[set[str], set[str], int]:
    """Replay the migration directory in version order. (tables+views, functions, files).

    `exclude` is a set of BASENAMES to skip, and it exists for one caller: the
    merge-base parse, which replays the directory as it stood before this PR
    added anything. Replaying rather than parsing the added files alone is
    deliberate -- DROP and RENAME are order-dependent, so "what this PR
    introduces" is `full - base`, computed by the same replay twice, not by
    reading CREATE statements out of the new files and hoping nothing later
    undoes them.
    """
    relations: set[str] = set()
    functions: set[str] = set()
    files = sorted(p for p in migrations.glob("*.sql") if p.name not in exclude)
    for f in files:
        text = strip_sql_comments(f.read_text(encoding="utf-8", errors="replace"))
        for stmt in text.split(";"):
            if not stmt.strip():
                continue
            for m in CREATE_TABLE_RE.finditer(stmt):
                head = stmt[max(0, m.start() - 40) : m.end()]
                if CREATE_TEMP_TABLE_RE.search(head):
                    continue
                if QUALIFIED_OTHER_SCHEMA_RE.search(stmt[m.start() : m.end() + 2]):
                    continue
                relations.add(m.group(1).lower())
            for m in CREATE_VIEW_RE.finditer(stmt):
                relations.add(m.group(1).lower())
            for m in RENAME_RE.finditer(stmt):
                relations.discard(m.group(1).lower())
                relations.add(m.group(2).lower())
            for m in DROP_TABLE_RE.finditer(stmt):
                for part in m.group(1).split(","):
                    name = part.strip().strip('"').split(".")[-1].strip('"')
                    name = re.sub(r"\s+(CASCADE|RESTRICT)\s*$", "", name, flags=re.I).strip()
                    if re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", name):
                        relations.discard(name.lower())
            for m in CREATE_FUNCTION_RE.finditer(stmt):
                functions.add(m.group(1).lower())
            for m in DROP_FUNCTION_RE.finditer(stmt):
                functions.discard(m.group(1).lower())
    return relations, functions, len(files)


# ---------------------------------------------------------------------------
# Merge awareness -- what THIS pull request introduces (ADR 0095)
#
# Read the `--base` section of the module docstring first. In one line: on a
# pull request the code is no more deployed than the migration is, so an object
# production lacks that THIS PR's migration declares is expected. On a push to
# main it is a live defect and still fails.
#
# The exempt set is computed as `declared(all) - declared(all minus the files
# this PR adds)`, so it is by construction a SUBSET of what migrations declare.
# A relation no migration declares can never enter it -- that is the ratchet,
# and it is structural rather than a check that could be forgotten.
# ---------------------------------------------------------------------------
class CannotCheck(Exception):
    """The guard cannot answer what it claims to answer. Always exit 2, never 0."""


def introduced_relations(
    migrations: pathlib.Path, added_paths: list[str]
) -> tuple[set[str], set[str], list[str], list[str]]:
    """(relations, functions, files used, files skipped) introduced by `added_paths`.

    Raises CannotCheck if a path git reports as added is not on disk. That
    mismatch means the held-back list does not describe this tree, and an
    exempt set computed from it would be a guess -- the one thing a guard may
    never do quietly.
    """
    basenames: list[str] = []
    skipped: list[str] = []
    for p in added_paths:
        pp = pathlib.PurePosixPath(p)
        if pp.parent.as_posix() != MIGRATIONS_DIR or pp.suffix.lower() != ".sql":
            # A nested file (supabase/migrations/seed/) or a non-SQL one.
            # declared_relations only ever reads `<migrations>/*.sql`, so such a
            # file declares nothing here and could not exempt anything. Skipped,
            # and listed on the run rather than dropped silently.
            skipped.append(p)
            continue
        if not (migrations / pp.name).is_file():
            raise CannotCheck(
                f"git reports this PR adds '{p}', but it is not on disk under "
                f"{MIGRATIONS_DIR}/. The held-back list does not describe this "
                f"working tree, so anything computed from it would be a guess."
            )
        basenames.append(pp.name)

    full_rels, full_fns, _ = declared_relations(migrations)
    base_rels, base_fns, base_files = declared_relations(
        migrations, exclude=frozenset(basenames)
    )
    if base_files and len(base_rels) < MIN_DECLARED:
        raise CannotCheck(
            f"the merge-base parse yielded {len(base_rels)} relations across "
            f"{base_files} file(s), below the {MIN_DECLARED} floor. Either the "
            f"exclusion removed most of the tree or the SQL patterns rotted; "
            f"either way every object would look like this PR introduced it."
        )
    return full_rels - base_rels, full_fns - base_fns, sorted(basenames), skipped


def introduced_by_this_pr(
    repo: pathlib.Path, base: str
) -> tuple[set[str], set[str], list[str], list[str]]:
    """Same, but the file list comes from git via the sibling ADR 0092 helper.

    Reused rather than reimplemented on purpose. `Fresh database equals remote`
    and this check must agree on what "added by this PR" means; two
    implementations of that would drift, and a guard that disagrees with its
    own sibling teaches people to believe neither. The helper already carries
    the three-dot / `--diff-filter=A` reasoning and its own self-test.
    """
    import importlib.util  # noqa: PLC0415  (only the --base arm needs it)

    path = repo / "scripts" / "parity_migrations_added_by_pr.py"
    if not path.is_file():
        raise CannotCheck(
            f"{path} is missing. --base has nothing to compute the held-back "
            f"list with, and guessing 'this PR added nothing' would silently "
            f"restore the block this flag exists to remove."
        )
    spec = importlib.util.spec_from_file_location("parity_migrations_added_by_pr", path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise CannotCheck(f"cannot load {path} as a module")
    helper = importlib.util.module_from_spec(spec)
    sys.modules["parity_migrations_added_by_pr"] = helper
    spec.loader.exec_module(helper)

    try:
        added = helper.added_migrations(base, "HEAD", cwd=repo)
    except helper.CannotCheck as exc:
        raise CannotCheck(str(exc)) from exc

    return introduced_relations(repo / MIGRATIONS_DIR, added)


def classify_absences(
    queried: set[str],
    present: set[str],
    known: dict[str, str],
    introduced: set[str],
) -> tuple[list[str], list[str], list[str]]:
    """Split "the code calls it, production lacks it" three ways.

    Returns (known_debt, introduced_by_this_pr, unexplained). Only the third
    fails the build.

    Debt takes precedence over introduced: an entry that is on the debt list AND
    declared by a migration this PR adds is debt being REPAID, and the C - L
    ratchet already fails that with "delete the entry".

    `introduced` is empty on every push and schedule run, and this then reduces
    to exactly the two-way split that was here before -- same inputs, same
    verdict, no new leniency on main.
    """
    absent = sorted(t for t in queried if t not in present)
    debt = [t for t in absent if t in known]
    intro = [t for t in absent if t not in known and t in introduced]
    unexplained = [t for t in absent if t not in known and t not in introduced]
    return debt, intro, unexplained


# ---------------------------------------------------------------------------
# What production actually has
# ---------------------------------------------------------------------------
def production_relations(repo: pathlib.Path) -> tuple[set[str], set[str]]:
    """Read information_schema over the connection schema-parity.yml already holds.

    READ-ONLY. Never prints the DSN: it carries credentials.
    """
    try:
        import psycopg2  # noqa: PLC0415  (optional: only the production arm needs it)
    except ImportError:
        print("FAIL (exit 2): --against-production needs psycopg2 (pip install psycopg2-binary).")
        raise SystemExit(2) from None

    dsn = (
        os.environ.get("SUPABASE_DB_URL")
        or os.environ.get("SUPABASE_POOLER_URL")
        or os.environ.get("SUPABASE_POOLER_CONNECTION_STRING")
        or os.environ.get("SUPABASE_DIRECT_CONNECTION_STRING")
    )
    if not dsn:
        env = repo / ".env"
        if env.is_file():
            for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
                for key in (
                    "SUPABASE_POOLER_URL",
                    "SUPABASE_POOLER_CONNECTION_STRING",
                    "SUPABASE_DIRECT_CONNECTION_STRING",
                ):
                    if line.startswith(key + "="):
                        dsn = line.split("=", 1)[1].strip().strip('"')
                        break
                if dsn:
                    break
    if not dsn:
        print("FAIL (exit 2): no database connection string for --against-production.")
        print("   Set SUPABASE_POOLER_URL. See scripts/check_db_reachable.sh.")
        raise SystemExit(2)

    conn = psycopg2.connect(dsn)
    try:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
            )
            rels = {r[0].lower() for r in cur.fetchall()}
            cur.execute(
                "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
                "WHERE n.nspname='public'"
            )
            fns = {r[0].lower() for r in cur.fetchall()}
    finally:
        conn.close()
    return rels, fns


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def report_missing(
    label: str,
    queried: set[str],
    declared: set[str],
    known: dict[str, str],
    ex: Extraction,
    kind: str,
) -> int:
    fail = 0
    missing = sorted(t for t in queried if t not in declared)
    new = [t for t in missing if t not in known]
    debt = [t for t in missing if t in known]

    print()
    print(
        f"== {label}: {len(queried)} queried, {len(missing)} not declared "
        f"({len(debt)} known debt, {len(new)} NEW)"
    )

    if debt:
        print()
        print("   KNOWN DEBT -- broken today, tracked, not approved:")
        # One line each. The full reason lives next to the entry in KNOWN_MISSING;
        # reprinting it on every green run is how a log trains people to skip it.
        # NEW findings below get the full per-call-site treatment instead.
        for t in debt:
            sites = [s for s in ex.sites if s.resolved == t and s.kind == kind]
            first = f"{sites[0].path}:{sites[0].line}" if sites else "?"
            more = f" (+{len(sites) - 1} more)" if len(sites) > 1 else ""
            print(f"     {t:32s} {known[t].split(']')[0] + ']':14s} {first}{more}")

    if new:
        fail = 1
        print()
        print(
            f"FAIL: the code queries {len(new)} {label} that no migration in "
            f"{MIGRATIONS_DIR} defines:"
        )
        for t in new:
            print(f"     {t}")
            for s in ex.sites:
                if s.resolved == t and s.kind == kind:
                    print(f"       {s.path}:{s.line}")
        print()
        print("   -> Write the migration. If one already exists in an archive directory,")
        print("      that is the defect this guard exists for: move it (with a new version")
        print("      past everything on main) into supabase/migrations/ and push it.")
        print("   -> Do NOT add it to KNOWN_MISSING. That list records what was already")
        print("      broken when the guard landed; it is not a way to keep adding to it.")

    # Ratchet, direction 2: an entry that is now satisfied.
    for t in known:
        if t in declared:
            fail = 1
            print()
            print(f"FAIL: '{t}' is on the debt list but {MIGRATIONS_DIR} now declares it.")
            print("   -> Delete the entry. A fixed relation left on the list is a hole the")
            print("      guard will happily ignore the next time someone deletes the migration.")
        elif t not in queried:
            fail = 1
            print()
            print(f"FAIL: '{t}' is on the debt list but no code queries it any more.")
            print("   -> Delete the entry. The list must describe what is actually true;")
            print("      an entry the guard never matches is one nobody notices is wrong.")
    return fail


# ---------------------------------------------------------------------------
# --self-test -- prove the merge-awareness can go RED before trusting it green
#
# Two rules this suite obeys, both learned the hard way in this repo:
#
#   1. EVERY case must ASSERT, not merely run. ADR 0073: a self-test that
#      reports "cannot check" for every case is a failing self-test wearing a
#      green exit code.
#   2. It NEVER borrows KNOWN_MISSING to excuse its own fixture. ADR 0065: a
#      fixture that reaches into the live debt list passes because the debt
#      list is long, not because the logic is right, and it silently stops
#      asserting the day the list is pruned. Every debt dict below is
#      synthetic, and an EMPTY one is asserted to be a legal state -- because
#      KNOWN_MISSING_FUNCTIONS is empty today and the end state of a
#      shrink-only list is empty.
#
# The decision cases run in-process against a pure function, so each one is
# proven in BOTH directions: PR mode and push mode, from the same input.
# ---------------------------------------------------------------------------
SELFTEST_TABLES_PER_FILE = 6
SELFTEST_BASE_FILES = 40


def _seed_migrations(mig: pathlib.Path) -> None:
    """A migrations directory big enough to clear both floors, so the floors
    themselves stay live rather than being what the fixture trips on."""
    mig.mkdir(parents=True, exist_ok=True)
    for i in range(SELFTEST_BASE_FILES):
        stmts = "\n".join(
            f"create table public.base_{i:03d}_{j} (id uuid primary key);"
            for j in range(SELFTEST_TABLES_PER_FILE)
        )
        (mig / f"2026010100{i:04d}_base.sql").write_text(stmts + "\n", encoding="utf-8")


def self_test() -> int:  # noqa: PLR0915  (a flat list of cases reads better here)
    import shutil  # noqa: PLC0415
    import subprocess  # noqa: PLC0415
    import tempfile  # noqa: PLC0415

    failures: list[str] = []

    def check(name: str, cond: bool, detail: str = "") -> None:
        if cond:
            print(f"   ok    {name}")
        else:
            failures.append(name)
            print(f"   FAIL  {name}{(' — ' + detail) if detail else ''}")

    def run(cwd: pathlib.Path, *args: str) -> None:
        subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True)

    # -- A. the decision itself, both directions from one input ---------------
    print("\n== A. the three-way split (pure function, synthetic debt only)")

    # 1/2. THE defect and its control. Identical inputs; the only difference is
    #      whether this PR introduces the object. PR mode must exempt it, push
    #      mode must still fail it. Case 2 is what makes case 1 evidence.
    _d, intro, unex = classify_absences({"stock_counts"}, set(), {}, {"stock_counts"})
    check(
        "PR mode: an object this PR's migration declares is not a failure",
        (intro, unex) == (["stock_counts"], []),
        f"intro={intro} unexplained={unex}",
    )
    _d, intro, unex = classify_absences({"stock_counts"}, set(), {}, set())
    check(
        "push mode: the SAME object still fails (the exemption is not global)",
        (intro, unex) == ([], ["stock_counts"]),
        f"intro={intro} unexplained={unex}",
    )

    # 3. The ratchet. An object no migration declares can never be in the
    #    introduced set, so it fails either way. Asserted in both modes.
    _d, _i, unex_pr = classify_absences(
        {"ghost_table"}, set(), {}, {"stock_counts"}
    )
    _d, _i, unex_push = classify_absences({"ghost_table"}, set(), {}, set())
    check(
        "an object NO migration declares fails in BOTH modes",
        unex_pr == ["ghost_table"] and unex_push == ["ghost_table"],
        f"pr={unex_pr} push={unex_push}",
    )

    # 4/5. Debt is classed as debt -- with a SYNTHETIC entry, never a live one --
    #      and the case is proven discriminating by removing the entry.
    synthetic = {"fixture_only_debt": "[synthetic] exists solely for this self-test"}
    debt, _i, unex = classify_absences({"fixture_only_debt"}, set(), synthetic, set())
    check(
        "a synthetic debt entry is classed as debt, not as a new failure",
        (debt, unex) == (["fixture_only_debt"], []),
        f"debt={debt} unexplained={unex}",
    )
    debt, _i, unex = classify_absences({"fixture_only_debt"}, set(), {}, set())
    check(
        "and that case is discriminating (drop the entry and it fails)",
        (debt, unex) == ([], ["fixture_only_debt"]),
        f"debt={debt} unexplained={unex}",
    )

    # 6/7. An EMPTY debt list is legal -- KNOWN_MISSING_FUNCTIONS is empty today
    #      -- but empty must not mean "nothing is ever checked".
    debt, intro, unex = classify_absences({"t"}, {"t"}, {}, set())
    check(
        "an EMPTY debt list is a legal state (nothing absent -> nothing to report)",
        (debt, intro, unex) == ([], [], []),
        f"{debt} {intro} {unex}",
    )
    _d, _i, unex = classify_absences({"t"}, set(), {}, set())
    check(
        "and an empty debt list is not a free pass (an absence still fails)",
        unex == ["t"],
        f"unexplained={unex}",
    )

    # 8. Debt outranks introduced: a PR that repays debt is still reported as
    #    debt, and the C - L ratchet is what tells the author to prune the line.
    debt, intro, unex = classify_absences({"x"}, set(), {"x": "[synthetic]"}, {"x"})
    check(
        "debt outranks introduced-by-this-PR (the ratchet keeps the prune)",
        (debt, intro, unex) == (["x"], [], []),
        f"{debt} {intro} {unex}",
    )

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="cqte-selftest-"))
    try:
        # -- B. the SQL replay: full minus base ---------------------------------
        print("\n== B. what the added migration files introduce (real SQL replay)")
        b = tmp / "sql"
        mig = b / MIGRATIONS_DIR
        _seed_migrations(mig)
        (mig / "20260902190000_pr.sql").write_text(
            "create table public.pr_only_table (id uuid primary key);\n"
            "create or replace function public.record_stock_count(p uuid) "
            "returns void as $$ begin end $$ language plpgsql;\n",
            encoding="utf-8",
        )
        full_rels, full_fns, nfiles = declared_relations(mig)
        check(
            "the fixture parses (non-vacuity of everything in section B)",
            "pr_only_table" in full_rels
            and "record_stock_count" in full_fns
            and nfiles == SELFTEST_BASE_FILES + 1,
            f"{len(full_rels)} rels, {len(full_fns)} fns, {nfiles} files",
        )
        rels, fns, used, skipped = introduced_relations(
            mig, [f"{MIGRATIONS_DIR}/20260902190000_pr.sql"]
        )
        check(
            "excluding the added file makes its objects 'introduced by this PR'",
            rels == {"pr_only_table"} and fns == {"record_stock_count"} and skipped == [],
            f"rels={sorted(rels)} fns={sorted(fns)} used={used}",
        )
        rels0, fns0, _u, _s = introduced_relations(mig, [])
        check(
            "and that is discriminating: adding nothing introduces nothing",
            rels0 == set() and fns0 == set(),
            f"rels={sorted(rels0)} fns={sorted(fns0)}",
        )

        # An ALTER-only migration exempts nothing. This is the case that keeps
        # "my PR touches migrations" from becoming a blanket excuse.
        b2 = tmp / "alter-only"
        mig2 = b2 / MIGRATIONS_DIR
        _seed_migrations(mig2)
        (mig2 / "20260902190000_pr.sql").write_text(
            "alter table public.base_000_0 add column note text;\n", encoding="utf-8"
        )
        rels, fns, _u, _s = introduced_relations(
            mig2, [f"{MIGRATIONS_DIR}/20260902190000_pr.sql"]
        )
        check(
            "an ALTER-only migration introduces nothing (no blanket excuse)",
            rels == set() and fns == set(),
            f"rels={sorted(rels)} fns={sorted(fns)}",
        )

        # A PR that DROPs a table must not "introduce" it. full - base is
        # negative there, and a set difference correctly yields nothing.
        b3 = tmp / "drops"
        mig3 = b3 / MIGRATIONS_DIR
        _seed_migrations(mig3)
        (mig3 / "20260902190000_pr.sql").write_text(
            "drop table public.base_000_0;\n", encoding="utf-8"
        )
        rels, _f, _u, _s = introduced_relations(
            mig3, [f"{MIGRATIONS_DIR}/20260902190000_pr.sql"]
        )
        check(
            "a PR that DROPs a relation does not 'introduce' it",
            "base_000_0" not in rels and rels == set(),
            f"rels={sorted(rels)}",
        )

        # A nested seed/ file is skipped rather than fatal, and exempts nothing.
        rels, _f, used, skipped = introduced_relations(
            mig, [f"{MIGRATIONS_DIR}/seed/010_rows.sql"]
        )
        check(
            "a nested seed/ path exempts nothing and is reported, not fatal",
            rels == set() and used == [] and skipped == [f"{MIGRATIONS_DIR}/seed/010_rows.sql"],
            f"rels={sorted(rels)} used={used} skipped={skipped}",
        )

        # -- C. CANNOT CHECK is exit 2, never a quiet answer --------------------
        print("\n== C. a partial view refuses (exit 2), never answers 'nothing added'")

        raised = False
        try:
            introduced_relations(mig, [f"{MIGRATIONS_DIR}/20990101000000_not_on_disk.sql"])
        except CannotCheck:
            raised = True
        check(
            "a file git calls added that is not on disk raises (never exempts)",
            raised,
        )

        b4 = tmp / "too-small"
        mig4 = b4 / MIGRATIONS_DIR
        mig4.mkdir(parents=True)
        (mig4 / "0001_tiny.sql").write_text(
            "create table public.only_one (id uuid primary key);\n", encoding="utf-8"
        )
        raised = False
        try:
            introduced_relations(mig4, [])
        except CannotCheck:
            raised = True
        check(
            f"a base parse under the {MIN_DECLARED}-relation floor raises",
            raised,
        )

        # -- D. end to end through git, the PR #243 shape in miniature ----------
        print("\n== D. through real git, using the same helper the parity job uses")
        repo_root = pathlib.Path(__file__).resolve().parent.parent
        helper_src = repo_root / "scripts" / "parity_migrations_added_by_pr.py"
        if not helper_src.is_file():
            check("the ADR 0092 helper this reuses exists", False, str(helper_src))
        else:
            check("the ADR 0092 helper this reuses exists", True)

            g = tmp / "git"
            gmig = g / MIGRATIONS_DIR
            _seed_migrations(gmig)
            (g / "scripts").mkdir(parents=True, exist_ok=True)
            shutil.copy(helper_src, g / "scripts" / helper_src.name)
            run(g, "git", "init", "-q", "-b", "main")
            run(g, "git", "config", "user.email", "selftest@example.invalid")
            run(g, "git", "config", "user.name", "selftest")
            run(g, "git", "add", "-A")
            run(g, "git", "commit", "-qm", "base")

            # docs-only branch: nothing introduced, and the exemption is empty
            # rather than the whole tree.
            run(g, "git", "checkout", "-qb", "docs-only")
            (g / "README.md").write_text("docs\n", encoding="utf-8")
            run(g, "git", "add", "-A")
            run(g, "git", "commit", "-qm", "docs")
            rels, fns, used, _s = introduced_by_this_pr(g, "main")
            check(
                "a branch adding no migration exempts NOTHING",
                (rels, fns, used) == (set(), set(), []),
                f"rels={sorted(rels)} fns={sorted(fns)} used={used}",
            )

            # the PR #243 shape: the call and the migration land together.
            run(g, "git", "checkout", "-q", "main")
            run(g, "git", "checkout", "-qb", "feat/stock-counts-are-records")
            (gmig / "20260902190000_a_count_is_a_record.sql").write_text(
                "create table public.stock_counts (id uuid primary key);\n"
                "create or replace function public.record_stock_count(p uuid) "
                "returns void as $$ begin end $$ language plpgsql;\n",
                encoding="utf-8",
            )
            run(g, "git", "add", "-A")
            run(g, "git", "commit", "-qm", "a count is a record")
            rels, fns, used, _s = introduced_by_this_pr(g, "main")
            check(
                "the PR #243 shape: record_stock_count is introduced by this PR",
                "record_stock_count" in fns and "stock_counts" in rels and len(used) == 1,
                f"rels={sorted(rels)} fns={sorted(fns)} used={used}",
            )
            # and the verdict flips with the mode, on the same fixture.
            _d, intro, unex = classify_absences({"stock_counts"}, set(), {}, rels)
            check(
                "…so PR mode exempts it while push mode (empty set) fails it",
                intro == ["stock_counts"]
                and classify_absences({"stock_counts"}, set(), {}, set())[2]
                == ["stock_counts"],
                f"intro={intro} unexplained={unex}",
            )

            # THE SHAPE CI ACTUALLY CHECKS OUT. actions/checkout on a
            # pull_request gives `refs/pull/N/merge` -- a MERGE COMMIT of the
            # branch into the base -- not the branch head. Every case above
            # runs on a branch head, so without this the suite would be green
            # while proving nothing about the tree the job really sees.
            #
            # Three-dot still holds: merge-base(main, merge-commit) is main's
            # tip, because main is one of the merge commit's parents.
            run(g, "git", "checkout", "-q", "main")
            run(g, "git", "merge", "--no-ff", "-q", "-m", "pr/merge",
                "feat/stock-counts-are-records")
            merge_parents = subprocess.run(
                ["git", "log", "-1", "--format=%P", "HEAD"],
                cwd=g, check=True, capture_output=True, text=True,
            ).stdout.split()
            rels, fns, used, _s = introduced_by_this_pr(g, "main~1")
            check(
                "on a MERGE COMMIT (the shape CI checks out) the answer is the same",
                len(merge_parents) == 2
                and "record_stock_count" in fns
                and "stock_counts" in rels
                and len(used) == 1,
                f"parents={len(merge_parents)} rels={sorted(rels)} "
                f"fns={sorted(fns)} used={used}",
            )
            run(g, "git", "reset", "-q", "--hard", "HEAD~1")

            # a MODIFIED migration exempts nothing -- the property ADR 0092's
            # helper owns, re-asserted here because THIS guard depends on it.
            run(g, "git", "checkout", "-q", "main")
            run(g, "git", "checkout", "-qb", "edits-an-applied-migration")
            victim = sorted(gmig.glob("2026010100*_base.sql"))[0]
            victim.write_text(
                "create table public.base_000_0 (id uuid primary key);\n"
                "create table public.sneaked_in_by_edit (id uuid primary key);\n",
                encoding="utf-8",
            )
            run(g, "git", "add", "-A")
            run(g, "git", "commit", "-qm", "edit an applied migration")
            rels, _f, used, _s = introduced_by_this_pr(g, "main")
            check(
                "a MODIFIED migration exempts nothing, even for what it adds",
                "sneaked_in_by_edit" not in rels and used == [],
                f"rels={sorted(rels)} used={used}",
            )

            raised = False
            try:
                introduced_by_this_pr(g, "no-such-base")
            except CannotCheck:
                raised = True
            check("an unresolvable base raises rather than exempting nothing", raised)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"SELF-TEST FAILED — {len(failures)} case(s): {', '.join(failures)}")
        return 1
    print("SELF-TEST PASSED — the exemption applies only to what THIS PR's added")
    print("                   migrations declare, disappears on push, and cannot")
    print("                   cover an object no migration declares at all.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--against-production",
        action="store_true",
        help="also compare the code's relations against live production",
    )
    ap.add_argument(
        "--base",
        metavar="REF",
        help=(
            "the ref this pull request merges into, e.g. origin/main. Objects "
            "production lacks that a migration ADDED BY THIS PR declares are "
            "then expected rather than failures. Omit it on push/schedule: "
            "that is the strict run and nothing is exempt."
        ),
    )
    ap.add_argument(
        "--list-dynamic",
        action="store_true",
        help="print every call site whose table name could not be resolved",
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the merge-awareness can go red before trusting it green",
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    repo = pathlib.Path(__file__).resolve().parent.parent
    blocked: list[str] = []
    fail = 0

    ex = extract(repo)

    print("== Call sites")
    for root, n in ex.per_root.items():
        if n == -1:
            print(f"   {root:34s} ROOT MISSING")
            blocked.append(
                f"scanned root '{root}' does not exist -- the tree moved, or this ran "
                f"from the wrong place"
            )
        else:
            print(f"   {root:34s} {n:5d}")
    total = len(ex.sites)
    resolved_sites = [s for s in ex.sites if s.resolved]
    via_const = [s for s in resolved_sites if s.via_const]
    dyn = ex.dynamic_sites()
    print(
        f"   {'TOTAL':34s} {total:5d}  "
        f"({len(resolved_sites)} resolved, {len(via_const)} of them through a const, "
        f"{len(dyn)} NOT STATICALLY RESOLVABLE)"
    )

    for root, n in ex.per_root.items():
        if n == 0 and ex.roots_with_client.get(root):
            blocked.append(
                f"'{root}' imports a supabase client but yielded zero call sites. "
                f"The extraction pattern has rotted, or the client is used through a "
                f"wrapper this guard cannot see."
            )

    tables = ex.tables()
    functions = ex.functions()
    print(f"   {len(tables)} distinct relations, {len(functions)} distinct rpc functions")

    # --- the blind spot, always printed, never silent -----------------------
    print()
    print("== Blind spot (table name not statically resolvable)")
    print(f"   {len(dyn)} call site(s); ceiling is {DYNAMIC_CEILING}")
    by_file: dict[str, int] = {}
    for s in dyn:
        by_file[s.path] = by_file.get(s.path, 0) + 1
    for path, n in sorted(by_file.items(), key=lambda kv: -kv[1])[:10]:
        print(f"     {n:4d}  {path}")
    if len(by_file) > 10:
        print(f"     ...  and {len(by_file) - 10} more file(s)")
    if args.list_dynamic:
        for s in dyn:
            print(f"     {s.path}:{s.line}  .{'rpc' if s.kind == 'rpc' else 'from'}({s.raw})")
    if len(dyn) > DYNAMIC_CEILING:
        fail = 1
        print()
        print(f"FAIL: the unresolvable set grew from {DYNAMIC_CEILING} to {len(dyn)}.")
        print('   -> Prefer a string literal, or a module-level `const NAME = "table"`,')
        print("      which this guard does resolve.")
        print("   -> If it genuinely cannot be static (a repository keyed on self.table_name),")
        print("      raise DYNAMIC_CEILING and say in the comment which site was added and why.")
        print("      Raising it silently is how a guard stops covering a third of its input.")

    # --- C - L ---------------------------------------------------------------
    migrations = repo / MIGRATIONS_DIR
    if not migrations.is_dir():
        blocked.append(f"'{MIGRATIONS_DIR}' does not exist -- there is nothing to check against")
        declared, declared_fns, nfiles = set(), set(), 0
    else:
        declared, declared_fns, nfiles = declared_relations(migrations)
    print()
    print(
        f"== {MIGRATIONS_DIR} declares {len(declared)} relations and {len(declared_fns)} "
        f"functions across {nfiles} file(s)"
    )
    if nfiles and len(declared) < MIN_DECLARED:
        blocked.append(
            f"only {len(declared)} relations parsed out of {nfiles} migration file(s), "
            f"below the {MIN_DECLARED} floor. The SQL patterns have rotted; every table "
            f"would look missing."
        )

    # --- what THIS pull request introduces, if we were told the base ---------
    #
    # Printed on EVERY run including the push shape, so "nothing was exempt" is
    # a stated measurement rather than an absence nobody looked for. This is the
    # fault class the repo keeps finding: a check that reports absence as health.
    pr_rels: set[str] = set()
    pr_fns: set[str] = set()
    print()
    if args.base:
        try:
            pr_rels, pr_fns, pr_files, pr_skipped = introduced_by_this_pr(repo, args.base)
        except CannotCheck as exc:
            print(f"== merge-aware mode against '{args.base}': CANNOT CHECK")
            print(f"   {exc}")
            blocked.append(f"--base '{args.base}': {exc}")
            pr_files, pr_skipped = [], []
        else:
            print(
                f"== merge-aware: this PR adds {len(pr_files)} migration file(s) "
                f"vs '{args.base}', declaring {len(pr_rels)} new relation(s) and "
                f"{len(pr_fns)} new function(s)"
            )
            for f in pr_files:
                print(f"     {f}")
            for t in sorted(pr_rels):
                print(f"       introduces relation  {t}")
            for t in sorted(pr_fns):
                print(f"       introduces function  {t}()")
            for p in pr_skipped:
                print(f"     (not a top-level .sql migration, exempts nothing: {p})")
            if not pr_files:
                print("   This PR adds no migration, so NOTHING is exempt below —")
                print("   the production comparison is as strict as it is on main.")
    else:
        print("== merge-aware mode NOT ACTIVE (no --base): the push/schedule shape.")
        print("   Nothing is exempt. Production and main are meant to be in lockstep,")
        print("   so an object production lacks is failing at runtime right now.")

    fail |= report_missing("relations", tables, declared, KNOWN_MISSING, ex, "table")
    fail |= report_missing(
        "rpc functions", functions, declared_fns, KNOWN_MISSING_FUNCTIONS, ex, "rpc"
    )

    # --- C - R ---------------------------------------------------------------
    if args.against_production:
        prod_rels, prod_fns = production_relations(repo)
        print()
        print(f"== production has {len(prod_rels)} relations and {len(prod_fns)} functions")
        if not prod_rels:
            blocked.append(
                "production reported zero relations -- that is a connection or "
                "permission problem, not an empty database"
            )
        extra_local = sorted(t for t in declared if t not in prod_rels)

        rel_debt, rel_pr, new_prod = classify_absences(
            tables, prod_rels, KNOWN_MISSING, pr_rels
        )
        fn_debt, fn_pr, new_prod_fns = classify_absences(
            functions, prod_fns, KNOWN_MISSING_FUNCTIONS, pr_fns
        )
        debt_prod = rel_debt + [f + "()" for f in fn_debt]

        # The exemption, always itemised. An exempt object is not an object
        # nobody looked at: it is one whose absence was EXPLAINED, and the
        # explanation is printed so a wrong one can be seen.
        if rel_pr or fn_pr:
            print()
            print(
                f"   {len(rel_pr) + len(fn_pr)} object(s) production lacks are "
                f"declared by a migration THIS PR ADDS. Expected, not a defect:"
            )
            for t in rel_pr:
                print(f"     {t}")
            for f in fn_pr:
                print(f"     {f}()  [rpc]")
            print("   They land together on merge. Neither the code nor the migration")
            print("   is deployed today, so 'production lacks it' is not a defect yet.")
            print("   On the next push to main this exemption is gone and they must exist.")

        if debt_prod:
            print()
            print(
                f"   {len(debt_prod)} known-debt entr(ies) confirmed absent from production. "
                f"These fail at runtime today:"
            )
            for t in debt_prod:
                print(f"     {t}")

        if new_prod or new_prod_fns:
            fail = 1
            print()
            print(
                f"FAIL: {len(new_prod)} relation(s) and {len(new_prod_fns)} function(s) the code "
                f"calls do not exist in PRODUCTION, and are not known debt:"
            )
            for t in new_prod:
                extra = "  (migrations DO define it -- never pushed)" if t in declared else ""
                print(f"     {t}{extra}")
            for f in new_prod_fns:
                extra = "  (migrations DO define it -- never pushed)" if f in declared_fns else ""
                print(f"     {f}()  [rpc]{extra}")
            print("   -> Every call against these fails at runtime, right now.")
            print("   -> If migrations define it, this is an unpushed migration: supabase db push.")
            if args.base:
                print("   -> This run WAS merge-aware, so none of the above is explained by a")
                print(f"      migration this PR adds against '{args.base}'. Either the migration")
                print("      is MODIFIED rather than added (which exempts nothing, by design),")
                print("      or no migration declares the object at all.")
            else:
                print("   -> This run was NOT merge-aware (no --base). On a pull request that")
                print("      adds the migration alongside the call, pass --base origin/<base>.")

        # The disagreement that IS the defect class: declared in the wrong place,
        # yet present in production because someone applied it by another route.
        # A rebuild loses these, and nothing else in CI says so.
        applied_but_undeclared = sorted(t for t in tables if t in prod_rels and t not in declared)
        if applied_but_undeclared:
            print()
            print(
                f"   MIGRATIONS AND PRODUCTION DISAGREE on {len(applied_but_undeclared)} "
                f"relation(s) the code queries:"
            )
            print("   present in production, defined by no migration in the live directory.")
            print("   They work today and would vanish from a database rebuilt from the repo.")
            for t in applied_but_undeclared:
                print(f"     {t}")

        if extra_local:
            print()
            print(f"   NOTE: {len(extra_local)} relation(s) declared by migrations are absent from")
            print("         production -- an unpushed migration. Not failed here; that is")
            print("         scripts/check_schema_parity.sh's job. Listed so the two do not")
            print("         disagree silently:")
            for t in extra_local[:20]:
                print(f"           {t}")
            if len(extra_local) > 20:
                print(f"           ... and {len(extra_local) - 20} more")
    else:
        print()
        print("== production arm NOT RUN (no --against-production).")
        print("   This run proves only that migrations DECLARE what the code queries.")
        print("   Whether production was ever given them is a different question, and")
        print("   schema-parity.yml is where it has the secret to ask it.")

    # --- verdict -------------------------------------------------------------
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
        print("FAIL (exit 1) -- the code queries something the schema does not define.")
        return 1
    print(f"PASS -- every relation the code queries is declared by {MIGRATIONS_DIR},")
    print(f"       or is on the shrink-only debt list ({len(KNOWN_MISSING)} entries).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
