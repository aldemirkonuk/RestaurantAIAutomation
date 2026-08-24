---
type: agenda-board
division: corporate
department: people-agent-ops
team: performance-doneability
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[performance-doneability-charter]]", "[[performance-doneability-agenda-full]]", "[[performance-doneability-loops]]", "[[performance-doneability-schedule]]", "[[people-agent-ops-agenda-board]]", "[[roster-lifecycle-agenda-board]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]"]
---

# Performance & Doneability — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/people-agent-ops/teams/performance-doneability"
SORT type ASC
```

## Both teams side by side — the anti-M1 view

The department fails if this team goes quiet while [[roster-lifecycle-charter]]'s weekly
work becomes the department. One query, both units, so only-one-moving is legible.

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  team AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)",
  updated AS Updated
FROM "01-org/corporate/people-agent-ops"
WHERE type = "charter" AND team
SORT team ASC
```

## Who else claims an `nf_a.*` metric

We consume NF-A; Research & Math owns it. If a field we depend on is claimed by nobody,
that is a finding to raise, not a gap to fill ourselves.

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  division AS Division,
  department AS Department,
  metrics AS Metrics
FROM "01-org" OR "02-advisory"
WHERE type = "charter" AND contains(string(metrics), "nf_a.")
SORT division ASC, department ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/corporate/people-agent-ops/teams/performance-doneability"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/corporate/people-agent-ops/teams/performance-doneability"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters — the honest zeroes

Published weekly whether or not they move. A frozen zero beside a rising blocker age is
the measurement (premortem M2).

- [ ] `nf_a.doneability_verdict_coverage` — **0%** — no verdict exists anywhere
- [ ] `nf_a.verified_task_success_rate` — **unmeasurable** — `core/base_agent.py:602`
      records `success` = *did not raise*
- [ ] `nf_a.cost_per_task` — **not derivable** — no `agent` param,
      `spend_logger.py:41-49`
- [ ] `nf_a.cost_per_completed_task` — **not derivable** — needs both halves
- [ ] `nf_a.agent_attributed_spend_pct` — **0%** — `api_spend` has no agent column
      (`…baseline_from_production.sql:2231`)
- [ ] `nf_a.emission_coverage` — **uncounted** — how many of 26 modules call
      `log_decision()` at all is obtainable today and nobody has looked
- [ ] `people.blocked_days` — **0**, starts when OD-C5 is filed. **The number that will
      actually move.**
- [ ] `doneability.criteria_spec_coverage` — **0 of 3** live task types specified

## Blocked on — with ages

- [ ] **OD-C5** — `SpendLogger.log()` gains an `agent` parameter; `api_spend` gains the
      column. Filed: — · Age: — · Owner: [[research-math-charter]]
- [ ] **Join key** — what connects `decision_log:2687` to `api_spend:2231`?
      `correlation_id` is the candidate. Filed: — · Age: — · Owner:
      [[neural-footprint-instrumentation-charter]]
- [ ] **Criteria methodology** — for the three specs we hand over. Owner:
      [[evaluation-doneability-charter]]

## Not blocked — and therefore not an excuse

- [ ] Criteria spec: invoice understanding
- [ ] Criteria spec: inbound email classification
- [ ] Criteria spec: wine enrichment
- [ ] Count `log_decision()` call sites across the 26 modules
- [ ] Rename the liveness quantity in every artifact — `success_rate` never unqualified

## Forbidden — listed so it stays forbidden

- [ ] ~~Per-agent cost inferred from `model` + time window~~ — directive rule 1
- [ ] ~~`success_rate` reported as task success~~ — directive rule 2
- [ ] ~~A verdict stored only in a review document~~ — premortem M5
