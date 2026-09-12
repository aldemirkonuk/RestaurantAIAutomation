---
type: agent-stack
division: research-math
department: research-math
team: harness-model-routing
status: designed
updated: 2026-08-27
metrics: [nf_a.cost_per_completed_task, nf_a.harness_overhead_ms, share_of_model_calls_through_wrapper]
links: ["[[harness-model-routing-charter]]", "[[harness-model-routing-schedule]]", "[[harness-model-routing-loops]]", "[[harness-model-routing-directive]]", "[[0034-agent-stack-artifact]]", "[[research-math-agent-stack]]", "[[evaluation-doneability-agent-stack]]", "[[harness-runtime-charter]]", "[[engineering-charter]]", "[[skills-charter]]"]
---

# Harness & Model Routing (RM-1) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Two open forks constrain this card and neither may be resolved in it. **OD-03** forbids a
> pick from repute, so nothing here presupposes a harness. **OD-29** records that this team
> and `aio-model-routing` carry the same mandate *and* the same NF-A cost metric
> (OD-29, `OPEN-DECISIONS.md:37`), so this card measures and publishes and leaves ownership to the
> founder.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `wrapper-adoption-sentinel` | Keep three numbers true — every model callsite and whether it goes through the wrapper, emits NF-A and retries; the raw-`fetch` count; and the cost-per-*completed*-task figure — without migrating a callsite or picking a harness | NEW |

## 2. Agent cards

```yaml
agent: wrapper-adoption-sentinel
unit: harness-model-routing
triggers:
  - schedule: "weekly — publish adoption + raw-fetch count, even when flat"   # [[harness-model-routing-schedule]]
  - schedule: "monthly — cost-per-completed-task review with RM-2; routing-seam audit"
  - schedule: "quarterly — bake-off re-run; model-roster (OD-04) review; first-party-training trigger check"
  - topic: model.callsite_added     # publisher: NONE (gap — only PR review notices an eighth callsite)
consumes:
  - the gateway and orchestrator callsite census — publisher: the repo (apps/api-gateway/src, services/agent-orchestrator)
  - neural_footprint_event cost, token and latency fields — publisher: model-client.service.ts:413, spend_logger.py:406
  - 'verdicts per task type — publisher: "[[evaluation-doneability-charter]]" (a routing change is justified by a verdict, never by price alone)'
emits:
  - 'share_of_model_calls_through_wrapper and the raw-fetch count — consumer: "[[research-math-agenda-board]]"; published even when flat, because absence is the failure signal'
  - a same-day escalation when a new bypassing callsite appears — consumer: "[[research-math-charter]]"
  - 'a migration list for the callsites still outside the wrapper — consumer: "[[engineering-charter]]" (they own adoption; we own the deprecation date)'
  - 'nf_a events (task_type: callsite_audit) — consumer: "[[neural-footprint-instrumentation-charter]]"''s contract'
routing_class: mechanical         # grep, count, diff; the judgment calls in this team are the bake-off's, and they belong to a human plus RM-2's pass conditions
quality_bar: "the census is reproducible — a rerun on the same commit yields the same counts; NONE (gap) — ADR 0017 defines no verdict basis for an audit, so nothing independently grades this agent"
autonomy:
  read: autonomous
  propose: autonomous             # census, escalations and migration lists land as PRs
  mutate_stock_money_outbound: confirm    # constant; and cost telemetry is read-only to this agent
memory: harness-model-routing
escalates_to: "[[research-math-charter]]"
```

**The card's own hard rules.** The sentinel does not migrate callsites — that is
[[engineering-charter]]'s, by the charter's own non-goals — and it does not choose a
harness or a model. It reports `nf_a.cost_per_completed_task` only with RM-2's verdict on
the same page; cost read alone rewards a cheap wrong answer.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `model-callsite-audit` | T2 | Any PR touching `apps/api-gateway/src` or `services/agent-orchestrator` | Every model callsite listed with three flags — wrapper / NF-A / retry — and any new bypassing site named with `path:line` | The seven raw-HTTP callsites were found only by hand-grep for [[harness-model-routing-charter]] (2026-08-24); P1 then routed them through `common/model-client`, and the service's own comment now says **9 emitting sites** (`model-client.service.ts:410`) — the count moved twice with nothing watching it | NEW |
| `model-bakeoff-run` | T2 | Quarterly, or a major model release | A cost + latency + verdict table on this repo's own workloads, pass conditions supplied by RM-2 before any candidate runs | `scripts/benchmark_haiku_vs_sonnet.py` (374 lines) — the right shape, written and *"run once and never again"* (`technology.md:387-390`) | NEW |
| `routing-config-lint` | T2 | Any new model literal or model env var | Fails on a hardcoded model string outside the routing policy | Five conventions coexisted with no policy: two literals (`photo-count.service.ts:60`, `scan-parser.service.ts:261`), one module constant (`inbound-responder.service.ts:21`), three env vars | NEW |

