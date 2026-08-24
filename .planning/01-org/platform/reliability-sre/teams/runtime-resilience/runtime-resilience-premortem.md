---
type: premortem
division: platform
department: reliability-sre
team: runtime-resilience
status: provisional
metrics: [sre.dlq_depth_and_oldest_age, resilience.circuit_open_duration, resilience.retry_amplification_factor, resilience.buffer_evictions]
updated: 2026-08-24
links: ["[[runtime-resilience-charter]]", "[[runtime-resilience-loops]]", "[[reliability-sre-premortem]]", "[[observability-telemetry-plumbing-charter]]", "[[state-integrity-invariants-charter]]", "[[red-team-charter]]"]
---

# Runtime Resilience — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

The uncomfortable framing: **this team fails by succeeding.** Every mechanism it owns is
designed to absorb failure, and a failure that is absorbed is a failure that is not seen.

---

### M1 — The dead-letter queue was where problems went to be forgotten

The seed, stated in the evidence pass and confirmed in the code: **nothing consumes
`queue.dead_letters`.** The queue is declared and bound (`message_bus.py:505-533`) and four
separate code paths increment `messages_dead_lettered` (`:771`, `:817`, `:824`, `:830`) —
so the system carefully counts messages into a place it never reads. Retries and circuit
breakers work exactly as designed, failures land in the DLQ, and the system reports healthy
**precisely because** the resilience machinery is working
(`technology.md:802-805`). A year on, a restaurant asks why an order from March never
reached its vendor, and the answer is sitting in a queue nobody opened.

**Earliest observable signal.** `messages_dead_lettered` incrementing while
`sre.dlq_depth_and_oldest_age` is unreported — which is the state **today**. After the
consumer exists: the oldest message age crossing one close-time.

**What would have prevented it.** A consumer, and the metric that makes it accountable:
**age of oldest, not depth.** Depth can look calm at 3 while the oldest message is six
weeks old. The consumer's triage is human-gated where money or stock is touched — the same
rule `drift_agent.py:11-16` already establishes for findings — and the weekly
`sre-unowned-queue-sweep` (L-SRE-4) escalates any queue whose count rises three
close-times running, because a rising count means nobody owns it.

---

### M2 — A circuit breaker opened and stayed open, and that counted as working

`CircuitBreaker` (`message_bus.py:161-284`) does its job: a dependency starts failing, the
breaker opens, calls stop, the system stops hammering a sick service. Correct. Then the
dependency's outage is resolved in ten minutes and the breaker's half-open probe fails once
on an unrelated timeout, so it re-opens. Weeks later, a feature that depends on that path
has been quietly off. Nobody filed a bug, because nothing threw — the breaker is *supposed*
to prevent throwing.

**Earliest observable signal.** Any breaker with a non-trivial `circuit_open_duration`
across a full close-time, or — earlier and cheaper — a breaker whose open→closed transition
count is zero while its open→half-open→open count is not. A breaker that never closes is a
feature flag set to off.

**What would have prevented it.** Open duration is a **first-class metric per dependency**,
not a debug log. An open breaker beyond one close-time is a *product* finding, routed to the
owning feature's team rather than absorbed here. And half-open probe failures are attributed
to a cause, so an unrelated timeout does not silently extend an outage by weeks.

---

### M3 — Retries amplified a small outage into a self-inflicted one

`_process_with_retry` (`base_agent.py:543`), `connectWithRetry`
(`rabbitmq-bridge.service.ts:68`), plus each vendor SDK's own internal retry, plus a
user-initiated re-submit. A third party returns 503 for ninety seconds. Each layer retries
independently, the layers multiply rather than add, the third party starts returning 429,
and the 429s are retried too. The outage that would have lasted ninety seconds lasts an
hour, and the cause is our own politeness.

**Earliest observable signal.** `resilience.retry_amplification_factor` — outbound attempts
per logical task — rising above its flat baseline during a dependency wobble. Concretely:
the first time outbound request volume to a vendor goes **up** while task volume is flat.

**What would have prevented it.** A **retry budget per logical task**, enforced at one
layer and explicitly disabled at the others — nested retries are the mechanism, and the
counter-pressure is to name which layer owns the retry for each path. Full jitter, not fixed
backoff. And a 429 is treated as a *stop* signal, never as a retryable error, which is the
single change that turns amplification back into backoff.

---

### M4 — The 30-minute LIFO buffer dropped exactly the messages that mattered

`agents/buffer_manager.py` implements a 30-minute LIFO backpressure window. Under load, LIFO
serves the newest first — which means the **oldest** items are the ones that age out. The
oldest item is frequently the one that has been waiting because it is hard, or because it
belongs to a slow vendor, or because it is the stock event from the beginning of a busy
service. Load spikes during Friday dinner, the window evicts, and the evicted items are
silently the most important ones in the buffer.

**Earliest observable signal.** `resilience.buffer_evictions` non-zero at all — and,
crucially, correlated with service hours. An eviction count that peaks at 19:00 on a Friday
is not a capacity statistic, it is a description of which customers were affected.

**What would have prevented it.** Evictions are **emitted with their payload class**, not
just counted, so "we dropped 40 items" becomes "we dropped 40 stock events during dinner
service". Anything touching stock or money is not evictable — it goes to the DLQ (which now
has a reader, per M1) rather than being dropped. LIFO stays where it is correct: read-only,
recomputable work.

---

### M5 — The kill switch was used for the first time during the incident it was meant to stop

`orchestrator.py:537` `pause_all_writes` and `:582` `emergency_flush_buffer` exist. Neither
has been exercised, and there is no runbook for the state *after* the pause — how long can
the system stay paused, what happens to the buffer during it, what order things resume in,
what `emergency_flush_buffer` does to a buffer that has been accumulating for forty minutes.
The one moment somebody reaches for it is the worst possible moment to discover the answers.

**Earliest observable signal.** Today: `sre.days_since_kill_switch_exercised` has no value —
the same shape as [[release-engineering-charter]]'s untested restore, and for the same
reason. Recovery paths that are never exercised are not capabilities, they are hopes with
function names.

**What would have prevented it.** A quarterly controlled exercise on the department's
recovery-path-proving loop (L-SRE-3), producing a runbook that answers the resume questions.
Any first-in-anger use — **including a successful one** — triggers
[[release-engineering-charter]]'s L-REL-5 review, because working while unverified is luck.

---

## Cross-cutting

- **This team cannot emit its own numbers.** Every mechanism above depends on
  [[observability-telemetry-plumbing-charter]] having a live emission path; if
  [[observability-telemetry-plumbing-premortem]] M1 happens, all five mechanisms here become
  undetectable simultaneously.
- **The seam with [[state-integrity-invariants-charter]] matters under M1 and M4.** A
  dropped stock event is both a resilience failure (we lost it) and an integrity failure
  (state is now wrong). Resilience owns the loss; integrity owns the divergence.
- [[red-team-charter]] should attack the premise that absorbed failures are acceptable at
  all: at 11 restaurants, one silently dropped order is a meaningful fraction of the
  business, and "the breaker held" is not a customer-facing answer.
