---
type: charter
division: platform
department: reliability-sre
team: state-integrity-invariants
status: exists
metrics: [sre.mttd_silent_corruption, integrity.open_findings_count, integrity.open_findings_oldest_age, integrity.invariants_with_outcome_side_check_pct]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[state-integrity-invariants-premortem]]", "[[state-integrity-invariants-agenda-full]]", "[[state-integrity-invariants-agenda-board]]", "[[state-integrity-invariants-directive]]", "[[state-integrity-invariants-loops]]", "[[state-integrity-invariants-schedule]]", "[[schema-migrations-charter]]", "[[agent-fleet-charter]]", "[[inventory-ledger-charter]]", "[[access-control-tenant-isolation-charter]]"]
---

# State Integrity & Invariants — Charter

Team **6.4** of [[reliability-sre-charter]] (`.planning/foundation/teams/technology.md:809-832`).

## Mandate

**Detect silent corruption.** Distributed-state invariants, schema drift, tenant leakage,
POS↔inventory divergence — and own the gates that enforce them.

Distinct from every sibling because it detects the failures that **never page anyone**.
[[runtime-resilience-charter]] handles things that break loudly and get absorbed; this team
handles things that are **wrong quietly** (`technology.md:814-815`). Nothing throws, nothing
retries, no breaker opens, CI is green, and a number in the database is simply not true.

## Why it is split from Engineering's Schema & Migrations

On **author ≠ auditor** grounds — the same argument [[ORG_STRUCTURE]] §3 uses for the
advisory layer, and the third of the four tests every team in `technology.md` §0 had to
pass: *where a producer and its judge were candidates, they were split.*

[[schema-migrations-charter]] **authors** DDL. This team **runs the gate that grades it** and
**declares it red** (`technology.md:296-298`, `:860`). A team that writes the migration and
also owns the verdict on whether the database drifted is grading its own homework, and the
specific historical reason this matters is recorded in the repo itself:
`scripts/check_schema_parity.sh:6-11` documents that production once carried **27 tables,
403 columns and 13 functions created by no migration**. The gate exists because that
happened.

This split is **structural, not personal**. At a one-founder scale the author and the
auditor are frequently the same person on the same afternoon — which is precisely why the
verdict must be written by the *job*, not the person
([[state-integrity-invariants-premortem]] M3).

## Boundaries

Owns outright:

- **Invariant-detecting agents** — `agents/state_invariant_enforcer.py:1-30` (sync-loop
  detection, double-write detection, **tenant leakage detection**, LLM-output review
  signals); `agents/drift_agent.py:1-19` (snapshot-hash catalogue↔mapping drift, tiered
  autonomy, every run and finding writes a `decision_log` row);
  `agents/inequality_detector.py:1-10` (POS/inventory mismatch — fat-finger, fraud, system
  error).
- **The gates** — `.github/workflows/schema-parity.yml` (including the daily cron at
  `:26-28`), `scripts/check_schema_parity.sh`, `check_no_direct_stock_writes.sh`,
  `check_no_direct_type_attributes_access.sh`, `check_no_raw_guest_channels.sh`,
  `check_no_guest_name_matching.sh`.
- **The drift record** — `.planning/SCHEMA_DRIFT_INVENTORY.txt`, and the `drift_findings`
  queue (`supabase/migrations/20260805133000_pos_unresolved_lines_and_review_queues.sql`).
- **Stubs it should own but cannot yet** — `agents/ghost_inventory_agent.py`,
  `agents/shrinkage_detective_agent.py`. Both are among the five agents whose
  `process_message()` only logs (`technology.md:40-43`). **Declared, not owned**, and the
  charter says so rather than counting them as capability.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Authoring migrations and DDL | [[schema-migrations-charter]] | **The split that justifies this team.** They write; we grade |
| Fixing the divergence once found | The owning Engineering team | We raise the finding; [[inventory-ledger-charter]] fixes the stock, [[catalogue-identity-charter]] fixes the merge |
| Running the CI workflows | [[release-engineering-charter]] | They run `schema-parity.yml`; we own its verdict |
| Emitting the metrics we depend on | [[observability-telemetry-plumbing-charter]] | A finding is a signal we produce; the pipe is theirs |
| Loud failures — retries, breakers, DLQ | [[runtime-resilience-charter]] | Quiet vs. loud is the entire seam |
| The code of the guardian agents | [[agent-fleet-charter]] | **Open — fork TECH-F6** (`technology.md:848`). Fleet owns the code, we own the findings |
| Classifying which endpoints must be guarded | [[access-control-tenant-isolation-charter]] *(Security)* | They classify; we can gate recurrence in CI |
| Whether a data row is *fit to use* | [[substrate-quality-coverage-charter]] *(Data)* | Unfit ≠ corrupted. A thin corpus is Data's problem; a wrong number is ours |

## Metrics it moves

- **`sre.mttd_silent_corruption` (primary)** — mean time to detection, from a violating
  write to a raised finding. **Schema drift is currently ≤24h** (daily cron,
  `schema-parity.yml:26-28`). **Tenant leakage and stock divergence are unmeasured**
  (`technology.md:825-827`) — and the honest reading is that the good number covers the
  easiest surface.
- `integrity.open_findings_count` and **`integrity.open_findings_oldest_age`** — the second
  matters more. Findings correctly never auto-apply for money and stock
  (`drift_agent.py:11-16`), so the queue's health is entirely about whether anyone drains it.
- `integrity.invariants_with_outcome_side_check_pct` — share of invariants that have a
  **data-side** check measuring the outcome, not only a grep measuring the syntax. Five of
  this team's six gates are shell greps; a dynamically-built table name or a Postgres
  function passes all of them.
- **Deliberately not a metric: number of gates.** Counting gates measures effort, and
  [[state-integrity-invariants-premortem]] M2 is exactly the failure of mistaking coverage
  of *checks* for coverage of *risk*.

## Evidence today

**EXISTS — "unusually strong for a proposed team"** (`technology.md:817`). Three detection
agents, six shell gates, a daily cron, a findings table, and a written drift inventory all
exist in the repo today.

Two honest deductions from that grade:

1. **Two of the agents it should own are stubs.** `ghost_inventory_agent.py` and
   `shrinkage_detective_agent.py` only log (`technology.md:40-43`). The mandate reads
   broader than the capability.
2. **`drift_findings` has no reader.** The table exists in the migration and is written by
   `base_agent.py`; a grep finds no UI surface and no consumer outside the agents and their
   tests. Detection is built; disposition is not.

The strongest single piece of evidence for why this team exists is not a feature — it is the
incident recorded verbatim in `scripts/check_schema_parity.sh:6-11`.

## Why this team is distinct from its siblings

Its failure has **no signal at all** — not a missing metric ([[observability-telemetry-plumbing-charter]]),
not an absorbed one ([[runtime-resilience-charter]]), not a reversible one
([[release-engineering-charter]]). The system is up, fast, green, and wrong. It is the only
team here whose entire job is to manufacture a signal where the system produces none.
