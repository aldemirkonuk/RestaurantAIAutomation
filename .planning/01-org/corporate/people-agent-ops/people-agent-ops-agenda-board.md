---
type: agenda-board
division: corporate
department: people-agent-ops
status: active
metrics: []
updated: 2026-08-28
links: ["[[people-agent-ops-charter]]", "[[people-agent-ops-agenda-full]]", "[[people-agent-ops-loops]]", "[[people-agent-ops-schedule]]", "[[people-agent-ops-agent-stack]]", "[[people-agent-ops-questions]]", "[[roster-lifecycle-agenda-board]]", "[[performance-doneability-agenda-board]]", "[[agent-fleet-agent-stack]]", "[[agent-evaluation-gates-agent-stack]]", "[[0035-wave2-seam-reconciliation]]", "[[0038-cards-run-as-declared-scripts]]", "[[0039-activation-plan-of-record]]", "[[0020-no-fabricated-answers]]"]
---

# People & Agent Ops — Board

**Live as of 2026-08-28.** Tasks live in [[people-agent-ops-agenda-full]]; this page is
the instrument panel over them.

> **The board's one rule:** two numbers, never one. Roster truth and doneability coverage
> measure non-commensurable failures ([[people-agent-ops-charter]] §Metrics). A weighted
> blend would let premortem M1 hide inside a healthy average, which *is* premortem M1.
> Every row below carries a value or the words **not emitted** ([[0020-no-fabricated-answers|ADR 0020]]).

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

---

## Panel 1 — Roster truth (roster-lifecycle)

Measured 2026-08-28. The census is computed by
[[agent-fleet-agent-stack|fleet-census-agent]] (ADR 0035 §3, sole computer); this
department **consumes** it and publishes only the HR overlay.

| Counter | Value | Was (2026-08-24) | Source |
|---|---|---|---|
| `roster.modules_on_disk` | **24** | 26 | census fact `memory/2026-08-28-fleet-census.md` |
| `roster.registered` | **23** | 23 | census |
| `roster.unregistered_module_count` | **1** — `recurring_order_agent` | 3 | census; the two former orphans left `agents/` (one reclassified to `services/wine_book_scraper.py`) with **no register entry for either departure** — PAO-3 |
| `roster.silent_default_spec_count` | **0** | 4 | `core/agent_registry.py` — every registered agent has a declared spec |
| `roster.declared_stub_count` | **5**, refused at boot | 5 | `core/orchestrator.py:245` |
| `roster.can_actually_start` | **18** (23 registered − 5 stubs) | — | derived from the two rows above; **the census reports 23 and does not read `IS_STUB`** — filed as PAO-14 |
| `roster.headcount_claim_variance` | **2 numbers** (23 · 24) | 4 numbers (19·23·24·26) | `PROJECT.md:58` now agrees with disk |
| `roster.truth_pct` | **≥ 95.8%** (1 defect / 24) | ≤ 73% | census + registry |
| `roster.maturity_level_evidenced_pct` | **0%** — ladder is still prose | 0% | `PROJECT.md:71`; PAO-8 |

## Panel 2 — The declared workforce (personnel files v1)

The population `cards.json` describes: **102 cards / 100 units / 8 divisions**, CI-gated by
ADR 0038. Never added to Panel 1 — different population, different question.

| Counter | Value | Source |
|---|---|---|
| `cards.declared_agents` | **102** across 100 units | `00-index/cards.json` |
| `cards.routing_mix` | 36 mechanical · 36 extraction · 30 judgment | `cards.json` |
| `roster.ungraded_worker_pct` | **56.9% — 58 / 102** cards read `quality_bar: NONE (gap)` | `cards.json`; PAO-6 |
| `roster.card_execution_pct` | **7.8% — 8 / 102** cards have ever executed | `scripts/agents/run_card.py` `IMPLEMENTED`; PAO-7 |
| `cards.declared_gap_count` | **188** gaps across **92 / 102** cards | `cards.json` |
| `cards.memory_home_exists` | **8 / 102** — memory dirs are created by execution | `run_card.py:345-348`; PAO-17 |
| `roster.emits_trace` | **7 / 24** modules call `log_decision()` | grep, 2026-08-28 |

