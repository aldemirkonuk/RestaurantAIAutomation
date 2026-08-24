---
type: agenda-full
division: platform
department: engineering
team: schema-migrations
status: provisional
metrics: [schema.days_since_hand_applied_ddl, schema.parity_job_green_streak]
updated: 2026-08-24
links: ["[[schema-migrations-charter]]", "[[schema-migrations-premortem]]", "[[schema-migrations-agenda-board]]", "[[schema-migrations-loops]]", "[[engineering-agenda-full]]", "[[state-integrity-invariants-charter|sre-state-integrity]]", "[[inventory-ledger-charter]]", "[[SCHEMA_DRIFT_INVENTORY]]"]
---

# Schema & Migrations — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Protect the one instrument that already works, and design the emergency path before the
next emergency uses it. Five deliverables:

1. **The emergency DDL runbook** — written while calm. What may be hand-applied, by whom,
   what is recorded at the time, and the hard requirement that a reconciliation migration
   lands within one close-time.
2. **Function-body parity.** The original incident included 13 functions with no source;
   parity must compare **bodies**, not names and signatures (premortem M3).
3. **Generated-types enforcement.** CI regenerates and fails on a diff, so
   `packages/database/src/types/database.types.ts` cannot become a hand-maintained file
   that looks generated (M4).
4. **The irreversible-operations list**, published — `DROP COLUMN`, `ALTER TYPE`,
   unbackfilled `NOT NULL`, and kin. Those need this team's review; nothing else does (M5).
5. **Publish the streak.** `schema.days_since_hand_applied_ddl` is readable **today** from
   the parity job — the only one of Engineering's eight primary metrics that is.

## How

**A red gate is closed by a file, not a sentence.** This is the whole strategy. The
reconciliation migration lands within one close-time or the streak resets publicly and
stays at zero. A streak cannot be averaged, which is exactly why it is the metric shape
(premortem M1).

**Design the emergency, do not ban it.** A 2am `ALTER` to avoid downtime is the right call.
The failure is not the `ALTER`, it is the improvisation around it — one incident followed
by a 9am reconciliation costs the streak one day and nothing else (M2).

**Author, never audit.** [[state-integrity-invariants-charter|sre-state-integrity]] runs
`.github/workflows/schema-parity.yml` and declares red (`technology.md:296-298`). This team
must never acquire the ability to mark its own drift as expected — that is the single
change that would make M1 unstoppable.

**Review the irreversible, not the routine.** A team that reviews all 62-and-growing
migrations becomes a bottleneck and gets routed around. Publish the dangerous-operation
list and keep `scripts/concat_migrations.py` and `scripts/run_migration.sh` ergonomic, so
the practice stays the path of least resistance (M5).

## Why now

- **The incident is documented, not hypothetical.** 27 tables, 403 columns, 13 functions
  created by no migration; `restaurant_inventory` alone with 37 such columns; two functions
  that were business logic with no source in the repo
  (`scripts/check_schema_parity.sh:6-11`).
- **The gate is currently green-capable and the streak is readable today.** The cheapest
  moment to protect an instrument is before its first "explained" red.
- **Two other teams depend on function-level parity.**
  [[inventory-ledger-charter]]'s direct-write guard greps TypeScript and cannot see a
  Postgres function writing `stock_live`; [[catalogue-identity-charter]]'s guest-name guard
  has the same blind spot. Function-body parity closes both from this side.

## Next steps

- [ ] Write the emergency DDL runbook; register entries in
      `.planning/SCHEMA_DRIFT_INVENTORY.txt` (M2)
- [ ] Publish `schema.days_since_hand_applied_ddl` — readable today
- [ ] Extend parity to compare **function bodies** (M3)
- [ ] CI regenerates `packages/database` types and fails on any diff (M4)
- [ ] Publish the irreversible-operations list requiring this team's review (M5)
- [ ] Confirm with [[state-integrity-invariants-charter|sre-state-integrity]] that only the auditor may declare a red expected
- [ ] Support [[inventory-ledger-charter]]'s guard extension into
      `supabase/migrations/**` function bodies
- [ ] Reconcile `.planning/SCHEMA_DRIFT_INVENTORY.txt` against current production; confirm
      the 2026-08-05 drift is fully absorbed into migrations

## Questions for the founder

1. **Who may hand-apply DDL at 2am?** The runbook needs a name or a role. "Whoever is
   awake" is the current answer and it is how M2 happens.
2. **What is the close-time for a reconciliation migration?** Proposal: 24 hours. Anything
   longer and the streak's reset stops meaning anything.
3. **Is business logic allowed in Postgres functions?** The incident's worst artifacts were
   two functions carrying business logic with no repo source. Sometimes a database function
   is genuinely the right tool. Is the rule "never", or "yes, but authored as DDL and
   reviewed as code"? The second is this charter's assumption.
4. **TECH-F2 — team, or a function inside [[platform-api-charter]]?**
   (`technology.md:844`). Chartered here at team level; the fork is open, and it matters
   because this team's authority rests on being a *named* owner.
5. **Has the 2026-08-05 drift been fully absorbed?** The baseline migration exists. Whether
   every one of the 403 columns and 13 functions now has repo source is a question worth
   answering explicitly rather than assuming from the baseline's existence.
