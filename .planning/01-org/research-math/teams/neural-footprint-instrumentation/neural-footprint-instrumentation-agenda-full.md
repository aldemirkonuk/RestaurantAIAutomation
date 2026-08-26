---
type: agenda-full
division: research-math
department: research-math
team: neural-footprint-instrumentation
status: provisional
metrics: [nf_a.event_completeness, nf.private_telemetry_tables]
updated: 2026-08-24
links: ["[[neural-footprint-instrumentation-charter]]", "[[neural-footprint-instrumentation-premortem]]", "[[neural-footprint-instrumentation-agenda-board]]", "[[neural-footprint-instrumentation-directive]]", "[[neural-footprint-instrumentation-loops]]", "[[neural-footprint-instrumentation-schedule]]", "[[research-math-agenda-full]]", "[[harness-model-routing-charter]]", "[[evaluation-doneability-charter]]", "[[data-charter]]", "[[security-charter]]", "[[analytics-bi-charter]]", "[[0006-neural-footprint-architecture]]"]
---

# Neural Footprint Instrumentation (RM-3) — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Make **one joinable event** exist, then make it exist everywhere.

As of 2026-08-24 the footprint was two halves that did not meet plus a surface that
emitted nothing. *Corrected 2026-08-25: P1 closed the gateway half — all 7 callsites
now emit `neural_footprint_event`; see `.planning/STATE.md`. The table below is the
pre-P1 state.*

