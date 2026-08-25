---
type: agenda-full
division: platform
department: reliability-sre
team: observability-telemetry-plumbing
status: provisional
metrics: [nf_a.emission_coverage, obs.decision_log_join_rate, obs.metrics_with_liveness_twin_pct]
updated: 2026-08-24
links: ["[[observability-telemetry-plumbing-charter]]", "[[observability-telemetry-plumbing-premortem]]", "[[observability-telemetry-plumbing-loops]]", "[[observability-telemetry-plumbing-agenda-board]]", "[[neural-footprint-instrumentation-charter]]", "[[reliability-sre-agenda-full]]"]
---

# Observability & Telemetry Plumbing — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Three things, in this order, and the order is load-bearing:

1. **A join key**, so the NF-A tuple is one event rather than two half-events in
   `decision_log` and `api_spend`.
2. **A liveness twin** for every metric, so "no data" and "no problem" stop looking
   identical.
3. **Coverage measured over agent tasks**, whole-tuple, no partial credit.

Everything else this team could do — nicer dashboards, more spans, a log search — is
downstream of those three and is deferred until they hold.

## How

**Move 1 — the join key.** One correlation id threaded from task acceptance
(`base_agent.py`) through the model call to the `log_decision` write at `:743`, and onto
the `api_spend` row. Migrate *onto* `decision_log`
(`20260805000000_baseline_from_production.sql:2687`), do not replace it: it is the closest
existing thing to an NF-A event (`technology.md:739`) and a green-field table would strand
the only decision trail the system has while doubling the number of writers.
Schema shape is [[neural-footprint-instrumentation-charter]]'s call, not ours — we own the
pipe.

**Move 2 — liveness.** A `build_info`-style gauge set to 1 at start-up; the
`NoopMetric` fallback (`observability.py:53`) logs at WARNING rather than INFO (`:50`); an
`observability_degraded` boolean on `health-proxy.controller.ts` that `AdminHealth.tsx`
renders. Total cost: small. Value: every other number this team publishes becomes
falsifiable.

**Move 3 — the denominator.** Coverage is over **agent tasks**. An event missing `cost` or
`doneability` scores **zero**, not 0.75. Partial credit is exactly how
[[observability-telemetry-plumbing-premortem]] M4 happens.

**Redaction, before the first new span ships.** Trace and Sentry attributes are opt-in via
an allowlist, agreed with [[compliance-privacy-charter|compliance-charter]] — so the team never faces the "leak or go
blind" choice under pressure (M5).

## Why now

- **L4 is blocked on this team specifically.** NF-A cannot be emitted by units with no
  emission path ([[README]] §1). Every department in [[ORG_STRUCTURE]] is meant to be
  evaluated by metrics; that promise routes through here.
- **The trail already exists and is accumulating without a key.** Every day
  `decision_log` grows rows that cannot be joined to their cost. Adding the key later does
  not retroactively join the backlog — the cost of delay is permanent, not linear.
- **The `NoopMetric` risk is live today**, not hypothetical: it is a dependency-resolution
  away on any rebuild.

## Next steps

| # | Step | Output | Close-time |
|---|---|---|---|
| 1 | Thread one correlation id: task → model call → `log_decision` → `api_spend` | `obs.decision_log_join_rate` gets a first value | weekly loop |
| 2 | `build_info` heartbeat gauge + WARNING-level no-op log + `observability_degraded` on health | Zero ≠ silence | weekly loop |
| 3 | Publish the coverage definition with **agent-task** denominator and whole-tuple grading | `nf_a.emission_coverage` becomes computable | weekly loop |
| 4 | Redaction allowlist at the trace/Sentry boundary, reviewed with Compliance | No raw guest data leaves the process | before step 5 |
| 5 | Only then: span coverage on agent-internal decision points | The hard half of NF-A | monthly |
| 6 | Time-box triage; publish triage volume next to coverage on the board | The M3 divergence is visible early | weekly |

## Questions for the founder

1. **`decision_log` as the NF-A target.** The evidence pass recommends migrating onto it
   rather than replacing it (`technology.md:739`). Confirm — because the alternative
   (a fresh `neural_footprint_event` table per [[README]] §4.4) is a real fork and doing
   both is the worst outcome.
2. **Trace/error vendor and guest data.** Sentry is in both surfaces already. Is any guest
   identifier — even hashed — acceptable in a third-party trace store, or is the allowlist
   strictly non-guest?
3. **Triage ceiling.** What share of this team's capacity may incident triage consume
   before the Incident Command rejection is re-argued? A number here is what makes M3's
   counter-pressure real rather than rhetorical.
4. **Retention.** `decision_log` with a full NF-A tuple per agent task grows fast. Who pays
   for how long, and does that decision belong here or to [[data-charter]]?
