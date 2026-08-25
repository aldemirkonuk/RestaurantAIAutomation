---
type: schedule
division: platform
department: reliability-sre
team: runtime-resilience
status: provisional
metrics: [sre.dlq_depth_and_oldest_age, resilience.circuit_open_duration, resilience.buffer_evictions]
updated: 2026-08-24
links: ["[[runtime-resilience-charter]]", "[[runtime-resilience-loops]]", "[[reliability-sre-schedule]]", "[[observability-telemetry-plumbing-schedule]]"]
---

# Runtime Resilience — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Continuous | **DLQ age watch** — alert when the oldest message in `queue.dead_letters` exceeds one close-time | `sre.dlq_depth_and_oldest_age` |
| Daily | **DLQ triage pass** — classify each message: replay / discard-with-reason / escalate; money and stock human-gated | `resilience.dlq_messages_replayed`, `..._discarded_with_reason` |
| Weekly | **Circuit-breaker review** (L-RES-2) — open duration per dependency, and any breaker with zero open→closed transitions | `resilience.circuit_open_duration` |
| Weekly | **Absorbed-failure report** — what the mechanisms swallowed this week, and **who was told** | Input to the department's L-SRE-4 |
| Monthly | **Retry-budget audit** (L-RES-3) — one owning layer per outbound path; assert no 429 was retried | `resilience.retry_amplification_factor`, `..._rate_limited_responses_retried_count` |
| Monthly | **Eviction review** (L-RES-4) — evictions by payload class **and hour of day** | `resilience.evictions_by_payload_class` |
| Quarterly | **Kill-switch exercise** (L-RES-5, riding L-SRE-3) — controlled `pause_all_writes`, then resume | `sre.days_since_kill_switch_exercised` |
| After any dependency incident | **Amplification post-check** — did outbound volume rise while task volume was flat? | Finding or nothing |

**The weekly absorbed-failure report is this team's most important recurring artifact.**
Everything else measures a mechanism; that one measures the thing the mechanisms hide. Its
required last column is *who was told* — a row with an empty owner is a finding
([[runtime-resilience-directive]] trigger 6).

**Anti-sprawl ([[README]] §6):** a job with no action for 3 consecutive runs is downgraded
or deleted. The DLQ triage pass is the one to watch — if it genuinely finds nothing for
three weeks, either the system is healthy or the consumer is broken, and the liveness twin
([[observability-telemetry-plumbing-charter]]) is what distinguishes those two.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion
([[README]] §3.3). **This team owns none today** — everything below is proposed.

| Skill | Tier | Trigger — the exact situation | Doneability | Real past instance |
|---|---|---|---|---|
| `dlq-triage` *(proposed)* | T3 operational | `queue.dead_letters` non-empty at the daily pass, or oldest-age alert fires | Every message replayed, discarded **with a recorded reason**, or escalated; nothing left unclassified; money/stock escalated to a human | **Yes** — the queue is declared and counted into (`message_bus.py:505-533`, `:771,817,824,830`) and **has no consumer**. The instance is ongoing |
| `retry-budget-audit` *(proposed)* | T3 operational | Monthly, and after any dependency incident or new outbound integration | A written owner-layer per outbound path; zero retried 429s; amplification factor flat under load | **Yes** — three independent retry layers exist today: `base_agent.py:543`, `rabbitmq-bridge.service.ts:68`, plus vendor SDK internals |
| `breaker-state-review` *(proposed)* | T3 operational | Weekly, and immediately when any breaker opens | Every open breaker has a duration, a cause, and an owning feature team; none open past one close-time without a product decision | **Yes** — `CircuitBreaker` at `message_bus.py:161-284` has state today and no duration accounting |
| `degradation-drill` *(proposed)* | T3 operational | Quarterly, with [[release-engineering-charter]]'s recovery-path drills | A controlled `pause_all_writes` and resume, producing a runbook that answers all four resume questions | **No.** `orchestrator.py:537` has never been exercised — the same honest gap as the untested restore, and the same argument for building it |
| `saga-compensation-verify` *(proposed)* | T2 department | A saga compensation path is added or changed (`base_agent.py:823-905`) | Compensation restores the named invariant, verified against [[state-integrity-invariants-charter]]'s definition of it — not just "the code ran" | **Partial** — the machinery exists at `:823-905`; whether any compensation has been verified against an invariant is unknown, which is itself the finding |

Two of these five cannot cite a clean past instance, and both say so. Per
[[README]] §3.3 rule 3 that normally disqualifies a skill; both are chartered anyway on the
same grounds as [[release-engineering-charter]]'s `restore-drill` — **the absence of a past
instance is the evidence**, because the path has never been exercised. That exception is
recorded here rather than quietly taken.
