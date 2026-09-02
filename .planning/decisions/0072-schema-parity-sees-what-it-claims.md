# 0072 — Schema parity compares what it claims to compare, and exits 2 when it cannot

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** schema parity, drift, pg_catalog, information_schema, numeric scale, materialized view, exit code 2, absence reported as health, ledger migration
- **Links:** `scripts/check_schema_parity.sh`, `.github/workflows/schema-parity.yml`,
  `.planning/07-reference/SCHEMA_DRIFT_INVENTORY.txt`,
  [[0026-schema-has-one-home]], [[0028-phantom-relations-repoint-or-delete]],
  [[0025-citations-must-disagree-loudly]] (the same fault in the citation layer)

## Context

`scripts/check_schema_parity.sh` is the guard that keeps production's schema equal
to `supabase/migrations/`. It is the gate the ledger migration decision is waiting
on, because the whole question there is whether a `numeric(12,3)` quantity column
lands with its scale intact.

It could not answer that question. Its entire comparison was two strings:

```
COLS_Q = table_name||'.'||column_name||':'||data_type     -- information_schema.columns
FNS_Q  = p.proname                                        -- pg_proc
```

`information_schema.columns.data_type` is the literal string `'numeric'` for both
`numeric(12,3)` and bare `numeric`. So CI could not tell a correctly-scaled ledger
migration from a wrong one — the exact case that motivated this work.

### The blind spots, verified rather than assumed

Two databases were built in a scratch Postgres, identical except for seven
hand-applied changes of the kind the job exists to catch. The **unmodified**
script printed:

```
local  : 8 columns, 1 functions
remote : 8 columns, 1 functions

PASS — local and remote schemas are identical.
                                                     exit 0
```

Against **two empty databases** it printed `0 columns, 0 functions` and the same
`PASS`, exit 0 — the repo's cardinal fault, a system reporting absence as health.

Each category was then measured against **production** (project
`exzueerziesmczwlhomd`, PostgreSQL 17, read-only) so the sizes are real and not
fixture artefacts:

| Blind spot | Real? | Production evidence |
|---|---|---|
| `numeric` precision/scale | **yes** | 179 scaled + 33 bare `numeric` columns; the old key called all 212 `'numeric'` |
| `is_nullable` | **yes** | 1,245 of 3,133 table columns are `NOT NULL`; none of it was in the key |
| Function signatures | **yes** | 83 functions compared by name only |
| CHECK constraints | **yes** | 183 CHECKs, never compared |
| UNIQUE constraints / indexes | **yes** | 62 UNIQUE, 211 PK, 254 FK, 648 non-constraint indexes — none compared |
| Column DEFAULTs | **yes** | never in the key |
| Materialized views | **yes, but the named example was wrong** | see below |

**Correction to the brief.** `inventory_lot_rollup` is a **plain view**
(`supabase/migrations/20260805000000_baseline_from_production.sql:3200`), not a
materialized one, and plain views *are* in `information_schema.columns`. The
category is nonetheless real: `information_schema.columns` covers relkind
`r/p/v/f` and **not** `m`. Production has three materialized views —
`event_aggregates_daily` (6 cols), `event_aggregates_hourly` (7),
`inventory_transaction_summary` (11) — and `information_schema.columns` returns
**0** of those 24 columns while `pg_attribute` returns all 24.

Five further blind spots were found beyond the seven: **function bodies**
(`calculate_sales_velocity` could be silently rewritten in production and pass),
**view/matview bodies**, **triggers** (53), **RLS policies** (90 — and
`check_new_tables_are_locked_down.py` only guards *new* tables, so a policy
dropped by hand on an existing one was invisible to the whole repo), **enum
labels and domains** (13), **sequence types** (4), and **column order** (238
relations).

One claim did **not** hold: the old key produced **zero** duplicate keys on
production, so its failure was never key collision. It keyed the right objects
and compared the wrong facts about them.

## Options considered

1. **Widen the two existing `information_schema` queries.** Cheapest. Rejected:
   `information_schema` cannot express typmod at all as a single comparable
   string, cannot see materialized views, and has no view of constraint,
   index, trigger, policy or function-body text. The ceiling is too low to reach
   the case that motivated the work.
2. **Shell out to `supabase db diff` / `migra` and compare the generated DDL.**
   Appealing — someone else maintains the completeness. Rejected: it produces a
   *migration script*, not a fact set, so the exit-code contract (§3 below) has
   nowhere to attach; it needs the local stack on both sides; and the failure
   output is a patch rather than "this column changed, here is each side".
   It also adds a toolchain version to what CI measures, which is the failure
   `supabase/setup-cli` already had twice.
