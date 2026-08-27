---
type: agent-stack
division: commercial
department: finance-pricing
team: inference-cost
status: designed
updated: 2026-08-27
metrics: [nf_a.cost_per_completed_task, fin.spend_reconciliation_variance_pct, fin.spend_attribution_coverage_pct, fin.metered_invocation_coverage_pct, fin.hours_since_last_spend_row, fin.monthly_provider_spend_vs_cap_pct]
links: ["[[inference-cost-charter]]", "[[inference-cost-schedule]]", "[[inference-cost-loops]]", "[[inference-cost-directive]]", "[[inference-cost-premortem]]", "[[0034-agent-stack-artifact]]", "[[0016-ledgers-must-express-unknown]]", "[[finance-pricing-agent-stack]]", "[[model-routing-inference-economics-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[decision-office-charter]]"]
---

# Inference Cost — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only unit in Commercial whose substrate is real: a live ledger, a live cap job,
> and a metric nobody else in the org wants (`fin.spend_reconciliation_variance_pct`).
> The card is therefore an **auditor, not a controller** — it measures spend and never
> throttles, reroutes or re-prices it. Routing is
> [[model-routing-inference-economics-charter]]'s, the telemetry spine
> [[neural-footprint-instrumentation-charter]]'s; this team owns the money view of both.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `spend-ledger-auditor` | Keep the ledger's truth numbers true — reconciliation variance, meter liveness, attribution coverage, metered-invocation coverage — and never let a missing number read as zero | NEW |

## 2. Agent cards

```yaml
agent: spend-ledger-auditor
unit: inference-cost
triggers:
  - schedule: "daily — meter liveness (L-IC-2)"           # mirrored in [[inference-cost-schedule]]
  - schedule: "monthly — ledger ↔ invoice reconciliation (L-IC-1)"
  - schedule: "quarterly — model-callsite census (L-IC-3)"
  - topic: spend.cap_breached      # publisher: jobs/spend_tasks.py:135 — but it emits an EMAIL, not an event (gap, §5)
  - topic: model.call_site_added   # publisher: NONE (gap — raw HTTP, no library boundary; only the census or PR review notices)
consumes:
  - "public.api_spend rows (baseline:2229-2238) — publisher: spend_logger.py:365-377"
  - "neural_footprint_event cost + context.task_type (spend_logger.py:394-395,406) — publisher: [[neural-footprint-instrumentation-charter]]'s spine; gateway side at model-client.service.ts:413"
  - "provider invoices (Anthropic, Google consoles) — publisher: the founder, manually; console access assumed, NOT verified ([[inference-cost-schedule]] §Dependencies)"
  - "pipeline-activity signal for liveness correlation — publisher: NONE (gap, §5)"
emits:
  - "fin.spend_reconciliation_variance_pct → [[finance-pricing-agent-stack|fin-orchestrator]] board; >5% on to [[decision-office-charter]] ([[inference-cost-loops]] ic-ledger-invoice-reconciliation)"
  - "fin.metered_invocation_coverage_pct + fin.unmetered_callsite_count → [[model-routing-inference-economics-charter]] (L-IC-3 outputs_to), whose single wrapper is the permanent fix"
  - "fin.hours_since_last_spend_row, fin.monthly_provider_spend_vs_cap_pct → the same board"
  - nf_a events (task_type: spend_reconciliation | spend_census | meter_liveness)
routing_class: mechanical        # query, grep, subtract. Explaining a variance is not this agent's job — an unexplained >5% escalates rather than being narrated
quality_bar: "every figure is a query or grep a reviewer can rerun on the same commit; a month, model or callsite with no data reads 'unpriced' / 'not metered' / 'not measured', never 0 (ADR 0016 — locked; api_spend.cost_usd is nullable with no default). Cost-per-completed-task and cost-per-call ship together or neither ships. NONE (gap) — ADR 0017 defines no verdict grader for audits"
autonomy:
  read: autonomous
  propose: autonomous            # census tables, variance numbers and cap recommendations land as PRs
  mutate_stock_money_outbound: confirm   # constant — and here it is the subject matter: the auditor never raises a cap, never writes api_spend, never authors the migration ([[schema-migrations-charter]] does; we specify)
memory: inference-cost
escalates_to: "[[finance-pricing-charter]]"
```

**The card's own hard rules.** Nothing this agent does may make `SpendLogger.log()`
raise — the never-raise contract stands ([[inference-cost-directive]];
`spend_logger.py:429-431`). And the agent must not call a model to do its work: an
auditor that spends money to measure spend is its own variance.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `spend-callsite-census` | T2 | Quarterly L-IC-3; any PR adding a model call | Every model invocation in the repo appears with a grade — metered / un-metered / self-metered-and-discarded — and a `path:line` | `scripts/enrich_wines.py:342-349` and `scripts/extract_menu_corpus.py:302-307` both compute `cost_usd` into a local `manifest.json` no ledger reads. A census at authoring time catches both | NEW |
| `spend-reconciliation-pass` | T2 | Monthly L-IC-1 | A variance number exists for the month, signed off or escalated; "not run" is never rendered as 0% | Commit `8bbcde6` — a wine backfill deliberately run *"in-session instead of on API credits"*. Real, dated, off-ledger spend | NEW |
| `spend-meter-liveness-check` | T2 | Daily L-IC-2 | Either a row age under threshold **correlated against pipeline activity**, or an alert raised | `spend_logger.py:429-431` swallows every exception by contract (and `record_drop()` counts silently, `:378-385`) — there is no path today by which a broken meter announces itself. That is [[inference-cost-premortem]] M1 | NEW |
| `spend-schema-bridge-review` | T2 | Any PR touching `api_spend` DDL | RM-3 sign-off recorded **and** a retirement condition present in the migration comment (OD-11 is open) | ADR 0016 / OD-61: `api_spend.cost_usd` was `NOT NULL DEFAULT 0.0` and booked a false `$0.000000` for an unpriced model while `neural_footprint_event` correctly held `NULL` — a schema decision on this exact table, caught by a human re-reading it months later | NEW |

