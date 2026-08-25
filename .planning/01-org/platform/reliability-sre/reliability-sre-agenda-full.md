---
type: agenda-full
division: platform
department: reliability-sre
status: provisional
metrics: [nf_a.emission_coverage, sre.time_to_revert, sre.dlq_depth_and_oldest_age, sre.mttd_silent_corruption, sre.days_since_verified_restore]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[reliability-sre-premortem]]", "[[reliability-sre-agenda-board]]", "[[reliability-sre-loops]]", "[[reliability-sre-schedule]]", "[[observability-telemetry-plumbing-agenda-full]]", "[[release-engineering-agenda-full]]", "[[runtime-resilience-agenda-full]]", "[[state-integrity-invariants-agenda-full]]"]
---

# Reliability / SRE — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Four teams, five numbers, and one gap. The department's opening position is unusual and
worth stating precisely: **almost everything is built and almost nothing is watched.**
Circuit breakers, dead-letter queues, sagas, idempotency, a transactional outbox, a
manual kill switch, three invariant agents and six CI guards all exist in the repo today
(`technology.md:791-805,817-823`). What does not exist is a number that tells anyone
whether any of it is working.

So the department's first year is **not a build year**. It is a *make-the-existing-machinery-legible* year.

## How

Four moves, in dependency order rather than importance order:

1. **Make zero distinguishable from silence.** Every metric gets a liveness twin
   ([[reliability-sre-premortem]] M1). Until this holds, no other number on the board can
   be trusted, including the ones that look good.
   → [[observability-telemetry-plumbing-charter]]
2. **Prove the restore.** The named gap ([[reliability-sre-charter]]) becomes a scheduled
   drill whose output is evidence — a row count and a parity run against the *restored*
   database, not a claim that it worked.
   → [[release-engineering-charter]]
3. **Give the DLQ a reader.** Nothing consumes `queue.dead_letters` today. A queue with no
   consumer is where problems go to be forgotten (`technology.md:802-805`).
   → [[runtime-resilience-charter]]
4. **Give the findings queue an owner.** `drift_findings` rows correctly never auto-apply
   for money and stock (`drift_agent.py:11-16`); the failure mode is that "open findings"
   becomes a number that only rises.
   → [[state-integrity-invariants-charter]]

Each move is the *same shape*: an existing mechanism gains a consumer and a close-time.
None of them requires new infrastructure, which is why they are all achievable and why
none of them will happen by themselves.

## Why now

- **L4 is blocked on this department.** NF-A cannot be emitted by units with no emission
  path ([[README]] §1, §4.2), and [[ORG_STRUCTURE]] evaluates departments *by* metrics.
  Observability is upstream of the org's ability to grade itself.
- **The evidence is decaying, not static.** `ci.yml:8` documents a tolerated red build
  today. Tolerance compounds ([[reliability-sre-premortem]] M3); this is cheaper to fix in
  month one than month twelve.
- **The restore gap is the only item here that can lose the company data.** Everything
  else on this agenda degrades quality. That one is categorical, and it is currently two
  untested shell scripts.

## Next steps

| # | Step | Owner | First observable output |
|---|---|---|---|
| 1 | Define the NF-A event tuple's join key against `decision_log` (`base_agent.py:743`) rather than a new table | [[observability-telemetry-plumbing-charter]] | A per-task join that today requires a manual spreadsheet |
| 2 | Heartbeat gauge + `observability_degraded` on the health surface | [[observability-telemetry-plumbing-charter]] | "No metrics" and "metrics are zero" render differently |
| 3 | First restore drill into a scratch database | [[release-engineering-charter]] | `sre.days_since_verified_restore` gets its **first value** |
| 4 | One deliberate no-op revert, timed | [[release-engineering-charter]] | `sre.time_to_revert` stops being a printed procedure |
| 5 | DLQ consumer + depth/oldest-age emission | [[runtime-resilience-charter]] | A DLQ number on the board |
| 6 | Findings-queue triage cadence with an aging column | [[state-integrity-invariants-charter]] | Open-findings count that can go *down* |
| 7 | Red-signal audit: every gate is fix-within-one-close-time or deleted | department | An honest count, published even when embarrassing |

## Questions for the founder

1. **The DLQ consumer's autonomy.** `drift_agent.py:11-16` already establishes that money
   and stock are never auto-applied. Does a DLQ replay get the same rule (human-gated
   always), or is idempotent replay of a non-financial message allowed to be automatic?
2. **Deleting a gate we will not fix.** M3's counter-pressure says a red gate is closed by
   a file within one close-time *or deleted*. Deleting CI checks reads badly. Confirm the
   department may actually delete, or the rule collapses into tolerance.
3. **Restore drill against what?** A scratch Supabase project costs money and a
   `docker-compose` Postgres is not the production engine. Which target makes the drill
   evidence rather than theatre?
4. **TECH-F6** — do guardian agents (`ghost_inventory`, `shrinkage_detective`,
   `state_invariant_enforcer`, `drift_agent`) belong end-to-end to
   [[agent-fleet-charter]], or does [[state-integrity-invariants-charter]] own the two
   that produce invariant findings? Two of the four are declared stubs today
   (`technology.md:40-43`), so this is decidable cheaply now and expensive later.
5. **Incident Command's trigger.** [[reliability-sre-charter]] names one ("a second human
   carrying a pager"). Is that the trigger you want, or is it volume-based?
