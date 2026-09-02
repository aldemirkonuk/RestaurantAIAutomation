# 0095 — `Code queries only relations production has` is merge-aware, and both required contexts go back on `main`

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — this is the "fix properly next" half of the fork
  they settled in ADR 0092, which took the unblock now
- **Keywords:** schema parity, branch protection, required status checks, migrations, CI, merge-aware, absence-reported-as-health, ADR 0092, ADR 0072
- **Links:** [[0092-parity-compares-against-what-was-merged]] (the sibling this
  copies, and whose Consequences named this work),
  [[0028-phantom-relations-repoint-or-delete]] (the guard being changed and its
  shrink-only debt list), [[0072-schema-parity-sees-what-it-claims]] (why a
  vacuously green parity check is worse than none),
  [[0085-a-fixture-tests-the-guard-not-the-checkout]],
  [[0065-a-conversation-log-names-real-columns-and-refuses-a-missing-body]] (a
  debt entry whose site name came from the guard's own self-test fixture) and
  [[0073-a-delivery-event-is-closed-by-its-order-id]] (a guard at exit 0 and
  vacuous for the very defect) — the two self-test faults this suite is written
  to avoid

## Context

`scripts/check_queried_tables_exist.py --against-production` compares three
sets: what the code queries (C), what `supabase/migrations/` declares (L), and
what production has (R). The `C - R` arm asks *does production have what the
code calls*, and its `name:` — **Code queries only relations production has** —
is a required status check on `main`.

ADR 0092 fixed exactly this fault in the sibling job and named this one in its
Consequences: *"the sibling required check has the identical fault and is not
repaired by this change… until then it stays off the required list."* This is
that repair.

**The premise is right on a `push` and wrong on a `pull_request`.** Production
and `main` are meant to be in lockstep, so on `main` a call to an object
production lacks IS failing at runtime right now. On a pull request the code is
no more deployed than the migration is — migrations auto-apply on **merge**, and
the two land together. The guard even printed the correct diagnosis,
`(migrations DO define it -- never pushed)`, and exited 1 underneath it.

### Measured, 2026-09-02

PR #243 (`feat/stock-counts-are-records`, merged `0209c23a`) added
`record_stock_count` together with `20260902190000_a_count_is_a_record.sql`,
which creates it. This guard failed with *"1 function(s) the code calls do not
exist in PRODUCTION"*. Because the job is a required context, no state the
author could reach turned it green: the only exits were an admin bypass or
hand-applying the migration to production first — and hand-applying manufactures
the `schema_migrations.version` mismatch that cost two sessions an hour the same
morning (see [[schema-parity-drift-diagnosis]]).

Both required contexts were removed from `main` that day so migration-bearing
PRs could land. §"Branch protection" below is how they come back.

## Decision

**On a pull request, an object production lacks is not a failure when a
migration ADDED BY THIS PR declares it. On a push to `main`, nothing changes.**

Concretely, `--base <ref>`:

1. `scripts/parity_migrations_added_by_pr.py` — **the same helper ADR 0092's
   job uses**, loaded by path, not reimplemented — lists the migration files
   this PR adds (three-dot, `--diff-filter=A`).
2. The migration directory is parsed a **second** time with those files
   excluded. That is the merge-base view.
3. `introduced = declared(full) - declared(base)`.
4. An absence from production is classed *known debt* → *introduced by this PR*
   → *unexplained*, in that order. Only the third fails.

Replaying the whole directory twice rather than reading `CREATE` statements out
of the added files is deliberate: `DROP` and `RENAME` are order-dependent, so
"what this PR introduces" is a set difference computed by the same parser twice,
never a guess about which statement produced which object. It is the same move
ADR 0092 made when it rejected DDL attribution — *building the base view IS the
attribution*.

The workflow passes `--base "origin/${{ github.base_ref }}"` only when
`github.base_ref` is non-empty, so `push` and `schedule` reach the flagless
path. The job's checkout gains `fetch-depth: 0` for the reason ADR 0092
measured: `actions/checkout` is shallow **and single-branch** by default, so
without it `origin/<base_ref>` does not exist at all and a `--depth 1` fetch
inside a step cannot create it.

## What deliberately does NOT relax

This is the part that matters. The failure mode of a change like this is to
become quietly vacuous — the fault ADR 0072 exists to close, one layer out.

- **An object NO migration declares fails in BOTH modes, and that is structural
  rather than a check that could be forgotten.** The exempt set is
  `declared(full) - declared(base)`, a subset of what migrations declare, so a
  phantom relation cannot enter it by any path. The hermetic `C - L` arm is not
  touched at all and still fails first. **Measured** below.
- **A MODIFIED migration exempts nothing.** `--diff-filter=A` only, inherited
  from the shared helper. Editing an already-applied migration to add a table is
  a real defect and still fails. Mutating the helper's flag to `AM` fails this
  suite's case for it.
- **An ALTER-only migration exempts nothing.** Touching `supabase/migrations/`
  is not itself an excuse; only *declaring a new object* is.
- **With no `--base`, the exempt set is empty and the code path reduces to the
  old two-way split.** `main` is as strict as it ever was.
- **CANNOT CHECK is exit 2, never 0.** An unresolvable base, a file git reports
  as added that is not on disk, and a merge-base parse under the `MIN_DECLARED`
  floor all refuse rather than answering. "I could not work out what this PR
  adds" must never be answerable as "this PR adds nothing" (which silently
  restores the block) nor as "hold everything back" (which makes the check
  vacuous).
