---
type: agenda-full
division: platform
department: reliability-sre
team: state-integrity-invariants
status: provisional
metrics: [sre.mttd_silent_corruption, integrity.open_findings_oldest_age, integrity.invariants_with_outcome_side_check_pct]
updated: 2026-08-24
links: ["[[state-integrity-invariants-charter]]", "[[state-integrity-invariants-premortem]]", "[[state-integrity-invariants-loops]]", "[[state-integrity-invariants-agenda-board]]", "[[reliability-sre-agenda-full]]", "[[schema-migrations-charter]]", "[[agent-fleet-charter]]"]
---

# State Integrity & Invariants — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

The team with the strongest evidence base in the department has the smallest gap between
what it can detect and what it can *act on* — and the whole agenda lives in that gap.

Four things:

1. **A disposition path for findings**, because `drift_findings` has no reader and a queue
   that only grows is a queue nobody owns.
2. **An out-of-band alert path for tenant leakage**, because it is currently finding #217 in
   a list.
3. **Outcome-side twins for the grep gates**, because five of six gates check syntax, not
   state.
4. **MTTD reported per invariant class**, with unmeasured classes shown as "unmeasured".

Not on the agenda: **more gates.** Counting gates measures effort, and
[[state-integrity-invariants-premortem]] M2 is the failure of mistaking check-coverage for
risk-coverage.

## How

**Findings disposition.** Every finding gets exactly one of three terminal states: **fixed**,
**accepted-with-reason**, or **invalidated**. *Accepted-with-reason* is a legitimate close —
without it, everything that is not worth fixing stays open forever and the queue becomes
noise. The board metric is **age of oldest**, not count.

**Tenant leakage, out of band.** `state_invariant_enforcer.py:1-30` already detects it. It
gets its own immediate alert path — not a row in `drift_findings` with a higher priority
column, but a **structurally different route**, because a queue is the wrong shape for a
signal that must never wait. This is the cheapest high-value change on the agenda.

**Outcome-side twins.** For each grep gate, one data-side check that measures the outcome:
divergence sampling for stock (pairs with `check_no_direct_stock_writes.sh`, which admits its
own limits at `:10`), a cross-tenant row probe for leakage, a labelled-set count for
identity. The greps stay — they are cheap and catch the common case. They are just never the
only thing. `integrity.invariants_with_outcome_side_check_pct` tracks the gap honestly.

**MTTD per class.** Never one number. Schema drift ≤24h; tenant leakage **unmeasured**;
stock divergence **unmeasured**. The unmeasured classes are displayed, not omitted.

**The stubs.** `ghost_inventory_agent.py` and `shrinkage_detective_agent.py` only log
(`technology.md:40-43`). They are listed as **declared, not owned** until OD-24 says who
builds them. Counting a stub as coverage is how M2 becomes invisible.

## Why now

- **`drift_findings` is accumulating today** with no disposition path. Every day of delay
  makes the eventual triage larger and less likely to happen.
- **Tenant leakage is the failure that ends the company.** At 11 restaurants, one restaurant
  seeing another's data is not a bug report, it is the end of the reference customer list.
  The detector already exists; only the routing is missing.
- **OD-24 is cheap to close now** — two of the four guardian agents are still stubs, so
  ownership can be assigned before anyone has built anything to defend.
- **The grep gates are quietly ageing.** Every new Postgres function and every dynamically
  built table name widens the hole they cannot see, and nothing announces it.

## Next steps

| # | Step | Output | Close-time |
|---|---|---|---|
| 1 | Findings disposition: fixed / accepted-with-reason / invalidated, with a named triage cadence | `integrity.open_findings_oldest_age` becomes meaningful | weekly |
| 2 | **Tenant-leakage out-of-band alert path** — structurally separate from the queue | The one signal that never waits | immediate |
| 3 | MTTD reported **per invariant class**, unmeasured classes displayed as "unmeasured" | Kills the comfortable aggregate (M4) | weekly |
| 4 | Outcome-side twin for `check_no_direct_stock_writes.sh` — divergence sampling | First real coverage number | monthly |
| 5 | Cross-tenant row probe as a data-side check | Tenant leakage stops being unmeasured | monthly |
| 6 | CI check: **no commit touches both a migration and a gate script** | The M3 tripwire, automated | on every push |
| 7 | Close OD-24, then either build or formally disown the two stub agents | Mandate matches capability | one close-time |

## Questions for the founder

1. **OD-24** — do the guardian agents belong end-to-end to [[agent-fleet-charter]], or does
   this team own the two that produce invariant findings? Two of four are stubs today, so
   this is decidable cheaply now (`technology.md:848`).
2. **Is "accepted-with-reason" acceptable?** It is the mechanism that keeps the queue
   drainable — and it is also, obviously, the mechanism by which real problems get closed
   with a plausible sentence. Which risk do you prefer?
3. **Tenant-leakage response.** On detection, does the system stop writes
   (`orchestrator.py:537` `pause_all_writes` exists), or alert and continue? This needs an
   answer **before** the first detection, not during it.
4. **Stock divergence sampling frequency and cost.** Daily full sampling on the inventory
   projection is not free. What divergence window is acceptable — an hour, a day, a service?
5. **The two stubs.** Build `ghost_inventory` and `shrinkage_detective`, or delete them?
   A declared-but-empty agent is worse than no agent, because it reads as coverage in every
   list that counts agents.
