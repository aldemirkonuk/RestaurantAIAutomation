# 0122 — A foreign key names a table that exists when it is written

- **Status:** Proposed
- **Date:** 2026-09-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** migrations, foreign key, rename, schema-parity, guard, ci, 42P01, solve-it-once
- **Links:** `[[0114-connections-are-the-houses-profile-is-the-persons]]` (the rename), `[[0020-no-fabricated-answers]]`,
  `[[0095-queried-relations-check-is-merge-aware]]`, `[[0076-a-repoint-names-the-referencing-column]]`,
  `scripts/check_fk_targets_exist.py`, `scripts/test_fk_targets_exist.py`,
  `.github/workflows/ci.yml` (job `schema-code-parity`)

## Context

On 2026-09-04 commit `29e439c4` shipped a migration whose foreign key named a
table that no longer existed:

```
supabase/migrations/20260904230000_a_tool_the_house_has_seen_before.sql:52
    REFERENCES public.user_mcp_connections(id) ON DELETE CASCADE
```

The name had been taken away the day before, by ADR 0114's migration:

```
supabase/migrations/20260903151000_the_house_declares_a_person_consents.sql:63-64
    ALTER TABLE public.user_mcp_connections
      RENAME TO restaurant_mcp_connections;
```

`supabase db reset` would have stopped on that file with `42P01 relation
"public.user_mcp_connections" does not exist` and taken every later migration
with it. The TypeScript that reads the table had already been corrected to the
new name before the commit; only the SQL and its prose were left behind. It was
found by the commit's own audit and fixed in `88d7b5a8` before it reached `main`.

