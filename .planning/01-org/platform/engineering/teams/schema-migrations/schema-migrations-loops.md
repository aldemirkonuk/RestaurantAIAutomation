---
type: loops
division: platform
department: engineering
team: schema-migrations
status: provisional
metrics: [schema.days_since_hand_applied_ddl, schema.parity_job_green_streak, schema.function_body_mismatches]
updated: 2026-08-24
links: ["[[schema-migrations-charter]]", "[[schema-migrations-premortem]]", "[[schema-migrations-directive]]", "[[engineering-loops]]", "[[state-integrity-invariants-charter|sre-state-integrity]]", "[[inventory-ledger-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_ids: ["sm-parity-streak", "sm-emergency-ddl-reconciliation", "sm-function-body-parity", "sm-generated-type-fidelity", "sm-irreversible-operation-review"]
loop_close_times: ["per-pr", "per-event", "daily", "per-pr", "per-pr"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Schema & Migrations — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-SM-1 — Schema parity streak

```yaml
type: loop
id: sm-parity-streak
owner: schema-migrations
measures: [schema.days_since_hand_applied_ddl, schema.parity_job_green_streak, schema.drift_objects_outstanding]
changes: [supabase.migrations, schema.reconciliation_backlog]
inputs_from: [sre-state-integrity]
outputs_to: [engineering, sre-state-integrity, decision-office]
close_time: per-pr
close_time_note: "per PR and daily"
status: proposed
```

The team's spine and the department's **only primary metric readable today**. Run by
[[state-integrity-invariants-charter|sre-state-integrity]] via `.github/workflows/schema-parity.yml` — **author ≠ auditor**
(`technology.md:296-298`). The metric is a **streak** deliberately: it resets to zero on
any hand-applied DDL reaching production and rebuilds from nothing, so a bad month cannot
be averaged away. Red closes with a **file**, within one close-time, or the streak stays at
zero and escalates.

---

## L-SM-2 — Emergency DDL reconciliation

```yaml
type: loop
id: sm-emergency-ddl-reconciliation
owner: schema-migrations
measures: [schema.hand_applied_statements, schema.reconciliation_lag_hours, schema.drift_register_entries]
changes: [supabase.migrations, schema.emergency_runbook]
inputs_from: [sre-runtime-resilience, sre-state-integrity]
outputs_to: [engineering, sre-state-integrity, decision-office]
close_time: per-event
close_time_note: "resolved within 24h"
status: proposed
```

Counters premortem M2. A 2am `ALTER` to avoid downtime is **correct behaviour**; the
failure is improvisation around it. Fires on every hand-applied statement — recorded at the
time with statement, timestamp, and operator into
`.planning/SCHEMA_DRIFT_INVENTORY.txt` — and closes only when a reconciliation migration
lands. Reconciliation lag is the number that matters; one incident followed by a 9am
migration costs the streak a day and nothing else.

---

## L-SM-3 — Function-body parity

```yaml
type: loop
id: sm-function-body-parity
owner: schema-migrations
measures: [schema.function_body_mismatches, schema.functions_without_repo_source, schema.functions_writing_stock_tables]
changes: [supabase.migrations, ci.parity_scope, ci.guard_set]
inputs_from: [sre-state-integrity, inventory-ledger, catalogue-identity]
outputs_to: [inventory-ledger, catalogue-identity, engineering, sre-state-integrity]
close_time: daily
status: proposed
```

Counters premortem M3 — the worst drift class, because functions carry **logic**, not just
shape. The original incident included **13 functions with no source**, among them
`calculate_sales_velocity` and `resolve_sku_to_inventory`
(`scripts/check_schema_parity.sh:6-11`). Compares **bodies**, not names and signatures: a
re-created function is a rewritten function. Also closes the blind spot in
[[inventory-ledger-charter]]'s TypeScript-shaped direct-write guard and
[[catalogue-identity-charter]]'s guest-name guard, both of which are invisible to SQL.

---

## L-SM-4 — Generated-type fidelity

```yaml
type: loop
id: sm-generated-type-fidelity
owner: schema-migrations
measures: [schema.generated_type_diff_on_regen, schema.type_files_edited_without_migration]
changes: [packages.database_types, ci.type_regeneration_gate]
inputs_from: [client-surfaces, platform-api]
outputs_to: [engineering, client-surfaces, platform-api]
close_time: per-pr
status: proposed
```

Counters premortem M4. CI regenerates `packages/database/src/types/database.types.ts` and
siblings, and fails on any difference — so a hand edit cannot survive a build. The
structural tell is cheap: a generated-types diff in a PR with no migration. TypeScript is
the strongest schema-mismatch detector available, and a hand-edited generated file turns it
into a confident source of false assurance.

---

## L-SM-5 — Irreversible-operation review

```yaml
type: loop
id: sm-irreversible-operation-review
owner: schema-migrations
measures: [schema.irreversible_ops_merged, schema.irreversible_ops_reviewed_by_owner, schema.backfill_plans_written]
changes: [schema.review_policy, schema.irreversible_ops_list]
inputs_from: [inventory-ledger, catalogue-identity, procurement-vendor-network, messaging-delivery]
outputs_to: [engineering, architecture-review, decision-office]
close_time: per-pr
status: proposed
```

Counters premortem M5. Scoped **narrowly on purpose**: `DROP COLUMN`, `ALTER TYPE`,
unbackfilled `NOT NULL`, and the rest of a published list — not all 62-and-growing
migrations. A team that reviews everything becomes a bottleneck and gets routed around,
which produces the hand-applied DDL this whole team exists to prevent. Feeds
[[engineering-loops]] L-ENG-4, which reviews every instance of the three irreversible
artifact classes rather than a sample.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-SM-1 schema parity streak | per-PR and daily | M1 |
| L-SM-2 emergency DDL reconciliation | per-event, within 24h | M2 |
| L-SM-3 function-body parity | daily | M3 |
| L-SM-4 generated-type fidelity | per-PR | M4 |
| L-SM-5 irreversible-operation review | per-PR | M5 |
