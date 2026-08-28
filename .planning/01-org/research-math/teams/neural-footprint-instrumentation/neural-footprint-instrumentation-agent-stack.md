---
type: agent-stack
division: research-math
department: research-math
team: neural-footprint-instrumentation
status: designed
updated: 2026-08-27
metrics: [nf_a.event_completeness, nf.private_telemetry_tables, nf_b.identifier_coverage]
links: ["[[neural-footprint-instrumentation-charter]]", "[[neural-footprint-instrumentation-schedule]]", "[[neural-footprint-instrumentation-loops]]", "[[neural-footprint-instrumentation-directive]]", "[[0034-agent-stack-artifact]]", "[[research-math-agent-stack]]", "[[0006-neural-footprint-architecture]]", "[[0008-nf-column-contract]]", "[[data-charter]]", "[[skills-charter]]"]
---

# Neural Footprint Instrumentation (RM-3) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team owns a *contract*, not a table: the sentinel may reject a field, a
> `subject_type` value or a second telemetry table, and may never write a migration —
> [[data-charter]] owns the DDL. **OD-11 is open** and gates every NF implementation; this
> card names it and does not pre-empt it.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `nf-contract-sentinel` | Hold the event contract — one joinable event per model invocation, one telemetry table, no field or `subject_type` added outside the contract — and publish the completeness number starting from its honest zero | NEW |

## 2. Agent cards

```yaml
agent: nf-contract-sentinel
unit: neural-footprint-instrumentation
triggers:
  - schedule: "weekly — completeness publish; private-telemetry-table scan; suppressed-emission review; callsite ledger"   # [[neural-footprint-instrumentation-schedule]]
  - schedule: "fortnightly — OD-11 working session with Data, until it closes"
  - schedule: "monthly — invoice reconciliation; contract-drift check"
  - schedule: "quarterly — NF-C entry-trigger check (expected to answer no, by design)"
  - topic: migration.merged      # publisher: NONE (gap — nothing emits on a migration; PR review only)
consumes:
  - neural_footprint_event rows — publisher: model-client.service.ts:413 (gateway), spend_logger.py:406 (Python)
  - 'supabase/migrations/ — publisher: "[[data-charter]]" (they own the DDL; we own the contract)'
  - api_spend and decision_log, the two pre-contract writers — publisher: spend_logger.py, base_agent.py:743-784
  - the provider invoice — publisher: NONE (gap — no feed; reconciliation depends on a human-fetched bill)
emits:
  - nf_a.event_completeness and the callsite ledger — consumer: "[[research-math-agenda-board]]"
  - 'a same-day escalation when the private-telemetry-table count reaches 2 — consumer: "[[research-math-charter]]", then "[[decision-office-charter]]"'
  - OD-11 session inputs — columns, partial indexes, retention, both owners named — consumer: "[[data-charter]]"
  - 'nf_a events (task_type: nf_contract_audit) — consumer: this team''s own contract'
routing_class: mechanical        # scan, count, diff against a declared contract; the schema judgment calls belong to the OD-11 session, not to an agent
quality_bar: "completeness is recomputed from the table, never inferred from the callsite list; NONE (gap) — ADR 0017 defines no verdict basis for a contract audit"
autonomy:
  read: autonomous
  propose: autonomous            # findings, ledgers and contract objections land as PRs
  mutate_stock_money_outbound: confirm    # constant
memory: neural-footprint-instrumentation
escalates_to: "[[research-math-charter]]"
```

**The card's own hard rules.** The sentinel never writes a migration and never adds a
column — it files against OD-11 instead ([[data-charter]] owns the DDL, and OD-11 must name
both owners or the schema ships twice). And it never suppresses its own zero.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `nf-event-audit` | T2 | Any PR touching a model callsite or a telemetry writer | Every model-invocation path listed with which of the eight NF-A fields it emits; fails on a new path emitting none | Seven NestJS callsites emitted nothing and were found only by hand-grep — `api_spend`/`cost_usd`/`input_tokens` returned **0 hits** in `apps/api-gateway/src` (verified 2026-08-24); P1 closed all seven and the service now speaks of **9 emitting sites** (`model-client.service.ts:410`) | NEW |
| `telemetry-table-scan` | T2 | Weekly, and on any migration | Lists every table holding cost, token or verdict data outside the contract, each with a dated fold-in line or a flag | `decision_log` and `api_spend` diverged into two unjoined halves with no owner noticing — the migration header states the consequence exactly: *"api_spend holds cost with no agent, decision_log holds reasoning with no cost, and no key joins them"* (`supabase/migrations/20260824141116_neural_footprint_event.sql:7-8`) | NEW |
| `spend-reconcile` | T2 | Monthly | Provider invoice against summed NF cost, with per-callsite attribution; alarm above a 5% delta | Telemetry fails soft by design — `SpendLogger` skips silently when Supabase is unconfigured (`spend_logger.py:322`) and never re-raises, so a whole environment can be unlogged and look healthy | NEW |
| `nf-contract-lint` | T2 | Any migration touching an NF table | Rejects a `subject_type` value or telemetry field added outside the contract | Fork INTEL-F3 exists because `subject_type` was drafted with three values while `recommendation_actions` already collected a fourth kind of subject; the shipped table carries four (`…neural_footprint_event.sql:24`) and the register was never updated | NEW |

