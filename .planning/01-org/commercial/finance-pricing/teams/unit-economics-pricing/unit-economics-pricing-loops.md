---
type: loops
division: commercial
department: finance-pricing
team: unit-economics-pricing
status: provisional
metrics: [fin.non_design_partner_restaurant_count, fin.external_price_quotes_logged, fin.cost_to_serve_per_restaurant_month, fin.gross_margin_per_restaurant_month]
updated: 2026-08-24
links: ["[[unit-economics-pricing-charter]]", "[[unit-economics-pricing-premortem]]", "[[unit-economics-pricing-directive]]", "[[unit-economics-pricing-schedule]]", "[[finance-pricing-loops]]", "[[LOOP-MAP]]", "[[inference-cost-charter]]", "[[design-partner-operations-charter]]", "[[strategy-fundraising-charter]]", "[[decision-office-charter]]"]
loop_count: 4
loop_count: 4
loop_count: 4
loop_ids: ["uep-entry-trigger-watch", "uep-price-quote-register", "uep-cost-to-serve-publication", "uep-gross-margin"]
loop_close_times: ["weekly", "weekly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "gated", "gated"]
---

# Unit Economics & Pricing — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**Four loops for a dormant team, and only two of them run.** That ratio is the point.
A dormant team's temptation is to write loops that describe the work it will do after it
wakes — which produces four diagrams and zero feedback. The two live loops here counter
the two failures that happen *while the team is dormant*
([[unit-economics-pricing-premortem]] M1, M2); the two gated ones carry their trigger in
`status` and `gated_on` so that un-gating is a dated event rather than a drift.

---

## L-UEP-1 — Entry-trigger watch · **RUNS TODAY**

```yaml
type: loop
id: uep-entry-trigger-watch
owner: unit-economics-pricing
measures: [fin.non_design_partner_restaurant_count, fin.founder_pricing_deferral_state]
changes: [unit-economics-pricing.status, finance.agenda_board, decisions.open_queue]
inputs_from: [design-partner-operations, engineering, sales]
outputs_to: [finance-pricing, strategy-fundraising, sales, decision-office]
close_time: weekly
status: proposed
```

Counters [[unit-economics-pricing-premortem]] M2 — *dormancy became disappearance*. The
entry trigger is *the first restaurant that is not the design partner, or the founder
un-deferring pricing* (`commercial.md:313-316`), and a trigger nobody queries is a trigger
that fires unnoticed.

**Two halves, because the trigger has two halves:**

1. A **count query** over restaurants excluding the design partner. **Record the value
   even when it is zero** — a recorded zero proves the check ran; an absent check is
   indistinguishable from a zero until it is far too late.
2. A **written question to the founder each cycle**, because "the founder un-defers
   pricing" happens in conversation and leaves no database row. The second half is the one
   that gets skipped, and skipping it is the whole failure.

Opening value: **0**. One restaurant exists and it is the design partner
(`.planning/PROJECT.md:127`), still unconnected (`DEP-06` unchecked, `:101`).

---

## L-UEP-2 — Price-quote register · **RUNS TODAY**

```yaml
type: loop
id: uep-price-quote-register
owner: unit-economics-pricing
measures: [fin.external_price_quotes_logged, fin.unregistered_quote_incidents]
changes: [finance.agenda_board, decisions.open_queue]
inputs_from: [design-partner-operations, outbound-engine, narrative-collateral, strategy-fundraising]
outputs_to: [finance-pricing, decision-office, red-team]
close_time: weekly
status: proposed
```

Counters [[unit-economics-pricing-premortem]] M1 — *the anchor arrived before the model*.
`commercial.md:321-323`: pricing gets set implicitly by the first invoice the founder
sends a friend, and deferring the decision is not the same as deferring the anchor.

Every externally-quoted number is logged: **the number, the date, the recipient, and
whether it was framed as final.** The register does not stop anchoring — nothing does — but
it converts an invisible process into a list someone can read, which is the difference
between *discovering* the anchor and *inheriting* it.

**This loop is also the one that would have caught the live case.** `$20–50/mo` is
described as locked in [[OPEN-DECISIONS]]:27, and no ADR records it — seven ADRs exist and
none concerns pricing. The register's first entry is that fact.

`fin.unregistered_quote_incidents` — a quote found in an artifact but absent from the
register — is the health signal. Zero is only meaningful once the register exists.

---

## L-UEP-3 — Cost-to-serve publication · **GATED**

```yaml
type: loop
id: uep-cost-to-serve-publication
owner: unit-economics-pricing
measures: [fin.cost_to_serve_per_restaurant_month, fin.metered_invocation_coverage_pct]
changes: [finance.agenda_board, spend.cap_thresholds, strategy.model_inputs]
inputs_from: [inference-cost, engineering, reliability-sre]
outputs_to: [finance-pricing, strategy-fundraising, growth, decision-office]
close_time: monthly
status: gated
gated_on: "inference-cost callsite census — fin.metered_invocation_coverage_pct is unknown"
```

Counters [[unit-economics-pricing-premortem]] M3 — *an undercount presented as a cost*.

The figure is **computable today, and that is the danger.** Three verified reasons it is
systematically low: `api_spend.restaurant_id` is nullable and enrichment passes `None` by
design (`spend_logger.py:59`, index partial at `baseline:8555`); the NestJS runtime writes
no spend rows at all (0 grep hits in `apps/api-gateway/src`); infrastructure cost
(`~$10-20/month`, `.planning/PROJECT.md:136`) is not in the ledger.

**Gated on [[inference-cost-charter]]'s callsite census**, because the coverage fraction is
half the published string and it is currently unknown. When it un-gates, the output is one
inseparable string — lower bound, coverage %, "excluding infrastructure"
([[unit-economics-pricing-directive]]).

Feeds L-IC-5 / L-FIN-5's cap-adequacy rule: **a provider cap raise requires this figure as
its justification.** That is what makes a dormant team's single number load-bearing rather
than decorative.

---

## L-UEP-4 — Gross margin per restaurant-month · **GATED**

```yaml
type: loop
id: uep-gross-margin
owner: unit-economics-pricing
measures: [fin.gross_margin_per_restaurant_month, fin.acquisition_cost_per_activated_restaurant]
changes: [pricing.model, strategy.model_inputs, growth.channel_allocation]
inputs_from: [inference-cost, conversion-funnel, design-partner-operations, sales]
outputs_to: [strategy-fundraising, sales, growth, decision-office]
close_time: monthly
status: gated
gated_on: "entry trigger — first non-design-partner restaurant, or founder un-defers pricing"
```

The post-trigger mandate: margin per account, and acquisition cost attributable to
Growth's own content effort. **Undefined today** — there is no revenue, no processor, no
billing code, and no pricing decision.

Written now so that waking is a **transition with a defined output**, not an improvisation.
Its `status: gated` and `gated_on` are what
[[unit-economics-pricing-agenda-board]]'s dormancy query reads.

**On waking, this loop's first cycle produces a provenance finding, not a price**
([[unit-economics-pricing-directive]]).

---

## Close-time summary

| Loop | Close-time | Status | Counters |
|---|---|---|---|
| L-UEP-1 entry-trigger watch | weekly | **runs today** | M2 — dormancy became disappearance |
| L-UEP-2 price-quote register | weekly | **runs today** | M1 — the anchor before the model |
| L-UEP-3 cost-to-serve publication | monthly | **gated** on F1's census | M3 — undercount as cost |
| L-UEP-4 gross margin | monthly | **gated** on the entry trigger | — post-trigger mandate |

**M4 (wrote a pricing model anyway) and M5 (answered the target instead of informing it)
have no loops, deliberately.** Both are countered by *rules* enforced at review time — the
grep guard and the arithmetic/advocacy line in [[unit-economics-pricing-directive]]. A
loop that measured "how many prices did we propose" would only report the breach after it
happened, and one breach is the whole failure.
