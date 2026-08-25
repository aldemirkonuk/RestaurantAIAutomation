---
type: agenda-full
division: commercial
department: finance-pricing
sublayer_of: growth
status: provisional
metrics: [nf_a.cost_per_completed_task, fin.spend_attribution_coverage_pct, fin.metered_invocation_coverage_pct, fin.spend_reconciliation_variance_pct, fin.cost_to_serve_per_restaurant_month]
updated: 2026-08-24
links: ["[[finance-pricing-charter]]", "[[finance-pricing-premortem]]", "[[finance-pricing-agenda-board]]", "[[finance-pricing-directive]]", "[[finance-pricing-loops]]", "[[finance-pricing-schedule]]", "[[inference-cost-charter]]", "[[unit-economics-pricing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[harness-model-routing-charter]]", "[[strategy-fundraising-charter]]", "[[design-partner-operations-charter]]", "[[OPEN-DECISIONS]]", "[[commercial]]"]
---

# Finance & Pricing — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## The central open question: OD-23

**Recorded here, not resolved here.** [[OPEN-DECISIONS]]:27 carries it; only the founder
closes it.

> **OD-23 — $20k MRR in 30 days.** The Cowork master plan rates this **under 10% likely**
> against locked **$20–50/mo** self-serve pricing, and proposes either higher-ACV
> founder-led sales or counting *committed deals* rather than *collected cash*.

### The arithmetic, stated plainly

| Price point | Paying restaurants needed for $20k MRR | In 30 days |
|---|---|---|
| $50/mo | **400** | ~13 net new paying accounts per day |
| $20/mo | **1,000** | ~33 net new paying accounts per day |

Today the denominator is **one** — a friend's Turkish restaurant in San Francisco on
Toast (`.planning/PROJECT.md:127`) — and that one is **not yet connected**: `DEP-06:
Toast API credentials configured` is still unchecked (`.planning/PROJECT.md:101`, via
`commercial.md:361-363`). There is no payment processor among the 50 runtime hosts
([[EXTERNAL_CONNECTIONS]]), no `/pricing` route among the 51 web pages ([[PAGE_MAP]]),
and no billing code anywhere in the repo.

### What this sub-layer contributes to the question — and what it deliberately does not

**Does not:** pick a target, pick a price, pick between the two proposed alternatives, or
argue that the founder is wrong. Pricing is founder-deferred (`commercial.md:296-298`);
the revenue target is a founder call.

**Does** put four verified facts next to the question, because a founder call made
against arithmetic is a different call from one made against a feeling:

1. **The `$20–50/mo` "locked" price has no decision record.** OD-23's own text calls it
   locked. `.planning/decisions/` holds seven ADRs (0001–0007) and none concerns pricing
   — verified 2026-08-24. Under CLAUDE.md §0.1, *a choice not written in
   `.planning/decisions/` is open*. So OD-23 as written asks the founder to judge a
   target against a constraint that may not itself be decided. **That is a question about
   OD-23's premise, and it should be answered before the target is.**

2. **The founder's own written constraint points the other way.**
   `.planning/PROJECT.md:135` says **"No revenue pressure: Build right, not fast"**, and
   `:134` says **"Solo founder: Founder + Claude = 2-3 focused things per week"**. A $20k
   MRR sprint and "no revenue pressure" cannot both be operative. One of the two is
   stale. Naming which is a founder call and nothing else.

3. **The infrastructure the target implies does not exist and would breach its own
   budget.** The provider caps are sized for a pre-revenue single-tenant repo:
   `services/agent-orchestrator/jobs/spend_tasks.py:24-27` alerts at **$40** Anthropic /
   **$16** Google (80% of $50 / $20 hard caps), against a stated deployment budget of
   `~$10-20/month` (`.planning/PROJECT.md:136`). At 400 restaurants those thresholds
   would trip on the first day of the month, and the honest reading is that nobody has
   ever computed what 400 restaurants cost — because `fin.cost_to_serve_per_restaurant_month`
   has never been read (see below).

