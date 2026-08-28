---
type: agent-stack
division: platform
department: engineering
team: schema-migrations
status: designed
updated: 2026-08-27
metrics: [schema.days_since_hand_applied_ddl, schema.parity_job_green_streak]
links: ["[[schema-migrations-charter]]", "[[schema-migrations-schedule]]", "[[schema-migrations-loops]]", "[[schema-migrations-directive]]", "[[0034-agent-stack-artifact]]", "[[engineering-agent-stack]]", "[[skills-charter]]", "[[state-integrity-invariants-charter|sre-state-integrity]]"]
---

# Schema & Migrations — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> A migration is the one artifact class that cannot be reverted by reverting a commit
> ([[schema-migrations-charter]] §Distinct from siblings), and this team has the
> best-documented incident in the repo. The card is shaped by both: its agent may author DDL
> for human review and may never apply it, and it may never declare a parity red expected —
> that authority belongs to the auditor, deliberately not the author. Mechanism references are
> [[engineering-agent-stack]]'s.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `ddl-authoring-sentinel` | Author migrations for human review, publish the parity streak daily, and reconcile every hand-applied statement back into the repo within 24 hours — applying nothing | NEW |

## 2. Agent cards

```yaml
agent: ddl-authoring-sentinel
unit: schema-migrations
triggers:
  - schedule: "daily — function-body parity (L-SM-3) and streak publication (L-SM-1)"   # mirrored in [[schema-migrations-schedule]]
  - topic: schema.parity_red              # publisher: .github/workflows/schema-parity.yml:79, run by [[state-integrity-invariants-charter|sre-state-integrity]] — this team's one non-gap trigger
  - schedule: "monthly — SCHEMA_DRIFT_INVENTORY reconciliation, RLS policy review with [[platform-api-charter]]"
consumes:
  - "scripts/check_schema_parity.sh output (publisher: .github/workflows/schema-parity.yml:79 — owned and declared red by the auditor, not by this team)"
  - "supabase/migrations/ — 62 files, baseline 20260805000000_baseline_from_production.sql"
  - "packages/database/src/types/database.types.ts and siblings (publisher: the regeneration gate, L-SM-4)"
  - ".planning/07-reference/SCHEMA_DRIFT_INVENTORY.txt — the drift record"
emits:
  - "schema.days_since_hand_applied_ddl daily → [[schema-migrations-agenda-board]] and L-ENG-1 (consumer: [[engineering-agent-stack|eng-board-keeper]])"
  - "a reconciliation migration per drift event, for human review (consumer: a human applying scripts/run_migration.sh)"
  - "irreversible-operation records (consumer: [[engineering-loops]] L-ENG-4)"
  - "nf_a events (task_type: ddl_authoring) — consumer: NONE (gap, see §5)"
routing_class: judgment          # classifying a change as reversible or irreversible, and writing the backfill/rollback plan, is the job — templating is not
quality_bar: "the schema-parity job is the verdict basis and it is **not this team's to run**: [[state-integrity-invariants-charter|sre-state-integrity]] declares red (`technology.md:296-298`). This agent may never mark a red expected — an automated 'expected drift' classifier is premortem M1 shipped as a feature ([[schema-migrations-schedule]])."
autonomy:
  read: autonomous
  propose: autonomous            # migrations land as PRs, never as applied statements
  mutate_stock_money_outbound: confirm   # constant
memory: schema-migrations
escalates_to: "[[engineering-charter]]"
```

**The card's own hard rule:** `ddl-authoring-sentinel` may **author** a migration; it may never
**apply** DDL to production. `scripts/run_migration.sh` stays a human-invoked path, because
automated application is how 27 tables, 403 columns and 13 functions came to exist with no
migration ([[schema-migrations-schedule]] §Skills owned). The streak metric exists to make that
visible: it resets to zero and must be rebuilt from nothing, and a streak cannot be averaged.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `migration-authoring` | T2 | A domain team needs DDL ([[inventory-ledger-charter]], [[catalogue-identity-charter]], [[procurement-vendor-network-charter]] specify; this team authors) | The migration is classified reversible or irreversible, carries a backfill and rollback plan when irreversible, and regenerates `database.types.ts` in the same PR (L-SM-4) | 62 migrations in `supabase/migrations/` are the repeated instance; the one that had to reconcile a diverged production into the repo is the baseline, `20260805000000_baseline_from_production.sql` | NEW |
| `drift-reconciliation` | T2 | Parity red, or an emergency DDL event — within 24h (L-SM-2) | A migration safe to re-run against an already-changed production, plus a drift-register entry naming every affected object; the streak reset is recorded, never quietly absorbed | The 2026-08-05 incident, recorded verbatim in the tooling: production carried **27 tables, 403 columns and 13 functions** created by hand-applied DDL, and `restaurant_inventory` alone had **37 such columns** (`scripts/check_schema_parity.sh:6-11`) | NEW |
| `function-source-trace` | T2 | A function-body mismatch found by the daily parity job | A verdict per function: repo source exists or does not, and whether the body holds business logic that should not live in the database at all | From the same incident: `calculate_sales_velocity` and `resolve_sku_to_inventory` were business logic with no source anywhere, and "would have silently vanished had the database ever been rebuilt from migrations" (`scripts/check_schema_parity.sh:9-12`) | NEW |

