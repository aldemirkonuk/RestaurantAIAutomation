---
type: charter
division: commercial
department: finance-pricing
team: inference-cost
status: exists
metrics: [nf_a.cost_per_completed_task, fin.spend_reconciliation_variance_pct, fin.spend_attribution_coverage_pct, fin.metered_invocation_coverage_pct, fin.hours_since_last_spend_row, fin.monthly_provider_spend_vs_cap_pct]
updated: 2026-08-24
links: ["[[finance-pricing-charter]]", "[[inference-cost-premortem]]", "[[inference-cost-agenda-full]]", "[[inference-cost-agenda-board]]", "[[inference-cost-directive]]", "[[inference-cost-loops]]", "[[inference-cost-schedule]]", "[[unit-economics-pricing-charter]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[agent-evaluation-gates-charter]]", "[[integration-engineering-charter]]", "[[EXTERNAL_CONNECTIONS]]", "[[OPEN-DECISIONS]]"]
---

# Inference Cost — Charter

Division **Commercial** → Department [[growth-charter]] → Sub-layer
[[finance-pricing-charter]] → Team `inference-cost` (F1,
`.planning/foundation/teams/commercial.md:262-291`).

## Mandate

Own **what a model call costs and whether that number is true**: cost per agent task, per
model, per provider; budget caps and breach handling; and the reconciliation that proves
the ledger matches the invoice. F1 is the economic input to model-routing decisions — it
supplies the money, [[harness-model-routing-charter]] makes the call.

The founder's cost-efficiency mandate — **reduce inference cost by routing to cheaper
models where they suffice** — is this team's reason to exist. It cannot currently be
acted on, because the number it depends on is not derivable from what is logged. Fixing
that is the team's first assignment, not a stretch goal.

## Boundaries

Owns outright:

- **The `public.api_spend` ledger** — its grain, its attribution, its completeness, and
  the definition of every metric computed from it.
- **`SpendLogger`** — `services/agent-orchestrator/services/spend_logger.py`, the single
  insertion point for every Claude and Gemini call on the Python side, and the adoption
  of whatever replaces it on the NestJS side.
- **Provider budget caps** — the thresholds at
  `services/agent-orchestrator/jobs/spend_tasks.py:24-27` and the hourly breach job at
  `:135`.
- **Reconciliation against the provider invoice** — the only check that the ledger is
  true rather than merely present. Nobody else in the org wants this number, which is why
  it is named here.
- **The model-callsite census** — the roster of every model invocation in the repo,
  graded by whether it is metered.
- **Infrastructure cost as a line item** — Vercel/Supabase/Railway, `~$10-20/mo`
  (`.planning/PROJECT.md:136`). A line, not a team (`commercial.md:332`).

## Distinct from its sibling because

