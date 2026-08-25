---
type: agenda-full
division: platform
department: reliability-sre
team: runtime-resilience
status: provisional
metrics: [sre.dlq_depth_and_oldest_age, resilience.circuit_open_duration, resilience.retry_amplification_factor, resilience.buffer_evictions]
updated: 2026-08-24
links: ["[[runtime-resilience-charter]]", "[[runtime-resilience-premortem]]", "[[runtime-resilience-loops]]", "[[runtime-resilience-agenda-board]]", "[[reliability-sre-agenda-full]]", "[[observability-telemetry-plumbing-charter]]"]
---

# Runtime Resilience — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

**Build nothing. Read what is already there.**

This is the most unusual opening position in the department. The mechanisms are done:
circuit breakers, dead-letter exchange and queue, retry with idempotency, transactional
outbox, saga compensation, connection pooling, a LIFO backpressure window, and a manual
kill switch — all present in `services/agent-orchestrator/core/` today
(`technology.md:791-797`). What does not exist is a single consumer, reader, or alert on any
of it.

The year's work is four readers:

1. A **DLQ consumer** with triage, because `queue.dead_letters` has none.
2. **Open-duration accounting per circuit breaker**, because an open breaker is an
   invisible feature flag.
3. A **retry budget per logical task**, because three independent retry layers multiply.
4. **Eviction accounting with payload class** on the LIFO buffer, because "40 dropped" and
   "40 stock events dropped during Friday dinner" are different sentences.

## How

**The DLQ consumer, concretely.** `queue.dead_letters` is already declared and bound
(`message_bus.py:505-533`) and four paths increment `messages_dead_lettered` (`:771`,
`:817`, `:824`, `:830`). Add a consumer that classifies each message into replay /
discard-with-reason / escalate. Money and stock are **human-gated**, matching the rule
`drift_agent.py:11-16` already sets for findings. The primary metric is **age of oldest**,
not depth.

**Circuit-breaker accounting.** Emit open duration per dependency, and the transition
counts. A breaker open past one close-time is escalated as a *product* finding to the owning
feature's team, not absorbed here.

**Retry budget.** Name the single layer that owns retry for each outbound path and disable
it at the others. Full jitter. **A 429 is a stop signal, never a retryable error** — that one
rule is most of the fix.

**Buffer eviction accounting.** Emit evictions with payload class and timestamp. Stock and
money become non-evictable and route to the DLQ instead of being dropped.

**Dependency.** All four require [[observability-telemetry-plumbing-charter]]'s emission
path to be alive. If `NoopMetric` (`observability.py:53`) is in play, all four of these
numbers read zero and zero looks like health — this team's numbers are the most dangerous
ones in the org to read while blind.

## Why now

- **The DLQ is accumulating today.** Every message counted into it since the code shipped is
  unread. Unlike most debt, this one has customer-visible content sitting in it right now.
- **11 restaurants makes absorbed failure expensive.** One silently dropped order is a
  meaningful fraction of the business. "The breaker held" is not an answer a restaurant
  accepts.
- **These readers are cheap.** None of this is new infrastructure — it is consumers on
  queues that already exist and counters on transitions that already happen. The cost is a
  few days; the cost of not doing it is unbounded and silent.
- **Friday-dinner load is when the LIFO window bites**, and that is also when the business
  is most sensitive. The eviction data does not exist to prove or disprove this yet.

## Next steps

| # | Step | Output | Close-time |
|---|---|---|---|
| 1 | DLQ consumer + triage classification (replay / discard-with-reason / escalate) | `sre.dlq_depth_and_oldest_age` gets a first value | weekly |
| 2 | Emit **age of oldest**, not just depth | The metric that cannot look calm while broken | with step 1 |
| 3 | Circuit-breaker open duration + transition counts per dependency | `resilience.circuit_open_duration` | weekly |
| 4 | Name the owning retry layer per outbound path; disable the others; full jitter; 429 = stop | `resilience.retry_amplification_factor` flat under load | monthly |
| 5 | Buffer evictions emitted **with payload class and hour** | `resilience.buffer_evictions` becomes a customer statement | monthly |
| 6 | Stock/money non-evictable → DLQ instead of dropped | Closes the M1/M4 seam | with step 5 |
| 7 | Kill-switch exercise + resume runbook | `sre.days_since_kill_switch_exercised` | quarterly, with L-SRE-3 |

## Questions for the founder

1. **DLQ replay autonomy.** `drift_agent.py:11-16` establishes that money and stock are
   never auto-applied. Does an *idempotent* replay of a non-financial message get to be
   automatic, or is every replay human-gated? This decides whether the consumer is a tool or
   an agent.
2. **DLQ retention.** How long may a dead-lettered message sit before it is discarded rather
   than replayed? A three-month-old order should probably not be sent to a vendor —
   but discarding it silently is how M1 happens again with better tooling.
3. **Buffer priority.** Is LIFO right at all for the 30-minute window, or should stock and
   money be a separate FIFO lane? LIFO is correct for recomputable work and wrong for
   events.
4. **Kill-switch window.** A controlled `pause_all_writes` exercise needs a real window.
   What is acceptable, and do the restaurants need to be told?
5. **Who owns an absorbed failure's customer communication?** If an order was dead-lettered
   in March, telling the restaurant is not this team's call — but nobody currently owns it
   either.
