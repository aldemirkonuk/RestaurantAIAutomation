---
type: agenda-full
division: commercial
department: finance-pricing
team: inference-cost
status: provisional
metrics: [nf_a.cost_per_completed_task, fin.spend_attribution_coverage_pct, fin.metered_invocation_coverage_pct, fin.spend_reconciliation_variance_pct, fin.hours_since_last_spend_row]
updated: 2026-08-24
links: ["[[inference-cost-charter]]", "[[inference-cost-premortem]]", "[[inference-cost-agenda-board]]", "[[inference-cost-directive]]", "[[inference-cost-loops]]", "[[inference-cost-schedule]]", "[[finance-pricing-agenda-full]]", "[[neural-footprint-instrumentation-charter]]", "[[harness-model-routing-charter]]", "[[schema-migrations-charter]]", "[[unit-economics-pricing-charter]]", "[[OPEN-DECISIONS]]"]
---

# Inference Cost — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

**Make cost per task per agent derivable, then prove the ledger is true.** In that order,
because a grain nobody has reconciled is a finer resolution of a possibly-wrong number.

The team starts from an unusual position for this org: the machinery **exists and runs**.
`SpendLogger` has 16 live callsites, `api_spend` has been collecting rows, and an hourly
cap job has been alerting since it was written. What does not exist is the ability to
answer the one question the team is named for.

### The first assignment, stated exactly

`SpendLogger.log()` takes no `agent`:

