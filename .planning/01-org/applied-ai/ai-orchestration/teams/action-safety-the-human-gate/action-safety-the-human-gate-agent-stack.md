---
type: agent-stack
division: applied-ai
department: ai-orchestration
team: action-safety-the-human-gate
status: designed
updated: 2026-08-27
metrics: [safety.unconfirmed_mutation_count, safety.median_time_to_confirm, safety.rejection_rate, safety.schema_coverage]
links: ["[[action-safety-the-human-gate-charter]]", "[[action-safety-the-human-gate-schedule]]", "[[action-safety-the-human-gate-loops]]", "[[0034-agent-stack-artifact]]", "[[ai-orchestration-agent-stack]]", "[[harness-runtime-agent-stack]]"]
---

# Action Safety & the Human Gate — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The gate team's own agent is **read-only by principle, not by accident**: a
> watcher that could mutate would be the arrangement the charter rejects for the
> harness (executing actions *and* deciding whether execution is permitted). Every
> other unit's card inherits its `mutate_stock_money_outbound: confirm` line from
> this team; this page is where that constant is enforced, so it is held strictest
> here.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `gate-auditor` | Measure the gate — unconfirmed mutations (hard zero), time-to-confirm, rejection rate — and sweep for mutation paths that exist outside the single action schema | NEW; the timestamps it needs already EXIST |

## 2. Agent cards

```yaml
agent: gate-auditor
unit: action-safety-the-human-gate
triggers:
  - schedule: "weekly (feeds the aio board rollup)"        # mirrored in [[action-safety-the-human-gate-schedule]]
  - topic: action_executed                                  # publisher: EXISTS — one-tap-actions.service.ts:267 emits it
consumes:
  - one_tap_actions rows: executed_at / executed_by (one-tap-actions.service.ts:245-246)
  - grep sweep of write paths to stock, money, outbound channels vs. the allowlist (FUTURES §8.2)
  - decision_log rows (the drift_agent pattern, agents/drift_agent.py:17)
emits:
  - "safety.* metrics → [[ai-orchestration-agent-stack|aio-orchestrator]] board row"
  - "any non-zero unconfirmed_mutation_count → an INCIDENT escalation, not a board row (charter: 'a reportable incident, not a bug')"
  - schema-coverage gap list (mutation entry points outside the single action schema) → memory PRs
  - nf_a events (task_type: gate_audit)
routing_class: mechanical         # queries and greps; whether a confirmation was a *decision* is analysed in consolidation, not scored live
quality_bar: "unconfirmed_mutation_count computed from writes joined to confirmations, never from the absence of complaints; a family with no instrumentation reads 'unmeasured', never 0"
autonomy:
  read: autonomous
  propose: autonomous              # findings, gap lists, incident escalations — all PRs or notes
  mutate_stock_money_outbound: confirm   # constant — and this agent additionally never executes, cancels, or edits ANY one-tap action; read-only by principle
memory: action-safety-the-human-gate
escalates_to: "[[ai-orchestration-charter]]; a non-zero unconfirmed mutation additionally goes to [[security-charter]] as an incident"
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `mutation-path-sweep` | T2 | Weekly, and any PR adding a write to stock, money, or an outbound channel | Every mutation entry point classified: behind the schema / behind one of the four conventions / unguarded — with `path:line`; `safety.schema_coverage` updated | `recurring_order_agent.py` — a scheduled purchaser with an "auto-execution" feature, outside the harness *and* the action center, found by hand 2026-08-24 (charter §The gap) | NEW |
| `confirmation-quality-report` | T2 | Weekly, from the executed_at/executed_by rows | median_time_to_confirm and rejection_rate per action family, with the trend, and the honest caveat when volume is too low to read | The charter's own observation that the timestamps exist and "the measurement is a query, not a feature" — a query nobody has run on a cadence | NEW |

Consumed, owned elsewhere: what belongs on the allowlist for guest PII
([[compliance-privacy-charter|compliance-and-privacy-charter]]); the confirmation
surface's UX ([[design-charter]] — the contested seam stays contested).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: gate_audit`, plus the `action_executed` event
  stream and `decision_log` rows — the gate's episodic record is largely *already
  designed* by the drift_agent pattern ("every run and every finding writes a
  decision_log row").
- **Semantic** — `memory/` beside this file, index
  `action-safety-the-human-gate-MEMORY.md`. First facts: the four independent
  conventions and where each lives; the recurring_order_agent gap; which action
  families are role-restricted. A rejection-rate collapse (gate rubber-stamping)
  becomes a failure fact naming the family. Provenance per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, FUTURES §8.1–8.3 (the principle text
  itself — small enough to preload, load-bearing enough to always have).

**Consolidation** — monthly: read the audit slice; the hard question lives here —
whether confirmations were *decisions* (premortem #1): confirm-time distributions
that collapse toward zero become failure facts per family; expire at 90 days
unverified; propose candidates. One PR; "no delta" stated when true.

## 5. Async contract

Board rows, incident escalations, memory PRs, NF-A events; loops per
[[action-safety-the-human-gate-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| The single action schema does not exist | Four conventions, not one mechanism (charter §Evidence) — until the schema lands, the sweep grades against a list of conventions, and `safety.schema_coverage` is honest about being convention-coverage |
| `safety.unconfirmed_mutation_count` is unmeasured | Target hard zero, currently not computed anywhere; the first audit run establishes the baseline, and until then the number is "unmeasured", never "zero" |
| Incident escalation has no channel | An escalation note is a vault edit; a real incident wants a faster path — naming this beats pretending the note is paging anyone |

## 6. Evidence today

- **EXISTS — the measurement substrate.** `one-tap-actions/` (9 routes,
  JwtAuthGuard at `:64`, execute at `:214`, `executed_at`/`executed_by` at
  `:245-246`, `action_executed` at `:267`); tiered autonomy implemented once
  (`drift_agent.py:8-12,17`); governance tiers (`governance.py:20,227`); the
  never-auto-send guardrails (project memory: autonomous-email-replies).
- **NEW — the auditor, both skills, the single schema, and every safety.* number.**
  The pattern exists four times; the measurement exists zero times.
