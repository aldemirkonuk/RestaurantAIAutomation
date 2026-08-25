---
type: loops
division: commercial
department: finance-pricing
team: inference-cost
status: provisional
metrics: [fin.spend_reconciliation_variance_pct, fin.hours_since_last_spend_row, fin.metered_invocation_coverage_pct, nf_a.cost_per_completed_task, fin.monthly_provider_spend_vs_cap_pct]
updated: 2026-08-24
links: ["[[inference-cost-charter]]", "[[inference-cost-premortem]]", "[[inference-cost-directive]]", "[[inference-cost-schedule]]", "[[finance-pricing-loops]]", "[[LOOP-MAP]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[agent-evaluation-gates-charter]]", "[[unit-economics-pricing-charter]]", "[[decision-office-charter]]"]
loop_count: 5
loop_ids: ["ic-ledger-invoice-reconciliation", "ic-meter-liveness", "ic-callsite-coverage", "ic-cost-efficiency-review", "ic-cap-adequacy"]
loop_close_times: ["monthly", "daily", "quarterly", "weekly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "gated", "proposed"]
---

# Inference Cost — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Five loops, each countering one premortem mechanism. None of them closes today. Writing a
loop as though it runs is how a metric becomes rhetoric; naming what holds it makes
unblocking a dated, visible event — L-IC-4 moved `blocked` → `gated` on 2026-08-24 when
P1 landed the cost/agent bridge, and the distinction between "no mechanism" and "not
enough traffic yet" is the whole reason the vocabulary has both words.

---

## L-IC-1 — Ledger ↔ invoice reconciliation

```yaml
type: loop
id: ic-ledger-invoice-reconciliation
owner: inference-cost
measures: [fin.spend_reconciliation_variance_pct, fin.metered_invocation_coverage_pct]
changes: [finance.metric_grade, spend.instrumentation_backlog, inference-cost.agenda_board]
inputs_from: [engineering, ai-orchestration, data]
outputs_to: [finance-pricing, research-and-math, decision-office]
close_time: monthly
status: proposed
```

Counters [[inference-cost-premortem]] M1. Sum `api_spend.cost_usd` for the calendar month;
compare against the Anthropic and Google consoles. Target ≤2%; >5% escalates
([[inference-cost-directive]]).

This is the **only** loop that grades a figure MEASURED rather than LEDGER-ONLY. Every
other number this team publishes inherits its trustworthiness from this one.

**Manual until two consecutive months agree.** Automating a check that has never been
performed encodes the first author's assumptions as ground truth.

---

## L-IC-2 — Meter liveness (fires on absence)

```yaml
type: loop
id: ic-meter-liveness
owner: inference-cost
measures: [fin.hours_since_last_spend_row, fin.spend_rows_per_day, fin.pipeline_task_count]
changes: [finance.alert_state, spend.instrumentation_backlog]
inputs_from: [ai-orchestration, reliability-sre]
outputs_to: [reliability-sre, finance-pricing, decision-office]
close_time: daily
status: proposed
```

The other half of M1. `SpendLogger.log()` swallows every exception by contract
(`spend_logger.py:7-8, 82-84`), and the hourly cap check sums the same table it is meant
to police (`spend_tasks.py:34-58`) — so it can trip on a **large** sum and never on an
**empty** one. A stopped meter looks like a quiet month to both.

**The liveness signal must come from outside the ledger.** This loop correlates
`fin.hours_since_last_spend_row` against `fin.pipeline_task_count` — agent tasks running
with no spend rows arriving is the alarm state, and it is invisible to anything that reads
only `api_spend`.

Daily, because a month of silence is a quarter of wrong reporting.

---

## L-IC-3 — Callsite coverage

```yaml
type: loop
id: ic-callsite-coverage
owner: inference-cost
measures: [fin.metered_invocation_coverage_pct, fin.spend_attribution_coverage_pct, fin.unmetered_callsite_count]
changes: [spend.instrumentation_backlog, inference-cost.agenda_full, harness.wrapper_requirements]
inputs_from: [engineering, harness-model-routing, skills]
outputs_to: [harness-model-routing, engineering, decision-office]
close_time: quarterly
status: proposed
```

Counters [[inference-cost-premortem]] M2, and it is quarterly for a structural reason:
Anthropic and Gemini are called over **raw HTTP, not SDKs**
([[EXTERNAL_CONNECTIONS]]:37), so there is no library boundary where a new callsite is
automatically metered. Every callsite added between runs is un-metered by default.

Known opening state: **16** metered Python callsites; **7** NestJS callsites with zero
telemetry (0 grep hits for `api_spend` / `cost_usd` / `input_tokens` in
`apps/api-gateway/src`); **≥2** scripts computing cost and discarding it
(`scripts/enrich_wines.py:342-349`, `scripts/extract_menu_corpus.py:302-307`).

The loop's output to [[harness-model-routing-charter]] is deliberate: the permanent fix is
RM-1's single call wrapper, not a quarterly patching exercise. This loop is the evidence
that argument runs on.

---

## L-IC-4 — Cost-efficiency review

```yaml
type: loop
id: ic-cost-efficiency-review
owner: inference-cost
measures: [nf_a.cost_per_completed_task, nf_a.cost_per_api_call, nf_a.retry_rate, fin.spend_attribution_coverage_pct]
changes: [harness.routing_policy, decisions.open_queue, inference-cost.agenda_full]
inputs_from: [neural-footprint-instrumentation, agent-evaluation-gates, harness-model-routing]
outputs_to: [harness-model-routing, research-and-math, decision-office]
close_time: weekly
status: gated
gate: "production volume — the readout refuses to report a number below 30 agent events"
evidence: "P1 shipped the bridge. neural_footprint_event carries subject_id + context.task_type; `python3 scripts/nf_readout.py` returns cost per agent per task type with no hand-written SQL. The doneability half of the old blocker is unresolved and is why this is gated, not active."
```

Where the founder's cost-efficiency mandate closes. F1 supplies the economics;
[[harness-model-routing-charter]] makes the routing decision (`commercial.md:614`). Feeds
**OD-04** ([[OPEN-DECISIONS]]:15), which explicitly requires *a cost/quality eval per task
type*.

**Was blocked on two things; P1 landed one.** The `agent` / `task_type` bridge exists:
`neural_footprint_event` carries `subject_id` and `context.task_type`, both non-null on
every row emitted by either runtime. The second — a joinable doneability verdict from
[[agent-evaluation-gates-charter]] via RM-3's spine — does **not** exist, and that is the
whole reason this reads `gated` rather than `active`.

**Both numbers or neither** is the rule below, and it is what stops the half that shipped
from being reported as if it were the whole. `cost_per_api_call` is readable today.
`cost_per_completed_task` is not, because nothing grades completion — so the readout
prints `outcome_unknown` next to the cost rather than letting an ungraded call pass as a
completed task.

That rule is [[inference-cost-premortem]] M4, and it earns its keep here: a cheaper model
that retries more moves the two numbers in opposite directions, so shipping the readable
one alone would argue for exactly the wrong routing change.

---

## L-IC-5 — Cap adequacy

```yaml
type: loop
id: ic-cap-adequacy
owner: inference-cost
measures: [fin.monthly_provider_spend_vs_cap_pct, fin.cap_breach_count, fin.cost_to_serve_per_restaurant_month]
changes: [spend.cap_thresholds, decisions.open_queue]
inputs_from: [unit-economics-pricing, reliability-sre]
outputs_to: [finance-pricing, growth, decision-office]
close_time: monthly
status: proposed
```

Counters [[inference-cost-premortem]] M5. The thresholds — `$40` Anthropic / `$16` Google,
80% of $50 / $20 hard caps (`spend_tasks.py:24-27`) — were set against a `~$10-20/month`
deployment budget (`.planning/PROJECT.md:136`) when the denominator was one design partner
who is still not connected (`DEP-06` unchecked).

**The rule this loop enforces: a cap raise requires a cost-to-serve figure as its
justification**, supplied by [[unit-economics-pricing-charter]]. Without it, "raise the
cap" is a four-minute reflex that ends in a ceiling that means nothing. A raise with no
figure escalates to [[decision-office-charter]].

The hourly breach job itself already runs (`spend_tasks.py:135`, `celery_app.py:80-84`);
what does not exist is anyone reviewing whether the number it enforces is still the right
number.

---

## Close-time summary

| Loop | Close-time | Status | Counters |
|---|---|---|---|
| L-IC-1 ledger ↔ invoice | monthly | proposed | M1 — the silent meter |
| L-IC-2 meter liveness | daily | proposed | M1 — the absent-row half |
| L-IC-3 callsite coverage | quarterly | proposed | M2 — partial adoption |
| L-IC-4 cost-efficiency review | weekly | **blocked** | M4 — wrong denominator; feeds OD-04 |
| L-IC-5 cap adequacy | monthly | proposed | M5 — caps that track instead of constrain |

**M3 (duplicate footprint) has no loop, deliberately** — it is countered by a *rule*, not
a measurement: the two-column limit in [[inference-cost-directive]], enforced at review
time by RM-3 sign-off. A loop that measured "how many extra columns did we add" would only
report the failure after it happened.
