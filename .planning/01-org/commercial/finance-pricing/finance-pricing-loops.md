---
type: loops
division: commercial
department: finance-pricing
sublayer_of: growth
status: provisional
metrics: [fin.spend_reconciliation_variance_pct, fin.hours_since_last_spend_row, nf_a.cost_per_completed_task, fin.non_design_partner_restaurant_count, fin.monthly_provider_spend_vs_cap_pct]
updated: 2026-08-24
links: ["[[finance-pricing-charter]]", "[[finance-pricing-premortem]]", "[[finance-pricing-directive]]", "[[finance-pricing-schedule]]", "[[inference-cost-loops]]", "[[unit-economics-pricing-loops]]", "[[LOOP-MAP]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[strategy-fundraising-charter]]", "[[decision-office-charter]]"]
loop_count: 5
loop_ids: ["fin-ledger-invoice-reconciliation", "fin-meter-liveness", "fin-cost-efficiency-review", "fin-pricing-trigger-watch", "fin-cap-adequacy"]
loop_close_times: ["monthly", "daily", "weekly", "weekly", "monthly"]
loop_statuses: ["proposed", "proposed", "gated", "proposed", "proposed"]
---

# Finance & Pricing — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Five loops. Three run today with existing data; two are **armed but unfired** and say so
in their `status`. A dormant team still gets loops — but only loops that can actually
run, because a loop waiting on a trigger that nobody watches is exactly
[[unit-economics-pricing-premortem]] M2.

Note the `outputs_to` fields. Four of five point outside Commercial. That pattern is the
evidence CM-F4 asks for ([[finance-pricing-premortem]] D4) and it is why these fields are
structured rather than prose.

---

## L-FIN-1 — Ledger ↔ invoice reconciliation

```yaml
type: loop
id: fin-ledger-invoice-reconciliation
owner: finance-pricing
measures: [fin.spend_reconciliation_variance_pct, fin.metered_invocation_coverage_pct]
changes: [finance.metric_grade, spend.instrumentation_backlog, finance.agenda_board]
inputs_from: [inference-cost, engineering, ai-orchestration]
outputs_to: [growth, research-and-math, decision-office]
close_time: monthly
status: proposed
```

The number nobody else in the org wants, and the only defence against
[[finance-pricing-premortem]] D2. Sum `api_spend.cost_usd` for the calendar month; compare
against the Anthropic and Google consoles. Target variance ≤2%; >5% escalates
([[finance-pricing-directive]]).

**Manual by design at first.** Automating a reconciliation that has never been performed
once encodes whatever assumptions the first script author held. Human, monthly, until two
consecutive months agree.

---

## L-FIN-2 — Meter liveness (fires on absence)

```yaml
type: loop
id: fin-meter-liveness
owner: finance-pricing
measures: [fin.hours_since_last_spend_row, fin.spend_rows_per_day]
changes: [finance.alert_state, spend.instrumentation_backlog]
inputs_from: [inference-cost, reliability-sre]
outputs_to: [research-and-math, reliability-sre, decision-office]
close_time: daily
status: proposed
```

The existing hourly cap check (`services/agent-orchestrator/jobs/spend_tasks.py:135`,
scheduled at `jobs/celery_app.py:80-84`) sums `api_spend` and alerts when the sum is
**large**. It is structurally incapable of alerting when the sum is **zero**. And
`SpendLogger.log()` swallows every exception by contract (`spend_logger.py:7-8, 82-84`),
so a broken meter is silent on both ends.

This loop watches for absence: no `api_spend` row in N hours while the agent pipeline is
running. Daily, because a month of silence is a quarter's worth of wrong reporting.

---

## L-FIN-3 — Cost-efficiency review

```yaml
type: loop
id: fin-cost-efficiency-review
owner: finance-pricing
measures: [nf_a.cost_per_completed_task, nf_a.cost_per_api_call, nf_a.retry_rate, fin.spend_attribution_coverage_pct]
changes: [harness.routing_policy, finance.agenda_full, decisions.open_queue]
inputs_from: [inference-cost, neural-footprint-instrumentation, agent-evaluation-gates]
outputs_to: [harness-model-routing, research-and-math, decision-office]
close_time: weekly
status: gated
gate: "production volume — the readout refuses to report a number below 30 agent events"
evidence: "P1 shipped the bridge this loop was blocked on. neural_footprint_event carries subject_id + context.task_type; `python3 scripts/nf_readout.py` returns cost per agent per task type with no hand-written SQL. nf_a.retry_rate reads context.attempts, emitted by the gateway wrapper (model-client.service.ts:223)."
```

