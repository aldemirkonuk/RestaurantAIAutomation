---
type: agenda-full
division: applied-ai
department: ai-orchestration
team: harness-runtime
status: provisional
metrics: [nf_a.retries, nf_a.dlq_depth]
updated: 2026-08-24
links: ["[[harness-runtime-charter]]", "[[harness-runtime-premortem]]", "[[harness-runtime-agenda-board]]", "[[harness-runtime-directive]]", "[[harness-runtime-loops]]", "[[harness-runtime-schedule]]", "[[ai-orchestration-agenda-full]]", "[[agent-fleet-charter]]", "[[action-safety-the-human-gate-charter]]", "[[research-math-charter|research-and-math-charter]]", "[[decision-office-charter]]"]
---

# Harness & Runtime — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

A mature harness with **no telemetry above it** and **an open fork beneath it**.

`core/` is 6,375 lines of working lifecycle, retry, idempotency, DLQ, saga and
registry machinery. Its primary metric — `nf_a.retries` and `nf_a.dlq_depth` per
agent-hour — is **not emitted at all** ([[README]] §1, L4). And OD-03 leaves open
whether any of it survives.

That combination sets the agenda: **instrument first, narrow second, decide third.**
Instrumentation is the only work that is unambiguously valuable under all three OD-03
outcomes — a hermes-agent migration still needs to know what the retry rate was.

## How

### 1. Emit one NF-A event, end to end *(Step 0 of [[ai-orchestration-agenda-full]])*

This team owns the emission point; [[research-math-charter|research-and-math-charter]] owns what the fields
mean. `base_agent.py` already has every hook needed: `_process_with_retry` (`:543`)
knows the retry count, event append (`:944`) already writes an audit trail, health
(`:985-1035`) already aggregates. The work is a schema and a call site, not a
subsystem.

**Blocked on one thing:** [[README]] §4.4 leaves table-per-track vs one polymorphic
table open and calls it *"a real schema decision with query-performance
consequences."* A provisional answer unblocks this; no answer does not.

### 2. Make the DLQ have a reader

Not "improve the DLQ". `message_bus.py:524` declares it and `base_agent.py:791` fills
it, correctly. The gap is a consumer. A daily sweep that reads every entry, classifies
it (harness defect · agent defect · infrastructure), and **assigns it** turns a queue
into a loop. Unblocked today — this does not wait on NF-A, because DLQ depth is
readable from the bus directly.

### 3. Publish the census: `harness.agents_without_harness_guarantees`

Today the value is **1** — `agents/recurring_order_agent.py:14`, a plain class owning
scheduled purchasing with no retry, no idempotency, no DLQ, no health check. Making
that a published number rather than a grep result forces the decision described in
[[harness-runtime-premortem]] #3. Cheap, unblocked, and it is the one number this team
can publish this week.

### 4. Narrow, don't widen — the OD-03 diet

While the fork is open: bug fixes, instrumentation, and interface **narrowing** only.
Concretely, three candidates to narrow now because they pay under every outcome:

- **Abstractions with one caller.** Any registry tier, lifecycle hook, or extension
  point used by exactly one agent is that agent's feature, not the harness's
  ([[harness-runtime-premortem]] #4).
- **The `process_message` signature.** `core/orchestrator.py:198-206` records that
  `EmailParsingAgent`'s *"`process_message` took two arguments where `BaseAgent`
  passes one"* — a contract that admits that mismatch is a contract worth tightening.
- **`database.py` at 2,046 lines** — the largest module in `core/` and the least
  obviously *harness*. Whether data access belongs in the harness contract at all is a
  question worth asking before a bake-off has to port it.

### 5. Run the bake-off

Scoped to this repo's actual workloads, per OD-03 (`OPEN-DECISIONS.md:25`). Its inputs are
items 1–2 above: harness overhead cannot be compared without cost and retry
instrumentation. Running it earlier produces a preference rather than evidence — which
is exactly the *"pick from repute"* the decision log forbids.

## Why now

1. **Instrumentation is the only OD-03-proof work available.** Every other improvement
   to `core/` carries a risk of being thrown away; retry and DLQ data does not.
2. **The DLQ gap compounds silently.** `technology.md:802-805` names it as a premortem
   for a sibling team; the queue is filling now, and entries do not become easier to
   triage with age.
3. **The census costs a day and closes a real exposure.** A scheduled purchaser
   outside the retry/idempotency contract is a duplicate-order incident waiting for a
   restart.

## Next steps

| # | Step | Blocked by |
|---|---|---|
| 1 | Publish `harness.agents_without_harness_guarantees` (today: 1) | — |
| 2 | Daily DLQ sweep with classify-and-assign | — |
| 3 | Grep and list every `core/` abstraction with one caller | — |
| 4 | One NF-A event from one agent, end to end | NF-A schema shape ([[README]] §4.4) |
| 5 | Per-agent retry baselines | step 4 |
| 6 | OD-03 bake-off, dated | steps 4–5 |

Steps 1–3 have no blockers and no dependency on the fork's outcome.

## Questions for the founder

1. **`recurring_order_agent` — bring it under `BaseAgent`, delete it, or document why
   a scheduled purchaser needs no idempotency?** All three are acceptable. Leaving it
   undiscussed is not; it currently has passing tests and zero harness guarantees.
2. **A date for the OD-03 bake-off.** The method is settled
   (OD-03, `OPEN-DECISIONS.md:25`); the date is not, and [[harness-runtime-premortem]] #1 is
   entirely about the missing date rather than the missing answer.
3. **Does `database.py` (2,046 lines) belong in the harness contract?** It is a third
   of `core/` and the piece a harness migration would most painfully have to port.
4. **NF-A schema shape** — table-per-track or one polymorphic table
   ([[README]] §4.4). A provisional answer is enough to unblock; ambiguity is not.
