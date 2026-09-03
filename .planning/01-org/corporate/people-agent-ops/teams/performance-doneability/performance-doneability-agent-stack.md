---
type: agent-stack
division: corporate
department: people-agent-ops
team: performance-doneability
status: designed
updated: 2026-08-27
metrics: [nf_a.doneability_verdict_coverage, nf_a.cost_per_task, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate, nf_a.agent_attributed_spend_pct, nf_a.emission_coverage]
links: ["[[performance-doneability-charter]]", "[[performance-doneability-schedule]]", "[[performance-doneability-loops]]", "[[performance-doneability-directive]]", "[[0034-agent-stack-artifact]]", "[[people-agent-ops-agent-stack]]", "[[agent-evaluation-gates-agent-stack]]", "[[roster-lifecycle-agent-stack]]"]
---

# Performance & Doneability — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Written under a constraint no other team has: the primary metric is **~0%** and the
> primary input does not exist yet. So the agent's job is to publish the honest zero and
> the blocker's age every week until CORP-F5 closes — and to refuse the one substitution
> that would make the page look healthier (`success_rate`: liveness, not correctness).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `doneability-reviewer` | Publish verdict coverage and the blocker age whether or not either moved, audit whether spend can name a worker yet, and hand one written criteria spec a month to Research & Math | NEW |

## 2. Agent cards

```yaml
agent: doneability-reviewer
unit: performance-doneability
triggers:
  - schedule: "weekly coverage publication + blocker ageing; monthly cost-attribution, criteria spec and emission-floor audits; quarterly fleet review (gated)"   # mirrored in [[performance-doneability-schedule]]
  - topic: nf.verdict_written            # publisher: PARTIAL — `reconciliation_v1` writes sidecar verdict claims on invoice extraction (ADR 0017); exactly one task type
  - topic: spend_logger.signature_changed  # publisher: NONE (gap — CORP-F5 will land as an ordinary PR and nothing announces it)
consumes:
  - nf_a events and the verdict sidecar table (ADR 0006/0008/0017) — the spine this team reads and does not emit
  - "the per-family coverage table from [[agent-evaluation-gates-agent-stack|gate-runner]] — consumed, never recomputed: they run the gate, we fail the review (TECH-F3 stays open)"
  - decision_log (`…baseline_from_production.sql:2687`) and api_spend (`:2231`) — the two unjoined halves
  - "roster.truth_pct from [[roster-lifecycle-agent-stack|roster-registrar]] — an unregistered agent emits nothing, so roster truth is the floor under nf_a.emission_coverage"
  - "the §2 `quality_bar` line of every `*-agent-stack.md` — the declared grading basis per agent; a card reading `NONE (gap)` is an ungraded worker whose personnel file says so"
emits:
  - "nf_a.doneability_verdict_coverage + people.blocked_days weekly → [[people-agent-ops-agent-stack|pao-board-keeper]], published whether or not either moved"
  - "one criteria spec per month → [[evaluation-doneability-charter]] as an agenda-full question (they define, we specify what needs grading)"
  - "CORP-F5 age → [[FORK-REGISTRY]] / `OPEN-DECISIONS.md`"
  - nf_a events (task_type: doneability_coverage_report)
routing_class: judgment       # the weekly publication is counting, but the monthly criteria spec (L-PD-3) is not; the card declares the harder shape and leaves per-task routing to aio-model-routing rather than averaging the two itself
quality_bar: "its own skills' criteria applied to itself — a coverage report without a blocker age fails, and any *inferred* cost figure fails ([[performance-doneability-schedule]] §Skills owned). Beyond that: NONE (gap). Nothing grades the reviewer, and the team that owns doneability being ungraded is the finding, not the excuse"
autonomy:
  read: autonomous
  propose: autonomous         # coverage rows, specs and escalations land as PRs
  mutate_stock_money_outbound: confirm    # constant; grading never touches product data
memory: performance-doneability
escalates_to: "[[people-agent-ops-charter]]"
```