Consumed, owned elsewhere: the envelope and registry ([[skills-charter]]); the DDL,
migrations and pipeline ([[data-charter]]); what the numbers *mean* once emitted
([[harness-model-routing-charter]], [[evaluation-doneability-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates reach [[skill-harvesting-charter]]'s queue and
  face the §3.3 gate.
- **Episodic** — nf_a `task_type: nf_contract_audit`. This team is the only one whose
  episodic layer is also its product: the contract it audits is the one every other unit's
  episodic layer depends on. Needs `context.callsite` and `context.emitting_runtime` as
  jsonb keys so a gateway-versus-Python ledger is one filter rather than a join each
  consumer invents for itself.
- **Semantic** — `memory/` beside this file, indexed by
  `neural-footprint-instrumentation-MEMORY.md`. Its first facts are already known and
  checkable: the two-halves gap and the migration that closed it; that `SpendLogger.log()`
  now takes `agent` (`spend_logger.py:269`); that the research store is still unbuilt.
  `source`, `confidence`, `last_verified` in frontmatter; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Boundaries, and the one
  migration under review. `supabase/migrations/` is a grep target, never preloaded.

**Consolidation** — monthly, mirrored in [[neural-footprint-instrumentation-schedule]]:
read the audit slice and the month's migrations; **failures first** — a silently unlogged
environment or a field added outside the contract becomes a fact naming the mechanism, not
"completeness dipped"; expire facts unverified for 90 days; propose skill candidates. One
PR; "no delta" stated when true — and for the NF-C check, "no" is the correct delta for a
long time.

## 5. Async contract

Cross-unit interaction is loops ([[neural-footprint-instrumentation-loops]]), NF-A events,
vault PRs and skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `migration.merged` has no publisher | Nothing emits when a migration lands; the weekly scan and PR review are the whole defence, and the contract-drift check is therefore up to 7 days late |
| The provider invoice has no feed | `spend-reconcile` compares NF cost against a bill nobody delivers programmatically. Until a feed exists the monthly job is a human step, and saying otherwise would make the only uninfluenceable number in this charter look automated |
| Suppressed emissions are counted through the thing that suppresses them | Telemetry fails soft (`spend_logger.py:322`); silence must be counted on a path that is not the silent one, and no such path exists yet |
| **OD-11 open** — columns, indexes, retention, and *both* owners | The table shipped ahead of the fork closing. Every field the sentinel would lint against is still formally undecided, and the fork must name this team **and** [[data-charter]] or the schema ships twice |

## 6. Evidence today

- **EXISTS — the production store, in the full ADR 0008 shape.**
  `supabase/migrations/20260824141116_neural_footprint_event.sql` records stimulus →
  internal state → choice → outcome for any subject, with partial indexes per
  `subject_type` (`:46-57`).
- **EXISTS — the charter's "first concrete assignment", closed.** `SpendLogger.log()` now
  takes an `agent` argument (`services/agent-orchestrator/services/spend_logger.py:269`) and
  writes `neural_footprint_event` (`:406`), so *"cost per task per agent"* is derivable on
  the Python side for the first time; the gateway emits at `model-client.service.ts:413`.
- **PARTIAL — `nf.private_telemetry_tables`.** The migration deliberately keeps `api_spend`
  and `decision_log` and their writers (`…neural_footprint_event.sql:14-15`) — a dated,
  reasoned non-migration rather than drift, and the reason the weekly scan still has a job.
- **INTEL-F3 is answered in the shipped schema and still open in the register.**
  `subject_type` allows `agent | guest | operator | bio` (`…:24`) with an `operator`
  partial index (`:57`). Whether the fork is *recorded* as closed is
  [[decision-office-charter]]'s call, not this doc's — but a register row that no longer
  matches the schema is the rot the contract-drift check exists to catch.
- **NEW — the research store, the sentinel and all four skills.**
  [[0006-neural-footprint-architecture]] locks the production/research split and only the
  production side exists; unbuilt, the compensation granted when the separate research
  company was declined is rhetoric ([[neural-footprint-instrumentation-schedule]]
  §Non-preemptible).