| Half | Holds | Missing |
|---|---|---|
| `decision_log` (`base_agent.py:743-784`) | `agent_name`, `decision_type`, `inputs`, `reasoning`, `output`, `confidence`, `correlation_id` — the *stimulus → internal state → choice* trace, **the hard part** | cost, tokens, latency, verdict |
| `api_spend` (`spend_logger.py:41-77`) | `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `restaurant_id` | agent, task, verdict, latency, reasoning, **and a join key** |
| `apps/api-gateway/src` (7 model callsites) | — | **everything.** 0 grep hits for `api_spend` / `cost_usd` / `input_tokens` |

Of the eight NF-A fields ([[README]] §4.2), **no row anywhere holds more than four.**

Four deliverables:

1. **`agent` on `SpendLogger.log()` and on `api_spend`.** One parameter, one column. Until
   it lands, *"cost per task per agent"* is not derivable from anything this system writes
   (`spend_logger.py:41-48`).
2. **`correlation_id` propagated into `api_spend`.** The join key, shipped **before** the
   schema.
3. **The OD-11 contract** — production columns, partial indexes per `subject_type`,
   retention/rollup for the research log — **with fork INTEL-F3 decided inside the session**,
   and with [[data-charter]] named as co-owner.
4. **Both stores, in the same change.** Narrow polymorphic production **and** wide
   append-only research ([[0006-neural-footprint-architecture]]).

## How

**Order chosen so that each step is useful even if the next one slips.**

| Phase | Work | Useful on its own because |
|---|---|---|
| **1** | Add `agent` to `SpendLogger.log()` + column | "cost per agent" becomes true for the Python side immediately |
| **2** | Propagate `correlation_id` into `api_spend`; publish the first joined row | Two footprints become one footprint with a bad shape — recoverable rather than fatal ([[neural-footprint-instrumentation-premortem]] M1) |
| **3** | Instrument **one** NestJS callsite end to end: `analytics/consultants.service.ts` | Hands [[security-charter]] SEC-3 its first-ever reading of `nf_a.unauthenticated_inference_spend` — today unmeasurable *because of us* |
| **4** | OD-11 session with [[data-charter]]: columns, indexes, retention, **INTEL-F3**, both stores | The contract exists; private tables stop being the only option |
| **5** | Remaining six callsites, behind [[harness-model-routing-charter]]'s wrapper | Completeness stops being a per-file negotiation |
| **6** | Reconciliation against the provider invoice, monthly | The only external check on a self-referential metric (premortem M5) |

**Two design commitments made now, so pressure cannot erode them later:**

- **Completeness is all-or-nothing across eight fields.** Six of eight is not 75% — it is
  an incomplete event. The hard field (`internal_state`: confidence, alternatives,
  reasoning-trace ref) **already exists** in `log_decision()`; the job is not to add
  reasoning later but to **not lose what we already have**. A proposal to make
  `internal_state` optional escalates to the founder, because it changes the definition of
  the term, not the schema.
- **Fail soft, count loudly.** Telemetry must never crash a pipeline (`spend_logger.py`
  correctly never re-raises, `:83-86`). But every suppressed emission increments a counter
  emitted through a different path, and `event_completeness` is computed against **model
  calls attempted**, known at the wrapper — never against events written, which would make
  the metric its own denominator.

**On NF-C:** nothing. The slot is reserved by `subject_type` and the append-only research
log has no schema to break, so NF-C costs **zero design tax** until its entry trigger
fires. This team checks the trigger quarterly and otherwise ignores it, which is exactly
what [[0006-neural-footprint-architecture]] §4.3 argued for.

## Why now

- **Two other departments are blocked on us.** SEC-3's primary metric
  (`nf_a.unauthenticated_inference_spend`) is a **hard dependency, not a nice-to-have**
  (`intelligence.md:488`), and AB-2's operator signal has no home until INTEL-F3 is answered.
  Our slippage is someone else's blindness.
- **There is live unauthorized spend and nobody can size it.**
  OD-20 (`OPEN-DECISIONS.md:100`) is open and urgent; the exposed callsite emits nothing.
  *Corrected 2026-08-25: both halves are closed. OD-20 is RESOLVED —
  `analytics.controller.ts:51` now carries a class-level `@UseGuards(JwtAuthGuard)` —
  and the callsite emits since P1.*
- **Every week OD-11 stays open adds a private table.** The alarm threshold is **2** and
  the count is **1**.
- **The window on INTEL-F3 is closing.** A fourth `subject_type` is a line in an enum before
  launch and a migration plus backfill afterward.
- **The research store is the founder's compensation made physical.** Declining the
  separate research company was paid for partly in this schema
  ([[0001-mudavym-single-entity]], [[0006-neural-footprint-architecture]] Consequences).
  Unbuilt, it is rhetoric.

## Next steps

- [ ] `SpendLogger.log(agent=...)` + `api_spend.agent` — **assignment #1**, one argument, one column
- [ ] Propagate `correlation_id` into `api_spend`; publish the first joined row
- [ ] Draft the eight-field NF-A event contract; circulate to both siblings before the OD-11 session
- [ ] Instrument `analytics/consultants.service.ts`; hand SEC-3 its first reading
- [ ] Book the OD-11 session with [[data-charter]]; **INTEL-F3 is an agenda item, not a follow-up**
- [ ] Name both owners on OD-11 (contract vs. DDL) before any migration is written
- [ ] Ship the research store in the same change as the production store, even if month one it duplicates
- [ ] Stand up the private-telemetry-table scan; **1 today, 2 is the alarm**
- [ ] Start monthly reconciliation: provider invoice vs. sum of NF events
- [ ] Publish `nf_a.event_completeness` weekly starting at **0%** for NestJS — the zero is the deliverable
- [ ] Quarterly NF-C trigger check; no design work until it fires

## Questions for the founder

1. **INTEL-F3 — is `operator` a fourth `subject_type`, or does operator signal live outside
   NF?** The product already collects act / dismiss / snooze / done / pin via
   `recommendation_actions`. Either answer works; **not deciding** produces a migration.
2. **What is the NF-C entry trigger in your words?**
   [[0006-neural-footprint-architecture]] proposes *a funded study partner, or a
   consumer-grade biosignal device with an API*. Confirm or replace, so the declaration is
   not ours to invent later.
3. **Who owns the DDL — us or [[data-charter]]?** The contract is ours by charter. If
   OD-11 does not name both owners it gets implemented twice, which is the one outcome
   neither team wants.
4. **Retention on the research log.** Append-only and never migrated is locked; *forever*
   is not stated. A wide log of every model call, kept indefinitely, is a storage cost and
   a privacy surface. Give us a horizon, or confirm indefinite.
5. **Does `internal_state` (reasoning, confidence, alternatives) stay required?** It is the
   expensive field and the one that makes this a neural footprint rather than a billing
   log. We propose required. Under delivery pressure someone will propose optional; we
   would rather you rule now.