3. **Rewrite as Python + psycopg2.** Nicer to test. Rejected: the parity job is
   the one job with no Python dependency step, and adding one adds a way for the
   job to fail for reasons unrelated to schema.
4. **Rewrite the comparison on `pg_catalog`, keeping bash and zero new
   dependencies.** Chosen.
5. **Do nothing.** Costs: the ledger migration lands with CI unable to
   distinguish a correct scale from a wrong one, and 1,245 NOT NULLs, 183 CHECKs
   and 90 RLS policies stay outside every check in the repo.

## Decision

**The parity check compares a fingerprint drawn from `pg_catalog`, keyed on
(category, object) with the object's definition as the compared value, and it
exits 2 whenever it could not actually check.**

Twelve categories are compared: `server` (version), `relation` (including
materialized views, plus the RLS enabled/forced flags), `column`
(`format_type()` with typmod, nullability, default, identity, generated,
collation), `column-order`, `constraint` (`pg_get_constraintdef`), `index`
(`pg_get_indexdef`, constraint-backed ones skipped as they are already reported
as constraints), `function` (keyed on
`pg_get_function_identity_arguments`, with return type, language, volatility,
security, `proconfig` and an md5 of the body), `viewdef`, `trigger`, `policy`,
`type` (enum labels, domains), `sequence`.

Three things make this a different *kind* of check, not just a wider one:

1. **Definition-as-value.** The old script could only ever say "this key is on
   one side". Keying on the object and comparing its definition produces a
   `CHANGED` section that prints both sides, so a human reads what differs
   instead of correlating an orphan add with an orphan delete.
2. **The exit-2 contract is structural.** `fingerprint()` refuses a side with
   zero relations or zero columns; `compare()` refuses when any of
   `server relation column constraint index function` is empty on **both**
   sides — even when the two fingerprints are byte-identical, because "we agree
   about nothing" is not a pass; a psql failure is caught explicitly rather than
   riding out through `set -e` wearing psql's exit 1, which is indistinguishable
   from "the schemas differ"; and a Postgres **major-version** mismatch is exit 2
   rather than a wall of phantom drift. A run that scanned nothing cannot reach
   exit 0.
3. **`--self-test` is end-to-end.** It builds real databases in the local
   container, applies each blind spot as real DDL one at a time, and asserts the
   guard catches it — 28 invariants. A self-test that only exercised string
   handling would prove nothing about the SQL, and the SQL is where every blind
   spot lived. `--print-sql` prints the comparison itself, so nobody has to take
   this file's word for what is compared.

Two exclusions are kept and, as before, **printed on every run**: extension-owned
objects (now qualified by `classid`, which the old `pg_depend` lookup was not —
an unqualified `objid` can collide across catalogs) and `_bak_*` snapshot tables.

### Proof it fails

Same fixture, same two databases, both scripts run back to back:

```
OLD:  local : 8 columns, 1 functions / remote : 8 columns, 1 functions
      PASS — local and remote schemas are identical.               exit 0

NEW:  == CHANGED — same object, different definition (6)
         [column] public.inventory_lots.qty
              local  : numeric(12,3) NOT NULL DEFAULT 0
              remote : numeric NOT NULL DEFAULT 0
         [column] public.inventory_lots.note
              local  : text NOT NULL
              remote : text NULL
         [column] public.inventory_lots.beverage_kind
              local  : text NOT NULL DEFAULT 'unknown'::text
              remote : text NOT NULL
         [constraint] public.inventory_lots.inventory_lots_unit_vocab
              local  : CHECK (unit = ANY (ARRAY['bottle'::text, 'case'::text, 'keg'::text]))
              remote : CHECK (unit = ANY (ARRAY['bottle'::text, 'case'::text, 'keg'::text, 'splash'::text]))
         [column-order] public.inventory_lot_rollup_mv       (a materialized view)
              local  : restaurant_id,total_qty
              remote : restaurant_id,total_qty,lot_count
         [viewdef] public.inventory_lot_rollup_mv  md5 differs
      == IN REMOTE, NOT IN LOCAL — hand-applied DDL (2)
         [column]   public.inventory_lot_rollup_mv.lot_count  bigint NULL
         [function] public.calculate_sales_velocity(p_restaurant_id text, p_days bigint)
      == IN LOCAL, NOT IN REMOTE — unpushed migration (3)
         [constraint] ...restaurant_id_master_wine_id_key  UNIQUE (restaurant_id, master_wine_id)
         [function]   public.calculate_sales_velocity(p_restaurant_id uuid, p_days integer)
         [index]      public.idx_inventory_lots_restaurant
      FAIL — schema drift detected.                                exit 1
```

