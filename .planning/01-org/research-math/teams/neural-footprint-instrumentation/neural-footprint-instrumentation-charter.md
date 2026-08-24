---
type: charter
division: research-math
department: research-math
team: neural-footprint-instrumentation
status: partial
metrics: [nf_a.event_completeness, nf.private_telemetry_tables, nf_b.identifier_coverage]
updated: 2026-08-24
links: ["[[neural-footprint-instrumentation-premortem]]", "[[neural-footprint-instrumentation-agenda-full]]", "[[neural-footprint-instrumentation-agenda-board]]", "[[neural-footprint-instrumentation-directive]]", "[[neural-footprint-instrumentation-loops]]", "[[neural-footprint-instrumentation-schedule]]", "[[research-math-charter]]", "[[harness-model-routing-charter]]", "[[evaluation-doneability-charter]]", "[[0006-neural-footprint-architecture]]", "[[data-charter]]", "[[security-charter]]", "[[analytics-bi-charter]]", "[[guest-experience-charter]]", "[[intelligence]]", "[[OPEN-DECISIONS]]"]
---

# Neural Footprint Instrumentation (RM-3) — Charter

Parent: [[research-math-charter]] · Division: **Intelligence** · Siblings:
[[harness-model-routing-charter]], [[evaluation-doneability-charter]].

## Mandate

Own the **NF event contract end to end** — schema, emission, join keys, retention — for
every `subject_type`, so that NF-A and NF-B remain **one object** rather than two
dashboards sharing a name ([[README]] §4.1). The definition this team is instrumenting is
not a metric list; it is a shape:

> **Neural footprint** = the durable, structured trace a decision-maker leaves behind —
> enough signal to model *why* it chose what it chose, not merely *what* it chose.
> Recorded as **stimulus → internal state → choice → outcome**
> ([[0006-neural-footprint-architecture]]).

A row that records the choice and not the state is not a footprint. That is the standard
this team holds, and it is why `api_spend` and `decision_log` each fail it separately.

## Why distinct from its siblings

[[harness-model-routing-charter]] and [[evaluation-doneability-charter]] are both
*clients* of the footprint — one emits, one reads. Neither can own the contract without
bending it toward its own query pattern. This is plumbing with a schema decision attached
(OD-11 is open), and its failure mode — **events that exist but cannot be joined** — is
invisible to both siblings until someone tries to answer a question
(`intelligence.md:148-152`).

## Boundaries

Owns outright:

- **The event contract** — fields, semantics, join keys, `subject_type` vocabulary,
  retention and rollup policy. For **every** subject, not just agents.
- **Emission** — that a model call, an agent decision, or a guest choice actually writes
  one joinable event.
- **The architecture locked in [[0006-neural-footprint-architecture]]**: a **narrow
  polymorphic production store** (`subject_type` ∈ `agent | guest | bio`, partial indexes
  per subject, only the columns a live decision needs) *and* a **wide, append-only
  research store** that is never migrated — new fields are added, old rows keep their
  shape.
- **The gated NF-C track.** The `subject_type` slot reserves it so it needs no migration
  later, and an append-only research log has no schema to break. Entry trigger must be
  explicit — *a funded study partner, or a consumer-grade biosignal device with an API*.
  This team is the one that declares it met, and until it is met NF-C carries **no design
  tax** on the two tracks that carry the product.
- **The privacy-relevant mechanics already shipped on the NF-B side**: peppered
  `channel_hash`, erasure (`erased_at`), and the co-presence negative view.

**Why this team owns the research store specifically.** The founder's separate-company
proposal was declined and the separation was granted **in the data model instead**, where
it is cheap ([[0006-neural-footprint-architecture]] Consequences;
[[0001-mudavym-single-entity]] review trail). The research store *is* that grant. If it is
never built, the compensation was rhetorical.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| The physical table, the migration, the pipeline | [[data-charter]] *(Platform)* | **We own the schema contract; Data owns the DDL.** OD-11 must name both owners or it gets implemented twice (`intelligence.md:486`) |
| What the numbers mean once emitted | [[harness-model-routing-charter]], [[evaluation-doneability-charter]] | We are the recorder, not a client |
| Interpreting unauthenticated inference spend | [[security-charter]] SEC-3 | We emit the cost with its subject; they own the exposure |
| Guest taste fingerprints and personalization | [[guest-experience-charter]] *(Product)* | We own NF-B's **contract**; they own NF-B **applied** |
| Operator-facing analytics narrative | [[analytics-bi-charter]] AB-2 | They consume; we record |
| Lawful basis, consent, DPAs | Compliance & Privacy *(Corporate)* | We build erasure and hashing mechanics; they own whether we may collect at all |

