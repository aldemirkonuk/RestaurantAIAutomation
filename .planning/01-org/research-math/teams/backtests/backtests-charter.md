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

~~Nothing exists. No harness, no backtest, no replay.~~ **First gate executed 2026-09-01.**
`apps/api-gateway/src/analytics/insights/insight-catalog.reach.spec.ts` runs S15 §9's
reach ladder in CI — 10 assertions, **no database, no fixtures, no network**, because the
catalogue is a pure function of the source. That deliberately picks the one gate that
needs no replay corpus, so this team stops being a plan on its first day rather than on
the day production has data.

**It booked a `bt.claim_falsification_rate` entry on its first run**, which is the whole
point of the metric: three of S15 §9's own published baselines did not survive execution
(consumption-only **34 not 38**, no-POS **132 not 144**, the `checks` gate **434 not
429**), and a fourth claim in `03-scenarios/DELIVERY-AUDIT.md` — that `requires goals` was
0 of 573 — was falsified too; it is **22**, exactly as S15 §3 had said. Four published
numbers corrected by one run of one file, including one in the audit that commissioned it.

Metric movement, stated precisely: `bt.scenario_coverage_pct` goes from **1/17 to 2/17**
gates executing — and only *partly* for S15, since its synthetic-week half (quiet week,
false-spike week, honest copy) still needs a corpus and remains unexecuted. Claiming S15
as covered would be the overstatement this team exists to catch.

**The harness's own anti-vacuous guard is the part worth copying.** Every assertion here
is a count, and a count over an empty catalogue passes trivially — so the first test
asserts the catalogue is populated and every requirement token is in use *before* any
reach number is interpreted, and that guard was proven to fire against a mocked-empty
catalogue. Two baseline mutations were also proven to fail the suite. A gate never seen
to fail is not evidence.

What else exists to build on: `services/agent-orchestrator` synthetic engine work
(phase 37), SimPOS (now dev-only, `app.module.ts`) — noting it **cannot manufacture
history**, since it stamps `opened_at`/`closed_at` at wall-clock now — and the remaining
15 scenarios' §9 gates, which specify runs nothing currently executes.

**Entry trigger:** the first `neural_footprint_event` rows landing with
`outcome_basis: call_level_v0`. Before that there is nothing to re-grade.
