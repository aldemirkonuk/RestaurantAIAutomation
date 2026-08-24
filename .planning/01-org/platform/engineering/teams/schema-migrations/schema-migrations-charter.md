---
type: charter
division: platform
department: engineering
team: schema-migrations
status: exists
metrics: [schema.days_since_hand_applied_ddl, schema.parity_job_green_streak]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[schema-migrations-premortem]]", "[[schema-migrations-agenda-full]]", "[[schema-migrations-agenda-board]]", "[[schema-migrations-directive]]", "[[schema-migrations-loops]]", "[[schema-migrations-schedule]]", "[[schema-migrations-charter|eng-schema-migrations]]", "[[state-integrity-invariants-charter|sre-state-integrity]]", "[[inventory-ledger-charter]]", "[[catalogue-identity-charter]]", "[[platform-api-charter]]"]
---

# Schema & Migrations — Charter

Division **Platform** → Department [[engineering-charter]] → Team `schema-migrations`
(§2.8 of `.planning/foundation/teams/technology.md:274-298`).

## Mandate

**The DDL.** 62 migrations, the generated types in `packages/database`, RLS policies,
Postgres functions, and the rule that **production shape comes only from the repo**.

## Boundaries

Owns outright:

- **`supabase/migrations/`** — 62 files, baseline
  `supabase/migrations/20260805000000_baseline_from_production.sql`
- **Generated types** — `packages/database/src/types/database.types.ts` and siblings
- **RLS policies and Postgres functions** as authored artifacts
- **Migration tooling** — `scripts/concat_migrations.py`, `scripts/run_migration.sh`
- **The drift record** — `.planning/SCHEMA_DRIFT_INVENTORY.txt`
- **The rule itself**: production shape comes only from the repo

## Distinct from siblings because

**A migration is the one artifact class that cannot be reverted by reverting a commit**
(`technology.md:279-280`). Deploys roll back; DDL does not. Dropping a column and
re-adding it does not restore the data that was in it.

It also **has the best-documented incident in the whole repo, which is the strongest
possible argument for a named owner** (`technology.md:280-281`).

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| **Running and owning the drift gate** | [[state-integrity-invariants-charter|sre-state-integrity]] — `.github/workflows/schema-parity.yml`. **Author ≠ auditor**, deliberately (`technology.md:296-298`, §0 test 3) |
| What the domain data *means* | The owning domain team — [[inventory-ledger-charter]], [[catalogue-identity-charter]], [[procurement-vendor-network-charter]] |
| Which invariants a domain needs | Domain teams specify; this team authors the DDL that enforces them |
| Query performance tuning in application code | The owning domain team |
| Backup, restore, and failover | [[runtime-resilience-charter|sre-runtime-resilience]] |
| Tenant guard behaviour at the request layer | [[platform-api-charter]] — RLS is co-owned, request-layer tenancy is not |
| Whether data is fit for use as L0 | [[substrate-quality-coverage-charter|dat-substrate-quality]] |

## Metrics it moves

**Primary: `schema.days_since_hand_applied_ddl`** — the schema-parity job's green streak
(`technology.md:289-290`).

It is a **streak**, and that shape is the point: it resets to zero on any hand-applied DDL
reaching production and then must be rebuilt from nothing. A percentage would let a bad
month average out. A streak cannot be averaged, and it makes the premortem's failure —
"red becomes normal" — arithmetically visible.

## Evidence today

**EXISTS** (`.planning/foundation/teams/technology.md:283-287`).

- **`supabase/migrations/`** — 62 files; baseline
  `20260805000000_baseline_from_production.sql`
- **The incident, recorded verbatim in the tooling.**
  `scripts/check_schema_parity.sh:6-11` states that production carried **27 tables, 403
  columns and 13 functions created by no migration**. `restaurant_inventory` alone had **37
  such columns**. `calculate_sales_velocity` and `resolve_sku_to_inventory` were **business
  logic with no source in the repo**.
- **Generated types** — `packages/database/src/types/database.types.ts` and siblings
- **Tooling** — `scripts/concat_migrations.py`, `scripts/run_migration.sh`
- **Drift record** — `.planning/SCHEMA_DRIFT_INVENTORY.txt`

**Why that incident matters more than its size.** Thirteen functions with no source meant
business logic existed that no one could review, test, or reproduce locally —
`calculate_sales_velocity` was making decisions from a definition living only in
production. That is the concrete argument for repo-as-source-of-truth, and it is why the
gate exists.

## The ownership seam, stated

> This team *authors* DDL; `[[state-integrity-invariants-charter|sre-state-integrity]]` (§6.4) *runs and owns the gate*
> (`.github/workflows/schema-parity.yml`). Author and auditor are deliberately not the same
> team (§0 test 3).
> — `.planning/foundation/teams/technology.md:296-298`

**Open fork:** TECH-F2 asks whether this is a team at all, or a function inside
[[platform-api-charter]] (`technology.md:844`). Chartered here at team level; the fork is
not closed.