The guard was also proven **not vacuous**: a mutant that puts the old semantics
back (base type only, no typmod / nullability / default; function keyed on
`proname`) makes `--self-test` report exactly the five mutated invariants as
`NOT DETECTED` while the other thirteen still pass.

## Consequences

- **Easier:** the ledger migration can be gated on a check that can actually see
  a scale. A hand-applied `DROP NOT NULL`, a widened unit vocabulary, a dropped
  RLS policy, a silently rewritten function body, or a matview column added on
  production now fails instead of passing.
- **Harder:** the check is strict, and strictness has a cost this repo has paid
  before — "a check that is always red is a check nobody reads". Twelve
  categories over ~5,500 production facts will report anything that legitimately
  differs between a fresh `supabase db reset` and production. **This has not been
  run against the real pair** (see Not verified), so the first real run may need
  a triage pass.
- **Given up:** nothing that was previously compared. The new comparison is a
  strict superset of the old one, minus 19 information_schema column rows that
  belonged to extension-owned relations and were never migration-owned anyway
  (3,391 old keys = 3,396 new column facts − 24 matview columns + 19 extension
  columns; the arithmetic closes exactly).
- **Still not compared, and named so it is not mistaken for coverage:** grants
  and role membership, table and column comments, schemas other than `public`
  (`auth`, `storage`, `extensions`), table data, physical storage parameters,
  publication/replication membership, and the *ordering* of enum labels beyond
  their sort order. The PASS message prints this list on every run.
- **Revisit when:** the first real run against production produces a red that is
  not drift. That is the signal that a category needs narrowing, and it should be
  narrowed by name in this ADR, never by deleting the category quietly.

## Open question — founder call, not taken here

**A red parity job does not block a merge, and never has.**

- `.github/workflows/schema-parity.yml:39` defines job `parity`
  ("Fresh database equals remote"). `ci.yml:917` defines `ci-complete`
  ("CI Complete") with 18 `needs:`. GitHub `needs:` cannot cross workflow files,
  so `parity` **structurally cannot** be a dependency of `CI Complete`.
- `ci-complete`'s own coverage step (`ci.yml:961`) loads **`ci.yml` only**, so it
  proves nothing about the four jobs in `schema-parity.yml`.
- Branch protection on `main`, read 2026-09-02:
  `required_status_checks.contexts = ["CI Complete"]`, `strict: true`,
  `enforce_admins: false`. **"Fresh database equals remote" is not a required
  check.**

So the guard being fixed here has been *both blind and non-blocking*. The same is
true of `queried-tables-exist-in-production`, `beverage-identity-parity` and
`guest-merge-gate`, which also live in `schema-parity.yml`.

Making it blocking is a real trade, not an oversight to correct silently: the job
needs a remote secret, so it cannot run on fork PRs (it carries an `if:` guard for
exactly that), and a required check that is skipped on forks blocks fork
contributions. The options are (a) add the context to branch protection, (b) move
the job into `ci.yml` and into `ci-complete.needs`, (c) keep it advisory and rely
on the daily cron. **`ci.yml` was deliberately not touched in this operation** —
other sessions hold open PRs against it.

**This fork is not yet filed in `OPEN-DECISIONS.md`.** Inserting a row there
shifts line anchors for citations that `check_citation_pairing.py` blocks CI on —
measured 2026-09-02: **171** `OPEN-DECISIONS.md:<line>` citations across the repo,
of which **45** sit below the end of the Open table. Re-anchoring those is a
docs-only operation, not this one. Recorded here so the fork is not lost.

### Real-pair run — the one the migration story turns on

Run 2026-09-02 against the **running local Supabase stack** and **production via
the pooler DSN CI uses** (`SUPABASE_POOLER_URL`), read-only:

```
local  : 4598 facts — column=2896 column-order=201 constraint=567 function=43
                      index=555 policy=57 relation=201 sequence=4 trigger=44
                      type=13 viewdef=16 server=1
remote : 5503 facts — column=3397 column-order=238 constraint=709 function=83
                      index=649 policy=90 relation=238 sequence=4 trigger=53
                      type=13 viewdef=28 server=1
excluded from the comparison — ad-hoc backup tables on remote (4)
== CHANGED — same object, different definition (90)
== IN REMOTE, NOT IN LOCAL — hand-applied DDL (905)
                                                                       exit 1
```

**This is not the CI comparison** and must not be read as a drift verdict: the
local database was *not* rebuilt with `supabase db reset` (no CLI on this
machine), so it is simply behind. Zero objects were only-local, which is exactly
the shape of a stale local, not of production drift.

