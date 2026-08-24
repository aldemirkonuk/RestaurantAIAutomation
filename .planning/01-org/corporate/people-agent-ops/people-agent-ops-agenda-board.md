---
type: agenda-board
division: corporate
department: people-agent-ops
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[people-agent-ops-charter]]", "[[people-agent-ops-agenda-full]]", "[[people-agent-ops-loops]]", "[[people-agent-ops-schedule]]", "[[roster-lifecycle-agenda-board]]", "[[performance-doneability-agenda-board]]"]
---

# People & Agent Ops — Board

> **PROVISIONAL — no work done yet.**

## Every People & Agent Ops artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/people-agent-ops"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/corporate/people-agent-ops"
WHERE type = "charter"
SORT status ASC
```

## The two numbers, never summed

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  team AS Team,
  metrics AS "Metrics claimed",
  updated AS Updated
FROM "01-org/corporate/people-agent-ops"
WHERE type = "charter" AND team
SORT team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/corporate/people-agent-ops"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/corporate/people-agent-ops"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Every unit across the org that claims an `nf_a.*` metric

We are the consumer of NF-A, not its owner. If a metric we depend on is claimed by nobody,
that is our finding to raise.

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  division AS Division,
  metrics AS Metrics
FROM "01-org" OR "02-advisory"
WHERE type = "charter" AND contains(string(metrics), "nf_a.")
SORT division ASC
```

## Standing counters (hand-entered until the census job exists)

- [ ] `roster.unregistered_module_count` — **3** (`book_scraper_agent`,
      `dataset_creator_agent`, `recurring_order_agent`)
- [ ] `roster.silent_default_spec_count` — **4** (`provider_conversation_agent`,
      `email_intel_agent`, `email_parsing_agent`, `provider_communication_agent`)
- [ ] `roster.truth_pct` — **≤ 73%** — ≥7 defects / 26 modules
- [ ] `roster.headcount_claim_variance` — **4 distinct numbers**: 19 specs · 23 registered
      · 24 claimed (`PROJECT.md:33`) · 26 on disk
- [ ] `roster.declared_stub_count` — **5**, refused at boot by `core/orchestrator.py:245`
- [ ] `roster.maturity_level_evidenced_pct` — **0%** — ladder is prose only
- [ ] `nf_a.doneability_verdict_coverage` — **0%** — no verdict exists anywhere
- [ ] `nf_a.cost_per_task` — **not derivable** — `SpendLogger.log()` has no `agent` param
      (`spend_logger.py:41-49`)
- [ ] `nf_a.verified_task_success_rate` — **unmeasurable** — `base_agent.py:602` records
      liveness, not correctness
- [ ] **Blocker age: OD-C5** — days since filed, reported weekly whether or not it moved
