---
type: charter
division: platform
department: reliability-sre
team: runtime-resilience
status: exists
metrics: [sre.dlq_depth_and_oldest_age, resilience.circuit_open_duration, resilience.retry_amplification_factor, resilience.buffer_evictions]
updated: 2026-08-24
links: ["[[reliability-sre-charter]]", "[[runtime-resilience-premortem]]", "[[runtime-resilience-agenda-full]]", "[[runtime-resilience-agenda-board]]", "[[runtime-resilience-directive]]", "[[runtime-resilience-loops]]", "[[runtime-resilience-schedule]]", "[[observability-telemetry-plumbing-charter]]", "[[state-integrity-invariants-charter]]", "[[harness-runtime-charter]]", "[[messaging-delivery-charter]]"]
---

# Runtime Resilience — Charter

Team **6.3** of [[reliability-sre-charter]] (`.planning/foundation/teams/technology.md:781-805`).

## Mandate

Own **behavior under partial failure**: circuit breakers, dead-letter queues, retry and
backoff policy, idempotency, rate limiting, connection pooling, saga compensation, and
backpressure. Not whether the system is up — whether it degrades in a way that can be
recovered from and noticed.

The team's defining property, and the reason it is separate: **its failures are invisible
to green CI and to uptime checks** (`technology.md:787-789`). Every dependency can report
healthy while a poison message retries forever and a queue backs up behind it. Nothing in
the release pipeline or the health surface would say a word.

## Boundaries

Owns outright, and the mechanisms are **already built**:

- **Circuit breaking and dead-lettering** — `core/message_bus.py:161-284` (`CircuitState`,
  `CircuitBreakerConfig`, `CircuitBreaker`, `CircuitOpenError`), `:296` `MessageBusMetrics`
  (including `messages_dead_lettered` at `:303`), `:505-533` dead-letter exchange and the
  `queue.dead_letters` queue.
- **Retry, idempotency, and saga compensation** — `core/base_agent.py:543`
  `_process_with_retry`, `:704` `_check_idempotency`, `:720` `_mark_processed`, `:791`
  `_send_to_dlq`, `:823-905` saga start / advance / complete / compensate.
- **Connection and delivery substrate** — `core/connection_pool.py` (409 lines),
  `core/outbox_publisher.py` (transactional outbox).
- **Gateway-side protections** — `apps/api-gateway/src/common/{idempotency,rate-limit,cache}/`,
  `rabbitmq-bridge.service.ts:68` `connectWithRetry`.
- **Manual degradation controls** — `core/orchestrator.py:537` `pause_all_writes`, `:582`
  `emergency_flush_buffer` — a kill switch that already exists and has never been exercised.
- **Backpressure** — `agents/buffer_manager.py`, a 30-minute LIFO window.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Whether the resilience numbers are emitted at all | [[observability-telemetry-plumbing-charter]] | They own that DLQ depth exists as a metric; we own that its value is too high and what to do about it |
| Detecting that state is silently wrong | [[state-integrity-invariants-charter]] | We handle things that break loudly and get absorbed; they handle things that are wrong quietly (`technology.md:814-815`) |
| Getting back to a known-good version | [[release-engineering-charter]] | Reverting is discrete; degrading is continuous |
| Agent business logic inside a retried handler | [[agent-fleet-charter]], [[harness-runtime-charter]] | We own the retry envelope, not what it wraps |
| That a message is *delivered once* to a vendor or guest | [[messaging-delivery-charter]] *(Engineering)* | They own the delivery contract; we own the transport's failure behaviour |
| Model/provider fallback when an LLM call fails | [[model-routing-inference-economics-charter]] | A model choice is a routing decision that happens to look like a retry |
| Which invariant a compensating saga must restore | [[inventory-ledger-charter]], [[state-integrity-invariants-charter]] | We run compensation; the invariant is theirs to define |

## Metrics it moves

- **`sre.dlq_depth_and_oldest_age` (primary)** — depth **and age of the oldest message** in
  `queue.dead_letters`. Age is the load-bearing half: "a DLQ with an old message is a
  customer-visible failure that has not been noticed yet" (`technology.md:799-800`). A DLQ
  of depth 3 with a six-week-old message is worse than a DLQ of depth 200 that drains
  hourly. **Baseline: unmeasured — nothing consumes the queue.**
- `resilience.circuit_open_duration` — total time each breaker spent open, per dependency.
  An open breaker is a *working* mechanism producing a *degraded* product; the duration is
  the part nobody looks at.
- `resilience.retry_amplification_factor` — outbound attempts per logical task. A value
  climbing under load is a retry storm forming, not resilience working.
- `resilience.buffer_evictions` — items dropped by the 30-minute LIFO window in
  `buffer_manager.py`. LIFO means the **oldest** is evicted, and the oldest is often the one
  that mattered.

## Evidence today

**EXISTS, and the mechanisms are already built** (`technology.md:791-797`). This team's
problem is not construction. Verified in this pass:

- `queue.dead_letters` is **created and bound** (`message_bus.py:505-533`) and messages are
  **counted into it** (`:771`, `:817`, `:824`, `:830` all increment
  `metrics.messages_dead_lettered`).
- **Nothing consumes it.** A grep for `dead_letter` across `message_bus.py` returns setup,
  binding, and counters — no consumer, no drain, no alert. The queue is a well-engineered
  place where problems go to be forgotten (`technology.md:802-805`).
- `orchestrator.py:537` `pause_all_writes` exists and, as far as any artifact in the repo
  shows, has **never been used**.

So the honest one-line grade is: **built, instrumented internally, and unread.**

## Why this team is distinct from its siblings

Because its success and its failure look identical from outside. When resilience works, the
system reports healthy. When resilience *absorbs a permanent failure*, the system **also**
reports healthy — the breaker held, the retry policy fired, the message went to the DLQ, and
the customer's order never happened. No other team in this department has a failure mode
that is produced *by its own machinery working correctly*.