Three rows rather than one or two, because this is the rare Engineering team whose procedures
have all three been performed for real and written up at `path:line`.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); running and
declaring the parity gate ([[state-integrity-invariants-charter|sre-state-integrity]] — author ≠
auditor, `technology.md:296-298`); request-layer tenancy ([[platform-api-charter]], with RLS
co-owned).

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: ddl_authoring` and `drift_reconciliation`. Needs
  `context.migration_file`, `context.reversible` (bool) and `context.objects_affected` as jsonb
  keys, so the monthly irreversible-class review (L-ENG-4) reads every instance rather than a
  sample — which is what that loop requires.
- **Semantic** — `memory/` beside this file, `schema-migrations-MEMORY.md` as index. Its founding
  facts are the incident's: the four counts and the date (source:
  `scripts/check_schema_parity.sh:6-11`, 2026-08-05), the two orphaned functions by name, and the
  standing rule that production shape comes only from the repo. Provenance frontmatter per ADR
  0034; every write is a PR — which for this team is the same discipline as the mandate itself,
  since the incident *was* state that existed with no reviewable source.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. The 62 migrations and
  `SCHEMA_DRIFT_INVENTORY.txt` are retrieval targets by filename and `path:line`; never load the
  corpus (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[schema-migrations-schedule]]: read the authoring and
reconciliation slice since the last run; distill durable facts, failures first — every streak
reset becomes a fact naming who applied what and under what pressure, never "parity went red";
a repeated pressure (a deploy path, an incident runbook, an ergonomics gap in
`scripts/run_migration.sh`) becomes a proposal to remove the pressure rather than another
reminder; expire facts unverified for 90 days. One PR; "no delta" stated when true, and for this
team a month of no delta is the metric working.

## 5. Async contract

Cross-unit interaction is loops in [[schema-migrations-loops]], NF-A events, vault PRs, and skill
candidates only. Gap rows — and note this team has the healthiest async posture in Engineering,
because its trigger has a real publisher:

| Gap | Why it is a gap |
|---|---|
| A hand-applied DDL event has no emitter | `schema.parity_red` is published by the parity workflow, so drift is *detected* — but only on the next run, not when the statement is applied. L-SM-2's 24-hour close_time is bounded by the job's cadence, not by the event |
| The migration authoring queue is a doc, not a channel | Domain teams request DDL in their agendas; the weekly backlog review is the only sweep. An urgent request has no faster path than "wait a week or ask a human" |
| `ddl_authoring` NF-A events have no declared consumer | Beyond this team's own board row and L-ENG-4 |
| Author and auditor share no artifact but the diff | Deliberate (`technology.md:296-298`, §0 test 3) and worth naming: this agent cannot see the auditor's reasoning for declaring a red, only the red |

## 6. Evidence today

- **EXISTS — the corpus, the tooling and the gate.** 62 migrations with the 2026-08-05 baseline,
  `packages/database/src/types/database.types.ts`, `scripts/concat_migrations.py`,
  `scripts/run_migration.sh`, `SCHEMA_DRIFT_INVENTORY.txt`, and the parity job wired at
  `.github/workflows/schema-parity.yml:79` — all cited in [[schema-migrations-charter]] §Evidence
  and verified in place.
- **EXISTS — the past instances behind all three skills.** Unusually for this wave, every §3 row
  cites an incident recorded verbatim in the tooling rather than a hand pass during doc
  generation (`scripts/check_schema_parity.sh:6-11`).
- **NEW — `ddl-authoring-sentinel` and the daily streak reading.** The metric is defined as the
  parity job's green streak; nothing publishes the streak as a number, and no agent performs the
  daily function-body parity job or the 24-hour reconciliation.
- **Open fork, not resolved here:** TECH-F2 asks whether this is a team or a function inside
  [[platform-api-charter]] (`technology.md:844`). This stack is written at team level because the
  charter is; the fork stays open.
