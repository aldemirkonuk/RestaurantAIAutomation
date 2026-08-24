---
type: premortem
division: commercial
department: finance-pricing
sublayer_of: growth
status: provisional
metrics: [fin.spend_reconciliation_variance_pct, fin.hours_since_last_spend_row, fin.external_price_quotes_logged, fin.monthly_provider_spend_vs_cap_pct]
updated: 2026-08-24
links: ["[[finance-pricing-charter]]", "[[finance-pricing-loops]]", "[[finance-pricing-directive]]", "[[inference-cost-premortem]]", "[[unit-economics-pricing-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[growth-charter]]", "[[OPEN-DECISIONS]]"]
---

# Finance & Pricing — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This sub-layer has failed. What happened?

Five mechanisms, most likely first. The first two are about **numbers that are wrong
while looking right**, which is the characteristic failure of a finance function and the
reason this sub-layer is not merged into Growth.

---

### D1 — One half laundered credibility onto the other

`.planning/foundation/teams/commercial.md:257-258` says the two teams are kept apart so
the one with live data cannot lend credibility to the one with none. The merge never
happened; the **reporting** merge did. A deck slide says "our unit economics", cites a
figure sourced from `api_spend`, and the reader hears *cost, price, and margin* when only
the first exists. Nobody lied. The slide had one number where the charter has two, and
one number is the whole failure.

**Earliest observable signal.** The **first** outward-facing artifact — deck, YC
application, investor email, [[narrative-collateral-charter]] one-pager — that contains a
single figure labelled "unit economics", "margin", or "CAC" and traces back to
`api_spend`. Not the third. The first.

**Counter-pressure.** Structural, not editorial. [[finance-pricing-agenda-board]] renders
the two teams as **two rows that cannot be summed**, and F2's row is the literal string
`no revenue — pricing deferred (OD-23)` until its entry trigger fires. Any artifact
combining an F1 figure with an F2 figure must carry both baselines verbatim, including
"never measured". [[unit-economics-pricing-directive]] escalates rather than approves.

---

### D2 — A silent logging failure looked exactly like a cheap month

`SpendLogger.log()` is designed never to raise: `spend_logger.py:82-84` catches every
exception and emits a `logger.warning`, and the module header at `:7-8` states the
contract explicitly — *a spend logging failure must not interrupt the extraction
pipeline*. That is correct engineering. It is also a reporting hazard, and the hazard is
worse than it first reads, because **the alarm shares the meter's blind spot**: the
hourly cap check sums `cost_usd` straight out of `api_spend`
(`spend_tasks.py:34-58`). If rows stop arriving — a rotated Supabase key, a schema
mismatch, a network partition — spend appears to fall and the cap check agrees. One
outage silences both the measurement and the thing that was supposed to notice.

Twelve months later, F1 has reported a falling cost per task for two quarters and the
provider invoice has been climbing the whole time. Nobody reconciled the two, because
reconciliation was never anyone's job.

**Earliest observable signal.** Any calendar month whose `api_spend` row count falls
while commits touching enrichment, extraction or agent runs keep landing. A cheaper month
that nobody made cheaper. Concretely: `fin.hours_since_last_spend_row` exceeding one
working day with the Celery beat schedule green.

**Counter-pressure.** Two, and both are cheap:

1. **An alarm that fires on absence.** L-FIN-2 in [[finance-pricing-loops]] measures
   `fin.hours_since_last_spend_row`. The existing cap check can only fire on a *large*
   sum; it is structurally incapable of firing on an *empty* one. Absence needs its own
   detector.
2. **Monthly human reconciliation** against the Anthropic and Google consoles —
   `fin.spend_reconciliation_variance_pct`, target ≤2%. This is the number that makes
   D2 visible, and it is the number F1 alone owns. Nobody else in the org wants it, which
   is precisely why it must be assigned.

---

### D3 — Pricing was anchored by the first invoice, and the anchor arrived before the model

`commercial.md:321-323` states it: pricing gets set implicitly by the first invoice the
founder sends a friend, and that number anchors the company before F2 writes its first
document. Deferring the decision is not the same as deferring the anchor.