## Panel 3 — Doneability & cost (performance-doneability)

**Consumed from [[agent-evaluation-gates-agent-stack|gate-runner]], never recomputed
(TECH-F3 untouched).**

| Metric | Value | Note |
|---|---|---|
| `verdict.typed_coverage` | **27 / 39** task types graded · 12 knowingly exempt · **0 ungraded** → PASS | `scripts/check_task_types_are_graded.py`, run 2026-08-28. *Coverage of kinds.* |
| `nf_a.doneability_verdict_coverage` | **not emitted** | *Coverage of completions* — `nf_verdict ⟕ neural_footprint_event`. **The query has never been run.** Citing the row above as this one is a failing board state (premortem M3, one layer up). |
| `nf_a.cost_per_task` | **derivable from the NF ledger** — `subject_id` + `cost_usd` + `context.task_type` | `spend_logger.py:269,326-327`; attribution is ambient via `base_agent.py:308` |
| `nf_a.cost_per_task` *(from `api_spend`)* | **not derivable** — the insert carries no agent and no task_type | `spend_logger.py:365-374`; the grain divergence is ADR 0035 §4 / OD-29, fix owned by Track A2 |
| `nf_a.agent_attributed_spend_pct` | **not emitted** — first readout is PAO-10 | must state its `subject_id = "unknown"` remainder, never drop it |
| `nf_a.verified_task_success_rate` | **unmeasurable** | `base_agent.py:602` records liveness, not correctness |
| `nf_a.liveness_rate` | measurable — **and never reported as success** | the first unqualified `success_rate` in a department artifact is an escalation, not a style note |
| `nf_a.skill_id` | **not emitted** — no such column anywhere | ADR 0039 Track A4; carried as PAO-15 |

## Panel 4 — Blockers, and how long we were wrong about them

| Blocker | State | Age |
|---|---|---|
| **CORP-F5** — `SpendLogger.log(agent=…)` | **CLOSED — landed in P1, unnoticed** | the department carried it as blocking for an unknown interval; the obituary is PAO-13 |
| `dependency.close_time_breached` publisher | **NONE (declared gap)** | every close-time here is enforced by a weekly human sweep; blind spot bounded at 7 days |
| `spend_logger.signature_changed` publisher | **NONE (declared gap)** | this is the gap that let CORP-F5 close silently |
| **OD-03** — the harness choice | open | blocks 30 judgment cards from ever executing; `pao-board-keeper` (extraction) among the 94 that cannot run |
| **DO-3** ([[people-agent-ops-questions]]) | 3 of 4 claims extinct; age-out 2026-10-05 | closes as PAO-3 on 2026-09-11 |

## Panel 5 — Close-times in flight

| close_time | Tasks due | Loop |
|---|---|---|
| **2026-09-01** | PAO-1 · PAO-9 · PAO-13 | L-PAO-3 weekly |
| **2026-09-04** | PAO-2 · PAO-10 | L-PAO-4 monthly |
| **2026-09-08** | PAO-4 · PAO-6 · PAO-14 | — |
| **2026-09-11** | PAO-3 · PAO-16 | — |
| **2026-09-15** | PAO-5 · PAO-7 · PAO-15 | — |
| **2026-09-22** | PAO-17 | — |
| **2026-09-30** | PAO-8 · PAO-12 | L-PAO-5 quarterly readiness |
| **2026-10-01** | PAO-11 | quarterly |

**Reallocation rule (directive rule 5):** if Panel 1 moves for three consecutive
close-times and Panel 3 does not, the department reallocates. The mechanism, not the
intention, is what counters premortem M1.