What it *does* prove, and this closes an unknown the first draft of this ADR
flagged: **the 12-statement fingerprint executes through Supavisor without
error.** That was the largest residual risk in shipping this.

It also produced the cleanest possible illustration of the defect. Top of the
CHANGED list:

```
[column] public.api_spend.cost_usd
     local  : numeric(10,6) NOT NULL DEFAULT 0.0
     remote : numeric(10,6) NULL
```

That difference is migration `20260825160000_api_spend_cost_usd_nullable.sql:57-58`
(OD-61 — the spend ledger must be able to say "unknown" rather than book a false
`$0.000000`). Checked against production before asserting anything: production has
`cost_usd numeric(10,6)`, nullable, no default — it **matches the migration**, and
the local stack is the stale side. So this is not drift.

But it is the proof, taken from this repo's own history rather than from a
fixture: **that migration's entire effect is a `DROP NOT NULL` plus a
`DROP DEFAULT`, and the old check could not have seen either one.** Both sides
report `information_schema.data_type = 'numeric'`; nullability and default were
never in its key. Had that migration been applied to production by hand and never
committed — the precise scenario this job exists to catch — the old parity run
would have printed PASS. The new one prints the two lines above.

## The first real CI run — what it found, and what it cost

Run on PR #239, the pull request that rewrites the check. `CI Complete` went
**green** while `Fresh database equals remote` went **red** — the non-gating
finding above, demonstrated live on the pull request that reports it.

### 1. Real drift, and the best evidence in this ADR

Four objects were in production and in **no migration**:

```
[constraint] pos_item_mappings_inventory_id_fkey
             FOREIGN KEY (inventory_id) REFERENCES restaurant_inventory(id) ON DELETE CASCADE
[constraint] pos_catalog_match_proposals_candidate_inventory_id_fkey
             FOREIGN KEY (candidate_inventory_id) REFERENCES restaurant_inventory(id) ON DELETE SET NULL
[index]      pos_item_mappings_inventory_id_idx                      (partial, WHERE ... IS NOT NULL)
[index]      pos_catalog_match_proposals_candidate_inventory_id_idx  (partial, WHERE ... IS NOT NULL)
```

This is the POS-bridge work: an `inventory_id` foreign key added by hand
alongside deleting 92 orphaned mappings. The sibling migration
`20260825140000_pos_referential_integrity.sql:8-9` states outright that "ADR 0012
closed `inventory_id` and ADR 0014 closed `candidate_inventory_id`, deliberately
leaving the rest for this one" — **and neither was ever written as a migration.**
They were closed on production and nowhere else. Any database rebuilt from this
repository would have lacked both, silently.

A foreign key is not a column name and not a function name, so the old check was
structurally incapable of seeing this. It is better evidence than any fixture:
the check found real, year-old, undocumented drift on its first real run.

Captured as `20260902130000_capture_pos_inventory_fks.sql`. It is idempotent via
`drop constraint if exists` + `add constraint` — deliberately **convergent**
rather than merely tolerant, because a `DO ... EXCEPTION WHEN duplicate_object`
block accepts whatever definition is already there, so a production constraint
with the wrong delete behaviour would survive unseen. The two delete behaviours
differ and were read back from production before the file was written; the
rendered definitions were then diffed against production's, byte for byte.

### 2. A false-positive class that would have kept it red forever

45 constraints differed, every one of them the same predicate rendered two ways:

```
local  : CHECK (unit_type::text = ANY (ARRAY['BOTTLE'::character varying::text, ...]))
remote : CHECK (unit_type::text = ANY (ARRAY['BOTTLE'::character varying, ...]::text[]))
```

Root cause, reproduced in a scratch Postgres rather than guessed: **a
pg_dump/restore round-trip is not a fixed point for `x IN (...)` on a varchar
column.** Production's constraints were created as `IN (...)` and render
array-level. pg_dump wrote them into
`20260805000000_baseline_from_production.sql` as `((ARRAY[...])::text[])`, and
re-parsing *that* yields a different expression tree which renders per-element.
No edit to any migration can fix it — the dump text cannot reproduce the tree it
came from.

Normalized, narrowly. Two literal replacements, not a general regex:

```
'::character varying::text'  ->  '::character varying'
']::text[]'                  ->  ']'
```

Each requires a cast to sit directly against another string-type cast or against
an array literal's closing bracket. **A column reference is untouched** —
`unit_type::text` survives, because `unit_type` is neither `character varying`
nor `]`. Nothing about the literal values, their order, the operator or the
column is normalized.

