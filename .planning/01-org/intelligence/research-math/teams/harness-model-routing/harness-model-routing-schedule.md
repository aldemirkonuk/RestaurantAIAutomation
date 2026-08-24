---
type: schedule
division: intelligence
department: research-math
team: harness-model-routing
status: provisional
metrics: [nf_a.harness_overhead_ms, nf_a.cost_per_completed_task, share_of_model_calls_through_wrapper]
updated: 2026-08-24
links: ["[[harness-model-routing-charter]]", "[[harness-model-routing-loops]]", "[[harness-model-routing-directive]]", "[[harness-model-routing-agenda-board]]", "[[research-math-schedule]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[engineering-charter]]", "[[security-charter]]"]
---

# Harness & Model Routing (RM-1) — Schedule & Skills

## Non-preemptible

One item from the department's protected lane ([[research-math-schedule]]) is this team's:
**the OD-03 bake-off on this repo's own workloads.** It may not be compressed to fit a
release. A truncated bake-off produces a pick from repute with a table stapled to it —
which is worse than an honest deferral, because it looks decided. Preemption is a founder
decision recorded in `OPEN-DECISIONS.md`.

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Weekly** | Publish `share_of_model_calls_through_wrapper` and the raw-`fetch` callsite count (**7** today) — **published even when flat**; absence is the failure signal | NF-A |
| **Weekly** | Scan for new model callsites bypassing the wrapper. Anything above 7 is a same-day escalation | — |
| **Weekly** | Retry-vs-instrumentation invariant check: `unguarded_callsites_with_retry` must read 0 | — |
| **Fortnightly** | Callsite migration review with [[engineering-charter]] — which of the 7 moved, which slipped, why | — |
| **Monthly** | Cost-per-completed-task review with [[evaluation-doneability-charter]]. Cost is never read alone; the verdict is on the same page | NF-A |
| **Monthly** | Routing-seam audit — any second client-construction module or duplicate policy vs `[[aio-model-routing]]`. Terminates in a founder ruling rather than recurring forever | — |
| **Quarterly** | **Bake-off re-run** — `scripts/benchmark_haiku_vs_sonnet.py` plus whatever the current roster is. The precedent for this cadence is that the script exists and was run once (`technology.md:387-390`) | NF-A |
| **Quarterly** | Model-roster review (OD-04) against RM-2 quality results and current provider pricing | — |
| **Quarterly** | First-party-training trigger check: has any model in `services/agent-orchestrator/training/` beaten the API baseline on an RM-2 golden set? | — |

**Anti-sprawl.** A job here that produces no action for **3 consecutive runs** is
downgraded or deleted ([[README]] §6). Two are already designed to die: the
bypass scan should become a CI check (a script, not a meeting) once the wrapper exists,
and the seam audit ends when the founder rules.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion
([[README]] §3.3). Under the §3.3 protocol every skill below names a **trigger**,
**doneability criteria**, and **a real past instance** — no speculative skills.

| Tier | Skill | State | Trigger · Doneability · Real past instance |
|---|---|---|---|
| **T3** | `model-callsite-audit` | **Proposed — build first** | *Trigger:* any PR touching `apps/api-gateway/src` or `services/agent-orchestrator`. *Done:* reports every model callsite, whether it uses the wrapper, whether it emits NF-A, whether it retries. *Past instance:* the seven raw-HTTP callsites were found by hand-grep for this charter; nothing prevents an eighth |
| **T3** | `harness-overhead-probe` | **Proposed** | *Trigger:* a bake-off run or a wrapper change. *Done:* emits `nf_a.harness_overhead_ms` per candidate on a fixed workload. *Past instance:* OD-03 has been open since 2026-08-24 with no instrument to decide it |
| **T2** | `model-bakeoff-run` | **Proposed, after the probe** | *Trigger:* quarterly, or a major model release. *Done:* a cost + latency + verdict table on real workloads, pass conditions supplied by RM-2. *Past instance:* `scripts/benchmark_haiku_vs_sonnet.py` — right shape, run once |
| **T3** | `routing-config-lint` | **Proposed, after the policy exists** | *Trigger:* any new model literal or env var. *Done:* fails on a hardcoded model string. *Past instance:* five conventions today — `photo-count.service.ts:60`, `scan-parser.service.ts:261`, `inbound-responder.service.ts:21`, and three env vars |

**Honest note.** None of these exist. The team owns one script that is close in spirit
(`scripts/benchmark_haiku_vs_sonnet.py`) and nothing that runs on a schedule. `SKILLS.md`
at the repo root is a prose reasoning protocol, not a skill, and still says "WineOps AI"
(OD-14). Build `model-callsite-audit` first: it is the only one that prevents the
situation this charter documents from silently getting worse while the rest is being
built.