**Nothing in the repository would have told anyone.** Measured on 2026-09-04
against a temp tree built by putting `git show 29e439c4:<the file>` back in place
of the fixed one (`scripts/` copied real, everything else symlinked, so the
worktree's own migrations were never touched):

| Guard | Reads | Exit on the pre-fix tree |
|---|---|---|
| `scripts/check_queried_tables_exist.py` | TypeScript and Python call sites (`TS_ROOTS`/`PY_ROOTS`, its lines 180-192) vs relations the migrations declare | **0 — PASS** |
| `scripts/check_fk_repoint_by_referenced_column.py` | SQL, for one shape: `unnest(conkey)` without `confkey` | **0 — OK** |

Neither is blind by accident. `grep -c REFERENCES scripts/check_queried_tables_exist.py`
is **0**: the string does not occur in it at all, because a foreign key is not a
call site — and this defect's call site was already right. The four `REFERENCES`
occurrences in `check_fk_repoint_by_referenced_column.py` (lines 322, 355, 432,
438) are inside its own self-test fixtures. Across all of `scripts/*.py`, those
two files are the only ones that contain the word, and neither treats it as a
foreign-key target.

`schema-parity.yml` **would** have gone red — it is a required status and it
really does run `supabase db reset`. That is the shape of the residual argument
below, and it is why this is a second cheap check rather than a replacement.

## Options considered

1. **Rely on `schema-parity.yml`.** It is already required, already runs
   `supabase db reset`, and would have caught this. Costs: it runs *after* a
   push, on a runner, at the price of a full CI round trip; and it reports the
   **migration that failed to apply**, not the **rename that made it fail** —
   the reader gets `42P01` and has to go find the other half themselves. It also
   fails *closed on the whole set*: one bad file makes every later migration
   look broken, so the signal names the wrong file first. Worst, on a red `main`
   the parity job is `skipped`, and a skipped gate reads as "not applicable"
   rather than as "not checked" (the absence-reported-as-health rule).
2. **Extend `check_queried_tables_exist.py`.** It already holds a model of what
   the migrations declare. Costs: that guard's contract is *code vs schema*, and
   its whole 1602-line argument — the C/L/R triangle, the merge-awareness of
   ADR 0095, the debt list — is about call sites. Bolting a schema-vs-schema arm
   onto it would make one guard answer two unrelated questions, and a failure in
   either would print the other's essay.
3. **A new guard that walks the migrations forward.** A second file, ~35 lines
   of parsing and a long docstring, stdlib only, no secret, sub-second. Costs: a
   second SQL parser in the repo, and every SQL parser is a partial one — it must
   say out loud what it refuses to read rather than silently shrinking its
   universe.
4. **Do nothing.** The defect cost one audit, one fix commit and no production
   damage. Costs: it recurs the next time a table is renamed, which is now a
   routine event (ADR 0114 renamed one last week), and the next one may be found
   by a red required status on a branch three sessions deep instead of by an
   audit.

## Decision

Option 3. `scripts/check_fk_targets_exist.py` walks `supabase/migrations/*.sql`
in filename order — the order the CLI applies them — keeping the set of tables
that exist at each point, and requires every `REFERENCES <name>` to resolve
against that set at the position it is written.

**What it parses.** Comments (`--`, nestable `/* */`) and single-quoted strings
are blanked first, offsets preserved. Dollar-quoted bodies are **kept**: the
rename that caused this defect lives inside a `DO $$` block, and a guard that
skipped those would have been green on the very file it exists for. Then, in
positional order per file: `CREATE [...] TABLE [IF NOT EXISTS]` adds;
`ALTER TABLE [IF EXISTS] [ONLY] x RENAME TO y` removes `x` and adds `y`;
`DROP TABLE [IF EXISTS] a, b` removes; `CREATE [OR REPLACE] [MATERIALIZED] VIEW`
is recorded separately so a key aimed at a view is named as such;
`REFERENCES <name>` must resolve. Names may be quoted or schema-qualified; a
bare name resolves to `public`. Ordering by position is what makes a
self-referencing column inside its own `CREATE TABLE` resolve.

**Exit 0** PASS with counts. **Exit 1** FAIL naming `file:line` of the key *and*
`file:line` of the rename or drop that removed the target. **Exit 2** CANNOT
CHECK — an unterminated comment, string or dollar-quote; dynamic DDL that would
change the guard's model of the schema; or a corpus with zero foreign keys in
it, which is the extraction having rotted rather than a schema without keys.
An unparseable statement is never a pass.

**What it refuses.** Only four shapes inside a quoted string count as dynamic
DDL: `CREATE ... TABLE`, `ALTER TABLE ... RENAME TO`, `DROP TABLE`, and the
foreign-key shape `REFERENCES <name>(`. Two near misses in the live corpus prove
why the broader forms are wrong, and both were measured, not guessed: the
baseline reads the RFC-822 header `'references'` out of jsonb at
`20260805000000_baseline_from_production.sql:455`, and OD-73 enables RLS in a
loop with `execute format('alter table public.%I enable row level security', t)`
at `20260825200000_od73_close_anon_dml.sql:273`. Refusing on the bare word, or
on a bare `ALTER TABLE`, made the guard exit 2 on the whole corpus — which is
how a guard that cannot check anything gets deleted instead of fixed.

**What it cannot see, stated so it is a known gap and not a forgotten one:**

- A **conditional** rename or drop is treated as taken. `20260903151000` wraps
  its rename in `IF to_regclass(...) IS NOT NULL THEN`; on a fresh reset that
  branch fires, and that is the case that matters. Modelling the branch *not*
  firing means modelling the database, which is `schema-parity.yml`'s job.
- A table dropped by a **later** migration than the key that references it. That
  is the mirror defect and needs a backward walk — a different guard.
- **Columns.** `REFERENCES public.restaurants(id)` is checked for `restaurants`,
  not for `id`. `check_read_columns_exist.py` is the column-level guard for
  reads; foreign keys have none.
- **Schemas this repo does not create** — `auth`, `storage`, `extensions`,
  `cron`, `net`, `vault`, `realtime`, `graphql`, `pgsodium`,
  `supabase_functions`. Four keys point at `auth.users` (`baseline:12814`,
  `:12854`, `20260825140000_pos_referential_integrity.sql:105`, `:110`). They are
  **skipped and counted, not blessed**: an actor FK to `auth.users` is its own
  live defect — `auth.users` and `public.users` hold disjoint ids — and it needs
  a guard that knows about ids, not one that knows about names.

**Proof.** The guard was run twice, on trees that differ by exactly one file:

```
$ python3 scripts/check_fk_targets_exist.py --migrations-dir <pre-fix tree>
== 129 migration file(s): 245 CREATE TABLE, 1 RENAME TO, 0 DROP TABLE, 33 view(s).
== 329 foreign key target(s) checked; 4 skipped as external schemas (...).

FAIL -- 1 foreign key(s) name a table that does not exist yet:
  .../20260904230000_a_tool_the_house_has_seen_before.sql:52: REFERENCES
  public.user_mcp_connections -- removed by
  .../20260903151000_the_house_declares_a_person_consents.sql:64
  (renamed to restaurant_mcp_connections)
EXIT=1

$ python3 scripts/check_fk_targets_exist.py            # the tree as it stands
== 129 migration file(s): 245 CREATE TABLE, 1 RENAME TO, 0 DROP TABLE, 33 view(s).
== 329 foreign key target(s) checked; 4 skipped as external schemas (...).

PASS -- every foreign key names a table that exists at the point the migration
       writes it.
EXIT=0
```

`--self-test` runs 17 shapes including that one; `scripts/test_fk_targets_exist.py`
is 31 pytest cases, two of which read the repository itself — one asserting the
shipped set passes, one rebuilding the pre-fix file from `git show 29e439c4:` and
asserting the failure names both halves. It `skip`s, rather than passes, if the
commit is not reachable from the checkout.

**Wiring.** `.github/workflows/ci.yml`, job `schema-code-parity`, beside
`check_queried_tables_exist` and `check_migrations_single_home`: the guard and
its `--self-test`, both `if: !cancelled()` so a guard hidden behind another guard
is still a guard. The pytest joins the `scripts-tests` job.

## Consequences

- **Easier.** A rename can be made without carrying its whole reference graph in
  someone's head: the next key pointed at the old name fails locally, in a
  second, naming the rename. The failure message contains both halves, which is
  the half `42P01` never gives you.
- **Harder.** One more SQL parser to keep honest. Its refusal list is the
  maintenance surface: the first `EXECUTE format('CREATE TABLE ...')` anyone
  writes will stop the guard at exit 2 rather than let it quietly stop modelling
  the schema. That is the intended trade and it will read as an obstacle the day
  it happens.
- **Given up.** The guard says nothing about columns, about conditional
  branches, or about the four `auth.users` keys it skips. Each is named above so
  a later reader can tell a decision from an omission.
- **Revisit when:** (a) a migration needs dynamic DDL that creates or renames a
  table — then the guard must learn the statement or the statement must move;
  (b) the mirror defect appears (a key that outlives its target's drop) — that is
  a backward walk, and it belongs in this file's successor, not bolted on here;
  (c) `schema-parity.yml` becomes cheap enough to run pre-push, at which point
  this guard's argument is only the *message*, not the *latency*.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-04 | — | Created. Guard, pytest and CI wiring written and measured; proof pasted above. |