> **Moved `blocked` → `gated` on 2026-08-24.** The named dependency — no agent or
> task_type in `api_spend` — is gone; P1 landed the bridge and the readout. What holds
> the loop now is a threshold, not a missing mechanism, which is what `gated` means in
> [[ORG_STRUCTURE]] §5.1. It does **not** move to `active`: three of its four measures
> can be read today, but `nf_a.cost_per_completed_task` needs a doneability verdict that
> still does not exist, so the loop would close on cost per *attempted* task and quietly
> call it completed. The readout reports `outcome_unknown` in the same line as the cost
> for exactly that reason.

The founder's cost-efficiency mandate — reduce inference cost via cheaper-model routing —
closes here. F1 supplies the economics; [[harness-model-routing-charter]] makes the
routing decision (`commercial.md:614`). This loop feeds OD-04
([[OPEN-DECISIONS]]:15), which explicitly requires *a cost/quality eval per task type*.

It was written as `blocked` so that unblocking would be a visible, dated event rather than
a slow drift into existence. That is what this is: 2026-08-24, by P1.

**Both numbers or neither.** `cost_per_api_call` may never be reported without
`cost_per_completed_task` beside it ([[inference-cost-premortem]] M4) — which, since
nothing grades completion yet, is exactly why the gate holds.

---

## L-FIN-4 — Pricing entry-trigger watch

```yaml
type: loop
id: fin-pricing-trigger-watch
owner: finance-pricing
measures: [fin.non_design_partner_restaurant_count, fin.external_price_quotes_logged]
changes: [unit-economics-pricing.status, finance.agenda_board, decisions.open_queue]
inputs_from: [design-partner-operations, engineering, unit-economics-pricing]
outputs_to: [strategy-fundraising, sales, growth, decision-office]
close_time: weekly
status: proposed
```

[[unit-economics-pricing-charter]] is dormant behind an explicit trigger — *the first
restaurant that is not the design partner, or the founder un-deferring pricing*
(`commercial.md:313-316`). A trigger nobody watches is a trigger that fires unnoticed.

Two things run weekly and both are cheap today: a **count query** over restaurants
excluding the design partner, and the **price-quote register** — every externally-quoted
number, its date, its recipient. The register exists before the pricing model does,
because the anchor arrives before the model
([[finance-pricing-premortem]] D3).

---

## L-FIN-5 — Cap adequacy

```yaml
type: loop
id: fin-cap-adequacy
owner: finance-pricing
measures: [fin.monthly_provider_spend_vs_cap_pct, fin.cost_to_serve_per_restaurant_month, fin.cap_breach_count]
changes: [spend.cap_thresholds, finance.agenda_full, decisions.open_queue]
inputs_from: [inference-cost, unit-economics-pricing, reliability-sre]
outputs_to: [growth, strategy-fundraising, decision-office]
close_time: monthly
status: proposed
```

`spend_tasks.py:24-27` alerts at **$40** Anthropic / **$16** Google — 80% of $50 / $20
hard caps — against a stated deployment budget of `~$10-20/month`
(`.planning/PROJECT.md:136`). Those numbers were sized for a pre-revenue,
single-design-partner repo, and OD-23's target implies 400–1,000 restaurants.

The loop's rule, which is the counter-pressure to [[finance-pricing-premortem]] D5: **a
cap raise requires a cost-to-serve figure as its justification.** That is the one thing
that makes the dormant team's single number load-bearing rather than decorative, and it
stops "raise the cap" becoming the reflex answer to every breach.

---

## Close-time summary

| Loop | Close-time | Status | Counters |
|---|---|---|---|
| L-FIN-1 ledger ↔ invoice | monthly | proposed | premortem D2 |
| L-FIN-2 meter liveness | daily | proposed | premortem D2 (the absent-row half) |
| L-FIN-3 cost-efficiency review | weekly | **blocked** — no agent/task grain | premortem D5; feeds OD-04 |
| L-FIN-4 pricing-trigger watch | weekly | proposed | premortem D3; [[unit-economics-pricing-premortem]] M2 |
| L-FIN-5 cap adequacy | monthly | proposed | premortem D5; [[inference-cost-premortem]] M5 |

**`outputs_to` outside Commercial: 4 of 5.** Recorded, not argued — CM-F4 is locked
(`commercial.md:632`).
