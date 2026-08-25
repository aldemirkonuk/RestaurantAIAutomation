---
type: schedule
division: commercial
department: finance-pricing
team: inference-cost
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[inference-cost-charter]]", "[[inference-cost-loops]]", "[[inference-cost-agenda-board]]", "[[inference-cost-directive]]", "[[finance-pricing-schedule]]", "[[skills-charter]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[decision-office-charter]]"]
---

# Inference Cost — Schedule & Skills

## Recurring work

**One job here already runs in production.** It is the only scheduled job this sub-layer
inherits rather than proposes, and the distinction is marked rather than blurred.

| Cadence | Job | Emits |
|---|---|---|
| **Hourly · RUNNING** | `spend.monthly_cap_check` — `services/agent-orchestrator/jobs/spend_tasks.py:135`, registered `jobs/celery_app.py:80-84` as `crontab(minute=0)` with `expires: 3500`. Thresholds `$40` / `$16` at `spend_tasks.py:24-27`; duplicate suppression per provider+month via `spend_alert_state` (`:66,83`) | Breach email to `MANAGER_EMAIL`; `fin.cap_breach_count` |
| Daily | Meter liveness — L-IC-2. Row age correlated against **pipeline activity**, never against `api_spend` alone | `fin.hours_since_last_spend_row`, `fin.spend_rows_per_day` |
| Weekly | Cost-efficiency report to [[harness-model-routing-charter]] — L-IC-4. **Blocked** until `agent` / `task_type` land | `nf_a.cost_per_completed_task` + `nf_a.cost_per_api_call` (both or neither) |
| Monthly | Ledger ↔ invoice reconciliation — L-IC-1. **Manual until two consecutive months agree** | `fin.spend_reconciliation_variance_pct` |
| Monthly | Cap adequacy review — L-IC-5. Any proposed change requires a cost-to-serve figure | `fin.monthly_provider_spend_vs_cap_pct` |
| Quarterly | Model-callsite census — L-IC-3. Every invocation graded metered / un-metered / self-metered-and-discarded | `fin.metered_invocation_coverage_pct`, `fin.unmetered_callsite_count` |
| Quarterly | Infrastructure-cost line — Vercel / Supabase / Railway against the `~$10-20/mo` budget (`.planning/PROJECT.md:136`). A line item, not a team | Infrastructure total, reported beside inference total, never summed into it |
| Quarterly | Charter staleness sweep — untouched 60+ days is finished or fiction | Archive or revision |

**Why the census is quarterly rather than one-off.** Anthropic and Gemini are called over
**raw HTTP, not their SDKs** ([[EXTERNAL_CONNECTIONS]]:37). There is no library boundary
where a new callsite becomes metered automatically, so every callsite added between runs
is un-metered by default. The census is maintenance, not an audit — and its permanent fix
is RM-1's single call wrapper, which is why L-IC-3 outputs to
[[harness-model-routing-charter]].

**Anti-sprawl.** A job producing no action for **3 consecutive runs** is downgraded or
deleted (`foundation README §6`). Three no-action reconciliations and L-IC-1 drops to
quarterly. The rule applies to the running cap job too: if it alerts three times and the
only response is a threshold raise, the job is not producing action, it is producing
paperwork ([[inference-cost-premortem]] M5).

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Nothing below exists yet.** The repo holds exactly one project skill
(`.agents/skills/railway-config/SKILL.md`, `foundation README §3.1`). Each candidate is
tied to a job above and carries the four things `foundation README §3.3` requires —
trigger, doneability criterion, a real past instance, and an owner.

| Skill | Trigger | Doneability criterion | Real past instance |
|---|---|---|---|
| `spend-callsite-census` | Quarterly census; any PR adding a model call | Every model invocation in the repo appears in the census with a grade | `scripts/enrich_wines.py:342-349` and `scripts/extract_menu_corpus.py:302-307` both compute `cost_usd` into a local `manifest.json` no ledger reads. A census at authoring time would have caught both |
| `spend-reconciliation-pass` | Monthly L-IC-1 | A variance number exists for the month, signed off or escalated | Commit `8bbcde6` — a wine backfill deliberately run *"in-session instead of on API credits"*. Real, dated, off-ledger spend that no reconciliation would have missed |
| `spend-meter-liveness-check` | Daily L-IC-2 | Either row age under threshold, or an alert raised | `spend_logger.py:82-84` swallows every exception by contract; there is currently no path by which a broken meter announces itself |
| `cost-per-task-report` | Weekly L-IC-4 (blocked) | Cost-per-completed-task and cost-per-call published **together**, or neither | The cost-efficiency mandate is directional with no target; a report that shows only the falling number would satisfy it wrongly ([[inference-cost-premortem]] M4) |
| `spend-schema-bridge-review` | Any PR touching `api_spend` DDL | RM-3 sign-off recorded **and** a retirement condition present in the migration comment | OD-11 is open ([[OPEN-DECISIONS]]:20); RM-3's own premortem predicts five private footprints (`intelligence.md:178-181`) |

Ownership of the skill **registry** sits with [[skills-charter]] (Applied AI). This team
authors skills against its own jobs; it does not govern the registry.

## Dependencies this schedule assumes

| Assumption | Owner | State |
|---|---|---|
| A joinable doneability verdict exists | [[agent-evaluation-gates-charter]] *(RM-2)* | Not joinable today — blocks L-IC-4 |
| The NF event contract closes (OD-11) | [[neural-footprint-instrumentation-charter]] *(RM-3)* | Open — bridge columns are temporary until it lands |
| A single NestJS call wrapper exists | [[harness-model-routing-charter]] *(RM-1)* | Open (OD-03) — until then, 7 callsites stay un-metered or get 7 patches |
| Access to the Anthropic and Google billing consoles | Founder | Assumed, **not verified by this session** |