```python
# services/agent-orchestrator/services/spend_logger.py:41-48
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

and `api_spend` has eight columns, none of them `agent` or `task_type`
(`supabase/migrations/20260805000000_baseline_from_production.sql:2229-2238`).

So **cost per task per agent — NF-A's named metric (`foundation README §4.2`) — is not
derivable from what is currently logged.** Every downstream ambition of this team routes
through that one gap:

| Blocked thing | Why |
|---|---|
| The founder's cost-efficiency mandate | Cheaper-model routing needs to know which task types are expensive. There is no task type in the ledger |
| **OD-04** — external model roster ([[OPEN-DECISIONS]]:15) | Explicitly unblocked by *a cost/quality eval per task type*. A founder decision is blocked on this defect |
| **OD-03** — orchestration base ([[OPEN-DECISIONS]]:14) | Its bake-off is on *this repo's actual workloads*, which means per-workload cost |
| L-FIN-3 / L-IC-4 cost-efficiency loop | Marked `blocked` in [[inference-cost-loops]] for this reason |

### Metric state, honestly

| Metric | State today | What it would take to read it |
|---|---|---|
| `nf_a.cost_per_completed_task` | **Not derivable** | `agent` + `task_type` in the ledger, and a verdict join from RM-3's spine |
| `fin.spend_attribution_coverage_pct` | **0%** at agent grain | The same |
| `fin.metered_invocation_coverage_pct` | **Unknown** | A callsite census — a document, not a migration |
| `fin.spend_reconciliation_variance_pct` | **Never measured** | One month, two provider consoles, one afternoon |
| `fin.hours_since_last_spend_row` | **Unmeasured** | A daily query |
| `fin.monthly_provider_spend_vs_cap_pct` | **Readable today** | Nothing — `spend_tasks.py` already computes both halves |

Five of six have never been read, and **the cheapest of them (reconciliation) is the one
that validates all the others.**

## How

**Sequence: census → coordinate → instrument → reconcile.** Deliberately, census before
schema and coordinate before instrument.

### 1. Callsite census — week one, and it is a document

Enumerate every model invocation in the repo and grade each. Three surfaces already known
to differ:

| Surface | Count | State | Fix shape |
|---|---|---|---|
| Python services (`services/agent-orchestrator/`) | **16** non-test `.log()` calls across 9 files | Metered | Add `agent` / `task_type` at each |
| NestJS (`apps/api-gateway/src`) | **7** Anthropic callsites (`intelligence.md:64-73`) | **Zero telemetry** — grepping for `api_spend`, `cost_usd`, `input_tokens` returns **0 hits** | Needs a TS-side logger; adoption is [[harness-model-routing-charter]]'s wrapper question, not a per-file patch |
| Scripts | ≥2 — `scripts/enrich_wines.py:342-349`, `scripts/extract_menu_corpus.py:302-307` | **Self-metered and discarded** to a local `manifest.json` | Persist to `api_spend`, or grade the spend as deliberately off-ledger and say so |

The census is what makes `fin.metered_invocation_coverage_pct` computable. Until it
exists, the denominator of the coverage metric is a guess — and the charter's own
coverage number is honestly recorded as "unknown" rather than invented.

**Why raw HTTP makes this the shape it is.** Anthropic and Gemini are called without their
SDKs ([[EXTERNAL_CONNECTIONS]]:37), so there is no library boundary to instrument once.
Every callsite is an independent edit and a callsite added tomorrow inherits nothing. The
census is not a one-off audit; it is a **quarterly** job for exactly that reason
([[inference-cost-schedule]]).

### 2. Coordinate with RM-3 before writing any column

This is the highest-value coordination in the sub-layer's first quarter, and the boundary
is already agreed in the division docs:
**[[neural-footprint-instrumentation-charter]] owns the telemetry spine; F1 owns the money
view.** ([[finance-pricing-charter]] non-goals; `commercial.md:614`.)

The narrow bridge F1 proposes, and nothing wider:

- F1 adds **exactly two columns**: `agent` and `task_type`. Both are attribution — *whose
  money was this* — rather than telemetry.
- **Latency, retries and doneability verdict come by join** from RM-3's spine, never as
  F1 columns. If the spine is not ready, those dimensions report *unmeasured*
  ([[inference-cost-directive]]'s third grade).
- The bridge carries a **retirement condition written into the migration comment**, tied
  to OD-11 closing ([[OPEN-DECISIONS]]:20). Not into a planning doc — nobody finds those.
- [[schema-migrations-charter]] authors the DDL. F1 specifies it.

Skipping this step produces [[inference-cost-premortem]] M3, which is also the failure
RM-3's own premortem predicts (`intelligence.md:178-181`).

### 3. Instrument all 16 callsites in one change

Not thirteen next sprint. Sixteen is a one-sitting job and it never gets easier; partial
adoption produces a confident number over a fifth of the spend
([[inference-cost-premortem]] M2). If the parameter must stay optional, the column is
`NOT NULL DEFAULT 'unattributed'` so a gap is a visible row rather than an absent one.

### 4. Reconcile once, by hand, before automating

One month, two provider consoles, one variance number. Automating a reconciliation that
has never been performed encodes whatever the first script author assumed. If variance is
small, the loop is monthly forever. If it is large, everything downstream was fiction and
we learned it in week three instead of quarter four.

## Why now

- **A founder decision is blocked on a missing column.** OD-04 needs per-task-type cost.
  That is not a metrics nicety; it is a dependency in `OPEN-DECISIONS.md`.
- **The un-metered surface is growing.** Every new NestJS model callsite enlarges a
  retrofit that must be done callsite by callsite because these are raw HTTP calls.
- **Off-ledger spend is already dated and deliberate.** Commit `8bbcde6` — the wine
  backfill run *"in-session instead of on API credits"*. The ledger's holes are known and
  documented; what is missing is anyone accountable for closing them.
- **The caps are sized for a repo, not a business.** `$40` / `$16` against a `~$10-20/mo`
  deployment budget, with the one design partner **not yet connected** (`DEP-06` unchecked).
  OD-23 contemplates 400–1,000 restaurants ([[finance-pricing-agenda-full]]). Nobody has
  computed what that costs, and this team is the only one who could.

## Next steps

- [ ] Publish the **model-callsite census** — every invocation graded metered /
      un-metered / self-metered-discarded. Document, not migration
- [ ] Agree the **two-column bridge** (`agent`, `task_type`) with
      [[neural-footprint-instrumentation-charter]]; retirement condition in the migration
      comment, tied to OD-11
- [ ] Specify the DDL to [[schema-migrations-charter]]; `NOT NULL DEFAULT 'unattributed'`
      if the parameter stays optional
- [ ] Add `agent` + `task_type` to `SpendLogger.log()` and **all 16 callsites in one PR**
- [ ] Run the **first ledger ↔ invoice reconciliation** by hand; publish
      `fin.spend_reconciliation_variance_pct` even if it is bad
- [ ] Stand up the **absence alarm** — `fin.hours_since_last_spend_row` — correlating row
      age against pipeline activity, not against `api_spend` alone
- [ ] Decide the NestJS approach **with** [[harness-model-routing-charter]]: a TS-side
      logger, or instrumentation inside RM-1's single call wrapper. Not seven patches
- [ ] Grade the scripts' self-metered spend: persist, or declare deliberately off-ledger
- [ ] Take the **required-vs-optional parameter** question to the founder (Q3 below)

## Questions for the founder

1. **Required or optional `agent` parameter?** Required makes a missed callsite fail at
   test/import time, which is how coverage reaches 100%. But `spend_logger.py:7-8` states
   that spend logging must never interrupt the pipeline, and a required positional
   argument raises **outside** the `try` at `:61`. The counter-argument is that the
   never-raise contract concerns *runtime* Supabase failures, not signature mismatches,
   which are caught in CI. It is a genuine trade and the team should not make it alone.
2. **The seven NestJS callsites — instrument them, or wait for RM-1's wrapper?**
   Instrumenting now duplicates work RM-1 will redo; waiting leaves an entire runtime
   invisible for however long OD-03 takes. There is no cheap option.
3. **The scripts' spend — ledger or acknowledged exception?** `enrich_wines.py` already
   computes an accurate cost and writes it to `manifest.json`. Persisting it is small.
   Should historical off-ledger runs (commit `8bbcde6`) be backfilled, or is the ledger's
   start date simply stated?
4. **Cap policy.** Should a cap raise require a cost-to-serve figure from
   [[unit-economics-pricing-charter]] — making the dormant team load-bearing — or should
   caps simply track observed spend?
5. **What is the cost-efficiency target?** The mandate is directional ("cheaper"). A
   metric with no target cannot fail, and a team that cannot fail is not being measured.
   Is it a percentage reduction in `nf_a.cost_per_completed_task`, an absolute monthly
   ceiling, or cost per restaurant-month? Each implies a different first move.