4. **"Committed deals rather than collected cash" is a measurement decision, and it has a
   precedent in this repo.** `.planning/YC_WEDGE_PLAN.md:31-33` already establishes the
   same distinction one layer down: *dollars recovered* currently means **we asked**, not
   **we received**, and [[design-partner-operations-charter]]'s primary metric is
   deliberately the verified half. If the company adopts committed-deal counting for
   revenue while holding the stricter standard for recovery, it is applying two different
   evidentiary bars to two numbers that will appear on the same slide. That is worth the
   founder knowing before choosing, and it is **not** an argument against the proposal.

### Verification gap on OD-23, stated plainly

[[OPEN-DECISIONS]]:27 sources this to `MASTER-PLAN-30-DAY-SPRINT-2026-08-24.md` §0.
**That file does not exist in the repository** — a repo-wide search for `MASTER-PLAN*`
returns nothing (verified 2026-08-24). The `<10%` likelihood estimate, the $20–50 range,
and the two proposed alternatives are therefore recorded here **as reported by OD-23**,
with no primary source available to check them against. Whoever resolves OD-23 should
locate that document first or restate its claims from scratch.

---

## What

Get from **"we log spend"** to **"we can answer what a task and a restaurant cost"** —
and hold the pricing slot empty while doing it.

Concretely, three things in sequence:

1. **Make cost-per-task-per-agent derivable.** It currently is not
   ([[inference-cost-agenda-full]]).
2. **Reconcile the ledger to a provider invoice once**, so the meter has ever been
   checked against ground truth.
3. **Publish exactly two numbers** — F1's and F2's — and never their sum.

### The state of every metric this sub-layer claims

| Metric | Owner | State today |
|---|---|---|
| `nf_a.cost_per_task_per_agent` | F1 | **Not derivable.** `SpendLogger.log()` (`spend_logger.py:41-48`) takes no `agent`; `api_spend` has no `agent` or `task_type` column (`20260805000000_baseline_from_production.sql:2229-2238`) |
| `fin.spend_attribution_coverage_pct` | F1 | **0%** at agent grain, by the above |
| `fin.metered_invocation_coverage_pct` | F1 | **Unknown** — no callsite census exists. Known: 16 metered Python callsites; **0** hits for `api_spend`/`cost_usd`/`input_tokens` anywhere in `apps/api-gateway/src`; 2 scripts computing cost locally and discarding it |
| `fin.spend_reconciliation_variance_pct` | F1 | **Never measured.** No reconciliation against a provider invoice has ever been run |
| `fin.hours_since_last_spend_row` | F1 | **Unmeasured.** No absence detector exists; the cap check cannot fire on an empty table |
| `fin.monthly_provider_spend_vs_cap_pct` | F1 | **Readable today** — `spend_tasks.py` already computes both halves |
| `fin.cost_to_serve_per_restaurant_month` | F2 | Computable, but a **systematic undercount** — `restaurant_id` is nullable, enrichment passes `None` by design (`spend_logger.py:59`), NestJS writes nothing |
| `fin.gross_margin_per_restaurant_month` | F2 | **Undefined** until the pricing decision exists |
| `fin.external_price_quotes_logged` | F2 | **Zero** — no register exists. It should exist before the pricing model does |

Six of nine have never been read. That is the honest opening position, and it is why the
first quarter's work is measurement rather than optimisation.

## How

**Sequence: attribute → reconcile → only then optimise.** The order is forced by
[[finance-pricing-premortem]] D2 — an unreconciled meter can fall while the invoice
climbs, so optimising against it would be optimising against a number nobody has checked.

1. **Callsite census before schema change.** Enumerate every model invocation in the repo
   and grade each *metered / un-metered / self-metered-and-discarded*. Three surfaces are
   already known (Python services, NestJS, scripts) and they need three different fixes.
   This is a document, not a migration, and it is week one.
2. **Coordinate with RM-3 before writing any column.**
   [[neural-footprint-instrumentation-charter]] owns the NF event contract and OD-11 is
   open ([[OPEN-DECISIONS]]:20). F1 owns the **money view**; RM-3 owns the **telemetry
   spine**. The bridge column on `api_spend` is agreed with RM-3 and carries a written
   retirement condition, or it becomes the fifth private footprint RM-3's own premortem
   predicts. **This is the single highest-value coordination in the sub-layer's first
   quarter.**
3. **Reconcile once, manually, before automating.** One month, two provider consoles, one
   variance number. If the variance is small the loop can be monthly forever; if it is
   large, everything downstream was fiction and we found out in week three instead of
   quarter four.
