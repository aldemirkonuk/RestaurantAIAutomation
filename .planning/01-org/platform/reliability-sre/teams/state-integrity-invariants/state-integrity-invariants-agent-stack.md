---
type: agent-stack
division: platform
department: reliability-sre
team: state-integrity-invariants
status: designed
updated: 2026-08-27
metrics: [sre.mttd_silent_corruption, integrity.open_findings_count, integrity.open_findings_oldest_age, integrity.invariants_with_outcome_side_check_pct]
links: ["[[state-integrity-invariants-charter]]", "[[state-integrity-invariants-schedule]]", "[[state-integrity-invariants-loops]]", "[[state-integrity-invariants-directive]]", "[[0034-agent-stack-artifact]]", "[[reliability-sre-agent-stack]]", "[[skills-charter]]", "[[agent-fleet-charter]]", "[[schema-migrations-charter]]", "[[action-safety-the-human-gate-charter]]"]
---

# State Integrity & Invariants — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The detectors already work and `drift_findings` already fills. The failure this team is
> chartered against is that "open findings" becomes a number that only goes up — the
> detector works perfectly and changes nothing ([[state-integrity-invariants-charter]]
> §Metrics). This agent is therefore pointed at **disposition and coverage honesty**, not at
> detection, and explicitly not at the detectors' code.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `integrity-disposition-agent` | Drive every finding in `drift_findings` to a terminal state with a recorded reason, and keep `sre.mttd_silent_corruption` honest **by class** — never averaging a measured class with an unmeasured one, never touching the detectors that produce the findings | NEW |

## 2. Agent cards

```yaml
agent: integrity-disposition-agent
unit: state-integrity-invariants
triggers:
  - topic: integrity.tenant_leakage_detected   # publisher: `agents/state_invariant_enforcer.py:1-30` (code owned by [[agent-fleet-charter]] — TECH-F6 open). Out of band: never queued, never batched, never waits for a cadence
  - schedule: "weekly (L-INT-2 findings triage, L-INT-3 gate integrity, L-INT-5 MTTD-by-class)"   # [[state-integrity-invariants-schedule]]
  - schedule: "monthly (L-INT-4 outcome-side coverage, stub-vs-capability audit)"
  - schedule: "on every push (author≠auditor tripwire)"
consumes:
  - "`drift_findings` rows — publisher: `agents/drift_agent.py:1-19`, `state_invariant_enforcer.py`, `inequality_detector.py:1-10` (table at `20260805133000_pos_unresolved_lines_and_review_queues.sql`)"
  - "`decision_log` rows — publisher: `base_agent.py:743`; `drift_agent.py` writes one per run and per finding"
  - "the parity gate verdict input — publisher: [[release-engineering-charter]] runs `.github/workflows/schema-parity.yml` (`:26-28`); **we grade it**"
  - "`.planning/07-reference/SCHEMA_DRIFT_INVENTORY.txt` and the six shell gates"
emits:
  - "a disposition per finding (fixed / accepted-with-reason / invalidated) back into `drift_findings` — consumer: the finding's owning Engineering team ([[inventory-ledger-charter]] for stock, [[catalogue-identity-charter]] for merges)"
  - "`sre.mttd_silent_corruption_by_class`, `integrity.open_findings_oldest_age` → consumer: [[reliability-sre-agent-stack|sre-board-orchestrator]]"
  - "`integrity.stub_agents_counted_as_coverage` (today: **2**) → consumer: the same board"
  - "gate-relaxation proposals → `OPEN-DECISIONS.md` as a **rule change** — consumer: [[decision-office-charter]]"
  - "tenant-leakage page → consumer: NONE (gap — the detector exists, the response path does not; see §5)"
  - nf_a events (task_type: integrity_finding_disposition)
routing_class: judgment      # "accepted-with-reason" is a judgment about business risk; only the enumeration underneath it is mechanical
quality_bar: "every open finding reaches a terminal state and none is closed by explanation alone; money and stock are never auto-applied (`drift_agent.py:11-16`). NONE (gap) — no grader exists for whether a disposition was *correct*, only for whether one was reached"
autonomy:
  read: autonomous
  propose: autonomous          # dispositions, MTTD tables and relaxation routings land as PRs
  mutate_stock_money_outbound: confirm   # constant — and the detectors already refuse to auto-apply money and stock, which this card preserves rather than relaxes
memory: state-integrity-invariants
escalates_to: "[[reliability-sre-charter]]"
```

**Three hard rules, each from a seam this team did not draw:**

1. **Never edits the guardian agents.** `state_invariant_enforcer.py`, `drift_agent.py` and
   `inequality_detector.py` are [[agent-fleet-charter]]'s code; this team owns their
   **findings and thresholds** — **fork TECH-F6, open** (`technology.md:848`). An agent
   tuning a detector to shrink its own queue would resolve that fork by accident.
2. **Never authors DDL or a migration.** Author ≠ auditor is the split that justifies this
   team (`technology.md:860`); the on-push tripwire fails any commit touching both
   `supabase/migrations/` and a gate script — this agent's own commits included.
