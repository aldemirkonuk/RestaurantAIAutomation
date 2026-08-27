# 0031 — Reconcile the migration ledger in both directions, and check it that way

- **Status:** Locked
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** migrations, supabase, schema_migrations, ledger, drift, db:drift, reconciliation, audit
- **Links:** [[0030-pos-mapping-inventory-integrity]] (the migration that surfaced this), [OPEN-DECISIONS](OPEN-DECISIONS.md) — *the entry this closed was numbered 70 on 2026-08-25; that number is vacant today, so it is described rather than cited* (which direction of ledger drift to reconcile, and how to check it), `scripts/check_migration_ledger.py`, `scripts/check_schema_parity.sh`, `scripts/check_db_reachable.sh`


> **Restored 2026-08-27, and renumbered 0013 → 0031.** This decision was written and locked 2026-08-25 in `a874a68a` and then **lost**: the commit is not an ancestor of `main`, a squash-merge dropped the file, and a concurrent session later spent **0013** on a different decision. Recovered verbatim from the object store; only the number, the H1 and cross-references to the other two restored ADRs were changed. Anything citing it as **ADR 0013** predates the restore. Its one register citation went the same way — number 70 is vacant today — so it is described in words instead.

## Context

Applying ADR 0030's migration surfaced that production's
`supabase_migrations.schema_migrations` had stopped tracking migrations — and that
it had drifted in **both directions at once**:

- **Repo → ledger (4 rows missing).** `20260824141116_neural_footprint_event`,
  `20260824153600_nf_a_readout`, `20260824190000_pos_voided_and_consumption_idempotency`
  and `20260825120000_pos_item_mappings_inventory_fk` were all applied by hand and
  never registered. Verified applied by probing their objects directly: the NF table,
  `pos_checks.voided`, `wine_consumption_log_pos_idem_uidx` and the new FK all exist.
- **Ledger → repo (1 file missing).** `20260824071839_clear_foreign_format_submission_signatures`
  ran through the Supabase dashboard on 2026-08-24 (`created_by` = a real email, unlike
  the 56 CLI rows which are NULL) and **had no file in `supabase/migrations/` on any
  branch**. The repo was therefore not a complete record of the schema.

`pnpm db:drift` (`supabase migration list --linked`) reads exactly this table, so it
was reporting four live migrations as *pending* — a word that reads as "not yet
applied" when it meant "applied, but the ledger never heard about it". Three of the
four are `if not exists`-guarded, so a push would have replayed them silently and the
drift would have compounded rather than surfaced. `db:drift` also cannot see the
second direction at all: a migration that only ever existed in production is
invisible to a tool that compares the local directory against the ledger.

## Options considered

1. **Backfill the ledger, route everything through `supabase db push` from now on.**
   Restores the tool. Costs: a discipline the last four migrations show is not being
   kept, and it only ever addresses the repo→ledger direction.
2. **Accept hand-application as the norm and retire `db:drift`.** Honest about how the
   work actually happens. Costs: gives up the only automated schema-drift signal, right
   as a second person or CI might start applying migrations.
3. **Reconcile both directions, then check both directions.** Backfill the 4 ledger
   rows *and* recover the 1 dashboard migration into a file, then replace the
   single-direction check with a bidirectional one. Costs: a new script to maintain.
4. **Do nothing.** Costs: `db:drift` keeps giving a false reading, in the one direction
   it can see and silently in the one it cannot.

## Decision

**Option 3** — founder's call, 2026-08-25 ("accept this from both sides then audit").

Reconciling only the repo→ledger direction would have restored the tool while leaving
the repo an incomplete record of the schema, which is the more dangerous of the two
gaps: a ledger row can be rebuilt from files, but a migration that exists *only* in
production is one dashboard mishap from being unrecoverable. Its SQL was recovered
verbatim from `schema_migrations.statements` into
`supabase/migrations/20260824071839_clear_foreign_format_submission_signatures.sql`,
headed as a record of what already ran rather than a change to re-apply (both its
statements — an idempotent `UPDATE` and a `COMMENT` — are naturally re-runnable).

The 4 backfilled rows carry `created_by = NULL`, matching the 56 CLI-applied rows
rather than the 6 dashboard ones, and store the file text as a single `statements`
element. The CLI normally splits a file per statement; splitting is not safely
reproducible across dollar-quoted `plpgsql` bodies, and the `version` column is what
determines applied-ness, so single-element storage is lossless for the purpose.

## Consequences

- **Easier:** `pnpm db:drift` is truthful again — 66 files, 66 ledger rows, zero drift
  in either direction, audited after the fact rather than assumed.
- **Easier:** `scripts/check_migration_ledger.py` names both directions with a distinct
  remedy each, exits non-zero, and is CI-ready (env-var DSN first, `.env` second, never
  logs the DSN — the same rule as `check_db_reachable.sh`). Proven by injecting drift in
  both directions at once: it reported each correctly and exited 1, then 0 once restored.
- **Reversible:** the backfill is a separate, guarded operation from the DDL. It refuses
  to run if any of the 4 versions is already present, and `--revert` deletes exactly
  those 4 versions and nothing else — dry-run verified to take the ledger 66 → 62. A
  pre-backfill snapshot of all 62 rows was taken before the write.
- **Given up:** nothing enforces this yet. The script exists and passes; wiring it into
  CI or a pre-push hook is deliberately not done here, because it needs a database
  connection and the CI-reachability story is `check_db_reachable.sh`'s problem.
- **Harder:** hand-applying a migration now leaves a check failing until it is
  registered. That is the intended cost.
- **Revisit when:** the check fails and the honest answer is "we apply by hand and that
  is fine" — at which point option 2 is the real decision, not this one.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | Claude | Drift found while applying ADR 0030; both directions measured (4 unregistered, 1 unrecorded) |
| 2026-08-25 | Aldemir (founder) | Reconcile from both sides, then audit, with a revert path. Locked |
| 2026-08-25 | Claude | Backfilled 62 → 66 in one guarded transaction; dashboard migration recovered to a file; bidirectional check green and proven to fail on injected drift |