**Deliberately absent:** `cost-per-task-report`, which [[inference-cost-schedule]] lists.
Its past-instance column carries a rationale ([[inference-cost-premortem]] M4), not an
instance, and §3.3 rule 3 deletes such a row rather than keeping it as an aspiration. The
weekly L-IC-4 job stays a schedule trigger; the skill returns the first time the report
is actually attempted.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); model
pin and metering censuses on the Applied AI side ([[model-routing-inference-economics-agent-stack]]) — see the overlap row in §5.

## 4. Memory

- **Procedural** — the four §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: spend_reconciliation | spend_census | meter_liveness`,
  plus **the ledger itself**, which predates NF-A. Needs `context.provider` and
  `context.month` to slice a reconciliation without a join. Inherited limit:
  `api_spend` carries no `agent` or `task_type` column (`spend_logger.py:367-377`), so
  the per-agent episodic slice exists in the NF store and **not** in the money ledger.
- **Semantic** — `memory/` beside this file, index `inference-cost-MEMORY.md`. Four facts
  exist on day one, each with provenance: the callsite population (16 metered Python, 7
  gateway sites closed by P1, 2 self-metering scripts); the `$40`/`$16` thresholds at 80%
  of hard cap (`spend_tasks.py:24-27`); the one genuine unpriced row (`1d73fe73…`,
  `gemini-3.6-flash`, $0.000309 of a $0.923359 lifetime total — ADR 0016, deliberately
  not backfilled); and "no reconciliation has ever been run". `source` / `confidence` /
  `last_verified` per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Metrics. `spend_logger.py`,
  `spend_tasks.py` and the baseline migration are retrieval targets by `path:line` — the
  migration is a grep target, never a read (CLAUDE.md §2).

**Consolidation** — monthly, beside L-IC-1. Diff the census against last month's facts,
**failures first**: a callsite that went un-metered becomes a fact naming the commit that
added it; a variance >2% becomes a fact naming the mechanism (provider price change,
retry storm, unpriced model), never "cost went up"; a cap raised in response to a breach
becomes a failure fact, because three of those is [[inference-cost-premortem]] M5. Expire
facts unverified for 90 days; propose skill candidates. One PR; "no delta" stated.

## 5. Async contract

Loops ([[inference-cost-loops]]), NF-A events, board rows and memory PRs only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `spend.cap_breached` is an email, not an event | `spend_tasks.py:135` mails `MANAGER_EMAIL` and suppresses duplicates via `spend_alert_state` (`:66,83`). The agent learns of a breach by reading that state table, up to an hour late — the signal exists, a subscribable form does not |
| No pipeline-activity signal for L-IC-2 | Row age alone cannot separate a quiet week from a dead meter. That indistinguishability *is* [[inference-cost-premortem]] M1, and the daily loop cannot close honestly without an activity publisher |
| The provider invoice has no machine input | A human reads two consoles; access is assumed and unverified. Until two consecutive months agree, L-IC-1 is manual by design ([[inference-cost-schedule]]) |
| `nf_a.cost_per_completed_task` — **resolved 2026-08-27 (founder, ADR 0035)** | The most-covering unit produces: [[model-routing-inference-economics-charter]] owns the measurement at the model boundary; this team **fetches** it and turns it into unit economics — exactly both charters' non-goal lines, now binding. The measured ledger-grain divergence (`api_spend` lacks `task_type`; the NF row carries it — §6) is filed as evidence under **OD-29** (`OPEN-DECISIONS.md:35`), whose RM-1 half stays open |
| `model.call_site_added` has no publisher | Anthropic and Gemini are raw HTTP, not SDKs ([[EXTERNAL_CONNECTIONS]]:37), so there is no library boundary where a new callsite becomes metered. The quarterly census bounds the blind spot at 90 days — which is why L-IC-3 outputs to RM-1's single-wrapper mandate |

## 6. Evidence today

- **EXISTS — the ledger and the cap job.** `spend_logger.py` (single insertion point),
  `public.api_spend` (`baseline:2229-2238`, indexed `:8548`, `:8555`), caps
  `spend_tasks.py:24-27`, hourly job `:135` on `celery_app.py:80-84`,
  `tests/test_spend_logger.py`.
- **EXISTS — ADR 0016, built.** One `unpriced` determination above both writes
  (`spend_logger.py:357-363`), `cost_usd` nullable with no default, NF recording
  `cost_basis='unpriced_model'` (`:403-404`) — the quality_bar's foundation, in code.
- **PARTIAL — the grain, and it moved since the charter was written.** `log()` now takes
  keyword-only `agent` / `task_type` (`spend_logger.py:269-271`, P1) and writes
  `task_type` into the NF row (`:394-395`) — but the `api_spend` insert still carries
  the original seven fields (`:367-377`). Cost-per-task is becoming derivable from the
  **NF store**, not from the money ledger; the charter's day-one defect is narrowed, not
  closed, and the two ledgers now differ in grain.
- **NEW — the auditor, all four skills, and the memory layers.** Every metric is
  unmeasured today except `fin.monthly_provider_spend_vs_cap_pct`, which is readable.
