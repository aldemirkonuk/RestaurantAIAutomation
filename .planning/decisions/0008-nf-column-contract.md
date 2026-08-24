# 0008 — Neural Footprint column contract: full ADR 0006 shape now (Path C)

- **Status:** Locked
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder)
- **Supersedes:** the open half of OD-11
- **Keywords:** neural-footprint, schema, NF-A, NF-B, NF-C, subject_type, columns, OD-11
- **Links:** [[0006-neural-footprint-architecture]], [P1 spec](../04-specs/P1-NF-A-INSTRUMENTATION.md), [[research-math-charter]]

## Context

[ADR 0006](0006-neural-footprint-architecture.md) locked the *architecture* — a narrow
polymorphic production store plus a wide append-only research log — and deferred the
*column contract* to OD-11. P1 (instrumentation) then blocked on it: 476 of 482 loops
cannot run because nothing emits.

Three defects made the headline metric impossible rather than merely hard:

| # | Defect | Evidence |
|---|---|---|
| D1 | `SpendLogger.log()` takes no `agent`, no `task_type` | `services/agent-orchestrator/services/spend_logger.py:41-49` |
| D2 | `api_spend` has no agent and no `correlation_id`; `decision_log` has both but no cost. **No key joins them** | `baseline_from_production.sql` |
| D3 | All 7 gateway model call sites write nothing to the ledger | `grep -c api_spend apps/api-gateway/src` → 0 |

## Options considered

Written up in full at [P1 §4](../04-specs/P1-NF-A-INSTRUMENTATION.md).

- **A — minimal join.** Add `agent`, `task_type`, `correlation_id` to `api_spend`. Smallest change that unblocks the most; commits to nothing a later path must undo.
- **B — A plus latency and outcome.** Unblocks OD-03, but `outcome` encodes a doneability definition that does not exist yet.
- **C — the full ADR 0006 production shape now.** One table, `subject_type`, the whole stimulus→state→choice→outcome record, partial indexes per subject.

## Decision

**Path C.**

A single production table implementing ADR 0006's recorded shape, with `subject_type`
discriminating agent / guest / bio from day one:

```
neural_footprint_event                     -- production store: narrow, polymorphic, live-read
  id              uuid pk
  subject_type    text not null            -- 'agent' | 'guest' | 'operator' | 'bio'   (bio reserved, gated; operator added 2026-08-24)
  subject_id      text not null            -- agent name | guest identifier | subject ref
  stimulus        text not null            -- what arrived / what was presented
  context         jsonb not null default '{}'
  internal_state  jsonb not null default '{}'   -- confidence, alternatives, reasoning ref
  choice          text not null            -- what was selected or produced
  outcome         text                     -- success | failure | partial | null (unknown)
  cost_usd        numeric(10,6)            -- agent only; null for guest by construction
  input_tokens    integer
  output_tokens   integer
  duration_ms     integer
  correlation_id  text                     -- joins decision_log
  restaurant_id   uuid
  occurred_at     timestamptz not null default now()
```

Partial indexes per `subject_type` so the sparse columns do not cost the dense reads:

```sql
create index nfe_agent_cost on neural_footprint_event (subject_id, occurred_at desc)
  where subject_type = 'agent';
create index nfe_guest_choice on neural_footprint_event (subject_id, occurred_at desc)
  where subject_type = 'guest';
create index nfe_operator_action on neural_footprint_event (subject_id, occurred_at desc)
  where subject_type = 'operator';
create index nfe_correlation on neural_footprint_event (correlation_id)
  where correlation_id is not null;
```

`api_spend` and `decision_log` are **not dropped**. They keep their current writers; the
new table is written alongside, and the migration off them is a later decision once the
new table has real volume. Nothing that works today stops working.

## Rationale, and the argument that was overruled

**Claude recommended Path A** on the grounds that C designs guest columns before a single
guest event exists — the same reasoning ADR 0006 §4.3 used to gate NF-C — and that A is
additive and reversible while C is a larger bet on definitions that are still open
(`outcome`/doneability is undefined; the operator-preference `subject_type` is unresolved).

**The founder chose C**, consistent with the standing direction to optimise for the goal
rather than for the smallest safe step ([[0007-org-structure]] review trail). The
substantive case for C:

- **One ingestion path, one vocabulary.** A and B would each need a second migration when
  NF-B arrives; C pays once. Given how much of this corpus already suffers from two
  implementations of one idea (the UCC guardrail, the two DLQs, three PII guard
  definitions), collapsing to a single table has real value beyond convenience.
- **`subject_type` is already locked** by ADR 0006 as the mechanism that lets NF-C plug in
  without migration. C simply implements what was decided rather than deferring it twice.
- **Sparse columns are cheap when indexed partially.** The design cost Claude flagged is
  mitigated by the `where subject_type = …` indexes above.

**Risks accepted, recorded so they are not rediscovered as surprises:**

1. `outcome` ships before doneability is defined. **Mitigation:** it is nullable, and
   `null` means *unknown*, never *success*. Any call site that cannot honestly determine
   an outcome writes `null`. People & Agent Ops still owns the definition; the column does
   not pre-empt it.
2. Guest columns exist with no guest writer. **Mitigation:** NF-B emission stays out of
   P1 scope. The columns are inert, not wrong.
3. A wider table invites writing rows that are not really footprints. **Mitigation:** the
   CI guard in P1 §5 gates *emission paths*, not just presence.

## Consequences

- P1 is unblocked and its scope grows: one new table rather than three added columns.
- NF-B needs no migration when Guest Experience gets a caller — only a writer.
- NF-C remains gated per ADR 0006; `subject_type = 'bio'` is reserved and unused.
- `subject_type = 'operator'` (added 2026-08-24, founder tracking decision): staff/owner
  actions in the product ride the same spine — page analytics is NF, not a second store.
- The research store (wide, append-only) is **still unbuilt** and remains out of P1.
- Revisit if: the table exceeds partial-index performance at volume, or `outcome`
  semantics diverge across call sites despite the null-means-unknown rule.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Claude | Wrote three paths; recommended **A**, arguing C repeats the design-before-evidence mistake ADR 0006 avoided with NF-C |
| 2026-08-24 | Aldemir | **Chose C.** Recommendation overruled; consistent with optimising for the goal over the smallest safe step |
| 2026-08-24 | Claude | Recorded the three accepted risks with mitigations so they are not rediscovered later |
| 2026-08-24 | Aldemir | **Tracking decision:** all metrics ride one spine — product analytics per page, agent telemetry, and work tracking. This adds **`operator`** as a fourth `subject_type` (staff/owner actions in the product), closing the gap flagged earlier that operator preference signal had no schema home |
