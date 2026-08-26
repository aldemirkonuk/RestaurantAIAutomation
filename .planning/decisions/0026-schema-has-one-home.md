---
type: adr
id: 0026
title: Schema has one home, and CI compares it against the code
status: proposed
updated: 2026-08-26
links: ["[[0013-migration-ledger-reconciliation]]", "[[OPEN-DECISIONS]]", "[[HANDOFF-schema-guard]]"]
---

# 0026 — Schema has one home, and CI compares it against the code

- **Status:** Proposed
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — not yet locked
- **Keywords:** schema drift, migrations, migrations_archive, baseline_from_production, PGRST205, schema-parity, guard, ratchet, dynamic table names
- **Links:** [HANDOFF-schema-guard](../04-specs/HANDOFF-schema-guard.md),
  `scripts/check_queried_tables_exist.py`, `scripts/check_migrations_single_home.py`,
  `.github/workflows/ci.yml` (`schema-code-parity`),
  `.github/workflows/schema-parity.yml`, `supabase/SCHEMA_DRIFT.md`

> **Number.** 0024 is the highest ADR anywhere in this repository or any of the
> eleven concurrent worktrees, checked 2026-08-26. This takes **0026**, leaving
> 0025 as a gap. Three numbering collisions happened today — 0022 twice, OD-90
> twice — every one of them because concurrent sessions each took "the next free
> number" from the same trunk. CLAUDE.md §5b: prefer a gap over a collision.

## Context

Five instances of one defect were found on 2026-08-26. The shape is identical in
each: a migration that `CREATE`s a table lives **outside `supabase/migrations/`**
— in `supabase/migrations_archive/` or `services/database/migrations_archive/`,
directories `supabase db push` has never read. The migration was written,
reviewed, committed, and never applied. Production silently lacks the table. The
code queries it anyway. PostgREST answers `PGRST205`, the caller falls back to a
default or swallows the error, and nothing goes red.

| Table | Queried by | Consequence |
|---|---|---|
| `restaurant_feature_flags` | settings service | Production had the 7-column EAV table, not the 22-column one. Every toggle inert at the database, and `enable_ai_negotiation` could never be turned OFF — the failed read fell back to "enabled". |
| `scheduled_reports` | `reports.service.ts:165,185,208` | Insert and list have failed 100% of the time, silently. |
| `restaurant_inbound_addresses` | inbound-email controller | Exists in production despite being archived. The archive is not a reliable signal in *either* direction. |
| `push_subscriptions` | `recipient-resolver.service.ts:275` | `catch { return [] }` — push notifications resolve zero recipients forever, nothing logged. |
| `integration_oauth_connections` / `_states` | `integrations-oauth.service.ts`, 10 sites | Drive/Excel OAuth completes at Google, then fails on the write. |

### Why `Fresh database equals remote` caught none of them

`schema-parity.yml`'s `parity` job rebuilds a local database from
`supabase/migrations/` and diffs it against production. It is a good job. It
cannot see this defect, for two independent reasons.

**1. It compares a database against a database, and both sides are equally
wrong.** For `scheduled_reports`, `push_subscriptions` and
`integration_oauth_*`: local does not create the table, because the migration is
archived and `db reset` never reads it. Production does not have the table,
because the migration was never applied. The two sides agree. The diff is empty.
**The job is green precisely because both sides are wrong in the same way.** For
`restaurant_feature_flags` and `restaurant_inbound_addresses` the agreement is
even tighter — both sides have the table, in the same shape, and that shape is
simply not the one the application was written against.

**2. It has no notion of application code at all.** Its universe is tables,
columns and functions on two database instances. "Does anything actually SELECT
this" is not a question it is able to ask. Nothing in CI was asking it.

