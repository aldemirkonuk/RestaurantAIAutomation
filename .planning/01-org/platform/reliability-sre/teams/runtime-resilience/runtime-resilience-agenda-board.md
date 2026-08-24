---
type: agenda-board
division: platform
department: reliability-sre
team: runtime-resilience
status: provisional
metrics: [sre.dlq_depth_and_oldest_age, resilience.circuit_open_duration, resilience.retry_amplification_factor, resilience.buffer_evictions]
updated: 2026-08-24
links: ["[[runtime-resilience-charter]]", "[[runtime-resilience-agenda-full]]", "[[runtime-resilience-loops]]", "[[reliability-sre-agenda-board]]"]
---

# Runtime Resilience — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE type AS Artifact, status AS Status, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE team = this.team
SORT type ASC
```

## Sibling teams

```dataview
TABLE team AS Team, status AS Grade, updated AS Updated
FROM "01-org/platform/reliability-sre"
WHERE type = "charter" AND team != null AND team != this.team
SORT team ASC
```

## Stale check

```dataview
TABLE updated AS Updated, type AS Artifact
FROM "01-org/platform/reliability-sre"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

- `sre.dlq_depth_and_oldest_age` — **unmeasured.** Report **age of oldest** first; depth alone can look calm at 3
- `resilience.circuit_open_duration` — per dependency. Open past one close-time = a product finding, not a stat
- `resilience.retry_amplification_factor` — attempts per logical task. Rising under load = a storm forming
- `resilience.buffer_evictions` — **with payload class and hour**, or the number says nothing

## Open

- [ ] **DLQ consumer** — `queue.dead_letters` has none today
- [ ] Emit age of oldest, not just depth
- [ ] Circuit-breaker open duration + transition counts per dependency
- [ ] One owning retry layer per outbound path; disable nested retries; full jitter
- [ ] **429 = stop signal, never retryable**
- [ ] Buffer evictions with payload class; stock/money non-evictable → DLQ, not dropped
- [ ] Kill-switch exercise + resume runbook (with L-SRE-3)

## Watch

- `message_bus.py:771,817,824,830` increment `messages_dead_lettered` — **into a queue nobody reads**
- `orchestrator.py:537` `pause_all_writes` — exists, never exercised
- `buffer_manager.py` — 30-minute **LIFO**: the oldest ages out, and the oldest is often the one that mattered
- A breaker whose open→closed count is zero = a feature quietly switched off
- **Dependency:** if `observability.py:53` `NoopMetric` is live, every number on this board reads zero and zero looks like health

## The uncomfortable framing

This team fails **by succeeding**. Absorbed failure and no failure look identical from
outside. Every item above exists to make them look different.
