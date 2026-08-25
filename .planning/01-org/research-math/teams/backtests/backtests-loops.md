---
type: loops
division: research-math
department: research-math
team: backtests
status: new
updated: 2026-08-24
links: ["[[backtests-charter]]", "[[LOOP-MAP]]"]
loop_count: 3
loop_ids: ["outcome-regrade", "claim-falsification", "scenario-coverage"]
loop_close_times: ["monthly", "fortnightly", "monthly"]
loop_statuses: ["blocked", "proposed", "proposed"]
---

# Backtests — Loops

Every loop names its close-time. All three are `proposed` and **blocked on the same thing**:
`neural_footprint_event` has no rows yet.

```yaml
id: outcome-regrade
owner: backtests
measures: [bt.outcome_regrade_delta]
changes: [doneability.definition, nf.outcome_basis]
inputs_from: [neural-footprint-instrumentation, performance-doneability]
outputs_to: [performance-doneability, research-math]
close_time: monthly
close_time_note: "Monthly once rows exist; blocked until P1 emits."
status: blocked
```

```yaml
id: claim-falsification
owner: backtests
measures: [bt.claim_falsification_rate]
changes: [published.claims]
inputs_from: [analytics-bi, strategy-fundraising, growth]
outputs_to: [metric-contract-truth-assurance, editorial-gate]
close_time: fortnightly
close_time_note: "Any claim replayed that fails files a finding at the owning unit."
status: proposed
```

```yaml
id: scenario-coverage
owner: backtests
measures: [bt.scenario_coverage_pct]
changes: [backtest.harness]
inputs_from: [synthetic-generation-simulation, product-vision]
outputs_to: [release-engineering]
close_time: monthly
close_time_note: "Reported per scenario class, never as one number (premortem M1)."
status: proposed
```