3. **Never grants its own relaxation.** A proposal to loosen a threshold, a check or an
   invariant is routed to `OPEN-DECISIONS.md`, never applied.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `schema-drift-check` | T3 | The parity gate goes red, or a hand-applied production DDL is suspected | Drift fully enumerated against `SCHEMA_DRIFT_INVENTORY.txt`, each item either migrated or filed with a reason — **never closed by explanation alone** | The strongest instance in the department: production once carried **27 tables, 403 columns and 13 functions created by no migration**, recorded verbatim at `scripts/check_schema_parity.sh:6-11` | NEW |
| `findings-triage` | T2 | Weekly, and immediately when `integrity.open_findings_oldest_age` exceeds one close-time | Every open finding reaches a terminal state; money and stock escalated to a human, never auto-applied | `drift_findings` rows sit at status `open` with **no reader** — a grep finds no UI surface and no consumer outside the agents and their tests | NEW |
| `invariant-outcome-sample` | T3 | Monthly, and after any change to a write path a grep gate protects | A data-side divergence sample exists for each grep gate; any green-CI-plus-divergence result is raised immediately | `scripts/check_no_direct_stock_writes.sh:10` **states its own limitation** — a dynamically-built table name or a Postgres function passes it; five of six gates are greps | NEW |
| `gate-relaxation-review` | T2 | Anyone proposes loosening a threshold, a check, or an invariant | The proposal is routed to `OPEN-DECISIONS.md` as a rule change, with the metric-and-knob-in-one-hand risk named explicitly | This repo's own words at `technology.md:700-702`: thresholds relaxed defensibly once, dashboard stays green, substrate quietly degrades | NEW |

**Two omissions, both deliberate.** `tenant-leakage-response` — the highest-stakes procedure
this team has — is **not a row**: the detector exists (`state_invariant_enforcer.py:1-30`)
and **no leak has ever been recorded**, so there is no instance to cite and ADR 0034 §7.2
allows no exception; it lives in [[state-integrity-invariants-schedule]] and loop
`int-tenant-leakage-response` (close_time: per-event) instead, and the missing response path
*is* the finding. And there is no `build-more-gates` skill, permanently — adding gates is
the most legible work this team could do and the least likely to move
`sre.mttd_silent_corruption`.

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: integrity_finding_disposition`, with jsonb keys
  `context.finding_class` (`schema_drift` | `tenant_leakage` | `stock_divergence` |
  `sync_loop` | `double_write`), `context.time_to_detect_seconds`, `context.disposition`.
  MTTD **by class** is the metric; a schema that cannot slice by class forces the average
  the charter forbids. `decision_log` is the substrate that already exists here.
- **Semantic** — `memory/` beside this file, `state-integrity-invariants-MEMORY.md` as
  index. Three founding facts are already known: the 27/403/13 drift incident (source:
  `check_schema_parity.sh:6-11`); `drift_findings` has no reader (source:
  [[state-integrity-invariants-charter]] §Evidence, 2026-08-24); and two agents the mandate
  claims are stubs that only log — `ghost_inventory_agent.py`,
  `shrinkage_detective_agent.py` (source: `technology.md:40-43`), held as a fact so the
  mandate stops reading broader than the capability. Every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. The gates,
  the migrations and `SCHEMA_DRIFT_INVENTORY.txt` are retrieval targets by `path:line`.

**Consolidation** — monthly, to be mirrored in [[state-integrity-invariants-schedule]] (not
a row there yet): read the month's dispositions; **failures first** — every
accepted-with-reason becomes a fact naming the mechanism that made it acceptable, so the
same reason cannot be reused indefinitely unseen; a finding class with no detection at all
is restated each month rather than dropping off the report. Expire facts unverified for 90
days; propose skill candidates. One PR; "no delta" stated — and per the schedule, three
quiet weeks must be distinguished from stopped detectors via the liveness twin
([[observability-telemetry-plumbing-charter]]).

## 5. Async contract

Cross-unit interaction is loops ([[state-integrity-invariants-loops]]), NF-A events and
vault PRs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| The tenant-leakage page has no consumer | The loop's metric is *time to human in minutes* and no channel reaches a human out of band — the one signal for which a cadence is the wrong shape currently has only a cadence |
| `drift_findings` has no reader but this design | Detection is built, disposition is not; until this agent or a UI exists, each emitted disposition is a row nobody has agreed to read |
| Thresholds are ours, the detectors' code is not | **TECH-F6 open** (`technology.md:848`): every threshold change lands as an async request to [[agent-fleet-charter]], and nothing routes it today |

## 6. Evidence today

- **EXISTS — "unusually strong for a proposed team"** (`technology.md:817`): three detection
  agents (`state_invariant_enforcer.py:1-30`, `drift_agent.py:1-19`,
  `inequality_detector.py:1-10`), six shell gates, the daily `schema-parity.yml` cron
  (`:26-28`), the `drift_findings` table, and `SCHEMA_DRIFT_INVENTORY.txt`.
- **NEW — the agent and all four skills.** The team owns no skill today; `schema-drift-check`
  is named in [[README]] §3.2's taxonomy, which makes it the department's most
  clearly-specified skill and still unbuilt.
- **PARTIAL — mandate vs. capability, and the primary metric.** Two agents this team should
  own are stubs that only log (`technology.md:40-43`); five of six gates are greps, so
  `integrity.invariants_with_outcome_side_check_pct` starts low by construction; and while
  schema drift is detected within ≤24h by the daily cron, **tenant leakage and stock
  divergence are unmeasured** (`technology.md:825-827`) — the good number covers the easiest
  surface, so the board must show the classes separately and never average them.