4. **Arm F2 without waking it.** Two things run pre-trigger and both are cheap: the
   trigger watch (a count query) and the price-quote register (one file). Everything else
   in F2 stays dormant.

## Why now

- **A founder decision is blocked on a number F1 cannot produce.** OD-04 (external model
  roster, [[OPEN-DECISIONS]]:15) explicitly needs *a cost/quality eval per task type*.
  Without `task_type` in the ledger there is no per-task-type cost. The cost-efficiency
  mandate — cheaper-model routing — is unactionable until F1 does its first assignment.
- **The un-metered surfaces are growing, not shrinking.** The NestJS side has seven model
  callsites and no telemetry; every new one makes the eventual retrofit larger. Raw HTTP
  rather than SDKs ([[EXTERNAL_CONNECTIONS]]:37) means each is an independent edit.
- **Real spend is already happening off-ledger.** Commit `8bbcde6` records a wine backfill
  deliberately run *"in-session instead of on API credits"*, and
  `scripts/enrich_wines.py:342-349` computes a cost figure it never persists. The ledger
  is not merely incomplete; it has known, dated, deliberate holes.
- **F2's window is closing quietly.** The anchor arrives before the model
  ([[finance-pricing-premortem]] D3), and a `$20–50` figure is already circulating in
  OD-23's own text with no decision record behind it.

## Next steps

- [ ] Publish the **model-callsite census** — every invocation, graded metered /
      un-metered / self-metered-discarded — [[inference-cost-charter]]
- [ ] Agree the `agent` + `task_type` bridge with
      [[neural-footprint-instrumentation-charter]] **before** any migration, with a
      written retirement condition tied to OD-11
- [ ] Add `agent` to `SpendLogger.log()` and to all 16 callsites **in one change** —
      partial adoption is [[inference-cost-premortem]] M2
- [ ] Run the **first ledger↔invoice reconciliation** by hand; record
      `fin.spend_reconciliation_variance_pct` even if it is bad — especially if it is bad
- [ ] Stand up the **absence alarm** (`fin.hours_since_last_spend_row`); the existing cap
      check structurally cannot fire on an empty table
- [ ] Open the **price-quote register** — [[unit-economics-pricing-charter]] — before any
      pricing model exists
- [ ] Arm the **entry-trigger query** (count of non-design-partner restaurants) as a
      scheduled check, not a memory
- [ ] Ask the founder for the **provenance of `$20–50/mo`**: ADR, or draft?
- [ ] Push the **OD-23 premise question** and the **missing MASTER-PLAN source** to
      [[decision-office-charter]]

## Questions for the founder

1. **OD-23 — but first, its premise.** Is `$20–50/mo` a decision or a draft? There is no
   ADR. If it is a draft, the `<10% likely` verdict is measuring the target against a
   constraint that is not fixed, and the two proposed alternatives (higher-ACV founder-led
   sales; counting committed deals) are choices about *pricing* as much as about the
   target. **Not resolved here.**
2. **Which of these two is stale?** `.planning/PROJECT.md:135` — "No revenue pressure:
   Build right, not fast" — or a $20k MRR 30-day sprint. Both are currently operative in
   writing.
3. **`SpendLogger.log()`'s `agent` parameter: required or optional?** Required makes a
   missed callsite fail loudly at import/test time, which is how the metric reaches 100%
   coverage. But the module header (`spend_logger.py:7-8`) states that spend logging must
   never interrupt the pipeline, and a required positional argument raises **outside** the
   `try` at `:61`. This is a real trade — coverage versus a stated contract — and it is
   the founder's, not F1's. See [[inference-cost-directive]].
4. **Are the caps still right?** `$40`/`$16` (80% of `$50`/`$20`) were set for a
   pre-revenue single-tenant repo. Any real load changes them. Should a cap raise require
   a cost-to-serve figure as justification — which would make F2's dormant single number
   load-bearing — or should the caps simply track observed spend?
5. **CM-F4 — parent department.** Every loop in [[finance-pricing-loops]] outputs to
   Research & Math, Strategy & Fundraising, or Sales; almost none to Growth. The
   placement is locked and this session did not re-argue it. Should the sub-layer report
   the pattern to [[decision-office-charter]] after a quarter of data, or leave CM-F4
   closed?