## Metrics it moves

| Metric | Definition | Baseline |
|---|---|---|
| `nf_a.event_completeness` | Share of model invocations emitting **one joinable event carrying all eight NF-A fields** (task type, model, tokens, latency, retries, tool calls, doneability verdict, cost — [[README]] §4.2) | **0% for the NestJS surface**; partial for Python across two unjoined tables |
| `nf.private_telemetry_tables` | Count of tables holding cost/token/verdict data outside the NF contract | **1** today (`api_spend`). **2 is the alarm** |
| `nf_b.identifier_coverage` | Share of checks linkable to a guest identity | Substrate exists; capture has not started |

**Honest framing of the headline number:** `event_completeness` is 0% on the surface that
carries the majority of production model traffic. Publishing that zero is the point — a
metric that starts honest can only be moved by work.

## Evidence today

**PARTIAL — and the halves do not meet.**

**EXISTS — the reasoning half.** `services/agent-orchestrator/core/base_agent.py:743-784`
`log_decision()` writes `agent_name`, `decision_type`, `inputs`, `reasoning`, `output`,
`confidence`, `correlation_id` to `decision_log`. That is a genuine *stimulus → internal
state → choice* trace — **the hard part of [[README]] §4.4**, and the part most systems
never build. It carries no cost, no latency, no verdict.

**EXISTS — the cost half, separately.**
`services/agent-orchestrator/services/spend_logger.py:41-77` writes `provider`, `model`,
`input_tokens`, `output_tokens`, `cost_usd`, `restaurant_id`, `timestamp` to `api_spend`.
It fails soft by design (`:83-86`, never re-raises) — correct for a telemetry writer.

**The gap, stated exactly.** Neither table carries the other's fields, and neither carries
a doneability verdict or latency. **Of the eight NF-A fields, no single row anywhere holds
more than four.**

**⚠️ The first concrete assignment, and it is one argument.**
`SpendLogger.log()` (`spend_logger.py:41-48`) takes
`provider, model, input_tokens, output_tokens, cost_usd, restaurant_id` — **and no
`agent`**. So *"cost per task per agent"* — a phrase used freely in this org's planning
documents — **is not derivable from anything this system writes today**, even on the
Python side where cost *is* logged. Not a design debate. A missing parameter and a missing
column.

**NEW / zero — the NestJS side emits nothing at all.** Grepping `apps/api-gateway/src` for
`api_spend`, `cost_usd` or `input_tokens` returns **0 hits** (verified 2026-08-24). The
seven production model callsites in [[harness-model-routing-charter]]'s evidence therefore
run with **no cost telemetry whatsoever** — including
`analytics/consultants.service.ts:28`, which is reachable from an unguarded route (OD-20)
and calls Opus.

**EXISTS — NF-B substrate is further along than NF-A.**
`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql` ships `guests`
(`:40`), `guest_identifiers` with peppered `channel_hash` (`:122`, `:195`, `:369`),
`guest_check_links` (`:206`), `erased_at` for erasure (`:112`), and the
`guest_copresence_negatives` view (`:532`). The guest track has privacy mechanics before
the agent track has cost mechanics — a real and slightly awkward asymmetry, and worth
naming rather than smoothing over.

**NEW — the research store does not exist.** [[0006-neural-footprint-architecture]] locks
the production/research split; only the production side has any implementation at all, and
that partially.

## Open forks this team carries

| Ref | Fork |
|---|---|
| **OD-11** | Exact production columns, partial-index strategy per `subject_type`, retention/rollup for the research log. **Gates every NF implementation** |
| **F-3** (`intelligence.md:519`) | **NF has no `subject_type` for the restaurant operator.** [[README]] §4.4 allows `agent \| guest \| bio`, but the strongest human-preference signal the product already collects — recommendation act/dismiss/snooze/done/pin, via `recommendation_actions` — is **neither an agent nor a guest**. Add `operator`, or route it outside NF? Adding a fourth value is free before launch and a migration afterward, so this decides **inside** the OD-11 session, not after it |
| *(this charter)* | Who owns the DDL — OD-11 must name both this team and [[data-charter]], or the schema ships twice |
| **NF-C** | Gated. Entry trigger to be confirmed in the founder's own words so the declaration is not ours to invent later |
