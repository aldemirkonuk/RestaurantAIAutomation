---
type: charter
division: commercial
department: finance-pricing
sublayer_of: growth
status: partial
metrics: [nf_a.cost_per_completed_task, fin.spend_reconciliation_variance_pct, fin.spend_attribution_coverage_pct, fin.metered_invocation_coverage_pct, fin.cost_to_serve_per_restaurant_month]
updated: 2026-08-24
links: ["[[finance-pricing-premortem]]", "[[finance-pricing-agenda-full]]", "[[finance-pricing-agenda-board]]", "[[finance-pricing-directive]]", "[[finance-pricing-loops]]", "[[finance-pricing-schedule]]", "[[inference-cost-charter]]", "[[unit-economics-pricing-charter]]", "[[growth-charter]]", "[[ORG_STRUCTURE]]", "[[commercial]]", "[[OPEN-DECISIONS]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[strategy-fundraising-charter]]", "[[design-partner-operations-charter]]"]
---

# Finance & Pricing — Charter

> **This is a sub-layer, not a department.** Finance & Pricing sits **under Growth**
> ([[ORG_STRUCTURE]] §2 — Commercial: Growth · Sales · Media & Brand, with
> *Finance & Pricing (under Growth)* as the division's only sub-layer). It is written
> with the same 7-artifact anatomy every department gets, because the artifact set is
> the contract ([[ORG_STRUCTURE]] §4), but it does not have department standing: it has
> no peer seat next to Growth, Sales and Media & Brand, and its escalation path runs
> through [[growth-charter]] to the founder.
>
> That placement is itself contested — **fork CM-F4**
> (`.planning/foundation/teams/commercial.md:632`): unit economics feeds Strategy &
> Fundraising and Sales more than it feeds Growth. The placement is **locked and not
> re-argued here**; [[finance-pricing-loops]] instruments it instead, so whoever
> revisits CM-F4 has evidence rather than an opinion.

Division **Commercial** → Department [[growth-charter]] → Sub-layer `finance-pricing`
(`.planning/foundation/teams/commercial.md:255-333`).

## Mandate

Finance & Pricing is accountable for **what the company spends to run one agent task and
what it costs to serve one restaurant** — and, when the founder un-defers it, for the
pricing decision that turns the second number into a margin. Two teams, deliberately
unequal: [[inference-cost-charter]] has live data flowing today;
[[unit-economics-pricing-charter]] has none and is chartered dormant behind an explicit
trigger. The sub-layer's first duty is to keep those two facts visibly separate.

## Boundaries

Owns outright:

- **The money view of model spend** — the `public.api_spend` ledger, its attribution
  grain, its reconciliation against the provider invoice, and the budget caps that read
  from it. Owned by [[inference-cost-charter]].
- **Provider budget caps and breach handling** — the hourly cap check at
  `services/agent-orchestrator/jobs/spend_tasks.py:135` against the thresholds at `:24-27`.
- **Cost to serve one restaurant** — per-account attribution derived from
  `api_spend.restaurant_id`. Owned by [[unit-economics-pricing-charter]].
- **The pricing decision, when it un-defers** — ownership only. **No pricing model, tier
  or number is proposed anywhere in this sub-layer** (see non-goals).
- **The register of every price ever quoted externally** — because the anchor arrives
  before the model ([[finance-pricing-premortem]] D4).

| Team | The question it owns | Evidence |
|---|---|---|
| [[inference-cost-charter]] | What did this task cost, and does that number match the invoice? | **EXISTS** |
| [[unit-economics-pricing-charter]] | What does one restaurant cost to serve, and what is it worth? | **NEW** — dormant, trigger-gated |

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| **Proposing a pricing model, tier, or number** | The founder — **explicitly deferred** (`commercial.md:296-298`) | We own the decision *slot*, not the decision. See [[unit-economics-pricing-directive]] |
| Which model runs which task | [[harness-model-routing-charter]] *(Intelligence → Research & Math)* | We own the economics; RM-1 owns the routing decision it feeds (`commercial.md:614`) |
| The neural-footprint event contract, schema, join keys, emission | [[neural-footprint-instrumentation-charter]] *(RM-3)* | **RM-3 owns the telemetry spine; F1 owns the money view of it.** Stated here so the two are not built twice |
| Whether an agent output was good enough | [[agent-evaluation-gates-charter]] *(RM-2)* | Our denominator is a *passing* verdict; we do not issue the verdict |
| The fundraising model and the YC path | [[strategy-fundraising-charter]] *(Corporate)* | F2 supplies inputs; Strategy owns the model (`commercial.md:333`) |
| Billing, invoicing, payment collection | Nobody — **no revenue, no processor, no invoices** | Chartering RevOps would be fiction (`commercial.md:331`) |
| Infrastructure cost (Vercel/Supabase/Railway) | A line item **inside** [[inference-cost-charter]], not a team | Real but tiny: `~$10-20/mo` (`.planning/PROJECT.md:136`) |
| The revenue target itself | Founder — **OD-23 is open** | We record the arithmetic; we do not set or resolve the target |

## Metrics it moves

The sub-layer publishes **two independent numbers and never one**. Combining a measured
F1 figure with an unmeasured F2 figure into a single "finance" number is the specific
failure [[finance-pricing-premortem]] D1 exists to prevent.

| Metric | Owner | Baseline today |
|---|---|---|
| `nf_a.cost_per_completed_task` | F1 | **Not derivable** — no task or agent identifier is logged |
| `fin.spend_reconciliation_variance_pct` | F1 | **Never measured** — no reconciliation against a provider invoice has ever been run |
| `fin.spend_attribution_coverage_pct` | F1 | **0%** for agent grain — `api_spend` has no `agent` column |
| `fin.metered_invocation_coverage_pct` | F1 | **Unknown** — 16 metered Python callsites, 7 un-metered NestJS callsites, 2 scripts that compute cost and discard it |
| `fin.cost_to_serve_per_restaurant_month` | F2 | Computable but a **systematic undercount** (see F2 charter) |
| `fin.gross_margin_per_restaurant_month` | F2 | **Undefined** — requires the pricing decision |

Neural-footprint tie: `cost` is one of the eight NF-A fields (`foundation README §4.2`),
and it is the **only** one this sub-layer owns. The other seven belong to
[[neural-footprint-instrumentation-charter]]. F1 is a *consumer of the spine and the
owner of the money column*, which is why the two units are not the same team.

## Evidence today

**PARTIAL as a sub-layer** — because its halves are graded oppositely, and the honest
grade for the pair is neither team's grade.

### F1 — EXISTS, and it is the strongest evidence in the Commercial division

- `services/agent-orchestrator/services/spend_logger.py` — the single insertion point.
  `SpendLogger.log()` at `:41-49` writes `provider`, `model`, `input_tokens`,
  `output_tokens`, `cost_usd`, `restaurant_id`, `timestamp` (`:71-81`).
- **The table** — `public.api_spend`, eight columns, at
  `supabase/migrations/20260805000000_baseline_from_production.sql:2229-2238`; indexed
  provider+timestamp (`:8548`) and restaurant+timestamp (`:8555`, partial on
  `restaurant_id IS NOT NULL`).
- **Live callsites** — 16 non-test `.log()` calls across 9 files under
  `services/agent-orchestrator/` (`agents/provider_communication_agent.py`,
  `agents/visual_verification_agent.py`, `jobs/{score,web_verify,research}_tasks.py`,
  `services/{vlm_extraction,web_verification,haiku_enrichment,claude_vision_extractor}*.py`).
- **Caps, running hourly** — `services/agent-orchestrator/jobs/spend_tasks.py:24-27` sets
  Anthropic **$40.00** / Google **$16.00** (80% of $50 / $20 hard caps); the task is
  registered on Celery beat at `jobs/celery_app.py:80-84` (`crontab(minute=0)`), with
  duplicate-alert suppression via `spend_alert_state` (`spend_tasks.py:66,83`).

### The three defects this sub-layer inherits on day one

1. **`SpendLogger.log()` has no `agent` parameter** (`spend_logger.py:41-48`), and
   `api_spend` has no `agent` or `task_type` column
   (`20260805000000_baseline_from_production.sql:2229-2238`). NF-A's named metric — *cost
   per task per agent* (`foundation README §4.2`) — is **not derivable from what is
   currently logged**. This is F1's first real assignment
   ([[inference-cost-agenda-full]]).
2. **The NestJS runtime emits nothing.** Grepping `apps/api-gateway/src` for `api_spend`,
   `cost_usd` or `input_tokens` returns **zero hits** — verified 2026-08-24 — so the seven
   production Anthropic callsites enumerated at
   `.planning/foundation/teams/intelligence.md:64-73` run with no cost telemetry at all.
3. **Scripts compute cost and throw it away.** `scripts/enrich_wines.py:342-349` and
   `scripts/extract_menu_corpus.py:302-307` calculate `cost_usd` from hardcoded per-token
   prices and write it to a local `manifest.json`. Neither touches `api_spend`. Real money
   was spent this way — commit `8bbcde6` (*"run the wine backfill in-session instead of on
   API credits"*) is that decision in the log.

**Compounding factor:** Anthropic and Gemini are called over **raw HTTP, not their SDKs**
(`.planning/foundation/EXTERNAL_CONNECTIONS.md:37`), so retry, timeout and token
accounting are hand-rolled **per callsite**. There is no library-level place to add
instrumentation once; every measurement F1 wants costs a per-callsite edit. That is the
direct reason defects 1–3 exist as three separate problems rather than one.

### F2 — NEW, deliberately dormant

No revenue, no billing code, no payment processor among the 50 runtime hosts
([[EXTERNAL_CONNECTIONS]]), and no `/pricing` route among the 51 web pages
([[PAGE_MAP]]). The single existing ingredient is per-restaurant cost attribution via
`api_spend.restaurant_id`. **Entry trigger:** the first restaurant that is not the design
partner, or the founder un-deferring pricing — whichever comes first
(`commercial.md:313-316`).

## Open forks touching this sub-layer

- **OD-23** — `$20k MRR in 30 days` against `$20–50/mo` pricing
  ([[OPEN-DECISIONS]]:27). Central open question in [[finance-pricing-agenda-full]].
  **Not resolved here.**
- **CM-F4** — Is Growth the right parent? (`commercial.md:632`) Locked; instrumented by
  [[finance-pricing-loops]] L-FIN-3 and L-FIN-5, whose `outputs_to` are almost entirely
  outside Commercial.
- **OD-11** — The NF column contract ([[OPEN-DECISIONS]]:20). Until it closes, any column
  F1 adds to `api_spend` is a bridge with a retirement condition, not a schema decision.
- **OD-04** — External model roster ([[OPEN-DECISIONS]]:15). Depends on cost/quality per
  task type — a number F1 currently **cannot produce**, which makes defect 1 a blocker on
  a founder decision, not only a metrics gap.