**`20260805000000_baseline_from_production.sql` is why that blindness is total
rather than partial.** The baseline is a `pg_dump` of production as it stood on
2026-08-05 — 172 tables, taken because reconstructing the schema from the
migration files was no longer possible (`supabase/SCHEMA_DRIFT.md`). It was the
right call. But it converted production-as-it-was into the repository's
definition of what *should* exist, so every migration not yet applied on that
date vanished from the repo's own idea of the schema. After the baseline, local
and remote were identical **by construction**, and the parity check has been
faithfully reporting that identity ever since. An unapplied migration stopped
being a drift signal and became no signal at all.

Two smaller reasons, worth recording because they bound how much any
database-comparing job can ever be relied on: `parity` is skipped on fork pull
requests by design (no secret, and a vacuously green check is worse than none),
and on 2026-08-26 it failed on a GitHub API rate limit while installing the
Supabase CLI — a failure indistinguishable at a glance from drift.

### The real cause: six homes for SQL

Measured 2026-08-26. **136 `.sql` files sit outside `supabase/migrations/`**, in
six places, of which exactly one is wired to anything:

| Location | Files | Applied by anything? |
|---|---|---|
| `supabase/migrations/` | 72 | Yes — `supabase db push` |
| `supabase/migrations_archive/` | 105 | No |
| `services/database/migrations_archive/` | 16 | No |
| `Supabase_SQL_Files/` | 8 | No — named `SQL_editor1..6`, DDL pasted into the Supabase SQL editor and committed afterwards |
| `md/02-architecture/` (+ `migrations/`) | 4 | No |
| `md_files/02-architecture/` | 1 | No |

`Supabase_SQL_Files/` is the mechanism that produced the 27 ghost tables, 403
ghost columns and 13 ghost functions the baseline had to absorb. It is still
there, and until today nothing stopped a seventh directory appearing.

## Options considered

1. **Do nothing; fix the five instances.** Costs nothing today and loses in a
   month. Each of the five arrived the same way, over six months, and the sixth
   is already being written. Rejected: the brief was to kill the class.

2. **Rebuild a scratch database from `supabase/migrations/` and query
   `information_schema` for the truth.** Highest fidelity — it models `ALTER`,
   `RENAME`, `DROP` and dependency order exactly, and cannot be fooled by SQL a
   regex misreads. Costs a Docker + `supabase start` + `db reset` cycle on every
   pull request, which is the slowest and flakiest thing in this repository's CI
   (it is the job that failed today on a rate limit). Rejected as the *primary*
   source: the check that must run on every PR has to be cheap and hermetic, or
   it will be made `continue-on-error` the first week it is inconvenient. The
   existing `parity` job already pays this cost once, nightly, for the
   migrations↔production comparison, and that division stands.

3. **Production via PostgREST or `information_schema` as the only truth.**
   Production is the authority for what *exists* — and the guard uses it, in the
   arm that has the secret. Rejected as the only source because it needs a
   secret CI does not have on fork PRs, because it answers the wrong question on
   its own (`restaurant_inbound_addresses` exists in production and is defined by
   no migration — a rebuild would lose it, and a production-only check calls that
   healthy), and because a guard that cannot run is not a guard.

4. **Static parse of `supabase/migrations/*.sql` for what *should* exist,
   compared against a static extraction of what the code queries — with an
   optional production arm.** Chosen. See below.

5. **Column-level comparison as a blocking check.** Would catch
   `restaurant_feature_flags`, which nothing else here does. Built and measured
   rather than argued about; see *What this does not catch*. Reports today,
   does not block, and the fork is left open for the founder.

6. **A typed schema (`supabase gen types`) checked into the repo, so `.from()`
   arguments are type-checked.** The most complete answer, and the one that
   would make the dynamic-name blind spot a compile error rather than a
   measurement. Rejected for now as a much larger change than the defect
   warrants: it touches 1377 call sites across two languages, and the Python
   half gets nothing from it. Recorded as the thing to revisit if the debt lists
   below stop shrinking.

## Decision

**Schema has exactly one home, `supabase/migrations/`, and CI compares that home
against what the application code actually queries.**

Truth comes from three places, deliberately, because no two of them can find
this defect on their own:

```
C = relations the CODE queries          static extraction over TS + Python
L = relations supabase/migrations/ DECLARES   "what should exist"
R = relations PRODUCTION has            "what exists today"
```

- **`C − L`** — `scripts/check_queried_tables_exist.py`, hermetic, no secret,
  runs on every pull request including forks, in `ci.yml`'s
  `schema-code-parity` job. This is the arm that catches the class.
- **`C − R`** — the same script with `--against-production`, in
  `schema-parity.yml` where the connection secret and the fork guard already
  live. It answers the question the hermetic arm cannot: was production ever
  *given* the migration.
- **`L vs R`** — already `scripts/check_schema_parity.sh`. Not duplicated.
- **The disagreement between `L` and `R` on a relation the code queries** is
  reported explicitly by the production arm, because that disagreement *is* the
  defect class: a table that works today and vanishes from any database rebuilt
  from this repository. `integration_oauth_connections` and `_states` are
  exactly that on 2026-08-26.

**`scripts/check_migrations_single_home.py`** guards the cause. Check 1
inventories every `.sql` outside the one home against
`scripts/sql_outside_migrations.txt`; a new one fails, and so does a listed one
that has been deleted, so the inventory shrinks rather than rots. Check 2 is the
rule the brief asked for: **no file outside `supabase/migrations/` may be the
only definition of a relation the live code queries.** 251 outside definitions
are superseded by the live directory and are silent; 8 are sole definitions, and
those 8 are the defect class.

Both guards are **shrink-only ratchets**, the same posture as
`PY_UNLOGGED_DEBT` in `check_model_calls_logged.sh`: the pre-existing breakage
is recorded so the guards are green on arrival and can therefore block the next
one. An entry that becomes satisfied **fails the build** demanding its own
deletion, in both directions — a fixed relation left on the list is a hole the
guard would ignore forever.

Both exit **2**, not 0, when they cannot check what they claim to: a scanned
root that has moved, a root that imports a Supabase client but yields zero call
sites, or fewer than 150 relations parsed out of the migration directory. This
repository's signature defect is machinery that structurally cannot report
failure, and a guard that goes green because it found nothing to inspect is that
defect in a new place.

### Measured on arrival, 2026-08-26

| | |
|---|---|
| call sites extracted | **1377** across 5 roots |
| distinct relations queried / rpc functions | 171 / 22 |
| relations `supabase/migrations/` declares | 226, across 72 files |
| relations queried but not declared | **14** (`KNOWN_MISSING`) |
| rpc functions called but not declared | **5** (`KNOWN_MISSING_FUNCTIONS`) |
| relations absent from **production** (measured, read-only) | 12 + 5 functions |
| relations in production that no live migration declares | **2** — the `integration_oauth_*` pair |
| `.sql` files outside the one home | **136** |
| relations whose only definition is outside it | **8** (`SOLE_DEFINITION_DEBT`) |
| call sites whose table name is **not statically resolvable** | **24 (1.7%)** |

The 14 fall into three sub-classes, and the difference matters more than the
count. **A** — archived and never applied, absent from production, broken right
now (`scheduled_reports`, `push_subscriptions`, `notification_logs`,
`pos_webhook_logs`, `provider_important_dates`, `provider_ratings`). **B** —
present in production, declared by no live migration; works today, lost on any
rebuild (`integration_oauth_connections`, `integration_oauth_states`). **C** —
defined nowhere in this repository at all: the code queries a table nobody ever
wrote a migration for (`inventory_stock`, `managers`, `provider_digital_twins`,
`reports`, `restaurant_wine_menus`, `wine_library`). Class C was not in the
brief and was not expected; six tables and five RPC functions are called by code
that has never once succeeded.

## What this does not catch

Stated plainly, because a guard whose limits are unstated is worse than no
guard.

