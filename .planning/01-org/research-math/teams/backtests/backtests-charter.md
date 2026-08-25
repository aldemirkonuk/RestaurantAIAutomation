---
type: charter
division: research-math
department: research-math
team: backtests
status: new
metrics: [bt.scenario_coverage_pct, bt.claim_falsification_rate, bt.outcome_regrade_delta]
updated: 2026-08-24
links: ["[[research-math-charter]]", "[[evaluation-doneability-charter]]", "[[SCENARIO-CONTRACT]]", "[[0008-nf-column-contract]]", "[[P1-NF-A-INSTRUMENTATION]]"]
---

# Backtests — Charter

## Mandate

Backtest **everything the company claims**, for every unit — not only models. A claim is
backtestable when it can be replayed against data it did not see when it was made. This
team builds the harness that does the replaying, and runs it on demand for any unit.

Founded 2026-08-24 by founder direction, arising from a specific decision: `outcome` on
neural-footprint rows ships as **call-level** grading (`outcome_basis: call_level_v0`,
[ADR 0008](../../../../decisions/0008-nf-column-contract.md)). Call-level grading answers
*"did the API respond?"*, not *"was the task done?"* — the honest first base, and one that
must be **re-graded later against injected scenario data**. That re-grading is this team.

## Boundaries — what it owns

- The **backtest harness**: replay a scenario ([[SCENARIO-CONTRACT]]) against injected or
  synthetic data and score the system's actual behaviour.
- **Outcome re-grading.** Take `outcome_basis: call_level_v0` rows and re-grade them
  against what the scenario says *done* means. The delta between the two is this team's
  headline metric and the empirical input to the doneability definition.
- **Claim falsification.** Any published number — insight counts, recovered dollars,
  vendor scorecards, forecast accuracy — is fair game for replay.
- **Data injection** for backtests, in coordination with Data's synthetic generation.

## Explicit non-goals

| Not ours | Whose |
|---|---|
| Defining doneability | [[performance-doneability-charter]] — we supply evidence, they define |
| Building the eval methodology for harnesses | [[evaluation-doneability-charter]] (RM-2) — they grade the runner, we replay the product |
| Generating synthetic corpora | [[synthetic-generation-simulation-charter]] — we consume, they produce |
| Deciding what ships | Product & Vision. We report; we do not gate |
| Live monitoring | [[observability-telemetry-plumbing-charter]] — backtests look backwards by definition |

## Why it sits under Research & Math

Backtesting is evaluation methodology applied to the product rather than the harness, so
it belongs beside RM-2. It also inherits the division's structural protection
([ADR 0001](../../../../decisions/0001-mudavym-single-entity.md) review trail):
**non-shipping metrics and a schedule product deadlines cannot preempt.** A backtest team
that can be deprioritised for a release is a backtest team that never runs.

It serves **all units** despite reporting into one — that is the same shape as the advisory
functions, without their findings-only limit, because this team builds and runs a harness.

## Metrics

| Metric | Meaning |
|---|---|
| `bt.scenario_coverage_pct` | Of 17 scenarios, how many have a runnable backtest |
| `bt.claim_falsification_rate` | Published claims replayed that did not survive |
| `bt.outcome_regrade_delta` | How far `call_level_v0` grading sits from scenario-level truth — the number that tells People & Agent Ops what doneability actually costs |

## Evidence today — NEW, honestly

Nothing exists. No harness, no backtest, no replay. What exists to build on:
`services/agent-orchestrator` synthetic engine work (phase 37), SimPOS (now dev-only,
`app.module.ts`), and the 17 scenarios' §9 simulation gates — which specify the runs this
team would execute but which nothing currently executes.

**Entry trigger:** the first `neural_footprint_event` rows landing with
`outcome_basis: call_level_v0`. Before that there is nothing to re-grade.
