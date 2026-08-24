---
type: agenda-board
division: intelligence
department: research-math
team: neural-footprint-instrumentation
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[neural-footprint-instrumentation-charter]]", "[[neural-footprint-instrumentation-agenda-full]]", "[[neural-footprint-instrumentation-loops]]", "[[neural-footprint-instrumentation-schedule]]", "[[neural-footprint-instrumentation-premortem]]", "[[research-math-agenda-board]]"]
---

# Neural Footprint Instrumentation (RM-3) — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/research-math/teams/neural-footprint-instrumentation"
SORT type ASC
```

## Everyone in the org claiming an NF metric — we owe all of them a contract

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  division AS Division,
  department AS Dept,
  default(team, "— dept —") AS Unit,
  metrics AS Claims
FROM "01-org"
WHERE type = "charter" AND any(map(metrics, (m) => startswith(m, "nf")))
SORT division ASC, department ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/intelligence/research-math/teams/neural-footprint-instrumentation"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Stale — 60 days untouched is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/intelligence/research-math/teams/neural-footprint-instrumentation"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Metrics

| Metric | Reading |
|---|---|
| `nf_a.event_completeness` (NestJS surface) | **0%** — 0 grep hits for `api_spend` / `cost_usd` / `input_tokens` in `apps/api-gateway/src` |
| `nf_a.event_completeness` (Python) | **partial** — 2 unjoined tables, max **4 of 8** fields on any row |
| `nf.private_telemetry_tables` | **1** (`api_spend`). **2 is the alarm** |
| `nf_b.identifier_coverage` | substrate shipped; capture not started |
| Provider invoice vs. sum of NF events | **not reconciled** — the only external check |

## The eight NF-A fields — where each one lives today

| Field | `decision_log` | `api_spend` | NestJS |
|---|---|---|---|
| task type | partial (`decision_type`) | — | — |
| model | — | ✅ | — |
| tokens | — | ✅ | — |
| latency | — | — | — |
| retries | — | — | — |
| tool calls | — | — | — |
| doneability verdict | — | — | — |
| cost | — | ✅ | — |
| *(bonus, and the hard part)* internal state / reasoning / confidence | ✅ | — | — |

## Assignment #1 — the cheapest true statement this department can make

- [ ] `SpendLogger.log()` gains an `agent` parameter (`services/agent-orchestrator/services/spend_logger.py:41-48`)
- [ ] `api_spend` gains the `agent` column
- [ ] `correlation_id` propagated into `api_spend` — **join key before schema**
- [ ] First joined row published

> Until these land, **"cost per task per agent" is not derivable from anything this system
> writes** — on either side.

## Callsite instrumentation ledger — 0 of 7

- [ ] `analytics/consultants.service.ts:28` — **first**; unguarded route (OD-20), Opus; unblocks SEC-3
- [ ] `common/orchestrator/inbound-responder.service.ts:16`
- [ ] `procurement/documents/document-extractor.service.ts:27`
- [ ] `menus/parsers/scan-parser.service.ts:10`
- [ ] `inventory/photo-count.service.ts:9`
- [ ] `vendor-intel/vendor-page-extractor.service.ts:13`
- [ ] `ux-optimizer/ux-optimizer.service.ts:44`

## OD-11 session checklist — both deliverables, or neither

- [ ] Production store: columns, partial indexes per `subject_type`
- [ ] **Research store: wide, append-only, never migrated** — ships in the same change
- [ ] Retention / rollup policy (needs a founder horizon)
- [ ] **F-3 decided in-session** — `operator` as a fourth `subject_type`, or routed outside NF
- [ ] Both owners named: contract (**us**) vs DDL ([[data-charter]])
- [ ] `internal_state` confirmed **required**, not optional

## Standing watches (premortem tells)

- [ ] A **second** table holding token counts — M1, escalate same day
- [ ] An NF schema draft where `internal_state` is optional and `cost` is required — M3
- [ ] An OD-11 output with a production column list and **no research-log shape** — M4
- [ ] Provider invoice diverging from summed NF events — M5
- [ ] An analytics query joining `recommendation_actions` to NF via a hand-written mapping — M2

## Gated, deliberately costing nothing

- [ ] **NF-C** — slot reserved via `subject_type`; append-only research log has no schema to break. Trigger check quarterly; **no design work until it fires**
