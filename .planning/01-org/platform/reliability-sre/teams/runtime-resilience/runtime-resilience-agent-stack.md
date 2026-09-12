---
type: agent-stack
division: platform
department: reliability-sre
team: runtime-resilience
status: designed
updated: 2026-08-27
metrics: [sre.dlq_depth_and_oldest_age, resilience.circuit_open_duration, resilience.retry_amplification_factor, resilience.buffer_evictions]
links: ["[[runtime-resilience-charter]]", "[[runtime-resilience-schedule]]", "[[runtime-resilience-loops]]", "[[runtime-resilience-directive]]", "[[0034-agent-stack-artifact]]", "[[reliability-sre-agent-stack]]", "[[skills-charter]]", "[[harness-runtime-charter]]", "[[agent-fleet-charter]]", "[[action-safety-the-human-gate-charter]]", "[[observability-telemetry-plumbing-charter]]"]
---

# Runtime Resilience — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's success and its failure look identical from outside: when resilience absorbs
> a *permanent* failure, the breaker held, the retry fired, the message went to the DLQ,
> the customer's order never happened — and the system reports healthy
> ([[runtime-resilience-charter]] §Why this team is distinct). Its agent exists to make the
> absorbed failures visible and to name **who was told**.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `resilience-absorption-watch` | Keep an owner and an age on everything the resilience machinery swallowed — DLQ depth and oldest age, breaker open duration, retry amplification, buffer evictions — and classify each dead-lettered message without ever replaying one itself | NEW |

## 2. Agent cards

```yaml
agent: resilience-absorption-watch
unit: runtime-resilience
triggers:
  - schedule: "continuous (DLQ age watch), daily (triage pass), weekly (L-RES-2 breaker review, absorbed-failure report)"  # [[runtime-resilience-schedule]]
  - schedule: "monthly (L-RES-3 retry budget, L-RES-4 eviction review), quarterly (L-RES-5 kill-switch exercise)"
  - topic: dlq.message_arrived      # publisher: [[harness-runtime-charter]] declares and fills the queue (`message_bus.py:505-533`, `base_agent.py:791` `_send_to_dlq`); the event itself does not exist — today only a poll would see it
  - topic: breaker.opened           # publisher: NONE (gap — `CircuitBreaker` at `message_bus.py:161-284` holds state and emits no transition event)
consumes:
  - "`queue.dead_letters` — publisher: [[harness-runtime-charter]] (declares, binds and fills it). **Consumption is this team's and [[agent-fleet-charter]]'s, and today nobody does it** — see §5"
  - "`MessageBusMetrics` counters incl. `messages_dead_lettered` — publisher: `message_bus.py:296,303`, incremented at `:771,817,824,830`"
  - "retry/idempotency/saga state — publisher: `base_agent.py:543` `_process_with_retry`, `:704` `_check_idempotency`, `:823-905` saga paths (envelope ours, contents [[agent-fleet-charter]]'s)"
  - "eviction records from the 30-minute LIFO window — publisher: `agents/buffer_manager.py`"
emits:
  - "`sre.dlq_depth_and_oldest_age` → consumer: [[reliability-sre-agent-stack|sre-board-orchestrator]] (weekly unowned-queue sweep, L-SRE-4)"
  - "`resilience.circuit_open_duration`, `..._retry_amplification_factor`, `..._buffer_evictions` → consumer: the same board"
  - "the weekly absorbed-failure report, whose required last column is **who was told** → consumer: the department; a row with an empty owner is a finding"
  - "escalations for money- and stock-bearing dead letters → consumer: a human ([[action-safety-the-human-gate-charter]])"
  - nf_a events (task_type: resilience_dlq_triage, resilience_breaker_review)
routing_class: judgment      # classifying one dead message as replay / discard-with-reason / escalate is a judgment about a real customer order
quality_bar: "nothing is left unclassified: every message reaches replay, discard-with-a-recorded-reason, or escalation; every open breaker has a duration, a cause and an owning feature team. NONE (gap) — no verdict basis grades a disposition's correctness (ADR 0017 has no such grader)"
autonomy:
  read: autonomous
  propose: autonomous          # classifications and reports land as PRs
  mutate_stock_money_outbound: confirm   # constant
memory: runtime-resilience
escalates_to: "[[reliability-sre-charter]]"
```