`harness-overhead-probe` is listed in [[harness-model-routing-schedule]] and is **not a row
here**. Its stated past instance is the *absence* of an instrument, which is a condition,
not a repeated procedure — §3.3 does not admit it. It becomes a row after the first probe
run. This is the gate biting on the team that would most like it not to.

Consumed, owned elsewhere: the envelope and registry ([[skills-charter]]); the Python
substrate as running code ([[harness-runtime-charter]] — **OD-03 open**); pass conditions
and verdicts ([[evaluation-doneability-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates reach [[skill-harvesting-charter]]'s queue and
  face the §3.3 gate.
- **Episodic** — nf_a `task_type: callsite_audit`, plus read access to the cost and latency
  fields of every model call. Needs `context.callsite` and `context.task_type` as jsonb
  keys: cost per *task* is not derivable from cost per *call* without them, which is the
  distinction the charter's headline metric is defined on.
- **Semantic** — `memory/` beside this file, indexed by `harness-model-routing-MEMORY.md`.
  Its first facts are already known: the 7→9 callsite count and what moved it; which
  callsites retry and which surface a 429 to the user; the five model-choice conventions and
  which survive. `source`, `confidence`, `last_verified` in frontmatter; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §The routing seam. The
  1,058-line `base_agent.py` and 598-line `model-client.service.ts` are grep targets.

**Consolidation** — monthly, mirrored in [[harness-model-routing-schedule]]: diff this
month's census against last month's facts; **failures first** — a callsite that left the
wrapper, or a retry added without instrumentation, becomes a fact naming the mechanism;
expire facts unverified for 90 days; propose skill candidates. One PR; "no delta" stated
when true, because a flat adoption number is the report.

## 5. Async contract

Cross-unit interaction is loops ([[harness-model-routing-loops]]), NF-A events, vault PRs
and skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| **OD-29 — resolved 2026-08-28 (founder, ADR 0036): two plans in parallel, in harmony** | This team owns the *methodology* — benchmark design, what cost-per-task means, substitution-study rules; `aio-model-routing` owns the *operation* — the wrapper (`common/model-client`, the charter's "one shared wrapper" made real by P1) and the production routing policy (OD-29, `OPEN-DECISIONS.md:37`). Same line as TECH-F3, same escalation: if it fails, merge — never duplicate |
| `model.callsite_added` has no publisher | Nothing emits when a new model call lands. The weekly scan bounds the blind spot at 7 days; the count has already moved 7→9 unwatched |
| `nf_a.harness_overhead_ms` has no instrument | Grepping `apps`, `services`, `scripts` for `harness_overhead` returns **0 hits** (verified 2026-08-27). The number that decides OD-03 cannot be consumed because nothing emits it |
| Cost-per-completed-task needs RM-2's join | Computable now for graded task types, and **not** for the 12 on the exemption list (`.planning/STATE.md:98-105`); the denominator must publish with the number or it reads as complete |

## 6. Evidence today

- **EXISTS, and newer than the charter — the wrapper the charter chartered.**
  `apps/api-gateway/src/common/model-client/model-client.service.ts` (598 lines) holds the
  only `api.anthropic.com` URL in the gateway (`:7`; the sole other hit in
  `apps/api-gateway/src` is a comment at `analytics/analytics.controller.ts:48`), with a
  default timeout (`:12`), transport retry with jittered backoff (`:15-17`), spend tiers,
  correlation and NF emission (`:413`). The charter's "0 of 7" baseline is superseded.
- **EXISTS — the in-house OD-03 candidate.** `services/agent-orchestrator/core/base_agent.py`
  (1,058 lines) with retry, `_process_with_retry`, idempotency, DLQ and saga compensation
  across the `agents/` modules — a genuine candidate, and still only one of the options.
- **NEW — measurement of the harness itself**, and the sentinel and all three skills. No
  overhead instrument, no bake-off since `benchmark_haiku_vs_sonnet.py`, no routing policy,
  no lint; every past instance cited above is hand-work from the 2026-08-24→27 sessions.