- **Every run states the exemption, including the zero case.** The guard prints
  `merge-aware mode NOT ACTIVE` or `this PR adds 0 migration file(s)… NOTHING is
  exempt`, and itemises every exempted object. An exemption nobody can see is
  the shape of [[absence-reported-as-health]].

## Verification

### 1. `--self-test` — 22 cases, all asserting

`./scripts/check_queried_tables_exist.py --self-test` → **22/22 pass**, in four
sections: the pure three-way decision (8), the SQL replay against real
throwaway migration directories (6), the refusals (2), and end-to-end through
**real git repositories** reusing the real ADR 0092 helper (6).

Two rules this suite obeys, both from faults this repo has already had to write
an ADR about:

- **Every case asserts a value.** ADR 0073's guard sat at exit 0 while being
  vacuous for the defect it was named after. A suite that reports
  `cannot-check` for every case is a failing suite wearing a green exit code.
- **It never borrows `KNOWN_MISSING` to excuse its own fixture.** ADR 0065 found
  a debt entry naming `logConversation`, a method that has never existed in this
  tree — the name came from the guard's own self-test fixture. A fixture
  entangled with the live debt list passes because the list is long, not because
  the logic is right, and stops asserting the day the list is pruned. Every debt
  dict in this suite is synthetic, and **an empty debt list is asserted to be a
  legal state** — `KNOWN_MISSING_FUNCTIONS` is empty today, and empty is the
  correct end state of a shrink-only list — with a paired case proving empty is
  not a free pass.

The decision cases are asserted in **both directions from one input**: the same
object is exempt with `introduced={it}` and fails with `introduced=set()`. A
one-directional assertion here would prove nothing.

### 2. Mutation — a passing suite is not evidence until a broken guard fails it

Seven mutations, each applied, run, reverted:

| mutation | result |
|---|---|
| `classify_absences` ignores the debt list | FAILS 2 cases |
| `classify_absences` never reports anything unexplained | FAILS 5 cases |
| introduced / unexplained swapped | FAILS 3 cases |
| exempt set = *everything* migrations declare | FAILS 7 cases |
| the shared helper's `--diff-filter=A` → `AM` | FAILS *"a MODIFIED migration exempts nothing"* |
| the `MIN_DECLARED` floor on the base parse removed | FAILS *"a base parse under the 150-relation floor raises"* |
| the "added file is not on disk" refusal removed | FAILS *"a file git calls added that is not on disk raises"* |

An eighth was attempted — mutating `--diff-filter` **inside this guard** — and
is recorded as **inapplicable, not as a passing control**: the flag does not
live in this file, which is the point of reusing the helper.

### 3. The PR #243 condition, reconstructed and measured four ways

Not a mock. A throwaway Postgres (`pgvector/pgvector:pg17` + postgis, the
[[local-postgres-from-migrations]] recipe) was built from the migration set at
PR #243's **base** commit `77da45fa` — i.e. production exactly as it stood while
that PR was open: **91 migration files applied, 0 failures, 238 public tables,
1278 public functions, `record_stock_count` absent (count 0)**. The guard was
then run against PR #243's own head tree `0c317017`.

