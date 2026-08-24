---
type: schedule
division: platform
department: engineering
team: schema-migrations
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[schema-migrations-charter]]", "[[schema-migrations-loops]]", "[[engineering-schedule]]", "[[sre-state-integrity]]", "[[skills-charter]]", "[[SCHEMA_DRIFT_INVENTORY]]"]
---

# Schema & Migrations — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per PR** | `scripts/check_schema_parity.sh` via `.github/workflows/schema-parity.yml` — **run by [[sre-state-integrity]]**, not by this team | Drift diff; red declared by the auditor |
| Per PR | Generated-type regeneration gate — L-SM-4 | Fails on any diff in `packages/database/src/types/database.types.ts` and siblings |
| Per PR | Irreversible-operation review — L-SM-5, on the published list only | Review requirement, backfill and rollback plan |
| **Daily** | Function-body parity — L-SM-3 | Body-level mismatches; functions with no repo source |
| Daily | Streak publication — L-SM-1 | `schema.days_since_hand_applied_ddl` |
| **Per event** | Emergency DDL reconciliation — L-SM-2, within 24h | Drift-register entry + reconciliation migration |
| Weekly | Migration backlog review — pending DDL requested by domain teams | Authoring queue and its age |
| Monthly | `.planning/SCHEMA_DRIFT_INVENTORY.txt` reconciliation against production | Outstanding drift objects from the 2026-08-05 incident |
| Monthly | RLS policy review with [[platform-api-charter]] | Tables without a tenant policy |
| Quarterly | Migration corpus health — 62 files and growing; `scripts/concat_migrations.py` | Ordering hazards, superseded migrations, ergonomics of the authoring path |

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**None built yet.** Proposed, each tied to a scheduled job above:

| Proposed skill | Fires on | Why a skill rather than a script |
|---|---|---|
| `migration-authoring` | A domain team needing DDL | Must classify the change as reversible or irreversible, and write the backfill/rollback plan — judgement, not templating |
| `drift-reconciliation` | Parity red, or an emergency DDL event | Turns an applied statement into a correct migration that is safe to re-run against an already-changed production |
| `function-source-trace` | A function-body mismatch | Determines whether a production function has repo source, and whether it contains business logic that should not be in the database at all |

**Constraints on all three.** A skill may **author** a migration for human review; it may
never **apply** DDL to production — `scripts/run_migration.sh` stays a human-invoked path,
because automated application is how 27 tables and 403 columns appeared with no migration.
And no skill may mark a parity red as expected: that authority belongs to
[[sre-state-integrity]] as the auditor (`technology.md:296-298`), and an automated
"expected drift" classifier would be premortem M1 shipped as a feature.

Registry governance sits with [[skills-charter]] (Applied AI); this team authors and
retires its own skills within that registry.
