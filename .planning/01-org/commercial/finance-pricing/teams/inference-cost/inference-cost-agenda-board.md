---
type: agenda-board
division: commercial
department: finance-pricing
team: inference-cost
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[inference-cost-charter]]", "[[inference-cost-agenda-full]]", "[[inference-cost-premortem]]", "[[inference-cost-loops]]", "[[inference-cost-schedule]]", "[[inference-cost-directive]]", "[[finance-pricing-agenda-board]]", "[[OPEN-DECISIONS]]"]
---

# Inference Cost — Board

> **PROVISIONAL — no work done yet.**

> **Every number on this board is LEDGER-ONLY or UNMEASURED.** None has ever been checked
> against a provider invoice ([[inference-cost-directive]]).

## Every Inference Cost artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/finance-pricing/teams/inference-cost"
SORT type ASC
```

## This team in sub-layer context

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— sub-layer —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/commercial/finance-pricing"
WHERE type = "charter"
SORT status ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/commercial/finance-pricing/teams/inference-cost"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/commercial/finance-pricing/teams/inference-cost"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Blocked loops — what is holding each one

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/finance-pricing"
WHERE type = "loops" AND contains(file.content, "blocked")
```

## Standing counters (hand-entered until the jobs exist)

- [ ] `nf_a.cost_per_completed_task` — **NOT DERIVABLE**. No `agent`, no `task_type` in `SpendLogger.log()` (`spend_logger.py:41-48`) or `api_spend` (`baseline:2229-2238`)
- [ ] `fin.spend_attribution_coverage_pct` — **0%** at agent grain
- [ ] `fin.metered_invocation_coverage_pct` — **UNKNOWN** — no census. Known parts below
- [ ] `fin.spend_reconciliation_variance_pct` — **NEVER MEASURED**
- [ ] `fin.hours_since_last_spend_row` — **UNMEASURED**. The hourly cap check cannot fire on an empty table
- [x] `fin.monthly_provider_spend_vs_cap_pct` — **readable today**: caps `$40` Anthropic / `$16` Google (`spend_tasks.py:24-27`), hourly job (`celery_app.py:80-84`)

## Callsite census — the known parts, pending the full count

| Surface | Callsites | Metered? |
|---|---|---|
| `services/agent-orchestrator/` (9 files) | **16** non-test `.log()` calls | ✅ yes |
| `apps/api-gateway/src` | **7** Anthropic callsites (`intelligence.md:64-73`) | ❌ **zero** — 0 grep hits for `api_spend` / `cost_usd` / `input_tokens` |
| `scripts/` | ≥**2** — `enrich_wines.py:342-349`, `extract_menu_corpus.py:302-307` | ⚠️ self-metered, **discarded** to local `manifest.json` |

## First assignment — the tracked steps

- [ ] Model-callsite census published (document, not migration)
- [ ] Two-column bridge (`agent`, `task_type`) agreed with RM-3, retirement condition written into the migration comment
- [ ] DDL specified to [[schema-migrations-charter]]
- [ ] `SpendLogger.log()` + **all 16 callsites** updated in one PR
- [ ] First ledger ↔ invoice reconciliation run by hand
- [ ] Absence alarm live
- [ ] NestJS approach decided with [[harness-model-routing-charter]]
- [ ] Scripts' spend graded: persist or declare off-ledger

## Open decisions on this board

- [ ] **OD-11** — NF column contract. Gates the bridge columns
- [ ] **OD-04** — external model roster. **Blocked on this team's first assignment**
- [ ] **OD-03** — orchestration base. Its bake-off needs per-workload cost
- [ ] **OD-20** — unauthenticated analytics endpoints driving `claude-opus-4-8`. Not ours to fix; our ledger would not show the spend
- [ ] **Required vs optional `agent` parameter** — coverage against the never-raise contract (`spend_logger.py:7-8`). Founder call
