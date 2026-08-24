---
type: spec
id: P1
title: NF-A Instrumentation
status: ready
updated: 2026-08-24
owner: research-math
blocks: [OD-03, OD-04]
resolves: [OD-11]
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

**In:** the `neural_footprint_event` table · `SpendLogger` signature · a gateway-side emitter ·
backfill posture for existing rows · one CI guard so a new model call site cannot skip the ledger.

**Out:** NF-B (guest), NF-C (gated), the research store, retention/rollup policy,
dashboards. P1 is emission only — *observe before deciding* ([[PLAN]] §3).

## 4. The column contract — RESOLVED: Path C

**Founder chose Path C** on 2026-08-24: implement the full [ADR 0006](../decisions/0006-neural-footprint-architecture.md)
production shape now, rather than the minimal join Claude recommended. Locked in
[ADR 0008](../decisions/0008-nf-column-contract.md), which records the rejected paths, the
overruled recommendation, and the three accepted risks.

One table, `subject_type` discriminating agent / guest / bio from the first migration:

```sql
create table neural_footprint_event (
  id             uuid primary key default gen_random_uuid(),
  subject_type   text        not null check (subject_type in ('agent','guest','bio')),
  subject_id     text        not null,
  stimulus       text        not null,
  context        jsonb       not null default '{}',
  internal_state jsonb       not null default '{}',
  choice         text        not null,
  outcome        text        check (outcome in ('success','failure','partial')),  -- null = UNKNOWN
  cost_usd       numeric(10,6),
  input_tokens   integer,
  output_tokens  integer,
  duration_ms    integer,
  correlation_id text,
  restaurant_id  uuid,
  occurred_at    timestamptz not null default now()
);

create index nfe_agent_cost   on neural_footprint_event (subject_id, occurred_at desc)
  where subject_type = 'agent';
create index nfe_guest_choice on neural_footprint_event (subject_id, occurred_at desc)
  where subject_type = 'guest';
create index nfe_correlation  on neural_footprint_event (correlation_id)
  where correlation_id is not null;
```

**`outcome` is nullable and `null` means *unknown*, never *success*.** Doneability is still
undefined and owned by People & Agent Ops; a call site that cannot honestly determine an
outcome writes `null`. This is the mitigation for the main risk C carries — the column
exists without pre-empting the definition.

**`api_spend` and `decision_log` are not dropped.** They keep their writers; the new table
is written alongside. Migrating off them is a later decision, after the new table has volume.

**NF-B columns ship inert.** Guest Experience has no caller yet ([[guest-identity-consent-charter]]).
The columns are unused, not wrong — that was the accepted trade in choosing C.

## 5. Implementation order (after the path is chosen)

1. **Migration** — create `neural_footprint_event` + the three partial indexes. Purely
   additive: nothing existing is altered or dropped, so there is no backfill and no
   rewrite of history.
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