The 2027 version is worse than a friendly invoice, because a number is already in
circulation: **OD-23's own text describes `$20–50/mo` self-serve pricing as *locked***
([[OPEN-DECISIONS]]:27) — and **no ADR in `.planning/decisions/` records that lock**
(verified 2026-08-24: seven ADRs, none about pricing). Under CLAUDE.md §0.1 a choice not
written in `.planning/decisions/` is open. So the company is carrying a price that is
simultaneously cited as settled and unrecorded as a decision. By 2027 it has been
repeated into three decks and a landing page and is unarguable by the time F2 wakes up.

**Earliest observable signal.** The first document outside `OPEN-DECISIONS.md` that cites
`$20–50` — or any monthly figure — without a link to a decision record. Also: any dollar
amount in an email to the design-partner restaurant.

**Counter-pressure.** F2 keeps a **price-quote register** from day one, before it has a
pricing model: every externally-quoted number, its date, its recipient, and whether it was
framed as final. This is runnable today, is one file, and turns an invisible anchoring
process into a list somebody can read. Metric: `fin.external_price_quotes_logged`. And
F2's first act on waking is to demand the provenance of `$20–50` — either an ADR exists,
or the range is a draft and F2 says so in writing.

---

### D4 — The parent department consumed nothing this sub-layer produced

Finance & Pricing sits under Growth ([[ORG_STRUCTURE]] §2). Its outputs go to Research &
Math (routing economics), Strategy & Fundraising (the model), and Sales (what an account
is worth). Growth consumes essentially none of it. Twelve months in, the sub-layer's
review cadence is a Growth meeting where the cost-per-task number is the last item and
gets three minutes, while the two units that actually need it never see the number
because it does not route to them.

This is **CM-F4** (`commercial.md:632`), raised and deliberately not argued in that
document. The failure is not the placement; it is the placement going unexamined for a
year because nobody instrumented it.

**Earliest observable signal.** Three consecutive close-times in which every loop's
`outputs_to` field in [[finance-pricing-loops]] names a unit **outside** Commercial. That
is a fact about the frontmatter, checkable by a query, not a matter of opinion.

**Counter-pressure.** The loops carry `inputs_from` / `outputs_to` as structured fields
precisely so this is measurable ([[ORG_STRUCTURE]] §5). If the pattern holds for a
quarter, [[finance-pricing-directive]] escalates CM-F4 to [[decision-office-charter]]
**with the loop table attached**. The placement stays locked until the founder moves it;
what changes is that the argument arrives with evidence.

---

### D5 — The sub-layer became a spreadsheet nobody read

Two teams, one dormant by design and one whose visible job is summing a table. After
three quarters, no decision has been changed by anything either produced. The cost-per-task
number is published monthly and referenced never. `foundation README §6` already names the
remedy — *a scheduled job that produces no action for 3 consecutive runs gets downgraded
or deleted* — and the temptation will be to exempt finance from it because finance feels
like it ought to exist.

**Earliest observable signal.** Three consecutive monthly reconciliations that produce no
action: no cap change, no routing recommendation to
[[harness-model-routing-charter]], no escalation, no correction.

**Counter-pressure.** Apply the anti-sprawl rule to this unit **first**, publicly.
[[finance-pricing-schedule]] carries the rule inline. Three no-action runs and the
monthly reconciliation drops to quarterly and F2's dormancy is re-argued rather than
assumed. A finance function that cannot show a decision it changed is overhead, and
saying so in the founding document is cheaper than discovering it in a year.

---

## Cross-cutting counter-pressure

- **The two teams' premortems are not this one.** [[inference-cost-premortem]] covers the
  measurement mechanics; [[unit-economics-pricing-premortem]] covers dormancy and the
  temptation to price anyway. This document covers what fails *between* them.
- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] should attack
  D3 hardest — the `$20–50` provenance gap is exactly a decision worth attacking — and
  [[decision-office-charter]] owns whether OD-23 closes or drifts.
- **Anti-sprawl applies to this document.** Nothing here revisited in 60 days is fiction
  (`foundation README §3.3, §6`).