**Three hard rules on the card.** It may never publish `success_rate` unqualified — in
this unit's artifacts the measurable-today number is named `nf_a.liveness_rate`
(premortem M1). The **quarterly fleet review is gated**: if the data cannot name a worker,
the output is a written *"cannot review; here is what is missing"*, never a scorecard
built on liveness (L-PD-4). And **cost is never inferred** — an unattributable spend row
reads "not attributed", never 0 (ADR 0016; premortem M4).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `doneability-coverage-report` | T2 | Weekly | Emits coverage **and** a blocker age; a report with no age fails | The 2026-08-25 correction pass that re-derived coverage by hand and found exactly one verdict basis — `procurement/documents/reconciliation-verdict.ts` ([[0017-doneability-verdicts-are-sidecar-claims]]) against a charter that had said "none anywhere" | NEW |
| `agent-cost-attribution-check` | T2 | Monthly, and any change to `spend_logger.py` | A binary plus a share; any inferred figure fails the skill | `SpendLogger.log()` has had no `agent` parameter since it was written — `services/agent-orchestrator/services/spend_logger.py:41-49` | NEW |
| `nf-a-emission-audit` | T2 | Monthly | Counts `log_decision()` call sites across all 26 modules and names those emitting nothing | The P1 instrumentation and readout work (PR #35 `feat/p1-nf-instrumentation`; branch `feat/p1-readout`, 2026-08-25→27) re-derived emission status by hand rather than from a standing count | NEW |
| `liveness-vs-success-lint` | T2 | Per PR touching `.planning/01-org/corporate/people-agent-ops` | Zero unqualified uses of `success_rate` in this department's artifacts | `core/base_agent.py:602` sets `success=True` when `process_message()` merely did not raise, and `get_health()` (`:985`) reports healthy at ≥0.9 on that number | NEW |

**Two candidates deliberately left off**, per §3.3's no-speculative-skills rule and
[[performance-doneability-schedule]]'s own note: `doneability-criteria-draft` (no task
type here has ever had a written definition of done) and `verdict-emission-check` (no
verdict schema has ever been proposed). Both stay gated on their first real trigger.

Consumed, owned elsewhere: rubric and verdict **definitions**
([[evaluation-doneability-charter]]); gate operation
([[agent-evaluation-gates-agent-stack]]); the task-family side of emission coverage
(`nf-a-coverage-report`, [[ai-orchestration-agent-stack]] — it counts task families, ours
counts the 26 Python modules; two populations, kept distinct deliberately).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: doneability_coverage_report` plus the verdict sidecar
  (ADR 0017). This layer is **mostly absent, and its absence is the team's primary
  metric.** Two keys are needed, neither this team's to design: `context.agent_module`
  (the same ask as [[roster-lifecycle-agent-stack]] and [[agent-fleet-agent-stack]] — one
  key, three consumers) and a join key between `decision_log` and `api_spend` — CORP-F5
  and OD-11, ours to ask for, [[neural-footprint-instrumentation-charter]]'s to decide.
- **Semantic** — `memory/` beside this file, index `performance-doneability-MEMORY.md`.
  Failures-first is trivially satisfied: the founding facts *are* failures — the two
  unjoined halves, the one verdict basis, and CORP-F5's filing date as the origin of
  `people.blocked_days`. Provenance per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, and charter §Metrics — loaded on every run
  deliberately, so "liveness, not correctness" is in context before any number is written.

**Consolidation** — monthly: read the NF-A slice and the verdict sidecar; distil durable
facts, failures first. The specialisation that matters here: **a month in which coverage
did not move still produces a fact** — why it did not move, and the blocker's age now —
because "no delta" on the metric is never "no delta" on the record while a dependency is
ageing. Expire at 90 days unverified; propose skill candidates. One PR.

## 5. Async contract

Board rows, memory PRs, agenda-full questions, NF-A events, and loops per
[[performance-doneability-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| CORP-F5 has no event and no owner-side clock | 40 citations in 16 files ([[FORK-REGISTRY]]) and nothing notifies this team when `spend_logger.py` gains an `agent` parameter. The monthly readiness check bounds the lag at ~30 days |
| No join key between `decision_log` and `api_spend` | `correlation_id` exists on one side and nothing on the other. Until OD-11 decides, per-agent review is **not possible** — not hard, not possible ([[performance-doneability-charter]]) |
| Criteria specs reach Research & Math as a doc question | An agenda-full row is the accepted async path, but nothing notifies; a spec unanswered twice running *is* the TECH-F3-shaped seam failing, and goes to [[decision-office-charter]] |
| Judgment-shaped tasks have no grading basis at all | [[agent-evaluation-gates-agent-stack]] §5 names the same gap from the operations side. This card must wait for a rubric rather than improvise one — improvising is the boundary breach, not the delay |

## 6. Evidence today

- **EXISTS — the emitting half, and it is genuine.** `core/base_agent.py:77`
  `AgentMetrics`; `core/observability.py:113-118`; `log_decision()` (`:743`) →
  `decision_log` (`:2687`); `spend_logger.py` → `api_spend` (`:2231`). Reasoning is
  recorded and cost is recorded.
- **PARTIAL — one verdict basis.** `reconciliation_v1` on invoice extraction (ADR 0017);
  every other task type is ungraded, so coverage is ~0% — the honest number, published as
  the number.
- **NOT DERIVABLE — the cost half.** `SpendLogger.log()` attributes to provider, model and
  restaurant, never to a worker (`spend_logger.py:41-49`), so `nf_a.cost_per_task` and
  `nf_a.cost_per_completed_task` cannot be computed from what is logged.
- **NEW — `doneability-reviewer` and all four skills**, plus the blocker clock:
  `people.blocked_days` has never been published as a number, which is the smallest real
  thing this card ships on day one.