| # | run | exit | what it printed |
|---|---|---|---|
| 1 | **pre-fix** guard, PR #243 tree | **1** | *0 relation(s) and 1 function(s) … do not exist in PRODUCTION* → `record_stock_count() [rpc] (migrations DO define it -- never pushed)` |
| 2 | **post-fix**, PR mode `--base 77da45fa` | **0** | *this PR adds 1 migration file(s)… declaring 1 new relation(s) and 1 new function(s)*; `record_stock_count()` listed as **expected, not a defect**; PASS |
| 3 | **post-fix**, push mode (no `--base`) | **1** | *merge-aware mode NOT ACTIVE*; the same `record_stock_count()` failure |
| 4a | post-fix, PR mode, plus a call to `no_such_table_anywhere` / `no_such_function_anywhere` | **1** | both listed under `C - L` **and** under *do not exist in PRODUCTION* |
| 4b | the same, push mode | **1** | identical, and `record_stock_count()` returns to the list — **2** functions instead of 1 |

Runs 1→2 are the repair; 2→3 is proof the exemption is not global; 4a/4b are
the ratchet — an object no migration declares is red in both modes, and the
precision of the exemption is visible in 4b's count going from 1 to 2.

Additionally, on this branch's own tree: `--base no-such-ref-anywhere` → **exit
2** with `BLOCKED`; `--base origin/main` → *adds 0 migration file(s)… NOTHING is
exempt*, exit 0; and `scripts/check_migrations_single_home.py`, which `exec`s
this module, still exits 0.

## Branch protection — restored as part of this decision

`Fresh database equals remote` and `Code queries only relations production has`
were removed from `main`'s required contexts on 2026-09-02 to unblock the day,
leaving three. **The removal is not the resting state** — ADR 0092 said so, and
a guard nothing enforces is the condition ADR 0072 was written about.

After this PR merges and is seen green on `main`, both go back, so the required
list returns to five with `strict: true`:

```
CI Complete
Fresh database equals remote
Code queries only relations production has
Beverage identity key — SQL matches Python
Guest merge policy — zero false merges
```

The em dashes in the last two are **U+2014 and load-bearing**: a context whose
name is not byte-identical never reports, and a required context that never
reports blocks every PR forever. For the same reason no job `name:` in
`schema-parity.yml` may be renamed — a rename is not a CI-output change, it is a
mergeability change. A CLAIMS entry asserts all four names still match.

## Alternatives rejected

**Leave the two checks off the required list.** The status quo, and it is
exactly what ADR 0072 flagged: *a red parity job has never blocked a merge*. It
converts a designed gate into decoration.

**Add the object to `KNOWN_MISSING` while the PR is open, and prune it after.**
Rejected outright. That list is a shrink-only record of what was already broken
when the guard landed; using it as a merge lubricant is precisely the "way to
keep adding to it" its own comment forbids, and every entry added that way would
have to be removed by a later PR nobody is obliged to write.

**Exempt anything `supabase/migrations/` declares that production lacks.** Much
simpler, and it deletes the check: the `C - R` arm exists *because* a migration
can sit in the repo and never reach production. That is the unpushed-migration
case, and it is the defect, not the exemption.

**Compare against a database built from `origin/main` at job time instead of
the merge base.** Rejected for the reason ADR 0092 rejected it: wrong whenever
`main` has moved, because the PR is then charged for migrations other people
merged while it was open.

**Detect the pull request by reading `GITHUB_EVENT_NAME` inside the script.**
Rejected: it makes the guard behave differently depending on ambient
environment, which is invisible when run locally and untestable without faking
env vars. An explicit `--base` is a stated argument with a stated default, and
the workflow's `if [ -n "${{ github.base_ref }}" ]` is the same conditional ADR
0092 already uses two jobs above — one idiom, not two.

**Parse only the added migration files instead of replaying the directory
twice.** Cheaper, and wrong in the presence of `DROP` and `RENAME`, which are
order-dependent. Two `declared_relations()` passes cost milliseconds.

## Consequences

- A PR that adds a migration *and* the code that calls into it can go green
  without anyone touching production first, which removes the incentive that
  produces the version mismatch.
- The job now runs a self-test that needs no secret and no database, before the
  arm that needs both. A broken guard fails as a guard, not as drift.
- `fetch-depth: 0` makes this job's checkout slower. That is the cost of being
  able to resolve a merge base at all.
- **Not fixed, and named again:** a PR that DELETES a migration already applied
  to production is still caught by nothing in CI. ADR 0092 named it; this change
  does not address it either.
- **Not fixed, and named:** this arm remains relation-granular. The column-level
  counterpart `scripts/check_read_columns_exist.py` (ADR 0074) plausibly carries
  the same merge-blindness for a column a PR's own migration adds, and has not
  been examined for it here. It is not a required context, so it blocks nobody
  today.
