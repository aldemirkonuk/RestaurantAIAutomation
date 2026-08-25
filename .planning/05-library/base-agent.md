---
type: reference
name: In-house BaseAgent
category: agent-harness
url: services/agent-orchestrator/core/base_agent.py
status: candidate
decision: OD-03
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[OPEN-DECISIONS]]", "[[hermes-agent]]", "[[deepseek-harness]]"]
---

# In-house `BaseAgent`

## What it is

Verified 2026-08-24 by reading `services/agent-orchestrator/core/base_agent.py` (1,053
lines). This is the incumbent in OD-03.

What it actually provides, from the class surface:

| Concern | Evidence |
|---|---|
| Lifecycle | `start` / `stop` / `pause` / `resume` / `restart` (`:348-436`) |
| Message-bus subscription | `_setup_subscriptions`, `get_subscribed_routing_keys` (`:335`, `:437`) |
| Queued processing + retry | `_enqueue_message`, `_message_processor`, `_process_with_retry` (`:462-648`) |
| Idempotency | `_check_idempotency`, `_mark_processed` (`:704-742`) |
| Dead-letter | `_send_to_dlq` (`:791`) |
| Saga orchestration | `start_saga` / `advance_saga` / `complete_saga` / `compensate_saga` (`:823-943`) |
| Event append | `append_event` (`:944`) |
| Decision logging | `log_decision` (`:743`) |
| Metrics + health | `AgentMetrics` (`:77`), `get_health` / `get_detailed_health` / `health_check` (`:985-1035`) |

Imports are `core.message_bus`, `core.database`, `pydantic`, `asyncio`.

## The finding that matters for OD-03

**`base_agent.py` contains no LLM integration at all.** Grepping it for
`anthropic|openai|llm|completion|prompt` returns exactly one hit — the word "completion" in
a shutdown-timeout log line (`:400`). There is no model client, no token accounting, no
tool-calling loop, no prompt handling.

So the three OD-03 candidates are **not three of the same thing**:

- [[hermes-agent]] and [[deepseek-harness]] are **LLM agent harnesses** — reasoning loops,
  tool calling, model routing.
- `BaseAgent` is **distributed-workflow infrastructure** — RabbitMQ consumption, sagas,
  DLQ, idempotency, event sourcing.

Framing OD-03 as "extend `BaseAgent` vs adopt a harness" implies a swap that would not be
a swap: whichever harness wins still needs somewhere to run, and the saga/idempotency/DLQ
machinery here is not something either harness replaces. The likelier real shape is
**`BaseAgent` keeps the transport and durability; a harness supplies the reasoning loop** —
but that is a decision, not an assumption, and it is not written anywhere yet.

## Why it might matter here specifically

It is already in the tree, already carries this project's operational semantics, and is the
only one of the three whose failure modes are known here.

## What adopting it would cost

"Extending it" is not free: it would mean building model routing, cost accounting, and a
tool-calling loop from scratch — precisely the parts the other two candidates already have,
and precisely the parts NF-A (`.planning/04-specs/P1-NF-A-INSTRUMENTATION.md`) needs
instrumented.

## What decision it bears on

**OD-03**, as the incumbent — and it suggests OD-03 may be mis-framed as a three-way
either/or. Flagged, not resolved; per CLAUDE.md §0.1 this is the founder's call.

## Status

`candidate` (incumbent) — in the tree, no ADR adopts it as *the* orchestration base.