**1. Columns — and therefore not the `restaurant_feature_flags` instance.**
Both guards work at relation granularity. That table exists in
`supabase/migrations/` *and* in production; what differed was its shape.
Production is EAV (`flag_name varchar` + `enabled boolean`) and
`services/database/migrations_archive/011_add_restaurant_feature_flags.sql`
declares 22 `enable_*` booleans — two different data models under one name. The
`C − L` arm is silent because the table is declared, and check 2 is silent
because the live directory declares it too. **Of the five instances, the guards
catch three** (`scheduled_reports`, `push_subscriptions`, `integration_oauth_*`);
`restaurant_inbound_addresses` is not a live defect today (declared and present);
and `restaurant_feature_flags` is not caught.

A column-level check *was* built and measured, not argued about. It works:
`restaurant_feature_flags` ranks **first of 26** code-queried tables at **+22
archive-only columns**. An earlier draft of this guard rejected column-level
checking as noise, and that rejection was wrong for an instructive reason — its
probe stopped at the first archive file defining a name, so `011` was never
compared at all, and it counted `UNIQUE(a, b)` as a column named `unique(a,`.
With both bugs fixed the signal is clean. It ships as a **census that reports
and does not block**, because most of the other 25 entries are legitimate
pre-baseline history and a shrink-only list that cannot shrink is a list people
learn to skip. Whether it becomes a blocking ratchet is the founder's call, not
a script's — the fork is in the handoff doc.

**2. Dynamic table names — 24 of 1377 call sites (1.7%), counted, printed on
every run, and ratcheted.** All 24 are in
`services/agent-orchestrator/core/database.py`: `.from(self.table_name)` in a
generic repository, plus a `ContactRepository` that sets `self.table` /
`self.addresses_table`. `DYNAMIC_CEILING` fails the build if that set grows, so
the blind spot cannot expand without someone raising the number in a reviewed
diff.

Resolving them was measured rather than assumed, and deliberately not done.
Behind those 24 sites are 11 distinct table names, reached through
`super().__init__(supabase, "<literal>")`. **Nine of the 11 are already in the
queried set from literal call sites elsewhere, and the two that are not
(`rfq_requests`, `unit_conversions`) are both declared by
`supabase/migrations/`.** The entire blind spot changes no verdict today, and
the resolution logic it would take — reading a second positional argument out of
a `super()` call and assuming that hierarchy's convention — is a per-hierarchy
guess that would report a wrong table name confidently. Measuring the hole and
leaving it open beats plastering it with something that can be wrong in silence.

**3. Raw SQL.** Anything issued as a SQL string rather than through the Supabase
client is invisible to the extraction.

**4. DDL never committed anywhere.** Someone running `ALTER TABLE` in the
Supabase dashboard is caught only by the `--against-production` arm, and only on
runs that have the secret.

**5. Column types and nullability.** The census compares column *name* sets. A
table whose archived and live definitions differ in a type or a `NOT NULL` looks
identical to it.

## Consequences

- **Easier:** the next archived-and-never-applied migration fails a pull request
  the moment code queries it, naming the file and the call sites. A seventh
  directory for SQL cannot appear silently. The 14 + 5 + 8 recorded entries are
  now a worklist with `file:line` citations rather than folklore.
- **Harder:** two shrink-only lists must be pruned when the thing they describe
  is fixed, and the guard *fails the build* to force it. That is intentional and
  it has an immediate consequence: **when the concurrent `push_subscriptions`
  fix and `fix/integration-oauth-tables` merge, this branch's debt entries go
  red and whoever merges second deletes those lines.** That is the handshake,
  not a collision.
- **Given up:** `apps/mobile/src` is scanned and yields zero call sites today.
  It is kept in the list rather than dropped, so that growing a Supabase client
  there becomes a failure instead of a silent gap.
- **Revisit when:** the debt lists stop shrinking for a quarter (the ratchet has
  become decoration — take option 6, generated types); or the column census's
  non-history entries exceed its history entries (make it block); or a class-C
  entry turns out to be a table someone intended to create (then the register,
  not the guard, is what failed).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-26 | — | Created. Proposed, not locked. |