A 46th case hid in a *partial index predicate* and rendered a **third** way
(`ARRAY[('open'::character varying)::text, ...]`), because `pg_get_indexdef`
was being called without the pretty flag. Fixed by rendering the index
definition pretty, which emits exactly the constraint spelling — one normalizer,
both object kinds, no second rule.

**Proven safe in both directions**, on the same six-row pair list: one pair must
collapse, five must survive (value added / removed / renamed, column swapped,
operator negated), and the `differs` rows deliberately use the two *different*
renderings as well as changing content, so an over-reaching normalizer cannot
pass them. Mutation-tested:

| Mutant | Result |
|---|---|
| normalizer removed | `render-equivalent: still reported as drift` — the 45 false positives return |
| normalizer over-broad (blanks `ARRAY[...]`) | `check-value-added / removed / renamed: COLLAPSED — the normalizer swallowed a real difference`, plus `check-vocabulary: NOT DETECTED` |

### 3. Proven green, not predicted

`supabase db reset` was unavailable (no CLI), so the CI local side was
reconstructed by hand: all **89** migrations applied in order to a throwaway
database inside the running local Supabase container, with the extension layout
copied from production rather than guessed. All 89 applied cleanly. That database
was then compared against production through the pooler:

```
local  : 5516 facts — column=3403 column-order=238 constraint=714 function=83
                      index=651 policy=90 relation=238 sequence=4 trigger=53
                      type=13 viewdef=28 server=1
remote : 5516 facts — (identical in every category)
PASS — local and remote agree on every compared object.        exit 0
```

### 4. A hazard the run exposed, now printed by the check itself

Mid-verification the run went red again with 13 new remote-only objects on
`procurement_receipt_events`. **Not drift** — PR #228 had merged
`20260901220000_door_facts_are_columns.sql` to main, which auto-applied to
production, while this branch had not yet merged main. Every migration merged
since a branch was cut is already on production and absent from that branch's
local build, so it arrives looking exactly like hand-applied DDL.

The danger is specific and expensive: someone "captures" another session's
migration and the repo gets it twice — and CLAUDE.md §5b already records that a
duplicate migration version surfaces as *"Fresh database equals remote"*, a
message that says drift when the truth is a collision. So the `IN REMOTE, NOT IN
LOCAL` hint now leads with it: check whether the branch is behind main, and merge
before capturing anything.

### 5. Duplicate migration versions — already guarded, and deliberately not added here

Asked whether this check should also detect two migrations sharing a version.
**It should not, and it does not need to.** `scripts/_migration_versions.py`
already does it, `scripts/check_decision_claims.sh:176-191` already fails the
build on it, and `decision-claims` is in `ci-complete.needs` — so unlike parity,
it is *already gating*. Its header records the same 2026-08-25 incident this ADR
cites: a duplicate makes `schema_migrations`' primary key reject the second
INSERT, and `supabase db reset` dies in a way that surfaces as *"Fresh database
equals remote"* — drift's message for a collision's cause.

Adding it to the parity script would make it strictly worse: parity needs docker
and a remote secret, so it is skipped on fork pull requests, and it is not a
required check (see the open question above). A hermetic filesystem check placed
behind a non-gating, secret-dependent job is the blind-and-non-blocking shape
this whole ADR is about.

Verified 2026-09-02: `20260901120000` **is** duplicated in the wild —
`approve_draft_duplicate_send_guard.sql` and `purchase_reasons.sql` on different
refs. `origin/main` currently holds only the first, so main is clean and the
existing guard will fire the moment the second merges, which is the correct
moment: the collision is not real until both files are in one tree. Worth telling
whoever owns `purchase_reasons` so they renumber before CI tells them.

## Not verified — stated plainly

- ~~The `supabase db reset` path itself was not exercised.~~ **Closed** — CI ran
  it. Run `33624432905` on PR #239, job *Fresh database equals remote*:
  **success**, with `local : 5516 facts` and `remote : 5516 facts` and
  `PASS — local and remote agree on every compared object.` The counts are
  identical, category for category, to the hand-built reconstruction above,
  which retrospectively validates the reconstruction method as well as the fix.
  All four jobs in `schema-parity.yml` are green.
- The fixture was built on PostgreSQL 16; production is 17. No PG17-only
  behaviour is relied on, and PG17's `pg_constraint` was checked on production
  for `contype = 'n'` rows (there are none, so NOT NULL is reported once, by the
  `column` category, not twice).
- The `_bak_*` exclusion still fires on production (4 snapshot tables, printed on
  every run). Unchanged behaviour, restated because an exclusion nobody re-reads
  becomes a blind spot.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created. Diagnosis verified against a fixture and against production; fix proven to fail where the old one passed; self-test proven non-vacuous by mutation. |
