---
type: spec
id: P1
title: NF-A Instrumentation
status: proposed
updated: 2026-08-24
owner: research-math
blocks: [OD-03, OD-04, OD-11]
links: ["[[PLAN]]", "[[AGENDA]]", "[[research-math-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[people-agent-ops-charter]]", "[[inference-cost-charter]]"]
---

# P1 — NF-A Instrumentation

> **The bottleneck spec.** 476 of 482 loops cannot run because the system does not
> measure itself. This is the smallest change that unblocks the most.
> Docs first per [ADR 0002](../decisions/0002-documentation-first-operating-mode.md);
> the schema half is a **founder decision** (OD-11) and is presented as options, not a pick.

## 1. What is actually broken

Three defects, each verified in source. Together they mean **"what did this agent's
reasoning cost?" is unanswerable by query** — not hard, *impossible*.

| # | Defect | Evidence |
|---|---|---|
| D1 | `SpendLogger.log()` takes **no `agent` and no `task_type`** | `services/agent-orchestrator/services/spend_logger.py:41-49` — params are `provider, model, input_tokens, output_tokens, cost_usd, restaurant_id` |
| D2 | `api_spend` has **no agent column and no `correlation_id`**; `decision_log` has `correlation_id` and `agent_name` but **no cost**. **No key joins them.** | `baseline_from_production.sql` — `api_spend` (8 cols), `decision_log` (10 cols) |
| D3 | The **entire NestJS gateway writes nothing**. 7 raw-HTTP model call sites, zero reach `api_spend` | `grep -c api_spend apps/api-gateway/src` → 0 |

D3 is the widest hole: every gateway model call — including `claude-opus-4-8` in the
consultants path — is invisible to the ledger.

## 2. What P1 delivers

`nf_a.cost_per_completed_task` becomes a real query, per agent and per task type,
across **both runtimes**. Concretely:

```sql
-- impossible today, the point of P1
select d.agent_name, s.task_type,
       count(*) tasks, sum(s.cost_usd) cost, avg(s.cost_usd) avg_cost
from api_spend s join decision_log d using (correlation_id)
group by 1,2 order by cost desc;
```

## 3. Scope

**In:** `SpendLogger` signature · `api_spend` columns + indexes · a gateway-side emitter ·
backfill posture for existing rows · one CI guard so a new model call site cannot skip the ledger.

**Out:** NF-B (guest), NF-C (gated), the research store, retention/rollup policy,
dashboards. P1 is emission only — *observe before deciding* ([[PLAN]] §3).

## 4. ⬦ The founder decision — OD-11, three paths

The column contract is open. All three make the §2 query work; they differ in cost now
versus cost later.

### Path A — Minimal join *(Claude's recommendation)*
Add to `api_spend`: `agent text`, `task_type text`, `correlation_id text`.
Add to `SpendLogger.log()`: `agent`, `task_type`, `correlation_id`.

- **Cost:** one additive migration, three nullable columns, one partial index. No backfill needed — old rows stay `null` and are honestly excluded.
- **Buys:** the §2 query, cost-per-agent, cost-per-task-type, and the `decision_log` join.
- **Risk:** `correlation_id` is `text` in `decision_log`, so the join is unindexed until we add one. Cheap to fix.
- **Why recommended:** it is the *smallest* change that unblocks the *most* loops, and it commits to nothing that a later path would have to undo.

### Path B — Path A + latency and outcome
Also add `duration_ms int`, `outcome text` (`success|failure|partial`), `retries int`.

- **Cost:** more call-site changes; every emitter must now know its own outcome, which means threading result state into the logger.
- **Buys:** `nf_a.verified_task_success_rate` and `harness_overhead_ms` — the two metrics **OD-03 (harness bake-off) is currently undecidable without**.
- **Risk:** `outcome` is exactly the "doneability" question People & Agent Ops owns and has not defined. Shipping a column before the definition invites each call site to invent its own meaning — the failure the metric-contract team exists to prevent.

### Path C — Full ADR 0006 production shape now
Implement the whole locked production store: `subject_type`, `stimulus`, `internal_state`, `choice`, `outcome`, `cost`, with partial indexes per `subject_type`.

- **Cost:** largest. Touches NF-B's shape too, and NF-B has no callers yet.
- **Buys:** no second migration later; agent and guest share one table from day one.
- **Risk:** designing guest columns before a single guest event exists is the mistake ADR 0006 §4.3 already avoided once with NF-C. Also the operator-preference `subject_type` question is still open.

**Recommendation: A now, B when doneability is defined, C when NF-B has a caller.** Path A is reversible and additive; B and C both bet on definitions that do not exist yet.

## 5. Implementation order (after the path is chosen)

1. **Migration** — additive columns + `correlation_id` index. Nullable, so no backfill and no rewrite of history.
2. **`SpendLogger`** — new params **keyword-only with defaults**, so all 16 existing call sites keep working unchanged.
3. **Gateway emitter** — one shared helper the 7 call sites route through. This is also where hand-rolled retry/timeout gets consolidated (Architecture Review AR-3: 1 of 7 retries, 3 of 7 have no timeout, the other 4 disagree).
4. **CI guard** — `scripts/check_model_calls_logged.sh`: a new `api.anthropic.com` / Gemini call site that does not route through the emitter fails the build. Without this, D3 recurs.
5. **Re-run `build_loop_index.py`** and watch `loops_running` move.

## 6. Done when

- [ ] The §2 query returns rows for both runtimes
- [ ] All 7 gateway call sites emit
- [ ] CI guard fails a deliberately unlogged call site *(prove it fails before trusting it)*
- [ ] `nf_a.cost_per_completed_task` has a real number
- [ ] Loops blocked solely on NF-A emission move off `blocked`

**Honesty gate:** P1 is not done because code merged. It is done when a number exists that
nobody had to assemble by hand — the same standard the corpus applies to every other loop.
