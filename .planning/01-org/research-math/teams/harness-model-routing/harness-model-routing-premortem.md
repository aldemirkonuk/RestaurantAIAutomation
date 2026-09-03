---
type: premortem
division: research-math
department: research-math
team: harness-model-routing
status: provisional
metrics: [nf_a.cost_per_completed_task, nf_a.harness_overhead_ms, share_of_model_calls_through_wrapper]
updated: 2026-08-24
links: ["[[harness-model-routing-charter]]", "[[harness-model-routing-loops]]", "[[harness-model-routing-directive]]", "[[research-math-premortem]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[engineering-charter]]", "[[harness-model-routing-charter|aio-model-routing]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Harness & Model Routing (RM-1) — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. RM-1 has failed. What happened?

The team's inherited premortem line (`intelligence.md:96-99`) is M1 below. Four more
follow, because the seed failure has three distinct sequels and one independent sibling.

---

### M1 — OD-03 was settled by reputation, and the seven callsites never migrated

A harness was adopted on the strength of its community, its README and its star count. No
latency table was produced, because producing one needed `nf_a.harness_overhead_ms`, and
no instrument for it was ever built. The chosen harness governs the Python side. The seven
NestJS callsites — the **majority of production model traffic** — were never migrated,
because migration is [[engineering-charter]]'s work and no deprecation date was set. The
org now maintains **two** harnesses and measures **neither**.

**Earliest observable signal.** A decision record for OD-03 whose evidence section cites
GitHub stars and contains no latency table. Earlier still: the OD-03 session appearing on
a calendar while `harness_overhead_ms` still reads *unmeasured*.

**Counter-pressure.** Mechanical, not cultural. `OD-03 (OPEN-DECISIONS.md:28)` already states the
rule — *"A scoped bake-off on this repo's actual workloads. No pick from repute."* — so:
(1) the bake-off **cannot be scheduled** until the overhead instrument has published a
first reading ([[harness-model-routing-directive]] rule 2); (2)
[[decision-office-charter]] rejects an OD-03 ADR with no measurement from this repo in its
evidence section; (3) the bake-off must include **extending `base_agent.py`** as a scored
candidate, not as the incumbent it is polite to mention — 1,053 lines with retry,
idempotency, DLQ and sagas is a real candidate and treating it as the default loser is
also a pick from repute, just inverted.

---

### M2 — The wrapper shipped and became the eighth convention

The wrapper is written, it is good, and three teams adopt it for *new* code. The five
existing model-choice conventions stay — two hardcoded literals
(`photo-count.service.ts:60`, `scan-parser.service.ts:261`), one module constant
(`inbound-responder.service.ts:21`), three env vars. Nothing is deleted, because deleting
requires touching seven services owned by another department. A year later the repo has
six conventions instead of five, and the wrapper's adoption metric has been quietly
retired because it was embarrassing.

**Earliest observable signal.** `share_of_model_calls_through_wrapper` published once and
then missing from [[harness-model-routing-agenda-board]] for a single close-time. The
metric disappearing is the signal — not the number being low. A low number with a
deprecation date attached is a plan.

**Counter-pressure.** The deprecation date ships **in the same PR as the wrapper**, not
after it, and it names the seven files. Adoption publishes weekly whether or not it moved.
And the wrapper's first customer is deliberately the hardest one —
`analytics/consultants.service.ts`, which is unguarded (OD-20) and reaches an Opus call —
so the first migration proves the wrapper on the callsite that most needs retry, budget
enforcement and cost telemetry, rather than on the easiest one.

---

### M3 — Routing optimised on price alone, and quality fell where nobody was looking

The routing policy lands and immediately produces a saving: a cheaper model is substituted
for invoice extraction. Nothing regresses in CI, because the CI for invoice extraction is
"the handler did not raise" (`base_agent.py:144`). Field quality degrades below a
threshold nobody was measuring; the repair work — re-extractions, manual corrections, a
vendor dispute — costs more than the saving. This is the exact scenario
`scripts/benchmark_haiku_vs_sonnet.py` was written to prevent, run once and never again
(`technology.md:387-390`).

**Earliest observable signal.** `nf_a.cost_per_completed_task` falling in the same
close-time that `nf_a.verified_task_success_rate` falls. Two down-arrows presented as one
win. Also: any routing change whose PR description contains a price comparison and no
verdict comparison.

**Counter-pressure.** A routing change is admissible **only against a verdict**, never
against price alone — and the verdict is authored by [[evaluation-doneability-charter]],
which this team cannot edit. That is why the metric is cost per *completed* task: a task
with no passing verdict contributes cost and no denominator, so a cheap wrong answer makes
the number **worse**. The bake-off re-runs quarterly rather than once
([[harness-model-routing-schedule]]) precisely because `benchmark_haiku_vs_sonnet.py`
already demonstrated what a one-time study is worth.

---

### M4 — Retry was added everywhere and became a spend amplifier

Three of seven callsites answer a 429 with a user-visible failure today, so retry is
obviously right and gets added uniformly. `analytics/consultants.service.ts` is reachable
**without authentication** (OD-20) and calls Opus at `max_tokens: 4096`. Retry with
exponential backoff, applied there, multiplies an unauthenticated caller's cost by the
retry factor. The team's own fix made the denial-of-wallet exposure worse, and nobody saw
it because that callsite emits no cost events.

**Earliest observable signal.** Retry merged into a callsite whose route has no
`JwtAuthGuard` **before** that callsite emits a cost event. The ordering is the tell.

**Counter-pressure.** Ordering is enforced, not advised: **a callsite gets cost
instrumentation before it gets retry.** Never the reverse. The wrapper carries a
per-caller budget check as a first-class feature rather than a later addition, and
[[security-charter]] SEC-3 is a named reviewer on the first three migrations — its primary
metric (`nf_a.unauthenticated_inference_spend`) is downstream of exactly this code path.

---

### M5 — The routing seam was never resolved, and two units built two policies

The Intelligence/Applied-AI boundary was published for **evaluation** and never for
routing. `[[harness-model-routing-charter|aio-model-routing]]` holds the same mandate and the same primary metric as
this team. Neither unit escalated, because each read the other's charter as adjacent
rather than overlapping. Two wrappers, two policies, two dashboards, and the first
production incident is a model routed one way by one path and another way by the other.

**Earliest observable signal.** A second client-construction module. Concretely: any new
file that does the job of `services/agent-orchestrator/services/model_clients.py` in
TypeScript without this team on the review.

**Counter-pressure.** The seam is named in [[harness-model-routing-charter]] as
**unresolved** rather than claimed, and it is a standing monthly item in
[[research-math-loops]] L6 with an explicit rule: *if either unit is maintaining an
artifact the other also maintains, the RM team files the merge proposal itself.* Until the
founder rules, the first deliverable is **one wrapper both units use** — shared code
resolves a boundary dispute faster than a boundary document does.

---

## Cross-cutting counter-pressure

- **The instrument precedes the decision** ([[harness-model-routing-directive]] rule 2).
  M1 and M3 are both that rule being skipped.
- **Author ≠ auditor.** This team may dispute a verdict from
  [[evaluation-doneability-charter]] in writing; it may never edit one. M3 dies here.
- **[[red-team-charter]] attacks the bake-off design specifically** — candidate list,
  workload selection, and whether `base_agent.py` was scored honestly. Findings-only,
  into `questions.md`.
- **Anti-sprawl.** If this document has not been revisited in 60 days it is fiction
  ([[README]] §3.3).
