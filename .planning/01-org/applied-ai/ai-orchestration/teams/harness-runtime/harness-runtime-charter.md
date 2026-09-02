---
type: charter
division: applied-ai
department: ai-orchestration
team: harness-runtime
status: exists
metrics: [nf_a.retries, nf_a.dlq_depth]
updated: 2026-08-24
links: ["[[harness-runtime-premortem]]", "[[harness-runtime-agenda-full]]", "[[harness-runtime-agenda-board]]", "[[harness-runtime-directive]]", "[[harness-runtime-loops]]", "[[harness-runtime-schedule]]", "[[ai-orchestration-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]", "[[action-safety-the-human-gate-charter]]", "[[reliability-sre-charter|reliability-charter]]", "[[technology]]", "[[README]]"]
---

# Harness & Runtime — Charter

Team of [[ai-orchestration-charter]] · Division: **Applied AI** · Alias in the team
corpus: `[[harness-runtime-charter|aio-harness-runtime]]` (`technology.md:311`).

## Mandate

The substrate every agent runs on: `BaseAgent` lifecycle, the registry and lazy-proxy
tiers, the message bus, connection pooling, saga/compensation, and feature flags. It
owns **the contract, not any agent's behavior** — a harness bug degrades all agents
identically; an agent bug degrades one (`technology.md:316-317`).

Concretely, the question this team answers is **"can it run?"** — not "did it do the
job", which is [[agent-fleet-charter]]'s.

## Boundaries

Owns outright: `services/agent-orchestrator/core/` — 11 modules, 6,375 lines.

| Module | Lines | What it owns |
|---|---|---|
| `database.py` | 2,046 | Data access under the harness |
| `base_agent.py` | 1,053 | Lifecycle, retry, idempotency, DLQ, sagas, health |
| `message_bus.py` | 1,008 | Delivery, circuit breaker, DLQ declaration |
| `orchestrator.py` | 688 | Registration, feature flags, `pause_all_writes`, buffer flush |
| `agent_registry.py` | 491 | Tiers, lazy proxies, startup order |
| `connection_pool.py` | 409 | Pooling |
| `observability.py` | 383 | Harness-side instrumentation |
| `notifications.py` · `outbox_publisher.py` · `pos_provider.py` · `__init__.py` | 297 | Supporting |

Plus the 80 pytest files that hold the contract in place.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| What an agent *does* — prompts, subscriptions, per-agent doneability | [[agent-fleet-charter]] | We care that a retry happened; they care that it was needed (`technology.md:342`) |
| Which model runs a task, and what it cost | [[model-routing-inference-economics-charter]] | We own delivery mechanics; they own economics |
| Whether an action was permitted to execute | [[action-safety-the-human-gate-charter]] | Folding the gate into the harness would put one team in charge of executing actions **and** of deciding whether execution is permitted (`technology.md:432-433`) |
| Running it in production — deploys, paging, uptime | [[reliability-sre-charter|reliability-charter]] | We author the substrate; SRE operates the deployment |
| **Consuming** the DLQ | `[[runtime-resilience-charter|sre-resilience]]` + [[agent-fleet-charter]] | We declare and fill the DLQ. Who reads it is a live gap — see premortem |
| NF-A metric definitions | [[research-math-charter|research-and-math-charter]] | We emit; they define |

## Metrics it moves

- **`nf_a.retries` and `nf_a.dlq_depth` per agent-hour** — the primary metric.
  The harness is healthy when retries are rare and the dead-letter queue is empty.
  Both fields are already in the NF-A schema ([[README]] §4.2) and **neither is
  emitted** ([[README]] §1, L4).
- `harness.agents_without_harness_guarantees` — modules doing agent work outside
  `BaseAgent`. **Today: 1.** See evidence.
- `harness.core_lines_added_since_od03_opened` — the sunk-cost meter. Not a
  performance metric; a **decision-age** metric ([[harness-runtime-loops]] §OD-03).

## Evidence today

**EXISTS — and it is the most mature L3 asset in the repo** (`technology.md:319`).

- **Lifecycle** — `core/base_agent.py`: `start/stop/pause/resume/restart` (`:348-436`)
- **Reliability** — `_process_with_retry` (`:543`), idempotency (`:704`), DLQ (`:791`)
- **Transactions** — sagas with compensation (`:823-905`)
- **Audit** — event append (`:944`); health (`:985-1035`)
- **Registry** — `AgentTier` (`agent_registry.py:27` — `CORE` / `ON_DEMAND` /
  `OPTIONAL`), `LazyAgentProxy` (`:162`), `AgentRegistry` (`:299`),
  `get_startup_order` (`:401`, topological sort over CORE-tier dependencies),
  `DEFAULT_AGENT_SPECS` (`:51`)
- **Bus** — `CircuitBreaker` (`message_bus.py:188`), DLQ declaration (`:524`)
- **Control plane** — `orchestrator.py`: `_build_feature_flags` (`:101`),
  `pause_all_writes` (`:537`), `emergency_flush_buffer` (`:582`)
- **Tests** — 80 pytest files

### The gap this team owns, verified this session

`services/agent-orchestrator/agents/recurring_order_agent.py:14` declares
`class RecurringOrderAgent:` — **a plain class, not a `BaseAgent` subclass.** 25 of
the 26 agent modules subclass `BaseAgent`; this one does not, and it is registered
nowhere (`grep` finds no reference outside its own module and
`tests/test_recurring_order_agent.py`).

Its docstring is honest — *"Standalone scheduler — not a message-bus agent"* — but the
consequence is not softened by the honesty. It gets **no `_process_with_retry`, no
idempotency key, no DLQ, no health check, no lifecycle control, and no NF-A event**,
while owning scheduled *purchasing* with, per its own feature list,
*"Auto-execution with manager approval."*

That is simultaneously a harness gap (ours) and a human-gate question
([[action-safety-the-human-gate-charter]]). Naming it in both charters is deliberate:
it is the clearest case in the department of a thing outside the contract doing work
the contract exists to protect.

## The fork that hangs over this team — OD-03

`OD-03 (OPEN-DECISIONS.md:27)` leaves the orchestration base open between
`NousResearch/hermes-agent`, `deepseek-ai/deepseek-harness`, and extending in-house
`core/base_agent.py`, with the resolution path *"a scoped bake-off on this repo's
actual workloads. No pick from repute."*

**This charter does not pick, and this team must not pick by accident.** The way a
team picks by accident is by making one option progressively more expensive to
abandon. So while OD-03 is open, this team is on a stated diet — bug fixes,
instrumentation, and interface *narrowing* only ([[harness-runtime-directive]]).
Running the bake-off is this team's job; **choosing before it runs is not.**
