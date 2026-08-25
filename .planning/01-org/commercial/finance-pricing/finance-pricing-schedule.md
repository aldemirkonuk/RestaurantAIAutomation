---
type: schedule
division: commercial
department: finance-pricing
sublayer_of: growth
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[finance-pricing-charter]]", "[[finance-pricing-loops]]", "[[finance-pricing-agenda-board]]", "[[finance-pricing-directive]]", "[[inference-cost-schedule]]", "[[unit-economics-pricing-schedule]]", "[[skills-charter]]", "[[decision-office-charter]]"]
---

# Finance & Pricing — Schedule & Skills

## Recurring work

One job in this table **already runs in production**. Everything else is proposed, and
the distinction is marked rather than blurred.

| Cadence | Job | Emits |
|---|---|---|
| **Hourly · RUNNING** | Provider cap check — `spend.monthly_cap_check` (`services/agent-orchestrator/jobs/spend_tasks.py:135`), registered at `jobs/celery_app.py:80-84` as `crontab(minute=0)`, thresholds `$40`/`$16` at `spend_tasks.py:24-27`, duplicate suppression via `spend_alert_state` (`:66,83`) | Breach email to `MANAGER_EMAIL`; `fin.cap_breach_count` |
| Daily | Meter liveness — L-FIN-2. Hours since the last `api_spend` row, against pipeline activity | `fin.hours_since_last_spend_row`, `fin.spend_rows_per_day` |
| Weekly | Pricing entry-trigger watch — L-FIN-4. Count of restaurants that are not the design partner | `fin.non_design_partner_restaurant_count`; wakes [[unit-economics-pricing-charter]] |
| Weekly | Price-quote register sweep — every externally-quoted number, date, recipient, framing | `fin.external_price_quotes_logged` |
| Weekly | Cost-efficiency report to [[harness-model-routing-charter]] — L-FIN-3 | `nf_a.cost_per_completed_task` **(blocked until the agent/task grain exists)** |
| Monthly | Ledger ↔ invoice reconciliation — L-FIN-1. **Manual until two consecutive months agree** | `fin.spend_reconciliation_variance_pct` |
| Monthly | Cap adequacy — L-FIN-5. Spend against cap, with cost-to-serve as the justification for any change | `fin.monthly_provider_spend_vs_cap_pct` |
| Quarterly | Model-callsite census refresh — every model invocation graded metered / un-metered / self-metered-and-discarded | `fin.metered_invocation_coverage_pct` |
| Quarterly | Charter staleness sweep — anything untouched 60+ days is finished or fiction (`foundation README §3.3, §6`) | Archive or revision |
| Quarterly | CM-F4 placement report — `outputs_to` distribution across [[finance-pricing-loops]] | Recommendation to [[decision-office-charter]], or an explicit "no change" |

**Anti-sprawl, applied here first.** A scheduled job that produces no action for **3
consecutive runs** is downgraded or deleted (`foundation README §6`). This sub-layer is
the likeliest place in the org for a job to run forever and change nothing
([[finance-pricing-premortem]] D5), so the rule is stated in its own schedule rather than
inherited quietly. Three no-action reconciliations and L-FIN-1 drops to quarterly.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Nothing in this table exists yet.** The repo holds exactly one project skill
(`.agents/skills/railway-config/SKILL.md`, `foundation README §3.1`). Each candidate below
is tied to a scheduled job above — created against a job with a close-time, rather than
created and then justified.

| Proposed skill | Fires on | Owning team | Doneability criterion (`foundation README §3.3`) |
|---|---|---|---|
| `spend-callsite-census` | Quarterly census, and on any new model callsite in review | [[inference-cost-charter]] | Every model invocation in the repo appears in the census with a grade |
| `spend-reconciliation-pass` | Monthly L-FIN-1 | [[inference-cost-charter]] | A variance number exists for the month, signed off or escalated |
| `spend-meter-liveness-check` | Daily L-FIN-2 | [[inference-cost-charter]] | Either a row age under threshold, or an alert raised |
| `cost-per-task-report` | Weekly L-FIN-3 | [[inference-cost-charter]] | Both cost-per-completed-task and cost-per-call published together, or neither |
| `pricing-trigger-check` | Weekly L-FIN-4 | [[unit-economics-pricing-charter]] | The non-design-partner count is read and recorded, even when zero |
| `price-quote-register` | Any externally-quoted number | [[unit-economics-pricing-charter]] | The quote is in the register within one close-time of being sent |
| `no-price-proposed-guard` | Per PR touching this sub-layer | [[unit-economics-pricing-charter]] | No proposed price, tier or rate under `teams/unit-economics-pricing/` |

**Real past instance, per `foundation README §3.3` step 3** — no speculative skills:

- `spend-callsite-census` — `scripts/enrich_wines.py:342-349` and
  `scripts/extract_menu_corpus.py:302-307` both compute `cost_usd` and write it to a local
  `manifest.json` that no ledger ever reads. A census would have caught both at the time
  they were written.
- `spend-reconciliation-pass` — commit `8bbcde6` records a wine backfill deliberately run
  *"in-session instead of on API credits"*. Real spend, dated, off-ledger.
- `no-price-proposed-guard` — the `$20–50/mo` figure is already circulating as "locked"
  in [[OPEN-DECISIONS]]:27 with no ADR behind it. The guard's precedent is the repo's own
  grep guards, `scripts/check_no_direct_stock_writes.sh` and
  `scripts/check_no_guest_name_matching.sh`.

Ownership of the skill **registry** sits with [[skills-charter]] (Applied AI), not here.
This sub-layer authors skills; it does not govern the registry.