**The card's own hard rule.** A **replay is a mutation** — it re-executes a message that
may move stock, money or an outbound send, and it is exactly the class the constant above
covers. This agent classifies and recommends; a human replays. The same applies to
`orchestrator.py:537` `pause_all_writes`: the quarterly kill-switch exercise is prepared
and timed by the agent and pulled by a person.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `dlq-triage` | T3 | `queue.dead_letters` non-empty at the daily pass, or the oldest-age alert fires | Every message replayed, discarded **with a recorded reason**, or escalated; nothing unclassified; money and stock escalated to a human | The queue is declared, bound and counted into (`message_bus.py:505-533`; `:771,817,824,830`) and **has no consumer** — a grep returns setup, binding and counters only. The instance is ongoing | NEW |
| `retry-budget-audit` | T3 | Monthly, and after any dependency incident or new outbound integration | One written owner-layer per outbound path; zero retried 429s; amplification factor flat under load | Three independent retry layers exist today: `base_agent.py:543`, `rabbitmq-bridge.service.ts:68` `connectWithRetry`, plus vendor SDK internals | NEW |
| `breaker-state-review` | T3 | Weekly, and immediately when any breaker opens | Every open breaker has a duration, a cause and an owning feature team; none open past one close-time without a product decision | `CircuitBreaker` at `message_bus.py:161-284` has state today and **no duration accounting** — an open breaker is a working mechanism producing a degraded product | NEW |

**Two proposed skills are deliberately not rows.** [[runtime-resilience-schedule]] also
proposes `degradation-drill` and `saga-compensation-verify`; neither can cite a clean past
instance, and ADR 0034 §7.2 holds a stricter line than [[README]] §3.3's chartered
exception. `orchestrator.py:537` `pause_all_writes` has **never been exercised**, and
whether any saga compensation at `base_agent.py:823-905` was ever verified against a named
invariant is **unknown** — itself the finding. Both stay in the schedule and in loop
`res-degradation-control-readiness` (close_time: quarterly).

Consumed, owned elsewhere: emission of these numbers as metrics
([[observability-telemetry-plumbing-charter]] — they own that DLQ depth exists, we own that
its value is too high); the harness and the DLQ's declaration ([[harness-runtime-charter]]);
business logic inside a retried handler ([[agent-fleet-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: resilience_dlq_triage` and `resilience_breaker_review`.
  Needs `context.disposition` (`replayed` | `discarded` | `escalated`),
  `context.payload_class`, `context.age_at_triage_seconds` and `context.dependency` as jsonb
  keys. Without `payload_class` the eviction review cannot answer its own question — LIFO
  evicts the **oldest**, and the oldest is often the one that mattered.
- **Semantic** — `memory/` beside this file, `runtime-resilience-MEMORY.md` as index. Its
  founding facts are known and would be the first two files: the DLQ has no consumer
  anywhere in the repo (source: `message_bus.py:505-533` grep, 2026-08-24), and
  `pause_all_writes` exists and has never been used (source:
  [[runtime-resilience-charter]] §Evidence). Every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. `message_bus.py`
  and `base_agent.py` are retrieval targets by `path:line`, never preloaded (CLAUDE.md §2).

**Consolidation** — monthly, to be mirrored in [[runtime-resilience-schedule]] (not a row
there yet): read the month's triage and breaker events; **failures first** — a payload class
recurring in the DLQ becomes a fact naming the upstream mechanism, not "some orders failed";
a discard reason used more than three times becomes a skill candidate or a bug handed to the
owning feature team. Expire facts unverified for 90 days. One PR; "no delta" stated — and
here it needs the liveness twin to separate *healthy* from *the consumer is broken*
([[observability-telemetry-plumbing-charter]]).

## 5. Async contract

Cross-unit interaction is loops ([[runtime-resilience-loops]]), NF-A events and vault PRs.
Gap rows:

| Gap | Why it is a gap |
|---|---|
| **DLQ consumption is unowned in code** | [[harness-runtime-charter]] declares and fills `queue.dead_letters` and explicitly does not read it; consumption sits with this team **and** [[agent-fleet-charter]], and today no code on either side consumes it. Two named owners and zero implementations is worse than one owner, and it is stated here rather than assumed away |
| `dlq.message_arrived` / `breaker.opened` have no publishers | The mechanisms hold state and increment counters but publish no transition events, so the continuous age watch degrades to a poll and the weekly breaker review can miss a breaker that opened and closed inside the window |
| The absorbed-failure report's "who was told" column has no channel | The report can name an owner; nothing delivers the message to them. Same missing paging path as [[observability-telemetry-plumbing-charter]]'s absence alerts |

## 6. Evidence today

- **EXISTS — every mechanism, and that is the point.** Circuit breaking
  (`message_bus.py:161-284`), dead-letter exchange and queue (`:505-533`), retry /
  idempotency / saga (`base_agent.py:543,704,720,791,823-905`), `connection_pool.py` (409
  lines), `outbox_publisher.py`, gateway idempotency/rate-limit/cache,
  `agents/buffer_manager.py`, and the manual kill switch at `orchestrator.py:537,582`.
- **The honest one-line grade from the charter: built, instrumented internally, and unread.**
- **NEW — the agent and all three skills.** Nothing triages the queue; the team owns no
  skill today.
- **PARTIAL / unmeasured — every metric.** `sre.dlq_depth_and_oldest_age` has no baseline
  because nothing consumes the queue; breaker open **duration** is not accounted at all.