Per-**task** grain, and its consumer is [[harness-model-routing-charter]]'s routing loop,
not a revenue conversation. It is also the only part of this sub-layer with real data
today — which is exactly why it must stay separate from
[[unit-economics-pricing-charter]]: a merged unit would let "we have cost data" be heard
as "we have unit economics" (`commercial.md:257-258`, `:302-304`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| **Which model runs which task** | [[harness-model-routing-charter]] *(RM-1)* | We price the options; RM-1 chooses. `commercial.md:614` |
| **The NF event contract** — schema, join keys, emission, retention | [[neural-footprint-instrumentation-charter]] *(RM-3)* | **RM-3 owns the telemetry spine; we own the money view of it.** We do not build a second footprint |
| Whether an agent's output passed | [[agent-evaluation-gates-charter]] *(RM-2)* | Our denominator is a *passing* verdict; we do not issue verdicts |
| Retry, timeout, circuit-breaking at the callsite | [[harness-model-routing-charter]] | Hand-rolled today because these are raw HTTP calls ([[EXTERNAL_CONNECTIONS]]:37); we measure the cost of retries, we do not own the retry policy |
| Cost per **restaurant**, margin, pricing | [[unit-economics-pricing-charter]] | Per-task versus per-account. Different grain, different consumer |
| Writing the migration that carries a new column | [[schema-migrations-charter]] *(Platform)* | We specify; they author |

## Metrics it moves

**Primary: `nf_a.cost_per_completed_task`**, by task type — the NF-A `cost` field
(`foundation README §4.2, §4.4`). Denominator is a task carrying a **passing** doneability
verdict, never an API call: a retried failure is cost with no task.

**The metric F1 alone owns: `fin.spend_reconciliation_variance_pct`.** |ledger − invoice|
÷ invoice, monthly. Target ≤2%; >5% escalates. No other team in the org wants this
number, and without it every other number here is unchecked
([[inference-cost-premortem]] M1).

| Metric | Direction | Baseline today |
|---|---|---|
| `nf_a.cost_per_completed_task` | down | **Not derivable** |
| `fin.spend_reconciliation_variance_pct` | to zero | **Never measured** |
| `fin.spend_attribution_coverage_pct` | to 100% | **0%** at agent grain |
| `fin.metered_invocation_coverage_pct` | to 100% | **Unknown** — no census |
| `fin.hours_since_last_spend_row` | low | **Unmeasured** |
| `fin.monthly_provider_spend_vs_cap_pct` | informational | **Readable today** |

Neural-footprint tie: `cost` is one of eight NF-A fields and the **only one this team
owns**. `.planning/foundation/teams/intelligence.md:161-167` records the state of the
other seven — no single row anywhere holds more than four, and the NestJS surface holds
none.

## Evidence today

**EXISTS — the strongest evidence in the Commercial division** (`commercial.md:271-283`).
Verified independently 2026-08-24.

### What is real and running

| Component | Location | What it does |
|---|---|---|
| Single insertion point | `services/agent-orchestrator/services/spend_logger.py:41-49` | `SpendLogger.log(provider, model, input_tokens, output_tokens, cost_usd, restaurant_id)` |
| The write | `spend_logger.py:71-81` | Inserts one `api_spend` row with a UTC timestamp |
| The table | `supabase/migrations/20260805000000_baseline_from_production.sql:2229-2238` | `public.api_spend` — **eight columns**: `id`, `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `restaurant_id`, `timestamp` |
| Indexes | same file `:8548`, `:8555` | provider+timestamp; restaurant+timestamp (partial, `WHERE restaurant_id IS NOT NULL`) |
| Caps | `services/agent-orchestrator/jobs/spend_tasks.py:24-27` | Anthropic **$40.00**, Google **$16.00** — 80% of $50 / $20 hard caps |
| Cap job | `spend_tasks.py:135`, scheduled `jobs/celery_app.py:80-84` | Hourly (`crontab(minute=0)`), idempotent per provider+month via `spend_alert_state` (`:66,83`) |
| Live callsites | 16 non-test `.log()` calls across 9 files | `agents/provider_communication_agent.py`, `agents/visual_verification_agent.py`, `jobs/{score,web_verify,research}_tasks.py`, `services/{vlm_extraction,web_verification,haiku_enrichment,claude_vision_extractor}*.py` |
| Tests | `tests/test_spend_logger.py` | Field insertion, unconfigured-Supabase path, never-raises, singleton |

### The defect this team inherits on day one

**`SpendLogger.log()` has no `agent` parameter** — `spend_logger.py:41-48`:

```python
def log(
    self,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    restaurant_id: Optional[str] = None,
) -> None:
```

And `api_spend` has no `agent` or `task_type` column
(`20260805000000_baseline_from_production.sql:2229-2238`). NF-A's named metric — **cost
per task per agent** (`foundation README §4.2`) — is therefore **not derivable from what
is currently logged**. Not hard to compute: not present. This is F1's first real
assignment ([[inference-cost-agenda-full]]).

It is not merely a metrics gap. **OD-04** ([[OPEN-DECISIONS]]:15) — the external model
roster — is unblocked by *a cost/quality eval per task type*. Without `task_type` in the
ledger there is no per-task-type cost, so a founder decision is blocked on this defect.

### Two further un-metered surfaces, verified

1. **NestJS emits nothing.** Grepping `apps/api-gateway/src` for `api_spend`, `cost_usd`
   or `input_tokens` returns **zero hits**. The seven production Anthropic callsites
   enumerated at `.planning/foundation/teams/intelligence.md:64-73` — `analytics/consultants`,
   `common/orchestrator/inbound-responder`, `procurement/documents/document-extractor`,
   `menus/parsers/scan-parser`, `inventory/photo-count`, `vendor-intel/vendor-page-extractor`,
   `ux-optimizer` — run with no cost telemetry at all. One of them is
   **reachable unauthenticated** ([[OPEN-DECISIONS]] OD-20), meaning anonymous spend on
   the founder's key would also be invisible to this ledger.
2. **Scripts self-meter and discard.** `scripts/enrich_wines.py:342-349` and
   `scripts/extract_menu_corpus.py:302-307` compute `cost_usd` from hardcoded per-token
   prices into a local `manifest.json`. Neither writes `api_spend`. Commit `8bbcde6`
   records the wine backfill run *"in-session instead of on API credits"* — dated,
   deliberate, off-ledger spend.

### Why all three defects exist separately

Anthropic and Gemini are called over **raw HTTP, not their SDKs**
([[EXTERNAL_CONNECTIONS]]:37, `foundation README §0` item 5). There is no library boundary
where instrumentation could be added once. Retry, timeout and token accounting are
hand-rolled **per callsite** — so every measurement this team wants costs an edit at every
callsite, and a callsite added tomorrow inherits nothing. That single fact explains why
the ledger has three different completeness states in three different runtimes, and it is
the strongest argument in the repo for [[harness-model-routing-charter]]'s single-wrapper
mandate.

## Open forks touching this team

- **OD-11** — NF column contract ([[OPEN-DECISIONS]]:20). Any column F1 adds to
  `api_spend` before OD-11 closes is a **bridge with a written retirement condition**,
  agreed with [[neural-footprint-instrumentation-charter]]. Not a schema decision.
- **OD-04** — external model roster. Blocked on a per-task-type cost F1 cannot yet
  produce.
- **OD-03** — orchestration base. The bake-off it calls for needs a per-workload cost
  number from this team.
- **OD-20** — unauthenticated analytics endpoints driving `claude-opus-4-8`. Not F1's to
  fix, but it is F1's ledger that would fail to show the spend.
- **Required or optional `agent` parameter?** — a real trade between metric coverage and
  the module's stated never-raise contract. See [[inference-cost-directive]].
